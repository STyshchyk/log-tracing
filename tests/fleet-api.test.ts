import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CoilRollupCounts } from '../src/services/coil-rollups.js';
import type {
  FleetHistoryItem,
  FleetMachineDetailsResult,
  FleetSummaryResult,
} from '../src/services/fleet.js';
import type { MachineRecord } from '../src/services/machines.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T20-${label}-${randomUUID().slice(0, 8)}`;
}

describe('Phase 2 Fleet JSON APIs against real PostgreSQL/TimescaleDB', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    if (createdMachineIds.length > 0) {
      await ctx.db.query('DELETE FROM machines WHERE id = ANY($1)', [
        createdMachineIds.splice(0),
      ]);
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  async function registerMachine(
    id: string,
    overrides: Partial<{
      display_name: string;
      zone: 'NORTH_LEFT' | 'NORTH_RIGHT' | 'MAIN_BANK' | 'EAST_DOOR';
      grid_row: number;
      grid_col: number;
      current_state: 'WORKING' | 'IDLE' | 'ERROR' | 'OFFLINE';
      active_error: string | null;
      last_seen_at: Date | null;
    }> = {},
  ): Promise<void> {
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, active_error, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        overrides.display_name ?? `Winder ${id}`,
        overrides.zone ?? 'NORTH_LEFT',
        overrides.grid_row ?? 1,
        overrides.grid_col ?? 1,
        overrides.current_state ?? 'OFFLINE',
        overrides.active_error ?? null,
        overrides.last_seen_at ?? null,
      ],
    );
  }

  function rollupMap(rollups: readonly CoilRollupCounts[]): Record<string, CoilRollupCounts> {
    return Object.fromEntries(rollups.map((r) => [r.window, r]));
  }

  it('GET /api/fleet/summary aggregates machine states, open bug reports, and coil rollups consistently', async () => {
    const mWorking = makeMachineId('SUM-W');
    const mIdle = makeMachineId('SUM-I');
    const mError = makeMachineId('SUM-E');
    const mOffline = makeMachineId('SUM-O');

    await registerMachine(mWorking, { zone: 'NORTH_LEFT', grid_row: 9, grid_col: 1, current_state: 'WORKING' });
    await registerMachine(mIdle, { zone: 'NORTH_RIGHT', grid_row: 9, grid_col: 1, current_state: 'IDLE' });
    await registerMachine(mError, {
      zone: 'MAIN_BANK',
      grid_row: 9,
      grid_col: 1,
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
    });
    await registerMachine(mOffline, { zone: 'EAST_DOOR', grid_row: 9, grid_col: 1, current_state: 'OFFLINE' });

    await ctx.db.query(
      `INSERT INTO bug_reports (machine_id, error_code, tag, worker_note, status)
       VALUES
         ($1, 'ERR_FIBER_SNAP', 'Fiber Snap', 'Snapped at guide', 'OPEN'),
         ($2, NULL, 'Other', 'Resolved check', 'RESOLVED')`,
      [mError, mIdle],
    );

    const res = await ctx.app.inject({ method: 'GET', url: '/api/fleet/summary' });
    expect(res.statusCode).toBe(200);
    const summary = res.json<FleetSummaryResult>();

    expect(Date.parse(summary.generated_at)).not.toBeNaN();
    expect(summary.machine_counts.WORKING).toBeGreaterThanOrEqual(1);
    expect(summary.machine_counts.IDLE).toBeGreaterThanOrEqual(1);
    expect(summary.machine_counts.ERROR).toBeGreaterThanOrEqual(1);
    expect(summary.machine_counts.OFFLINE).toBeGreaterThanOrEqual(1);
    expect(summary.machine_counts.total).toBe(
      summary.machine_counts.WORKING +
        summary.machine_counts.IDLE +
        summary.machine_counts.ERROR +
        summary.machine_counts.OFFLINE,
    );
    expect(summary.open_bug_reports).toBeGreaterThanOrEqual(1);

    expect(summary.coil_rollups.map((r) => r.window)).toEqual([
      'TODAY',
      'WEEK',
      'MONTH',
      'ALL_TIME',
    ]);
    for (const bucket of summary.coil_rollups) {
      expect(bucket.completed_count).toBeGreaterThanOrEqual(0);
      expect(bucket.aborted_count).toBeGreaterThanOrEqual(0);
      expect(bucket.completed_count + bucket.aborted_count).toBe(bucket.total_count);
    }
    const [today, week, month, allTime] = summary.coil_rollups;
    expect(today!.total_count).toBeLessThanOrEqual(week!.total_count);
    expect(week!.total_count).toBeLessThanOrEqual(month!.total_count);
    expect(month!.total_count).toBeLessThanOrEqual(allTime!.total_count);
  });

  it('GET /api/fleet/machines filters by state and zone and preserves deterministic ordering', async () => {
    const idEast = makeMachineId('ORD-E');
    const idMain = makeMachineId('ORD-M');
    const idNorth = makeMachineId('ORD-N');

    await registerMachine(idEast, {
      zone: 'EAST_DOOR',
      grid_row: 1,
      grid_col: 1,
      current_state: 'ERROR',
      active_error: 'ERR_BOBBIN_JAM',
    });
    await registerMachine(idMain, {
      zone: 'MAIN_BANK',
      grid_row: 2,
      grid_col: 1,
      current_state: 'WORKING',
    });
    await registerMachine(idNorth, {
      zone: 'NORTH_LEFT',
      grid_row: 1,
      grid_col: 2,
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
    });

    const allRes = await ctx.app.inject({ method: 'GET', url: '/api/fleet/machines' });
    expect(allRes.statusCode).toBe(200);
    const allBody = allRes.json<{ total: number; machines: MachineRecord[] }>();
    const ours = allBody.machines.filter((m) =>
      [idEast, idMain, idNorth].includes(m.id),
    );
    expect(ours.map((m) => m.id)).toEqual([idNorth, idMain, idEast]);

    const errorRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/fleet/machines?state=ERROR',
    });
    expect(errorRes.statusCode).toBe(200);
    const errorIds = errorRes
      .json<{ machines: MachineRecord[] }>()
      .machines.map((m) => m.id);
    expect(errorIds).toContain(idNorth);
    expect(errorIds).toContain(idEast);
    expect(errorIds).not.toContain(idMain);

    const zoneRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/fleet/machines?zone=MAIN_BANK&state=WORKING',
    });
    expect(zoneRes.statusCode).toBe(200);
    const zoneIds = zoneRes
      .json<{ machines: MachineRecord[] }>()
      .machines.map((m) => m.id);
    expect(zoneIds).toContain(idMain);
    expect(zoneIds).not.toContain(idNorth);

    const invalidRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/fleet/machines?state=BOGUS',
    });
    expect(invalidRes.statusCode).toBe(400);
  });

  it('GET /api/fleet/machines/:machineId/details returns full drill-down payload and 404 for unknown machines', async () => {
    const unknownRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/machines/${makeMachineId('MISS')}/details`,
    });
    expect(unknownRes.statusCode).toBe(404);
    expect(unknownRes.json()).toMatchObject({ error: 'Machine not found' });

    const machineId = makeMachineId('DET');
    const seenAt = new Date('2026-11-19T12:00:00.000Z');
    await registerMachine(machineId, {
      display_name: 'Detail Winder 99',
      zone: 'NORTH_RIGHT',
      grid_row: 2,
      grid_col: 4,
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
      last_seen_at: seenAt,
    });

    // Insert 6 error events + 1 heartbeat to test cap of 5 and heartbeat exclusion
    const baseMs = Date.parse('2026-11-19T11:50:00.000Z');
    for (let i = 0; i < 6; i++) {
      await ctx.db.query(
        `INSERT INTO telemetry_events (time, machine_id, event_type, error_code, payload_json)
         VALUES ($1, $2, 'ERROR', 'ERR_FIBER_SNAP', $3::jsonb)`,
        [new Date(baseMs + i * 1000), machineId, JSON.stringify({ message: `Fault #${i}` })],
      );
    }
    await ctx.db.query(
      `INSERT INTO telemetry_events (time, machine_id, event_type, error_code, payload_json)
       VALUES ($1, $2, 'HEARTBEAT', NULL, '{"rssi":-55}'::jsonb)`,
      [new Date(baseMs + 9000), machineId],
    );

    await ctx.db.query(
      `INSERT INTO coil_outcomes (machine_id, outcome, duration_sec)
       VALUES ($1, 'COMPLETED', 90), ($1, 'COMPLETED', 95), ($1, 'ABORTED', 30)`,
      [machineId],
    );

    const postBugRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/machines/${machineId}/bug-reports`,
      payload: { tag: 'Fiber Snap', worker_note: 'Snapped near tension arm' },
    });
    expect(postBugRes.statusCode).toBe(201);

    const detailsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/machines/${machineId}/details`,
    });
    expect(detailsRes.statusCode).toBe(200);
    const details = detailsRes.json<FleetMachineDetailsResult>();

    expect(details.machine.id).toBe(machineId);
    expect(details.machine.current_state).toBe('ERROR');
    expect(details.active_glossary).not.toBeNull();
    expect(details.active_glossary?.error_code).toBe('ERR_FIBER_SNAP');
    expect(details.active_glossary?.is_active).toBe(true);
    expect(details.recent_errors).toHaveLength(5);
    expect(details.recent_errors[0]?.summary).toBe('Fault #5');
    expect(details.recent_errors.some((e) => e.event_type === 'HEARTBEAT')).toBe(false);
    expect(details.recent_bug_reports).toHaveLength(1);
    expect(details.recent_bug_reports[0]?.worker_note).toBe('Snapped near tension arm');
    expect(details.worker_portal_url).toBe(`/m/${machineId}`);

    const allTime = rollupMap(details.coil_rollups).ALL_TIME;
    expect(allTime).toMatchObject({
      completed_count: 2,
      aborted_count: 1,
      total_count: 3,
    });
  });

  it('GET /api/fleet/history merges room-wide error events and bug reports with kind, zone, machineId, and limit filters', async () => {
    const idNorth = makeMachineId('HIST-N');
    const idEast = makeMachineId('HIST-E');

    await registerMachine(idNorth, { zone: 'NORTH_LEFT', current_state: 'ERROR' });
    await registerMachine(idEast, { zone: 'EAST_DOOR', current_state: 'IDLE' });

    await ctx.db.query(
      `INSERT INTO telemetry_events (time, machine_id, event_type, error_code, payload_json)
       VALUES
         ($1, $2, 'ERROR', 'ERR_FIBER_SNAP', '{"message":"North fault"}'::jsonb),
         ($2_t, $3, 'HEARTBEAT', NULL, '{"rssi":-60}'::jsonb)`
        .replace('$2_t', '$4'),
      [
        new Date('2026-11-19T12:01:00.000Z'),
        idNorth,
        idEast,
        new Date('2026-11-19T12:05:00.000Z'),
      ],
    );

    await ctx.db.query(
      `INSERT INTO bug_reports (machine_id, error_code, tag, worker_note, created_at)
       VALUES ($1, NULL, 'Unit Dead', 'East door power flicker', $2)`,
      [idEast, new Date('2026-11-19T12:03:00.000Z')],
    );

    const allNorthRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/history?machineId=${idNorth}`,
    });
    expect(allNorthRes.statusCode).toBe(200);
    const northItems = allNorthRes.json<{ items: FleetHistoryItem[] }>().items;
    expect(northItems).toHaveLength(1);
    expect(northItems[0]).toMatchObject({
      kind: 'error_event',
      machine_id: idNorth,
      zone: 'NORTH_LEFT',
      error_code: 'ERR_FIBER_SNAP',
    });

    const eastBugsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/history?zone=EAST_DOOR&kind=bug_reports&machineId=${idEast}`,
    });
    expect(eastBugsRes.statusCode).toBe(200);
    const eastItems = eastBugsRes.json<{ items: FleetHistoryItem[] }>().items;
    expect(eastItems).toHaveLength(1);
    expect(eastItems[0]).toMatchObject({
      kind: 'bug_report',
      machine_id: idEast,
      zone: 'EAST_DOOR',
      tag: 'Unit Dead',
    });

    const docsRes = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(docsRes.statusCode).toBe(200);
    const openApi = docsRes.json<{ paths: Record<string, unknown> }>();
    expect(openApi.paths).toHaveProperty('/api/fleet/summary');
    expect(openApi.paths).toHaveProperty('/api/fleet/machines');
    expect(openApi.paths).toHaveProperty('/api/fleet/machines/{machineId}/details');
    expect(openApi.paths).toHaveProperty('/api/fleet/history');
  });
});

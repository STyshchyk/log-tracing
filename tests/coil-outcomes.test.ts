import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('coil outcome ingestion and rollup views', () => {
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

  async function registerMachine(suffix: string): Promise<string> {
    const id = `T12-${suffix}-${randomUUID().slice(0, 8)}`;
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state)
       VALUES ($1, $2, 'NORTH_LEFT', 1, 1, 'WORKING')`,
      [id, `Test Winder ${id}`],
    );
    return id;
  }

  it('persists valid COMPLETED and ABORTED coil outcomes with optional reason_code, duration_sec, and ts variants', async () => {
    const machineId = await registerMachine('INGEST');
    const beforeIngest = new Date();

    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      JSON.stringify({ outcome: 'COMPLETED', duration_sec: 148 }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      JSON.stringify({
        outcome: 'ABORTED',
        reason_code: 'ERR_FIBER_SNAP',
        duration_sec: 43,
        ts: '2026-11-19T12:00:00Z',
      }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      JSON.stringify({
        outcome: 'COMPLETED',
        reason_code: null,
        duration_sec: 0,
        ts: 1763553600,
      }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      JSON.stringify({
        outcome: 'ABORTED',
        reason_code: 'OPERATOR_ABORT',
        ts: 1763553605123,
      }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      JSON.stringify({
        outcome: 'COMPLETED',
        duration_sec: 95,
        ts: 45120,
      }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      Buffer.from(
        JSON.stringify({
          outcome: 'COMPLETED',
          duration_sec: 160,
          ts: '2026-11-19T14:00:00+02:00',
        }),
        'utf8',
      ),
    );

    const afterIngest = new Date();

    const rows = await ctx.db.query<{
      machine_id: string;
      outcome: string;
      reason_code: string | null;
      duration_sec: number | null;
      created_at: Date;
    }>(
      `SELECT machine_id, outcome, reason_code, duration_sec, created_at
       FROM coil_outcomes
       WHERE machine_id = $1
       ORDER BY id ASC`,
      [machineId],
    );

    expect(rows.rows).toHaveLength(6);

    expect(rows.rows[0]?.outcome).toBe('COMPLETED');
    expect(rows.rows[0]?.reason_code).toBeNull();
    expect(rows.rows[0]?.duration_sec).toBe(148);
    expect(rows.rows[0]!.created_at.getTime()).toBeGreaterThanOrEqual(beforeIngest.getTime() - 2000);
    expect(rows.rows[0]!.created_at.getTime()).toBeLessThanOrEqual(afterIngest.getTime() + 2000);

    expect(rows.rows[1]).toMatchObject({
      machine_id: machineId,
      outcome: 'ABORTED',
      reason_code: 'ERR_FIBER_SNAP',
      duration_sec: 43,
    });
    expect(rows.rows[1]?.created_at.toISOString()).toBe('2026-11-19T12:00:00.000Z');

    expect(rows.rows[2]).toMatchObject({
      machine_id: machineId,
      outcome: 'COMPLETED',
      reason_code: null,
      duration_sec: 0,
    });
    expect(rows.rows[2]?.created_at.toISOString()).toBe('2025-11-19T12:00:00.000Z');

    expect(rows.rows[3]).toMatchObject({
      machine_id: machineId,
      outcome: 'ABORTED',
      reason_code: 'OPERATOR_ABORT',
      duration_sec: null,
    });
    expect(rows.rows[3]?.created_at.toISOString()).toBe('2025-11-19T12:00:05.123Z');

    expect(rows.rows[4]).toMatchObject({
      machine_id: machineId,
      outcome: 'COMPLETED',
      reason_code: null,
      duration_sec: 95,
    });
    expect(rows.rows[4]!.created_at.getTime()).toBeGreaterThanOrEqual(beforeIngest.getTime() - 2000);
    expect(rows.rows[4]!.created_at.getTime()).toBeLessThanOrEqual(afterIngest.getTime() + 2000);

    expect(rows.rows[5]).toMatchObject({
      machine_id: machineId,
      outcome: 'COMPLETED',
      reason_code: null,
      duration_sec: 160,
    });
    expect(rows.rows[5]?.created_at.toISOString()).toBe('2026-11-19T12:00:00.000Z');
  });

  it('rejects REDO, invalid payloads, invalid timestamps, oversized payloads, bad topics, and unregistered machines without crashing ingestion', async () => {
    const machineId = await registerMachine('REJECT');
    const unknownMachineId = `T12-UNKNOWN-${randomUUID().slice(0, 8)}`;
    const warnSpy = vi.spyOn(ctx.app.log, 'warn');

    try {
      const invalidPayloads = [
        '{"outcome":"REDO"}',
        '{"outcome":"REDO","duration_sec":60}',
        '{"outcome":"FAILED"}',
        '{"outcome":"COMPLETED","duration_sec":-1}',
        '{"outcome":"COMPLETED","duration_sec":12.5}',
        '{"outcome":"COMPLETED","duration_sec":null}',
        '{"outcome":"ABORTED","reason_code":""}',
        '{"outcome":"ABORTED","reason_code":"   "}',
        '{"outcome":"COMPLETED","ts":"not-a-timestamp"}',
        '{"outcome":"COMPLETED","ts":"2026-02-30T12:00:00Z"}',
        '{"outcome":"COMPLETED","ts":"12345"}',
        '{"outcome":"COMPLETED","ts":"11/19/2026"}',
        '{"outcome":"COMPLETED","ts":1e20}',
        '{"outcome":"COMPLETED","extra":"bad"}',
        '{malformed-json',
        JSON.stringify({ outcome: 'COMPLETED', reason_code: 'R'.repeat(1010) }),
      ];

      for (const payload of invalidPayloads) {
        await ctx.mqtt.emit(`factory/winders/${machineId}/coil`, payload);
      }

      // Invalid topic (leading dash on machineId) should not match or crash
      await ctx.mqtt.emit(
        'factory/winders/-invalid/coil',
        JSON.stringify({ outcome: 'COMPLETED', duration_sec: 10 }),
      );

      // Valid payload for an unregistered machine is safely ignored
      await ctx.mqtt.emit(
        `factory/winders/${unknownMachineId}/coil`,
        JSON.stringify({ outcome: 'COMPLETED', duration_sec: 30 }),
      );

      // Subsequent valid payload for the registered machine still succeeds
      await ctx.mqtt.emit(
        `factory/winders/${machineId}/coil`,
        JSON.stringify({ outcome: 'COMPLETED', duration_sec: 77 }),
      );

      const registeredRows = await ctx.db.query<{
        outcome: string;
        duration_sec: number | null;
      }>(
        'SELECT outcome, duration_sec FROM coil_outcomes WHERE machine_id = $1',
        [machineId],
      );
      expect(registeredRows.rows).toEqual([{ outcome: 'COMPLETED', duration_sec: 77 }]);

      const unknownRows = await ctx.db.query<{ id: string }>(
        'SELECT id FROM coil_outcomes WHERE machine_id = $1',
        [unknownMachineId],
      );
      expect(unknownRows.rows).toHaveLength(0);

      // All rejected messages produced warning logs (16 invalid payloads + 1 bad topic + 1 unknown machine)
      expect(warnSpy).toHaveBeenCalledTimes(invalidPayloads.length + 2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('provisions coil_outcomes indexes and aggregates machine and room rollups across TODAY, WEEK, MONTH, ALL_TIME boundaries', async () => {
    const indexesResult = await ctx.db.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'coil_outcomes'`,
    );
    const indexNames = indexesResult.rows.map((r) => r.indexname);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'idx_coil_outcomes_machine_created_at',
        'idx_coil_outcomes_created_at',
      ]),
    );

    const machineA = await registerMachine('ROLLA');
    const machineB = await registerMachine('ROLLB');
    const machineC = await registerMachine('ROLLC');

    interface RollupViewRow {
      time_window: 'TODAY' | 'WEEK' | 'MONTH' | 'ALL_TIME';
      completed_count: number;
      aborted_count: number;
      total_count: number;
    }

    const beforeRoomRes = await ctx.db.query<RollupViewRow>(
      `SELECT time_window, completed_count, aborted_count, total_count
       FROM coil_rollup_room`,
    );
    expect(beforeRoomRes.rows.map((r) => r.time_window)).toEqual([
      'TODAY',
      'WEEK',
      'MONTH',
      'ALL_TIME',
    ]);
    const beforeRoomByWindow = new Map(beforeRoomRes.rows.map((r) => [r.time_window, r]));

    const boundaryRes = await ctx.db.query<{
      now_ts: Date;
      day_start: Date;
      week_start: Date;
      month_start: Date;
    }>(
      `SELECT
         NOW() AS now_ts,
         date_trunc('day', NOW()) AS day_start,
         date_trunc('week', NOW()) AS week_start,
         date_trunc('month', NOW()) AS month_start`,
    );
    const { now_ts: nowTs, day_start: dayStart, week_start: weekStart, month_start: monthStart } =
      boundaryRes.rows[0]!;

    const earliestBoundaryMs = Math.min(
      dayStart.getTime(),
      weekStart.getTime(),
      monthStart.getTime(),
    );

    const machineASamples: Array<{ outcome: 'COMPLETED' | 'ABORTED'; ts: Date }> = [
      { outcome: 'COMPLETED', ts: dayStart },
      { outcome: 'ABORTED', ts: new Date(dayStart.getTime() + 60_000) },
      { outcome: 'COMPLETED', ts: new Date(dayStart.getTime() - 1) },
      { outcome: 'COMPLETED', ts: weekStart },
      { outcome: 'ABORTED', ts: new Date(weekStart.getTime() - 1) },
      { outcome: 'COMPLETED', ts: monthStart },
      { outcome: 'ABORTED', ts: new Date(monthStart.getTime() - 1) },
      { outcome: 'COMPLETED', ts: new Date(earliestBoundaryMs - 60 * 86400 * 1000) },
    ];

    for (const sample of machineASamples) {
      await ctx.mqtt.emit(
        `factory/winders/${machineA}/coil`,
        JSON.stringify({
          outcome: sample.outcome,
          duration_sec: 100,
          ts: sample.ts.toISOString(),
        }),
      );
    }

    const machineCSamples: Array<{ outcome: 'COMPLETED' | 'ABORTED'; ts: Date }> = [
      { outcome: 'COMPLETED', ts: nowTs },
      { outcome: 'ABORTED', ts: nowTs },
    ];
    for (const sample of machineCSamples) {
      await ctx.mqtt.emit(
        `factory/winders/${machineC}/coil`,
        JSON.stringify({
          outcome: sample.outcome,
          duration_sec: 55,
        }),
      );
    }

    // Machine B has 0 outcomes and must still return all 4 windows with 0 counts
    const machineBRows = await ctx.db.query<RollupViewRow>(
      `SELECT time_window, completed_count, aborted_count, total_count
       FROM coil_rollup_machine
       WHERE machine_id = $1`,
      [machineB],
    );
    expect(machineBRows.rows).toEqual([
      { time_window: 'TODAY', completed_count: 0, aborted_count: 0, total_count: 0 },
      { time_window: 'WEEK', completed_count: 0, aborted_count: 0, total_count: 0 },
      { time_window: 'MONTH', completed_count: 0, aborted_count: 0, total_count: 0 },
      { time_window: 'ALL_TIME', completed_count: 0, aborted_count: 0, total_count: 0 },
    ]);

    const windowStarts: Record<RollupViewRow['time_window'], Date | null> = {
      TODAY: dayStart,
      WEEK: weekStart,
      MONTH: monthStart,
      ALL_TIME: null,
    };

    const countSamples = (
      samples: Array<{ outcome: 'COMPLETED' | 'ABORTED'; ts: Date }>,
      since: Date | null,
    ) => {
      const matching = since
        ? samples.filter((s) => s.ts.getTime() >= since.getTime())
        : samples;
      const completed = matching.filter((s) => s.outcome === 'COMPLETED').length;
      const aborted = matching.filter((s) => s.outcome === 'ABORTED').length;
      return {
        completed_count: completed,
        aborted_count: aborted,
        total_count: completed + aborted,
      };
    };

    const machineARows = await ctx.db.query<RollupViewRow>(
      `SELECT time_window, completed_count, aborted_count, total_count
       FROM coil_rollup_machine
       WHERE machine_id = $1`,
      [machineA],
    );
    expect(machineARows.rows).toHaveLength(4);
    for (const row of machineARows.rows) {
      expect(typeof row.completed_count).toBe('number');
      expect(typeof row.aborted_count).toBe('number');
      expect(typeof row.total_count).toBe('number');
      const expected = countSamples(machineASamples, windowStarts[row.time_window]);
      expect(row).toEqual({
        time_window: row.time_window,
        ...expected,
      });
    }

    // Verify ALL_TIME captures every sample while TODAY excludes pre-dayStart samples
    const machineAAllTime = machineARows.rows.find((r) => r.time_window === 'ALL_TIME');
    const machineAToday = machineARows.rows.find((r) => r.time_window === 'TODAY');
    expect(machineAAllTime).toEqual({
      time_window: 'ALL_TIME',
      completed_count: 5,
      aborted_count: 3,
      total_count: 8,
    });
    expect(machineAToday!.total_count).toBeLessThan(machineAAllTime!.total_count);

    // Room rollup view deltas (after - before) match combined machineA + machineC counts
    const afterRoomRes = await ctx.db.query<RollupViewRow>(
      `SELECT time_window, completed_count, aborted_count, total_count
       FROM coil_rollup_room`,
    );
    const combinedSamples = [...machineASamples, ...machineCSamples];
    for (const afterRow of afterRoomRes.rows) {
      const beforeRow = beforeRoomByWindow.get(afterRow.time_window)!;
      const delta = {
        completed_count: afterRow.completed_count - beforeRow.completed_count,
        aborted_count: afterRow.aborted_count - beforeRow.aborted_count,
        total_count: afterRow.total_count - beforeRow.total_count,
      };
      expect(delta).toEqual(countSamples(combinedSamples, windowStarts[afterRow.time_window]));
    }
  });

  it('serves machine and room coil rollups over HTTP API with 404 for unknown machines and OpenAPI documentation', async () => {
    const missingId = `T12-MISSING-${randomUUID().slice(0, 8)}`;
    const notFoundRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${missingId}/coils/rollups`,
    });
    expect(notFoundRes.statusCode).toBe(404);
    expect(notFoundRes.json()).toEqual({
      error: 'Machine not found',
      machineId: missingId,
    });

    const blankIdRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/machines/%20%20/coils/rollups',
    });
    expect(blankIdRes.statusCode).toBe(404);

    const machineZero = await registerMachine('HTTP-ZERO');
    const machineActive = await registerMachine('HTTP-ACTIVE');

    const zeroRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineZero}/coils/rollups`,
    });
    expect(zeroRes.statusCode).toBe(200);
    expect(zeroRes.json()).toEqual({
      machine_id: machineZero,
      rollups: [
        { window: 'TODAY', completed_count: 0, aborted_count: 0, total_count: 0 },
        { window: 'WEEK', completed_count: 0, aborted_count: 0, total_count: 0 },
        { window: 'MONTH', completed_count: 0, aborted_count: 0, total_count: 0 },
        { window: 'ALL_TIME', completed_count: 0, aborted_count: 0, total_count: 0 },
      ],
    });

    interface RoomRollupResponse {
      rollups: Array<{
        window: 'TODAY' | 'WEEK' | 'MONTH' | 'ALL_TIME';
        completed_count: number;
        aborted_count: number;
        total_count: number;
      }>;
    }

    const beforeRoomRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/coils/rollups',
    });
    expect(beforeRoomRes.statusCode).toBe(200);
    const beforeRoom = beforeRoomRes.json<RoomRollupResponse>();
    expect(beforeRoom.rollups.map((r) => r.window)).toEqual([
      'TODAY',
      'WEEK',
      'MONTH',
      'ALL_TIME',
    ]);
    const beforeByWindow = new Map(beforeRoom.rollups.map((r) => [r.window, r]));

    const earliestRes = await ctx.db.query<{ earliest_boundary: Date }>(
      `SELECT LEAST(
         date_trunc('day', NOW()),
         date_trunc('week', NOW()),
         date_trunc('month', NOW())
       ) AS earliest_boundary`,
    );
    const ancientTs = new Date(
      earliestRes.rows[0]!.earliest_boundary.getTime() - 60 * 86400 * 1000,
    ).toISOString();

    await ctx.mqtt.emit(
      `factory/winders/${machineActive}/coil`,
      JSON.stringify({ outcome: 'COMPLETED', duration_sec: 120 }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineActive}/coil`,
      JSON.stringify({ outcome: 'COMPLETED', duration_sec: 115 }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineActive}/coil`,
      JSON.stringify({ outcome: 'ABORTED', reason_code: 'ERR_BOBBIN_JAM', duration_sec: 32 }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineActive}/coil`,
      JSON.stringify({ outcome: 'ABORTED', duration_sec: 18, ts: ancientTs }),
    );

    const activeRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineActive}/coils/rollups`,
    });
    expect(activeRes.statusCode).toBe(200);
    expect(activeRes.json()).toEqual({
      machine_id: machineActive,
      rollups: [
        { window: 'TODAY', completed_count: 2, aborted_count: 1, total_count: 3 },
        { window: 'WEEK', completed_count: 2, aborted_count: 1, total_count: 3 },
        { window: 'MONTH', completed_count: 2, aborted_count: 1, total_count: 3 },
        { window: 'ALL_TIME', completed_count: 2, aborted_count: 2, total_count: 4 },
      ],
    });

    const afterRoomRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/coils/rollups',
    });
    expect(afterRoomRes.statusCode).toBe(200);
    const afterRoom = afterRoomRes.json<RoomRollupResponse>();
    const deltas = afterRoom.rollups.map((row) => {
      const prev = beforeByWindow.get(row.window)!;
      return {
        window: row.window,
        completed_count: row.completed_count - prev.completed_count,
        aborted_count: row.aborted_count - prev.aborted_count,
        total_count: row.total_count - prev.total_count,
      };
    });
    expect(deltas).toEqual([
      { window: 'TODAY', completed_count: 2, aborted_count: 1, total_count: 3 },
      { window: 'WEEK', completed_count: 2, aborted_count: 1, total_count: 3 },
      { window: 'MONTH', completed_count: 2, aborted_count: 1, total_count: 3 },
      { window: 'ALL_TIME', completed_count: 2, aborted_count: 2, total_count: 4 },
    ]);

    const openApiRes = await ctx.app.inject({
      method: 'GET',
      url: '/docs/json',
    });
    expect(openApiRes.statusCode).toBe(200);
    const spec = openApiRes.json<{
      paths: Record<
        string,
        {
          get?: {
            parameters?: Array<{ name: string; in: string; required?: boolean }>;
            responses?: Record<string, unknown>;
          };
        }
      >;
    }>();

    const machineRollupOp = spec.paths['/api/machines/{machineId}/coils/rollups']?.get;
    expect(machineRollupOp).toBeDefined();
    expect(machineRollupOp?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'machineId', in: 'path', required: true }),
      ]),
    );
    expect(machineRollupOp?.responses?.['200']).toBeDefined();
    expect(machineRollupOp?.responses?.['404']).toBeDefined();

    const roomRollupOp = spec.paths['/api/coils/rollups']?.get;
    expect(roomRollupOp).toBeDefined();
    expect(roomRollupOp?.responses?.['200']).toBeDefined();
  });
});

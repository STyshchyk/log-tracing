import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachineRecord } from '../src/services/machines.js';
import type { FleetMachineDetailsResult } from '../src/services/fleet.js';
import { renderWorkshopFloorPlan } from '../src/ui/fleet/floor-plan.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('floor-position decoupling (position ID vs replaceable ESP32 hardware_id)', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];
  const createdReleaseVersions: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    ctx.mqtt.clearPublished();
    if (createdMachineIds.length > 0) {
      await ctx.db.query('DELETE FROM machines WHERE id = ANY($1)', [
        createdMachineIds.splice(0),
      ]);
    }
    if (createdReleaseVersions.length > 0) {
      await ctx.db.query('DELETE FROM firmware_releases WHERE version = ANY($1)', [
        createdReleaseVersions.splice(0),
      ]);
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  function uniquePosBase(): number {
    return 400_000 + Math.floor(Math.random() * 400_000);
  }

  it('PUT /api/fleet/machines/:machineId/hardware validates inputs, enforces uniqueness, supports force swap and unassign, and respects CF Access auth', async () => {
    const suffix = randomUUID().slice(0, 8);
    const posBase = uniquePosBase();
    const m1 = `POS-A-${suffix}`;
    const m2 = `POS-B-${suffix}`;
    const hw1 = `esp32-${suffix}-one`;
    createdMachineIds.push(m1, m2);

    await ctx.db.query(
      `INSERT INTO machines (id, display_name, floor_position, current_state)
       VALUES ($1, 'Position A', $3, 'IDLE'), ($2, 'Position B', $4, 'IDLE')`,
      [m1, m2, posBase + 1, posBase + 2],
    );

    const bindRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/fleet/machines/${m1}/hardware`,
      payload: { hardware_id: `  ${hw1}  ` },
    });
    expect(bindRes.statusCode).toBe(200);
    expect(bindRes.json()).toMatchObject({
      previous_hardware_id: null,
      unassigned_from_machine_id: null,
      machine: {
        id: m1,
        floor_position: posBase + 1,
        hardware_id: hw1,
      },
    });

    const badHwRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/fleet/machines/${m1}/hardware`,
      payload: { hardware_id: 'bad/topic#' },
    });
    expect(badHwRes.statusCode).toBe(400);

    const emptyHwRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/fleet/machines/${m1}/hardware`,
      payload: { hardware_id: '   ' },
    });
    expect(emptyHwRes.statusCode).toBe(400);

    const missingMachineRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/fleet/machines/UNKNOWN-${suffix}/hardware`,
      payload: { hardware_id: `esp32-${suffix}-unused` },
    });
    expect(missingMachineRes.statusCode).toBe(404);

    const conflictRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/fleet/machines/${m2}/hardware`,
      payload: { hardware_id: hw1 },
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json()).toMatchObject({
      hardware_id: hw1,
      existing_machine_id: m1,
    });

    const forceRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/fleet/machines/${m2}/hardware`,
      payload: { hardware_id: hw1, force: true },
    });
    expect(forceRes.statusCode).toBe(200);
    expect(forceRes.json()).toMatchObject({
      previous_hardware_id: null,
      unassigned_from_machine_id: m1,
      machine: { id: m2, hardware_id: hw1 },
    });

    const checkCleared = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${m1}`,
    });
    expect(checkCleared.json<MachineRecord>().hardware_id).toBeNull();

    const unassignRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/fleet/machines/${m2}/hardware`,
      payload: { hardware_id: null },
    });
    expect(unassignRes.statusCode).toBe(200);
    expect(unassignRes.json()).toMatchObject({
      previous_hardware_id: hw1,
      unassigned_from_machine_id: null,
      machine: { id: m2, hardware_id: null },
    });

    const protectedCtx = await createTestApp({
      fleetAuth: {
        teamDomain: 'factory-test.cloudflareaccess.com',
        aud: 'aud-decoupling-test',
      },
    });
    try {
      const authRes = await protectedCtx.app.inject({
        method: 'PUT',
        url: `/api/fleet/machines/${m1}/hardware`,
        payload: { hardware_id: hw1 },
      });
      expect(authRes.statusCode).toBe(401);
    } finally {
      await protectedCtx.close();
    }
  });

  it('routes MQTT status/events/coil/commands via hardware_id and preserves position history and queued commands across ESP32 replacement', async () => {
    const suffix = randomUUID().slice(0, 8);
    const pos = uniquePosBase();
    const machineId = `POS-23-${suffix}`;
    const hwOld = `esp32-${suffix}-old`;
    const hwNew = `esp32-${suffix}-new`;
    const fwVersion = `2.1.0-${suffix}`;
    createdMachineIds.push(machineId);
    createdReleaseVersions.push(fwVersion);

    await ctx.db.query(
      `INSERT INTO machines (id, display_name, floor_position, hardware_id, current_state, fw_version)
       VALUES ($1, 'Floor Position #23', $2, $3, 'IDLE', '1.0.0')`,
      [machineId, pos, hwOld],
    );

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/firmware?version=${encodeURIComponent(fwVersion)}&filename=swap-test.bin`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(`firmware-binary-${suffix}`),
    });
    expect(uploadRes.statusCode).toBe(201);

    // Old ESP32 publishes WORKING status, fault event, and coil completion under hardware_id topic
    await ctx.mqtt.emit(
      `factory/winders/${hwOld}/status`,
      JSON.stringify({ state: 'WORKING', fw_version: '1.0.0', ts: '2026-11-20T10:00:00Z' }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${hwOld}/events`,
      JSON.stringify({
        event_type: 'ERROR',
        error_code: 'ERR_FIBER_SNAP',
        subsystem: 'tension',
        message: 'Pre-swap fiber snap',
        ts: '2026-11-20T10:01:00Z',
      }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${hwOld}/coil`,
      JSON.stringify({
        outcome: 'AUTO_FINISHED',
        duration_sec: 120,
        wound_length: 95.5,
        ts: '2026-11-20T10:02:00Z',
      }),
    );

    const bugRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/machines/${machineId}/bug-reports`,
      payload: { tag: 'Fiber Snap', worker_note: 'Reported before ESP32 swap' },
    });
    expect(bugRes.statusCode).toBe(201);

    // Queue OTA while machine is WORKING -> stored as PENDING under physical machineId
    const otaQueueRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      payload: { version: fwVersion, machineIds: [machineId] },
    });
    expect(otaQueueRes.statusCode).toBe(200);
    expect(otaQueueRes.json()).toMatchObject({
      dispatched_count: 0,
      queued_count: 1,
    });
    expect(ctx.mqtt.published).toHaveLength(0);

    // Swap broken board hwOld -> replacement board hwNew on the same floor position
    const swapRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/fleet/machines/${machineId}/hardware`,
      payload: { hardware_id: hwNew },
    });
    expect(swapRes.statusCode).toBe(200);
    expect(swapRes.json()).toMatchObject({
      previous_hardware_id: hwOld,
      machine: { id: machineId, hardware_id: hwNew },
    });

    // Old hardware topic must now be ignored and must not mark machine OFFLINE
    await ctx.mqtt.emit(
      `factory/winders/${hwOld}/status`,
      JSON.stringify({ state: 'OFFLINE' }),
    );
    const afterStaleRes = await ctx.app.inject({ method: 'GET', url: `/api/machines/${machineId}` });
    expect(afterStaleRes.json<MachineRecord>().current_state).toBe('WORKING');

    // Replacement ESP32 comes online and transitions position to IDLE -> auto-dispatches queued OTA to hwNew
    await ctx.mqtt.emit(
      `factory/winders/${hwNew}/status`,
      JSON.stringify({ state: 'IDLE', fw_version: '2.0.5', ts: '2026-11-20T10:05:00Z' }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${hwNew}/events`,
      JSON.stringify({
        event_type: 'BOOT',
        reset_reason: 'POWER_ON',
        ts: '2026-11-20T10:05:01Z',
      }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${hwNew}/coil`,
      JSON.stringify({
        outcome: 'FAULT_TERMINATED',
        reason_code: 'ERR_FIBER_SNAP',
        duration_sec: 45,
        wound_length: 30.0,
        ts: '2026-11-20T10:06:00Z',
      }),
    );

    const dispatchedCmd = ctx.mqtt.published.find(
      (msg) => msg.topic === `factory/winders/${hwNew}/command`,
    );
    expect(dispatchedCmd).toBeDefined();
    expect(JSON.parse(dispatchedCmd!.payload)).toMatchObject({
      command: 'OTA_UPDATE',
      version: fwVersion,
    });
    expect(
      ctx.mqtt.published.some((msg) => msg.topic === `factory/winders/${hwOld}/command`),
    ).toBe(false);

    // Position details and Worker events retain unified pre-swap + post-swap history
    const detailsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/machines/${machineId}/details`,
    });
    expect(detailsRes.statusCode).toBe(200);
    const details = detailsRes.json<FleetMachineDetailsResult>();
    expect(details.machine.id).toBe(machineId);
    expect(details.machine.hardware_id).toBe(hwNew);
    expect(details.machine.fw_version).toBe('2.0.5');
    expect(details.recent_errors.some((e) => e.error_code === 'ERR_FIBER_SNAP')).toBe(true);
    expect(details.recent_bug_reports).toHaveLength(1);
    expect(details.recent_bug_reports[0]?.worker_note).toBe('Reported before ESP32 swap');

    const allTimeRollup = details.coil_rollups.find((r) => r.window === 'ALL_TIME');
    expect(allTimeRollup).toMatchObject({
      auto_finished_count: 1,
      aborted_count: 0,
      fault_terminated_count: 1,
      total_count: 2,
    });

    const eventsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}/events?limit=20`,
    });
    expect(eventsRes.statusCode).toBe(200);
    const eventsBody = eventsRes.json<{
      events: Array<{ event_type: string; error_code: string | null }>;
    }>();
    expect(eventsBody.events.some((e) => e.error_code === 'ERR_FIBER_SNAP')).toBe(true);
    expect(eventsBody.events.some((e) => e.event_type === 'BOOT')).toBe(true);
    expect(eventsBody.events.some((e) => e.event_type === 'INFO')).toBe(true);
  });

  it('renders decoupled floor_position slot #23 and hardware_id on /fleet with zero legacy zone labels', async () => {
    const floorHtml = renderWorkshopFloorPlan([
      {
        id: 'POS-TEST-23',
        display_name: 'Hall Station 23',
        zone: 'MAIN_BANK',
        grid_row: 1,
        grid_col: 1,
        floor_position: 23,
        hardware_id: 'esp32-slot-23',
        current_state: 'WORKING',
        active_error: null,
        fw_version: '1.4.0',
        preset_version: null,
        preset_name: null,
        last_seen_at: null,
      },
    ]);

    expect(floorHtml).toContain('data-machine-id="POS-TEST-23"');
    expect(floorHtml).toContain('data-tool-label="#23"');
    expect(floorHtml).toContain('data-floor-position="23"');
    expect(floorHtml).toContain('data-hardware-id="esp32-slot-23"');
    expect(floorHtml).toContain('<span class="node-hw-meta">esp32-slot-23</span>');
    expect(floorHtml).not.toContain('NORTH_LEFT');
    expect(floorHtml).not.toContain('NORTH_RIGHT');
    expect(floorHtml).not.toContain('MAIN_BANK');
    expect(floorHtml).not.toContain('EAST_DOOR');

    const suffix = randomUUID().slice(0, 8);
    const machineId = `FLEET-HW-${suffix}`;
    const pos = uniquePosBase();
    const hwId = `esp32-fleet-${suffix}`;
    createdMachineIds.push(machineId);

    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, floor_position, hardware_id, current_state)
       VALUES ($1, 'Legacy Zone Stripped Unit', 'NORTH_LEFT', $2, $3, 'IDLE')`,
      [machineId, pos, hwId],
    );

    const fleetRes = await ctx.app.inject({ method: 'GET', url: '/fleet' });
    expect(fleetRes.statusCode).toBe(200);
    expect(fleetRes.body).toContain(`data-machine-id="${machineId}"`);
    expect(fleetRes.body).toContain(`data-hardware-id="${hwId}"`);
    expect(fleetRes.body).toContain(`<span class="node-hw-meta">${hwId}</span>`);
    expect(fleetRes.body).toContain('drawer-hardware-section');
    expect(fleetRes.body).toContain('/hardware');
    expect(fleetRes.body).not.toContain('NORTH_LEFT');
    expect(fleetRes.body).not.toContain('NORTH_RIGHT');
    expect(fleetRes.body).not.toContain('MAIN_BANK');
    expect(fleetRes.body).not.toContain('EAST_DOOR');
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('coil outcome MQTT ingestion (factory/winders/+/coil)', () => {
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

  it('persists valid AUTO_FINISHED, ABORTED, and FAULT_TERMINATED outcomes with optional wound_length, reason_code, duration_sec, and ts variants', async () => {
    const machineId = await registerMachine('INGEST');
    const beforeIngest = new Date();

    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      JSON.stringify({ outcome: 'AUTO_FINISHED', duration_sec: 148, wound_length: 124.5 }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      JSON.stringify({
        outcome: 'FAULT_TERMINATED',
        reason_code: 'ERR_FIBER_SNAP',
        duration_sec: 43,
        wound_length: 52.25,
        ts: '2026-11-19T12:00:00Z',
      }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      JSON.stringify({
        outcome: 'AUTO_FINISHED',
        reason_code: null,
        duration_sec: 0,
        wound_length: 0,
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
        outcome: 'AUTO_FINISHED',
        duration_sec: 95,
        ts: 45120,
      }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/coil`,
      Buffer.from(
        JSON.stringify({
          outcome: 'FAULT_TERMINATED',
          reason_code: 'ERR_BOBBIN_JAM',
          duration_sec: 160,
          wound_length: 88,
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
      wound_length: number | null;
      created_at: Date;
    }>(
      `SELECT machine_id, outcome, reason_code, duration_sec, wound_length, created_at
       FROM coil_outcomes
       WHERE machine_id = $1
       ORDER BY id ASC`,
      [machineId],
    );

    expect(rows.rows).toHaveLength(6);

    expect(rows.rows[0]).toMatchObject({
      machine_id: machineId,
      outcome: 'AUTO_FINISHED',
      reason_code: null,
      duration_sec: 148,
    });
    expect(rows.rows[0]?.wound_length).toBeCloseTo(124.5, 5);
    expect(rows.rows[0]!.created_at.getTime()).toBeGreaterThanOrEqual(beforeIngest.getTime() - 2000);
    expect(rows.rows[0]!.created_at.getTime()).toBeLessThanOrEqual(afterIngest.getTime() + 2000);

    expect(rows.rows[1]).toMatchObject({
      machine_id: machineId,
      outcome: 'FAULT_TERMINATED',
      reason_code: 'ERR_FIBER_SNAP',
      duration_sec: 43,
    });
    expect(rows.rows[1]?.wound_length).toBeCloseTo(52.25, 5);
    expect(rows.rows[1]?.created_at.toISOString()).toBe('2026-11-19T12:00:00.000Z');

    expect(rows.rows[2]).toMatchObject({
      machine_id: machineId,
      outcome: 'AUTO_FINISHED',
      reason_code: null,
      duration_sec: 0,
      wound_length: 0,
    });
    expect(rows.rows[2]?.created_at.toISOString()).toBe('2025-11-19T12:00:00.000Z');

    expect(rows.rows[3]).toMatchObject({
      machine_id: machineId,
      outcome: 'ABORTED',
      reason_code: 'OPERATOR_ABORT',
      duration_sec: null,
      wound_length: null,
    });
    expect(rows.rows[3]?.created_at.toISOString()).toBe('2025-11-19T12:00:05.123Z');

    expect(rows.rows[4]).toMatchObject({
      machine_id: machineId,
      outcome: 'AUTO_FINISHED',
      reason_code: null,
      duration_sec: 95,
      wound_length: null,
    });
    expect(rows.rows[4]!.created_at.getTime()).toBeGreaterThanOrEqual(beforeIngest.getTime() - 2000);
    expect(rows.rows[4]!.created_at.getTime()).toBeLessThanOrEqual(afterIngest.getTime() + 2000);

    expect(rows.rows[5]).toMatchObject({
      machine_id: machineId,
      outcome: 'FAULT_TERMINATED',
      reason_code: 'ERR_BOBBIN_JAM',
      duration_sec: 160,
      wound_length: 88,
    });
    expect(rows.rows[5]?.created_at.toISOString()).toBe('2026-11-19T12:00:00.000Z');
  });

  it('rejects REDO, COMPLETED, FAILED, invalid wound_length, invalid payloads, oversized payloads, bad topics, and unregistered machines without crashing ingestion', async () => {
    const machineId = await registerMachine('REJECT');
    const unknownMachineId = `T12-UNKNOWN-${randomUUID().slice(0, 8)}`;
    const warnSpy = vi.spyOn(ctx.app.log, 'warn');

    try {
      const invalidPayloads = [
        '{"outcome":"REDO"}',
        '{"outcome":"REDO","duration_sec":60}',
        '{"outcome":"COMPLETED"}',
        '{"outcome":"COMPLETED","duration_sec":148}',
        '{"outcome":"FAILED"}',
        '{"outcome":"AUTO_FINISHED","duration_sec":-1}',
        '{"outcome":"AUTO_FINISHED","duration_sec":12.5}',
        '{"outcome":"AUTO_FINISHED","duration_sec":null}',
        '{"outcome":"AUTO_FINISHED","wound_length":-1}',
        '{"outcome":"AUTO_FINISHED","wound_length":null}',
        '{"outcome":"AUTO_FINISHED","wound_length":"120"}',
        '{"outcome":"ABORTED","reason_code":""}',
        '{"outcome":"ABORTED","reason_code":"   "}',
        '{"outcome":"AUTO_FINISHED","ts":"not-a-timestamp"}',
        '{"outcome":"AUTO_FINISHED","ts":"2026-02-30T12:00:00Z"}',
        '{"outcome":"AUTO_FINISHED","ts":"12345"}',
        '{"outcome":"AUTO_FINISHED","ts":"11/19/2026"}',
        '{"outcome":"AUTO_FINISHED","ts":1e20}',
        '{"outcome":"AUTO_FINISHED","extra":"bad"}',
        '{malformed-json',
        JSON.stringify({ outcome: 'AUTO_FINISHED', reason_code: 'R'.repeat(1010) }),
      ];

      for (const payload of invalidPayloads) {
        await ctx.mqtt.emit(`factory/winders/${machineId}/coil`, payload);
      }

      // Invalid topic (leading dash on machineId) should not match or crash
      await ctx.mqtt.emit(
        'factory/winders/-invalid/coil',
        JSON.stringify({ outcome: 'AUTO_FINISHED', duration_sec: 10 }),
      );

      // Valid payload for an unregistered machine is safely ignored
      await ctx.mqtt.emit(
        `factory/winders/${unknownMachineId}/coil`,
        JSON.stringify({ outcome: 'AUTO_FINISHED', duration_sec: 30, wound_length: 25 }),
      );

      // Subsequent valid payload for the registered machine still succeeds
      await ctx.mqtt.emit(
        `factory/winders/${machineId}/coil`,
        JSON.stringify({ outcome: 'AUTO_FINISHED', duration_sec: 77, wound_length: 64.5 }),
      );

      const registeredRows = await ctx.db.query<{
        outcome: string;
        duration_sec: number | null;
        wound_length: number | null;
      }>(
        'SELECT outcome, duration_sec, wound_length FROM coil_outcomes WHERE machine_id = $1',
        [machineId],
      );
      expect(registeredRows.rows).toHaveLength(1);
      expect(registeredRows.rows[0]?.outcome).toBe('AUTO_FINISHED');
      expect(registeredRows.rows[0]?.duration_sec).toBe(77);
      expect(registeredRows.rows[0]?.wound_length).toBeCloseTo(64.5, 5);

      const unknownRows = await ctx.db.query<{ id: string }>(
        'SELECT id FROM coil_outcomes WHERE machine_id = $1',
        [unknownMachineId],
      );
      expect(unknownRows.rows).toHaveLength(0);

      // All rejected messages produced warning logs (21 invalid payloads + 1 bad topic + 1 unknown machine)
      expect(warnSpy).toHaveBeenCalledTimes(invalidPayloads.length + 2);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

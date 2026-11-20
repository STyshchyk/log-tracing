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
      auto_finished_count: number;
      aborted_count: number;
      fault_terminated_count: number;
      total_count: number;
      total_wound_length: number;
    }

    const beforeRoomRes = await ctx.db.query<RollupViewRow>(
      `SELECT
         time_window,
         auto_finished_count,
         aborted_count,
         fault_terminated_count,
         total_count,
         total_wound_length
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

    type OutcomeSample = {
      outcome: 'AUTO_FINISHED' | 'ABORTED' | 'FAULT_TERMINATED';
      wound_length: number | null;
      ts: Date;
    };

    const machineASamples: OutcomeSample[] = [
      { outcome: 'AUTO_FINISHED', wound_length: 100.5, ts: dayStart },
      { outcome: 'ABORTED', wound_length: 25.0, ts: new Date(dayStart.getTime() + 60_000) },
      { outcome: 'FAULT_TERMINATED', wound_length: 40.25, ts: new Date(dayStart.getTime() - 1) },
      { outcome: 'AUTO_FINISHED', wound_length: 110.0, ts: weekStart },
      { outcome: 'ABORTED', wound_length: null, ts: new Date(weekStart.getTime() - 1) },
      { outcome: 'AUTO_FINISHED', wound_length: 120.0, ts: monthStart },
      { outcome: 'FAULT_TERMINATED', wound_length: 35.5, ts: new Date(monthStart.getTime() - 1) },
      {
        outcome: 'AUTO_FINISHED',
        wound_length: 90.0,
        ts: new Date(earliestBoundaryMs - 60 * 86400 * 1000),
      },
    ];

    for (const sample of machineASamples) {
      await ctx.mqtt.emit(
        `factory/winders/${machineA}/coil`,
        JSON.stringify({
          outcome: sample.outcome,
          duration_sec: 100,
          ...(sample.wound_length !== null ? { wound_length: sample.wound_length } : {}),
          ts: sample.ts.toISOString(),
        }),
      );
    }

    const machineCSamples: OutcomeSample[] = [
      { outcome: 'AUTO_FINISHED', wound_length: 75.5, ts: nowTs },
      { outcome: 'FAULT_TERMINATED', wound_length: 15.25, ts: nowTs },
    ];
    for (const sample of machineCSamples) {
      await ctx.mqtt.emit(
        `factory/winders/${machineC}/coil`,
        JSON.stringify({
          outcome: sample.outcome,
          duration_sec: 55,
          ...(sample.wound_length !== null ? { wound_length: sample.wound_length } : {}),
        }),
      );
    }

    // Machine B has 0 outcomes and must still return all 4 windows with 0 counts & 0 length
    const machineBRows = await ctx.db.query<RollupViewRow>(
      `SELECT
         time_window,
         auto_finished_count,
         aborted_count,
         fault_terminated_count,
         total_count,
         total_wound_length
       FROM coil_rollup_machine
       WHERE machine_id = $1`,
      [machineB],
    );
    expect(machineBRows.rows).toEqual([
      {
        time_window: 'TODAY',
        auto_finished_count: 0,
        aborted_count: 0,
        fault_terminated_count: 0,
        total_count: 0,
        total_wound_length: 0,
      },
      {
        time_window: 'WEEK',
        auto_finished_count: 0,
        aborted_count: 0,
        fault_terminated_count: 0,
        total_count: 0,
        total_wound_length: 0,
      },
      {
        time_window: 'MONTH',
        auto_finished_count: 0,
        aborted_count: 0,
        fault_terminated_count: 0,
        total_count: 0,
        total_wound_length: 0,
      },
      {
        time_window: 'ALL_TIME',
        auto_finished_count: 0,
        aborted_count: 0,
        fault_terminated_count: 0,
        total_count: 0,
        total_wound_length: 0,
      },
    ]);

    const windowStarts: Record<RollupViewRow['time_window'], Date | null> = {
      TODAY: dayStart,
      WEEK: weekStart,
      MONTH: monthStart,
      ALL_TIME: null,
    };

    const countSamples = (samples: OutcomeSample[], since: Date | null) => {
      const matching = since
        ? samples.filter((s) => s.ts.getTime() >= since.getTime())
        : samples;
      const autoFinished = matching.filter((s) => s.outcome === 'AUTO_FINISHED').length;
      const aborted = matching.filter((s) => s.outcome === 'ABORTED').length;
      const faultTerminated = matching.filter((s) => s.outcome === 'FAULT_TERMINATED').length;
      const woundLength = matching.reduce((sum, s) => sum + (s.wound_length ?? 0), 0);
      return {
        auto_finished_count: autoFinished,
        aborted_count: aborted,
        fault_terminated_count: faultTerminated,
        total_count: autoFinished + aborted + faultTerminated,
        total_wound_length: woundLength,
      };
    };

    const machineARows = await ctx.db.query<RollupViewRow>(
      `SELECT
         time_window,
         auto_finished_count,
         aborted_count,
         fault_terminated_count,
         total_count,
         total_wound_length
       FROM coil_rollup_machine
       WHERE machine_id = $1`,
      [machineA],
    );
    expect(machineARows.rows).toHaveLength(4);
    for (const row of machineARows.rows) {
      expect(typeof row.auto_finished_count).toBe('number');
      expect(typeof row.aborted_count).toBe('number');
      expect(typeof row.fault_terminated_count).toBe('number');
      expect(typeof row.total_count).toBe('number');
      expect(typeof row.total_wound_length).toBe('number');
      const expected = countSamples(machineASamples, windowStarts[row.time_window]);
      expect({
        time_window: row.time_window,
        auto_finished_count: row.auto_finished_count,
        aborted_count: row.aborted_count,
        fault_terminated_count: row.fault_terminated_count,
        total_count: row.total_count,
      }).toEqual({
        time_window: row.time_window,
        auto_finished_count: expected.auto_finished_count,
        aborted_count: expected.aborted_count,
        fault_terminated_count: expected.fault_terminated_count,
        total_count: expected.total_count,
      });
      expect(row.total_wound_length).toBeCloseTo(expected.total_wound_length, 5);
    }

    const machineAAllTime = machineARows.rows.find((r) => r.time_window === 'ALL_TIME');
    const machineAToday = machineARows.rows.find((r) => r.time_window === 'TODAY');
    expect(machineAAllTime).toMatchObject({
      time_window: 'ALL_TIME',
      auto_finished_count: 4,
      aborted_count: 2,
      fault_terminated_count: 2,
      total_count: 8,
    });
    expect(machineAAllTime?.total_wound_length).toBeCloseTo(521.25, 5);
    expect(machineAToday!.total_count).toBeLessThan(machineAAllTime!.total_count);

    // Room rollup view deltas (after - before) match combined machineA + machineC counts
    const afterRoomRes = await ctx.db.query<RollupViewRow>(
      `SELECT
         time_window,
         auto_finished_count,
         aborted_count,
         fault_terminated_count,
         total_count,
         total_wound_length
       FROM coil_rollup_room`,
    );
    const combinedSamples = [...machineASamples, ...machineCSamples];
    for (const afterRow of afterRoomRes.rows) {
      const beforeRow = beforeRoomByWindow.get(afterRow.time_window)!;
      const expected = countSamples(combinedSamples, windowStarts[afterRow.time_window]);
      expect({
        auto_finished_count: afterRow.auto_finished_count - beforeRow.auto_finished_count,
        aborted_count: afterRow.aborted_count - beforeRow.aborted_count,
        fault_terminated_count:
          afterRow.fault_terminated_count - beforeRow.fault_terminated_count,
        total_count: afterRow.total_count - beforeRow.total_count,
      }).toEqual({
        auto_finished_count: expected.auto_finished_count,
        aborted_count: expected.aborted_count,
        fault_terminated_count: expected.fault_terminated_count,
        total_count: expected.total_count,
      });
      expect(afterRow.total_wound_length - beforeRow.total_wound_length).toBeCloseTo(
        expected.total_wound_length,
        5,
      );
    }
  });

  it('serves machine and room ESP32 cycle rollups over HTTP API with 404 for unknown machines and OpenAPI documentation', async () => {
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
        {
          window: 'TODAY',
          auto_finished_count: 0,
          aborted_count: 0,
          fault_terminated_count: 0,
          total_count: 0,
          total_wound_length: 0,
        },
        {
          window: 'WEEK',
          auto_finished_count: 0,
          aborted_count: 0,
          fault_terminated_count: 0,
          total_count: 0,
          total_wound_length: 0,
        },
        {
          window: 'MONTH',
          auto_finished_count: 0,
          aborted_count: 0,
          fault_terminated_count: 0,
          total_count: 0,
          total_wound_length: 0,
        },
        {
          window: 'ALL_TIME',
          auto_finished_count: 0,
          aborted_count: 0,
          fault_terminated_count: 0,
          total_count: 0,
          total_wound_length: 0,
        },
      ],
    });

    interface RoomRollupResponse {
      rollups: Array<{
        window: 'TODAY' | 'WEEK' | 'MONTH' | 'ALL_TIME';
        auto_finished_count: number;
        aborted_count: number;
        fault_terminated_count: number;
        total_count: number;
        total_wound_length: number;
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
      JSON.stringify({ outcome: 'AUTO_FINISHED', duration_sec: 120, wound_length: 100 }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineActive}/coil`,
      JSON.stringify({ outcome: 'AUTO_FINISHED', duration_sec: 115, wound_length: 105.5 }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineActive}/coil`,
      JSON.stringify({
        outcome: 'FAULT_TERMINATED',
        reason_code: 'ERR_BOBBIN_JAM',
        duration_sec: 32,
        wound_length: 22.5,
      }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineActive}/coil`,
      JSON.stringify({
        outcome: 'ABORTED',
        duration_sec: 18,
        wound_length: 10,
        ts: ancientTs,
      }),
    );

    const activeRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineActive}/coils/rollups`,
    });
    expect(activeRes.statusCode).toBe(200);
    expect(activeRes.json()).toEqual({
      machine_id: machineActive,
      rollups: [
        {
          window: 'TODAY',
          auto_finished_count: 2,
          aborted_count: 0,
          fault_terminated_count: 1,
          total_count: 3,
          total_wound_length: 228,
        },
        {
          window: 'WEEK',
          auto_finished_count: 2,
          aborted_count: 0,
          fault_terminated_count: 1,
          total_count: 3,
          total_wound_length: 228,
        },
        {
          window: 'MONTH',
          auto_finished_count: 2,
          aborted_count: 0,
          fault_terminated_count: 1,
          total_count: 3,
          total_wound_length: 228,
        },
        {
          window: 'ALL_TIME',
          auto_finished_count: 2,
          aborted_count: 1,
          fault_terminated_count: 1,
          total_count: 4,
          total_wound_length: 238,
        },
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
        auto_finished_count: row.auto_finished_count - prev.auto_finished_count,
        aborted_count: row.aborted_count - prev.aborted_count,
        fault_terminated_count: row.fault_terminated_count - prev.fault_terminated_count,
        total_count: row.total_count - prev.total_count,
        total_wound_length: Number(
          (row.total_wound_length - prev.total_wound_length).toFixed(4),
        ),
      };
    });
    expect(deltas).toEqual([
      {
        window: 'TODAY',
        auto_finished_count: 2,
        aborted_count: 0,
        fault_terminated_count: 1,
        total_count: 3,
        total_wound_length: 228,
      },
      {
        window: 'WEEK',
        auto_finished_count: 2,
        aborted_count: 0,
        fault_terminated_count: 1,
        total_count: 3,
        total_wound_length: 228,
      },
      {
        window: 'MONTH',
        auto_finished_count: 2,
        aborted_count: 0,
        fault_terminated_count: 1,
        total_count: 3,
        total_wound_length: 228,
      },
      {
        window: 'ALL_TIME',
        auto_finished_count: 2,
        aborted_count: 1,
        fault_terminated_count: 1,
        total_count: 4,
        total_wound_length: 238,
      },
    ]);

    const openApiRes = await ctx.app.inject({
      method: 'GET',
      url: '/docs/json',
    });
    expect(openApiRes.statusCode).toBe(200);
    const openApiText = openApiRes.body;
    expect(openApiText).toContain('auto_finished_count');
    expect(openApiText).toContain('fault_terminated_count');
    expect(openApiText).toContain('total_wound_length');
    expect(openApiText).not.toContain('completed_count');

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

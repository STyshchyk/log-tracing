import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('coil_outcomes rollup views (TODAY, WEEK, MONTH, ALL_TIME)', () => {
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
});

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('coil rollups HTTP API (/api/machines/:machineId/coils/rollups & /api/coils/rollups)', () => {
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

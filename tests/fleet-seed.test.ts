import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDbPool, ensureSchema } from '../src/db/pool.js';
import {
  loadFleetSeedCsv,
  parseFleetSeedCsv,
  seedFleetMachines,
} from '../src/db/seed-fleet-machines.js';
import type { PilotMachineSeed } from '../src/db/seed-pilot-machines.js';

const DEFAULT_DB_URL = 'postgresql://telemetry:telemetry@localhost:5432/telemetry';

describe('50-winder fleet CSV parsing and idempotent seeding', () => {
  let db: Pool;
  const createdIds: string[] = [];

  beforeAll(async () => {
    db = createDbPool(
      process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DB_URL,
    );
    await ensureSchema(db);
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await db.query('DELETE FROM machines WHERE id = ANY($1)', [createdIds.splice(0)]);
    }
  });

  afterAll(async () => {
    await db?.end();
  });

  it('docs/fleet-seed.csv defines exactly 50 unique winders W-01..W-50 across all four L-shaped zones', () => {
    const machines = loadFleetSeedCsv();
    expect(machines).toHaveLength(50);

    const ids = machines.map((m) => m.id);
    expect(ids[0]).toBe('W-01');
    expect(ids[49]).toBe('W-50');
    expect(new Set(ids).size).toBe(50);

    expect(machines[0]).toEqual({
      id: 'W-01',
      display_name: 'Winder 01',
      zone: 'NORTH_LEFT',
      grid_row: 1,
      grid_col: 1,
    });
    expect(machines[1]).toEqual({
      id: 'W-02',
      display_name: 'Winder 02',
      zone: 'NORTH_LEFT',
      grid_row: 1,
      grid_col: 2,
    });

    const byZone = new Map<string, number>();
    for (const m of machines) {
      byZone.set(m.zone, (byZone.get(m.zone) ?? 0) + 1);
    }
    expect(Object.fromEntries(byZone)).toEqual({
      NORTH_LEFT: 10,
      NORTH_RIGHT: 10,
      MAIN_BANK: 24,
      EAST_DOOR: 6,
    });
  });

  it('parseFleetSeedCsv rejects invalid headers, unknown zones, invalid coordinates, duplicate IDs, and duplicate floor slots', () => {
    expect(() =>
      parseFleetSeedCsv('id,name,zone,row,col\nW-01,Winder 01,NORTH_LEFT,1,1'),
    ).toThrow(/Invalid fleet CSV header/);

    expect(() =>
      parseFleetSeedCsv('id,display_name,zone,grid_row,grid_col\nW-01,Winder 01,WEST_WING,1,1'),
    ).toThrow(/Invalid floor zone/);

    expect(() =>
      parseFleetSeedCsv('id,display_name,zone,grid_row,grid_col\nW-01,Winder 01,NORTH_LEFT,0,1'),
    ).toThrow(/Invalid grid coordinates/);

    expect(() =>
      parseFleetSeedCsv(
        [
          'id,display_name,zone,grid_row,grid_col',
          'W-01,Winder 01,NORTH_LEFT,1,1',
          'W-01,Winder 01b,NORTH_LEFT,1,2',
        ].join('\n'),
      ),
    ).toThrow(/Duplicate machine ID/);

    expect(() =>
      parseFleetSeedCsv(
        [
          'id,display_name,zone,grid_row,grid_col',
          'W-01,Winder 01,NORTH_LEFT,1,1',
          'W-02,Winder 02,NORTH_LEFT,1,1',
        ].join('\n'),
      ),
    ).toThrow(/Duplicate floor slot/);
  });

  it('seedFleetMachines inserts, reports unchanged on repeat, updates changed metadata, and preserves live telemetry', async () => {
    const prefix = `T22-${randomUUID().slice(0, 6)}`;
    const initial: PilotMachineSeed[] = [
      { id: `${prefix}-01`, display_name: 'Seed A', zone: 'NORTH_LEFT', grid_row: 1, grid_col: 1 },
      { id: `${prefix}-02`, display_name: 'Seed B', zone: 'MAIN_BANK', grid_row: 2, grid_col: 3 },
      { id: `${prefix}-03`, display_name: 'Seed C', zone: 'EAST_DOOR', grid_row: 1, grid_col: 2 },
    ];
    createdIds.push(...initial.map((m) => m.id));

    const first = await seedFleetMachines(db, initial);
    expect(first).toEqual({ total: 3, inserted: 3, updated: 0, unchanged: 0 });

    const seenAt = new Date('2026-11-19T13:15:00.000Z');
    await db.query(
      `UPDATE machines
       SET current_state = 'ERROR', active_error = 'ERR_FIBER_SNAP', last_seen_at = $2
       WHERE id = $1`,
      [`${prefix}-01`, seenAt],
    );

    const repeat = await seedFleetMachines(db, initial);
    expect(repeat).toEqual({ total: 3, inserted: 0, updated: 0, unchanged: 3 });

    const modified: PilotMachineSeed[] = [
      { id: `${prefix}-01`, display_name: 'Seed A Renamed', zone: 'NORTH_RIGHT', grid_row: 2, grid_col: 4 },
      initial[1]!,
      initial[2]!,
    ];
    const updatedRun = await seedFleetMachines(db, modified);
    expect(updatedRun).toEqual({ total: 3, inserted: 0, updated: 1, unchanged: 2 });

    const rowRes = await db.query<{
      display_name: string;
      zone: string;
      grid_row: number;
      grid_col: number;
      current_state: string;
      active_error: string | null;
      last_seen_at: Date | null;
    }>(
      `SELECT display_name, zone, grid_row, grid_col, current_state, active_error, last_seen_at
       FROM machines
       WHERE id = $1`,
      [`${prefix}-01`],
    );

    expect(rowRes.rows[0]).toMatchObject({
      display_name: 'Seed A Renamed',
      zone: 'NORTH_RIGHT',
      grid_row: 2,
      grid_col: 4,
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
    });
    expect(rowRes.rows[0]?.last_seen_at?.toISOString()).toBe(seenAt.toISOString());
  });
});

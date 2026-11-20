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

  it('docs/fleet-seed.csv defines exactly 50 unique winders W-01..W-50 mapped by floor_position without legacy zone labels', () => {
    const machines = loadFleetSeedCsv();
    expect(machines).toHaveLength(50);

    const ids = machines.map((m) => m.id);
    expect(ids[0]).toBe('W-01');
    expect(ids[49]).toBe('W-50');
    expect(new Set(ids).size).toBe(50);

    expect(machines[0]).toEqual({
      id: 'W-01',
      display_name: 'Winder 01',
      floor_position: 1,
      hardware_id: null,
    });
    expect(machines[22]).toEqual({
      id: 'W-23',
      display_name: 'Winder 23',
      floor_position: 23,
      hardware_id: null,
    });

    const positions = machines.map((m) => m.floor_position);
    expect(positions[0]).toBe(1);
    expect(positions[49]).toBe(50);
    expect(new Set(positions).size).toBe(50);
  });

  it('parseFleetSeedCsv rejects invalid headers, non-positive floor positions, invalid hardware IDs, and duplicates', () => {
    expect(() =>
      parseFleetSeedCsv('id,name,floor_position,hardware_id\nW-01,Winder 01,1,'),
    ).toThrow(/Invalid fleet CSV header/);

    expect(() =>
      parseFleetSeedCsv('id,display_name,floor_position,hardware_id\nW-01,Winder 01,0,'),
    ).toThrow(/Invalid floor_position/);

    expect(() =>
      parseFleetSeedCsv('id,display_name,floor_position,hardware_id\nW-01,Winder 01,1,bad/topic'),
    ).toThrow(/Invalid hardware_id/);

    expect(() =>
      parseFleetSeedCsv(
        [
          'id,display_name,floor_position,hardware_id',
          'W-01,Winder 01,1,',
          'W-01,Winder 01b,2,',
        ].join('\n'),
      ),
    ).toThrow(/Duplicate machine ID/);

    expect(() =>
      parseFleetSeedCsv(
        [
          'id,display_name,floor_position,hardware_id',
          'W-01,Winder 01,5,',
          'W-02,Winder 02,5,',
        ].join('\n'),
      ),
    ).toThrow(/Duplicate floor_position/);

    expect(() =>
      parseFleetSeedCsv(
        [
          'id,display_name,floor_position,hardware_id',
          'W-01,Winder 01,1,esp32-dup',
          'W-02,Winder 02,2,esp32-dup',
        ].join('\n'),
      ),
    ).toThrow(/Duplicate hardware_id/);
  });

  it('seedFleetMachines inserts, reports unchanged on repeat, updates changed metadata, and preserves live telemetry and existing hardware_id', async () => {
    const suffix = randomUUID().slice(0, 6);
    const prefix = `T22-${suffix}`;
    const basePos = 300_000 + Math.floor(Math.random() * 500_000);
    const initial: PilotMachineSeed[] = [
      { id: `${prefix}-01`, display_name: 'Seed A', floor_position: basePos + 1, hardware_id: `esp32-${suffix}-a` },
      { id: `${prefix}-02`, display_name: 'Seed B', floor_position: basePos + 2, hardware_id: null },
      { id: `${prefix}-03`, display_name: 'Seed C', floor_position: basePos + 3, hardware_id: null },
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
      { id: `${prefix}-01`, display_name: 'Seed A Renamed', floor_position: basePos + 10, hardware_id: null },
      initial[1]!,
      initial[2]!,
    ];
    const updatedRun = await seedFleetMachines(db, modified);
    expect(updatedRun).toEqual({ total: 3, inserted: 0, updated: 1, unchanged: 2 });

    const rowRes = await db.query<{
      display_name: string;
      zone: string;
      floor_position: number | null;
      hardware_id: string | null;
      current_state: string;
      active_error: string | null;
      last_seen_at: Date | null;
    }>(
      `SELECT display_name, zone, floor_position, hardware_id, current_state, active_error, last_seen_at
       FROM machines
       WHERE id = $1`,
      [`${prefix}-01`],
    );

    expect(rowRes.rows[0]).toMatchObject({
      display_name: 'Seed A Renamed',
      zone: 'FLOOR',
      floor_position: basePos + 10,
      hardware_id: `esp32-${suffix}-a`,
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
    });
    expect(rowRes.rows[0]?.last_seen_at?.toISOString()).toBe(seenAt.toISOString());
  });
});

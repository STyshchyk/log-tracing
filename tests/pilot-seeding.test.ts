import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PILOT_MACHINES,
  runPilotSeedCli,
  seedPilotMachines,
  type PilotMachineSeed,
} from '../src/db/seed-pilot-machines.js';
import { MACHINE_STATES } from '../src/spec/mqtt-contract.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('pilot machine seeding (W-01, W-02)', () => {
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

  it('idempotently seeds W-01 and W-02 at floor_position 1 and 2 and exposes them via GET /api/machines/:machineId', async () => {
    expect(PILOT_MACHINES).toEqual([
      {
        id: 'W-01',
        display_name: 'Winder 01',
        floor_position: 1,
        hardware_id: null,
      },
      {
        id: 'W-02',
        display_name: 'Winder 02',
        floor_position: 2,
        hardware_id: null,
      },
    ]);

    await seedPilotMachines(ctx.db);
    await seedPilotMachines(ctx.db);

    const res1 = await ctx.app.inject({ method: 'GET', url: '/api/machines/W-01' });
    expect(res1.statusCode).toBe(200);
    const w01 = res1.json<{
      id: string;
      display_name: string;
      zone: string;
      floor_position: number | null;
      current_state: string;
    }>();
    expect(w01).toMatchObject({
      id: 'W-01',
      display_name: 'Winder 01',
      zone: 'FLOOR',
      floor_position: 1,
    });
    expect(MACHINE_STATES).toContain(w01.current_state);

    const res2 = await ctx.app.inject({ method: 'GET', url: '/api/machines/W-02' });
    expect(res2.statusCode).toBe(200);
    const w02 = res2.json<{
      id: string;
      display_name: string;
      zone: string;
      floor_position: number | null;
      current_state: string;
    }>();
    expect(w02).toMatchObject({
      id: 'W-02',
      display_name: 'Winder 02',
      zone: 'FLOOR',
      floor_position: 2,
    });
    expect(MACHINE_STATES).toContain(w02.current_state);
  });

  it('preserves live telemetry state, active_error, and last_seen_at across repeated seeds and metadata updates', async () => {
    const suffix = randomUUID().slice(0, 8);
    const idA = `T14-A-${suffix}`;
    const idB = `T14-B-${suffix}`;
    const basePos = 350_000 + Math.floor(Math.random() * 500_000);
    const hwA = `esp32-${suffix}-a`;
    createdMachineIds.push(idA, idB);

    await seedPilotMachines(ctx.db, []);

    const initialSeeds: PilotMachineSeed[] = [
      {
        id: idB,
        display_name: `Test Winder B ${suffix}`,
        floor_position: basePos + 2,
        hardware_id: null,
      },
      {
        id: idA,
        display_name: `Test Winder A ${suffix}`,
        floor_position: basePos + 1,
        hardware_id: hwA,
      },
    ];
    await seedPilotMachines(ctx.db, initialSeeds);

    const beforeResA = await ctx.app.inject({ method: 'GET', url: `/api/machines/${idA}` });
    expect(beforeResA.statusCode).toBe(200);
    expect(beforeResA.json()).toEqual({
      id: idA,
      display_name: `Test Winder A ${suffix}`,
      zone: 'FLOOR',
      grid_row: 1,
      grid_col: 1,
      floor_position: basePos + 1,
      hardware_id: hwA,
      current_state: 'OFFLINE',
      active_error: null,
      fw_version: null,
      preset_version: null,
      preset_name: null,
      last_seen_at: null,
    });

    await ctx.mqtt.emit(
      `factory/winders/${idA}/status`,
      JSON.stringify({ state: 'WORKING', ts: '2026-11-19T12:00:00Z' }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${idB}/status`,
      JSON.stringify({
        state: 'ERROR',
        error_code: 'ERR_FIBER_SNAP',
        ts: '2026-11-19T12:05:00Z',
      }),
    );

    const liveResA = await ctx.app.inject({ method: 'GET', url: `/api/machines/${idA}` });
    const liveResB = await ctx.app.inject({ method: 'GET', url: `/api/machines/${idB}` });
    const liveA = liveResA.json<{ current_state: string; active_error: string | null; last_seen_at: string | null }>();
    const liveB = liveResB.json<{ current_state: string; active_error: string | null; last_seen_at: string | null }>();

    expect(liveA.current_state).toBe('WORKING');
    expect(liveA.active_error).toBeNull();
    expect(liveA.last_seen_at).not.toBeNull();

    expect(liveB.current_state).toBe('ERROR');
    expect(liveB.active_error).toBe('ERR_FIBER_SNAP');
    expect(liveB.last_seen_at).not.toBeNull();

    // Repeat identical seed -> live telemetry remains untouched
    await seedPilotMachines(ctx.db, initialSeeds);

    // Update floor metadata -> metadata updates without clobbering live state or existing hardware_id
    await seedPilotMachines(ctx.db, [
      {
        id: idA,
        display_name: `Relocated Winder A ${suffix}`,
        floor_position: basePos + 11,
        hardware_id: null,
      },
      {
        id: idB,
        display_name: `Relocated Winder B ${suffix}`,
        floor_position: basePos + 12,
        hardware_id: null,
      },
    ]);

    const afterResA = await ctx.app.inject({ method: 'GET', url: `/api/machines/${idA}` });
    expect(afterResA.statusCode).toBe(200);
    expect(afterResA.json()).toEqual({
      id: idA,
      display_name: `Relocated Winder A ${suffix}`,
      zone: 'FLOOR',
      grid_row: 1,
      grid_col: 1,
      floor_position: basePos + 11,
      hardware_id: hwA,
      current_state: 'WORKING',
      active_error: null,
      fw_version: null,
      preset_version: null,
      preset_name: null,
      last_seen_at: liveA.last_seen_at,
    });

    const afterResB = await ctx.app.inject({ method: 'GET', url: `/api/machines/${idB}` });
    expect(afterResB.statusCode).toBe(200);
    expect(afterResB.json()).toEqual({
      id: idB,
      display_name: `Relocated Winder B ${suffix}`,
      zone: 'FLOOR',
      grid_row: 1,
      grid_col: 1,
      floor_position: basePos + 12,
      hardware_id: null,
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
      fw_version: null,
      preset_version: null,
      preset_name: null,
      last_seen_at: liveB.last_seen_at,
    });
  });

  it('renders seeded pilot machines W-01 and W-02 cleanly across Worker Portal HTML routes and HTTP APIs', async () => {
    await seedPilotMachines(ctx.db);

    const dirRes = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(dirRes.statusCode).toBe(200);
    expect(dirRes.body).toContain('Winder 01');
    expect(dirRes.body).toContain('W-01');
    expect(dirRes.body).toContain('href="/m/W-01"');
    expect(dirRes.body).toContain('Winder 02');
    expect(dirRes.body).toContain('W-02');
    expect(dirRes.body).toContain('href="/m/W-02"');

    for (const pilot of PILOT_MACHINES) {
      const encodedId = encodeURIComponent(pilot.id);

      const portalRes = await ctx.app.inject({ method: 'GET', url: `/m/${encodedId}` });
      expect(portalRes.statusCode).toBe(200);
      expect(portalRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
      expect(portalRes.body).toContain(pilot.display_name);
      expect(portalRes.body).toContain(pilot.id);
      expect(portalRes.body).toContain(`href="/m/${encodedId}/report-bug"`);
      expect(portalRes.body).toContain(`href="/m/${encodedId}/glossary"`);

      const glossaryRes = await ctx.app.inject({
        method: 'GET',
        url: `/m/${encodedId}/glossary`,
      });
      expect(glossaryRes.statusCode).toBe(200);
      expect(glossaryRes.body).toContain('Glossary / FAQ');
      expect(glossaryRes.body).toContain(pilot.display_name);

      const reportFormRes = await ctx.app.inject({
        method: 'GET',
        url: `/m/${encodedId}/report-bug`,
      });
      expect(reportFormRes.statusCode).toBe(200);
      expect(reportFormRes.body).toContain('Report a Bug');
      expect(reportFormRes.body).toContain(pilot.display_name);

      const apiMachineRes = await ctx.app.inject({
        method: 'GET',
        url: `/api/machines/${encodedId}`,
      });
      expect(apiMachineRes.statusCode).toBe(200);
      expect(apiMachineRes.json()).toMatchObject({
        id: pilot.id,
        display_name: pilot.display_name,
        floor_position: pilot.floor_position,
      });

      const apiEventsRes = await ctx.app.inject({
        method: 'GET',
        url: `/api/machines/${encodedId}/events`,
      });
      expect(apiEventsRes.statusCode).toBe(200);

      const apiRollupsRes = await ctx.app.inject({
        method: 'GET',
        url: `/api/machines/${encodedId}/coils/rollups`,
      });
      expect(apiRollupsRes.statusCode).toBe(200);

      const apiGlossaryRes = await ctx.app.inject({
        method: 'GET',
        url: `/api/glossary?machineId=${encodedId}`,
      });
      expect(apiGlossaryRes.statusCode).toBe(200);
    }
  });

  it('runPilotSeedCli ensures schema, seeds glossary and pilot machines, and closes its pool cleanly', async () => {
    const dbUrl =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://telemetry:telemetry@localhost:5432/telemetry';

    await expect(runPilotSeedCli(dbUrl)).resolves.toBeUndefined();

    const machinesRes = await ctx.db.query<{ id: string }>(
      `SELECT id FROM machines WHERE id = ANY($1) ORDER BY id ASC`,
      [['W-01', 'W-02']],
    );
    expect(machinesRes.rows.map((row) => row.id)).toEqual(['W-01', 'W-02']);

    const glossaryRes = await ctx.db.query<{ error_code: string }>(
      `SELECT error_code FROM error_glossary WHERE error_code = 'ERR_FIBER_SNAP'`,
    );
    expect(glossaryRes.rows).toHaveLength(1);
  });
});

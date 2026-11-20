import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureSchema } from '../src/db/pool.js';
import { createInMemoryMqttTransport } from '../src/mqtt/transport.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('bootstrap seam (Fastify + real PostgreSQL/TimescaleDB)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('GET /health returns 200 with connected database status', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      database: 'connected',
    });
  });

  it('provisions all five tables, TimescaleDB hypertable, nullable photo_path, and domain CHECK constraints', async () => {
    const tablesResult = await ctx.db.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    );
    const tableNames = tablesResult.rows.map((r) => r.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'bug_reports',
        'coil_outcomes',
        'error_glossary',
        'machines',
        'telemetry_events',
      ]),
    );

    const hypertableResult = await ctx.db.query<{ hypertable_name: string }>(
      `SELECT hypertable_name
       FROM timescaledb_information.hypertables
       WHERE hypertable_name = 'telemetry_events'`,
    );
    expect(hypertableResult.rows).toHaveLength(1);

    const photoColResult = await ctx.db.query<{ is_nullable: string }>(
      `SELECT is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'bug_reports'
         AND column_name = 'photo_path'`,
    );
    expect(photoColResult.rows[0]?.is_nullable).toBe('YES');

    const woundLengthColResult = await ctx.db.query<{ is_nullable: string; data_type: string }>(
      `SELECT is_nullable, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'coil_outcomes'
         AND column_name = 'wound_length'`,
    );
    expect(woundLengthColResult.rows[0]).toEqual({
      is_nullable: 'YES',
      data_type: 'double precision',
    });

    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state)
       VALUES ('TEST-W-99', 'Test Winder', 'NORTH_LEFT', 1, 1, 'IDLE')
       ON CONFLICT (id) DO NOTHING`,
    );

    try {
      await expect(
        ctx.db.query(
          `INSERT INTO machines (id, display_name, zone, grid_row, grid_col)
           VALUES ('TEST-BAD-ZONE', 'Bad', 'INVALID_ZONE', 1, 1)`,
        ),
      ).rejects.toThrow();

      await expect(
        ctx.db.query(
          `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state)
           VALUES ('TEST-BAD-STATE', 'Bad', 'MAIN_BANK', 1, 1, 'UNKNOWN')`,
        ),
      ).rejects.toThrow();

      await expect(
        ctx.db.query(
          `INSERT INTO coil_outcomes (machine_id, outcome)
           VALUES ('TEST-W-99', 'REDO')`,
        ),
      ).rejects.toThrow();

      await expect(
        ctx.db.query(
          `INSERT INTO coil_outcomes (machine_id, outcome)
           VALUES ('TEST-W-99', 'COMPLETED')`,
        ),
      ).rejects.toThrow();

      await expect(
        ctx.db.query(
          `INSERT INTO coil_outcomes (machine_id, outcome, wound_length)
           VALUES ('TEST-W-99', 'AUTO_FINISHED', -1)`,
        ),
      ).rejects.toThrow();

      await expect(
        ctx.db.query(
          `INSERT INTO coil_outcomes (machine_id, outcome, wound_length)
           VALUES
             ('TEST-W-99', 'AUTO_FINISHED', 120.5),
             ('TEST-W-99', 'ABORTED', NULL),
             ('TEST-W-99', 'FAULT_TERMINATED', 42.25)`,
        ),
      ).resolves.toBeDefined();

      await expect(
        ctx.db.query(
          `INSERT INTO bug_reports (machine_id, tag)
           VALUES ('TEST-W-99', 'Invalid Tag')`,
        ),
      ).rejects.toThrow();

      // Re-running ensureSchema is idempotent and preserves Phase 3 constraints & views
      await expect(ensureSchema(ctx.db)).resolves.toBeUndefined();
      const viewColsRes = await ctx.db.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'coil_rollup_room'
         ORDER BY ordinal_position`,
      );
      expect(viewColsRes.rows.map((r) => r.column_name)).toEqual([
        'time_window',
        'auto_finished_count',
        'aborted_count',
        'fault_terminated_count',
        'total_count',
        'total_wound_length',
      ]);
    } finally {
      await ctx.db.query(`DELETE FROM machines WHERE id = 'TEST-W-99'`);
    }
  });

  it('GET /docs/json exposes valid OpenAPI 3 spec and GET /docs/ serves Swagger UI', async () => {
    const specResponse = await ctx.app.inject({
      method: 'GET',
      url: '/docs/json',
    });

    expect(specResponse.statusCode).toBe(200);
    const spec = specResponse.json<{
      openapi: string;
      paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
    }>();
    expect(spec.openapi).toMatch(/^3\.0\./);
    expect(spec.paths['/health']?.get?.responses?.['200']).toBeDefined();
    expect(spec.paths['/health']?.get?.responses?.['503']).toBeDefined();

    const uiResponse = await ctx.app.inject({
      method: 'GET',
      url: '/docs/',
    });
    expect(uiResponse.statusCode).toBe(200);
    expect(uiResponse.headers['content-type']).toMatch(/text\/html/);
  });

  it('closes the injected MQTT transport when Fastify closes', async () => {
    const isolated = await createTestApp();
    await isolated.close();

    await expect(isolated.mqtt.subscribe('factory/winders/#', async () => {})).rejects.toThrow();
  });

  it('defaults createApp logger to an active Pino logger and logs warnings on rejected MQTT payloads while createTestApp defaults to disabled logging', async () => {
    expect(ctx.app.log.level).toBeUndefined();

    const mqtt = createInMemoryMqttTransport();
    const prodApp = await createApp({ db: ctx.db, mqtt });
    const warnSpy = vi.spyOn(prodApp.log, 'warn').mockImplementation(() => {});

    try {
      expect(prodApp.log.level).toBe('info');
      expect(prodApp.log.level).not.toBe('silent');

      await mqtt.emit('factory/winders/TEST-LOGGER/status', '{invalid-json');
      await mqtt.emit('factory/winders/TEST-LOGGER/events', '{invalid-json');
      await mqtt.emit('factory/winders/TEST-LOGGER/coil', '{invalid-json');

      expect(warnSpy).toHaveBeenCalledTimes(3);
    } finally {
      warnSpy.mockRestore();
      await prodApp.close();
    }

    const customTestApp = await createTestApp({ logger: { level: 'warn' } });
    try {
      expect(customTestApp.app.log.level).toBe('warn');
    } finally {
      await customTestApp.close();
    }
  });
});

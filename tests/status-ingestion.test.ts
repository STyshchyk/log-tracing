import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerStatusIngestion, type StatusIngestionLogger } from '../src/mqtt/status-ingestion.js';
import { createInMemoryMqttTransport } from '../src/mqtt/transport.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T04-${label}-${randomUUID().slice(0, 8)}`;
}

describe('live machine status ingestion and machine status API', () => {
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

  async function registerMachine(
    id: string,
    overrides: Partial<{
      display_name: string;
      zone: 'NORTH_LEFT' | 'NORTH_RIGHT' | 'MAIN_BANK' | 'EAST_DOOR';
      grid_row: number;
      grid_col: number;
      current_state: 'WORKING' | 'IDLE' | 'ERROR' | 'OFFLINE';
      active_error: string | null;
    }> = {},
  ): Promise<void> {
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, active_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        overrides.display_name ?? `Winder ${id}`,
        overrides.zone ?? 'NORTH_LEFT',
        overrides.grid_row ?? 1,
        overrides.grid_col ?? 2,
        overrides.current_state ?? 'OFFLINE',
        overrides.active_error ?? null,
      ],
    );
  }

  it('GET /api/machines/:machineId returns machine status metadata and 404 for unknown machines', async () => {
    const machineId = makeMachineId('API');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder Alpha',
      zone: 'MAIN_BANK',
      grid_row: 3,
      grid_col: 4,
      current_state: 'OFFLINE',
      active_error: null,
    });

    const found = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });

    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({
      id: machineId,
      display_name: 'Pilot Winder Alpha',
      zone: 'MAIN_BANK',
      grid_row: 3,
      grid_col: 4,
      floor_position: null,
      hardware_id: null,
      current_state: 'OFFLINE',
      active_error: null,
      fw_version: null,
      preset_version: null,
      preset_name: null,
      last_seen_at: null,
    });

    const unknownId = makeMachineId('MISSING');
    const missing = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${unknownId}`,
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: 'Machine not found',
      machineId: unknownId,
    });
  });

  it('documents GET /api/machines/{machineId} with path parameter and 200/404 responses in OpenAPI /docs/json', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/docs/json',
    });

    expect(res.statusCode).toBe(200);
    const spec = res.json<{
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

    const op = spec.paths['/api/machines/{machineId}']?.get;
    expect(op).toBeDefined();
    expect(op?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'machineId', in: 'path', required: true }),
      ]),
    );
    expect(op?.responses?.['200']).toBeDefined();
    expect(op?.responses?.['404']).toBeDefined();
  });

  it('ingests WORKING and IDLE status messages over MQTT and updates current_state and last_seen_at', async () => {
    const machineId = makeMachineId('WORK');
    await registerMachine(machineId, { current_state: 'OFFLINE', active_error: null });

    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'WORKING', ts: '2026-11-19T12:01:00Z' }),
    );

    const afterWorking = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(afterWorking.statusCode).toBe(200);
    const workingBody = afterWorking.json<{
      current_state: string;
      active_error: string | null;
      last_seen_at: string | null;
    }>();
    expect(workingBody.current_state).toBe('WORKING');
    expect(workingBody.active_error).toBeNull();
    expect(workingBody.last_seen_at).not.toBeNull();
    const firstSeenMs = Date.parse(workingBody.last_seen_at ?? '');
    expect(Number.isNaN(firstSeenMs)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 15));

    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'IDLE' }));

    const afterIdle = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(afterIdle.statusCode).toBe(200);
    const idleBody = afterIdle.json<{
      current_state: string;
      active_error: string | null;
      last_seen_at: string | null;
    }>();
    expect(idleBody.current_state).toBe('IDLE');
    expect(idleBody.active_error).toBeNull();
    expect(idleBody.last_seen_at).not.toBeNull();
    expect(Date.parse(idleBody.last_seen_at ?? '')).toBeGreaterThan(firstSeenMs);
  });

  it('stores active_error on ERROR and clears active_error when transitioning to WORKING or IDLE', async () => {
    const machineId = makeMachineId('ERR');
    await registerMachine(machineId, { current_state: 'WORKING', active_error: null });

    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({
        state: 'ERROR',
        error_code: 'ERR_FIBER_SNAP',
        ts: '2026-11-19T12:04:18Z',
      }),
    );

    const onError = await ctx.app.inject({ method: 'GET', url: `/api/machines/${machineId}` });
    expect(onError.statusCode).toBe(200);
    expect(onError.json<{ current_state: string; active_error: string | null }>()).toMatchObject({
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
    });

    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'WORKING' }));

    const clearedByWorking = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(clearedByWorking.statusCode).toBe(200);
    expect(
      clearedByWorking.json<{ current_state: string; active_error: string | null }>(),
    ).toMatchObject({
      current_state: 'WORKING',
      active_error: null,
    });

    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: 'ERR_BOBBIN_JAM' }),
    );
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'IDLE' }));

    const clearedByIdle = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(clearedByIdle.statusCode).toBe(200);
    expect(
      clearedByIdle.json<{ current_state: string; active_error: string | null }>(),
    ).toMatchObject({
      current_state: 'IDLE',
      active_error: null,
    });

    // WORKING clears active_error even if error_code is erroneously included in payload
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: 'ERR_TENSION_FAULT' }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'WORKING', error_code: 'ERR_TENSION_FAULT' }),
    );
    const clearedDespiteErrorField = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(
      clearedDespiteErrorField.json<{ current_state: string; active_error: string | null }>(),
    ).toMatchObject({
      current_state: 'WORKING',
      active_error: null,
    });

    // ERROR without error_code clears any previous error_code to null
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: 'ERR_TENSION_FAULT' }),
    );
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'ERROR' }));

    const errorWithoutCode = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(errorWithoutCode.statusCode).toBe(200);
    expect(
      errorWithoutCode.json<{ current_state: string; active_error: string | null }>(),
    ).toMatchObject({
      current_state: 'ERROR',
      active_error: null,
    });
  });

  it('OFFLINE preserves active_error when error_code is omitted (LWT) and updates it only when explicitly provided', async () => {
    const machineId = makeMachineId('OFF');
    await registerMachine(machineId, {
      current_state: 'ERROR',
      active_error: 'ERR_WATCHDOG_RESET',
    });

    // LWT payload omits error_code: active_error must be preserved
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'OFFLINE' }));

    const afterLwt = await ctx.app.inject({ method: 'GET', url: `/api/machines/${machineId}` });
    expect(afterLwt.statusCode).toBe(200);
    const lwtBody = afterLwt.json<{
      current_state: string;
      active_error: string | null;
      last_seen_at: string | null;
    }>();
    expect(lwtBody.current_state).toBe('OFFLINE');
    expect(lwtBody.active_error).toBe('ERR_WATCHDOG_RESET');
    expect(lwtBody.last_seen_at).not.toBeNull();

    // Explicit error_code on OFFLINE overwrites active_error
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'OFFLINE', error_code: 'ERR_BROWNOUT_RESET' }),
    );
    const afterExplicitError = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(
      afterExplicitError.json<{ current_state: string; active_error: string | null }>(),
    ).toMatchObject({
      current_state: 'OFFLINE',
      active_error: 'ERR_BROWNOUT_RESET',
    });

    // Explicit null error_code on OFFLINE clears active_error
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'OFFLINE', error_code: null }),
    );
    const afterExplicitNull = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(
      afterExplicitNull.json<{ current_state: string; active_error: string | null }>(),
    ).toMatchObject({
      current_state: 'OFFLINE',
      active_error: null,
    });
  });

  it('persists fw_version, preset_version, and preset_name on status messages, preserves them when omitted, and clears them on explicit null', async () => {
    const machineId = makeMachineId('VER');
    await registerMachine(machineId, { current_state: 'OFFLINE' });

    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({
        state: 'IDLE',
        fw_version: '1.2.0',
        preset_version: '2026.11.1',
        preset_name: 'fiberglass-standard',
      }),
    );

    const afterInitial = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(afterInitial.statusCode).toBe(200);
    expect(afterInitial.json()).toMatchObject({
      current_state: 'IDLE',
      fw_version: '1.2.0',
      preset_version: '2026.11.1',
      preset_name: 'fiberglass-standard',
    });

    // Minimal WORKING and LWT OFFLINE omit version fields and must preserve them
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'WORKING' }));
    const afterWorking = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(afterWorking.json()).toMatchObject({
      current_state: 'WORKING',
      fw_version: '1.2.0',
      preset_version: '2026.11.1',
      preset_name: 'fiberglass-standard',
    });

    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'OFFLINE' }));
    const afterLwt = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(afterLwt.json()).toMatchObject({
      current_state: 'OFFLINE',
      fw_version: '1.2.0',
      preset_version: '2026.11.1',
      preset_name: 'fiberglass-standard',
    });

    // Explicit null clears version/name fields while preserving omitted ones
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({
        state: 'IDLE',
        fw_version: '1.3.0',
        preset_version: null,
        preset_name: null,
      }),
    );
    const afterUpdate = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}`,
    });
    expect(afterUpdate.json()).toMatchObject({
      current_state: 'IDLE',
      fw_version: '1.3.0',
      preset_version: null,
      preset_name: null,
    });
  });

  it('logs and ignores malformed, oversized, unknown-state, extra-field, invalid-topic, and unregistered-machine status messages without crashing', async () => {
    const machineId = makeMachineId('SAFE');
    const unregisteredId = makeMachineId('UNREG');
    await registerMachine(machineId, { current_state: 'OFFLINE', active_error: null });

    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: 'ERR_FIBER_SNAP' }),
    );
    const baselineRes = await ctx.app.inject({ method: 'GET', url: `/api/machines/${machineId}` });
    const baseline = baselineRes.json<{
      current_state: string;
      active_error: string | null;
      last_seen_at: string | null;
    }>();
    expect(baseline.current_state).toBe('ERROR');
    expect(baseline.active_error).toBe('ERR_FIBER_SNAP');
    expect(baseline.last_seen_at).not.toBeNull();

    const warnings: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const errors: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const spyLogger: StatusIngestionLogger = {
      warn(obj, msg) {
        warnings.push({ obj, msg });
      },
      error(obj, msg) {
        errors.push({ obj, msg });
      },
    };
    const isolatedMqtt = createInMemoryMqttTransport();
    await registerStatusIngestion(isolatedMqtt, ctx.db, spyLogger);

    const exact1024Payload = JSON.stringify({ state: 'IDLE', ts: 'a'.repeat(1000) });
    expect(Buffer.byteLength(exact1024Payload, 'utf8')).toBe(1024);

    // 524 chars, 1024 UTF-8 bytes (multi-byte UTF-8 check)
    const multibyte1024Payload = JSON.stringify({ state: 'IDLE', ts: 'é'.repeat(500) });
    expect(multibyte1024Payload.length).toBeLessThan(1024);
    expect(Buffer.byteLength(multibyte1024Payload, 'utf8')).toBe(1024);

    const invalidInputs: Array<{ topic: string; payload: string }> = [
      { topic: `factory/winders/${machineId}/status`, payload: '{not-valid-json' },
      { topic: `factory/winders/${machineId}/status`, payload: exact1024Payload },
      { topic: `factory/winders/${machineId}/status`, payload: multibyte1024Payload },
      {
        topic: `factory/winders/${machineId}/status`,
        payload: JSON.stringify({ state: 'PAUSED' }),
      },
      {
        topic: `factory/winders/${machineId}/status`,
        payload: JSON.stringify({ state: 'IDLE', extra_key: true }),
      },
      {
        topic: `factory/winders/${machineId}/status`,
        payload: JSON.stringify({ state: 'ERROR', error_code: 'bad-code' }),
      },
      { topic: 'factory/winders/invalid id/status', payload: JSON.stringify({ state: 'IDLE' }) },
      {
        topic: `factory/winders/${unregisteredId}/status`,
        payload: JSON.stringify({ state: 'WORKING' }),
      },
    ];

    try {
      for (const item of invalidInputs) {
        await expect(ctx.mqtt.emit(item.topic, item.payload)).resolves.toBeUndefined();
        await expect(isolatedMqtt.emit(item.topic, item.payload)).resolves.toBeUndefined();
      }
    } finally {
      await isolatedMqtt.close();
    }

    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(invalidInputs.length);
    expect(warnings.some((w) => w.obj.machineId === unregisteredId)).toBe(true);

    // Existing row and unregistered machine remain completely intact
    const unchangedRes = await ctx.app.inject({ method: 'GET', url: `/api/machines/${machineId}` });
    expect(unchangedRes.json<{
      current_state: string;
      active_error: string | null;
      last_seen_at: string | null;
    }>()).toMatchObject({
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
      last_seen_at: baseline.last_seen_at,
    });

    const unregRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${unregisteredId}`,
    });
    expect(unregRes.statusCode).toBe(404);

    // Subsequent valid status message (including 1023-byte boundary) is processed normally
    const exact1023Payload = JSON.stringify({ state: 'IDLE', ts: 'a'.repeat(999) });
    expect(Buffer.byteLength(exact1023Payload, 'utf8')).toBe(1023);
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, exact1023Payload);

    const recoveredRes = await ctx.app.inject({ method: 'GET', url: `/api/machines/${machineId}` });
    expect(
      recoveredRes.json<{ current_state: string; active_error: string | null }>(),
    ).toMatchObject({
      current_state: 'IDLE',
      active_error: null,
    });
  });
});

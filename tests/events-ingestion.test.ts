import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerEventsIngestion } from '../src/mqtt/events-ingestion.js';
import { createInMemoryMqttTransport } from '../src/mqtt/transport.js';
import { listRecentEvents } from '../src/services/telemetry-events.js';
import { MAX_MQTT_PAYLOAD_BYTES } from '../src/spec/mqtt-contract.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('diagnostic events ingestion and query API', () => {
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

  async function registerMachine(id = `T06-${randomUUID().slice(0, 8)}`): Promise<string> {
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state)
       VALUES ($1, $2, 'NORTH_LEFT', 1, 1, 'IDLE')`,
      [id, `Test Winder ${id}`],
    );
    return id;
  }

  it('ingests valid MQTT diagnostic events into TimescaleDB and returns them via GET /api/machines/:machineId/events', async () => {
    const machineId = await registerMachine();

    await ctx.mqtt.emit(
      `factory/winders/${machineId}/events`,
      JSON.stringify({
        event_type: 'CRASH_RESET',
        error_code: 'ERR_BROWNOUT_RESET',
        reset_reason: 'ESP_RST_BROWNOUT',
        rssi: -68,
        free_heap: 184320,
        subsystem: 'power',
        message: 'Brownout detected on startup',
        details: { boot_count: 14, core: 0, recovered: true, note: null },
        ts: '2026-11-19T12:05:00.000Z',
      }),
    );

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}/events`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      machine_id: machineId,
      events: [
        {
          time: '2026-11-19T12:05:00.000Z',
          machine_id: machineId,
          event_type: 'CRASH_RESET',
          error_code: 'ERR_BROWNOUT_RESET',
          payload_json: {
            reset_reason: 'ESP_RST_BROWNOUT',
            rssi: -68,
            free_heap: 184320,
            subsystem: 'power',
            message: 'Brownout detected on startup',
            details: { boot_count: 14, core: 0, recovered: true, note: null },
            ts: '2026-11-19T12:05:00.000Z',
          },
        },
      ],
    });
  });

  it('normalizes epoch seconds/milliseconds, falls back to ingestion time for uptime/omitted ts, and drops invalid ts strings', async () => {
    const machineId = await registerMachine();
    const beforeMs = Date.now() - 5000;

    // Epoch seconds (>= 1e9 and < 1e12)
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/events`,
      JSON.stringify({
        event_type: 'DIAGNOSTIC',
        message: 'Epoch seconds event',
        ts: 1795089600,
      }),
    );

    // Epoch milliseconds (>= 1e12)
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/events`,
      JSON.stringify({
        event_type: 'DIAGNOSTIC',
        message: 'Epoch ms event',
        ts: 1795089605123,
      }),
    );

    // Small uptime number (< 1e9) -> falls back to ingestion time while preserving ts in payload_json
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/events`,
      JSON.stringify({
        event_type: 'HEARTBEAT',
        rssi: -61,
        free_heap: 190000,
        ts: 45120,
      }),
    );

    // Omitted ts -> falls back to ingestion time
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/events`,
      JSON.stringify({
        event_type: 'INFO',
        message: 'No timestamp event',
      }),
    );

    // Invalid ts values -> ignored completely (do not crash or persist)
    for (const badTs of [
      'not-a-timestamp',
      '2026-13-45T00:00:00Z',
      '2026-02-30T12:00:00Z',
      'abc 1',
      1e20,
    ]) {
      await ctx.mqtt.emit(
        `factory/winders/${machineId}/events`,
        JSON.stringify({
          event_type: 'INFO',
          message: `Invalid ts ${String(badTs)}`,
          ts: badTs,
        }),
      );
    }

    const afterMs = Date.now() + 5000;

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}/events`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      machine_id: string;
      events: Array<{
        time: string;
        event_type: string;
        payload_json: Record<string, unknown>;
      }>;
    }>();

    expect(body.events).toHaveLength(4);

    const byMessage = new Map(
      body.events.map((e) => [String(e.payload_json.message ?? e.event_type), e]),
    );
    expect(byMessage.get('Epoch seconds event')?.time).toBe('2026-11-19T12:00:00.000Z');
    expect(byMessage.get('Epoch ms event')?.time).toBe('2026-11-19T12:00:05.123Z');

    const heartbeat = byMessage.get('HEARTBEAT');
    expect(heartbeat).toBeDefined();
    expect(heartbeat?.payload_json.ts).toBe(45120);
    const heartbeatTime = Date.parse(heartbeat!.time);
    expect(heartbeatTime).toBeGreaterThanOrEqual(beforeMs);
    expect(heartbeatTime).toBeLessThanOrEqual(afterMs);

    const noTs = byMessage.get('No timestamp event');
    expect(noTs).toBeDefined();
    const noTsTime = Date.parse(noTs!.time);
    expect(noTsTime).toBeGreaterThanOrEqual(beforeMs);
    expect(noTsTime).toBeLessThanOrEqual(afterMs);
  });

  it('orders events newest-first, defaults limit to 20, supports custom limit, and validates limit bounds 1..100', async () => {
    const machineId = await registerMachine();

    const baseMs = Date.parse('2026-11-19T10:00:00.000Z');
    for (let i = 1; i <= 25; i += 1) {
      await ctx.mqtt.emit(
        `factory/winders/${machineId}/events`,
        JSON.stringify({
          event_type: 'DIAGNOSTIC',
          message: `seq-${String(i).padStart(2, '0')}`,
          ts: new Date(baseMs + i * 1000).toISOString(),
        }),
      );
    }

    const defaultRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}/events`,
    });
    expect(defaultRes.statusCode).toBe(200);
    const defaultEvents = defaultRes.json<{
      events: Array<{ payload_json: { message: string } }>;
    }>().events;
    expect(defaultEvents).toHaveLength(20);
    expect(defaultEvents[0]?.payload_json.message).toBe('seq-25');
    expect(defaultEvents[19]?.payload_json.message).toBe('seq-06');

    const limitedRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}/events?limit=3`,
    });
    expect(limitedRes.statusCode).toBe(200);
    expect(
      limitedRes
        .json<{ events: Array<{ payload_json: { message: string } }> }>()
        .events.map((e) => e.payload_json.message),
    ).toEqual(['seq-25', 'seq-24', 'seq-23']);

    const maxRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}/events?limit=100`,
    });
    expect(maxRes.statusCode).toBe(200);
    expect(maxRes.json<{ events: unknown[] }>().events).toHaveLength(25);

    for (const invalidQuery of ['limit=0', 'limit=101', 'limit=-1', 'limit=abc', 'limit=2.5']) {
      const badRes = await ctx.app.inject({
        method: 'GET',
        url: `/api/machines/${machineId}/events?${invalidQuery}`,
      });
      expect(badRes.statusCode).toBe(400);
    }
  });

  it('filters error events with errorsOnly=true, isolates per-machine events, and returns 404 / null for unknown machines', async () => {
    const unknownId = `T06-UNKNOWN-${randomUUID().slice(0, 8)}`;
    const unknownRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${unknownId}/events`,
    });
    expect(unknownRes.statusCode).toBe(404);
    expect(unknownRes.json()).toEqual({
      error: 'Machine not found',
      machineId: unknownId,
    });
    await expect(listRecentEvents(ctx.db, { machineId: unknownId })).resolves.toBeNull();

    const machineA = await registerMachine();
    const machineB = await registerMachine();

    // Machine with zero events returns 200 with empty array
    const emptyRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineB}/events`,
    });
    expect(emptyRes.statusCode).toBe(200);
    expect(emptyRes.json()).toEqual({ machine_id: machineB, events: [] });

    const baseMs = Date.parse('2026-11-19T11:00:00.000Z');
    const machineAEvents = [
      { event_type: 'BOOT', message: 'boot-1', ts: new Date(baseMs + 1000).toISOString() },
      { event_type: 'ERROR', error_code: null, message: 'err-type-only', ts: new Date(baseMs + 2000).toISOString() },
      { event_type: 'FAULT', message: 'fault-no-code', ts: new Date(baseMs + 3000).toISOString() },
      { event_type: 'SUBSYSTEM_TIMEOUT', subsystem: 'stepper', message: 'timeout-1', ts: new Date(baseMs + 4000).toISOString() },
      { event_type: 'CRASH_RESET', reset_reason: 'ESP_RST_PANIC', message: 'crash-1', ts: new Date(baseMs + 5000).toISOString() },
      { event_type: 'INFO', error_code: 'ERR_FIBER_SNAP', message: 'info-with-code', ts: new Date(baseMs + 6000).toISOString() },
      { event_type: 'HEARTBEAT', rssi: -63, free_heap: 185000, ts: new Date(baseMs + 7000).toISOString() },
      { event_type: 'DIAGNOSTIC', message: 'diag-no-code', ts: new Date(baseMs + 8000).toISOString() },
      { event_type: 'INFO', message: 'info-no-code', ts: new Date(baseMs + 9000).toISOString() },
    ];

    for (const ev of machineAEvents) {
      await ctx.mqtt.emit(`factory/winders/${machineA}/events`, JSON.stringify(ev));
    }
    await ctx.mqtt.emit(
      `factory/winders/${machineB}/events`,
      JSON.stringify({
        event_type: 'ERROR',
        error_code: 'ERR_BOBBIN_JAM',
        message: 'machine-b-only',
        ts: new Date(baseMs + 10000).toISOString(),
      }),
    );

    const errorsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineA}/events?errorsOnly=true&limit=4`,
    });
    expect(errorsRes.statusCode).toBe(200);
    const errorEvents = errorsRes.json<{
      events: Array<{ event_type: string; error_code: string | null; payload_json: { message?: string } }>;
    }>().events;
    expect(errorEvents.map((e) => e.payload_json.message)).toEqual([
      'info-with-code',
      'crash-1',
      'timeout-1',
      'fault-no-code',
    ]);

    // Verify all 5 error events on machine A are returned when limit allows, and machine B's event does not leak
    const allErrors = await listRecentEvents(ctx.db, {
      machineId: machineA,
      limit: 10,
      errorsOnly: true,
    });
    expect(allErrors?.map((e) => e.payload_json.message)).toEqual([
      'info-with-code',
      'crash-1',
      'timeout-1',
      'fault-no-code',
      'err-type-only',
    ]);

    const machineBOnly = await listRecentEvents(ctx.db, { machineId: machineB });
    expect(machineBOnly?.map((e) => e.payload_json.message)).toEqual(['machine-b-only']);

    // errorsOnly=false returns all 9 events including non-error telemetry
    const allRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineA}/events?errorsOnly=false`,
    });
    expect(allRes.statusCode).toBe(200);
    expect(allRes.json<{ events: unknown[] }>().events).toHaveLength(9);

    const badErrorsOnly = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineA}/events?errorsOnly=maybe`,
    });
    expect(badErrorsOnly.statusCode).toBe(400);
  });

  it('logs and safely ignores malformed, oversized, invalid-topic, and unknown-machine events without interrupting subsequent valid events', async () => {
    const machineId = await registerMachine();
    const unknownMachineId = `T06-UNREG-${randomUUID().slice(0, 8)}`;

    const baseMessage = '{"event_type":"INFO","message":"';
    const suffix = '"}';
    const oversizedPayload = `${baseMessage}${'x'.repeat(
      MAX_MQTT_PAYLOAD_BYTES - Buffer.byteLength(baseMessage + suffix, 'utf8'),
    )}${suffix}`;
    expect(Buffer.byteLength(oversizedPayload, 'utf8')).toBe(MAX_MQTT_PAYLOAD_BYTES);

    // Emit bad payloads through the unified app seam
    await ctx.mqtt.emit(`factory/winders/${machineId}/events`, '{not valid json');
    await ctx.mqtt.emit(`factory/winders/${machineId}/events`, oversizedPayload);
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/events`,
      JSON.stringify({ event_type: 'UNKNOWN_EVENT' }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/events`,
      JSON.stringify({ event_type: 'INFO', unexpected_field: true }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/events`,
      JSON.stringify({ event_type: 'INFO', free_heap: -10 }),
    );
    await ctx.mqtt.emit(
      'factory/winders/INVALID ID/events',
      JSON.stringify({ event_type: 'INFO', message: 'bad topic' }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${unknownMachineId}/events`,
      JSON.stringify({ event_type: 'ERROR', error_code: 'ERR_FIBER_SNAP' }),
    );

    // Subsequent valid minimal event for the registered machine succeeds cleanly
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/events`,
      JSON.stringify({ event_type: 'INFO' }),
    );

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}/events`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      machine_id: string;
      events: Array<{
        event_type: string;
        error_code: string | null;
        payload_json: Record<string, unknown>;
      }>;
    }>();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      event_type: 'INFO',
      error_code: null,
      payload_json: {},
    });

    const unknownCount = await ctx.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM telemetry_events WHERE machine_id = $1',
      [unknownMachineId],
    );
    expect(unknownCount.rows[0]?.count).toBe('0');

    // Verify warning logs are emitted for rejected events via the ingestion seam
    const isolatedMqtt = createInMemoryMqttTransport();
    const warnings: string[] = [];
    const errors: string[] = [];
    await registerEventsIngestion(isolatedMqtt, ctx.db, {
      warn(_obj, msg) {
        if (msg) warnings.push(msg);
      },
      error(_obj, msg) {
        if (msg) errors.push(msg);
      },
    });

    try {
      await isolatedMqtt.emit(`factory/winders/${machineId}/events`, '{bad');
      await isolatedMqtt.emit(`factory/winders/${machineId}/events`, oversizedPayload);
      await isolatedMqtt.emit(
        `factory/winders/${machineId}/events`,
        JSON.stringify({ event_type: 'INFO', ts: 'bad-ts' }),
      );
      await isolatedMqtt.emit('factory/winders/bad id/events', '{"event_type":"INFO"}');
      await isolatedMqtt.emit(
        `factory/winders/${unknownMachineId}/events`,
        '{"event_type":"INFO"}',
      );

      expect(warnings).toHaveLength(5);
      expect(errors).toHaveLength(0);
    } finally {
      await isolatedMqtt.close();
    }
  });

  it('documents GET /api/machines/{machineId}/events with query parameters and 200/404 responses in OpenAPI /docs/json', async () => {
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

    const op = spec.paths['/api/machines/{machineId}/events']?.get;
    expect(op).toBeDefined();
    expect(op?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'machineId', in: 'path', required: true }),
        expect.objectContaining({ name: 'limit', in: 'query', required: false }),
        expect.objectContaining({ name: 'errorsOnly', in: 'query', required: false }),
      ]),
    );
    expect(op?.responses?.['200']).toBeDefined();
    expect(op?.responses?.['404']).toBeDefined();
  });
});

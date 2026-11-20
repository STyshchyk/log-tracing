import { describe, expect, it } from 'vitest';
import { loadFaultRegistry } from '../src/spec/fault-registry.js';
import {
  BUG_REPORT_TAGS,
  COIL_OUTCOMES,
  coilPayloadSchema,
  ERROR_EVENT_TYPES,
  EVENT_TYPES,
  eventPayloadSchema,
  FLOOR_ZONES,
  isErrorEvent,
  MACHINE_STATES,
  MAX_MQTT_PAYLOAD_BYTES,
  MQTT_TOPIC_PREFIX,
  parseMqttJsonPayload,
  parseWinderTopic,
  statusPayloadSchema,
} from '../src/spec/mqtt-contract.js';

describe('mqtt contract', () => {
  it('exposes canonical domain constants and parses valid winder topics while rejecting malformed ones', () => {
    expect(MQTT_TOPIC_PREFIX).toBe('factory/winders');
    expect(MAX_MQTT_PAYLOAD_BYTES).toBe(1024);
    expect(MACHINE_STATES).toEqual(['WORKING', 'IDLE', 'ERROR', 'OFFLINE']);
    expect(EVENT_TYPES).toEqual([
      'ERROR',
      'FAULT',
      'SUBSYSTEM_TIMEOUT',
      'CRASH_RESET',
      'BOOT',
      'HEARTBEAT',
      'DIAGNOSTIC',
      'INFO',
    ]);
    expect(ERROR_EVENT_TYPES).toEqual(['ERROR', 'FAULT', 'SUBSYSTEM_TIMEOUT', 'CRASH_RESET']);
    expect(COIL_OUTCOMES).toEqual(['AUTO_FINISHED', 'ABORTED', 'FAULT_TERMINATED']);
    expect(BUG_REPORT_TAGS).toEqual(['Fiber Snap', 'Tension', 'Unit Dead', 'Bobbin Jam', 'Other']);
    expect(FLOOR_ZONES).toEqual(['NORTH_LEFT', 'NORTH_RIGHT', 'MAIN_BANK', 'EAST_DOOR']);

    expect(parseWinderTopic('factory/winders/W-01/status')).toEqual({
      machineId: 'W-01',
      channel: 'status',
    });
    expect(parseWinderTopic('factory/winders/W_02_pilot/events')).toEqual({
      machineId: 'W_02_pilot',
      channel: 'events',
    });
    expect(parseWinderTopic('factory/winders/A/coil')).toEqual({
      machineId: 'A',
      channel: 'coil',
    });
    expect(parseWinderTopic(`factory/winders/${'W'.repeat(64)}/status`)).toEqual({
      machineId: 'W'.repeat(64),
      channel: 'status',
    });

    const invalidTopics = [
      '',
      'factory/winders/W-01',
      'factory/winders/W-01/unknown',
      'factory/winders/W-01/status/extra',
      '/factory/winders/W-01/status',
      'factory/winders/W-01/status/',
      'other/winders/W-01/status',
      'factory/winders/-W01/status',
      'factory/winders/_W01/status',
      'factory/winders/+/status',
      'factory/winders/W-01/#',
      'factory/winders/W 01/status',
      `factory/winders/${'W'.repeat(65)}/status`,
    ];

    for (const topic of invalidTopics) {
      expect(parseWinderTopic(topic)).toBeNull();
    }
  });

  it('validates status payloads, LWT OFFLINE shape, and strictly enforces < 1024 UTF-8 byte payloads', () => {
    expect(parseMqttJsonPayload('{"state":"WORKING"}', statusPayloadSchema)).toEqual({
      state: 'WORKING',
    });
    expect(
      parseMqttJsonPayload(Buffer.from('{"state":"OFFLINE"}', 'utf8'), statusPayloadSchema),
    ).toEqual({
      state: 'OFFLINE',
    });
    expect(
      parseMqttJsonPayload(
        '{"state":"ERROR","error_code":"ERR_FIBER_SNAP","ts":"2026-11-19T12:00:00Z"}',
        statusPayloadSchema,
      ),
    ).toEqual({
      state: 'ERROR',
      error_code: 'ERR_FIBER_SNAP',
      ts: '2026-11-19T12:00:00Z',
    });
    expect(
      parseMqttJsonPayload('{"state":"IDLE","error_code":null,"ts":1763553600}', statusPayloadSchema),
    ).toEqual({
      state: 'IDLE',
      error_code: null,
      ts: 1763553600,
    });

    // Strict UTF-8 byte length boundary: 1023 bytes succeeds, 1024 bytes fails (ASCII and multi-byte)
    const prefix = '{"state":"IDLE","ts":"';
    const suffix = '"}';
    const overheadBytes = Buffer.byteLength(prefix + suffix, 'utf8'); // 24 bytes
    const exactly1023 = `${prefix}${'a'.repeat(1023 - overheadBytes)}${suffix}`;
    const exactly1024 = `${prefix}${'a'.repeat(1024 - overheadBytes)}${suffix}`;
    const multiByte1024 = `${prefix}${'é'.repeat((1024 - overheadBytes) / 2)}${suffix}`;

    expect(Buffer.byteLength(exactly1023, 'utf8')).toBe(1023);
    expect(Buffer.byteLength(exactly1024, 'utf8')).toBe(1024);
    expect(multiByte1024.length).toBeLessThan(1024);
    expect(Buffer.byteLength(multiByte1024, 'utf8')).toBe(1024);

    expect(parseMqttJsonPayload(exactly1023, statusPayloadSchema).state).toBe('IDLE');
    expect(() => parseMqttJsonPayload(exactly1024, statusPayloadSchema)).toThrow(/1024/);
    expect(() =>
      parseMqttJsonPayload(Buffer.from(exactly1024, 'utf8'), statusPayloadSchema),
    ).toThrow(/1024/);
    expect(() => parseMqttJsonPayload(multiByte1024, statusPayloadSchema)).toThrow(/1024/);

    // Malformed JSON, invalid states, malformed error_code, extra keys, and bad ts
    for (const invalidPayload of [
      '',
      '{not json',
      '[]',
      '{"state":"PAUSED"}',
      '{"state":"ERROR","error_code":"err_lower"}',
      '{"state":"ERROR","error_code":"ERR__BAD"}',
      '{"state":"ERROR","error_code":""}',
      '{"state":"WORKING","ts":"   "}',
      '{"state":"WORKING","ts":-5}',
      '{"state":"WORKING","extra":true}',
    ]) {
      expect(() => parseMqttJsonPayload(invalidPayload, statusPayloadSchema)).toThrow();
    }
  });

  it('validates event payloads (timeouts, reset forensics, RSSI, free heap, details) and classifies error events via isErrorEvent', () => {
    const bootEvent = parseMqttJsonPayload(
      JSON.stringify({
        event_type: 'CRASH_RESET',
        error_code: 'ERR_BROWNOUT_RESET',
        reset_reason: 'ESP_RST_BROWNOUT',
        rssi: -68,
        free_heap: 184320,
        subsystem: 'power',
        message: 'Brownout detected on startup',
        details: { boot_count: 14, core: 0, recovered: true, note: null },
        ts: '2026-11-19T12:05:00Z',
      }),
      eventPayloadSchema,
    );

    expect(bootEvent).toEqual({
      event_type: 'CRASH_RESET',
      error_code: 'ERR_BROWNOUT_RESET',
      reset_reason: 'ESP_RST_BROWNOUT',
      rssi: -68,
      free_heap: 184320,
      subsystem: 'power',
      message: 'Brownout detected on startup',
      details: { boot_count: 14, core: 0, recovered: true, note: null },
      ts: '2026-11-19T12:05:00Z',
    });

    const timeoutEvent = parseMqttJsonPayload(
      '{"event_type":"SUBSYSTEM_TIMEOUT","error_code":"ERR_SUBSYSTEM_TIMEOUT","subsystem":"traverse_stepper","rssi":-72,"free_heap":172000}',
      eventPayloadSchema,
    );
    expect(timeoutEvent.event_type).toBe('SUBSYSTEM_TIMEOUT');

    const heartbeat = parseMqttJsonPayload(
      '{"event_type":"HEARTBEAT","error_code":null,"rssi":-61,"free_heap":190000,"ts":45120}',
      eventPayloadSchema,
    );
    expect(heartbeat.event_type).toBe('HEARTBEAT');

    for (const invalidEvent of [
      '{"event_type":"UNKNOWN_TYPE"}',
      '{"event_type":"FAULT","error_code":"bad-code"}',
      '{"event_type":"DIAGNOSTIC","free_heap":-1}',
      '{"event_type":"DIAGNOSTIC","free_heap":123.5}',
      '{"event_type":"DIAGNOSTIC","rssi":"-60"}',
      '{"event_type":"INFO","reset_reason":"   "}',
      '{"event_type":"INFO","subsystem":""}',
      '{"event_type":"INFO","message":""}',
      '{"event_type":"INFO","details":{"nested":{"bad":1}}}',
      '{"event_type":"INFO","details":{"list":[1,2]}}',
      '{"event_type":"INFO","unexpected":1}',
    ]) {
      expect(() => parseMqttJsonPayload(invalidEvent, eventPayloadSchema)).toThrow();
    }

    for (const errType of ['ERROR', 'FAULT', 'SUBSYSTEM_TIMEOUT', 'CRASH_RESET'] as const) {
      expect(isErrorEvent(errType)).toBe(true);
      expect(isErrorEvent(errType, null)).toBe(true);
    }

    for (const nonErrType of ['BOOT', 'HEARTBEAT', 'DIAGNOSTIC', 'INFO'] as const) {
      expect(isErrorEvent(nonErrType)).toBe(false);
      expect(isErrorEvent(nonErrType, null)).toBe(false);
      expect(isErrorEvent(nonErrType, '')).toBe(false);
      expect(isErrorEvent(nonErrType, 'ERR_WATCHDOG_RESET')).toBe(true);
    }
  });

  it('validates ESP32 coil outcome payloads (AUTO_FINISHED/ABORTED/FAULT_TERMINATED), accepts optional reason_code, duration_sec, and wound_length, and explicitly rejects CRM statuses (COMPLETED/FAILED/REDO)', () => {
    expect(
      parseMqttJsonPayload(
        '{"outcome":"AUTO_FINISHED","duration_sec":142,"wound_length":124.5,"ts":"2026-11-19T12:10:00Z"}',
        coilPayloadSchema,
      ),
    ).toEqual({
      outcome: 'AUTO_FINISHED',
      duration_sec: 142,
      wound_length: 124.5,
      ts: '2026-11-19T12:10:00Z',
    });

    expect(
      parseMqttJsonPayload(
        '{"outcome":"ABORTED","reason_code":"OPERATOR_ABORT","duration_sec":0,"wound_length":0}',
        coilPayloadSchema,
      ),
    ).toEqual({
      outcome: 'ABORTED',
      reason_code: 'OPERATOR_ABORT',
      duration_sec: 0,
      wound_length: 0,
    });

    expect(
      parseMqttJsonPayload(
        '{"outcome":"FAULT_TERMINATED","reason_code":"ERR_FIBER_SNAP","duration_sec":61,"wound_length":52}',
        coilPayloadSchema,
      ),
    ).toEqual({
      outcome: 'FAULT_TERMINATED',
      reason_code: 'ERR_FIBER_SNAP',
      duration_sec: 61,
      wound_length: 52,
    });

    expect(
      parseMqttJsonPayload('{"outcome":"AUTO_FINISHED","reason_code":null}', coilPayloadSchema),
    ).toEqual({
      outcome: 'AUTO_FINISHED',
      reason_code: null,
    });

    for (const invalidCoil of [
      '{"outcome":"REDO"}',
      '{"outcome":"REDO","duration_sec":60}',
      '{"outcome":"COMPLETED"}',
      '{"outcome":"COMPLETED","duration_sec":142}',
      '{"outcome":"FAILED"}',
      '{"outcome":"AUTO_FINISHED","duration_sec":-1}',
      '{"outcome":"AUTO_FINISHED","duration_sec":12.5}',
      '{"outcome":"AUTO_FINISHED","duration_sec":null}',
      '{"outcome":"AUTO_FINISHED","wound_length":-0.5}',
      '{"outcome":"AUTO_FINISHED","wound_length":null}',
      '{"outcome":"AUTO_FINISHED","wound_length":"124.5"}',
      '{"outcome":"ABORTED","reason_code":""}',
      '{"outcome":"ABORTED","reason_code":"   "}',
      '{"outcome":"AUTO_FINISHED","extra":"nope"}',
    ]) {
      expect(() => parseMqttJsonPayload(invalidCoil, coilPayloadSchema)).toThrow();
    }
  });

  it('accepts every error_code defined in spec/error_codes.json across status, events, and coil contracts', () => {
    const entries = loadFaultRegistry();
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      const status = parseMqttJsonPayload(
        JSON.stringify({ state: 'ERROR', error_code: entry.error_code }),
        statusPayloadSchema,
      );
      expect(status.error_code).toBe(entry.error_code);

      const event = parseMqttJsonPayload(
        JSON.stringify({ event_type: 'ERROR', error_code: entry.error_code }),
        eventPayloadSchema,
      );
      expect(event.error_code).toBe(entry.error_code);

      const coil = parseMqttJsonPayload(
        JSON.stringify({ outcome: 'ABORTED', reason_code: entry.error_code, duration_sec: 15 }),
        coilPayloadSchema,
      );
      expect(coil.reason_code).toBe(entry.error_code);
    }
  });
});

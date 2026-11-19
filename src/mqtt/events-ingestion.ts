import type { Pool } from 'pg';
import {
  eventPayloadSchema,
  MQTT_TOPIC_PREFIX,
  parseMqttJsonPayload,
  parseWinderTopic,
  type EventPayload,
} from '../spec/mqtt-contract.js';
import type { MqttTransport } from './transport.js';
import type { TelemetryEventMetadata } from '../services/telemetry-events.js';

/**
 * Minimal logger interface compatible with Fastify's app.log and console.
 */
export interface EventsIngestionLogger {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const EVENTS_TOPIC_FILTER = `${MQTT_TOPIC_PREFIX}/+/events`;
const EPOCH_SECONDS_THRESHOLD = 1e9;
const EPOCH_MILLISECONDS_THRESHOLD = 1e12;
const ISO_DATE_STRING_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i;

function resolveEventTime(ts: EventPayload['ts']): Date | null {
  if (ts === undefined) {
    return new Date();
  }

  if (typeof ts === 'number') {
    if (ts < EPOCH_SECONDS_THRESHOLD) {
      return new Date();
    }
    const ms = ts < EPOCH_MILLISECONDS_THRESHOLD ? ts * 1000 : ts;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const trimmed = ts.trim();
  if (!ISO_DATE_STRING_REGEX.test(trimmed)) {
    return null;
  }

  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) {
    return null;
  }

  return new Date(parsedMs);
}

function buildPayloadMetadata(payload: EventPayload): TelemetryEventMetadata {
  const metadata: TelemetryEventMetadata = {};

  if (payload.reset_reason !== undefined) {
    metadata.reset_reason = payload.reset_reason;
  }
  if (payload.rssi !== undefined) {
    metadata.rssi = payload.rssi;
  }
  if (payload.free_heap !== undefined) {
    metadata.free_heap = payload.free_heap;
  }
  if (payload.subsystem !== undefined) {
    metadata.subsystem = payload.subsystem;
  }
  if (payload.message !== undefined) {
    metadata.message = payload.message;
  }
  if (payload.details !== undefined) {
    metadata.details = payload.details;
  }
  if (payload.ts !== undefined) {
    metadata.ts = payload.ts;
  }

  return metadata;
}

/**
 * Subscribe to `factory/winders/+/events` and persist validated diagnostic events into TimescaleDB.
 */
export async function registerEventsIngestion(
  mqtt: MqttTransport,
  db: Pool,
  log: EventsIngestionLogger = console,
): Promise<void> {
  await mqtt.subscribe(EVENTS_TOPIC_FILTER, async (topic, rawPayload) => {
    const parsedTopic = parseWinderTopic(topic);
    if (!parsedTopic || parsedTopic.channel !== 'events') {
      log.warn({ topic }, 'Ignoring message on invalid events topic');
      return;
    }

    let payload: EventPayload;
    try {
      payload = parseMqttJsonPayload(rawPayload, eventPayloadSchema);
    } catch (err) {
      log.warn(
        { topic, err: err instanceof Error ? err.message : String(err) },
        'Ignoring malformed or oversized MQTT event payload',
      );
      return;
    }

    const eventTime = resolveEventTime(payload.ts);
    if (!eventTime) {
      log.warn({ topic, ts: payload.ts }, 'Ignoring MQTT event with invalid timestamp');
      return;
    }

    const metadata = buildPayloadMetadata(payload);

    try {
      const insertResult = await db.query(
        `INSERT INTO telemetry_events (time, machine_id, event_type, error_code, payload_json)
         SELECT $1, id, $2, $3, $4::jsonb
         FROM machines
         WHERE id = $5`,
        [
          eventTime,
          payload.event_type,
          payload.error_code ?? null,
          JSON.stringify(metadata),
          parsedTopic.machineId,
        ],
      );

      if (insertResult.rowCount === 0) {
        log.warn(
          { machineId: parsedTopic.machineId, topic },
          'Ignoring MQTT event for unregistered machine',
        );
      }
    } catch (err) {
      log.error(
        {
          machineId: parsedTopic.machineId,
          topic,
          err: err instanceof Error ? err.message : String(err),
        },
        'Failed to persist MQTT diagnostic event',
      );
    }
  });
}

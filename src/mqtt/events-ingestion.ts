import type { Pool } from 'pg';
import type { TelemetryEventMetadata } from '../services/telemetry-events.js';
import { eventPayloadSchema, type EventPayload } from '../spec/mqtt-contract.js';
import {
  defaultMqttLogger,
  parseMqttTimestamp,
  subscribeWinderChannel,
  type MqttIngestionLogger,
} from './ingestion-helpers.js';
import type { MqttTransport } from './transport.js';

/**
 * Minimal logger interface compatible with Fastify's app.log and console.
 */
export type EventsIngestionLogger = MqttIngestionLogger;

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
  logger: EventsIngestionLogger = defaultMqttLogger,
): Promise<void> {
  await subscribeWinderChannel(
    mqtt,
    'events',
    eventPayloadSchema,
    logger,
    async ({ topic, machineId, payload }) => {
      const timestampResult = parseMqttTimestamp(payload.ts);
      if (!timestampResult.ok) {
        logger.warn(
          { topic, machineId, ts: payload.ts, reason: timestampResult.reason },
          'Ignoring MQTT event with invalid timestamp',
        );
        return;
      }

      const eventTime = timestampResult.date ?? new Date();
      const metadata = buildPayloadMetadata(payload);

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
          machineId,
        ],
      );

      if (insertResult.rowCount === 0) {
        logger.warn(
          { machineId, topic },
          'Ignoring MQTT event for unregistered machine',
        );
      }
    },
  );
}

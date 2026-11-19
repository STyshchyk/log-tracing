import type { Pool } from 'pg';
import { z } from 'zod';
import {
  coilPayloadSchema,
  MQTT_TOPIC_PREFIX,
  parseMqttJsonPayload,
  parseWinderTopic,
} from '../spec/mqtt-contract.js';
import type { MqttTransport } from './transport.js';

const EPOCH_SECONDS_MIN = 1e9;
const EPOCH_MILLISECONDS_MIN = 1e12;

const isoTimestampSchema = z.union([
  z.iso.datetime({ offset: true, local: true }),
  z.iso.date(),
]);

/**
 * Minimal structured logger interface compatible with Fastify's Pino logger.
 */
export interface CoilIngestionLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

const defaultLogger: CoilIngestionLogger = {
  warn(obj, msg) {
    console.warn(msg, obj);
  },
  error(obj, msg) {
    console.error(msg, obj);
  },
};

type ParsedTimestampResult =
  | { ok: true; createdAt: Date | null }
  | { ok: false; reason: string };

function parseCoilTimestamp(ts: string | number | undefined): ParsedTimestampResult {
  if (ts === undefined) {
    return { ok: true, createdAt: null };
  }

  if (typeof ts === 'number') {
    if (!Number.isFinite(ts) || ts < 0) {
      return { ok: false, reason: 'Numeric timestamp must be finite and non-negative' };
    }
    if (ts < EPOCH_SECONDS_MIN) {
      return { ok: true, createdAt: null };
    }
    const epochMs = ts < EPOCH_MILLISECONDS_MIN ? ts * 1000 : ts;
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, reason: 'Numeric timestamp is out of valid Date range' };
    }
    return { ok: true, createdAt: date };
  }

  const trimmed = ts.trim();
  const isoCheck = isoTimestampSchema.safeParse(trimmed.toUpperCase());
  if (!isoCheck.success) {
    return { ok: false, reason: 'String timestamp must be a valid ISO-8601 date or datetime' };
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, reason: 'ISO-8601 timestamp produced an invalid Date' };
  }

  return { ok: true, createdAt: date };
}

/**
 * Subscribe to `factory/winders/+/coil` on the MQTT transport and persist valid
 * `COMPLETED` / `ABORTED` coil outcomes for registered machines into `coil_outcomes`.
 */
export async function registerCoilIngestion(
  mqtt: MqttTransport,
  db: Pool,
  logger: CoilIngestionLogger = defaultLogger,
): Promise<void> {
  const topicFilter = `${MQTT_TOPIC_PREFIX}/+/coil`;

  await mqtt.subscribe(topicFilter, async (topic, payload) => {
    try {
      const parsedTopic = parseWinderTopic(topic);
      if (!parsedTopic || parsedTopic.channel !== 'coil') {
        logger.warn({ topic }, 'Ignoring message on invalid or non-coil winder topic');
        return;
      }

      let parsedPayload;
      try {
        parsedPayload = parseMqttJsonPayload(payload, coilPayloadSchema);
      } catch (err) {
        logger.warn(
          {
            topic,
            machineId: parsedTopic.machineId,
            err: err instanceof Error ? err.message : String(err),
          },
          'Ignoring invalid coil MQTT payload',
        );
        return;
      }

      const timestampResult = parseCoilTimestamp(parsedPayload.ts);
      if (!timestampResult.ok) {
        logger.warn(
          {
            topic,
            machineId: parsedTopic.machineId,
            ts: parsedPayload.ts,
            reason: timestampResult.reason,
          },
          'Ignoring coil MQTT payload with invalid timestamp',
        );
        return;
      }

      const insertResult = await db.query<{ id: string }>(
        `INSERT INTO coil_outcomes (machine_id, outcome, reason_code, duration_sec, created_at)
         SELECT m.id, $2::text, $3::text, $4::integer, COALESCE($5::timestamptz, NOW())
         FROM machines m
         WHERE m.id = $1::text
         RETURNING id`,
        [
          parsedTopic.machineId,
          parsedPayload.outcome,
          parsedPayload.reason_code ?? null,
          parsedPayload.duration_sec ?? null,
          timestampResult.createdAt,
        ],
      );

      if (insertResult.rowCount === 0) {
        logger.warn(
          { topic, machineId: parsedTopic.machineId },
          'Ignoring coil outcome for unregistered machine',
        );
      }
    } catch (err) {
      logger.error(
        {
          topic,
          err: err instanceof Error ? err.message : String(err),
        },
        'Unexpected error while ingesting coil outcome message',
      );
    }
  });
}

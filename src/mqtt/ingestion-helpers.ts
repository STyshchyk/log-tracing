import { z } from 'zod';
import {
  MQTT_TOPIC_PREFIX,
  parseMqttJsonPayload,
  parseWinderTopic,
  type MqttChannel,
} from '../spec/mqtt-contract.js';
import type { MqttTransport } from './transport.js';

const EPOCH_SECONDS_MIN = 1e9;
const EPOCH_MILLISECONDS_MIN = 1e12;

/**
 * Build a SQL `WITH` clause that resolves a machine row's physical `id` from an incoming MQTT
 * topic identifier, preferring an exact `hardware_id` match before falling back to `machines.id`.
 */
export function buildMatchedMachineCte(paramIndex: number): string {
  const param = `$${paramIndex}::text`;
  return `matched_machine AS (
  SELECT id
  FROM machines
  WHERE hardware_id = ${param} OR id = ${param}
  ORDER BY CASE WHEN hardware_id = ${param} THEN 0 ELSE 1 END
  LIMIT 1
)`;
}

const isoTimestampSchema = z.union([
  z.iso.datetime({ offset: true, local: true }),
  z.iso.date(),
]);

/**
 * Minimal structured logger interface compatible with Fastify's Pino logger (`app.log`).
 */
export interface MqttIngestionLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Fallback console-backed structured logger used when callers omit an explicit logger.
 */
export const defaultMqttLogger: MqttIngestionLogger = {
  warn(obj, msg) {
    console.warn(msg, obj);
  },
  error(obj, msg) {
    console.error(msg, obj);
  },
};

/**
 * Result of parsing an optional firmware MQTT `ts` field.
 * A `null` date indicates `ts` was omitted or is a monotonic uptime counter (`< 1e9`).
 */
export type ParsedMqttTimestampResult =
  | { ok: true; date: Date | null }
  | { ok: false; reason: string };

/**
 * Parse an optional MQTT `ts` field supporting strict ISO-8601 strings, epoch seconds (`>= 1e9`),
 * epoch milliseconds (`>= 1e12`), and monotonic uptime numbers (`0 <= ts < 1e9` -> `null`).
 */
export function parseMqttTimestamp(ts: string | number | undefined): ParsedMqttTimestampResult {
  if (ts === undefined) {
    return { ok: true, date: null };
  }

  if (typeof ts === 'number') {
    if (!Number.isFinite(ts) || ts < 0) {
      return { ok: false, reason: 'Numeric timestamp must be finite and non-negative' };
    }
    if (ts < EPOCH_SECONDS_MIN) {
      return { ok: true, date: null };
    }
    const epochMs = ts < EPOCH_MILLISECONDS_MIN ? ts * 1000 : ts;
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, reason: 'Numeric timestamp is out of valid Date range' };
    }
    return { ok: true, date };
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

  return { ok: true, date };
}

/**
 * Validated MQTT topic metadata and parsed payload passed to channel ingestion handlers.
 */
export interface ParsedChannelMessage<TPayload> {
  topic: string;
  machineId: string;
  payload: TPayload;
}

/**
 * Subscribe to a winder MQTT channel (`factory/winders/+/{channel}`) with shared topic validation,
 * payload size/JSON/Zod validation, warning logs for rejected messages, and error isolation.
 */
export async function subscribeWinderChannel<TSchema extends z.ZodType>(
  mqtt: MqttTransport,
  channel: MqttChannel,
  schema: TSchema,
  logger: MqttIngestionLogger,
  onMessage: (message: ParsedChannelMessage<z.infer<TSchema>>) => Promise<void>,
): Promise<void> {
  const topicFilter = `${MQTT_TOPIC_PREFIX}/+/${channel}`;

  await mqtt.subscribe(topicFilter, async (topic, rawPayload) => {
    try {
      const parsedTopic = parseWinderTopic(topic);
      if (!parsedTopic || parsedTopic.channel !== channel) {
        logger.warn(
          { topic, expectedChannel: channel },
          `Ignoring MQTT ${channel} message with invalid winder topic`,
        );
        return;
      }

      let payload: z.infer<TSchema>;
      try {
        payload = parseMqttJsonPayload(rawPayload, schema);
      } catch (err) {
        logger.warn(
          {
            topic,
            machineId: parsedTopic.machineId,
            byteLength: rawPayload.byteLength,
            reason: err instanceof Error ? err.message : String(err),
          },
          `Ignoring invalid MQTT ${channel} payload`,
        );
        return;
      }

      try {
        await onMessage({
          topic,
          machineId: parsedTopic.machineId,
          payload,
        });
      } catch (err) {
        logger.error(
          {
            topic,
            machineId: parsedTopic.machineId,
            error: err instanceof Error ? err.message : String(err),
          },
          `Failed to persist MQTT ${channel} message`,
        );
      }
    } catch (err) {
      logger.error(
        {
          topic,
          error: err instanceof Error ? err.message : String(err),
        },
        `Unexpected error while processing MQTT ${channel} message`,
      );
    }
  });
}

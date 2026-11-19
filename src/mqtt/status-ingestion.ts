import type { Pool } from 'pg';
import {
  MQTT_TOPIC_PREFIX,
  parseMqttJsonPayload,
  parseWinderTopic,
  statusPayloadSchema,
  type StatusPayload,
} from '../spec/mqtt-contract.js';
import type { MqttTransport } from './transport.js';

/**
 * Minimal logger interface compatible with Fastify's Pino logger (`app.log`).
 */
export interface StatusIngestionLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

const STATUS_TOPIC_FILTER = `${MQTT_TOPIC_PREFIX}/+/status`;

function resolveActiveErrorUpdate(payload: StatusPayload): {
  shouldUpdate: boolean;
  value: string | null;
} {
  if (payload.state === 'WORKING' || payload.state === 'IDLE') {
    return { shouldUpdate: true, value: null };
  }
  if (payload.state === 'ERROR') {
    return { shouldUpdate: true, value: payload.error_code ?? null };
  }
  return {
    shouldUpdate: payload.error_code !== undefined,
    value: payload.error_code ?? null,
  };
}

/**
 * Subscribe to `factory/winders/+/status` and persist validated machine operational states.
 */
export async function registerStatusIngestion(
  mqtt: MqttTransport,
  db: Pool,
  logger?: StatusIngestionLogger,
): Promise<void> {
  await mqtt.subscribe(STATUS_TOPIC_FILTER, async (topic, rawPayload) => {
    const parsedTopic = parseWinderTopic(topic);
    if (!parsedTopic || parsedTopic.channel !== 'status') {
      logger?.warn({ topic }, 'Ignoring status message with invalid winder topic');
      return;
    }

    let payload;
    try {
      payload = parseMqttJsonPayload(rawPayload, statusPayloadSchema);
    } catch (err) {
      logger?.warn(
        {
          topic,
          machineId: parsedTopic.machineId,
          byteLength: rawPayload.byteLength,
          reason: err instanceof Error ? err.message : String(err),
        },
        'Ignoring invalid MQTT status payload',
      );
      return;
    }

    const activeErrorUpdate = resolveActiveErrorUpdate(payload);

    try {
      const result = await db.query(
        `UPDATE machines
         SET current_state = $2,
             active_error = CASE WHEN $3::boolean THEN $4::text ELSE active_error END,
             last_seen_at = NOW()
         WHERE id = $1`,
        [
          parsedTopic.machineId,
          payload.state,
          activeErrorUpdate.shouldUpdate,
          activeErrorUpdate.value,
        ],
      );

      if (result.rowCount === 0) {
        logger?.warn(
          { topic, machineId: parsedTopic.machineId, state: payload.state },
          'Ignoring MQTT status message for unregistered machine',
        );
      }
    } catch (err) {
      logger?.error(
        {
          topic,
          machineId: parsedTopic.machineId,
          error: err instanceof Error ? err.message : String(err),
        },
        'Failed to persist MQTT machine status update',
      );
    }
  });
}

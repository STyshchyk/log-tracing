import type { Pool } from 'pg';
import { statusPayloadSchema, type StatusPayload } from '../spec/mqtt-contract.js';
import {
  defaultMqttLogger,
  subscribeWinderChannel,
  type MqttIngestionLogger,
} from './ingestion-helpers.js';
import type { MqttTransport } from './transport.js';

/**
 * Minimal logger interface compatible with Fastify's Pino logger (`app.log`).
 */
export type StatusIngestionLogger = MqttIngestionLogger;

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
  logger: StatusIngestionLogger = defaultMqttLogger,
): Promise<void> {
  await subscribeWinderChannel(
    mqtt,
    'status',
    statusPayloadSchema,
    logger,
    async ({ topic, machineId, payload }) => {
      const activeErrorUpdate = resolveActiveErrorUpdate(payload);
      const result = await db.query(
        `UPDATE machines
         SET current_state = $2,
             active_error = CASE WHEN $3::boolean THEN $4::text ELSE active_error END,
             last_seen_at = NOW()
         WHERE id = $1`,
        [
          machineId,
          payload.state,
          activeErrorUpdate.shouldUpdate,
          activeErrorUpdate.value,
        ],
      );

      if (result.rowCount === 0) {
        logger.warn(
          { topic, machineId, state: payload.state },
          'Ignoring MQTT status message for unregistered machine',
        );
      }
    },
  );
}

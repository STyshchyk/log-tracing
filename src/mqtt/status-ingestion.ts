import type { Pool } from 'pg';
import { dispatchPendingUpdatesForMachine } from '../services/pending-updates.js';
import { statusPayloadSchema, type StatusPayload } from '../spec/mqtt-contract.js';
import {
  buildMatchedMachineCte,
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
      const result = await db.query<{ id: string }>(
        `WITH ${buildMatchedMachineCte(1)}
         UPDATE machines AS m
         SET current_state = $2,
             active_error = CASE WHEN $3::boolean THEN $4::text ELSE m.active_error END,
             fw_version = CASE WHEN $5::boolean THEN $6::text ELSE m.fw_version END,
             preset_version = CASE WHEN $7::boolean THEN $8::text ELSE m.preset_version END,
             preset_name = CASE WHEN $9::boolean THEN $10::text ELSE m.preset_name END,
             last_seen_at = NOW()
         FROM matched_machine
         WHERE m.id = matched_machine.id
         RETURNING m.id`,
        [
          machineId,
          payload.state,
          activeErrorUpdate.shouldUpdate,
          activeErrorUpdate.value,
          payload.fw_version !== undefined,
          payload.fw_version ?? null,
          payload.preset_version !== undefined,
          payload.preset_version ?? null,
          payload.preset_name !== undefined,
          payload.preset_name ?? null,
        ],
      );

      const resolvedMachineId = result.rows[0]?.id;
      if (!resolvedMachineId) {
        logger.warn(
          { topic, machineId, state: payload.state },
          'Ignoring MQTT status message for unregistered machine',
        );
        return;
      }

      if (payload.state === 'IDLE') {
        await dispatchPendingUpdatesForMachine(db, mqtt, resolvedMachineId);
      }
    },
  );
}

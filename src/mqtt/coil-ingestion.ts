import type { Pool } from 'pg';
import { coilPayloadSchema } from '../spec/mqtt-contract.js';
import {
  defaultMqttLogger,
  parseMqttTimestamp,
  subscribeWinderChannel,
  type MqttIngestionLogger,
} from './ingestion-helpers.js';
import type { MqttTransport } from './transport.js';

/**
 * Minimal structured logger interface compatible with Fastify's Pino logger.
 */
export type CoilIngestionLogger = MqttIngestionLogger;

/**
 * Subscribe to `factory/winders/+/coil` on the MQTT transport and persist valid
 * `COMPLETED` / `ABORTED` coil outcomes for registered machines into `coil_outcomes`.
 */
export async function registerCoilIngestion(
  mqtt: MqttTransport,
  db: Pool,
  logger: CoilIngestionLogger = defaultMqttLogger,
): Promise<void> {
  await subscribeWinderChannel(
    mqtt,
    'coil',
    coilPayloadSchema,
    logger,
    async ({ topic, machineId, payload }) => {
      const timestampResult = parseMqttTimestamp(payload.ts);
      if (!timestampResult.ok) {
        logger.warn(
          {
            topic,
            machineId,
            ts: payload.ts,
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
          machineId,
          payload.outcome,
          payload.reason_code ?? null,
          payload.duration_sec ?? null,
          timestampResult.date,
        ],
      );

      if (insertResult.rowCount === 0) {
        logger.warn(
          { topic, machineId },
          'Ignoring coil outcome for unregistered machine',
        );
      }
    },
  );
}

import type { Pool } from 'pg';
import { coilPayloadSchema } from '../spec/mqtt-contract.js';
import {
  buildMatchedMachineCte,
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
 * ESP32 internal cycle outcomes (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`)
 * and optional `wound_length` for registered machines into `coil_outcomes`.
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
        `WITH ${buildMatchedMachineCte(1)}
         INSERT INTO coil_outcomes (machine_id, outcome, reason_code, duration_sec, wound_length, created_at)
         SELECT matched_machine.id, $2::text, $3::text, $4::integer, $5::double precision, COALESCE($6::timestamptz, NOW())
         FROM matched_machine
         RETURNING id`,
        [
          machineId,
          payload.outcome,
          payload.reason_code ?? null,
          payload.duration_sec ?? null,
          payload.wound_length ?? null,
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

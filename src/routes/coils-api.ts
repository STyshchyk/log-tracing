import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  getMachineCoilRollups,
  getRoomCoilRollups,
} from '../services/coil-rollups.js';
import {
  coilRollupBucketResponseSchema,
  machineNotFoundResponseSchema,
  sendMachineNotFound,
} from './api-schemas.js';

interface MachineParams {
  machineId: string;
}

/**
 * Register HTTP JSON endpoints for per-machine and room-wide ESP32 winding cycle rollups.
 */
export function registerCoilsApi(app: FastifyInstance, db: Pool): void {
  app.get<{ Params: MachineParams }>(
    '/api/machines/:machineId/coils/rollups',
    {
      schema: {
        description:
          'Get ESP32 winding cycle telemetry rollups (AUTO_FINISHED, ABORTED, FAULT_TERMINATED, total_wound_length) across TODAY, WEEK, MONTH, and ALL_TIME for a registered machine',
        params: {
          type: 'object',
          required: ['machineId'],
          properties: {
            machineId: {
              type: 'string',
              description: 'Registered winding machine ID',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['machine_id', 'rollups'],
            properties: {
              machine_id: { type: 'string' },
              rollups: {
                type: 'array',
                items: coilRollupBucketResponseSchema,
              },
            },
          },
          404: machineNotFoundResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await getMachineCoilRollups(db, request.params.machineId);
      if (result === null) {
        return sendMachineNotFound(reply, request.params.machineId);
      }

      return reply.send(result);
    },
  );

  app.get(
    '/api/coils/rollups',
    {
      schema: {
        description:
          'Get room-wide ESP32 winding cycle telemetry rollups (AUTO_FINISHED, ABORTED, FAULT_TERMINATED, total_wound_length) across TODAY, WEEK, MONTH, and ALL_TIME windows',
        response: {
          200: {
            type: 'object',
            required: ['rollups'],
            properties: {
              rollups: {
                type: 'array',
                items: coilRollupBucketResponseSchema,
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const result = await getRoomCoilRollups(db);
      return reply.send(result);
    },
  );
}

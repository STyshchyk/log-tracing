import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  COIL_ROLLUP_WINDOWS,
  getMachineCoilRollups,
  getRoomCoilRollups,
} from '../services/coil-rollups.js';

interface MachineParams {
  machineId: string;
}

const rollupBucketSchema = {
  type: 'object',
  required: ['window', 'completed_count', 'aborted_count', 'total_count'],
  properties: {
    window: { type: 'string', enum: [...COIL_ROLLUP_WINDOWS] },
    completed_count: { type: 'integer', minimum: 0 },
    aborted_count: { type: 'integer', minimum: 0 },
    total_count: { type: 'integer', minimum: 0 },
  },
} as const;

/**
 * Register HTTP JSON endpoints for per-machine and room-wide coil outcome rollups.
 */
export function registerCoilsApi(app: FastifyInstance, db: Pool): void {
  app.get<{ Params: MachineParams }>(
    '/api/machines/:machineId/coils/rollups',
    {
      schema: {
        description:
          'Get coil outcome rollup counts across TODAY, WEEK, MONTH, and ALL_TIME for a registered machine',
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
                items: rollupBucketSchema,
              },
            },
          },
          404: {
            type: 'object',
            required: ['error', 'machineId'],
            properties: {
              error: { type: 'string' },
              machineId: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await getMachineCoilRollups(db, request.params.machineId);
      if (result === null) {
        return reply.status(404).send({
          error: 'Machine not found',
          machineId: request.params.machineId.trim(),
        });
      }

      return reply.send(result);
    },
  );

  app.get(
    '/api/coils/rollups',
    {
      schema: {
        description:
          'Get room-wide coil outcome rollup counts across TODAY, WEEK, MONTH, and ALL_TIME windows',
        response: {
          200: {
            type: 'object',
            required: ['rollups'],
            properties: {
              rollups: {
                type: 'array',
                items: rollupBucketSchema,
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

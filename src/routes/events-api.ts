import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { listRecentEvents } from '../services/telemetry-events.js';
import {
  machineNotFoundResponseSchema,
  sendMachineNotFound,
  telemetryEventResponseSchema,
} from './api-schemas.js';

interface MachineEventsParams {
  machineId: string;
}

interface MachineEventsQuerystring {
  limit?: number;
  errorsOnly?: boolean;
}

/**
 * Register the HTTP JSON recent telemetry events query endpoint on the Fastify instance.
 */
export function registerEventsApi(app: FastifyInstance, db: Pool): void {
  app.get<{ Params: MachineEventsParams; Querystring: MachineEventsQuerystring }>(
    '/api/machines/:machineId/events',
    {
      schema: {
        description: 'List recent telemetry and diagnostic events for a registered winding machine',
        params: {
          type: 'object',
          required: ['machineId'],
          properties: {
            machineId: {
              type: 'string',
              minLength: 1,
              description: 'Registered winding machine ID',
            },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 20,
              description: 'Maximum number of recent events to return (1..100, default 20)',
            },
            errorsOnly: {
              type: 'boolean',
              default: false,
              description: 'When true, return only error/fault events',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['machine_id', 'events'],
            properties: {
              machine_id: { type: 'string' },
              events: {
                type: 'array',
                items: telemetryEventResponseSchema,
              },
            },
          },
          404: machineNotFoundResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const machineId = request.params.machineId.trim();
      const events = await listRecentEvents(db, {
        machineId,
        limit: request.query.limit,
        errorsOnly: request.query.errorsOnly,
      });

      if (events === null) {
        return sendMachineNotFound(reply, machineId);
      }

      return reply.send({
        machine_id: machineId,
        events,
      });
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { getMachineById } from '../services/machines.js';
import {
  machineNotFoundResponseSchema,
  machineRecordResponseSchema,
  sendMachineNotFound,
} from './api-schemas.js';

interface MachineParams {
  machineId: string;
}

/**
 * Register the HTTP JSON machine status lookup endpoint on the Fastify instance.
 */
export function registerMachinesApi(app: FastifyInstance, db: Pool): void {
  app.get<{ Params: MachineParams }>(
    '/api/machines/:machineId',
    {
      schema: {
        description:
          'Fetch a registered winding machine metadata, live operational state, active error_code, firmware/preset versions, and last_seen_at timestamp',
        params: {
          type: 'object',
          required: ['machineId'],
          properties: {
            machineId: {
              type: 'string',
              description: 'Registered machine ID (e.g. W-01)',
            },
          },
        },
        response: {
          200: machineRecordResponseSchema,
          404: machineNotFoundResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const machineId = request.params.machineId.trim();
      const machine = await getMachineById(db, machineId);

      if (machine === null) {
        return sendMachineNotFound(reply, machineId);
      }

      return reply.send(machine);
    },
  );
}

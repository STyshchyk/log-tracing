import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { getMachineById } from '../services/machines.js';
import { FLOOR_ZONES, MACHINE_STATES } from '../spec/mqtt-contract.js';

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
          'Fetch a registered winding machine metadata, live operational state, active error_code, and last_seen_at timestamp',
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
          200: {
            type: 'object',
            required: [
              'id',
              'display_name',
              'zone',
              'grid_row',
              'grid_col',
              'current_state',
              'active_error',
              'last_seen_at',
            ],
            properties: {
              id: { type: 'string' },
              display_name: { type: 'string' },
              zone: { type: 'string', enum: [...FLOOR_ZONES] },
              grid_row: { type: 'integer' },
              grid_col: { type: 'integer' },
              current_state: { type: 'string', enum: [...MACHINE_STATES] },
              active_error: { type: 'string', nullable: true },
              last_seen_at: { type: 'string', format: 'date-time', nullable: true },
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
      const machineId = request.params.machineId.trim();
      const machine = await getMachineById(db, machineId);

      if (machine === null) {
        return reply.status(404).send({
          error: 'Machine not found',
          machineId,
        });
      }

      return reply.send(machine);
    },
  );
}

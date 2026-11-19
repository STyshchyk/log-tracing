import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { queryGlossary } from '../services/glossary.js';

interface GlossaryQuerystring {
  q?: string;
  machineId?: string;
}

/**
 * Register the HTTP JSON glossary search and lookup endpoint on the Fastify instance.
 */
export function registerGlossaryApi(app: FastifyInstance, db: Pool): void {
  app.get<{ Querystring: GlossaryQuerystring }>(
    '/api/glossary',
    {
      schema: {
        description:
          'Search plain-English fault glossary entries and optionally pin a machine active error_code first',
        querystring: {
          type: 'object',
          properties: {
            q: {
              type: 'string',
              description:
                'Case-insensitive search term matched across error_code, title, symptoms, and fix_steps_md',
            },
            machineId: {
              type: 'string',
              description:
                'Registered machine ID whose active_error is pinned first in the returned entries',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['active_error', 'entries'],
            properties: {
              active_error: { type: 'string', nullable: true },
              entries: {
                type: 'array',
                items: {
                  type: 'object',
                  required: [
                    'error_code',
                    'title',
                    'symptoms',
                    'fix_steps_md',
                    'updated_at',
                    'is_active',
                  ],
                  properties: {
                    error_code: { type: 'string' },
                    title: { type: 'string' },
                    symptoms: { type: 'string' },
                    fix_steps_md: { type: 'string' },
                    updated_at: { type: 'string', format: 'date-time' },
                    is_active: { type: 'boolean' },
                  },
                },
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
      const result = await queryGlossary(db, {
        q: request.query.q,
        machineId: request.query.machineId,
      });

      if (result === null) {
        return reply.status(404).send({
          error: 'Machine not found',
          machineId: request.query.machineId?.trim() ?? '',
        });
      }

      return reply.send(result);
    },
  );
}

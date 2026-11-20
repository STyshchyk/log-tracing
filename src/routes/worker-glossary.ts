import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { queryGlossary } from '../services/glossary.js';
import { getMachineById } from '../services/machines.js';
import { renderUnknownMachinePage } from '../ui/portal-layout.js';
import { renderGlossaryPage } from '../ui/worker-glossary-view.js';

interface MachineParams {
  machineId: string;
}

interface GlossaryQuery {
  q?: string | string[];
}

function normalizeQueryParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return (value[0] ?? '').trim();
  }
  return '';
}

/**
 * Register the mobile-first Worker Portal Glossary / FAQ HTML route on the Fastify instance.
 */
export function registerWorkerGlossary(app: FastifyInstance, db: Pool): void {
  app.get<{ Params: MachineParams; Querystring: GlossaryQuery }>(
    '/m/:machineId/glossary',
    {
      schema: {
        hide: true,
      },
    },
    async (request, reply) => {
      const rawMachineId = request.params.machineId;
      const machine = await getMachineById(db, rawMachineId);

      reply.type('text/html; charset=utf-8');
      if (machine === null) {
        return reply.status(404).send(renderUnknownMachinePage(rawMachineId));
      }

      const query = normalizeQueryParam(request.query.q);
      const glossary = await queryGlossary(db, {
        machineId: machine.id,
        q: query || undefined,
      });
      if (glossary === null) {
        return reply.status(404).send(renderUnknownMachinePage(rawMachineId));
      }

      const pinnedEntry = glossary.entries.find((entry) => entry.is_active) ?? null;
      let isActiveInGlossary = pinnedEntry !== null;
      if (glossary.active_error && !pinnedEntry && query) {
        const activeLookup = await queryGlossary(db, {
          machineId: machine.id,
          q: glossary.active_error,
        });
        isActiveInGlossary = activeLookup?.entries.some((entry) => entry.is_active) ?? false;
      }

      return reply.send(
        renderGlossaryPage(
          machine,
          glossary.active_error,
          glossary.entries,
          query,
          isActiveInGlossary,
        ),
      );
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  createBugReport,
  isValidBugReportTag,
} from '../services/bug-reports.js';
import { getMachineById } from '../services/machines.js';
import { renderUnknownMachinePage } from '../ui/portal-layout.js';
import {
  renderBugReportConfirmationPage,
  renderBugReportFormPage,
  type BugReportFormState,
} from '../ui/worker-bug-report-view.js';

export {
  renderBugReportConfirmationPage,
  renderBugReportFormPage,
  type BugReportFormState,
};

interface MachineParams {
  machineId: string;
}

function extractBodyRecord(body: unknown): Record<string, unknown> {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

/**
 * Register the Worker Portal Report-a-Bug HTML routes on the Fastify instance.
 */
export function registerWorkerBugReport(app: FastifyInstance, db: Pool): void {
  app.get<{ Params: MachineParams }>(
    '/m/:machineId/report-bug',
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

      return reply.send(renderBugReportFormPage(machine));
    },
  );

  app.post<{ Params: MachineParams }>(
    '/m/:machineId/report-bug',
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

      const body = extractBodyRecord(request.body);
      const rawTag = body.tag;
      const rawNote = body.worker_note;
      const preservedNote = typeof rawNote === 'string' ? rawNote : '';
      const hasValidTag = isValidBugReportTag(rawTag);
      const hasValidNote =
        rawNote === undefined || rawNote === null || typeof rawNote === 'string';

      if (!hasValidTag || !hasValidNote) {
        return reply.status(400).send(
          renderBugReportFormPage(machine, {
            selectedTag: hasValidTag ? rawTag : undefined,
            workerNote: preservedNote,
            tagError: hasValidTag
              ? undefined
              : 'Please choose what happened before submitting.',
            noteError: hasValidNote ? undefined : 'Note must be plain text.',
          }),
        );
      }

      const created = await createBugReport(db, {
        machineId: machine.id,
        tag: rawTag,
        workerNote: rawNote ?? null,
      });

      if (created === null) {
        return reply.status(404).send(renderUnknownMachinePage(rawMachineId));
      }

      return reply.status(201).send(renderBugReportConfirmationPage(machine, created));
    },
  );
}

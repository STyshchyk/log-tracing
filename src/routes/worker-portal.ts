import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { getMachineById, listMachines, type MachineRecord } from '../services/machines.js';
import {
  escapeHtml,
  renderErrorCodeBadge,
  renderPortalLayout,
  renderStatusBadge,
  renderUnknownMachinePage,
} from '../ui/portal-layout.js';

interface MachineParams {
  machineId: string;
}

function formatTimestampUtc(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/**
 * Render the Worker Portal landing HTML for a registered machine, with an optional bottom slot
 * for Ticket 07's inline recent errors feed.
 */
export function renderMachineLandingPage(
  machine: MachineRecord,
  recentErrorsHtml = '',
): string {
  const encodedId = encodeURIComponent(machine.id);
  const activeErrorHtml = machine.active_error
    ? renderErrorCodeBadge(machine.active_error)
    : '';

  const lastSeenHtml = machine.last_seen_at
    ? `<p class="last-seen">Last seen: <time datetime="${escapeHtml(machine.last_seen_at)}">${escapeHtml(formatTimestampUtc(machine.last_seen_at))}</time></p>`
    : '<p class="last-seen">Last seen: Not yet reported</p>';

  const glossaryHint = machine.active_error
    ? `Fix steps for ${machine.active_error} and fault guide`
    : 'Plain-English troubleshooting steps and fault codes';

  const bodyHtml = `
    <section class="card">
      <h1>${escapeHtml(machine.display_name)}</h1>
      <p class="machine-meta">Machine ID: <code>${escapeHtml(machine.id)}</code></p>
      <div class="status-row">
        ${renderStatusBadge(machine.current_state)}
      </div>
      ${activeErrorHtml}
      ${lastSeenHtml}
    </section>

    <nav class="action-grid" aria-label="Machine actions">
      <a class="action-card action-primary" href="/m/${encodedId}/report-bug">
        <span class="action-title"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Report a Bug</span></span>
        <span class="action-hint">1-tap quick tags with automatic diagnostics</span>
      </a>
      <a class="action-card action-secondary" href="/m/${encodedId}/glossary">
        <span class="action-title"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg><span>Glossary / FAQ</span></span>
        <span class="action-hint">${escapeHtml(glossaryHint)}</span>
      </a>
    </nav>

    ${recentErrorsHtml}
  `;

  return renderPortalLayout({
    title: `${machine.display_name} (${machine.id}) | Winding Room Portal`,
    bodyHtml,
    backHref: '/',
    backLabel: 'All Machines',
  });
}

/**
 * Render the Worker Portal registered machine directory and recovery screen for GET /.
 */
export function renderMachineDirectoryPage(machines: MachineRecord[]): string {
  const listHtml =
    machines.length === 0
      ? `<div class="card"><p>No winding machines are registered yet.</p><p>Once pilot machines are registered, tap a machine here or scan its QR sticker.</p></div>`
      : `<ul class="machine-list" role="list">${machines
          .map((machine) => {
            const encodedId = encodeURIComponent(machine.id);
            const activeErrorHtml = machine.active_error
              ? renderErrorCodeBadge(machine.active_error)
              : '';

            return `<li>
              <a class="machine-card-link" href="/m/${encodedId}">
                <div class="machine-card-top">
                  <span class="machine-name">${escapeHtml(machine.display_name)}</span>
                  ${renderStatusBadge(machine.current_state)}
                </div>
                <span class="machine-meta">ID: <code>${escapeHtml(machine.id)}</code></span>
                ${activeErrorHtml}
              </a>
            </li>`;
          })
          .join('')}</ul>`;

  const bodyHtml = `
    <section>
      <h1>Winding Room Machines</h1>
      <p>Select your machine below or scan its Help/Report QR sticker to open its portal.</p>
      ${listHtml}
    </section>
  `;

  return renderPortalLayout({
    title: 'Winding Room Machines | Worker Portal',
    bodyHtml,
  });
}

/**
 * Register the mobile-first Worker Portal HTML routes on the Fastify instance.
 */
export function registerWorkerPortal(app: FastifyInstance, db: Pool): void {
  app.get(
    '/',
    {
      schema: {
        hide: true,
      },
    },
    async (_request, reply) => {
      const machines = await listMachines(db);
      reply.type('text/html; charset=utf-8');
      return reply.send(renderMachineDirectoryPage(machines));
    },
  );

  app.get(
    '/m',
    {
      schema: {
        hide: true,
      },
    },
    async (_request, reply) => {
      reply.type('text/html; charset=utf-8');
      return reply.status(404).send(renderUnknownMachinePage(''));
    },
  );

  app.get<{ Params: MachineParams }>(
    '/m/:machineId',
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

      return reply.send(renderMachineLandingPage(machine));
    },
  );
}

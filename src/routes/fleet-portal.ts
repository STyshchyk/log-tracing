import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { getFleetSummary, listFleetHistory, listFleetMachines } from '../services/fleet.js';
import { queryGlossary } from '../services/glossary.js';
import { renderFleetDashboardPage } from '../ui/fleet-layout.js';

const MANIFEST_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0f4c81"/><path d="M14 14h36v12H26v24H14z" fill="#ffffff"/></svg>';

const FLEET_MANIFEST = {
  name: 'Winding Room Fleet',
  short_name: 'Fleet',
  description: 'Department Heads PWA for factory winding room fleet diagnostics and live floor status.',
  start_url: '/fleet',
  scope: '/fleet',
  display: 'standalone',
  background_color: '#f4f6f8',
  theme_color: '#0f4c81',
  icons: [
    {
      src: `data:image/svg+xml,${encodeURIComponent(MANIFEST_ICON_SVG)}`,
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    },
  ],
} as const;

/**
 * Register the authenticated Department Heads `/fleet` PWA routes and web manifest.
 */
export function registerFleetPortal(app: FastifyInstance, db: Pool): void {
  const handleFleetDashboard = async (request: FastifyRequest, reply: FastifyReply) => {
    const [summary, machines, history, glossaryResult] = await Promise.all([
      getFleetSummary(db),
      listFleetMachines(db),
      listFleetHistory(db, { limit: 50 }),
      queryGlossary(db, {}),
    ]);

    const html = renderFleetDashboardPage({
      user: request.fleetUser ?? {
        email: 'lan-operator@local',
        sub: 'local-lan',
        source: 'local-lan',
      },
      summary,
      machines,
      history,
      glossary: glossaryResult?.entries ?? [],
    });

    return reply.type('text/html; charset=utf-8').send(html);
  };

  app.get('/fleet', { schema: { hide: true } }, handleFleetDashboard);
  app.get('/fleet/', { schema: { hide: true } }, handleFleetDashboard);

  app.get(
    '/fleet/manifest.webmanifest',
    {
      schema: {
        hide: true,
      },
    },
    async (_request, reply) => {
      return reply.type('application/manifest+json; charset=utf-8').send(FLEET_MANIFEST);
    },
  );
}

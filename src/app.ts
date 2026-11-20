import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import {
  createFleetAuthPreHandler,
  loadCloudflareAccessConfigFromEnv,
  type CloudflareAccessConfig,
} from './auth/cloudflare-access.js';
import { seedGlossary } from './db/seed-glossary.js';
import { registerCoilIngestion } from './mqtt/coil-ingestion.js';
import { registerEventsIngestion } from './mqtt/events-ingestion.js';
import { registerStatusIngestion } from './mqtt/status-ingestion.js';
import type { MqttTransport } from './mqtt/transport.js';
import { registerBugReportsApi } from './routes/bug-reports-api.js';
import { registerCoilsApi } from './routes/coils-api.js';
import { registerEventsApi } from './routes/events-api.js';
import {
  registerFirmwareDownloadApi,
  registerFleetFirmwareApi,
} from './routes/firmware-api.js';
import { registerFleetApi } from './routes/fleet-api.js';
import { registerFleetPortal } from './routes/fleet-portal.js';
import { registerGlossaryApi } from './routes/glossary-api.js';
import { registerMachinesApi } from './routes/machines-api.js';
import { registerFleetPresetsApi } from './routes/presets-api.js';
import { registerFleetUpdatesApi } from './routes/updates-api.js';
import { registerWorkerBugReport } from './routes/worker-bug-report.js';
import { registerWorkerGlossary } from './routes/worker-glossary.js';
import { registerWorkerPortal } from './routes/worker-portal.js';
import { MAX_FIRMWARE_BYTES, resolveFirmwareStorageDir } from './services/firmware.js';

/**
 * Top-level runtime dependencies injected at the application seam.
 */
export interface AppDeps {
  db: Pool;
  mqtt: MqttTransport;
  logger?: boolean | FastifyServerOptions['logger'];
  fleetAuth?: CloudflareAccessConfig;
  firmwareDir?: string;
  otaBaseUrl?: string;
}

/**
 * Build the Fastify application wired to PostgreSQL/TimescaleDB and MQTT transport.
 */
export async function createApp(deps: AppDeps): Promise<FastifyInstance> {
  await seedGlossary(deps.db);

  const firmwareDir = resolveFirmwareStorageDir(deps.firmwareDir);
  const app = Fastify({ logger: deps.logger ?? true });

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        const raw = typeof body === 'string' ? body : body.toString('utf8');
        const params = new URLSearchParams(raw);
        const parsed: Record<string, string> = {};
        for (const [key, value] of params.entries()) {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
          }
          parsed[key] = value;
        }
        done(null, parsed);
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)), undefined);
      }
    },
  );

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_FIRMWARE_BYTES },
    (_request, body, done) => {
      done(null, Buffer.isBuffer(body) ? body : Buffer.from(body));
    },
  );

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Factory Winding Room Telemetry API',
        version: '0.1.0',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  app.get(
    '/health',
    {
      schema: {
        description: 'Verify application and PostgreSQL/TimescaleDB connectivity',
        response: {
          200: {
            type: 'object',
            required: ['status', 'database'],
            properties: {
              status: { type: 'string', enum: ['ok'] },
              database: { type: 'string', enum: ['connected'] },
            },
          },
          503: {
            type: 'object',
            required: ['status', 'database'],
            properties: {
              status: { type: 'string', enum: ['error'] },
              database: { type: 'string', enum: ['disconnected'] },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        await deps.db.query('SELECT 1');
        return { status: 'ok', database: 'connected' };
      } catch {
        return reply.status(503).send({ status: 'error', database: 'disconnected' });
      }
    },
  );

  await registerEventsIngestion(deps.mqtt, deps.db, app.log);
  await registerStatusIngestion(deps.mqtt, deps.db, app.log);
  await registerCoilIngestion(deps.mqtt, deps.db, app.log);

  registerGlossaryApi(app, deps.db);
  registerMachinesApi(app, deps.db);
  registerEventsApi(app, deps.db);
  registerBugReportsApi(app, deps.db);
  registerCoilsApi(app, deps.db);
  registerFirmwareDownloadApi(app, deps.db, firmwareDir);
  registerWorkerPortal(app, deps.db);
  registerWorkerGlossary(app, deps.db);
  registerWorkerBugReport(app, deps.db);

  const fleetAuthConfig = deps.fleetAuth ?? loadCloudflareAccessConfigFromEnv();
  await app.register(async (fleetScope) => {
    fleetScope.addHook('preHandler', createFleetAuthPreHandler(fleetAuthConfig));
    registerFleetApi(fleetScope, deps.db);
    registerFleetFirmwareApi(fleetScope, deps.db, firmwareDir);
    registerFleetUpdatesApi(fleetScope, deps.db, deps.mqtt, deps.otaBaseUrl);
    registerFleetPresetsApi(fleetScope, deps.db, deps.mqtt);
    registerFleetPortal(fleetScope, deps.db);
  });

  app.addHook('onClose', async () => {
    await deps.mqtt.close();
  });

  return app;
}

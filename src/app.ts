import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { seedGlossary } from './db/seed-glossary.js';
import { registerStatusIngestion } from './mqtt/status-ingestion.js';
import type { MqttTransport } from './mqtt/transport.js';
import { registerGlossaryApi } from './routes/glossary-api.js';
import { registerMachinesApi } from './routes/machines-api.js';

/**
 * Top-level runtime dependencies injected at the application seam.
 */
export interface AppDeps {
  db: Pool;
  mqtt: MqttTransport;
}

/**
 * Build the Fastify application wired to PostgreSQL/TimescaleDB and MQTT transport.
 */
export async function createApp(deps: AppDeps): Promise<FastifyInstance> {
  await seedGlossary(deps.db);

  const app = Fastify({ logger: false });

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

  registerGlossaryApi(app, deps.db);
  registerMachinesApi(app, deps.db);
  await registerStatusIngestion(deps.mqtt, deps.db, app.log);

  app.addHook('onClose', async () => {
    await deps.mqtt.close();
  });

  return app;
}

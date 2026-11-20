import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { createApp } from '../../src/app.js';
import type { CloudflareAccessConfig } from '../../src/auth/cloudflare-access.js';
import { createDbPool, ensureSchema } from '../../src/db/pool.js';
import { createInMemoryMqttTransport, type InMemoryMqttTransport } from '../../src/mqtt/transport.js';

/**
 * Optional configuration for creating a test Fastify harness.
 */
export interface CreateTestAppOptions {
  logger?: boolean | FastifyServerOptions['logger'];
  fleetAuth?: CloudflareAccessConfig;
  firmwareDir?: string;
}

/**
 * Live test context backed by real PostgreSQL/TimescaleDB and an in-memory MQTT transport.
 */
export interface TestAppContext {
  app: FastifyInstance;
  db: Pool;
  mqtt: InMemoryMqttTransport;
  firmwareDir: string;
  close: () => Promise<void>;
}

const DEFAULT_TEST_DB_URL = 'postgresql://telemetry:telemetry@localhost:5432/telemetry';

/**
 * Create an isolated test harness instance connected to real PostgreSQL/TimescaleDB.
 */
export async function createTestApp(options?: CreateTestAppOptions): Promise<TestAppContext> {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_TEST_DB_URL;
  const autoFirmwareDir = options?.firmwareDir
    ? null
    : mkdtempSync(join(tmpdir(), 'log-telemetry-fw-'));
  const firmwareDir = options?.firmwareDir ?? autoFirmwareDir!;

  const db = createDbPool(connectionString);
  try {
    await ensureSchema(db);

    const mqtt = createInMemoryMqttTransport();
    const app = await createApp({
      db,
      mqtt,
      logger: options?.logger ?? false,
      fleetAuth: options?.fleetAuth ?? {},
      firmwareDir,
    });

    return {
      app,
      db,
      mqtt,
      firmwareDir,
      async close(): Promise<void> {
        try {
          await app.close();
          await db.end();
        } finally {
          if (autoFirmwareDir) {
            rmSync(autoFirmwareDir, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (err) {
    await db.end();
    if (autoFirmwareDir) {
      rmSync(autoFirmwareDir, { recursive: true, force: true });
    }
    throw err;
  }
}

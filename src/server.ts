import { createApp } from './app.js';
import { createDbPool, ensureSchema } from './db/pool.js';
import { seedPilotMachines } from './db/seed-pilot-machines.js';
import { createMosquittoTransport } from './mqtt/transport.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://telemetry:telemetry@localhost:5432/telemetry';
const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  const db = createDbPool(DATABASE_URL);
  await ensureSchema(db);
  await seedPilotMachines(db);

  const mqtt = createMosquittoTransport(MQTT_URL);
  const app = await createApp({ db, mqtt });

  const shutdown = async () => {
    await app.close();
    await db.end();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host: HOST, port: PORT });
}

void start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

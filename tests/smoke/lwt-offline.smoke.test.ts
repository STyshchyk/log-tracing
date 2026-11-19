import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDbPool, ensureSchema } from '../../src/db/pool.js';
import { createMosquittoTransport } from '../../src/mqtt/transport.js';
import { MQTT_TOPIC_PREFIX, type MachineState } from '../../src/spec/mqtt-contract.js';

const DEFAULT_DB_URL = 'postgresql://telemetry:telemetry@localhost:5432/telemetry';
const DEFAULT_MQTT_URL = 'mqtt://127.0.0.1:1883';

const dbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DB_URL;
const mqttUrl = process.env.SMOKE_MQTT_URL ?? process.env.MQTT_URL ?? DEFAULT_MQTT_URL;
const externalAppUrl = process.env.SMOKE_APP_URL?.trim().replace(/\/+$/, '') || null;

function connectMqttClient(brokerUrl: string, options: IClientOptions): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(brokerUrl, {
      connectTimeout: 5000,
      ...options,
    });
    let settled = false;

    client.once('connect', () => {
      settled = true;
      resolve(client);
    });

    client.on('error', (err) => {
      if (!settled) {
        settled = true;
        client.end(true);
        reject(new Error(`Failed to connect MQTT client to ${brokerUrl}: ${err.message}`));
      }
      // Ignore post-connect teardown errors during ungraceful socket destruction.
    });

    client.once('close', () => {
      if (!settled) {
        settled = true;
        reject(new Error(`MQTT client closed before connecting to ${brokerUrl}`));
      }
    });
  });
}

async function clearRetainedStatus(brokerUrl: string, topic: string): Promise<void> {
  const cleaner = await connectMqttClient(brokerUrl, {
    clientId: `smoke-cleaner-${randomUUID().slice(0, 8)}`,
    reconnectPeriod: 0,
    clean: true,
  });

  try {
    await cleaner.publishAsync(topic, Buffer.alloc(0), { qos: 1, retain: true });
  } finally {
    await cleaner.endAsync();
  }
}

async function pollPortalForState(
  baseUrl: string,
  machineId: string,
  expectedState: MachineState,
  timeoutMs = 10000,
): Promise<string> {
  const url = `${baseUrl}/m/${encodeURIComponent(machineId)}`;
  const expectedAttr = `data-state="${expectedState}"`;
  const deadline = Date.now() + timeoutMs;
  let lastStatus: number | string = 'no response';
  let lastBodySnippet = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      lastStatus = response.status;
      const body = await response.text();
      lastBodySnippet = body.slice(0, 240);
      if (response.status === 200 && body.includes(expectedAttr)) {
        return body;
      }
    } catch (err) {
      lastStatus = err instanceof Error ? err.message : String(err);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${url} to reflect ${expectedAttr} (lastStatus=${lastStatus}, snippet=${JSON.stringify(lastBodySnippet)})`,
  );
}

interface MachineStateRow {
  current_state: string;
  active_error: string | null;
  last_seen_at: Date | null;
}

async function queryMachineState(db: Pool, machineId: string): Promise<MachineStateRow | null> {
  const result = await db.query<MachineStateRow>(
    `SELECT current_state, active_error, last_seen_at
     FROM machines
     WHERE id = $1`,
    [machineId],
  );
  return result.rows[0] ?? null;
}

describe('live Mosquitto LWT OFFLINE smoke seam', () => {
  let db: Pool | null = null;
  let app: FastifyInstance | null = null;
  let baseUrl: string;
  let smokeClient: MqttClient | null = null;
  const createdMachineIds: string[] = [];
  const retainedTopicsToClear: string[] = [];

  beforeAll(async () => {
    db = createDbPool(dbUrl);
    await ensureSchema(db);

    if (externalAppUrl) {
      baseUrl = externalAppUrl;
      return;
    }

    const transport = createMosquittoTransport(mqttUrl);
    try {
      app = await createApp({ db, mqtt: transport });
      baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    } catch (err) {
      if (!app) {
        await transport.close();
      }
      throw err;
    }
  });

  afterAll(async () => {
    try {
      if (smokeClient && !smokeClient.disconnected) {
        smokeClient.end(true);
      }
    } catch {
      // Best-effort cleanup of test publisher socket.
    }

    if (app) {
      await app.close();
    }

    try {
      for (const topic of retainedTopicsToClear) {
        await clearRetainedStatus(mqttUrl, topic);
      }
    } finally {
      if (createdMachineIds.length > 0 && db) {
        await db.query('DELETE FROM machines WHERE id = ANY($1)', [createdMachineIds]);
      }
      if (db) {
        await db.end();
      }
    }
  });

  it('transitions a live machine from WORKING to OFFLINE in PostgreSQL and Worker Portal via broker-published LWT on ungraceful socket drop', async () => {
    if (!db) {
      throw new Error('PostgreSQL pool was not initialized');
    }

    const machineId = `SMOKE-LWT-${randomUUID().slice(0, 8)}`;
    const statusTopic = `${MQTT_TOPIC_PREFIX}/${machineId}/status`;
    createdMachineIds.push(machineId);
    retainedTopicsToClear.push(statusTopic);

    await db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, active_error, last_seen_at)
       VALUES ($1, $2, 'NORTH_LEFT', 1, 1, 'OFFLINE', NULL, NULL)`,
      [machineId, `Smoke Winder ${machineId}`],
    );

    smokeClient = await connectMqttClient(mqttUrl, {
      clientId: `smoke-esp32-${randomUUID().slice(0, 8)}`,
      keepalive: 1,
      reconnectPeriod: 0,
      clean: true,
      will: {
        topic: statusTopic,
        payload: Buffer.from(JSON.stringify({ state: 'OFFLINE' }), 'utf8'),
        qos: 1,
        retain: true,
      },
    });

    await smokeClient.publishAsync(
      statusTopic,
      JSON.stringify({ state: 'WORKING' }),
      { qos: 1, retain: true },
    );

    const workingHtml = await pollPortalForState(baseUrl, machineId, 'WORKING');
    expect(workingHtml).toContain(machineId);
    expect(workingHtml).toContain('data-state="WORKING"');

    const workingRow = await queryMachineState(db, machineId);
    expect(workingRow?.current_state).toBe('WORKING');
    const workingSeenAt = workingRow?.last_seen_at;
    expect(workingSeenAt).toBeInstanceOf(Date);

    // Simulate sudden ESP32 power loss / Wi-Fi drop by destroying the TCP stream without MQTT DISCONNECT.
    expect(smokeClient.stream).toBeDefined();
    smokeClient.stream?.destroy();

    const offlineHtml = await pollPortalForState(baseUrl, machineId, 'OFFLINE');
    expect(offlineHtml).toContain(machineId);
    expect(offlineHtml).toContain('data-state="OFFLINE"');

    const offlineRow = await queryMachineState(db, machineId);
    expect(offlineRow?.current_state).toBe('OFFLINE');
    expect(offlineRow?.active_error).toBeNull();
    const offlineSeenAt = offlineRow?.last_seen_at;
    expect(offlineSeenAt).toBeInstanceOf(Date);
    if (workingSeenAt && offlineSeenAt) {
      expect(offlineSeenAt.getTime()).toBeGreaterThanOrEqual(workingSeenAt.getTime());
    }
  });
});

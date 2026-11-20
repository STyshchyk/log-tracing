import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CloudflareJwk } from '../src/auth/cloudflare-access.js';
import type { FirmwareReleaseRecord } from '../src/services/firmware.js';
import type { FleetMachineDetailsResult } from '../src/services/fleet.js';
import type {
  BatchUpdateDispatchResult,
  PendingUpdateRecord,
} from '../src/services/pending-updates.js';
import { otaUpdateCommandSchema, parseMqttJsonPayload } from '../src/spec/mqtt-contract.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T43-${label}-${randomUUID().slice(0, 8)}`;
}

function makeVersion(tag: string): string {
  return `9.43.${tag}-${randomUUID().slice(0, 8)}`;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function createRsaKeyMaterial(kid: string): {
  jwk: CloudflareJwk;
  privateKey: KeyObject;
} {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exported = publicKey.export({ format: 'jwk' });
  return {
    jwk: {
      ...(exported as object),
      kid,
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
    },
    privateKey,
  };
}

function signRs256Jwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: KeyObject,
): string {
  const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signatureB64 = sign('RSA-SHA256', signingInput, privateKey).toString('base64url');
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

describe('Phase 4 single-machine & multi-select OTA dispatch and pending queue', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];
  const createdReleaseVersions: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(() => {
    ctx.mqtt.clearPublished();
  });

  afterEach(async () => {
    ctx.mqtt.clearPublished();
    if (createdMachineIds.length > 0) {
      await ctx.db.query('DELETE FROM machines WHERE id = ANY($1)', [
        createdMachineIds.splice(0),
      ]);
    }
    if (createdReleaseVersions.length > 0) {
      await ctx.db.query('DELETE FROM firmware_releases WHERE version = ANY($1)', [
        createdReleaseVersions.splice(0),
      ]);
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  async function registerMachine(
    id: string,
    currentState: 'WORKING' | 'IDLE' | 'ERROR' | 'OFFLINE',
  ): Promise<void> {
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state)
       VALUES ($1, $2, 'MAIN_BANK', 1, 1, $3)`,
      [id, `Winder ${id}`, currentState],
    );
  }

  async function uploadRelease(version: string, content = `fw-${version}`): Promise<FirmwareReleaseRecord> {
    const binary = Buffer.from(content, 'utf8');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/firmware?version=${encodeURIComponent(version)}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: binary,
    });
    expect(res.statusCode).toBe(201);
    createdReleaseVersions.push(version);
    return res.json<FirmwareReleaseRecord>();
  }

  it('immediately dispatches OTA_UPDATE over MQTT for single IDLE and ERROR machines', async () => {
    const version = makeVersion('single');
    const release = await uploadRelease(version);
    const mIdle = makeMachineId('IDLE');
    const mError = makeMachineId('ERR');
    await registerMachine(mIdle, 'IDLE');
    await registerMachine(mError, 'ERROR');

    for (const [machineId, expectedState] of [
      [mIdle, 'IDLE'],
      [mError, 'ERROR'],
    ] as const) {
      ctx.mqtt.clearPublished();

      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/fleet/firmware/ota',
        headers: { host: '192.168.1.50:3000' },
        payload: { version, machineId },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<BatchUpdateDispatchResult>();
      expect(body).toMatchObject({
        update_type: 'OTA_UPDATE',
        target_version: version,
        target_name: null,
        total: 1,
        dispatched_count: 1,
        queued_count: 0,
      });
      expect(body.results[0]).toMatchObject({
        machine_id: machineId,
        current_state: expectedState,
        action: 'DISPATCHED',
        update: {
          machine_id: machineId,
          update_type: 'OTA_UPDATE',
          target_version: version,
          status: 'DISPATCHED',
        },
      });
      expect(body.results[0]?.update.dispatched_at).not.toBeNull();

      expect(ctx.mqtt.published).toHaveLength(1);
      const pub = ctx.mqtt.published[0]!;
      expect(pub.topic).toBe(`factory/winders/${machineId}/command`);
      expect(pub.options).toEqual({ qos: 1, retain: false });

      const parsedCmd = parseMqttJsonPayload(pub.payload, otaUpdateCommandSchema);
      expect(parsedCmd).toMatchObject({
        command: 'OTA_UPDATE',
        version,
        url: `http://192.168.1.50:3000/api/firmware/${encodeURIComponent(version)}/download`,
        sha256: release.sha256,
        command_id: `upd-${body.results[0]!.update.id}`,
      });
      expect(parsedCmd.ts).toBeDefined();
    }
  });

  it('handles multi-select batch dispatch across IDLE, ERROR, WORKING, and OFFLINE and surfaces pending updates in fleet details', async () => {
    const version = makeVersion('batch');
    const release = await uploadRelease(version);
    const mIdle = makeMachineId('B-IDLE');
    const mError = makeMachineId('B-ERR');
    const mWorking = makeMachineId('B-WORK');
    const mOffline = makeMachineId('B-OFF');

    await registerMachine(mIdle, 'IDLE');
    await registerMachine(mError, 'ERROR');
    await registerMachine(mWorking, 'WORKING');
    await registerMachine(mOffline, 'OFFLINE');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      headers: { host: '192.168.1.50:3000' },
      payload: {
        version,
        machineIds: [mIdle, mWorking, mError, mWorking, mOffline],
      },
    });
    expect(res.statusCode).toBe(200);
    const batch = res.json<BatchUpdateDispatchResult>();
    expect(batch.total).toBe(4);
    expect(batch.dispatched_count).toBe(2);
    expect(batch.queued_count).toBe(2);

    const byMachine = new Map(batch.results.map((r) => [r.machine_id, r]));
    expect(byMachine.get(mIdle)?.action).toBe('DISPATCHED');
    expect(byMachine.get(mError)?.action).toBe('DISPATCHED');
    expect(byMachine.get(mWorking)?.action).toBe('QUEUED');
    expect(byMachine.get(mWorking)?.update.status).toBe('PENDING');
    expect(byMachine.get(mOffline)?.action).toBe('QUEUED');
    expect(byMachine.get(mOffline)?.update.status).toBe('PENDING');

    // Only IDLE and ERROR received immediate MQTT commands
    expect(ctx.mqtt.published.map((p) => p.topic)).toEqual([
      `factory/winders/${mIdle}/command`,
      `factory/winders/${mError}/command`,
    ]);
    for (const pub of ctx.mqtt.published) {
      expect(parseMqttJsonPayload(pub.payload, otaUpdateCommandSchema).sha256).toBe(
        release.sha256,
      );
    }

    const pendingWorkingRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/updates?machineId=${encodeURIComponent(mWorking)}&status=PENDING`,
    });
    expect(pendingWorkingRes.statusCode).toBe(200);
    const pendingList = pendingWorkingRes.json<{ total: number; updates: PendingUpdateRecord[] }>();
    expect(pendingList.total).toBe(1);
    expect(pendingList.updates[0]?.target_version).toBe(version);

    const detailsWorkingRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/machines/${mWorking}/details`,
    });
    expect(detailsWorkingRes.statusCode).toBe(200);
    const detailsWorking = detailsWorkingRes.json<FleetMachineDetailsResult>();
    expect(detailsWorking.pending_updates).toHaveLength(1);
    expect(detailsWorking.pending_updates[0]).toMatchObject({
      machine_id: mWorking,
      update_type: 'OTA_UPDATE',
      target_version: version,
      status: 'PENDING',
    });

    const detailsIdleRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/machines/${mIdle}/details`,
    });
    expect(detailsIdleRes.json<FleetMachineDetailsResult>().pending_updates).toEqual([]);
  });

  it('auto-dispatches queued PENDING OTA updates only when a machine transitions to IDLE and avoids double-dispatch', async () => {
    const version = makeVersion('auto');
    const release = await uploadRelease(version, 'auto-dispatch-binary');
    const machineId = makeMachineId('AUTO');
    await registerMachine(machineId, 'WORKING');

    const queueRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      headers: { host: '10.0.0.10:3000' },
      payload: { version, machineId },
    });
    expect(queueRes.statusCode).toBe(200);
    const queued = queueRes.json<BatchUpdateDispatchResult>();
    expect(queued.queued_count).toBe(1);
    const updateId = queued.results[0]!.update.id;
    expect(ctx.mqtt.published).toHaveLength(0);

    // WORKING and ERROR status messages must NOT dispatch the PENDING OTA command
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'WORKING' }));
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: 'ERR_FIBER_SNAP' }),
    );
    expect(ctx.mqtt.published).toHaveLength(0);

    // Transition to IDLE triggers immediate auto-dispatch
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'IDLE' }));
    expect(ctx.mqtt.published).toHaveLength(1);
    const pub = ctx.mqtt.published[0]!;
    expect(pub.topic).toBe(`factory/winders/${machineId}/command`);
    expect(pub.options).toEqual({ qos: 1, retain: false });
    expect(parseMqttJsonPayload(pub.payload, otaUpdateCommandSchema)).toMatchObject({
      command: 'OTA_UPDATE',
      version,
      url: `http://10.0.0.10:3000/api/firmware/${encodeURIComponent(version)}/download`,
      sha256: release.sha256,
      command_id: `upd-${updateId}`,
    });

    const updatesAfterRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/updates?machineId=${encodeURIComponent(machineId)}`,
    });
    const updatesAfter = updatesAfterRes.json<{ updates: PendingUpdateRecord[] }>().updates;
    expect(updatesAfter).toHaveLength(1);
    expect(updatesAfter[0]?.status).toBe('DISPATCHED');
    expect(updatesAfter[0]?.dispatched_at).not.toBeNull();

    // Subsequent IDLE heartbeat must not re-dispatch
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'IDLE' }));
    expect(ctx.mqtt.published).toHaveLength(1);
  });

  it('supersedes an earlier PENDING OTA update when a newer version is queued while WORKING', async () => {
    const v1 = makeVersion('sup1');
    const v2 = makeVersion('sup2');
    await uploadRelease(v1, 'sup-v1');
    await uploadRelease(v2, 'sup-v2');
    const machineId = makeMachineId('SUP');
    await registerMachine(machineId, 'WORKING');

    const firstRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      payload: { version: v1, machineId },
    });
    expect(firstRes.statusCode).toBe(200);
    const firstId = firstRes.json<BatchUpdateDispatchResult>().results[0]!.update.id;

    const secondRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      payload: { version: v2, machineId },
    });
    expect(secondRes.statusCode).toBe(200);
    const secondId = secondRes.json<BatchUpdateDispatchResult>().results[0]!.update.id;
    expect(secondId).not.toBe(firstId);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/updates?machineId=${encodeURIComponent(machineId)}`,
    });
    const updates = listRes.json<{ updates: PendingUpdateRecord[] }>().updates;
    const byId = new Map(updates.map((u) => [u.id, u]));
    expect(byId.get(firstId)?.status).toBe('CANCELLED');
    expect(byId.get(secondId)?.status).toBe('PENDING');

    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'IDLE' }));
    expect(ctx.mqtt.published).toHaveLength(1);
    expect(parseMqttJsonPayload(ctx.mqtt.published[0]!.payload, otaUpdateCommandSchema)).toMatchObject({
      command: 'OTA_UPDATE',
      version: v2,
      command_id: `upd-${secondId}`,
    });
  });

  it('cancels a PENDING update via POST /api/fleet/updates/:updateId/cancel and prevents later auto-dispatch', async () => {
    const version = makeVersion('cancel');
    await uploadRelease(version, 'cancel-bin');
    const machineId = makeMachineId('CAN');
    await registerMachine(machineId, 'WORKING');

    const queueRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      payload: { version, machineId },
    });
    const updateId = queueRes.json<BatchUpdateDispatchResult>().results[0]!.update.id;

    const cancelRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/updates/${updateId}/cancel`,
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelled = cancelRes.json<PendingUpdateRecord>();
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelled_at).not.toBeNull();

    // Cancelling again returns 409
    const secondCancelRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/updates/${updateId}/cancel`,
    });
    expect(secondCancelRes.statusCode).toBe(409);

    // Unknown ID returns 404
    const missingCancelRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/updates/999999999/cancel',
    });
    expect(missingCancelRes.statusCode).toBe(404);

    // Transitioning to IDLE publishes nothing after cancellation
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'IDLE' }));
    expect(ctx.mqtt.published).toHaveLength(0);

    // Cancelling an already DISPATCHED update returns 409
    const mIdle = makeMachineId('CAN-DISP');
    await registerMachine(mIdle, 'IDLE');
    const dispRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      payload: { version, machineId: mIdle },
    });
    const dispatchedId = dispRes.json<BatchUpdateDispatchResult>().results[0]!.update.id;
    const cancelDispatchedRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/updates/${dispatchedId}/cancel`,
    });
    expect(cancelDispatchedRes.statusCode).toBe(409);
  });

  it('rejects unknown firmware versions, missing machines without partial dispatches, empty targets, enforces Cloudflare Access auth, and documents OpenAPI paths', async () => {
    const version = makeVersion('err');
    await uploadRelease(version, sha256Hex(Buffer.from('err-bin')));
    const knownId = makeMachineId('KNOWN');
    const missingId = makeMachineId('MISSING');
    await registerMachine(knownId, 'IDLE');

    const missingReleaseRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      payload: { version: makeVersion('nonexistent'), machineId: knownId },
    });
    expect(missingReleaseRes.statusCode).toBe(404);

    const noTargetsRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      payload: { version },
    });
    expect(noTargetsRes.statusCode).toBe(400);

    // Batch containing one missing machine must fail 404 with zero MQTT publishes
    const missingMachineRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      payload: { version, machineIds: [knownId, missingId] },
    });
    expect(missingMachineRes.statusCode).toBe(404);
    expect(missingMachineRes.json<{ missing_machine_ids: string[] }>().missing_machine_ids).toEqual([
      missingId,
    ]);
    expect(ctx.mqtt.published).toHaveLength(0);

    const docsRes = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(docsRes.statusCode).toBe(200);
    const openApi = docsRes.json<{ paths: Record<string, Record<string, unknown>> }>();
    expect(openApi.paths['/api/fleet/firmware/ota']).toHaveProperty('post');
    expect(openApi.paths['/api/fleet/updates']).toHaveProperty('get');
    expect(openApi.paths['/api/fleet/updates/{updateId}/cancel']).toHaveProperty('post');

    // Cloudflare Access enforcement on OTA dispatch, list, and cancel routes
    const key = createRsaKeyMaterial('ota-key-1');
    const nowSec = 1_763_560_000;
    const authCtx = await createTestApp({
      fleetAuth: {
        teamDomain: 'https://factory-test.cloudflareaccess.com',
        aud: 'expected-aud-ota',
        allowedEmails: ['eng@factory.local'],
        fetchJwks: async () => [key.jwk],
        nowSeconds: () => nowSec,
      },
    });
    try {
      expect(
        (
          await authCtx.app.inject({
            method: 'POST',
            url: '/api/fleet/firmware/ota',
            payload: { version, machineId: knownId },
          })
        ).statusCode,
      ).toBe(401);

      expect(
        (await authCtx.app.inject({ method: 'GET', url: '/api/fleet/updates' })).statusCode,
      ).toBe(401);

      expect(
        (await authCtx.app.inject({ method: 'POST', url: '/api/fleet/updates/1/cancel' }))
          .statusCode,
      ).toBe(401);

      const jwt = signRs256Jwt(
        { alg: 'RS256', kid: 'ota-key-1' },
        {
          iss: 'https://factory-test.cloudflareaccess.com',
          aud: ['expected-aud-ota'],
          sub: 'eng-1',
          email: 'eng@factory.local',
          nbf: nowSec - 60,
          exp: nowSec + 600,
        },
        key.privateKey,
      );

      expect(
        (
          await authCtx.app.inject({
            method: 'GET',
            url: '/api/fleet/updates',
            headers: { 'cf-access-jwt-assertion': jwt },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await authCtx.close();
    }
  });
});

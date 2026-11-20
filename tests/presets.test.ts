import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CloudflareJwk } from '../src/auth/cloudflare-access.js';
import type { FleetMachineDetailsResult } from '../src/services/fleet.js';
import type {
  BatchUpdateDispatchResult,
  PendingUpdateRecord,
} from '../src/services/pending-updates.js';
import type { PresetRecord } from '../src/services/presets.js';
import {
  applyPresetCommandSchema,
  commandPayloadSchema,
  otaUpdateCommandSchema,
  parseMqttJsonPayload,
} from '../src/spec/mqtt-contract.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T44-${label}-${randomUUID().slice(0, 8)}`;
}

function makePresetName(tag: string): string {
  return `preset-${tag}-${randomUUID().slice(0, 8)}`;
}

function makeFwVersion(tag: string): string {
  return `9.44.${tag}-${randomUUID().slice(0, 8)}`;
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

describe('Phase 4 versioned presets management and MQTT push', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];
  const createdPresetIds: number[] = [];
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
    if (createdPresetIds.length > 0) {
      await ctx.db.query('DELETE FROM machine_presets WHERE id = ANY($1::bigint[])', [
        createdPresetIds.splice(0),
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

  async function createPreset(input: {
    name: string;
    version: string;
    config_json: Record<string, unknown>;
    notes?: string;
  }) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/presets',
      payload: input,
    });
    if (res.statusCode === 201) {
      createdPresetIds.push(res.json<PresetRecord>().id);
    }
    return res;
  }

  it('supports preset CRUD, multiple versions per name, duplicate (name, version) rejection, and MQTT payload validation', async () => {
    const presetName = makePresetName('crud');

    const resV1 = await createPreset({
      name: presetName,
      version: '2026.11.1',
      config_json: {
        target_rpm: 1200,
        tension_setpoint_n: 16.5,
        enable_brake: true,
      },
      notes: 'Initial baseline preset',
    });
    expect(resV1.statusCode).toBe(201);
    const v1 = resV1.json<PresetRecord>();
    expect(v1).toMatchObject({
      name: presetName,
      version: '2026.11.1',
      config_json: {
        target_rpm: 1200,
        tension_setpoint_n: 16.5,
        enable_brake: true,
      },
      notes: 'Initial baseline preset',
    });

    await new Promise((resolve) => setTimeout(resolve, 15));

    const resV2 = await createPreset({
      name: presetName,
      version: '2026.11.2',
      config_json: {
        target_rpm: 1450,
        tension_setpoint_n: 18.0,
        stages: [600, 1200, 1450],
      },
    });
    expect(resV2.statusCode).toBe(201);
    const v2 = resV2.json<PresetRecord>();

    // Duplicate (name, version) returns 409
    const dupRes = await createPreset({
      name: presetName,
      version: '2026.11.2',
      config_json: { target_rpm: 1500 },
    });
    expect(dupRes.statusCode).toBe(409);

    // Reject empty config_json
    const emptyConfigRes = await createPreset({
      name: presetName,
      version: '2026.11.3',
      config_json: {},
    });
    expect(emptyConfigRes.statusCode).toBe(400);

    // Reject forbidden prototype keys (constructor, prototype)
    const constructorKeyRes = await createPreset({
      name: presetName,
      version: '2026.11.4',
      config_json: { constructor: { polluted: true } },
    });
    expect(constructorKeyRes.statusCode).toBe(400);

    const prototypeKeyRes = await createPreset({
      name: presetName,
      version: '2026.11.5',
      config_json: { prototype: 'bad' },
    });
    expect(prototypeKeyRes.statusCode).toBe(400);

    // Reject oversized config exceeding < 1024-byte APPLY_PRESET MQTT limit
    const oversizedRes = await createPreset({
      name: presetName,
      version: '2026.11.6',
      config_json: { description: 'a'.repeat(980) },
    });
    expect(oversizedRes.statusCode).toBe(400);

    // List newest-first with case-insensitive ?name= filter
    const listFilteredRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/presets?name=${encodeURIComponent(presetName.toUpperCase())}`,
    });
    expect(listFilteredRes.statusCode).toBe(200);
    const listed = listFilteredRes.json<{ total: number; presets: PresetRecord[] }>();
    expect(listed.total).toBe(2);
    expect(listed.presets.map((p) => p.id)).toEqual([v2.id, v1.id]);

    // Get by ID (200 and 404)
    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/presets/${v1.id}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json<PresetRecord>().id).toBe(v1.id);

    const getMissingRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/fleet/presets/999999999',
    });
    expect(getMissingRes.statusCode).toBe(404);

    // Delete by ID (200 then 404)
    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/fleet/presets/${v1.id}`,
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json<{ deleted: boolean; preset: PresetRecord }>()).toMatchObject({
      deleted: true,
      preset: { id: v1.id, version: '2026.11.1' },
    });

    const delAgainRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/fleet/presets/${v1.id}`,
    });
    expect(delAgainRes.statusCode).toBe(404);
  });

  it('pushes presets immediately on IDLE/ERROR and queues PENDING on WORKING/OFFLINE for single and multi-selected machines', async () => {
    const presetName = makePresetName('push');
    const createRes = await createPreset({
      name: presetName,
      version: '1.0.0',
      config_json: { target_rpm: 1350, tension_setpoint_n: 19.5 },
    });
    const preset = createRes.json<PresetRecord>();

    const mIdle = makeMachineId('P-IDLE');
    const mError = makeMachineId('P-ERR');
    const mWorking = makeMachineId('P-WORK');
    const mOffline = makeMachineId('P-OFF');
    await registerMachine(mIdle, 'IDLE');
    await registerMachine(mError, 'ERROR');
    await registerMachine(mWorking, 'WORKING');
    await registerMachine(mOffline, 'OFFLINE');

    const pushRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/presets/${preset.id}/push`,
      payload: {
        machineIds: [mIdle, mWorking, mError, mWorking, mOffline],
      },
    });
    expect(pushRes.statusCode).toBe(200);
    const batch = pushRes.json<BatchUpdateDispatchResult>();
    expect(batch).toMatchObject({
      update_type: 'APPLY_PRESET',
      target_version: '1.0.0',
      target_name: presetName,
      total: 4,
      dispatched_count: 2,
      queued_count: 2,
    });

    // Only IDLE and ERROR received APPLY_PRESET MQTT command immediately
    expect(ctx.mqtt.published).toHaveLength(2);
    expect(ctx.mqtt.published.map((p) => p.topic)).toEqual([
      `factory/winders/${mIdle}/command`,
      `factory/winders/${mError}/command`,
    ]);
    for (const pub of ctx.mqtt.published) {
      expect(pub.options).toEqual({ qos: 1, retain: false });
      const cmd = parseMqttJsonPayload(pub.payload, applyPresetCommandSchema);
      expect(cmd).toMatchObject({
        command: 'APPLY_PRESET',
        version: '1.0.0',
        preset_name: presetName,
        config: { target_rpm: 1350, tension_setpoint_n: 19.5 },
      });
    }

    // WORKING machine lists the PENDING preset in /api/fleet/updates and machine details
    const updatesRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/updates?machineId=${encodeURIComponent(mWorking)}&updateType=APPLY_PRESET&status=PENDING`,
    });
    expect(updatesRes.statusCode).toBe(200);
    expect(updatesRes.json<{ total: number; updates: PendingUpdateRecord[] }>()).toMatchObject({
      total: 1,
      updates: [
        {
          machine_id: mWorking,
          update_type: 'APPLY_PRESET',
          target_version: '1.0.0',
          target_name: presetName,
          status: 'PENDING',
        },
      ],
    });

    const detailsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/machines/${mWorking}/details`,
    });
    expect(detailsRes.json<FleetMachineDetailsResult>().pending_updates).toHaveLength(1);
  });

  it('auto-dispatches queued APPLY_PRESET alongside pending OTA_UPDATE on WORKING -> IDLE, supports independent superseding, and respects cancellation', async () => {
    const fwVersion = makeFwVersion('coex');
    const fwRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/firmware?version=${encodeURIComponent(fwVersion)}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('coex-firmware-bin'),
    });
    expect(fwRes.statusCode).toBe(201);
    createdReleaseVersions.push(fwVersion);

    const presetName = makePresetName('coex');
    const pOld = (
      await createPreset({
        name: presetName,
        version: '1.0.0',
        config_json: { target_rpm: 1000 },
      })
    ).json<PresetRecord>();
    const pNew = (
      await createPreset({
        name: presetName,
        version: '2.0.0',
        config_json: { target_rpm: 1500 },
      })
    ).json<PresetRecord>();

    const mCoex = makeMachineId('COEX');
    const mCancel = makeMachineId('CANC');
    await registerMachine(mCoex, 'WORKING');
    await registerMachine(mCancel, 'WORKING');

    // Queue both OTA_UPDATE and APPLY_PRESET on mCoex while WORKING
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/fleet/firmware/ota',
          headers: { host: '192.168.1.50:3000' },
          payload: { version: fwVersion, machineId: mCoex },
        })
      ).statusCode,
    ).toBe(200);

    const firstPresetPush = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/presets/${pOld.id}/push`,
      payload: { machineId: mCoex },
    });
    expect(firstPresetPush.statusCode).toBe(200);
    const oldPresetUpdateId = firstPresetPush.json<BatchUpdateDispatchResult>().results[0]!.update.id;

    // Supersede preset with pNew; OTA_UPDATE remains PENDING
    const secondPresetPush = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/presets/${pNew.id}/push`,
      payload: { machineId: mCoex },
    });
    expect(secondPresetPush.statusCode).toBe(200);
    const newPresetUpdateId = secondPresetPush.json<BatchUpdateDispatchResult>().results[0]!.update.id;

    const detailsBefore = (
      await ctx.app.inject({ method: 'GET', url: `/api/fleet/machines/${mCoex}/details` })
    ).json<FleetMachineDetailsResult>();
    expect(detailsBefore.pending_updates).toHaveLength(2);
    expect(detailsBefore.pending_updates.map((u) => u.update_type).sort()).toEqual([
      'APPLY_PRESET',
      'OTA_UPDATE',
    ]);

    const allCoexUpdates = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/fleet/updates?machineId=${encodeURIComponent(mCoex)}`,
      })
    ).json<{ updates: PendingUpdateRecord[] }>().updates;
    expect(allCoexUpdates.find((u) => u.id === oldPresetUpdateId)?.status).toBe('CANCELLED');
    expect(ctx.mqtt.published).toHaveLength(0);

    // WORKING -> IDLE dispatches BOTH OTA_UPDATE and the newer APPLY_PRESET
    await ctx.mqtt.emit(`factory/winders/${mCoex}/status`, JSON.stringify({ state: 'IDLE' }));
    expect(ctx.mqtt.published).toHaveLength(2);

    const cmds = ctx.mqtt.published.map((pub) => {
      expect(pub.topic).toBe(`factory/winders/${mCoex}/command`);
      expect(pub.options).toEqual({ qos: 1, retain: false });
      return parseMqttJsonPayload(pub.payload, commandPayloadSchema);
    });

    const otaCmd = cmds.find((c) => c.command === 'OTA_UPDATE');
    const presetCmd = cmds.find((c) => c.command === 'APPLY_PRESET');
    expect(otaCmd).toBeDefined();
    expect(otaUpdateCommandSchema.parse(otaCmd).version).toBe(fwVersion);
    expect(presetCmd).toMatchObject({
      command: 'APPLY_PRESET',
      version: '2.0.0',
      preset_name: presetName,
      config: { target_rpm: 1500 },
      command_id: `upd-${newPresetUpdateId}`,
    });

    const detailsAfter = (
      await ctx.app.inject({ method: 'GET', url: `/api/fleet/machines/${mCoex}/details` })
    ).json<FleetMachineDetailsResult>();
    expect(detailsAfter.pending_updates).toEqual([]);

    // Cancel queued preset on mCancel before IDLE
    ctx.mqtt.clearPublished();
    const queuedCancelRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/presets/${pNew.id}/push`,
      payload: { machineId: mCancel },
    });
    const cancelUpdateId = queuedCancelRes.json<BatchUpdateDispatchResult>().results[0]!.update.id;
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/fleet/updates/${cancelUpdateId}/cancel`,
        })
      ).statusCode,
    ).toBe(200);

    await ctx.mqtt.emit(`factory/winders/${mCancel}/status`, JSON.stringify({ state: 'IDLE' }));
    expect(ctx.mqtt.published).toHaveLength(0);
  });

  it('supports POST /api/fleet/presets/push by (name, version), rejects missing targets/presets, enforces Cloudflare Access auth, and documents OpenAPI paths', async () => {
    const presetName = makePresetName('byname');
    const preset = (
      await createPreset({
        name: presetName,
        version: '3.1.0',
        config_json: { target_rpm: 1100 },
      })
    ).json<PresetRecord>();

    const knownId = makeMachineId('N-OK');
    const missingId = makeMachineId('N-MISS');
    await registerMachine(knownId, 'IDLE');

    const byNameRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/presets/push',
      payload: {
        name: presetName,
        version: '3.1.0',
        machineId: knownId,
      },
    });
    expect(byNameRes.statusCode).toBe(200);
    expect(byNameRes.json<BatchUpdateDispatchResult>()).toMatchObject({
      update_type: 'APPLY_PRESET',
      target_version: '3.1.0',
      target_name: presetName,
      dispatched_count: 1,
    });
    expect(ctx.mqtt.published).toHaveLength(1);

    ctx.mqtt.clearPublished();

    // Unknown preset returns 404
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/fleet/presets/999999999/push',
          payload: { machineId: knownId },
        })
      ).statusCode,
    ).toBe(404);

    // Missing selector returns 400
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/fleet/presets/push',
          payload: { machineId: knownId },
        })
      ).statusCode,
    ).toBe(400);

    // Unknown machine in batch returns 404 with zero MQTT dispatches
    const missingMachineRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/presets/${preset.id}/push`,
      payload: { machineIds: [knownId, missingId] },
    });
    expect(missingMachineRes.statusCode).toBe(404);
    expect(ctx.mqtt.published).toHaveLength(0);

    // OpenAPI coverage
    const docsRes = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    const openApi = docsRes.json<{ paths: Record<string, Record<string, unknown>> }>();
    expect(openApi.paths['/api/fleet/presets']).toHaveProperty('post');
    expect(openApi.paths['/api/fleet/presets']).toHaveProperty('get');
    expect(openApi.paths['/api/fleet/presets/{presetId}']).toHaveProperty('get');
    expect(openApi.paths['/api/fleet/presets/{presetId}']).toHaveProperty('delete');
    expect(openApi.paths['/api/fleet/presets/{presetId}/push']).toHaveProperty('post');
    expect(openApi.paths['/api/fleet/presets/push']).toHaveProperty('post');

    // Cloudflare Access enforcement
    const key = createRsaKeyMaterial('preset-key-1');
    const nowSec = 1_763_560_000;
    const authCtx = await createTestApp({
      fleetAuth: {
        teamDomain: 'https://factory-test.cloudflareaccess.com',
        aud: 'expected-aud-preset',
        allowedEmails: ['eng@factory.local'],
        fetchJwks: async () => [key.jwk],
        nowSeconds: () => nowSec,
      },
    });
    try {
      expect(
        (await authCtx.app.inject({ method: 'GET', url: '/api/fleet/presets' })).statusCode,
      ).toBe(401);
      expect(
        (
          await authCtx.app.inject({
            method: 'POST',
            url: '/api/fleet/presets',
            payload: { name: presetName, version: '9.9.9', config_json: { rpm: 100 } },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (await authCtx.app.inject({ method: 'GET', url: `/api/fleet/presets/${preset.id}` }))
          .statusCode,
      ).toBe(401);
      expect(
        (await authCtx.app.inject({ method: 'DELETE', url: `/api/fleet/presets/${preset.id}` }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await authCtx.app.inject({
            method: 'POST',
            url: `/api/fleet/presets/${preset.id}/push`,
            payload: { machineId: knownId },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await authCtx.app.inject({
            method: 'POST',
            url: '/api/fleet/presets/push',
            payload: { presetId: preset.id, machineId: knownId },
          })
        ).statusCode,
      ).toBe(401);

      const jwt = signRs256Jwt(
        { alg: 'RS256', kid: 'preset-key-1' },
        {
          iss: 'https://factory-test.cloudflareaccess.com',
          aud: ['expected-aud-preset'],
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
            url: '/api/fleet/presets',
            headers: { 'cf-access-jwt-assertion': jwt },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await authCtx.close();
    }
  });
});

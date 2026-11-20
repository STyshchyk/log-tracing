import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CloudflareJwk } from '../src/auth/cloudflare-access.js';
import type { FirmwareReleaseRecord, FirmwareUpdateCheckResult } from '../src/services/firmware.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T42-${label}-${randomUUID().slice(0, 8)}`;
}

function makeVersion(tag: string): string {
  return `9.42.${tag}-${randomUUID().slice(0, 8)}`;
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

describe('Phase 4 firmware version tracking, release hosting, and update checks', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];
  const createdReleaseVersions: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
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
    overrides: Partial<{
      display_name: string;
      zone: 'NORTH_LEFT' | 'NORTH_RIGHT' | 'MAIN_BANK' | 'EAST_DOOR';
      current_state: 'WORKING' | 'IDLE' | 'ERROR' | 'OFFLINE';
    }> = {},
  ): Promise<void> {
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state)
       VALUES ($1, $2, $3, 1, 1, $4)`,
      [
        id,
        overrides.display_name ?? `Winder ${id}`,
        overrides.zone ?? 'MAIN_BANK',
        overrides.current_state ?? 'IDLE',
      ],
    );
  }

  async function uploadRelease(
    version: string,
    binary: Buffer,
    query: Record<string, string> = {},
  ) {
    const params = new URLSearchParams({ version, ...query });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/firmware?${params.toString()}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: binary,
    });
    if (res.statusCode === 201) {
      createdReleaseVersions.push(version);
    }
    return res;
  }

  it('POST /api/fleet/firmware uploads .bin bytes with SHA-256 verification and rejects invalid or duplicate uploads', async () => {
    const v1 = makeVersion('up');
    const binary = Buffer.from([0xe9, 0x02, 0x00, 0x10, ...Buffer.from('esp32-firmware-v1')]);
    const expectedSha = sha256Hex(binary);

    const createdRes = await uploadRelease(v1, binary, {
      filename: 'custom-winder.bin',
      notes: 'Initial OTA test release',
      sha256: expectedSha,
    });
    expect(createdRes.statusCode).toBe(201);
    const created = createdRes.json<FirmwareReleaseRecord>();
    expect(created).toMatchObject({
      version: v1,
      filename: 'custom-winder.bin',
      sha256: expectedSha,
      size_bytes: binary.byteLength,
      notes: 'Initial OTA test release',
      download_url: `/api/firmware/${encodeURIComponent(v1)}/download`,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(Date.parse(created.created_at)).not.toBeNaN();

    // Duplicate version returns 409
    const dupRes = await uploadRelease(v1, binary);
    expect(dupRes.statusCode).toBe(409);

    // Empty body returns 400
    const emptyRes = await uploadRelease(makeVersion('empty'), Buffer.alloc(0));
    expect(emptyRes.statusCode).toBe(400);

    // Non-binary JSON content type returns 400
    const jsonBodyRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/firmware?version=${encodeURIComponent(makeVersion('json'))}`,
      payload: { hello: 'world' },
    });
    expect(jsonBodyRes.statusCode).toBe(400);

    // Invalid version string returns 400
    const badVersionRes = await uploadRelease('-bad-version', binary);
    expect(badVersionRes.statusCode).toBe(400);

    // Non-.bin filename returns 400
    const badExtRes = await uploadRelease(makeVersion('ext'), binary, { filename: 'firmware.exe' });
    expect(badExtRes.statusCode).toBe(400);

    // Mismatched sha256 query returns 400
    const badShaRes = await uploadRelease(makeVersion('sha'), binary, {
      sha256: '0'.repeat(64),
    });
    expect(badShaRes.statusCode).toBe(400);
  });

  it('GET /api/fleet/firmware lists uploaded releases newest-first with latest_version', async () => {
    const vOld = makeVersion('old');
    const vNew = makeVersion('new');

    expect((await uploadRelease(vOld, Buffer.from('old-bin-image'))).statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect((await uploadRelease(vNew, Buffer.from('new-bin-image'))).statusCode).toBe(201);

    const listRes = await ctx.app.inject({ method: 'GET', url: '/api/fleet/firmware' });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json<{
      total: number;
      latest_version: string | null;
      releases: FirmwareReleaseRecord[];
    }>();

    expect(body.latest_version).toBe(vNew);
    const ours = body.releases.filter((r) => r.version === vOld || r.version === vNew);
    expect(ours.map((r) => r.version)).toEqual([vNew, vOld]);
  });

  it('GET /api/firmware/:version/download serves exact .bin bytes with matching SHA-256 and detects tampering', async () => {
    const version = makeVersion('dl');
    const payload = Buffer.alloc(16_384);
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = (i * 31) & 0xff;
    }
    const expectedSha = sha256Hex(payload);

    const uploadRes = await uploadRelease(version, payload, { filename: 'esp32-ota.bin' });
    expect(uploadRes.statusCode).toBe(201);
    const uploaded = uploadRes.json<FirmwareReleaseRecord>();

    const dlRes = await ctx.app.inject({
      method: 'GET',
      url: uploaded.download_url,
    });
    expect(dlRes.statusCode).toBe(200);
    expect(dlRes.headers['content-type']).toBe('application/octet-stream');
    expect(dlRes.headers['content-disposition']).toBe('attachment; filename="esp32-ota.bin"');
    expect(dlRes.headers['x-firmware-version']).toBe(version);
    expect(dlRes.headers['x-firmware-sha256']).toBe(expectedSha);
    expect(dlRes.headers.etag).toBe(`"${expectedSha}"`);
    expect(Buffer.compare(dlRes.rawPayload, payload)).toBe(0);
    expect(sha256Hex(dlRes.rawPayload)).toBe(expectedSha);

    const missingRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/firmware/${encodeURIComponent(makeVersion('missing'))}/download`,
    });
    expect(missingRes.statusCode).toBe(404);

    // Tamper stored file on disk -> server fails closed with 500 integrity error
    await writeFile(join(ctx.firmwareDir, uploaded.file_path), Buffer.from('corrupted-bytes'));
    const tamperedRes = await ctx.app.inject({
      method: 'GET',
      url: uploaded.download_url,
    });
    expect(tamperedRes.statusCode).toBe(500);
    expect(tamperedRes.json()).toMatchObject({
      error: 'Firmware binary integrity check failed',
      version,
    });
  });

  it('GET /api/fleet/firmware/check-updates detects UP_TO_DATE, OUTDATED, and UNKNOWN machines and returns 404 for unknown targetVersion', async () => {
    const v1 = makeVersion('chk1');
    const v2 = makeVersion('chk2');
    expect((await uploadRelease(v1, Buffer.from('fw-v1'))).statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect((await uploadRelease(v2, Buffer.from('fw-v2'))).statusCode).toBe(201);

    const mUpToDate = makeMachineId('UP');
    const mOutdated = makeMachineId('OUT');
    const mUnknown = makeMachineId('UNK');

    await registerMachine(mUpToDate);
    await registerMachine(mOutdated);
    await registerMachine(mUnknown);

    await ctx.mqtt.emit(
      `factory/winders/${mUpToDate}/status`,
      JSON.stringify({ state: 'IDLE', fw_version: v2, preset_version: '2026.11.2' }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${mOutdated}/status`,
      JSON.stringify({ state: 'WORKING', fw_version: v1 }),
    );

    const latestCheckRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/fleet/firmware/check-updates',
    });
    expect(latestCheckRes.statusCode).toBe(200);
    const latestCheck = latestCheckRes.json<FirmwareUpdateCheckResult>();
    expect(latestCheck.target_version).toBe(v2);

    const byIdLatest = new Map(latestCheck.machines.map((m) => [m.machine_id, m]));
    expect(byIdLatest.get(mUpToDate)).toMatchObject({
      fw_version: v2,
      preset_version: '2026.11.2',
      target_version: v2,
      update_status: 'UP_TO_DATE',
      is_outdated: false,
    });
    expect(byIdLatest.get(mOutdated)).toMatchObject({
      fw_version: v1,
      target_version: v2,
      update_status: 'OUTDATED',
      is_outdated: true,
    });
    expect(byIdLatest.get(mUnknown)).toMatchObject({
      fw_version: null,
      target_version: v2,
      update_status: 'UNKNOWN',
      is_outdated: true,
    });

    // Explicit targetVersion=v1 flips mOutdated to UP_TO_DATE and mUpToDate to OUTDATED
    const v1CheckRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/firmware/check-updates?targetVersion=${encodeURIComponent(v1)}`,
    });
    expect(v1CheckRes.statusCode).toBe(200);
    const v1Check = v1CheckRes.json<FirmwareUpdateCheckResult>();
    expect(v1Check.target_version).toBe(v1);
    const byIdV1 = new Map(v1Check.machines.map((m) => [m.machine_id, m]));
    expect(byIdV1.get(mOutdated)?.update_status).toBe('UP_TO_DATE');
    expect(byIdV1.get(mUpToDate)?.update_status).toBe('OUTDATED');

    const unknownTargetRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/fleet/firmware/check-updates?targetVersion=${encodeURIComponent(makeVersion('none'))}`,
    });
    expect(unknownTargetRes.statusCode).toBe(404);
  });

  it('enforces Cloudflare Access auth on /api/fleet/firmware* while keeping /api/firmware/:version/download open for LAN ESP32 fetches', async () => {
    const key = createRsaKeyMaterial('fw-key-1');
    const nowSec = 1_763_560_000;
    const authCtx = await createTestApp({
      fleetAuth: {
        teamDomain: 'https://factory-test.cloudflareaccess.com',
        aud: 'expected-aud-fw',
        allowedEmails: ['eng@factory.local'],
        fetchJwks: async () => [key.jwk],
        nowSeconds: () => nowSec,
      },
    });

    const version = makeVersion('auth');
    try {
      const payload = Buffer.from('auth-test-firmware-binary');

      expect(
        (
          await authCtx.app.inject({
            method: 'POST',
            url: `/api/fleet/firmware?version=${encodeURIComponent(version)}`,
            headers: { 'content-type': 'application/octet-stream' },
            payload,
          })
        ).statusCode,
      ).toBe(401);

      expect(
        (await authCtx.app.inject({ method: 'GET', url: '/api/fleet/firmware' })).statusCode,
      ).toBe(401);

      expect(
        (await authCtx.app.inject({ method: 'GET', url: '/api/fleet/firmware/check-updates' }))
          .statusCode,
      ).toBe(401);

      const jwt = signRs256Jwt(
        { alg: 'RS256', kid: 'fw-key-1' },
        {
          iss: 'https://factory-test.cloudflareaccess.com',
          aud: ['expected-aud-fw'],
          sub: 'eng-1',
          email: 'eng@factory.local',
          nbf: nowSec - 60,
          exp: nowSec + 600,
        },
        key.privateKey,
      );

      const uploadRes = await authCtx.app.inject({
        method: 'POST',
        url: `/api/fleet/firmware?version=${encodeURIComponent(version)}`,
        headers: {
          'content-type': 'application/octet-stream',
          'cf-access-jwt-assertion': jwt,
        },
        payload,
      });
      expect(uploadRes.statusCode).toBe(201);
      createdReleaseVersions.push(version);

      expect(
        (
          await authCtx.app.inject({
            method: 'GET',
            url: '/api/fleet/firmware/check-updates',
            headers: { 'cf-access-jwt-assertion': jwt },
          })
        ).statusCode,
      ).toBe(200);

      // ESP32 downloads firmware over local LAN HTTP without CF Access token
      const dlRes = await authCtx.app.inject({
        method: 'GET',
        url: `/api/firmware/${encodeURIComponent(version)}/download`,
      });
      expect(dlRes.statusCode).toBe(200);
      expect(Buffer.compare(dlRes.rawPayload, payload)).toBe(0);
    } finally {
      await authCtx.close();
    }
  });

  it('documents firmware upload, listing, update-check, and binary download endpoints in OpenAPI /docs/json', async () => {
    const docsRes = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(docsRes.statusCode).toBe(200);
    const openApi = docsRes.json<{
      paths: Record<string, Record<string, unknown>>;
    }>();

    expect(openApi.paths['/api/fleet/firmware']).toHaveProperty('post');
    expect(openApi.paths['/api/fleet/firmware']).toHaveProperty('get');
    expect(openApi.paths['/api/fleet/firmware/check-updates']).toHaveProperty('get');
    expect(openApi.paths['/api/firmware/{version}/download']).toHaveProperty('get');
  });
});

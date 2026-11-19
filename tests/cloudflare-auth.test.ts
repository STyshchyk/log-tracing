import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { CloudflareAccessConfig, CloudflareJwk } from '../src/auth/cloudflare-access.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

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

describe('Cloudflare Access authentication middleware & Worker Portal isolation', () => {
  const contexts: TestAppContext[] = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      const ctx = contexts.pop();
      if (ctx) {
        await ctx.close();
      }
    }
  });

  async function spawnApp(fleetAuth: CloudflareAccessConfig): Promise<TestAppContext> {
    const ctx = await createTestApp({ fleetAuth });
    contexts.push(ctx);
    return ctx;
  }

  it('allows zero-login local LAN fallback on /fleet when Cloudflare Access config is unset', async () => {
    const ctx = await spawnApp({});

    const htmlRes = await ctx.app.inject({ method: 'GET', url: '/fleet' });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.body).toContain('Local LAN Mode (Cloudflare Access disabled)');

    const apiRes = await ctx.app.inject({ method: 'GET', url: '/api/fleet/summary' });
    expect(apiRes.statusCode).toBe(200);
  });

  it('fails closed with 503 on /fleet routes when Cloudflare Access is partially configured, while keeping Worker Portal public', async () => {
    const ctx = await spawnApp({ teamDomain: 'factory-test.cloudflareaccess.com' });

    const fleetApiRes = await ctx.app.inject({ method: 'GET', url: '/api/fleet/summary' });
    expect(fleetApiRes.statusCode).toBe(503);

    const fleetHtmlRes = await ctx.app.inject({ method: 'GET', url: '/fleet' });
    expect(fleetHtmlRes.statusCode).toBe(503);

    const workerRes = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(workerRes.statusCode).toBe(200);

    const healthRes = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(healthRes.statusCode).toBe(200);
  });

  it('enforces RS256 JWKS verification, claim validation, email allowlist, key rotation, and cookie auth while keeping Worker Portal open', async () => {
    const key1 = createRsaKeyMaterial('key-1');
    const key2 = createRsaKeyMaterial('key-2');
    let servedKeys: CloudflareJwk[] = [key1.jwk];
    let currentTimeSec = 1_763_560_000;

    const ctx = await spawnApp({
      teamDomain: 'https://factory-test.cloudflareaccess.com/',
      aud: 'expected-aud-tag-123',
      allowedEmails: ['Head@Factory.Local', 'ops@factory.local'],
      fetchJwks: async () => servedKeys,
      nowSeconds: () => currentTimeSec,
    });

    const basePayload = {
      iss: 'https://factory-test.cloudflareaccess.com',
      aud: ['expected-aud-tag-123'],
      sub: 'user-1',
      email: 'head@factory.local',
      nbf: currentTimeSec - 60,
      exp: currentTimeSec + 600,
    };

    // Unauthenticated Fleet requests rejected
    const missingApiRes = await ctx.app.inject({ method: 'GET', url: '/api/fleet/summary' });
    expect(missingApiRes.statusCode).toBe(401);
    expect(missingApiRes.json()).toMatchObject({ error: 'Authentication Required' });

    const missingHtmlRes = await ctx.app.inject({ method: 'GET', url: '/fleet' });
    expect(missingHtmlRes.statusCode).toBe(401);
    expect(missingHtmlRes.headers['content-type']).toContain('text/html');
    expect(missingHtmlRes.body).toContain('Authentication Required');

    // Public Worker Portal and APIs remain accessible without JWT
    expect((await ctx.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/glossary' })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);

    // Reject alg=none
    const algNoneHeader = Buffer.from(JSON.stringify({ alg: 'none', kid: 'key-1' })).toString('base64url');
    const algNonePayload = Buffer.from(JSON.stringify(basePayload)).toString('base64url');
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/fleet/summary',
          headers: { 'cf-access-jwt-assertion': `${algNoneHeader}.${algNonePayload}.sig` },
        })
      ).statusCode,
    ).toBe(401);

    // Reject wrong signature
    const wrongSigJwt = signRs256Jwt({ alg: 'RS256', kid: 'key-1' }, basePayload, key2.privateKey);
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/fleet/summary',
          headers: { 'cf-access-jwt-assertion': wrongSigJwt },
        })
      ).statusCode,
    ).toBe(401);

    // Reject expired exp (beyond 30s leeway)
    const expiredJwt = signRs256Jwt(
      { alg: 'RS256', kid: 'key-1' },
      { ...basePayload, exp: currentTimeSec - 120 },
      key1.privateKey,
    );
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/fleet/summary',
          headers: { 'cf-access-jwt-assertion': expiredJwt },
        })
      ).statusCode,
    ).toBe(401);

    // Reject wrong aud & wrong iss
    const wrongAudJwt = signRs256Jwt(
      { alg: 'RS256', kid: 'key-1' },
      { ...basePayload, aud: ['other-aud'] },
      key1.privateKey,
    );
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/fleet/summary',
          headers: { 'cf-access-jwt-assertion': wrongAudJwt },
        })
      ).statusCode,
    ).toBe(401);

    const wrongIssJwt = signRs256Jwt(
      { alg: 'RS256', kid: 'key-1' },
      { ...basePayload, iss: 'https://evil.cloudflareaccess.com' },
      key1.privateKey,
    );
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/fleet/summary',
          headers: { 'cf-access-jwt-assertion': wrongIssJwt },
        })
      ).statusCode,
    ).toBe(401);

    // Reject disallowed email with 403
    const outsiderJwt = signRs256Jwt(
      { alg: 'RS256', kid: 'key-1' },
      { ...basePayload, email: 'intruder@example.com' },
      key1.privateKey,
    );
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/fleet/summary',
          headers: { 'cf-access-jwt-assertion': outsiderJwt },
        })
      ).statusCode,
    ).toBe(403);

    // Accept valid header token on /fleet and /api/fleet/summary
    const validJwt = signRs256Jwt({ alg: 'RS256', kid: 'key-1' }, basePayload, key1.privateKey);
    const okHtmlRes = await ctx.app.inject({
      method: 'GET',
      url: '/fleet',
      headers: { 'cf-access-jwt-assertion': validJwt },
    });
    expect(okHtmlRes.statusCode).toBe(200);
    expect(okHtmlRes.body).toContain('Signed in as head@factory.local');

    // Accept valid CF_Authorization cookie
    const cookieRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/fleet/machines',
      headers: { cookie: `foo=bar; CF_Authorization=${encodeURIComponent(validJwt)}` },
    });
    expect(cookieRes.statusCode).toBe(200);

    // Handle JWKS key rotation when a new kid appears
    servedKeys = [key1.jwk, key2.jwk];
    const rotatedJwt = signRs256Jwt(
      { alg: 'RS256', kid: 'key-2' },
      { ...basePayload, email: 'ops@factory.local' },
      key2.privateKey,
    );
    const rotatedRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/fleet/summary',
      headers: { 'cf-access-jwt-assertion': rotatedJwt },
    });
    expect(rotatedRes.statusCode).toBe(200);
  });
});

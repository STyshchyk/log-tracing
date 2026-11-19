import { createPublicKey, verify, type KeyObject, type webcrypto } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { escapeHtml, renderPortalLayout } from '../ui/portal-layout.js';

/**
 * Public RSA JSON Web Key returned by Cloudflare Access `/cdn-cgi/access/certs`.
 */
export interface CloudflareJwk extends webcrypto.JsonWebKey {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

/**
 * Verified operator identity attached to authenticated Fleet requests.
 */
export interface FleetAuthUser {
  email: string;
  sub: string;
  source: 'cloudflare-access' | 'local-lan';
}

/**
 * Configuration for Cloudflare Access RS256 JWT validation on `/fleet` routes.
 * When both `teamDomain` and `aud` are unset, Fleet routes run in local LAN fallback mode.
 */
export interface CloudflareAccessConfig {
  teamDomain?: string | undefined;
  aud?: string | undefined;
  allowedEmails?: readonly string[] | undefined;
  fetchJwks?: (() => Promise<readonly CloudflareJwk[]>) | undefined;
  nowSeconds?: (() => number) | undefined;
  jwksCacheTtlMs?: number | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    fleetUser?: FleetAuthUser;
  }
}

interface CloudflareCertsPayload {
  keys?: unknown;
}

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
}

interface JwtPayload {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
  email?: unknown;
}

const DEFAULT_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_LEEWAY_SEC = 30;

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTeamDomain(raw: string | undefined): string | undefined {
  const trimmed = normalizeOptionalString(raw);
  if (!trimmed) {
    return undefined;
  }
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '');
  const withoutTrailingSlash = withoutProtocol.replace(/\/+$/, '');
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : undefined;
}

function normalizeEmailList(emails: readonly string[] | undefined): Set<string> {
  const set = new Set<string>();
  if (!emails) {
    return set;
  }
  for (const email of emails) {
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 0) {
      set.add(normalized);
    }
  }
  return set;
}

/**
 * Read Cloudflare Access authentication settings from process environment variables.
 */
export function loadCloudflareAccessConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CloudflareAccessConfig {
  const rawAllowed = env.CF_ACCESS_ALLOWED_EMAILS ?? env.FLEET_ALLOWED_EMAILS;
  const allowedEmails = rawAllowed
    ? rawAllowed
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    : undefined;

  return {
    teamDomain: normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN),
    aud: normalizeOptionalString(env.CF_ACCESS_AUD),
    allowedEmails,
  };
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const raw = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function extractJwtFromRequest(request: FastifyRequest): string | null {
  const headerValue = request.headers['cf-access-jwt-assertion'];
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  if (Array.isArray(headerValue)) {
    const first = headerValue.find((item) => item.trim().length > 0);
    if (first) {
      return first.trim();
    }
  }

  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader === 'string' && cookieHeader.length > 0) {
    for (const part of cookieHeader.split(';')) {
      const equalsIdx = part.indexOf('=');
      if (equalsIdx <= 0) {
        continue;
      }
      const name = part.slice(0, equalsIdx).trim();
      if (name === 'CF_Authorization') {
        const rawVal = part.slice(equalsIdx + 1).trim();
        if (rawVal.length > 0) {
          try {
            return decodeURIComponent(rawVal);
          } catch {
            return rawVal;
          }
        }
      }
    }
  }

  return null;
}

function isValidRsaJwk(value: unknown): value is CloudflareJwk {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.kid === 'string' &&
    record.kid.length > 0 &&
    record.kty === 'RSA' &&
    typeof record.n === 'string' &&
    typeof record.e === 'string'
  );
}

async function fetchCloudflareJwks(teamDomain: string): Promise<readonly CloudflareJwk[]> {
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  const response = await fetch(certsUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Cloudflare Access JWKS (${response.status})`);
  }
  const body = (await response.json()) as CloudflareCertsPayload;
  if (!Array.isArray(body.keys)) {
    return [];
  }
  return body.keys.filter(isValidRsaJwk);
}

function matchesAudience(claimAud: unknown, expectedAud: string): boolean {
  if (typeof claimAud === 'string') {
    return claimAud === expectedAud;
  }
  if (Array.isArray(claimAud)) {
    return claimAud.some((item) => typeof item === 'string' && item === expectedAud);
  }
  return false;
}

function matchesIssuer(claimIss: unknown, expectedDomain: string): boolean {
  if (typeof claimIss !== 'string') {
    return false;
  }
  const normalizedIss = claimIss.trim().replace(/\/+$/, '');
  return normalizedIss === `https://${expectedDomain}`;
}

function prefersJsonResponse(request: FastifyRequest): boolean {
  if (request.url.startsWith('/api/')) {
    return true;
  }
  const accept = request.headers.accept ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function sendAuthError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: 401 | 403 | 503,
  errorTitle: string,
  message: string,
): FastifyReply {
  if (prefersJsonResponse(request)) {
    return reply.status(statusCode).send({
      error: errorTitle,
      message,
    });
  }

  const html = renderPortalLayout({
    title: `${errorTitle} | Winding Room Fleet`,
    backHref: '/',
    backLabel: 'Worker Directory',
    bodyHtml: `
      <section class="card">
        <h1>${escapeHtml(errorTitle)}</h1>
        <p>${escapeHtml(message)}</p>
        <p class="machine-meta">Shop-floor workers can still scan any machine QR sticker or open the <a href="/">Worker Directory</a> on the local factory LAN.</p>
      </section>
    `,
  });

  return reply.type('text/html; charset=utf-8').status(statusCode).send(html);
}

/**
 * Create a Fastify `preHandler` hook protecting `/fleet` and `/api/fleet/*` with Cloudflare Access
 * RS256 JWT validation when configured, or zero-login local LAN fallback when unset.
 */
export function createFleetAuthPreHandler(
  config: CloudflareAccessConfig = {},
): preHandlerHookHandler {
  const teamDomain = normalizeTeamDomain(config.teamDomain);
  const aud = normalizeOptionalString(config.aud);
  const allowedEmails = normalizeEmailList(config.allowedEmails);
  const cacheTtlMs = config.jwksCacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS;
  const nowSeconds = config.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  let cachedKeys = new Map<string, KeyObject>();
  let cacheExpiresAtMs = 0;

  const loadKeyMap = async (forceRefresh: boolean): Promise<Map<string, KeyObject>> => {
    const nowMs = Date.now();
    if (!forceRefresh && cachedKeys.size > 0 && nowMs < cacheExpiresAtMs) {
      return cachedKeys;
    }

    const fetcher =
      config.fetchJwks ??
      (teamDomain ? () => fetchCloudflareJwks(teamDomain) : undefined);
    if (!fetcher) {
      return new Map();
    }

    const jwks = await fetcher();
    const nextMap = new Map<string, KeyObject>();
    for (const jwk of jwks) {
      if (!isValidRsaJwk(jwk)) {
        continue;
      }
      try {
        nextMap.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        // Ignore malformed individual keys while preserving valid keys in the JWKS response.
      }
    }

    cachedKeys = nextMap;
    cacheExpiresAtMs = nowMs + cacheTtlMs;
    return cachedKeys;
  };

  return async function fleetAuthPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (Boolean(teamDomain) !== Boolean(aud)) {
      request.log.error(
        'Cloudflare Access partial configuration detected: both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set.',
      );
      await sendAuthError(
        request,
        reply,
        503,
        'Authentication Misconfigured',
        'Cloudflare Access authentication is partially configured on this server. Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or leave both unset for local LAN mode.',
      );
      return;
    }

    if (!teamDomain || !aud) {
      request.fleetUser = {
        email: 'lan-operator@local',
        sub: 'local-lan',
        source: 'local-lan',
      };
      return;
    }

    const token = extractJwtFromRequest(request);
    if (!token) {
      await sendAuthError(
        request,
        reply,
        401,
        'Authentication Required',
        'Sign in through Cloudflare Access to view the Department Heads Fleet dashboard.',
      );
      return;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      await sendAuthError(
        request,
        reply,
        401,
        'Invalid Access Token',
        'The Cloudflare Access token format is invalid.',
      );
      return;
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) {
      await sendAuthError(
        request,
        reply,
        401,
        'Invalid Access Token',
        'The Cloudflare Access token is incomplete.',
      );
      return;
    }

    const header = decodeBase64UrlJson<JwtHeader>(headerB64);
    const payload = decodeBase64UrlJson<JwtPayload>(payloadB64);
    if (!header || !payload || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      await sendAuthError(
        request,
        reply,
        401,
        'Invalid Access Token',
        'The Cloudflare Access token uses an unsupported algorithm or missing key ID.',
      );
      return;
    }

    let keyObject: KeyObject | undefined;
    try {
      let keys = await loadKeyMap(false);
      keyObject = keys.get(header.kid);
      if (!keyObject) {
        keys = await loadKeyMap(true);
        keyObject = keys.get(header.kid);
      }
    } catch (err) {
      request.log.warn({ err }, 'Failed to retrieve Cloudflare Access JWKS');
      await sendAuthError(
        request,
        reply,
        503,
        'Authentication Unavailable',
        'Unable to fetch Cloudflare Access signing keys right now.',
      );
      return;
    }

    if (!keyObject) {
      await sendAuthError(
        request,
        reply,
        401,
        'Invalid Access Token',
        'No matching Cloudflare Access signing key was found for this token.',
      );
      return;
    }

    let signatureValid = false;
    try {
      const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
      const signature = Buffer.from(signatureB64, 'base64url');
      signatureValid = signature.length > 0 && verify('RSA-SHA256', signingInput, keyObject, signature);
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      await sendAuthError(
        request,
        reply,
        401,
        'Invalid Access Token',
        'Cloudflare Access token signature verification failed.',
      );
      return;
    }

    const now = nowSeconds();
    const exp = payload.exp;
    const nbf = payload.nbf;
    const email = typeof payload.email === 'string' ? payload.email.trim() : '';

    if (
      !matchesIssuer(payload.iss, teamDomain) ||
      !matchesAudience(payload.aud, aud) ||
      typeof exp !== 'number' ||
      !Number.isFinite(exp) ||
      now >= exp + CLOCK_SKEW_LEEWAY_SEC ||
      (nbf !== undefined && (typeof nbf !== 'number' || !Number.isFinite(nbf) || now + CLOCK_SKEW_LEEWAY_SEC < nbf)) ||
      email.length === 0
    ) {
      await sendAuthError(
        request,
        reply,
        401,
        'Invalid Access Token',
        'Cloudflare Access token claims are expired, untrusted, or missing an email identity.',
      );
      return;
    }

    if (allowedEmails.size > 0 && !allowedEmails.has(email.toLowerCase())) {
      await sendAuthError(
        request,
        reply,
        403,
        'Access Forbidden',
        `Account ${email} is not authorized to access the Fleet management portal.`,
      );
      return;
    }

    const sub =
      typeof payload.sub === 'string' && payload.sub.trim().length > 0
        ? payload.sub.trim()
        : email;

    request.fleetUser = {
      email,
      sub,
      source: 'cloudflare-access',
    };
  };
}

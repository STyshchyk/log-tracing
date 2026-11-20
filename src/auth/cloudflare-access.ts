import type { KeyObject } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { escapeHtml, renderPortalLayout } from '../ui/portal-layout.js';
import {
  CLOCK_SKEW_LEEWAY_SEC,
  DEFAULT_JWKS_CACHE_TTL_MS,
  createJwksKeyLoader,
  decodeBase64UrlJson,
  matchesAudience,
  matchesIssuer,
  normalizeEmailList,
  normalizeOptionalString,
  normalizeTeamDomain,
  verifyRs256Signature,
  type CloudflareJwk,
  type JwtHeader,
  type JwtPayload,
} from './jwks-verifier.js';

export type { CloudflareJwk };

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
  const loadKeyMap = createJwksKeyLoader({
    teamDomain,
    fetchJwks: config.fetchJwks,
    cacheTtlMs,
  });

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

    if (!verifyRs256Signature(headerB64, payloadB64, signatureB64, keyObject)) {
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

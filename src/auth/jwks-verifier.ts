import { createPublicKey, verify, type KeyObject, type webcrypto } from 'node:crypto';

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

interface CloudflareCertsPayload {
  keys?: unknown;
}

export interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
}

export interface JwtPayload {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
  email?: unknown;
}

export const DEFAULT_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
export const CLOCK_SKEW_LEEWAY_SEC = 30;

export function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeTeamDomain(raw: string | undefined): string | undefined {
  const trimmed = normalizeOptionalString(raw);
  if (!trimmed) {
    return undefined;
  }
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '');
  const withoutTrailingSlash = withoutProtocol.replace(/\/+$/, '');
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : undefined;
}

export function normalizeEmailList(emails: readonly string[] | undefined): Set<string> {
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

export function decodeBase64UrlJson<T>(segment: string): T | null {
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

export function isValidRsaJwk(value: unknown): value is CloudflareJwk {
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

export async function fetchCloudflareJwks(
  teamDomain: string,
): Promise<readonly CloudflareJwk[]> {
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

export function matchesAudience(claimAud: unknown, expectedAud: string): boolean {
  if (typeof claimAud === 'string') {
    return claimAud === expectedAud;
  }
  if (Array.isArray(claimAud)) {
    return claimAud.some((item) => typeof item === 'string' && item === expectedAud);
  }
  return false;
}

export function matchesIssuer(claimIss: unknown, expectedDomain: string): boolean {
  if (typeof claimIss !== 'string') {
    return false;
  }
  const normalizedIss = claimIss.trim().replace(/\/+$/, '');
  return normalizedIss === `https://${expectedDomain}`;
}

export function verifyRs256Signature(
  headerB64: string,
  payloadB64: string,
  signatureB64: string,
  keyObject: KeyObject,
): boolean {
  try {
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
    const signature = Buffer.from(signatureB64, 'base64url');
    return signature.length > 0 && verify('RSA-SHA256', signingInput, keyObject, signature);
  } catch {
    return false;
  }
}

export function createJwksKeyLoader(options: {
  teamDomain: string | undefined;
  fetchJwks?: (() => Promise<readonly CloudflareJwk[]>) | undefined;
  cacheTtlMs: number;
}): (forceRefresh: boolean) => Promise<Map<string, KeyObject>> {
  let cachedKeys = new Map<string, KeyObject>();
  let cacheExpiresAtMs = 0;

  return async (forceRefresh: boolean): Promise<Map<string, KeyObject>> => {
    const nowMs = Date.now();
    if (!forceRefresh && cachedKeys.size > 0 && nowMs < cacheExpiresAtMs) {
      return cachedKeys;
    }

    const fetcher =
      options.fetchJwks ??
      (options.teamDomain ? () => fetchCloudflareJwks(options.teamDomain!) : undefined);
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
    cacheExpiresAtMs = nowMs + options.cacheTtlMs;
    return cachedKeys;
  };
}

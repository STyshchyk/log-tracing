# 03: Cloudflare Access authentication middleware

**What to build:** Implement `src/auth/cloudflare-access.ts` verifying RS256 Cloudflare Access JWTs (`Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie) against Cloudflare's JWKS endpoint using Node's built-in `node:crypto`, plus optional allowed-email filtering. Scope the preHandler hook strictly to `/fleet`, `/fleet/*`, and `/api/fleet/*` so Worker Portal routes remain public, allow zero-login local LAN mode when Cloudflare Access env vars are both unset, and fail closed (HTTP 503) on partial configuration.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Verifies RS256 signature against fetched/cached JWKS (with `kid`-miss rotation refresh), `iss`, `aud`, `exp`/`nbf`, and non-empty `email` claim.
- [x] Rejects unauthenticated or invalid requests with HTTP 401 (JSON for `/api/fleet/*`, accessible HTML login notice for `/fleet`), disallowed emails with HTTP 403, and partial config with HTTP 503.
- [x] Local LAN fallback attaches a local user when neither `CF_ACCESS_TEAM_DOMAIN` nor `CF_ACCESS_AUD` is configured, and Worker Portal routes stay completely open in all modes.

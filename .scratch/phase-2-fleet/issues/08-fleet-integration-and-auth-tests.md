# 08: Integration, auth, seeding & Fleet PWA tests

**What to build:** Add Vitest integration tests backed by real PostgreSQL/TimescaleDB (`createTestApp()`) covering Fleet APIs (`tests/fleet-api.test.ts`), Cloudflare Access RS256 JWT authentication & public Worker Portal isolation (`tests/cloudflare-auth.test.ts`), 50-winder CSV seeding (`tests/fleet-seed.test.ts`), and Fleet PWA SSR rendering & XSS safety (`tests/fleet-portal.test.ts`).

**Blocked by:** 01: Fleet summary, machines list & room history APIs, 02: Fleet machine-details API, 03: Cloudflare Access authentication middleware, 05: Fleet PWA shell, L-shaped floor map & summary strip, 06: Fleet UI drill-down drawer, status filters, Room History & Master Glossary, 07: CLI command & CSV to seed the 50-winder fleet

**Status:** done

- [x] Fleet API tests verify summary, machine list filtering, machine details (including 404), and room history against real PostgreSQL with UUID-scoped test isolation.
- [x] Cloudflare Access auth tests verify RS256 JWKS verification, rotation, cookie/header extraction, claim/signature/email rejection, 503 partial-config fail-closed, LAN fallback, and public Worker Portal access.
- [x] Fleet seed and PWA SSR tests verify 50-winder idempotent seeding, live telemetry preservation, manifest endpoint, and HTML escaping.

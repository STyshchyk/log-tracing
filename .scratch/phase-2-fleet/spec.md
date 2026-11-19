# Phase 2 — Full Floor Fleet & Remote Management

Status: done

## Problem Statement

After validating the local-first pilot on `W-01` and `W-02`, the factory needs full visibility across all ~50 winding machines spanning four floor zones (`NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`). Shop-floor operators have a fast zero-login Worker Portal (`/m/:machineId`), while department heads currently have no room-wide overview, no L-shaped floor status map, no centralized Room History or Master Glossary console, and no secure remote HTTPS access outside the factory LAN.

## Solution

Deliver a Department Heads PWA at `/fleet` backed by aggregate Fleet JSON APIs, CSV-driven 50-winder fleet seeding (`pnpm seed:fleet`), and optional Cloudflare Tunnel + Cloudflare Access authentication (`cloudflared`), while keeping all Worker Portal routes public over the local factory LAN and preserving the Phase 1 five-table PostgreSQL/TimescaleDB schema with zero breaking migrations.

## User Stories

1. As a department head, I want a top summary strip on `/fleet` showing live counts of `WORKING`, `IDLE`, `ERROR`, and `OFFLINE` machines plus open bug reports, so that I can assess winding room health in seconds.
2. As a department head, I want to toggle coil production rollups (`Completed` and `Aborted`) across `Today`, `Week`, `Month`, and `All-Time`, so that I can compare shift output and abort rates without exporting spreadsheets.
3. As a department head, I want an interactive L-shaped floor map grouped by `NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, and `EAST_DOOR` using each machine's `grid_row` and `grid_col`, so that I can pinpoint problem bays spatially.
4. As a department head, I want status filter pills (`All`, `Working`, `Idle`, `Error`, `Offline`) on the floor map, so that I can isolate stalled or faulted winders immediately.
5. As a department head, I want clicking any machine node on the floor map or history feed to open a drill-down drawer showing its active fault glossary fix steps, recent errors, recent bug reports, coil rollups, and Worker Portal link, so that I can diagnose issues without leaving `/fleet`.
6. As a department head, I want a Room History tab showing combined fault events and operator bug reports across the entire room with filters for record type, floor zone, and machine ID, so that I can trace patterns across machines.
7. As a department head, I want a Master Glossary tab with live keyword search across all fault codes, symptoms, and fix steps, so that I can review or share troubleshooting guidance across the team.
8. As a remote supervisor, I want `/fleet` and `/api/fleet/*` exposed over HTTPS via a `cloudflared` tunnel and protected by Cloudflare Access email authentication when configured, while continuing to allow zero-login local LAN fallback when Cloudflare Access env vars are unset.
9. As a shop-floor worker, I want `/`, `/m/:machineId`, and Worker Portal APIs to remain zero-login and unaffected by Fleet authentication, so that handheld QR workflows stay frictionless.
10. As a factory administrator, I want an idempotent CSV seeding CLI (`pnpm seed:fleet`) to register or update all 50 winders (`W-01`..`W-50`) without overwriting live `current_state`, `active_error`, or `last_seen_at` telemetry.

## Implementation Decisions

- **No Schema Migrations:** Phase 2 builds directly on the Phase 1 PostgreSQL/TimescaleDB schema (`machines`, `telemetry_events`, `coil_outcomes`, `coil_rollup_machine`, `coil_rollup_room`, `error_glossary`, `bug_reports`).
- **Fleet Services & HTTP APIs:** Pure SQL query services (`src/services/fleet.ts`) back encapsulated authenticated routes (`src/routes/fleet-api.ts`):
  - `GET /api/fleet/summary` — machine state totals, open bug-report count, and `coil_rollup_room` windows.
  - `GET /api/fleet/machines` — ordered machine list with optional `state` and `zone` filters.
  - `GET /api/fleet/machines/:machineId/details` — machine metadata, active glossary entry (if `active_error` is set), 5 recent error summaries, 5 recent bug reports, machine coil rollups, and `/m/:machineId` Worker Portal URL.
  - `GET /api/fleet/history` — merged room-wide fault telemetry events and bug reports sorted newest-first with `limit`, `machineId`, `zone`, and `kind` filters.
- **Cloudflare Access Auth Middleware:** Native Node `node:crypto` RS256 JWKS verification (`src/auth/cloudflare-access.ts`) validating `Cf-Access-Jwt-Assertion` headers or `CF_Authorization` cookies against Cloudflare's `/cdn-cgi/access/certs` JWK set, `iss`, `aud`, `exp`/`nbf`, and optional `CF_ACCESS_ALLOWED_EMAILS` allowlist. Scoped strictly to an encapsulated Fastify plugin covering `/fleet`, `/fleet/*`, and `/api/fleet/*`. Partial config (`CF_ACCESS_TEAM_DOMAIN` XOR `CF_ACCESS_AUD`) fails closed with HTTP `503`; fully unset config enables local LAN fallback.
- **Remote Tunnel (`cloudflared`):** `docker-compose.yml` adds a `cloudflared` service under `profiles: ["remote"]` using `CF_TOKEN` to proxy `http://app:3000` over HTTPS without breaking local LAN-only `docker compose up -d`.
- **Department Heads PWA (`/fleet`):** Zero-CDN server-rendered HTML + progressive vanilla JS/CSS (`src/ui/fleet-layout.ts`, `src/routes/fleet-portal.ts`) plus `/fleet/manifest.webmanifest`. Uses native `<dialog closedby="any">` for the drill-down drawer (with pointer outside-rect fallback and `overscroll-behavior: contain` scroll containment), `focusgroup="tablist nomemory"` + `hidden="until-found"` + `beforematch` tabs (`Floor Map`, `Room History`, `Master Glossary`), and 10-second live auto-polling.
- **50-Winder Seeding:** `docs/fleet-seed.csv` defines `W-01`..`W-50` across the four L-shaped zones; `src/db/seed-fleet-machines.ts` (`pnpm seed:fleet` / `pnpm seed:full`) validates CSV integrity (no duplicate IDs or `(zone, grid_row, grid_col)` slots) and upserts metadata idempotently without modifying live telemetry columns.

## Testing Decisions

- **Real Database Seam (`createTestApp()`):** Fleet APIs, Fleet SSR portal, and 50-winder CSV seeding run against real PostgreSQL/TimescaleDB via Fastify `app.inject()` with zero mocked SQL, using per-test UUID-prefixed machine IDs for concurrency safety.
- **Cryptographic Auth Seam:** Cloudflare Access middleware tests generate ephemeral RSA-2048 keypairs with `node:crypto`, sign valid/expired/tampered/wrong-aud/wrong-iss/alg-none JWTs, inject JWKS responses and clock timestamps via `AppDeps.fleetAuth`, and verify Worker Portal routes stay public.
- **Smoke & Compose Validation:** Existing Mosquitto LWT smoke test (`pnpm test:smoke`) and `docker compose config` (default + `--profile remote`) verify runtime wiring.

## Out of Scope

- Phase 3 deliverables (Grafana OSS dashboards, client-side bug-report photo attachments and cleanup cron, non-winder tools, QR-redirect `Redo` proxy).
- Custom multi-role RBAC beyond Cloudflare Access email allowlisting.
- WebSocket push streaming (10-second HTTP polling is used in Phase 2).

## Further Notes

- Commissioning details and remote tunnel onboarding live in `docs/FLEET_RUNBOOK.md` and `.env.example`.
- Ticket tracking lives in `.scratch/phase-2-fleet/issues/`.

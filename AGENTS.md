# Factory Winding Room Telemetry & Management System (`log-telemetry`)

On-premises MQTT telemetry ingestion, TimescaleDB storage, crash/brownout forensics, fault glossary, zero-login Worker Portal (`/`, `/m/*`), authenticated Department Heads Fleet PWA (`/fleet`), and optional Grafana OSS dashboards (`:3001`) for ~50 ESP32 Pico fiberglass winders. Phases 1–3 are complete; see `PLAN.md` and `docs/agents/architecture.md` for phase history, data flows, and tech debt notes.

> **Start here:** Use the module and endpoint maps below to jump directly to target files instead of scanning the repo. Keep this file concise (`< 120` lines) so it never truncates in agent prompts.

---

## 1. Tech Stack & Architecture Seams

- **Runtime & Stack:** Node.js 24 (`node:24-alpine`, ESM `"type": "module"`), `pnpm@10.28.0`, TypeScript `^7.0.2` (`NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`), Fastify 5 + `@fastify/swagger` (`/docs`), Zod 4, PostgreSQL 16 + TimescaleDB (`pg` Pool, raw parameterized SQL), Eclipse Mosquitto 2 (`mqtt`), zero-CDN SSR HTML5 + embedded CSS + vanilla JS, Grafana OSS (`grafana/grafana:11.6.2`), Vitest 5.
- **Composition Seam (`createApp(deps)` in `src/app.ts`):** Accepts `{ db: Pool, mqtt: MqttTransport, logger?, fleetAuth? }`. Production (`src/server.ts`) uses `createMosquittoTransport` + `loadCloudflareAccessConfigFromEnv()`; tests (`tests/helpers/test-app.ts`) use `createInMemoryMqttTransport()` against real TimescaleDB with `fleetAuth: {}`.
- **Auth Boundary:** `/api/fleet/*` and `/fleet*` sit in an encapsulated Fastify plugin guarded by `createFleetAuthPreHandler` (Cloudflare Access RS256 JWT when `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` are set; local LAN mode when both unset; fail-closed HTTP `503` if partially set). Worker Portal (`/`, `/m/*`), `/health`, `/docs`, and Phase 1 `/api/*` are always public.
- **Acyclic Layering:** `server` → `app` → (`auth`, `routes`, `mqtt`, `db`) → (`services`, `ui`) → `spec`.
- **Schema (`db/init.sql`):** 5 tables (`machines`, `telemetry_events` hypertable, `coil_outcomes`, `error_glossary`, `bug_reports`) + 2 views (`coil_rollup_machine`, `coil_rollup_room` across `TODAY`/`WEEK`/`MONTH`/`ALL_TIME`).

---

## 2. Project Map

| Path | Responsibility |
| :--- | :--- |
| `package.json`, `tsconfig*.json`, `vitest*.config.ts` | Scripts (`dev`, `build`, `start`, `typecheck`, `test`, `test:smoke`, `test:all`, `seed:*`), ESM config (`dist/src/`), unit/integration vs live-Mosquitto smoke suites |
| `Dockerfile`, `docker-compose.yml`, `.env.example`, `mosquitto/` | `mosquitto` + `postgres` + `app` default stack; optional `--profile remote` (`cloudflared`) and `--profile engineering` (`grafana`) |
| `db/init.sql` | Idempotent TimescaleDB schema, constraints, indexes, and coil rollup views |
| `grafana/provisioning/`, `grafana/dashboards/` | Pre-provisioned `telemetry-postgres` datasource + `esp32-firmware-health` & `winding-cycle-telemetry` dashboards |
| `spec/` | Firmware handoff kit: `error_codes.json` (canonical fault registry), `MQTT_TOPICS.md`, `ESP32_INTEGRATION.md` |
| `docs/` | `PILOT_RUNBOOK.md`, `FLEET_RUNBOOK.md`, `ENGINEERING_RUNBOOK.md`, `fleet-seed.csv` (`W-01`–`W-50`), `docs/agents/*` |
| `.scratch/phase-{1-pilot,2-fleet,3-engineering}/` | Phase specs (`spec.md`) and ticket files (`issues/`) |
| `src/server.ts`, `src/app.ts` | Process entrypoint (`ensureSchema` + `seedPilotMachines`) and Fastify app factory (`seedGlossary`, routes, MQTT subscribers) |
| `src/auth/cloudflare-access.ts` | RS256 JWKS verification (`node:crypto`), email allowlist, LAN fallback, fail-closed `503` |
| `src/spec/{fault-registry,mqtt-contract}.ts` | `error_codes.json` loader, canonical domain enums/constants, strict Zod schemas (`status`, `events`, `coil`), topic/payload parsers |
| `src/db/{pool,seed-glossary,seed-pilot-machines,seed-fleet-machines}.ts` | `pg` pool + advisory-locked `ensureSchema(db)`, idempotent glossary/pilot/50-winder CSV seeders |
| `src/mqtt/{transport,ingestion-helpers,status-ingestion,events-ingestion,coil-ingestion}.ts` | Mosquitto & in-memory transports, `< 1024` byte & Zod guardrails, `factory/winders/+/{status,events,coil}` DB writers |
| `src/services/{machines,telemetry-events,glossary,bug-reports,coil-rollups,fleet}.ts` | Parameterized SQL query services, active-error glossary pinning, transactional 20-event bug-report snapshot, fleet summary/history/details |
| `src/routes/{api-schemas,machines-api,events-api,glossary-api,bug-reports-api,coils-api,fleet-api}.ts` | OpenAPI-validated JSON endpoints (`/api/*` public, `/api/fleet/*` fleet-authed) |
| `src/routes/{worker-portal,worker-glossary,worker-bug-report,fleet-portal}.ts` | Hidden-from-OpenAPI SSR HTML routes (`/`, `/m/*`, `/fleet*`) |
| `src/ui/{portal-layout,markdown,recent-errors-section,fleet-layout}.ts` | Zero-CDN SSR HTML layouts, `escapeHtml`, safe Markdown list/code renderer, `/fleet` L-shaped grid + `<dialog>` drawer + 10s polling |
| `tests/` | `tests/helpers/test-app.ts` (`createTestApp`), unit/integration tests (`tests/*.test.ts`), live Mosquitto LWT smoke test (`tests/smoke/`) |

---

## 3. HTTP Endpoints

| Routes | Module | Auth | Purpose |
| :--- | :--- | :--- | :--- |
| `GET /health`, `/docs`, `/docs/json` | `src/app.ts` | Public | DB health check (`200`/`503`) and OpenAPI 3.0.3 UI/JSON |
| `GET /api/machines/:machineId` | `src/routes/machines-api.ts` | Public | Machine metadata, `current_state`, `active_error`, `last_seen_at` |
| `GET /api/machines/:machineId/events` | `src/routes/events-api.ts` | Public | Recent events (`?limit=1..100&errorsOnly=bool`) |
| `GET /api/glossary` | `src/routes/glossary-api.ts` | Public | Search glossary (`?q=&machineId=`) with active-error pinning |
| `POST`, `GET /api/machines/:machineId/bug-reports` | `src/routes/bug-reports-api.ts` | Public | Create report (atomic 20-event snapshot) / list machine reports |
| `GET /api/machines/:machineId/coils/rollups`, `/api/coils/rollups` | `src/routes/coils-api.ts` | Public | Per-machine and room-wide `TODAY`/`WEEK`/`MONTH`/`ALL_TIME` coil rollups |
| `GET /api/fleet/{summary,machines,machines/:machineId/details,history}` | `src/routes/fleet-api.ts` | Fleet Auth | Room summary, zone/state-filtered machines, drill-down details, merged history |
| `GET /`, `/m`, `/m/:machineId`, `/m/:machineId/glossary`, `GET`/`POST /m/:machineId/report-bug` | `src/routes/worker-*.ts` | Public | Zero-login SSR Worker Portal, glossary, 1-tap bug report form |
| `GET /fleet`, `/fleet/`, `/fleet/manifest.webmanifest` | `src/routes/fleet-portal.ts` | Fleet Auth | Department Heads Fleet PWA & web app manifest |

---

## 4. Domain Vocabulary & Hard Invariants

- **States:** `WORKING`, `IDLE`, `ERROR`, `OFFLINE` (LWT `{"state":"OFFLINE"}` preserves pre-outage `active_error`).
- **Coil outcomes:** `AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED` + optional `wound_length` (CRM/QR `COMPLETED`/`FAILED`/`REDO` are excluded).
- **Floor zones:** `NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`.
- **Bug report quick tags:** `Fiber Snap`, `Tension`, `Unit Dead`, `Bobbin Jam`, `Other`.
- **Fault codes (`error_code`):** `^[A-Z](?:[A-Z0-9]|_[A-Z0-9])*$`, source of truth in `spec/error_codes.json`.
- **MQTT & Firmware:** Payloads `< 1024` UTF-8 bytes; strict schemas; retained `status`, non-retained `events`/`coil`; update `spec/` rather than external C++ firmware.
- **UI & Security:** Zero external CDNs; touch targets `>= 48px` (`52px` on `pointer: coarse`); non-color status indicators + `forced-colors`; escape all dynamic HTML via `escapeHtml`; HTML routes use `schema: { hide: true }`.
- **Code & Data:** Relative TypeScript imports require `.js` extensions (`NodeNext`); never mock SQL or internal helpers in tests; never overwrite live `current_state`/`active_error`/`last_seen_at` when seeding machines.

---

## 5. Commands & Conventions

- **Stack:** `docker compose up -d postgres mosquitto` (dev DB/broker) | `docker compose up -d --build` (LAN stack) | add `--profile engineering` (Grafana `:3001`) or `--profile remote` (`cloudflared`).
- **Verify:** `pnpm typecheck` | `pnpm build` | `pnpm test` (unit + real-DB integration) | `pnpm test:smoke` (live Mosquitto LWT).
- **Seed:** `pnpm seed:pilot` (`W-01`, `W-02`) | `pnpm seed:fleet` (50 winders from `docs/fleet-seed.csv`).
- **Further Docs:**
  - Deep architecture, startup lifecycle, MQTT/DB data flows & tech debt: `docs/agents/architecture.md`
  - Shell, Docker profile, DB lock & test concurrency gotchas: `.agents/rules/ops-gotchas.md`
  - Editing & goal discipline: `.agents/rules/editing-and-goals.md`
  - Local issues (`.scratch/<feature>/`), triage labels & domain conventions: `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`

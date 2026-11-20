# Factory Winding Room Telemetry & Management System

Local-first telemetry, diagnostics, and bug-reporting system for ~50 ESP32 Pico fiberglass winding machines.

> **Start here:** Read this file before exploring the codebase. Use the project map below to jump directly to relevant modules instead of re-scanning the repository.

---

## 1. Project Overview

- **Package:** `log-telemetry` (`v0.1.0`, private ESM Node.js/TypeScript service).
- **Purpose:** On-premises (`$0/month` software licensing) MQTT telemetry ingestion, TimescaleDB time-series storage, crash/brownout forensics, searchable plain-English fault glossary, zero-login mobile-first Worker Portal for industrial Android handheld scanners, and Department Heads Fleet PWA with optional Cloudflare Tunnel + Cloudflare Access HTTPS authentication.
- **Current Implementation State:**
  - **Phase 1 — Pilot (`W-01`, `W-02`) — Complete:** Firmware handoff kit (`spec/`), Docker Compose stack (`mosquitto`, `postgres`, `app`), MQTT ingestion (`status`, `events`, `coil`), OpenAPI JSON APIs, SSR Worker Portal (`/`, `/m/:machineId`, `/m/:machineId/glossary`, `/m/:machineId/report-bug`), idempotent pilot/glossary seeding, and live Mosquitto LWT smoke test. See `.scratch/phase-1-pilot/spec.md` and `docs/PILOT_RUNBOOK.md`.
  - **Phase 2 — Full-Floor Fleet & Remote Access — Complete:** Department Heads `/fleet` PWA (L-shaped floor map, summary strip, `<dialog>` drill-down drawer, Room History, Master Glossary, web manifest), `/api/fleet/*` OpenAPI endpoints, zero-dependency `node:crypto` Cloudflare Access RS256 JWT middleware, `docker-compose.yml` optional `remote` `cloudflared` profile, `.env.example`, and 50-winder CSV seeder (`docs/fleet-seed.csv`, `pnpm seed:fleet`). See `.scratch/phase-2-fleet/spec.md`, `.scratch/phase-2-fleet/issues/`, and `docs/FLEET_RUNBOOK.md`.
  - **Phase 3 — Engineering Observability & ESP32 Cycle Telemetry — Complete:** Optional `--profile engineering` Grafana OSS (`grafana/grafana:11.6.2`) dashboards (`esp_reset_reason()`, Wi-Fi RSSI, free heap, cycle duration, `wound_length`, Glossary deep-links), ESP32 internal cycle telemetry alignment (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`, `wound_length`), `/fleet` UI updates (`Winding Cycles (ESP32)`), and `tests/grafana-provisioning.test.ts` live TimescaleDB SQL verification. Voice-to-text, bug-report photos (`bug_reports.photo_path` stays unused/nullable), and QR/CRM `Redo` tracking are explicitly excluded; non-winder machine expansion is deferred. See `.scratch/phase-3-engineering/spec.md`, `.scratch/phase-3-engineering/issues/`, `docs/ENGINEERING_RUNBOOK.md`, and `PLAN.md`.

---

## 2. Technology Stack

| Layer | Technology & Verified Versions |
| :--- | :--- |
| **Runtime & Packaging** | Node.js 24 (`node:24-alpine` in `Dockerfile`), native ESM (`"type": "module"`), `pnpm@10.28.0` |
| **Language & Build** | TypeScript `^7.0.2` (`target: ES2023`, `module: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`), `tsx` `^4.23.15` |
| **HTTP & OpenAPI** | Fastify `^5.12.8`, `@fastify/swagger` `^9.9.5` (OpenAPI 3.0.3 at `/docs/json`), `@fastify/swagger-ui` `^6.1.4` (`/docs`) |
| **Validation & Auth** | Zod `^4.6.7` (strict MQTT/fault/bug-report schemas); built-in `node:crypto` RS256 JWKS JWT verification for Cloudflare Access |
| **Database** | PostgreSQL 16 + TimescaleDB (`timescale/timescaledb:latest-pg16`) via `pg` `^8.23.1` (`Pool`, raw parameterized SQL, no ORM) |
| **MQTT Broker & Client** | Eclipse Mosquitto 2 (`eclipse-mosquitto:2`, port `1883`) + `mqtt` `^5.16.1` |
| **Frontend (Worker & Fleet PWAs)** | Zero-CDN, zero-framework SSR HTML5 + embedded CSS (`@layer base, components`) + vanilla inline JS (form validation on `/m/*/report-bug`; tabs, filters, `<dialog>` drawer & 10s polling on `/fleet`) |
| **Remote Tunnel (Optional)** | `cloudflare/cloudflared:latest` under Compose `remote` profile (`docker-compose.yml`) |
| **Engineering Observability** | Grafana OSS (`grafana/grafana:11.6.2`) under optional Compose `engineering` profile (`:3001`), pre-provisioned TimescaleDB datasource & dashboards (`grafana/`) |
| **Testing** | Vitest `^5.1.1` (`vitest.config.ts` for unit + real-DB integration; `vitest.smoke.config.ts` for live Mosquitto LWT smoke test) |
| **External Integrations** | ESP32 Pico firmware over LAN MQTT (`spec/`); Android handheld Chrome browsers over LAN HTTP; optional Cloudflare Zero Trust (Tunnel + Access JWKS) |

---

## 3. Architecture Overview

The backend is a **single-process modular monolith** combining MQTT ingestion, OpenAPI JSON endpoints, zero-login SSR Worker Portal pages, and authenticated Department Heads Fleet PWA pages inside one Fastify application backed by PostgreSQL/TimescaleDB.

- **Primary Composition & Test Seam (`createApp(deps: AppDeps)` in `src/app.ts`):** Accepts `{ db: Pool, mqtt: MqttTransport, logger?, fleetAuth? }`. Production (`src/server.ts`) injects `createMosquittoTransport(MQTT_URL)` with Pino logging enabled by default and reads `CF_ACCESS_*` env vars via `loadCloudflareAccessConfigFromEnv()`; integration tests (`tests/helpers/test-app.ts`) inject `createInMemoryMqttTransport()` against a **real** PostgreSQL/TimescaleDB instance with `logger: false` and `fleetAuth: {}` (local LAN mode) by default.
- **Encapsulated Auth Boundary:** Fleet JSON APIs (`/api/fleet/*`) and Fleet PWA routes (`/fleet`, `/fleet/`, `/fleet/manifest.webmanifest`) are registered inside an encapsulated `app.register(...)` child plugin with a `preHandler` hook (`createFleetAuthPreHandler`). Worker Portal (`/`, `/m/*`), `/health`, `/docs`, and Phase 1 `/api/*` routes remain completely unauthenticated in all modes.
- **Acyclic Layering:** `server` → `app` → (`auth`, `routes`, `mqtt`, `db`) → (`services`, `ui`) → `spec` (with `auth` using `ui/portal-layout` for HTML auth error pages; `ui/fleet-layout` holds only a type-only import from `auth`).
- **Relational & Time-Series Schema (`db/init.sql`):**
  - **5 tables:** `machines`, `telemetry_events` (TimescaleDB hypertable partitioned on `time`), `coil_outcomes`, `error_glossary`, `bug_reports`.
  - **2 SQL rollup views:** `coil_rollup_machine` and `coil_rollup_room` aggregating `AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`, total counts, and `total_wound_length` across `TODAY`, `WEEK`, `MONTH`, and `ALL_TIME` via `date_trunc(..., NOW())`.

---

## 4. Project Structure & Module Responsibilities

### Root & Infrastructure

| Path | Responsibility |
| :--- | :--- |
| `package.json`, `pnpm-lock.yaml` | Scripts (`dev`, `start`, `typecheck`, `build`, `test`, `test:smoke`, `test:all`, `seed:pilot`, `seed:fleet`, `seed:full`) and dependencies |
| `tsconfig.json`, `tsconfig.build.json` | Strict ESM TypeScript config; production build compiles `src/**/*.ts` to `dist/src/` (`rootDir: "."`) |
| `vitest.config.ts`, `vitest.smoke.config.ts` | Default suite excludes `tests/smoke/**`; smoke config runs live Mosquitto tests with 20s timeouts |
| `Dockerfile`, `docker-compose.yml`, `.env.example` | Multi-stage Node 24 container, 3-service local LAN stack (`mosquitto`, `postgres`, `app`), optional `remote` (`cloudflared`) and `engineering` (`grafana`) profiles, and env template |
| `db/init.sql` | Idempotent TimescaleDB extension, 5 core tables (plus idempotent `coil_outcomes` Phase 3 evolution), indexes, domain `CHECK` constraints, and 2 coil rollup views |
| `grafana/provisioning/`, `grafana/dashboards/` | Provisioned TimescaleDB datasource (`telemetry-postgres`) and 2 engineering dashboards (`esp32-firmware-health`, `winding-cycle-telemetry`) |
| `mosquitto/mosquitto.conf` | LAN MQTT broker listener on `0.0.0.0:1883`, persistence enabled, `allow_anonymous true` (Phase 1 LAN default) |
| `PLAN.md` | High-level Phase 1 / 2 / 3 roadmap |

### Firmware Handoff Specs, Docs & Issue Tracker

| Path | Responsibility |
| :--- | :--- |
| `spec/error_codes.json` | Single source of truth for fault definitions (`error_code`, `title`, `symptoms`, `fix_steps_md`) shared by firmware enums and DB Glossary |
| `spec/MQTT_TOPICS.md` | Canonical MQTT topic, payload, retention, LWT `OFFLINE`, `< 1024` byte cap, and `coil` contract |
| `spec/ESP32_INTEGRATION.md` | Non-blocking Core 1/Core 0 FreeRTOS queue, RAM/LittleFS ring-buffer, `esp_reset_reason()` forensics, and payload sizing guide |
| `docs/PILOT_RUNBOOK.md` | Phase 1 shop-floor LAN deployment, printable QR URLs, MQTT simulation commands, and Android handheld checklist |
| `docs/FLEET_RUNBOOK.md`, `docs/fleet-seed.csv` | Phase 2 50-winder layout CSV (`W-01`–`W-50`), batch QR generation, and Cloudflare Zero Trust setup guide |
| `docs/ENGINEERING_RUNBOOK.md` | Phase 3 Grafana `--profile engineering` startup, `$app_url` deep-links, optional remote HTTPS setup, and ESP32 cycle verification |
| `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md` | Repository conventions for local issues, triage labels, and domain documentation |
| `.scratch/phase-1-pilot/` | Completed Phase 1 specification (`spec.md`) and 14 ticket files (`issues/`) |
| `.scratch/phase-2-fleet/` | Completed Phase 2 fleet/auth/tunnel specification (`spec.md`) and 9 ticket files (`issues/01`–`09`) |
| `.scratch/phase-3-engineering/` | Phase 3 specification (`spec.md`) and 8 ticket files (`issues/01`–`08`) |

### Source Code (`src/`)

| Path | Responsibility & Key Exports |
| :--- | :--- |
| `src/server.ts` | Process entrypoint: reads env vars, initializes DB pool + schema + pilot machines, connects Mosquitto, starts Fastify, handles `SIGINT`/`SIGTERM` |
| `src/app.ts` | `createApp(deps)`: seeds glossary, installs prototype-guarded `application/x-www-form-urlencoded` parser, Swagger/OpenAPI, `/health`, 3 MQTT subscribers, public API + Worker Portal routes, encapsulated Cloudflare-authenticated Fleet scope, and `onClose` MQTT cleanup |
| `src/auth/cloudflare-access.ts` | `loadCloudflareAccessConfigFromEnv`, `createFleetAuthPreHandler`, `CloudflareAccessConfig`, `FleetAuthUser` — RS256 JWKS verification (5 min cache + `kid`-miss refresh), email allowlist, local LAN fallback, fail-closed HTTP `503` on partial config |
| `src/spec/fault-registry.ts` | `ERROR_CODE_REGEX`, `errorCodeSchema`, `nonEmptyText`, `parseFaultRegistry`, `loadFaultRegistry` (reads `spec/error_codes.json` from `src/` or `dist/src/`) |
| `src/spec/mqtt-contract.ts` | Canonical constants (`MQTT_TOPIC_PREFIX`, `MAX_MQTT_PAYLOAD_BYTES`, `MACHINE_STATES`, `EVENT_TYPES`, `ERROR_EVENT_TYPES`, `COIL_OUTCOMES`, `BUG_REPORT_TAGS`, `FLOOR_ZONES`), strict Zod schemas (`statusPayloadSchema`, `eventPayloadSchema`, `coilPayloadSchema`), `parseMqttJsonPayload`, `parseWinderTopic`, `isErrorEvent` |
| `src/db/pool.ts` | `createDbPool`, `ensureSchema` (executes `db/init.sql` under `pg_advisory_lock(7391824)` for concurrent safety) |
| `src/db/seed-glossary.ts` | `seedGlossary`: idempotent sorted `UNNEST` upsert from `spec/error_codes.json` into `error_glossary` |
| `src/db/seed-pilot-machines.ts` | `PILOT_MACHINES` (`W-01`, `W-02`), `seedPilotMachines` (preserves live telemetry), `runPilotSeedCli` (`pnpm seed:pilot`) |
| `src/db/seed-fleet-machines.ts` | `parseFleetSeedCsv`, `loadFleetSeedCsv`, `seedFleetMachines`, `runFleetSeedCli` (`pnpm seed:fleet` / `pnpm seed:full`) — validates CSV headers/zones/unique IDs & grid slots, idempotently upserts preserving live telemetry |
| `src/mqtt/transport.ts` | `MqttTransport` / `InMemoryMqttTransport` interfaces, `createMosquittoTransport`, `createInMemoryMqttTransport` (`+` and `#` wildcards) |
| `src/mqtt/ingestion-helpers.ts` | `subscribeWinderChannel` (topic/size/JSON/Zod validation + warning/error isolation), `parseMqttTimestamp`, `MqttIngestionLogger` |
| `src/mqtt/status-ingestion.ts` | `registerStatusIngestion`: subscribes to `factory/winders/+/status`, updates `machines` state/active_error/last_seen_at |
| `src/mqtt/events-ingestion.ts` | `registerEventsIngestion`: subscribes to `factory/winders/+/events`, appends validated records to `telemetry_events` |
| `src/mqtt/coil-ingestion.ts` | `registerCoilIngestion`: subscribes to `factory/winders/+/coil`, appends `AUTO_FINISHED`/`ABORTED`/`FAULT_TERMINATED` + optional `wound_length` records to `coil_outcomes` |
| `src/services/machines.ts` | `MACHINE_COLUMNS`, `mapMachineRow`, `listMachines`, `getMachineById`, `normalizeMachineId` |
| `src/services/telemetry-events.ts` | `deriveErrorSummary`, `listRecentEvents` (`limit` 1..100, `errorsOnly`), `listRecentErrorSummaries` (joined with `error_glossary.title`) |
| `src/services/glossary.ts` | `queryGlossary`: escaped `ILIKE` search across code/title/symptoms/fix steps with optional machine `active_error` pinning |
| `src/services/bug-reports.ts` | `createBugReportBodySchema`, `isValidBugReportTag`, `createBugReport` (transactional 20-event snapshot), `listBugReports` |
| `src/services/coil-rollups.ts` | `getMachineCoilRollups`, `getRoomCoilRollups` querying `coil_rollup_machine` and `coil_rollup_room` |
| `src/services/fleet.ts` | `getFleetSummary`, `listFleetMachines`, `getFleetMachineDetails`, `listFleetHistory`, `FLEET_HISTORY_KINDS` |
| `src/routes/api-schemas.ts` | Shared OpenAPI schemas (`machineNotFoundResponseSchema`, `machineRecordResponseSchema`, `coilRollupBucketResponseSchema`, `glossaryEntryResponseSchema`, `telemetryEventResponseSchema`, `bugReportRecordResponseSchema`) and `sendMachineNotFound` |
| `src/routes/machines-api.ts` | `GET /api/machines/:machineId` |
| `src/routes/events-api.ts` | `GET /api/machines/:machineId/events` |
| `src/routes/glossary-api.ts` | `GET /api/glossary` |
| `src/routes/bug-reports-api.ts` | `POST` and `GET /api/machines/:machineId/bug-reports` (uses strict route-scoped Zod `validatorCompiler`) |
| `src/routes/coils-api.ts` | `GET /api/machines/:machineId/coils/rollups` and `GET /api/coils/rollups` |
| `src/routes/fleet-api.ts` | Authenticated `GET /api/fleet/summary`, `/api/fleet/machines`, `/api/fleet/machines/:machineId/details`, `/api/fleet/history` |
| `src/routes/worker-portal.ts` | Public SSR HTML (`schema: { hide: true }`): `GET /`, `GET /m`, `GET /m/:machineId` |
| `src/routes/worker-glossary.ts` | Public SSR HTML: `GET /m/:machineId/glossary` (active-error pinning, search, Markdown fix steps) |
| `src/routes/worker-bug-report.ts` | Public SSR HTML: `GET` and `POST /m/:machineId/report-bug` (1-tap radio cards, note preservation on 400, 201 confirmation) |
| `src/routes/fleet-portal.ts` | Authenticated SSR HTML & manifest (`schema: { hide: true }`): `GET /fleet`, `GET /fleet/`, `GET /fleet/manifest.webmanifest` |
| `src/ui/portal-layout.ts` | `escapeHtml`, `renderPortalLayout` (zero-CDN CSS shell), `renderStatusBadge`, `renderErrorCodeBadge`, `renderUnknownMachinePage` |
| `src/ui/markdown.ts` | `renderMarkdownToHtml` (safe escaped ordered/unordered lists, inline code, paragraphs) |
| `src/ui/recent-errors-section.ts` | `formatTimestampUtc`, `renderRecentErrorsSection` (up to 5 newest faults) |
| `src/ui/fleet-layout.ts` | `renderFleetDashboardPage`, `renderHistoryItemsHtml` — zero-CDN `/fleet` PWA shell (summary strip, 3 accessible tabs, L-shaped CSS Grid map, filter pills, `<dialog closedby="any">` drawer, 10s polling) |

### Tests (`tests/`)

| Path | Responsibility |
| :--- | :--- |
| `tests/helpers/test-app.ts` | `createTestApp(options?)`: real PostgreSQL/TimescaleDB + `ensureSchema` + `createInMemoryMqttTransport()` + optional `fleetAuth` |
| `tests/fault-registry.test.ts`, `tests/mqtt-contract.test.ts`, `tests/mqtt-ingestion-helpers.test.ts`, `tests/mqtt-transport.test.ts` | Pure unit tests (no DB required) |
| `tests/fleet-api.test.ts`, `tests/fleet-portal.test.ts`, `tests/cloudflare-auth.test.ts`, `tests/fleet-seed.test.ts` | Phase 2 integration tests covering Fleet APIs, `/fleet` PWA, RS256 Cloudflare Access JWT auth, and 50-winder CSV seeding |
| `tests/grafana-provisioning.test.ts` | Phase 3 provisioning YAML, dashboard JSON & Compose profile validation (pure) plus real TimescaleDB SQL execution across every panel query |
| `tests/*.test.ts` (remaining 12 Phase 1 files) | Phase 1 end-to-end behavioral integration tests across `app.inject()`, in-memory MQTT emit, and real PostgreSQL/TimescaleDB |
| `tests/smoke/lwt-offline.smoke.test.ts` | Live Mosquitto TCP socket-drop test proving broker-published LWT transitions a machine to `OFFLINE` in DB and Worker Portal |

---

## 5. Application Execution Flow

### Server Startup & Shutdown (`src/server.ts` → `src/app.ts`)
1. Read `DATABASE_URL`, `MQTT_URL`, `HOST`, `PORT` from `process.env` (with local defaults).
2. `createDbPool(DATABASE_URL)` → `await ensureSchema(db)` (advisory-locked execution of `db/init.sql`) → `await seedPilotMachines(db)` (idempotently ensures `W-01` and `W-02` exist without touching telemetry columns).
3. `createMosquittoTransport(MQTT_URL)` connects to Mosquitto.
4. `await createApp({ db, mqtt })`:
   - `await seedGlossary(db)` upserts `spec/error_codes.json` into `error_glossary`.
   - Instantiates Fastify (`logger: deps.logger ?? true`), installs form-urlencoded parser, registers `@fastify/swagger` & `@fastify/swagger-ui` (`/docs`), registers `GET /health`.
   - Subscribes MQTT handlers (`events`, `status`, `coil`).
   - Registers all public JSON API routes and Worker Portal SSR routes.
   - Loads `fleetAuth` (`deps.fleetAuth ?? loadCloudflareAccessConfigFromEnv()`) and registers Fleet APIs + Fleet PWA inside an encapsulated plugin protected by `createFleetAuthPreHandler`.
   - Hooks `onClose` to call `deps.mqtt.close()`.
5. `app.listen({ host, port })`. On `SIGINT` or `SIGTERM`, closes Fastify (which closes MQTT) and ends the `pg` pool.
6. **Note:** `createApp()` seeds the glossary but intentionally does **not** call `seedPilotMachines()` or `seedFleetMachines()` so integration tests control machine fixtures explicitly. Standalone seeding runs via `pnpm seed:pilot` or `pnpm seed:fleet`.

### HTTP Endpoint Map

| Method & Path | Module | Auth | OpenAPI | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GET /health` | `src/app.ts` | Public | Yes | DB connectivity check (`SELECT 1` → `200` or `503`) |
| `GET /docs`, `/docs/json` | `src/app.ts` | Public | Yes | Swagger UI and OpenAPI 3.0.3 JSON |
| `GET /api/machines/:machineId` | `src/routes/machines-api.ts` | Public | Yes | Machine metadata, state, `active_error`, `last_seen_at` |
| `GET /api/machines/:machineId/events` | `src/routes/events-api.ts` | Public | Yes | Recent events (`?limit=1..100&errorsOnly=bool`) |
| `GET /api/glossary` | `src/routes/glossary-api.ts` | Public | Yes | Search glossary (`?q=&machineId=`) with active-error pinning |
| `POST`, `GET /api/machines/:machineId/bug-reports` | `src/routes/bug-reports-api.ts` | Public | Yes | Create bug report with atomic 20-event snapshot / list machine reports |
| `GET /api/machines/:machineId/coils/rollups` | `src/routes/coils-api.ts` | Public | Yes | Machine `TODAY`/`WEEK`/`MONTH`/`ALL_TIME` coil rollups |
| `GET /api/coils/rollups` | `src/routes/coils-api.ts` | Public | Yes | Room-wide coil rollups |
| `GET /api/fleet/summary` | `src/routes/fleet-api.ts` | Fleet Auth* | Yes | Room-wide machine state counts, open bug count, 4-window coil rollups |
| `GET /api/fleet/machines` | `src/routes/fleet-api.ts` | Fleet Auth* | Yes | All machines sorted by zone/grid (`?state=&zone=`) |
| `GET /api/fleet/machines/:machineId/details` | `src/routes/fleet-api.ts` | Fleet Auth* | Yes | Drill-down payload: machine, active glossary, 5 errors, 5 bug reports, rollups, portal URL |
| `GET /api/fleet/history` | `src/routes/fleet-api.ts` | Fleet Auth* | Yes | Merged fault events & bug reports newest-first (`?limit=&machineId=&zone=&kind=`) |
| `GET /`, `GET /m`, `GET /m/:machineId` | `src/routes/worker-portal.ts` | Public | Hidden | Worker Portal machine directory, 404 recovery, machine landing page |
| `GET /m/:machineId/glossary` | `src/routes/worker-glossary.ts` | Public | Hidden | Worker Portal Glossary/FAQ with pinned active error & search |
| `GET`, `POST /m/:machineId/report-bug` | `src/routes/worker-bug-report.ts` | Public | Hidden | Worker Portal 1-tap bug report form & confirmation screen |
| `GET /fleet`, `/fleet/`, `/fleet/manifest.webmanifest` | `src/routes/fleet-portal.ts` | Fleet Auth* | Hidden | Department Heads Fleet PWA & web app manifest |

*\*Fleet Auth runs Cloudflare Access RS256 JWT verification when `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` are set, local LAN fallback when both are unset, and HTTP `503` fail-closed when only one is set.*

---

## 6. Data Flow & Communication

### MQTT Telemetry Ingestion
ESP32 Pico → Mosquitto (`:1883`) → `MqttTransport` → `subscribeWinderChannel` (`src/mqtt/ingestion-helpers.ts`) on three per-channel filters (`factory/winders/+/status`, `factory/winders/+/events`, `factory/winders/+/coil`):
- **Shared Guardrails:** Validates topic syntax (`parseWinderTopic`), UTF-8 payload byte size `< 1024`, JSON parsing, and strict Zod schema (`src/spec/mqtt-contract.ts`). Invalid payloads or unregistered machine IDs log structured warnings and are ignored without interrupting the subscriber loop.
- **`status` (`src/mqtt/status-ingestion.ts`):** Updates `machines.current_state` and `last_seen_at = NOW()`. Clears `active_error` (`NULL`) on `WORKING`/`IDLE`; sets `active_error = payload.error_code ?? null` on `ERROR`; **preserves** existing `active_error` on `OFFLINE` when `error_code` is omitted (so broker LWT `{"state":"OFFLINE"}` retains the pre-outage fault).
- **`events` (`src/mqtt/events-ingestion.ts`):** Normalizes optional `ts` via `parseMqttTimestamp` (strict ISO-8601, epoch seconds `>= 1e9`, epoch ms `>= 1e12`, or monotonic uptime `< 1e9` → server time) and persists into `telemetry_events` via `INSERT ... SELECT FROM machines WHERE id = $5`.
- **`coil` (`src/mqtt/coil-ingestion.ts`):** Accepts only `AUTO_FINISHED`, `ABORTED`, or `FAULT_TERMINATED` plus optional `wound_length` (CRM/QR statuses `COMPLETED`, `FAILED`, and `REDO` are rejected), normalizes `ts`, and persists into `coil_outcomes` via `INSERT ... SELECT FROM machines`. SQL views `coil_rollup_machine` and `coil_rollup_room` compute live rollups directly over `coil_outcomes`.

### Worker Portal, Fleet PWA & Bug Report Flows
- **Shared Services:** SSR routes (`worker-*.ts`, `fleet-portal.ts`) and JSON APIs share query services under `src/services/*` over the injected `pg` `Pool`. Error-class events (`error_code IS NOT NULL` or `event_type` in `ERROR_EVENT_TYPES`) join `error_glossary` for human-readable titles.
- **Bug Report Creation (`createBugReport` in `src/services/bug-reports.ts`):** Both `POST /api/machines/:machineId/bug-reports` and `POST /m/:machineId/report-bug` execute a single PostgreSQL transaction (`BEGIN` → read `machines.active_error` → select newest 20 rows from `telemetry_events` → insert `bug_reports` with `attached_logs_json` → `COMMIT`).
- **Fleet Live Updates:** `GET /fleet` renders initial SSR HTML + inline JSON bootstrap; client JS polls `/api/fleet/summary`, `/api/fleet/machines`, and `/api/fleet/history` every 10s while visible, and fetches `/api/fleet/machines/:id/details` on drawer open.

---

## 7. Development Workflow

- **Prerequisites:** Node.js 24+, `pnpm@10.28.0`, and Docker Compose (for local PostgreSQL/TimescaleDB + Mosquitto).
- **Environment Variables** (see `.env.example`):
  - Core runtime: `DATABASE_URL` (default `postgresql://telemetry:telemetry@localhost:5432/telemetry`), `MQTT_URL` (default `mqtt://localhost:1883`), `HOST` (default `0.0.0.0`), `PORT` (default `3000`).
  - Docker Compose Postgres: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (all default to `telemetry`).
  - Optional Remote / Cloudflare Access: `CF_TOKEN` (required for `--profile remote`), `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CF_ACCESS_ALLOWED_EMAILS` (or `FLEET_ALLOWED_EMAILS`).
  - Optional Engineering Observability (`--profile engineering`): `GRAFANA_PORT` (default `3001`), `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` (default `admin`), `GRAFANA_ROOT_URL` (default `http://localhost:3001`).
  - Tests: `TEST_DATABASE_URL` (falls back to `DATABASE_URL`), `SMOKE_MQTT_URL` (falls back to `MQTT_URL` / `mqtt://127.0.0.1:1883`), `SMOKE_APP_URL` (optional live container URL for smoke test).
- **Common Commands:**
  - `docker compose up -d postgres mosquitto` — start local DB & broker for dev/testing
  - `docker compose up -d --build` — start 3-container local LAN stack
  - `docker compose --profile remote up -d --build` — start stack + `cloudflared` HTTPS tunnel (requires `CF_TOKEN`)
  - `docker compose --profile engineering up -d --build` — start local LAN stack + Grafana OSS (`:3001`)
  - `docker compose --profile engineering --profile remote up -d --build` — start stack + Grafana + `cloudflared` HTTPS tunnel
  - `pnpm dev` — run server with `tsx src/server.ts`
  - `pnpm typecheck` — run `tsc --noEmit` across `src/` and `tests/`
  - `pnpm build` — compile `src/` to `dist/src/` via `tsconfig.build.json`
  - `pnpm start` — run compiled `node dist/src/server.js`
  - `pnpm seed:pilot` — idempotently initialize schema, seed glossary, and seed `W-01` / `W-02`
  - `pnpm seed:fleet` (alias `pnpm seed:full`) — validate `docs/fleet-seed.csv` and idempotently seed all 50 winders (`-- --file <path>` supported)
- **Asset Resolution Note:** `src/db/pool.ts` (`db/init.sql`) and `src/spec/fault-registry.ts` (`spec/error_codes.json`) probe both `../../` and `../../../` relative to `import.meta.url` so they work under both `tsx src/` and compiled `node dist/src/`. Note that `src/db/seed-fleet-machines.ts` currently resolves `../../docs/fleet-seed.csv` only (intended for `tsx` execution; `Dockerfile` does not copy `docs/`).

---

## 8. Testing & Validation

- **Testing Philosophy:** Verify external behavior across public seams (HTTP responses via `app.inject()`, rendered SSR HTML, MQTT emissions via `createInMemoryMqttTransport()`, and persisted PostgreSQL/TimescaleDB rows). Do **not** mock SQL queries or internal helpers.
- **Commands:**
  - `pnpm test` — runs `vitest.config.ts` (21 test files, 94 tests: 4 pure unit suites + Grafana provisioning/Compose & live panel SQL verification + 16 real-DB integration suites; excludes `tests/smoke/**`). Requires live PostgreSQL/TimescaleDB.
  - `pnpm test:smoke` — runs `vitest.smoke.config.ts` (`tests/smoke/lwt-offline.smoke.test.ts`). Requires live Mosquitto + PostgreSQL/TimescaleDB; set `SMOKE_APP_URL=http://127.0.0.1:3000` to target the Docker `app` container.
  - `pnpm test:all` — runs both `pnpm test` and `pnpm test:smoke`.
- **Shared DB Concurrency Rules:** Vitest runs integration test files concurrently against the same `telemetry` database. Always namespace test machine IDs uniquely (e.g., `TEST-*` or UUID suffixes) and clean up rows in `afterEach`/`afterAll`/`finally`. Keep schema/seed writes idempotent and ordered (`pg_advisory_lock` + sorted `UNNEST` upserts). **Known flake risk:** room-wide `coil_outcomes` delta assertions in `tests/coil-outcomes.test.ts` can race if another parallel suite inserts into `coil_outcomes` concurrently (`tests/fleet-api.test.ts` uses concurrency-safe invariant checks in its summary test and avoids mutating `coil_outcomes` there); run with `--no-file-parallelism` when isolating room-wide counts.

---

## 9. Architectural Constraints

### Canonical Domain Vocabulary (Enforced in `spec/`, `db/init.sql`, `src/spec/mqtt-contract.ts`)
- **Machine states:** `WORKING`, `IDLE`, `ERROR`, `OFFLINE`
- **Coil outcomes:** `AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED` plus optional `wound_length` (**CRM/QR statuses `COMPLETED`, `FAILED`, and `REDO` are explicitly excluded**)
- **Floor zones:** `NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`
- **Bug report quick tags:** `Fiber Snap`, `Tension`, `Unit Dead`, `Bobbin Jam`, `Other`
- **Fault codes (`error_code`):** Uppercase C++ enum identifier matching `^[A-Z](?:[A-Z0-9]|_[A-Z0-9])*$`, defined canonically in `spec/error_codes.json`.

### Hard Engineering & UX Invariants
- **MQTT & Firmware:** Payloads strictly `< 1024` UTF-8 bytes; strict schemas (no unknown properties); retained `status` with LWT `{"state":"OFFLINE"}`; non-retained `events` and `coil`; never edit external ESP32 C++ firmware directly—update the `spec/` contract kit instead.
- **Worker & Fleet UI:** Zero login on `/` and `/m/*` (Cloudflare Access scoped strictly to `/fleet*` and `/api/fleet/*`); zero external CDNs or runtime font/CSS/JS fetches; mobile-first touch targets (`>= 48px`, `52px` on `pointer: coarse`); non-color status indicators + `forced-colors` support; escape all dynamic HTML via `escapeHtml`; omit Web Speech API (operators use Android's native keyboard mic); keep HTML/manifest routes hidden from OpenAPI (`schema: { hide: true }`).
- **Code & Data Conventions:** Use `.js` extensions on all relative TypeScript imports (`NodeNext`); keep `strict: true` and `noUncheckedIndexedAccess: true` green; use parameterized `pg` queries; never overwrite live `current_state`, `active_error`, or `last_seen_at` during machine seeding.

### Known Technical Debt & Limitations
- **No linter, formatter, or CI workflow:** `package.json` has no ESLint/Prettier/Biome script and there is no `.github/workflows/` pipeline; `pnpm typecheck`, `pnpm build`, and `pnpm test` are the active verification gates.
- **LAN-only anonymous MQTT:** `mosquitto/mosquitto.conf` sets `allow_anonymous true`; credentials/ACL hardening is required before exposing beyond trusted LAN.
- **No DB migration framework:** `db/init.sql` relies on idempotent `CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, guarded `DO $$ ... $$` constraint/view upgrades, and `CREATE OR REPLACE VIEW`; destructive schema changes require explicit migration scripts.
- **Database clock rollups:** `coil_rollup_machine` and `coil_rollup_room` truncate `NOW()` in PostgreSQL's session timezone (UTC in the default container) rather than a configurable factory local timezone.
- **Shared integration test DB:** Test files execute concurrently against one Postgres database; room-wide `coil_outcomes` delta checks in `tests/coil-outcomes.test.ts` assume no concurrent suite writes to `coil_outcomes` (`tests/fleet-api.test.ts` avoids mutating `coil_outcomes` in its room-summary test and uses invariant checks).
- **Compiled CSV path resolution:** `src/db/seed-fleet-machines.ts` resolves `docs/fleet-seed.csv` only via `../../docs/` (for `tsx`), not `../../../docs/` for `dist/src/`, and `Dockerfile` does not copy `docs/`.
- **Minor doc/spec drift to be aware of:**
  - Root `README.md`, `GLOSSARY.md`, and `docs/adr/` do not exist yet.

---

## 10. Agent Operating Guidelines

### Future Agent Efficiency Rules
- **Read root `AGENTS.md` first** before starting any task.
- **Use the project map above** to locate relevant files and seams before exploring.
- **Do not repeatedly scan the entire repository** or rediscover architecture already documented here.
- **Scope exploration narrowly** to modules relevant to the current task; expand only when imports, schemas, or dependencies require it.
- **Verify before modifying:** Never assume documented details are up to date without inspecting the actual source file you are about to edit.
- **Keep this map synchronized:** Whenever you add/remove modules, HTTP routes, MQTT topics, DB tables/views, scripts, or architectural patterns, update `AGENTS.md` in the same change.

### Agent Skills & Project Conventions

#### Issue tracker
Local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

#### Triage labels
Default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

#### Domain docs
Single-context (`GLOSSARY.md` + `docs/adr/` at repo root — configured target convention, not yet created in repo). See `docs/agents/domain.md`.

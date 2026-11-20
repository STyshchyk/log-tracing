# Architecture & Data Flow Reference

Detailed execution flows, data ingestion rules, and known technical limitations for `log-telemetry`. For the quick module map and always-loaded rules, see root `AGENTS.md` and `.agents/rules/ops-gotchas.md`.

---

## 1. Phase History & Runbooks

- **Phase 1 — Pilot (`W-01`, `W-02`) — Complete:** Firmware handoff kit (`spec/`), Docker Compose stack (`mosquitto`, `postgres`, `app`), MQTT ingestion (`status`, `events`, `coil`), OpenAPI JSON APIs, SSR Worker Portal (`/`, `/m/:machineId`, `/m/:machineId/glossary`, `/m/:machineId/report-bug`), idempotent pilot/glossary seeding, and live Mosquitto LWT smoke test. See `.scratch/phase-1-pilot/spec.md` and `docs/PILOT_RUNBOOK.md`.
- **Phase 2 — Full-Floor Fleet & Remote Access — Complete:** Department Heads `/fleet` PWA (L-shaped floor map, summary strip, `<dialog>` drill-down drawer, Room History, Master Glossary, web manifest), `/api/fleet/*` OpenAPI endpoints, zero-dependency `node:crypto` Cloudflare Access RS256 JWT middleware, `docker-compose.yml` optional `remote` `cloudflared` profile, `.env.example`, and 50-winder CSV seeder (`docs/fleet-seed.csv`, `pnpm seed:fleet`). See `.scratch/phase-2-fleet/spec.md` and `docs/FLEET_RUNBOOK.md`.
- **Phase 3 — Engineering Observability & ESP32 Cycle Telemetry — Complete:** Optional `--profile engineering` Grafana OSS (`grafana/grafana:11.6.2`) dashboards (`esp_reset_reason()`, Wi-Fi RSSI, free heap, cycle duration, `wound_length`, Glossary deep-links), ESP32 internal cycle telemetry alignment (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`, `wound_length`), `/fleet` UI updates (`Winding Cycles (ESP32)`), and `tests/grafana-provisioning.test.ts` live TimescaleDB SQL verification. See `.scratch/phase-3-engineering/spec.md`, `docs/ENGINEERING_RUNBOOK.md`, and `PLAN.md`.

---

## 2. Server Startup & Shutdown (`src/server.ts` → `src/app.ts`)

1. Read `DATABASE_URL`, `MQTT_URL`, `HOST`, `PORT` from `process.env` (with local defaults).
2. `createDbPool(DATABASE_URL)` → `await ensureSchema(db)` (advisory-locked execution of `db/init.sql`) → `await seedPilotMachines(db)` (idempotently ensures `W-01` and `W-02` exist without touching telemetry columns).
3. `createMosquittoTransport(MQTT_URL)` connects to Mosquitto.
4. `await createApp({ db, mqtt })`:
   - `await seedGlossary(db)` upserts `spec/error_codes.json` into `error_glossary`.
   - Instantiates Fastify (`logger: deps.logger ?? true`), installs prototype-guarded form-urlencoded parser, registers `@fastify/swagger` & `@fastify/swagger-ui` (`/docs`), registers `GET /health`.
   - Subscribes MQTT handlers (`events`, `status`, `coil`).
   - Registers all public JSON API routes and Worker Portal SSR routes.
   - Loads `fleetAuth` (`deps.fleetAuth ?? loadCloudflareAccessConfigFromEnv()`) and registers Fleet APIs + Fleet PWA inside an encapsulated plugin protected by `createFleetAuthPreHandler`.
   - Hooks `onClose` to call `deps.mqtt.close()`.
5. `app.listen({ host, port })`. On `SIGINT` or `SIGTERM`, closes Fastify (which closes MQTT) and ends the `pg` pool.
6. **Seeding Note:** `createApp()` seeds the glossary but intentionally does **not** call `seedPilotMachines()` or `seedFleetMachines()` so integration tests control machine fixtures explicitly. Standalone seeding runs via `pnpm seed:pilot` or `pnpm seed:fleet`.

---

## 3. Data Flow & Communication

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

## 4. Environment Variables (see `.env.example`)

- **Core runtime:** `DATABASE_URL` (default `postgresql://telemetry:telemetry@localhost:5432/telemetry`), `MQTT_URL` (default `mqtt://localhost:1883`), `HOST` (default `0.0.0.0`), `PORT` (default `3000`).
- **Docker Compose Postgres:** `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (all default to `telemetry`).
- **Optional Remote / Cloudflare Access (`--profile remote`):** `CF_TOKEN`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CF_ACCESS_ALLOWED_EMAILS` (or `FLEET_ALLOWED_EMAILS`).
- **Optional Engineering Observability (`--profile engineering`):** `GRAFANA_PORT` (default `3001`), `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` (default `admin`), `GRAFANA_ROOT_URL` (default `http://localhost:3001`).
- **Tests:** `TEST_DATABASE_URL` (falls back to `DATABASE_URL`), `SMOKE_MQTT_URL` (falls back to `MQTT_URL` / `mqtt://127.0.0.1:1883`), `SMOKE_APP_URL` (optional live container URL for smoke test).

---

## 5. Known Technical Debt & Implementation Notes

- **Asset Resolution:** `src/db/pool.ts` (`db/init.sql`) and `src/spec/fault-registry.ts` (`spec/error_codes.json`) probe both `../../` and `../../../` relative to `import.meta.url` so they work under both `tsx src/` and compiled `node dist/src/`. `src/db/seed-fleet-machines.ts` currently resolves `../../docs/fleet-seed.csv` only (intended for `tsx` execution; `Dockerfile` does not copy `docs/`).
- **No linter, formatter, or CI workflow:** `package.json` has no ESLint/Prettier/Biome script and there is no `.github/workflows/` pipeline; `pnpm typecheck`, `pnpm build`, and `pnpm test` are the active verification gates.
- **LAN-only anonymous MQTT:** `mosquitto/mosquitto.conf` sets `allow_anonymous true`; credentials/ACL hardening is required before exposing beyond trusted LAN.
- **No DB migration framework:** `db/init.sql` relies on idempotent `CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and guarded `DO $$ ... $$` blocks; destructive schema changes require explicit migration scripts.
- **Database clock rollups:** `coil_rollup_machine` and `coil_rollup_room` truncate `NOW()` in PostgreSQL's session timezone (UTC in the default container) rather than a configurable factory local timezone.
- **Pending target docs:** Root `README.md`, `GLOSSARY.md`, and `docs/adr/` do not exist yet.

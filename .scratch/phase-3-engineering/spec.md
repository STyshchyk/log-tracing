# Phase 3 — Engineering Observability & ESP32 Cycle Telemetry

Status: done

## Problem Statement

With Phase 1 (Worker Portal & MQTT ingestion) and Phase 2 (Department Heads `/fleet` PWA, 50-winder CSV seeding, and optional Cloudflare Zero Trust remote access) in place, two engineering gaps remain:

1. **No time-series engineering observability:** Firmware engineers currently lack time-series dashboards for `esp_reset_reason()` brownout/watchdog crash forensics, Wi-Fi RSSI degradation, free heap / `min_free_heap` memory trends, winding cycle duration distributions, wound fiber output, and deep-links from anomalous events straight into the Worker Portal and plain-English Fault Glossary.
2. **CRM-shaped cycle statuses and missing wound fiber length:** The Phase 1/2 `coil_outcomes` contract (`COMPLETED` / `ABORTED`) and `/fleet` UI labels resemble external third-party QR/CRM workflow outcomes that this system does not own or integrate with. In practice, only ESP32 internal cycle telemetry is available: cycle start, automatic finish when the target program completes, explicit abort, unexpected fault termination, duration, and total length of wound fiber.

## Solution

Deliver Phase 3 across two coordinated tracks while keeping the zero-login Worker Portal (`/`, `/m/*`), existing 5-table relational/TimescaleDB footprint, and zero-extra-QR-scan shop-floor invariant completely intact:

1. **Track A — ESP32 Internal Cycle Telemetry Alignment:** Update the `factory/winders/{machineId}/coil` contract, `coil_outcomes` schema and rollup views (`db/init.sql`), MQTT ingestion (`src/mqtt/coil-ingestion.ts`), rollup/fleet services and OpenAPI schemas, and the Department Heads `/fleet` PWA (`src/ui/fleet-layout.ts`) to capture ESP32 internal stop modes (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`) plus optional `wound_length` (total wound fiber length) without any QR/CRM labels (`COMPLETED`, `REDO`, `FAILED`).
2. **Track B — Optional Grafana OSS Engineering Stack (`--profile engineering`):** Add a pre-provisioned `grafana/grafana:11.6.2` service under Compose `profiles: ["engineering"]` on LAN port `3001` (and optionally routable through `cloudflared` + Cloudflare Access when combined with `--profile remote`), wired to PostgreSQL/TimescaleDB (`uid: telemetry-postgres`, `timescaledb: true`) with two provisioned dashboards (`ESP32 Firmware & Hardware Diagnostics` and `Winding Cycle Telemetry & Reliability`), Glossary/Worker Portal deep-links, automated SQL verification tests, and `docs/ENGINEERING_RUNBOOK.md`.

## User Stories

1. As a firmware engineer, I want to start an optional Grafana OSS stack (`docker compose --profile engineering up -d`) on the local LAN (`:3001`) without altering the default 3-container shop-floor runtime, so that production winders and the Worker Portal remain unaffected when Grafana is stopped.
2. As a firmware engineer, I want a pre-provisioned TimescaleDB datasource and dashboard showing `esp_reset_reason()` crash/boot history, Wi-Fi RSSI over time, free heap / `min_free_heap` memory trends, and subsystem timeouts, so that I can diagnose intermittent freezes, brownouts, and RF dead zones without writing manual SQL queries.
3. As a firmware engineer, I want every fault and `reason_code` row in Grafana tables to include clickable deep-links into `/m/<machineId>` and `/m/<machineId>/glossary?q=<error_code>`, so that engineers can jump straight from a telemetry spike to plain-English troubleshooting steps.
4. As a firmware engineer, I want the ESP32 `coil` telemetry contract to record internal program stop modes (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`) alongside optional total `wound_length` and `duration_sec`, so that backend records accurately reflect what the ESP32 winding controller actually knows.
5. As a department head, I want `/fleet` summary cards and machine drill-down tables to display ESP32 cycle telemetry (`Auto-Finished`, `Aborted`, `Fault-Stopped`, `Wound Fiber`) instead of third-party CRM/QR labels (`Completed`, `Redo`), so that dashboard numbers match actual machine controller behavior.
6. As a department head or engineer working remotely, I want the ability to expose Grafana over HTTPS behind Cloudflare Tunnel + Cloudflare Access when both `--profile engineering` and `--profile remote` are enabled, so that engineering dashboards are protected off-LAN just like `/fleet`.
7. As a shop-floor operator, I want `/m/:machineId`, `/m/:machineId/glossary`, and `/m/:machineId/report-bug` to remain zero-login, text/quick-tag based (no voice-to-text API, no camera/photo upload steps), and free of extra QR scans during normal winding cycles.
8. As a maintainer, I want automated integration tests executing every provisioned Grafana panel SQL query against a real PostgreSQL/TimescaleDB instance and validating legacy `COMPLETED` -> `AUTO_FINISHED` DB migration idempotency, so that schema changes never silently break dashboards.

## Implementation Decisions

- **Track A — ESP32 Internal Cycle Telemetry (`factory/winders/{machineId}/coil`):**
  - Replace `COIL_OUTCOMES` (`COMPLETED`, `ABORTED`) in `src/spec/mqtt-contract.ts`, `spec/MQTT_TOPICS.md`, and `spec/ESP32_INTEGRATION.md` with:
    - `AUTO_FINISHED`: ESP32 winding program reached its target goal and stopped automatically.
    - `ABORTED`: Winding cycle was explicitly aborted/stopped before automatic finish.
    - `FAULT_TERMINATED`: Winding cycle was terminated unexpectedly by a fault or abnormal controller stop (e.g., fiber snap, bobbin jam, subsystem timeout, crash/reset).
  - Strictly reject CRM/QR statuses (`REDO`, `COMPLETED`, `FAILED`, etc.) in `coilPayloadSchema` while preserving the `< 1024`-byte UTF-8 JSON limit and strict unknown-key rejection.
  - Add optional `wound_length` (`z.number().finite().nonnegative().optional()`) to `coilPayloadSchema`, capturing total wound fiber length between cycle start and stop. Keep the field unit-agnostic in the backend/DB (`DOUBLE PRECISION NULL CHECK (wound_length IS NULL OR wound_length >= 0)`), documented as the firmware's configured linear unit (default meters; confirm exact physical unit label with the firmware developer prior to flashing).
  - Preserve optional `reason_code` (`nonEmptyText.nullish()`), `duration_sec` (`z.number().int().nonnegative().optional()`), and `ts`.
- **Idempotent PostgreSQL/TimescaleDB Evolution (`db/init.sql`):**
  - Add `wound_length DOUBLE PRECISION NULL CHECK (wound_length IS NULL OR wound_length >= 0)` to `coil_outcomes` both in `CREATE TABLE IF NOT EXISTS` and via `ALTER TABLE coil_outcomes ADD COLUMN IF NOT EXISTS ...`.
  - Add an idempotent `DO $$ ... END $$;` block inside `db/init.sql` (safe under `ensureSchema` / `pg_advisory_lock(7391824)`) that drops any prior `coil_outcomes` `outcome` check constraint (`pg_constraint` lookup on `conrelid = 'coil_outcomes'::regclass`), migrates any legacy `'COMPLETED'` rows to `'AUTO_FINISHED'`, and attaches `CHECK (outcome IN ('AUTO_FINISHED', 'ABORTED', 'FAULT_TERMINATED'))`.
  - Because PostgreSQL `CREATE OR REPLACE VIEW` cannot rename or drop existing view columns, run `DROP VIEW IF EXISTS coil_rollup_machine; DROP VIEW IF EXISTS coil_rollup_room;` before recreating both views with columns: `time_window`, `auto_finished_count`, `aborted_count`, `fault_terminated_count`, `total_count`, and `total_wound_length` (`COALESCE(SUM(co.wound_length), 0)::double precision`).
- **Services, OpenAPI & `/fleet` UI Updates:**
  - Update `src/mqtt/coil-ingestion.ts` to insert `wound_length` alongside `outcome`, `reason_code`, `duration_sec`, and normalized `created_at`.
  - Update `src/services/coil-rollups.ts`, `src/routes/api-schemas.ts`, `src/routes/coils-api.ts`, `src/services/fleet.ts`, and `src/routes/fleet-api.ts` to return and document `{ window, auto_finished_count, aborted_count, fault_terminated_count, total_count, total_wound_length }` in OpenAPI 3.0.3 schemas.
  - Update `src/ui/fleet-layout.ts` (both SSR HTML and inline vanilla JS): relabel the summary strip card to **Winding Cycles (ESP32)** with metrics `Auto-Finished`, `Aborted`, `Fault-Stopped`, and `Wound Fiber`, and update the `<dialog>` drill-down drawer rollup table to **Winding Cycle Telemetry (ESP32)** with matching columns and no CRM `Completed` / `Completion` / `Redo` labels.
- **Track B — Grafana OSS Service & Provisioning (`docker-compose.yml`, `grafana/`):**
  - Add `grafana` service (`image: grafana/grafana:11.6.2`) under `profiles: ["engineering"]`, exposing `${GRAFANA_PORT:-3001}:3000`, mounting `./grafana/provisioning:/etc/grafana/provisioning:ro` and `./grafana/dashboards:/var/lib/grafana/dashboards:ro`, persisting `grafana_data:/var/lib/grafana`, `depends_on: postgres: condition: service_healthy`, and healthchecked against `http://127.0.0.1:3000/api/health`.
  - Configure Grafana admin credentials (`GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD`) via `.env.example` / Compose defaults, and supply `POSTGRES_*` env vars to the provisioning YAML.
  - Provision `grafana/provisioning/datasources/postgres.yml` (`type: postgres`, `uid: telemetry-postgres`, `access: proxy`, `url: postgres:5432`, `jsonData.database: ${POSTGRES_DB:-telemetry}`, `jsonData.sslmode: disable`, `jsonData.postgresVersion: 1600`, `jsonData.timescaledb: true`).
  - Provision `grafana/provisioning/dashboards/dashboards.yml` pointing at `/var/lib/grafana/dashboards` in folder `Winding Room Engineering` (`allowUiUpdates: false`).
  - Provide two provisioned dashboards using `$machine`, `$zone`, and `$app_url` (textbox defaulting to `http://localhost:3000`) template variables and clickable links to `${app_url}/m/<machine_id>` and `${app_url}/m/<machine_id>/glossary?q=<error_code>`:
    1. `grafana/dashboards/esp32-firmware-health.json` — `esp_reset_reason()` reset & crash distribution, Wi-Fi RSSI (`payload_json->>'rssi'`) with `-70` / `-80` dBm warning/critical thresholds, free heap & `min_free_heap` over time, fault & subsystem timeout counts, and recent fault/crash forensics joined with `error_glossary`.
    2. `grafana/dashboards/winding-cycle-telemetry.json` — `AUTO_FINISHED` / `ABORTED` / `FAULT_TERMINATED` cycle counts & time-series trends, `wound_length` totals over time & per machine, `duration_sec` AVG/P50/P95 trends, abort/fault `reason_code` breakdown joined with `error_glossary`, and `bug_reports` correlation table (tag, `error_code`, `worker_note`, timestamp, machine link — no photo or voice fields).
  - Document optional remote HTTPS Grafana access when running `docker compose --profile engineering --profile remote up -d` by adding a second Cloudflare Tunnel Public Hostname pointing to `http://grafana:3000` protected by Cloudflare Access (`docs/ENGINEERING_RUNBOOK.md`).

## Testing Decisions

- **Real PostgreSQL/TimescaleDB Integration (`createTestApp()`):** Update `tests/mqtt-contract.test.ts`, `tests/bootstrap.test.ts`, `tests/coil-outcomes.test.ts`, `tests/fleet-api.test.ts`, and `tests/fleet-portal.test.ts` to cover `AUTO_FINISHED` / `ABORTED` / `FAULT_TERMINATED`, `wound_length`, rejection of `COMPLETED` / `REDO`, idempotent migration of legacy `'COMPLETED'` rows in `coil_outcomes`, updated OpenAPI rollup payloads, and `/fleet` SSR labels.
- **Grafana Provisioning & Panel SQL Verification (`tests/grafana-provisioning.test.ts`):** Validate YAML/JSON provisioning schemas, ensure all panel targets reference `uid: telemetry-postgres`, verify `docker compose --profile engineering config` and `docker compose --profile engineering --profile remote config`, and execute every panel's raw SQL query (substituting `$__timeFilter(...)`, `$__timeGroup(..., $__interval)`, `$machine`, `$zone`) against the real PostgreSQL/TimescaleDB database.

## Out of Scope

- **Voice-to-text / speech recognition:** Explicitly excluded (no Web Speech API; Worker Portal relies solely on standard text input and optional Android keyboard mic).
- **Bug-report photo attachments:** Explicitly excluded (no client-side `<canvas>` JPEG compression, no `./uploads` disk storage, and no 90-day photo cleanup cron). The nullable `bug_reports.photo_path` column remains untouched in `db/init.sql` to avoid breaking existing schemas/tests.
- **Third-party QR/CRM `Redo` / `Completed` / `Failed` integration or QR-redirect proxy:** Explicitly excluded.
- **Onboarding additional non-winder factory machine types:** Deferred to a future phase.
- **Unrequested ops/admin extras:** Bug-report status triage workflow (`OPEN` -> `ACKNOWLEDGED` / `RESOLVED`), configurable `FACTORY_TIMEZONE` rollups, Mosquitto user/ACL hardening, and standalone `README.md` / `GLOSSARY.md` / `docs/adr/` bundles are out of scope for Phase 3.

## Further Notes

- Tickets for Phase 3 are tracked under `.scratch/phase-3-engineering/issues/` (`01` through `08`).
- Before flashing updated ESP32 firmware onto production winders, confirm with the firmware developer the exact linear unit emitted in `wound_length` (default documented as meters) so display labels match firmware output.
- Commissioning and remote Grafana setup instructions live in `docs/ENGINEERING_RUNBOOK.md`.

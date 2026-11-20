# 08: Engineering observability runbook & documentation sync

**What to build:** Create `docs/ENGINEERING_RUNBOOK.md` covering `--profile engineering` Grafana startup on LAN `:3001`, setting `$app_url`, optional remote HTTPS access via `--profile engineering --profile remote` (`cloudflared` + Cloudflare Access), and Mosquitto ESP32 cycle telemetry smoke tests; synchronize `docs/PILOT_RUNBOOK.md`, `spec/MQTT_TOPICS.md`, `spec/ESP32_INTEGRATION.md`, `PLAN.md`, and `AGENTS.md`.

**Blocked by:** 01: ESP32 internal cycle telemetry contract, DB schema evolution & ingestion, 02: ESP32 cycle rollup query services & OpenAPI JSON endpoints, 03: Department Heads /fleet UI update for ESP32 cycle telemetry, 04: Grafana OSS Docker Compose engineering profile & TimescaleDB provisioning, 05: Provisioned Grafana dashboard — ESP32 Firmware & Hardware Diagnostics, 06: Provisioned Grafana dashboard — Winding Cycle Telemetry & Reliability, 07: Phase 3 integration, migration & Grafana SQL verification tests

**Status:** done

- [x] `docs/ENGINEERING_RUNBOOK.md` documents local `--profile engineering`, combined `--profile engineering --profile remote` Cloudflare Access routing to `http://grafana:3000`, `$app_url` deep-link usage, and firmware `wound_length` unit confirmation note.
- [x] `docs/PILOT_RUNBOOK.md`, `spec/MQTT_TOPICS.md`, and `spec/ESP32_INTEGRATION.md` use `AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`, and `wound_length` consistently and note CRM/QR `COMPLETED`/`REDO` rejection.
- [x] `.scratch/phase-3-engineering/spec.md`, ticket statuses, `PLAN.md`, and `AGENTS.md` reflect Phase 3 deliverables accurately.

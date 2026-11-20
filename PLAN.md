# Implementation Plan: Factory Winding Room Telemetry & Management System

## Phase 1 — Pilot (1–2 Winders, Core Stack & Firmware Contract)
1. **Firmware Handoff Kit (`spec/`):**
   - `spec/MQTT_TOPICS.md`: `factory/winders/{id}/status` (LWT `OFFLINE`), `.../events`, `.../coil` (`COMPLETED` | `ABORTED`).
   - `spec/ESP32_INTEGRATION.md`: Non-blocking FreeRTOS queue, Core 0 MQTT task, LittleFS/RAM ring-buffer, `< 1 KB` JSON payloads.
   - `spec/error_codes.json`: Shared fault dictionary for C++ enums and Postgres Glossary.
2. **Local Docker Stack (`docker-compose.yml`, `mosquitto/`, `db/`):**
   - Eclipse Mosquitto (LAN MQTT broker).
   - PostgreSQL + TimescaleDB (`db/init.sql` with `machines`, `telemetry_events`, `coil_outcomes`, `error_glossary`, `bug_reports`).
   - Node.js / Fastify server (`app/`): MQTT subscriber + REST endpoints + PWA static/SSR routes.
3. **Worker PWA (`/m/:machineId`):**
   - 2-button home screen: **Report a Bug** (1-tap quick tags + text note; auto-attaches last 20 telemetry events) and **Glossary / FAQ** (active error pinned).
   - Bottom section: last 3–5 errors for that machine.
4. **Pilot Validation:**
   - Flash 1–2 pilot winders and verify live MQTT status, LWT offline detection, coil counting, and bug reporting.

## Phase 2 — Full Floor & Remote Management (All ~50 Winders)
1. **50-Winder Rollout:** Flash remaining ~49 winders with the validated MQTT firmware contract.
2. **Department Heads PWA (`/fleet`):**
   - Top summary strip: `Working / Idle / Error / Offline` + `Completed / Aborted` (`Today | Week | Month | Total`).
   - Interactive L-shaped floor map (`NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`) with status filter pills and machine drill-down drawer.
   - Room History & Master Glossary tabs.
3. **Remote Access & HTTPS:**
   - `cloudflared` container + `~$10/yr` domain + Cloudflare Access email login for remote heads, plus local LAN fallback URL.

## Phase 3 — Engineering Observability & ESP32 Cycle Telemetry
1. **ESP32 Internal Cycle Telemetry:** Replace CRM-like cycle labels with ESP32 internal stop modes (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`) plus total `wound_length` across the MQTT contract, TimescaleDB schema/views, JSON APIs, and `/fleet` UI (no QR/CRM `Redo` proxy).
2. **Grafana OSS (`--profile engineering`, `grafana/provisioning/`):** Optional Compose profile on LAN port `3001` (with optional Cloudflare Access remote route), pre-configured TimescaleDB/Postgres datasource, and engineering dashboards (`esp_reset_reason()`, Wi-Fi RSSI, free heap, wound fiber length, cycle duration, fault/bug correlation) with deep-links to Glossary and Worker Portal.
3. **Explicitly Excluded / Deferred:** No voice-to-text/speech and no bug-report photo attachments (`bug_reports.photo_path` stays unused/nullable for schema compatibility); non-winder factory machine expansion deferred to a future phase.

## Phase 4 — Firmware OTA, Preset Management & Device Lifecycle
1. **LAN HTTP OTA & Versioning:** Upload versioned `.bin` firmware releases in `/fleet` (behind Cloudflare Access / LAN auth); ESP32 reports `fw_version` and `preset_version` in `status` MQTT payloads; **Check Updates** highlights outdated machines.
2. **Queued Idle-Only Rollout & Rollback:** Updates are blocked while `WORKING`; triggering an update on a `WORKING` machine queues it as **Pending** and auto-dispatches on `WORKING → IDLE` (cancellable before start). Supports single-machine or multi-select group targeting. Firmware spec requires dual-OTA partitions with automatic rollback if MQTT fails to reconnect within ~60s.
3. **Versioned Presets / Config:** Store named, versioned JSON winding/system presets on the server and push to target machines over MQTT (exact parameter schema to be finalized with firmware dev).
4. **Future Floor-Position Decoupling:** Replace hardcoded zone labels (`NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`) with fixed physical room positions (e.g. `W-23`) decoupled from replaceable ESP32 hardware IDs.

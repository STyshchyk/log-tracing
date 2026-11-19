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

## Phase 3 — Engineering, Photos & Expansion
1. **Grafana OSS (`grafana/provisioning/`):** Pre-configured Postgres datasource and dev dashboards (`esp_reset_reason()`, Wi-Fi RSSI, free heap, cycle duration) with deep-links to Glossary.
2. **Bug Report Photos:** Client-side `<canvas>` JPEG compression (`~120 KB`) + local `./uploads` storage + 90-day cleanup cron.
3. **Expansion:** Onboard additional factory machine tools using the same MQTT contract; optionally revisit QR-redirect proxy for `Redo` tracking.

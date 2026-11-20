# Phase 4 — Firmware OTA, Preset Management & Device Lifecycle

> Triage label: `ready-for-agent`

## Problem Statement

Updating firmware or changing winding parameters across ~50 ESP32 Pico winding machines currently requires physical USB/serial access to each unit. Department heads and engineers have no visibility into which firmware or preset version each machine is running, no safe way to roll out updates to individual machines or selected groups without interrupting active winding cycles, and no way to decouple a fixed physical floor position (e.g., `W-23`) from a replaceable ESP32 hardware unit when a board fails and is swapped.

## Solution

Add an authenticated **Firmware OTA & Preset Management** capability to the Department Heads `/fleet` PWA and backend:
- Engineers upload versioned `.bin` firmware releases and manage versioned JSON presets on the server.
- ESP32 units report `fw_version` and `preset_version` in their `status` MQTT payloads.
- `/fleet` provides a **Check Updates** action, single-machine and multi-select group targeting, and **Pending** update queueing that automatically dispatches updates over MQTT when a `WORKING` machine transitions to `IDLE`.
- Firmware pulls `.bin` files over LAN HTTP from the Fastify server, verifies SHA-256, and uses dual-OTA partitions with automatic rollback if MQTT fails to reconnect within ~60 seconds.

## User Stories

1. As an engineer, I want to upload a versioned ESP32 `.bin` firmware release through `/fleet`, so that new firmware is hosted on the local server with a known version and SHA-256 checksum.
2. As an engineer, I want each ESP32 to report its `fw_version` and `preset_version` in its `status` MQTT message, so that I can see what every machine on the floor is currently running.
3. As a department head, I want a **Check Updates** button in `/fleet`, so that I can immediately see which machines are running outdated firmware or presets compared to the latest uploaded release.
4. As an engineer, I want to trigger a firmware update for a single machine from its drill-down drawer, so that I can test or patch one unit at a time.
5. As an engineer, I want to multi-select a group of machines in `/fleet` and trigger a firmware or preset update for that group, so that I can roll out changes in controlled batches without relying on legacy zone labels.
6. As an engineer, I want the system to block immediate OTA flashes and preset changes while a machine is `WORKING`, so that a coil is never ruined mid-wind.
7. As an engineer, I want an update triggered on a `WORKING` machine to be queued as **Pending** and automatically dispatched when the machine transitions to `IDLE`, so that I don't have to babysit machines waiting for cycles to finish.
8. As an engineer, I want to cancel a **Pending** update in `/fleet` before it starts, so that I can abort a rollout if needed.
9. As an engineer, I want the ESP32 firmware to use dual-OTA partitions with automatic rollback if it fails to reconnect to MQTT within ~60 seconds after reboot, so that a bad firmware image cannot brick machines on the floor.
10. As an engineer, I want to store named, versioned JSON presets on the server and push them to individual or multi-selected machines over MQTT, so that winding/system constants can be updated without reflashing firmware.
11. As a shop-floor operator, I want the zero-login `/m/:machineId` Worker Portal to remain read-only for firmware and presets, so that operators cannot accidentally trigger an update.
12. As a department head, I want future floor-map layouts to decouple fixed physical room positions (e.g., `W-23`) from replaceable ESP32 hardware IDs and remove hardcoded zone labels (`NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`), so that swapping a broken ESP32 preserves the machine's position history.

## Implementation Decisions

- **Access Control:** All firmware upload, release listing, preset management, and update-dispatch endpoints live under the authenticated `/api/fleet/*` boundary and `/fleet` PWA. Firmware `.bin` download endpoints for ESP32s are served over the local LAN HTTP server with SHA-256 verification.
- **MQTT Contract Extensions:**
  - Extend `status` payload schema (optional fields for backward compatibility) with `fw_version` and `preset_version` (and optional `preset_name`).
  - Add server-to-device command topic (`factory/winders/{id}/command`) for `OTA_UPDATE` (URL, version, SHA-256) and `APPLY_PRESET` (preset version, JSON payload).
- **Database Schema:**
  - Add tables for `firmware_releases` (version, filename/storage path, sha256, notes, created_at), `machine_presets` (name, version, config_json, created_at), and `pending_updates` (machine_id, update_type, target_version, status, created_at, dispatched_at).
  - Add `fw_version` and `preset_version` columns to `machines`.
- **Idle-Only & Pending Queue:**
  - On update request: if machine `current_state` is `IDLE` (or `ERROR`), dispatch MQTT command immediately. If `WORKING`, insert/update `pending_updates` with status `PENDING`.
  - In `status` ingestion: when a machine transitions to `IDLE`, check `pending_updates` for `PENDING` items and dispatch automatically.
- **Dual-Partition Rollback:** Documented in `spec/ESP32_INTEGRATION.md` as a firmware requirement (`esp_ota_mark_app_valid_cancel_rollback` only after MQTT connection + `status` publish succeeds within ~60s).
- **Preset Schema Flexibility:** Store presets as validated JSONB (`config_json`) so the exact parameter keys can be finalized with the firmware developer without a breaking DB migration.

## Testing Decisions

- **Test Seam:** Use the existing `createApp({ db, mqtt, fleetAuth })` composition seam with `createInMemoryMqttTransport()` and real PostgreSQL/TimescaleDB.
- **Behavior-Focused Tests:**
  - `status` ingestion persists `fw_version` / `preset_version` and auto-dispatches `PENDING` updates on `WORKING → IDLE` transitions.
  - `/api/fleet/*` endpoints enforce Cloudflare Access / LAN auth, reject/queue updates during `WORKING`, support single-machine and multi-select batch targeting, and allow cancelling `PENDING` updates.
  - Firmware `.bin` upload/download serves exact bytes and matching SHA-256.

## Out of Scope

- USB/serial flashing tooling.
- Implementing the C++ ESP32 firmware itself (covered by the `spec/` handoff contract).
- Immediate migration of existing `NORTH_LEFT` / `MAIN_BANK` floor-map coordinates (tracked as part of the floor-position decoupling step).

## Further Notes

- Exact preset JSON keys will be finalized with the firmware developer before implementing the preset schema validator.

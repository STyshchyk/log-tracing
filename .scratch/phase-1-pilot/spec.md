# Phase 1 — Pilot: Factory Winding Room Telemetry, Worker Portal & Firmware Contract

Status: done

## Problem Statement

Across the fiberglass winding room, roughly 50 winding machines run on ESP32 Pico controllers whose small operator touchscreens show only generic errors with zero logging or crash diagnostics. When a subsystem stops responding or a winder freezes mid-cycle, shop-floor operators do not know whether the fault is a simple mechanical fix or a controller crash, and maintenance engineers have no root-cause telemetry or crash history to diagnose the failure.

Workers already carry industrial Android handheld devices with integrated hardware barcode/QR scanners and scan three QR codes (`Completed`, `Failed`, `Redo`) into a closed third-party Android application that we do not own and cannot integrate with. Because production efficiency cannot suffer, workers must not be burdened with extra QR scans during normal winding cycles. At the same time, the ESP32 C++ firmware is maintained by an external developer, so we need to minimize direct edits to their firmware and instead hand them a clean, repeatable integration contract. Finally, the system must cost `$0/month` in software licensing and run reliably on the local factory LAN without cloud free-tier sleep delays, ephemeral disk wipes, or external internet outages breaking shop-floor diagnostics.

## Solution

Deliver a local-first Phase 1 pilot targeting 1–2 winding machines, built around a self-contained three-artifact firmware handoff kit, an on-premises Docker stack (local MQTT broker, PostgreSQL with TimescaleDB, and a Fastify ingestion/web server), and an ultra-simple mobile-first Worker Portal opened directly in Chrome on existing Android scanners.

Instead of modifying the firmware codebase directly, we give the ESP32 developer a standardized MQTT protocol contract, an ESP32 behavioral integration guide, and a single shared fault-code dictionary (`error_code` registry). Pilot winders publish live operational state (`WORKING`, `IDLE`, `ERROR`, `OFFLINE` via MQTT Last Will & Testament), diagnostic events (fault codes, subsystem timeouts, `esp_reset_reason()` crash/brownout forensics, Wi-Fi RSSI, free heap), and automatic winding cycle outcomes (`COMPLETED` vs. `ABORTED`) with zero extra operator scans.

When a pilot machine breaks down, a worker pulls their Android scanner trigger on a single physical Help/Report QR sticker mounted on the machine. Chrome opens the machine's portal immediately—zero APK installs, zero login—showing live machine state, an inline feed of the machine's last 3–5 errors, and two large primary actions: **Report a Bug** (1-tap quick tags plus an optional plain-text note compatible with Android's native keyboard mic, automatically attaching the machine's last 20 telemetry events) and **Glossary / FAQ** (plain-English troubleshooting steps with the machine's active `error_code` pinned at the top).

## User Stories

1. As a shop-floor worker, I want to scan a single Help/Report QR sticker on a pilot winding machine with my Android handheld scanner, so that the machine's portal opens immediately in Chrome without installing any native app.
2. As a shop-floor worker, I want the machine portal to require zero login credentials, so that I can report faults or look up troubleshooting steps within seconds on the shop floor.
3. As a shop-floor worker, I want zero extra QR scans during normal winding cycles, so that my production workflow is unaffected when machines are running properly.
4. As a shop-floor worker, I want to see the machine's current live state (`WORKING`, `IDLE`, `ERROR`, or `OFFLINE`) and active `error_code` at the top of its portal page, so that I can immediately confirm what the system thinks the machine is doing.
5. As a shop-floor worker, I want an ultra-simple two-button home screen (`Report a Bug` and `Glossary / FAQ`) on the machine portal, so that I am never distracted by complex charts or administrative controls.
6. As a shop-floor worker, I want to submit a bug report using 1-tap quick tags (`Fiber Snap`, `Tension`, `Unit Dead`, `Bobbin Jam`, `Other`), so that I can log common problems quickly with gloved or busy hands.
7. As a shop-floor worker, I want to include an optional plain-text note with my bug report using a standard text input, so that I can type details or tap my Android keyboard's built-in microphone when extra context helps.
8. As a shop-floor worker, I want the machine's last 20 telemetry events automatically attached to every bug report I submit, so that engineers get full diagnostic context without me reading error codes off a screen.
9. As a shop-floor worker, I want clear visual confirmation after submitting a bug report, so that I know the issue was recorded and do not submit duplicates.
10. As a shop-floor worker, I want a graceful error message and navigation link if a scanned machine ID does not exist, so that a damaged or misconfigured QR sticker does not leave me stuck on a blank page.
11. As a shop-floor worker, I want the `Glossary / FAQ` view to pin the machine's currently active `error_code` fix steps at the very top, so that I do not have to search for the fault stopping my machine right now.
12. As a shop-floor worker, I want to search and browse plain-English `Glossary / FAQ` troubleshooting steps by keyword or fault code, so that I can resolve common issues across winders on my own.
13. As a shop-floor worker, I want to see the last 3–5 errors recorded for that specific machine directly on its landing screen, so that I can spot recurring faults at a glance.
14. As a shop-floor worker, I want the portal to operate over the local factory LAN without needing external internet access, so that shop-floor diagnostics continue working even during ISP outages.
15. As an ESP32 firmware developer, I want a clear MQTT topic and JSON payload specification covering machine status, diagnostic events, and coil outcomes, so that I can wire up telemetry without guessing backend expectations.
16. As an ESP32 firmware developer, I want MQTT Last Will & Testament (`OFFLINE`) semantics clearly defined in the protocol contract, so that power loss or Wi-Fi drops are detected automatically without custom watchdog polling.
17. As an ESP32 firmware developer, I want an ESP32 behavioral integration guide describing non-blocking FreeRTOS queuing, low-priority Core 0 MQTT publishing, and a RAM/LittleFS ring-buffer, so that telemetry never stalls real-time winding control loops or drops logs during brief Wi-Fi dropouts.
18. As an ESP32 firmware developer, I want strict compact payload limits (`< 1 KB` JSON) documented in the integration guide, so that publishing telemetry does not cause heap fragmentation on the ESP32 Pico.
19. As an ESP32 firmware developer, I want a single flat shared fault-code registry (`error_code` definitions), so that C++ firmware enums and backend Glossary entries stay synchronized without manual duplication.
20. As an ESP32 firmware developer, I want to test pilot firmware against a local MQTT broker and immediately verify ingested machine state, telemetry events, and `COMPLETED` / `ABORTED` coil counts, so that I can confirm integration end-to-end before rolling out further.
21. As an ESP32 firmware developer, I want machine onboarding to follow a uniform per-machine topic pattern, so that adding the second pilot machine (and future machines) requires zero backend code changes.
22. As a maintenance engineer, I want ESP32 diagnostic events (fault codes, subsystem timeouts, `esp_reset_reason()` boot/crash forensics, Wi-Fi RSSI, and free heap) persisted in TimescaleDB time-series storage, so that I can diagnose intermittent freezes and brownouts after they happen.
23. As a maintenance engineer, I want each worker bug report stored alongside an immutable snapshot of the machine's preceding 20 telemetry events, so that I can correlate operator descriptions with exact firmware state at the time of failure.
24. As a maintenance engineer, I want immediate `OFFLINE` state updates when an ESP32 loses power or Wi-Fi, so that silent hardware disconnects are distinguishable from intentional `IDLE` periods.
25. As a maintenance engineer, I want plain-English `Glossary / FAQ` entries seeded and updated from the shared fault-code registry, so that every firmware `error_code` has documented symptoms and fix steps.
26. As a maintenance engineer, I want OpenAPI/Swagger documentation for the server's internal HTTP endpoints, so that I can inspect payloads and test bug-report or machine queries reliably.
27. As a maintenance engineer, I want to verify the entire local Docker stack using simulated MQTT messages before touching physical machine hardware, so that software bugs are isolated from firmware commissioning.
28. As a pilot administrator, I want the entire Phase 1 stack (MQTT broker, PostgreSQL/TimescaleDB, and Fastify server) deployed locally via Docker Compose at `$0/month` licensing, so that it runs on any spare PC, laptop, or Raspberry Pi on the factory LAN.
29. As a pilot administrator, I want database state and telemetry history persisted across container restarts, so that pilot logs and bug reports are never lost during host maintenance.
30. As a pilot administrator, I want machines registered with display names and floor-layout metadata (`NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`, grid row and column) from day one, so that Phase 2 floor-map features can be added without destructive database migrations.

## Implementation Decisions

- **Local-First Containerized Stack:** The Phase 1 system runs completely on-premises on any spare PC, laptop, or Raspberry Pi 4/5 connected to the factory LAN using Docker Compose with persistent volumes for database state. Three core runtime containers serve Phase 1: an Eclipse Mosquitto MQTT broker, a PostgreSQL database with the TimescaleDB extension enabled, and a Node.js/Fastify application server. This guarantees `$0/month` software licensing, avoids cloud free-tier cold starts and ephemeral disk loss, and keeps shop-floor telemetry resilient to internet outages.
- **Canonical Domain Vocabulary:** All layers—MQTT payloads, PostgreSQL tables, Fastify modules, and the Worker UI—must strictly share the canonical vocabulary:
  - Operational states: `WORKING`, `IDLE`, `ERROR`, `OFFLINE`.
  - Automatic coil outcomes: `COMPLETED` (normal cycle completion / target turns reached) and `ABORTED` (aborted, faulted, fiber break, or emergency stop). `REDO` is intentionally excluded because the ESP32 controller only exposes `start`, `stop`, `pause`, and `abort` states and cannot reliably detect visual-defect rework without extra worker scans.
  - Floor zones: `NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`.
  - Fault identifier: `error_code`.
- **Three-Artifact Firmware Handoff Kit:** Rather than modifying the external developer's C++ repository directly, the project produces a self-contained three-part handoff specification:
  1. **MQTT Protocol Contract:** Defines three topics under the winders machine-ID namespace (`factory`, `winders`, `{id}`, followed by `status`, `events`, or `coil`):
     - Status topic: carries `WORKING`, `IDLE`, `ERROR`, or `OFFLINE` (plus optional active `error_code`), published with the MQTT retain flag enabled and configured with an MQTT Last Will & Testament payload of `OFFLINE` so ungraceful disconnects transition the machine offline immediately.
     - Events topic: carries subsystem timeouts, `error_code` fault events, startup `esp_reset_reason()` crash/brownout reports, Wi-Fi RSSI, and free heap diagnostics.
     - Coil topic: carries automatic cycle outcomes (`COMPLETED` or `ABORTED`), optional reason code, and cycle duration in seconds.
  2. **ESP32 Behavioral Integration Guide:** Specifies non-blocking FreeRTOS queueing from winding control loops and ISRs flushed by a low-priority Core 0 MQTT publisher task, a bounded RAM or LittleFS ring-buffer to absorb temporary factory Wi-Fi dropouts without losing diagnostic events, and compact JSON payloads strictly under 1 KB to prevent heap fragmentation.
  3. **Shared Fault Registry:** A flat JSON registry mapping each `error_code` to its canonical title, symptoms, and plain-English Markdown fix steps, serving as the single source of truth to generate C++ firmware enums and seed the database Glossary table.
- **Five-Table Relational & Time-Series Schema:** Although Phase 1 only surfaces the Worker Portal and telemetry ingestion, all five core tables and rollup views are established up front to ensure forward compatibility with Phase 2 and Phase 3 without destructive migrations:
  - **Machines registry:** keyed by machine ID (e.g., `W-01` through `W-50`), storing display name, floor zone (`NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`), grid row and column, `current_state`, nullable `active_error`, and `last_seen_at`.
  - **Telemetry events hypertable (TimescaleDB):** partitioned by event timestamp, storing machine ID, event type, nullable `error_code`, and structured JSON metadata (RSSI, heap, reset reason, details).
  - **Coil outcomes table:** storing unique ID, machine ID, outcome (`COMPLETED` or `ABORTED`), optional reason code, duration in seconds, and creation timestamp, backed by Day, Week, Month, and All-Time rollup SQL views ready for Phase 2.
  - **Error glossary table:** keyed by `error_code`, storing title, symptoms, Markdown fix steps, and last-updated timestamp, seeded idempotently from the shared fault registry.
  - **Bug reports table:** storing unique ID, machine ID, optional active `error_code`, selected quick tag, optional worker note, nullable photo path column reserved for Phase 3, an immutable JSON snapshot of the machine's last 20 telemetry events captured at report submission time, report status, and creation timestamp.
- **Modular Application Architecture & Seams:** The Node.js/Fastify server is structured around two deep modules sharing the PostgreSQL/TimescaleDB pool and fault vocabulary:
  - **MQTT Ingestion Module:** Accepts an injectable MQTT transport adapter (real Mosquitto client in production; an in-memory topic emitter in tests) and subscribes to the wildcard winders namespace. Validates incoming payloads against contract schemas, updates machine state/active error/last-seen timestamps on status messages (clearing `active_error` when transitioning back to `WORKING` or `IDLE` as appropriate), appends time-series records on event messages, records `COMPLETED`/`ABORTED` cycles on coil messages, and safely ignores/logs malformed messages or unregistered machine IDs without crashing the subscriber loop.
  - **Worker Portal & Internal HTTP API Module:** Serves the mobile-first Worker PWA landing view for any registered machine ID (with graceful 404 handling for unknown IDs) and exposes JSON/form endpoints for machine status, last 3–5 errors, Glossary/FAQ lookup (pinning the machine's active `error_code` first when present and supporting plain-text filtering), and bug-report submission (validating 1-tap quick tags `Fiber Snap`, `Tension`, `Unit Dead`, `Bobbin Jam`, `Other` and querying/attaching the machine's 20 most recent telemetry events in the same transaction/workflow). Also exposes internal OpenAPI/Swagger documentation.
- **Mobile-First Worker UI Constraints:** Built as a lightweight, zero-login web interface served cleanly over plain local LAN HTTP for industrial Android Chrome handhelds. Custom browser Web Speech API dictation is deliberately omitted due to factory floor noise and offline LAN incompatibility; workers simply use Android's standard text field and built-in keyboard microphone if they choose to dictate a note. Photo upload controls are omitted in Phase 1.

## Testing Decisions

- **What Makes a Good Test:** Tests verify only external behavior across public module interfaces—observed HTTP responses, rendered Worker Portal content, and persisted PostgreSQL/TimescaleDB rows—never mocking SQL queries, internal helper functions, or private module internals.
- **Primary Seam — Unified Application Interface (Injectable MQTT Adapter + Fastify HTTP against Real PostgreSQL/TimescaleDB):**
  - A single primary test seam sits at the top of the Fastify application and MQTT ingestion module. Only the external MQTT transport is swapped at the seam (in-memory topic emitter in tests vs. real Mosquitto broker in production), while all schema validation, Glossary seeding, SQL persistence, rollup views, and HTTP routing execute against a real PostgreSQL/TimescaleDB test instance.
  - Behavioral coverage across this seam verifies:
    - Idempotent Glossary seeding from the shared fault registry and active-error pinning when a machine is in `ERROR` state.
    - Machine `status` transitions (`WORKING`, `IDLE`, `ERROR`, `OFFLINE`), `last_seen_at` updates, and persistence of malformed-payload resilience.
    - Time-series `events` persistence and retrieval of the last 3–5 errors on the machine landing page.
    - `coil` cycle ingestion recording `COMPLETED` and `ABORTED` outcomes accurately (and rejecting invalid outcomes).
    - Worker bug-report submission validating quick tags and automatically attaching a snapshot of the 20 most recent telemetry events for that machine.
- **Secondary Smoke Seam — Live Docker Compose Stack (Mosquitto + PostgreSQL/TimescaleDB + Fastify):**
  - An in-memory MQTT adapter cannot prove broker-level Last Will & Testament delivery. One focused smoke test connects a real MQTT client with LWT configured to the live Mosquitto container, drops the connection ungracefully, and verifies that the Fastify subscriber updates the machine to `OFFLINE` in PostgreSQL and reflects `OFFLINE` on the Worker Portal HTTP endpoint.
- **Prior Art:** This is a greenfield repository with no pre-existing test suite or harness. Phase 1 establishes the repository's TypeScript test runner, Fastify `app.inject()` HTTP harness, injectable MQTT adapter interface, and real PostgreSQL/TimescaleDB integration testing baseline.

## Out of Scope

- **Phase 2 Scope (Deferred):** Rolling out firmware across all ~50 winding machines beyond the 1–2 pilot units; building the Department Heads fleet dashboard (interactive L-shaped room map, status filter pills, machine drill-down drawer, room-wide history feed, master glossary tab, and `Today | Week | Month | All-Time Total` UI summary strip); configuring Cloudflare Tunnel, custom domain, and Cloudflare Access remote HTTPS authentication.
- **Phase 3 Scope (Deferred):** Provisioning Grafana OSS containers and developer observability dashboards; bug-report photo attachments (client-side `<canvas>` JPEG resizing, local disk upload storage, and 90-day photo cleanup cron job); onboarding non-winder factory machine tools; implementing a late-stage QR-redirect proxy to capture `Redo` counts from the closed third-party Android app.
- **Explicitly Rejected Approaches:** Custom Web Speech API voice-to-text integration (unreliable on a noisy factory floor and incompatible with offline LAN operation; rely on Android's native keyboard mic); native or React Native Android mobile apps; temporary cloud-hosted MVP infrastructure (Render Free, Neon/Supabase, MongoDB Atlas); directly editing the external firmware developer's ESP32 C++ codebase; worker login/authentication screens.

## Further Notes

- **Pilot Validation Gate:** Before authorizing Phase 2 scaling across all ~50 machines, validate 1–2 pilot winders on the live shop floor for approximately one week to confirm Wi-Fi reconnect ring-buffering, accurate `COMPLETED`/`ABORTED` coil detection, reliable LWT `OFFLINE` alerts, and frictionless QR bug reporting by operators.
- **Parallel Firmware Discovery:** Run `/to-questionnaire` in parallel with Phase 1 ticket execution to gather remaining environment specifics from the external ESP32 developer (ESP-IDF vs. Arduino framework, FreeRTOS core layout, existing fault IDs, and exact cycle completion/abort triggers).
- **Next Workflow Step:** Run `/to-tickets` against this specification to slice Phase 1 into vertical, demoable tracer-bullet tickets under `.scratch/phase-1-pilot/issues/`.

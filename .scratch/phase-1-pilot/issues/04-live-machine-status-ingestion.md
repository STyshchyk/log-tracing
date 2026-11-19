# 04: Live Machine Status Ingestion (WORKING / IDLE / ERROR / OFFLINE)

**What to build:** Ingest live machine status updates over the MQTT transport seam into PostgreSQL so every pilot machine's current operational state, active fault, and last-seen timestamp stay accurate and queryable over HTTP.

**Blocked by:** 02: ESP32 MQTT Protocol Contract & Behavioral Integration Guide, 03: Local Docker Stack, 5-Table Schema & Test Harness Bootstrap

**Status:** done

- [x] Publishing a valid `status` payload (`WORKING`, `IDLE`, `ERROR`, or `OFFLINE`) updates the registered machine's `current_state`, `active_error`, and `last_seen_at` in PostgreSQL.
- [x] Transitioning from `ERROR` back to `WORKING` or `IDLE` clears `active_error`, while `ERROR` stores the reported `error_code`.
- [x] Malformed JSON, unknown operational states, or unregistered machine IDs are logged and rejected without crashing the MQTT subscriber or corrupting existing rows.
- [x] A machine status HTTP endpoint returns the machine's current state, display name, active `error_code`, and `last_seen_at`, and returns 404 for unknown machine IDs.
- [x] All behaviors are verified through the unified application seam (in-memory MQTT adapter + Fastify `app.inject()` + real PostgreSQL/TimescaleDB).

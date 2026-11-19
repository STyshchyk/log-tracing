# 06: Diagnostic Events Ingestion into TimescaleDB

**What to build:** Ingest ESP32 diagnostic events (fault codes, subsystem timeouts, startup `esp_reset_reason()` crash/brownout forensics, Wi-Fi RSSI, and free heap) into the TimescaleDB hypertable and expose a query endpoint for a machine's recent events.

**Blocked by:** 02: ESP32 MQTT Protocol Contract & Behavioral Integration Guide, 03: Local Docker Stack, 5-Table Schema & Test Harness Bootstrap

**Status:** done

- [x] Publishing valid `events` payloads appends timestamped rows to the TimescaleDB `telemetry_events` hypertable preserving `event_type`, optional `error_code`, and structured diagnostic metadata (RSSI, heap, reset reason).
- [x] Recent-events HTTP query endpoint returns events for a registered machine ordered newest-first with configurable limit (supporting both last 3–5 error lookup and last-20 snapshot retrieval) and 404 for unknown machines.
- [x] Malformed payloads or unknown machine IDs are safely ignored and logged without interrupting subsequent valid events.
- [x] Verified across the unified application seam against real PostgreSQL/TimescaleDB.

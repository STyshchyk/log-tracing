# 12: Automatic Coil Outcome Ingestion (COMPLETED / ABORTED) & Rollup Views

**What to build:** Ingest automatic winding cycle outcomes (`COMPLETED` and `ABORTED`) over MQTT into PostgreSQL and back them with Day, Week, Month, and All-Time SQL rollup views ready for Phase 2 management reporting.

**Blocked by:** 02: ESP32 MQTT Protocol Contract & Behavioral Integration Guide, 03: Local Docker Stack, 5-Table Schema & Test Harness Bootstrap

**Status:** done

- [x] Publishing valid `coil` payloads persists `COMPLETED` or `ABORTED` outcomes with machine ID, optional reason code, and cycle duration in seconds.
- [x] Invalid outcomes (including `REDO` or unrecognized strings), negative durations, malformed payloads, or unknown machine IDs are rejected and logged cleanly without crashing ingestion.
- [x] Database rollup views accurately aggregate `COMPLETED` and `ABORTED` counts per machine and room-wide across Today, Week, Month, and All-Time windows.
- [x] Verified against real PostgreSQL/TimescaleDB across boundary timestamps via the injectable MQTT adapter.

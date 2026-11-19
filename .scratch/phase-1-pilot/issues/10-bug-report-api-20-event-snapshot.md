# 10: Bug Report API with Auto-Attached 20-Event Snapshot

**What to build:** Implement the validated bug-report submission endpoint that records operator quick tags and optional notes while automatically attaching an immutable snapshot of the machine's 20 most recent telemetry events.

**Blocked by:** 04: Live Machine Status Ingestion (WORKING / IDLE / ERROR / OFFLINE), 06: Diagnostic Events Ingestion into TimescaleDB

**Status:** done

- [x] Endpoint accepts a registered machine ID, one required quick tag from the allowed set (`Fiber Snap`, `Tension`, `Unit Dead`, `Bobbin Jam`, `Other`), and an optional plain-text worker note.
- [x] Automatically queries the machine's 20 most recent rows from `telemetry_events` (or fewer if fewer than 20 exist) and persists them as an immutable JSON snapshot on the `bug_reports` record alongside the machine's current `active_error`.
- [x] Subsequent new telemetry events do not mutate previously saved bug-report snapshots.
- [x] Rejects invalid tags or unknown machine IDs with clear 400 or 404 responses, and documents request and response schemas in OpenAPI/Swagger.
- [x] Verified across the unified application seam by publishing more than 20 telemetry events via MQTT, submitting a bug report via `app.inject()`, and asserting exactly the newest 20 events were captured.

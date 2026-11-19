# 01: Fleet summary, machines list & room history APIs

**What to build:** Implement `src/services/fleet.ts` and `src/routes/fleet-api.ts` exposing `GET /api/fleet/summary` (machine state counts, open bug reports, room coil rollups across Today/Week/Month/All-Time), `GET /api/fleet/machines` (filterable by `state` and `zone`, ordered by floor coordinates), and `GET /api/fleet/history` (merged room-wide error events and bug reports filterable by `kind`, `zone`, `machineId`, and `limit`), with full OpenAPI/Swagger schemas.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `GET /api/fleet/summary` returns exact machine counts (`WORKING`, `IDLE`, `ERROR`, `OFFLINE`, `total`), `open_bug_reports`, and all four `coil_rollups` windows.
- [x] `GET /api/fleet/machines` supports optional `state` and `zone` query filters and returns machines sorted deterministically by zone and grid coordinates.
- [x] `GET /api/fleet/history` merges fault telemetry events and bug reports newest-first with optional `kind`, `zone`, `machineId`, and `limit` filters.

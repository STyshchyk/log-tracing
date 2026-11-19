# 02: Fleet machine-details API

**What to build:** Add `GET /api/fleet/machines/:machineId/details` returning the machine's live record, active glossary entry (if `active_error` is set), last 5 error summaries, last 5 bug reports, machine coil rollups across all four windows, and canonical `/m/:machineId` Worker Portal URL.

**Blocked by:** 01: Fleet summary, machines list & room history APIs

**Status:** done

- [x] Returns `machine`, `active_glossary`, `recent_errors` (up to 5), `recent_bug_reports` (up to 5), `coil_rollups`, and `worker_portal_url`.
- [x] Returns standardized HTTP 404 via `sendMachineNotFound` for unknown or blank machine IDs.
- [x] Includes complete OpenAPI response schemas matching existing Phase 1 API conventions.

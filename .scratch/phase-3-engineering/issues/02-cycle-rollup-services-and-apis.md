# 02: ESP32 cycle rollup query services & OpenAPI JSON endpoints

**What to build:** Update `src/services/coil-rollups.ts`, `src/routes/api-schemas.ts`, `src/routes/coils-api.ts`, `src/services/fleet.ts`, and `src/routes/fleet-api.ts` to expose ESP32 cycle rollup fields (`auto_finished_count`, `aborted_count`, `fault_terminated_count`, `total_count`, `total_wound_length`) across per-machine, room-wide, and Fleet summary/detail JSON endpoints with accurate OpenAPI 3.0.3 schemas.

**Blocked by:** 01: ESP32 internal cycle telemetry contract, DB schema evolution & ingestion

**Status:** done

- [x] `CoilRollupCounts` and query mapping in `src/services/coil-rollups.ts` return `window`, `auto_finished_count`, `aborted_count`, `fault_terminated_count`, `total_count`, and numeric `total_wound_length` across `TODAY`, `WEEK`, `MONTH`, and `ALL_TIME`.
- [x] Shared OpenAPI schemas (`src/routes/api-schemas.ts`, `src/routes/coils-api.ts`, `src/routes/fleet-api.ts`) document and validate the updated rollup payload shape for `/api/machines/:machineId/coils/rollups`, `/api/coils/rollups`, `/api/fleet/summary`, and `/api/fleet/machines/:machineId/details`.
- [x] No CRM-like outcome strings (`completed_count`, `REDO`, etc.) remain in rollup API responses or OpenAPI schema descriptions.

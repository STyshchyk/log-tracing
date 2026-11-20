# 01: ESP32 internal cycle telemetry contract, DB schema evolution & ingestion

**What to build:** Update `src/spec/mqtt-contract.ts`, `spec/MQTT_TOPICS.md`, `spec/ESP32_INTEGRATION.md`, `db/init.sql`, and `src/mqtt/coil-ingestion.ts` so `factory/winders/{machineId}/coil` reflects strictly ESP32 internal cycle statuses (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`) plus optional `wound_length` (`>= 0`, `DOUBLE PRECISION NULL`), while evolving `coil_outcomes` and its rollup views idempotently.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `COIL_OUTCOMES` and `coilPayloadSchema` accept `'AUTO_FINISHED' | 'ABORTED' | 'FAULT_TERMINATED'` plus optional finite non-negative `wound_length`, `reason_code`, integer `duration_sec`, and `ts`, while rejecting `COMPLETED`, `REDO`, `FAILED`, unknown keys, and `>= 1024` byte payloads.
- [x] `db/init.sql` idempotently adds `wound_length DOUBLE PRECISION NULL CHECK (wound_length IS NULL OR wound_length >= 0)`, migrates any legacy `'COMPLETED'` rows to `'AUTO_FINISHED'`, replaces the `outcome` `CHECK` constraint with `('AUTO_FINISHED', 'ABORTED', 'FAULT_TERMINATED')`, and recreates `coil_rollup_machine` and `coil_rollup_room` via `DROP VIEW IF EXISTS` + `CREATE VIEW` with `auto_finished_count`, `aborted_count`, `fault_terminated_count`, `total_count`, and `total_wound_length`.
- [x] `registerCoilIngestion` persists `wound_length` into `coil_outcomes` for registered machines and logs/ignores unregistered IDs or invalid payloads without crashing ingestion.

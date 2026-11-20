# 07: Phase 3 integration, migration & Grafana SQL verification tests

**What to build:** Update Phase 1/2 unit and real-PostgreSQL integration suites for ESP32 cycle outcomes, `wound_length`, legacy row migration, OpenAPI schemas, and `/fleet` UI labels, and add `tests/grafana-provisioning.test.ts` validating Compose profiles, provisioning YAML, dashboard JSON invariants, and live SQL execution of every Grafana panel query.

**Blocked by:** 01: ESP32 internal cycle telemetry contract, DB schema evolution & ingestion, 02: ESP32 cycle rollup query services & OpenAPI JSON endpoints, 03: Department Heads /fleet UI update for ESP32 cycle telemetry, 04: Grafana OSS Docker Compose engineering profile & TimescaleDB provisioning, 05: Provisioned Grafana dashboard — ESP32 Firmware & Hardware Diagnostics, 06: Provisioned Grafana dashboard — Winding Cycle Telemetry & Reliability

**Status:** done

- [x] `tests/mqtt-contract.test.ts`, `tests/bootstrap.test.ts`, `tests/coil-outcomes.test.ts`, `tests/fleet-api.test.ts`, and `tests/fleet-portal.test.ts` pass against real TimescaleDB verifying `AUTO_FINISHED`/`ABORTED`/`FAULT_TERMINATED`, `wound_length`, rejection of `COMPLETED`/`REDO`, idempotent legacy-row migration, and updated `/fleet` labels.
- [x] `tests/grafana-provisioning.test.ts` validates `postgres.yml`, `dashboards.yml`, both dashboard JSON files (datasource UIDs, `$app_url` deep-links, zero photo/voice/CRM references), and `docker compose --profile engineering config` (+ `--profile remote`).
- [x] `tests/grafana-provisioning.test.ts` substitutes Grafana macros (`$__timeFilter`, `$__timeGroup`, `$machine`, `$zone`) and executes every panel SQL query against real PostgreSQL/TimescaleDB with zero SQL errors.

# 06: Provisioned Grafana dashboard — Winding Cycle Telemetry & Reliability

**What to build:** Create `grafana/dashboards/winding-cycle-telemetry.json` wired to `uid: telemetry-postgres` surfacing ESP32 internal winding cycle outcomes (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`), total `wound_length`, `duration_sec` distributions, `reason_code` fault correlations with Glossary deep-links, and operator `bug_reports` context.

**Blocked by:** 01: ESP32 internal cycle telemetry contract, DB schema evolution & ingestion, 04: Grafana OSS Docker Compose engineering profile & TimescaleDB provisioning

**Status:** done

- [x] Defines `$machine`, `$zone`, and `$app_url` template variables and binds every panel to `uid: telemetry-postgres`.
- [x] Includes panels querying `coil_outcomes` for `AUTO_FINISHED` / `ABORTED` / `FAULT_TERMINATED` counts and time-series trends, total `wound_length` over time and per machine, and `duration_sec` AVG/P50/P95 trends.
- [x] Includes `reason_code` breakdown joined with `error_glossary` (plus Glossary/Worker Portal deep-links) and a `bug_reports` correlation table displaying `tag`, `error_code`, `worker_note`, and machine links without photo or voice columns.

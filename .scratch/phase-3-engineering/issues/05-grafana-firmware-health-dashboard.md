# 05: Provisioned Grafana dashboard — ESP32 Firmware & Hardware Diagnostics

**What to build:** Create `grafana/dashboards/esp32-firmware-health.json` wired to `uid: telemetry-postgres` providing firmware engineers with time-series visibility into `esp_reset_reason()`, Wi-Fi RSSI, free heap / `min_free_heap`, subsystem timeouts, and fault forensics with deep-links into the Worker Portal and Fault Glossary.

**Blocked by:** 04: Grafana OSS Docker Compose engineering profile & TimescaleDB provisioning

**Status:** done

- [x] Defines template variables `$machine` (all `machines.id`), `$zone` (`machines.zone`), and `$app_url` (textbox defaulting to `http://localhost:3000`) used consistently across SQL filters and data links.
- [x] Includes panels querying `telemetry_events` (`payload_json->>'reset_reason'`, `rssi`, `free_heap`, `details->>'min_free_heap'`, `subsystem`, `message`) for reset reasons, Wi-Fi RSSI with `-70`/`-80 dBm` thresholds, free heap trends, and fault/timeout frequency.
- [x] Recent fault/crash forensics table joins `error_glossary` and includes clickable data links to `${app_url}/m/<machine_id>` and `${app_url}/m/<machine_id>/glossary?q=<error_code>`.

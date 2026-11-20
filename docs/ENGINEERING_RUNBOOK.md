# Phase 3 Engineering Observability & ESP32 Cycle Telemetry Runbook

Operations and firmware-integration guide for launching the optional Grafana OSS engineering stack (`--profile engineering`), interpreting ESP32 internal winding cycle telemetry (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`, `wound_length`), and optionally protecting Grafana behind Cloudflare Access.

---

## 1. Starting the Optional Grafana Engineering Stack

By default, `docker compose up -d --build` launches **only** the 3 core shop-floor services (`mosquitto`, `postgres`, `app`) so the Worker Portal and MQTT ingestion remain lightweight on the factory LAN.

### 1.1 Local LAN Engineering Mode (`:3001`)

Start the stack with the `engineering` profile enabled:

```bash
docker compose --profile engineering up -d --build
```

Verify Grafana health and open it from the factory LAN:

- URL: `http://<server-lan-ip>:3001` (override port via `GRAFANA_PORT` in `.env`)
- Default login: `admin` / `admin` (override via `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` in `.env`)
- Health endpoint: `curl -s http://127.0.0.1:3001/api/health`

Grafana auto-provisions:
1. **Datasource:** `Telemetry TimescaleDB` (`uid: telemetry-postgres`, `type: postgres`, `timescaledb: true`) pointing at `postgres:5432` using `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
2. **Folder:** `Winding Room Engineering` containing two read-only provisioned dashboards from `./grafana/dashboards/`.

### 1.2 Remote HTTPS Access (`--profile engineering --profile remote`)

To expose Grafana alongside `/fleet` over HTTPS for off-site engineers:

1. Configure `.env` with `CF_TOKEN`, `CF_ACCESS_TEAM_DOMAIN`, and `CF_ACCESS_AUD` (see [FLEET_RUNBOOK.md](./FLEET_RUNBOOK.md)).
2. In **Cloudflare Zero Trust -> Networks -> Tunnels**, add a second **Public Hostname** route on the existing tunnel (e.g. `grafana.example.com`) targeting Compose service `http://grafana:3000`.
3. Create a **Cloudflare Access Self-Hosted Application** protecting `grafana.example.com` with an Engineering email allowlist / OTP policy.
4. Set `GRAFANA_ROOT_URL=https://grafana.example.com` in `.env` and start both profiles together:
   ```bash
   docker compose --profile engineering --profile remote up -d --build
   ```

> Shop-floor `/m/:machineId` Worker Portal routes remain unauthenticated on the factory LAN at `http://<server-lan-ip>:3000/m/<machineId>`.

---

## 2. Provisioned Dashboards & Glossary Deep-Links

Both dashboards include `$zone`, `$machine`, and `$app_url` (textbox defaulting to `http://localhost:3000`) template variables.

- **Setting `$app_url`:** Set `Portal Base URL` (`$app_url`) at the top of the dashboard to your shop-floor or remote Fastify URL (e.g., `http://<server-lan-ip>:3000` or `https://fleet.example.com`) so table links open the target machine's Worker Portal (`/m/<machineId>`) or Glossary (`/m/<machineId>/glossary?q=<error_code>`) directly in a new tab.

### 2.1 `ESP32 Firmware & Hardware Diagnostics` (`esp32-firmware-health`)
- **Crash & Boot Reset Reasons (`esp_reset_reason()`):** Bar chart of `ESP_RST_*` boot/crash counts across winders.
- **Abnormal Crash Resets Over Time:** Stacked time-series isolating `CRASH_RESET`, `ERR_BROWNOUT_RESET`, and `ERR_WATCHDOG_RESET` spikes.
- **Wi-Fi Signal Strength (RSSI dBm):** Time-series with `-70 dBm` (warning) and `-80 dBm` (critical) thresholds for diagnosing RF dead spots.
- **Free Heap & Min Free Heap (Bytes):** Tracks `free_heap` and `details.min_free_heap` over multi-day runs to spot memory leaks before watchdog resets occur.
- **Fault & Subsystem Timeout Frequency + Recent Forensics Table:** Joins `telemetry_events` with `error_glossary` and links directly to `/m/<machineId>` and `/m/<machineId>/glossary?q=<error_code>`.

### 2.2 `Winding Cycle Telemetry & Reliability` (`winding-cycle-telemetry`)
- **ESP32 Cycle Stop Breakdown & Time-Series:** Live totals and trends for `AUTO_FINISHED`, `ABORTED`, and `FAULT_TERMINATED` outcomes (zero CRM/QR `Completed`/`Redo` values).
- **Total Wound Fiber Length (Time-Series & By Machine):** Sums `coil_outcomes.wound_length` over time and per machine.
  - **Firmware Handoff Note:** `wound_length` is stored as a unit-agnostic non-negative float (`DOUBLE PRECISION`). Confirm the exact physical unit emitted by firmware (default documented as **meters**) with the ESP32 developer before flashing.
- **Cycle Duration Trend (AVG / P50 / P95):** Tracks winding cycle duration stability across shifts.
- **Abort & Fault-Termination Reason Breakdown:** Joins `coil_outcomes.reason_code` with `error_glossary` and provides Glossary deep-links.
- **Recent Operator Bug Reports Correlation:** Correlates operator quick tags and text notes (`bug_reports`) alongside machine telemetry (without photo or voice attachments).

---

## 3. Verifying ESP32 Cycle & Engineering Telemetry via Mosquitto

With `postgres`, `mosquitto`, `app`, and `grafana` running:

```bash
# 1. Emit ESP32 firmware diagnostics (CRASH_RESET + HEARTBEAT)
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/events" -q 1 \
  -m '{"event_type":"CRASH_RESET","error_code":"ERR_BROWNOUT_RESET","reset_reason":"ESP_RST_BROWNOUT","rssi":-74,"free_heap":162400,"subsystem":"power","message":"Brownout reboot","details":{"min_free_heap":138000}}'

docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/events" -q 1 \
  -m '{"event_type":"HEARTBEAT","rssi":-65,"free_heap":186000,"details":{"min_free_heap":142000}}'

# 2. Emit ESP32 internal cycle telemetry (AUTO_FINISHED, ABORTED, FAULT_TERMINATED + wound_length)
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 \
  -m '{"outcome":"AUTO_FINISHED","duration_sec":148,"wound_length":124.5}'

docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 \
  -m '{"outcome":"ABORTED","reason_code":"OPERATOR_ABORT","duration_sec":43,"wound_length":38.2}'

docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 \
  -m '{"outcome":"FAULT_TERMINATED","reason_code":"ERR_FIBER_SNAP","duration_sec":61,"wound_length":52.0}'

# 3. Verify CRM/QR statuses (COMPLETED, REDO) are rejected by contract
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 \
  -m '{"outcome":"COMPLETED","duration_sec":120}'
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 \
  -m '{"outcome":"REDO","duration_sec":120}'

# 4. Inspect updated ESP32 cycle rollups via API
curl -s http://127.0.0.1:3000/api/machines/W-01/coils/rollups
```

Confirm in `/fleet` (`Winding Cycles (ESP32)`) and Grafana (`http://127.0.0.1:3001`) that `AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`, and `wound_length` appear while `COMPLETED` and `REDO` are ignored.

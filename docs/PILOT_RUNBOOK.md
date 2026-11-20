# Phase 1 Pilot Commissioning & Verification Runbook

Practical shop-floor deployment, pre-hardware MQTT simulation, Android handheld validation, and automated verification guide for pilot winding machines **`W-01`** (`Winder 01`) and **`W-02`** (`Winder 02`).

---

## 1. Local Docker Stack Startup (Factory LAN Host)

The Phase 1 stack runs completely on-premises at **`$0/month`** software cost on any spare Windows/Linux PC, mini-PC, or Raspberry Pi 4/5 connected to the factory LAN:

| Container | Image / Build | Port | Purpose | Persistent Volume |
| :--- | :--- | :--- | :--- | :--- |
| `mosquitto` | `eclipse-mosquitto:2` | `1883` | Local LAN MQTT broker (`mosquitto/mosquitto.conf`) | `mosquitto_data` |
| `postgres` | `timescale/timescaledb:latest-pg16` | `5432` | PostgreSQL 16 + TimescaleDB hypertable & rollup views (`db/init.sql`) | `pg_data` |
| `app` | Local `Dockerfile` (Node 24 + Fastify) | `3000` | MQTT ingestion, Worker Portal HTML, and HTTP JSON/OpenAPI server | — |

### 1.1 Start the Stack

From the repository root on the LAN host:

```bash
docker compose up -d --build
```

On startup, `src/server.ts` automatically:
1. Initializes/verifies the PostgreSQL + TimescaleDB schema (`ensureSchema`).
2. Idempotently seeds pilot machines **`W-01`** (`Winder 01`, zone `NORTH_LEFT`, row `1`, col `1`) and **`W-02`** (`Winder 02`, zone `NORTH_LEFT`, row `1`, col `2`) **without** overwriting existing `current_state`, `active_error`, or `last_seen_at` across restarts.
3. Idempotently seeds `error_glossary` from `spec/error_codes.json` (`seedGlossary`).

Check container health and application logs:

```bash
docker compose ps
docker compose logs -f app
```

If you ever need to re-run seeding manually against PostgreSQL without restarting `app`:

```bash
pnpm seed:pilot
```

### 1.2 Verify Health, OpenAPI Docs, and Seeded Pilot Machines

Verify from the host (`127.0.0.1`):

```bash
curl -s http://127.0.0.1:3000/health
# Expected: {"status":"ok","database":"connected"}

curl -s http://127.0.0.1:3000/api/machines/W-01
# Expected: {"id":"W-01","display_name":"Winder 01","zone":"NORTH_LEFT","grid_row":1,"grid_col":1,"current_state":"OFFLINE","active_error":null,"last_seen_at":null}

curl -s http://127.0.0.1:3000/api/machines/W-02
# Expected: {"id":"W-02","display_name":"Winder 02","zone":"NORTH_LEFT","grid_row":1,"grid_col":2,"current_state":"OFFLINE","active_error":null,"last_seen_at":null}
```

Open Swagger / OpenAPI docs in a browser:
- Swagger UI: `http://127.0.0.1:3000/docs`
- OpenAPI JSON: `http://127.0.0.1:3000/docs/json`
- Worker Portal machine directory: `http://127.0.0.1:3000/`

### 1.3 Find the Factory LAN IP & Configure Firewall

Determine the host's static factory LAN IP (`<server-lan-ip>`, e.g., `192.168.10.50`):

- **Linux / Raspberry Pi:** `hostname -I`
- **Windows PowerShell:**
  ```powershell
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object InterfaceAlias, IPAddress
  ```

Host networking checklist before going to the shop floor:
- Assign a **static LAN IP or DHCP reservation** on the factory router so `<server-lan-ip>` never changes after power outages (printed QR stickers hardcode this IP).
- Allow inbound TCP **`3000`** (Worker Portal HTTP) and TCP **`1883`** (ESP32 MQTT) on the host firewall for the factory LAN subnet.

---

## 2. Printable Help/Report QR Stickers (`W-01` and `W-02`)

Each pilot winding machine receives **one** physical Help/Report QR sticker. Workers perform **zero extra QR scans** during normal winding cycles (the existing third-party `Completed` / `Failed` / `Redo` scans remain unchanged).

### 2.1 Exact Pilot QR URLs

Replace `<server-lan-ip>` with the host's static factory LAN IP:

| Machine ID | Display Name | Floor Zone | Grid (Row, Col) | QR Target URL |
| :--- | :--- | :--- | :--- | :--- |
| `W-01` | Winder 01 | `NORTH_LEFT` | `(1, 1)` | `http://<server-lan-ip>:3000/m/W-01` |
| `W-02` | Winder 02 | `NORTH_LEFT` | `(1, 2)` | `http://<server-lan-ip>:3000/m/W-02` |

> **Why plain `http://`?** Phase 1 operates strictly on the local factory LAN without external internet or cloud dependencies, avoiding self-signed TLS certificate warnings on Android Chrome handhelds.

### 2.2 Generate QR Images Offline

You can generate crisp PNG/SVG stickers locally without uploading anything to external websites:

- **Linux / macOS (`qrencode`):**
  ```bash
  qrencode -o W-01-qr.png -s 10 -m 2 "http://<server-lan-ip>:3000/m/W-01"
  qrencode -o W-02-qr.png -s 10 -m 2 "http://<server-lan-ip>:3000/m/W-02"
  ```
- **Cross-platform (`npx qrcode`):**
  ```bash
  npx --yes qrcode -o W-01-qr.png -w 400 "http://<server-lan-ip>:3000/m/W-01"
  npx --yes qrcode -o W-02-qr.png -w 400 "http://<server-lan-ip>:3000/m/W-02"
  ```

### 2.3 Sticker Mounting Guidelines

- Print each QR at least **4 cm × 4 cm** with human-readable label text directly below it:
  - **`W-01 — Winder 01 — Scan for Help / Report Bug`**
  - URL text: `http://<server-lan-ip>:3000/m/W-01` (and fallback directory `http://<server-lan-ip>:3000/`)
- Laminate or cover with clear chemical-resistant tape so fiberglass dust and resin do not smudge the sticker.
- Mount near the operator touchscreen at comfortable scanner trigger angle without obstructing E-Stop or moving parts.

---

## 3. Pre-Hardware MQTT Simulation Commands

Run these simulations **before flashing ESP32 hardware** to confirm end-to-end ingestion from Mosquitto -> Fastify -> TimescaleDB -> Worker Portal.

All examples below use the Mosquitto client already inside the running `mosquitto` container (`docker compose exec -T mosquitto mosquitto_pub ...`), so no extra local tools are required. (If using a host-installed `mosquitto_pub`, drop `docker compose exec -T mosquitto` and add `-h 127.0.0.1`.)

### 3.1 `status` Transitions (`WORKING`, `ERROR`, `IDLE`)

Always publish `status` messages with **`-r` (retain)** and **`-q 1`**, matching `spec/MQTT_TOPICS.md`:

```bash
# 1. Machine enters WORKING (clears active_error)
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/status" -q 1 -r -m '{"state":"WORKING","ts":"2026-11-19T12:00:00Z"}'

curl -s http://127.0.0.1:3000/api/machines/W-01
# Verify: current_state = "WORKING", active_error = null, last_seen_at != null

# 2. Machine faults with ERR_FIBER_SNAP (sets active_error)
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/status" -q 1 -r -m '{"state":"ERROR","error_code":"ERR_FIBER_SNAP","ts":"2026-11-19T12:02:00Z"}'

curl -s http://127.0.0.1:3000/api/machines/W-01
# Verify: current_state = "ERROR", active_error = "ERR_FIBER_SNAP"

# 3. Operator clears fault and machine returns to IDLE (clears active_error)
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/status" -q 1 -r -m '{"state":"IDLE","ts":"2026-11-19T12:05:00Z"}'

curl -s http://127.0.0.1:3000/api/machines/W-01
# Verify: current_state = "IDLE", active_error = null
```

> **Windows PowerShell note:** If running commands inside PowerShell and passing JSON directly to native binaries, wrap JSON in single quotes or double-escape inner quotes (`'{\"state\":\"WORKING\"}'`). Using Node one-liners (`node -e ...`) avoids shell-quoting differences across cmd/PowerShell/bash.

### 3.2 `events` Stream (`CRASH_RESET`, `SUBSYSTEM_TIMEOUT`, `HEARTBEAT`)

Events are **non-retained** (`retain = false`):

```bash
# 1. CRASH_RESET (error-class event -> appears in Recent Errors feed & attached snapshots)
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/events" -q 1 -m '{"event_type":"CRASH_RESET","error_code":"ERR_BROWNOUT_RESET","reset_reason":"ESP_RST_BROWNOUT","rssi":-68,"free_heap":184320,"subsystem":"power","message":"ESP32 rebooted due to brownout","details":{"min_free_heap":142000}}'

# 2. SUBSYSTEM_TIMEOUT (error-class event -> appears in Recent Errors feed)
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/events" -q 1 -m '{"event_type":"SUBSYSTEM_TIMEOUT","error_code":"ERR_SUBSYSTEM_TIMEOUT","subsystem":"traverse_stepper","rssi":-71,"free_heap":176400,"message":"No limit-switch ack within 2500ms","details":{"timeout_ms":2500}}'

# 3. HEARTBEAT (informational telemetry -> persisted for 20-event bug-report snapshots, excluded from errorsOnly=true)
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/events" -q 0 -m '{"event_type":"HEARTBEAT","rssi":-64,"free_heap":188240}'
```

Verify both full and error-filtered event feeds:

```bash
# Full history (limit=20, errorsOnly=false)
curl -s "http://127.0.0.1:3000/api/machines/W-01/events?limit=20&errorsOnly=false"

# Recent errors only (errorsOnly=true -> CRASH_RESET and SUBSYSTEM_TIMEOUT, excludes HEARTBEAT)
curl -s "http://127.0.0.1:3000/api/machines/W-01/events?limit=5&errorsOnly=true"
```

### 3.3 ESP32 `coil` Outcomes (`AUTO_FINISHED`, `ABORTED`, `FAULT_TERMINATED`, and CRM Status Rejection)

```bash
# Baseline coil counts before simulation
curl -s http://127.0.0.1:3000/api/machines/W-01/coils/rollups

# 1. Valid AUTO_FINISHED cycle with wound_length
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 -m '{"outcome":"AUTO_FINISHED","duration_sec":148,"wound_length":124.5}'

# 2. Valid ABORTED cycle
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 -m '{"outcome":"ABORTED","reason_code":"OPERATOR_ABORT","duration_sec":43,"wound_length":38.2}'

# 3. Valid FAULT_TERMINATED cycle
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 -m '{"outcome":"FAULT_TERMINATED","reason_code":"ERR_FIBER_SNAP","duration_sec":61,"wound_length":52.0}'

# 4. Invalid CRM/QR outcomes (REDO / COMPLETED) -> MUST be rejected by contract & never increment rollups
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 -m '{"outcome":"REDO","duration_sec":60}'
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/coil" -q 1 -m '{"outcome":"COMPLETED","duration_sec":148}'

# Verify AUTO_FINISHED (+1), ABORTED (+1), FAULT_TERMINATED (+1), total_wound_length (+214.7), and REDO/COMPLETED ignored (total_count = +3)
curl -s http://127.0.0.1:3000/api/machines/W-01/coils/rollups
```

Check `docker compose logs --tail=20 app` — the rejected `REDO` and `COMPLETED` payloads log validation warnings without crashing the MQTT subscriber loop.

### 3.4 Simulate LWT `OFFLINE` on Ungraceful Disconnect

A clean `mosquitto_pub` command sends an MQTT `DISCONNECT` packet before closing, so it does **not** trigger the broker's Last Will & Testament. To simulate sudden ESP32 power loss or Wi-Fi dropout against the live Mosquitto broker, destroy the TCP socket (`client.stream.destroy()`) without sending `DISCONNECT`:

```bash
node --input-type=module -e "
import mqtt from 'mqtt';
const topic = 'factory/winders/W-02/status';
const client = mqtt.connect('mqtt://127.0.0.1:1883', {
  keepalive: 2,
  reconnectPeriod: 0,
  will: { topic, payload: JSON.stringify({ state: 'OFFLINE' }), qos: 1, retain: true },
});
client.on('connect', async () => {
  await client.publishAsync(topic, JSON.stringify({ state: 'ERROR', error_code: 'ERR_FIBER_SNAP' }), { qos: 1, retain: true });
  setTimeout(() => {
    console.log('Simulating sudden power loss (destroying TCP stream)...');
    client.stream.destroy();
  }, 500);
});
"
```

Within ~3 seconds (`1.5 × keepalive`), verify:

```bash
curl -s http://127.0.0.1:3000/api/machines/W-02
# Expected: current_state = "OFFLINE", active_error = "ERR_FIBER_SNAP" (preserved across LWT!)
```

### 3.5 Reset Retained Simulation Messages Before Live Cutover

Before mounting real ESP32 hardware on `W-01` and `W-02`, clear retained simulation state or set clean `OFFLINE` state:

```bash
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-01/status" -r -n
docker compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t "factory/winders/W-02/status" -r -n
```

---

## 4. Android Handheld Chrome LAN Validation Checklist

Run through this checklist on an actual shop-floor Android handheld scanner connected to the factory Wi-Fi LAN:

- [ ] **QR Scan & Zero-Login Launch:** Pull the scanner trigger on the `W-01` sticker (`http://<server-lan-ip>:3000/m/W-01`). Confirm Chrome opens immediately with zero native app install and zero login screen.
- [ ] **Live Status & Active Error Visibility:** Put `W-01` into `ERROR` with `ERR_FIBER_SNAP` (Section 3.1). Refresh `/m/W-01` and confirm:
  - Large `Winder 01` (`W-01`) header and `ERROR` badge (with non-color triangle icon + text).
  - Active error badge `ERR_FIBER_SNAP` and UTC `Last seen` timestamp.
  - **Recent Errors** section at the bottom displays up to the last 3–5 error events (`CRASH_RESET`, `SUBSYSTEM_TIMEOUT`, etc.) and excludes `HEARTBEAT`.
- [ ] **Glossary / FAQ & Active-Error Pinning:** Tap **Glossary / FAQ** (`/m/W-01/glossary`) and confirm:
  - **`ERR_FIBER_SNAP`** is pinned at the very top with plain-English symptoms and numbered fix steps.
  - Search box (`Search faults by keyword or error code`) filters accurately for `brownout` or `tension`, and **Clear** restores the full list.
- [ ] **Report-a-Bug 1-Tap Flow & 20-Event Snapshot:** Return to `/m/W-01` and tap **Report a Bug** (`/m/W-01/report-bug`). Confirm:
  - All 5 quick-tag radio cards (`Fiber Snap`, `Tension`, `Unit Dead`, `Bobbin Jam`, `Other`) are large and easy to tap with gloved hands.
  - Submitting without choosing a tag displays a clear accessible error without wiping any typed note.
  - Tap the **Optional note** box and test Android's built-in keyboard microphone (works offline on local LAN HTTP).
  - Select `Fiber Snap` and tap **Submit Bug Report**. Confirm the green `Report #<id> saved` confirmation screen displays the tag, captured `error_code` (`ERR_FIBER_SNAP`), note, and attached telemetry snapshot count (up to `20 events`).
  - Verify via API (`curl -s http://<server-lan-ip>:3000/api/machines/W-01/bug-reports`) that `attached_logs_json` includes the preceding telemetry events (newest first, up to 20).
- [ ] **Unknown Machine 404 Recovery:** Visit `http://<server-lan-ip>:3000/m/W-999` in Chrome. Confirm a clear `Machine Not Found` page (`404`) appears with a large **All Machines** link back to `/` listing `W-01` and `W-02`.
- [ ] **Zero Impact on Normal Winding Cycles:** Confirm operators never scan any new QR code during normal `Completed` / `Failed` / `Redo` winding cycles.

---

## 5. Automated Verification Suite & Persistence Check

Run the complete local verification suite from the repository root (with `postgres` and `mosquitto` running):

```bash
# 1. Static type-check and production JS build
pnpm typecheck
pnpm build

# 2. Unit & Fastify/PostgreSQL integration seam suite
pnpm test

# 3. Live Mosquitto LWT OFFLINE smoke test (spins up an in-process Fastify instance)
pnpm test:smoke

# 4. Live LWT smoke test against the running Docker Compose `app` container
SMOKE_APP_URL=http://127.0.0.1:3000 pnpm test:smoke

# 5. Idempotent pilot seeding CLI
pnpm seed:pilot
```

### Container Restart Persistence Check

Confirm database history and live telemetry survive container restarts without clobbering state:

```bash
docker compose restart app
curl -s http://127.0.0.1:3000/api/machines/W-01
# Live current_state, active_error, last_seen_at, events, coil_outcomes, and bug_reports remain intact.
```

---

## 6. Firmware Handoff Reference

Hand these three repository artifacts to the external ESP32 developer when flashing `W-01` and `W-02`:
- `spec/MQTT_TOPICS.md` — topic structure, retained `status`, LWT `{"state":"OFFLINE"}`, `< 1024`-byte payload cap, and ESP32 `coil` (`AUTO_FINISHED` / `ABORTED` / `FAULT_TERMINATED` + `wound_length`) contract.
- `spec/ESP32_INTEGRATION.md` — non-blocking FreeRTOS queue, Core 0 publisher task, LittleFS/RAM ring-buffer, and `esp_reset_reason()` startup diagnostics.
- `spec/error_codes.json` — canonical `error_code` enum definitions shared with the Worker Portal Glossary.

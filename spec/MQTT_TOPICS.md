# MQTT Protocol Contract (`factory/winders`)

Canonical MQTT topic and JSON payload contract shared between ESP32 Pico winding-machine firmware and the Fastify ingestion backend (`src/spec/mqtt-contract.ts`).

---

## 1. Broker & Transport Rules

- **Broker:** Local LAN Eclipse Mosquitto on TCP port `1883` (`mqtt://<server-lan-ip>:1883`).
- **Encoding:** UTF-8 JSON object (`{ ... }`) on every topic.
- **Strict Payload Limit:** Every serialized JSON payload **MUST be strictly less than `1024` UTF-8 bytes** (`byteLength < 1024`). Payloads `>= 1024` bytes are rejected by the backend contract validator (`MAX_MQTT_PAYLOAD_BYTES = 1024`).
- **Strict Schemas:** Unknown/extra JSON keys are rejected. Use exact snake_case field names defined below.
- **Recommended QoS:** QoS `1` for `status` (including LWT), `coil`, and error/reset `events`. QoS `0` or `1` is acceptable for periodic `HEARTBEAT` events.
- **Machine Registration:** Onboarding a new machine requires no backend code changes—register the machine row in PostgreSQL (`machines.id`) and configure firmware with that exact `{machineId}`. Messages arriving for unregistered machine IDs are safely logged and ignored.

---

## 2. Topic Namespace

All messages MUST be published under:

```text
factory/winders/{machineId}/{channel}
```

### Path Segments

| Segment | Constraint | Examples |
| :--- | :--- | :--- |
| Prefix | Fixed literal `factory/winders` | `factory/winders` |
| `{machineId}` | Regex `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` (1–64 chars, alphanumeric start, no spaces, slashes, or MQTT wildcards `+` / `#`) | `W-01`, `W-02`, `W_12` |
| `{channel}` | One of `status`, `events`, `coil` | `status`, `events`, `coil` |

The backend subscribes per channel to `factory/winders/+/status`, `factory/winders/+/events`, and `factory/winders/+/coil`.

---

## 3. Channel Contracts

### 3.1 `factory/winders/{machineId}/status`

Tracks the machine's live operational state and currently active fault.

- **MQTT Retain Flag:** **`true`** (required for both live state updates and Last Will & Testament so newly connected portals/subscribers immediately know the machine's latest state).
- **MQTT Last Will & Testament (LWT):**
  - **LWT Topic:** `factory/winders/{machineId}/status`
  - **LWT Payload:** `{"state":"OFFLINE"}`
  - **LWT Retain:** `true`
  - **LWT QoS:** `1`
  - **Recommended Keepalive:** `15`–`30` seconds (detects power loss or Wi-Fi drop quickly without excessive ping traffic).

#### Payload Fields

| Field | Type | Required | Validation / Semantics |
| :--- | :--- | :--- | :--- |
| `state` | `string` | **Yes** | Enum: `"WORKING"`, `"IDLE"`, `"ERROR"`, `"OFFLINE"`. |
| `error_code` | `string \| null` | No | Uppercase C++ enum identifier matching `^[A-Z](?:[A-Z0-9]\|_[A-Z0-9])*$` from `spec/error_codes.json`, or `null`. |
| `ts` | `string \| number` | No | Optional non-empty timestamp string (ISO-8601 UTC recommended, e.g. `"2026-11-19T12:00:00Z"`) or finite non-negative number (epoch seconds/ms or monotonic uptime). |

#### Backend State & `active_error` Rules

| Incoming `state` | Effect on `machines.current_state` | Effect on `machines.active_error` |
| :--- | :--- | :--- |
| `"WORKING"` | Set to `'WORKING'` | **Cleared (`NULL`)** |
| `"IDLE"` | Set to `'IDLE'` | **Cleared (`NULL`)** |
| `"ERROR"` | Set to `'ERROR'` | Set to `payload.error_code ?? NULL` (firmware should always provide the matching `error_code`) |
| `"OFFLINE"` | Set to `'OFFLINE'` | Updated **only** if `error_code` is explicitly present in payload; **preserved** when omitted (so LWT `{"state":"OFFLINE"}` does not erase the fault that preceded power loss) |

Every valid `status` message updates `machines.last_seen_at` to ingestion time.

#### Examples

```json
{"state":"IDLE"}
```

```json
{"state":"WORKING","ts":"2026-11-19T12:01:00Z"}
```

```json
{"state":"ERROR","error_code":"ERR_FIBER_SNAP","ts":"2026-11-19T12:04:18Z"}
```

LWT payload configured on MQTT connect:

```json
{"state":"OFFLINE"}
```

---

### 3.2 `factory/winders/{machineId}/events`

Append-only stream of machine faults, subsystem timeouts, boot/crash forensics, and runtime diagnostics persisted in the TimescaleDB `telemetry_events` hypertable.

- **MQTT Retain Flag:** **`false`**

#### Payload Fields

| Field | Type | Required | Validation / Semantics |
| :--- | :--- | :--- | :--- |
| `event_type` | `string` | **Yes** | Enum: `"ERROR"`, `"FAULT"`, `"SUBSYSTEM_TIMEOUT"`, `"CRASH_RESET"`, `"BOOT"`, `"HEARTBEAT"`, `"DIAGNOSTIC"`, `"INFO"`. |
| `error_code` | `string \| null` | No | Uppercase identifier matching `^[A-Z](?:[A-Z0-9]\|_[A-Z0-9])*$` from `spec/error_codes.json`, or `null`. |
| `reset_reason` | `string` | No | Non-empty string from `esp_reset_reason()` (e.g., `"ESP_RST_POWERON"`, `"ESP_RST_BROWNOUT"`, `"ESP_RST_TASK_WDT"`, `"ESP_RST_INT_WDT"`, `"ESP_RST_PANIC"`, `"ESP_RST_SW"`). |
| `rssi` | `number` | No | Finite Wi-Fi RSSI in dBm (e.g., `-67`). |
| `free_heap` | `number` | No | Non-negative integer (`>= 0`) bytes from `esp_get_free_heap_size()`. |
| `subsystem` | `string` | No | Non-empty subsystem tag (e.g., `"traverse_stepper"`, `"tension_adc"`, `"spindle_drive"`, `"wifi"`). |
| `message` | `string` | No | Concise non-empty diagnostic summary (keep short so total payload stays `< 1024` bytes). |
| `details` | `object` | No | **Flat** key-value map (`Record<string, string \| number \| boolean \| null>`). Nested objects and arrays are rejected. |
| `ts` | `string \| number` | No | Optional non-empty timestamp string or finite non-negative number. |

#### Error-Event Classification (`isErrorEvent`)

An event is treated as an error/fault event (surfaced in the Worker Portal's recent errors feed and `errorsOnly=true` queries) whenever **either**:
1. `event_type` is in `["ERROR", "FAULT", "SUBSYSTEM_TIMEOUT", "CRASH_RESET"]`, **or**
2. `error_code` is non-null / non-empty.

#### Examples

Startup crash / brownout forensics (`esp_reset_reason()`):

```json
{
  "event_type": "CRASH_RESET",
  "error_code": "ERR_BROWNOUT_RESET",
  "reset_reason": "ESP_RST_BROWNOUT",
  "rssi": -68,
  "free_heap": 184320,
  "subsystem": "power",
  "message": "ESP32 rebooted due to brownout",
  "details": { "min_free_heap": 142000 }
}
```

Normal boot telemetry:

```json
{
  "event_type": "BOOT",
  "reset_reason": "ESP_RST_POWERON",
  "rssi": -62,
  "free_heap": 191488,
  "details": { "fw_version": "1.0.0" }
}
```

Subsystem timeout:

```json
{
  "event_type": "SUBSYSTEM_TIMEOUT",
  "error_code": "ERR_SUBSYSTEM_TIMEOUT",
  "subsystem": "traverse_stepper",
  "rssi": -71,
  "free_heap": 176400,
  "message": "No limit-switch ack within 2500ms",
  "details": { "timeout_ms": 2500 }
}
```

Periodic heartbeat:

```json
{
  "event_type": "HEARTBEAT",
  "rssi": -64,
  "free_heap": 188240
}
```

---

### 3.3 `factory/winders/{machineId}/coil`

ESP32 internal winding cycle telemetry (automatic stop, explicit abort, unexpected fault termination, elapsed duration, and total wound fiber length) persisted in `coil_outcomes`.

- **MQTT Retain Flag:** **`false`**

#### Payload Fields

| Field | Type | Required | Validation / Semantics |
| :--- | :--- | :--- | :--- |
| `outcome` | `string` | **Yes** | Enum: `"AUTO_FINISHED"`, `"ABORTED"`, or `"FAULT_TERMINATED"`. |
| `reason_code` | `string \| null` | No | Optional non-empty string (recommended: matching `error_code` from `spec/error_codes.json` such as `"ERR_FIBER_SNAP"` or `"OPERATOR_ABORT"`), or `null`. |
| `duration_sec` | `number` | No | Non-negative **integer** (`>= 0`, no decimals) representing elapsed cycle seconds. |
| `wound_length` | `number` | No | Optional finite non-negative number (`>= 0`) reporting total wound fiber length from cycle start to stop (firmware-configured linear unit, default meters — confirm physical unit label with firmware team before flashing). |
| `ts` | `string \| number` | No | Optional non-empty timestamp string or finite non-negative number. |

#### External QR / CRM Exclusion Rule

- **CRM/QR outcomes (`"REDO"`, `"COMPLETED"`, `"FAILED"`) are explicitly excluded and MUST NOT be published on `coil`.**
- `coilPayloadSchema` rejects `"REDO"`, `"COMPLETED"`, `"FAILED"`, and any value other than `"AUTO_FINISHED"`, `"ABORTED"`, or `"FAULT_TERMINATED"`.
- Rationale: we do not have access to the third-party Android QR/CRM system; this topic captures strictly what the ESP32 winding controller observes internally (`start`, automatic program finish, explicit abort, unexpected fault/crash termination, duration, and wound fiber length).

#### Examples

Normal automatic program finish (`AUTO_FINISHED`):

```json
{"outcome":"AUTO_FINISHED","duration_sec":148,"wound_length":124.5}
```

Explicit operator abort (`ABORTED`):

```json
{"outcome":"ABORTED","reason_code":"OPERATOR_ABORT","duration_sec":43,"wound_length":38.2}
```

Unexpected fault termination (`FAULT_TERMINATED`):

```json
{"outcome":"FAULT_TERMINATED","reason_code":"ERR_FIBER_SNAP","duration_sec":61,"wound_length":52.0}
```

---

## 4. Shared Fault Registry (`spec/error_codes.json`)

All `error_code` values published on `status` and `events` (and referenced in `coil.reason_code`) MUST come from `spec/error_codes.json` so firmware enums stay synchronized with the Worker Portal Glossary.

Current canonical Phase 1 fault codes:

| `error_code` | Meaning |
| :--- | :--- |
| `ERR_FIBER_SNAP` | Strand tension dropped to zero during an active winding cycle |
| `ERR_TENSION_FAULT` | Tension remained outside the allowed band past the debounce window |
| `ERR_SUBSYSTEM_TIMEOUT` | Missing encoder pulse, stepper ack, or limit-switch transition |
| `ERR_BOBBIN_JAM` | Spindle or traverse carriage stalled under load |
| `ERR_BROWNOUT_RESET` | `esp_reset_reason()` reported a supply voltage brownout reset |
| `ERR_WATCHDOG_RESET` | Hardware/task watchdog triggered a reboot after firmware freeze |

Every `error_code` must satisfy `^[A-Z](?:[A-Z0-9]|_[A-Z0-9])*$` (uppercase C++ enum identifier with no spaces, hyphens, consecutive underscores, or trailing underscores).

---

## 5. Worker Portal Canonical Constants (Reference)

These constants live alongside the MQTT contract in `src/spec/mqtt-contract.ts` and `db/init.sql`:

- **Floor Zones:** `NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`
- **Bug Report Quick Tags:** `Fiber Snap`, `Tension`, `Unit Dead`, `Bobbin Jam`, `Other`

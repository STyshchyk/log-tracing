# ESP32 Pico Behavioral Integration Guide

Implementation guide for wiring ESP32 Pico winding-machine firmware to the Factory Winding Room Telemetry backend using the protocol contract in [`spec/MQTT_TOPICS.md`](./MQTT_TOPICS.md) and fault dictionary in [`spec/error_codes.json`](./error_codes.json).

---

## 1. Architectural Invariants (Non-Negotiable)

1. **Never block real-time winding control or ISRs:**
   - Winding motion control (spindle PWM/DAC, stepper pulses, tension ADC control loop, encoder/limit ISRs) runs on **Core 1 (`APP_CPU`)** and MUST NEVER perform Wi-Fi calls, TCP socket writes, DNS lookups, LittleFS flash writes, or dynamic heap allocations.
2. **Isolate MQTT & networking to a low-priority Core 0 task:**
   - All MQTT connection management, JSON formatting, ring-buffer persistence, and `publish()` calls run inside a dedicated **low-priority FreeRTOS task pinned to Core 0 (`PRO_CPU`)**.
3. **Absorb Wi-Fi dropouts with a bounded ring-buffer:**
   - Factory Wi-Fi drops and AP switches must never drop fault/coil records or panic the MCU. Buffer outbound telemetry in a **bounded RAM or LittleFS ring-buffer** with deterministic overwrite rules.
4. **Strictly `< 1 KB` (`< 1024` UTF-8 bytes) payloads with zero heap fragmentation:**
   - Format JSON into a fixed `char buf[1024]` stack/static buffer using `snprintf` (or fixed-capacity `StaticJsonDocument`) and verify `len > 0 && len < 1024` before publishing. Never build MQTT JSON with `String` concatenation loops.

---

## 2. Core & Task Topology (Dual-Core ESP32 Pico)

| Core | Responsibility | FreeRTOS Priority | Rules |
| :--- | :--- | :--- | :--- |
| **Core 1** (`APP_CPU`) | Winding state machine, stepper/spindle control, tension PID, encoder/fault ISRs | High (e.g., `5`–`10` + hardware ISRs) | Enqueue fixed-size POD structs via `xQueueSend(..., 0)` or `xQueueSendFromISR(...)`. Zero blocking, zero `malloc`, zero flash/network I/O. |
| **Core 0** (`PRO_CPU`) | Wi-Fi/LwIP stack (IDF internal), MQTT client, **Telemetry Publisher Task** | Low (`1`–`2`) | Drains FreeRTOS queue, spills to bounded ring-buffer when offline, formats `< 1024` B JSON, publishes to Mosquitto, yields regularly so `IDLE0` feeds Task Watchdog (`TWDT`). |

### Non-Blocking Queue Contract

Define a compact fixed-size Plain-Old-Data (POD) struct (no pointers to heap strings, no `std::string`, no Arduino `String`) so messages can be copied by value through a FreeRTOS queue:

```cpp
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include <stdint.h>

enum class TelemetryChannel : uint8_t { STATUS = 0, EVENT = 1, COIL = 2 };

enum class WinderState : uint8_t { WORKING = 0, IDLE = 1, ERROR = 2, OFFLINE = 3 };

enum class WinderEventType : uint8_t {
  ERROR = 0,
  FAULT = 1,
  SUBSYSTEM_TIMEOUT = 2,
  CRASH_RESET = 3,
  BOOT = 4,
  HEARTBEAT = 5,
  DIAGNOSTIC = 6,
  INFO = 7,
};

enum class CoilOutcome : uint8_t { COMPLETED = 0, ABORTED = 1 };

// Synchronized with spec/error_codes.json
enum class WinderErrorCode : uint16_t {
  NONE = 0,
  ERR_FIBER_SNAP,
  ERR_TENSION_FAULT,
  ERR_SUBSYSTEM_TIMEOUT,
  ERR_BOBBIN_JAM,
  ERR_BROWNOUT_RESET,
  ERR_WATCHDOG_RESET,
};

struct TelemetryMsg {
  TelemetryChannel channel;
  uint32_t uptime_ms;
  union {
    struct {
      WinderState state;
      WinderErrorCode error_code;
    } status;
    struct {
      WinderEventType event_type;
      WinderErrorCode error_code;
      int8_t rssi;
      uint32_t free_heap;
      char subsystem[24];
      char message[96];
    } event;
    struct {
      CoilOutcome outcome;
      WinderErrorCode reason_code;
      uint32_t duration_sec;
    } coil;
  } data;
};

static QueueHandle_t s_telemetry_queue = nullptr;
static volatile uint32_t s_queue_drops = 0;

void telemetry_init_queue() {
  // Depth 32 (~4.5 KB static/queue RAM) absorbs bursts between Core 1 and Core 0
  s_telemetry_queue = xQueueCreate(32, sizeof(TelemetryMsg));
}

// Safe from Core 1 control loop (never waits: timeout = 0)
bool telemetry_enqueue_nonblocking(const TelemetryMsg& msg) {
  if (!s_telemetry_queue) return false;
  if (xQueueSend(s_telemetry_queue, &msg, 0) != pdTRUE) {
    s_queue_drops++;
    return false;
  }
  return true;
}

// Safe from hardware ISRs (IRAM-safe, zero blocking)
void IRAM_ATTR telemetry_enqueue_from_isr(const TelemetryMsg& msg) {
  if (!s_telemetry_queue) return;
  BaseType_t woken = pdFALSE;
  if (xQueueSendFromISR(s_telemetry_queue, &msg, &woken) != pdTRUE) {
    s_queue_drops++;
  }
  if (woken == pdTRUE) {
    portYIELD_FROM_ISR();
  }
}
```

> **Tip:** Note that `s_queue_drops` can be reported occasionally in a `DIAGNOSTIC` event if non-zero so you know immediately if the queue depth needs tuning.

---

## 3. Bounded RAM / LittleFS Ring-Buffer (Wi-Fi Dropout Resilience)

When `mqtt_connected == false` (Wi-Fi disconnect, AP roam, or Mosquitto container restart), the Core 0 Telemetry Publisher Task MUST NOT discard events immediately or allocate dynamic buffers on the heap.

### Option A: Bounded Static RAM Ring-Buffer (Recommended Default)

- Allocate a fixed static circular array in BSS (e.g., `static TelemetryMsg s_ring[96];`, ~13 KB total RAM on ESP32 Pico).
- **Zero flash wear**, **zero heap fragmentation**, and works even if LittleFS is not mounted.
- Survives temporary Wi-Fi dropouts and broker restarts (unless power is lost).

### Option B: Bounded LittleFS Ring-Buffer (Survives Power Loss During Wi-Fi Outage)

- Store fixed-size binary records (or bounded NDJSON lines) inside a capped circular file/pair of files on LittleFS (e.g., maximum `128` or `256` records, strictly bounded at `<= 64 KB` flash usage).
- **Important SPI Flash Rule:** Only the **Core 0 Telemetry Publisher Task** may open/write/read LittleFS, and only batch writes when Wi-Fi is down or on critical faults/coil outcomes. Ensure Core 1 time-critical ISRs live in `IRAM_ATTR` if flash cache pauses occur during LittleFS writes.

### Overflow & Flush Policy

1. **Bounded eviction:** When the ring-buffer is full, overwrite the **oldest** entry (`head = (head + 1) % CAP`) rather than crashing or growing unboundedly. Optionally retain `ERROR` / `CRASH_RESET` / `COIL` slots ahead of `HEARTBEAT` slots.
2. **Keep `status` fresh:** Do not replay stale historical `status` transitions after a long outage—publish the **current** live machine state (`IDLE` / `WORKING` / `ERROR`) once on reconnect, then drain buffered `events` and `coil` messages.
3. **Throttled reconnect drain:** Publish at most `4`–`8` buffered messages per `50 ms` tick on reconnect so TCP buffers (`lwip` pbufs) and Mosquitto are not flooded.
4. **Confirm before advance:** Advance the ring tail only after `esp_mqtt_client_publish` / `publish()` succeeds (or `MQTT_EVENT_PUBLISHED` for QoS 1).

---

## 4. Payload Sizing (`< 1024` UTF-8 Bytes) & Zero-Fragmentation Formatting

The backend enforces `byteLength < 1024` (`MAX_MQTT_PAYLOAD_BYTES = 1024` in `src/spec/mqtt-contract.ts`).

### Rules for Core 0 JSON Serialization

1. Allocate a fixed `char payload[1024]` buffer inside the Core 0 publisher task (or static task buffer).
2. Configure the MQTT library TX/RX buffer to `>= 1024` bytes (`buffer.size = 1024` in ESP-IDF `esp_mqtt_client_config_t`, or `mqtt.setBufferSize(1024)` in Arduino `PubSubClient`).
3. Escape or sanitize any dynamic strings (`message`, `subsystem`) so quotes/backslashes cannot produce invalid JSON, and truncate strings cleanly if needed so `len` never reaches `1024`.
4. Always guard before publishing:

```cpp
int len = snprintf(
    payload, sizeof(payload),
    "{\"event_type\":\"%s\",\"error_code\":\"%s\",\"rssi\":%d,\"free_heap\":%lu,\"subsystem\":\"%s\",\"message\":\"%s\"}",
    event_type_str, error_code_str, rssi, (unsigned long)free_heap, subsystem, message);

if (len <= 0 || len >= static_cast<int>(sizeof(payload))) {
  // Truncate optional fields (message/details) and re-format compactly so len < 1024
  len = snprintf(
      payload, sizeof(payload),
      "{\"event_type\":\"%s\",\"error_code\":\"%s\",\"rssi\":%d,\"free_heap\":%lu}",
      event_type_str, error_code_str, rssi, (unsigned long)free_heap);
}

if (len > 0 && len < 1024) {
  esp_mqtt_client_publish(client, topic, payload, len, 1, 0);
}
```

---

## 5. Startup Crash Forensics (`esp_reset_reason()`), RSSI & Free Heap

### Boot Forensics

Read `esp_reset_reason()` once at boot (`app_main()` / `setup()`) and enqueue an initial event before entering the main loop:

```cpp
#include "esp_system.h"

const char* reset_reason_to_str(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:   return "ESP_RST_POWERON";
    case ESP_RST_EXT:       return "ESP_RST_EXT";
    case ESP_RST_SW:        return "ESP_RST_SW";
    case ESP_RST_PANIC:     return "ESP_RST_PANIC";
    case ESP_RST_INT_WDT:   return "ESP_RST_INT_WDT";
    case ESP_RST_TASK_WDT:  return "ESP_RST_TASK_WDT";
    case ESP_RST_WDT:       return "ESP_RST_WDT";
    case ESP_RST_DEEPSLEEP: return "ESP_RST_DEEPSLEEP";
    case ESP_RST_BROWNOUT:  return "ESP_RST_BROWNOUT";
    case ESP_RST_SDIO:      return "ESP_RST_SDIO";
    default:                return "ESP_RST_UNKNOWN";
  }
}
```

Map abnormal resets to `CRASH_RESET` + shared fault codes from `spec/error_codes.json`:

| `esp_reset_reason()` | `event_type` | `error_code` |
| :--- | :--- | :--- |
| `ESP_RST_BROWNOUT` | `"CRASH_RESET"` | `"ERR_BROWNOUT_RESET"` |
| `ESP_RST_TASK_WDT`, `ESP_RST_INT_WDT`, `ESP_RST_WDT`, `ESP_RST_PANIC` | `"CRASH_RESET"` | `"ERR_WATCHDOG_RESET"` |
| `ESP_RST_POWERON`, `ESP_RST_SW`, `ESP_RST_EXT`, `ESP_RST_DEEPSLEEP` | `"BOOT"` | omit or `null` |

### Runtime Health Metrics

- **Wi-Fi RSSI:** Sample via `esp_wifi_sta_get_ap_info(&ap_info)` (`ap_info.rssi`) in ESP-IDF or `WiFi.RSSI()` in Arduino-ESP32. Only include `rssi` when Wi-Fi STA is connected (or send `-127` / omit when offline).
- **Free Heap:** Sample via `esp_get_free_heap_size()`. Optionally include `"details":{"min_free_heap": <esp_get_minimum_free_heap_size()>}` on `HEARTBEAT` / `BOOT` events to track slow heap leaks over multi-day runs.
- **Heartbeat Cadence:** Publish a `HEARTBEAT` event every `60` seconds (plus immediate `BOOT`/`CRASH_RESET` on startup and immediate `ERROR`/`FAULT`/`SUBSYSTEM_TIMEOUT` on faults).

---

## 6. MQTT Connection, LWT, State & Coil Lifecycle

### LWT Configuration (Mandatory)

Configure Last Will & Testament at MQTT client initialization (before connecting):

- **Topic:** `factory/winders/{machineId}/status` (e.g., `factory/winders/W-01/status`)
- **Payload:** `{"state":"OFFLINE"}`
- **QoS:** `1`
- **Retain:** `true`
- **Keepalive:** `20` seconds (typical; `15`–`30` seconds)

### Required Lifecycle Sequence

1. **On `MQTT_EVENT_CONNECTED`:**
   - Immediately publish retained `status` with the machine's actual current state (e.g., `{"state":"IDLE"}` or `{"state":"WORKING"}` or `{"state":"ERROR","error_code":"..."}`), `qos=1`, `retain=true`. This overwrites any LWT `OFFLINE` retained message on the broker.
   - Flush pending ring-buffer `events` and `coil` records (including the boot `BOOT` / `CRASH_RESET` event captured at startup).
2. **On Cycle Start (`IDLE` -> `WORKING`):**
   - Publish retained `status`: `{"state":"WORKING"}` (`retain=true`). Backend automatically clears any prior `active_error`.
3. **On Cycle Normal Finish (`WORKING` -> `IDLE`):**
   - Publish `coil`: `{"outcome":"COMPLETED","duration_sec":<elapsed_s>}` (`retain=false`, `qos=1`).
   - Publish retained `status`: `{"state":"IDLE"}` (`retain=true`).
4. **On Fault / Fiber Snap / Tension Fault / Jam / Timeout (`WORKING` -> `ERROR`):**
   - Publish retained `status`: `{"state":"ERROR","error_code":"ERR_..."}` (`retain=true`, `qos=1`).
   - Publish `events`: `{"event_type":"ERROR" | "SUBSYSTEM_TIMEOUT" | "FAULT","error_code":"ERR_...","subsystem":"...","rssi":...,"free_heap":...,"message":"..."}` (`retain=false`, `qos=1`).
   - If a winding cycle was active when aborted/stopped, publish `coil`: `{"outcome":"ABORTED","reason_code":"ERR_...","duration_sec":<elapsed_s>}` (`retain=false`, `qos=1`).
   - **Never publish `"REDO"`** on `coil`—Phase 1 accepts only `"COMPLETED"` and `"ABORTED"`.
5. **On Fault Cleared (`ERROR` -> `IDLE` or `WORKING`):**
   - Publish retained `status`: `{"state":"IDLE"}` (or `{"state":"WORKING"}`) with `retain=true`. Backend automatically clears `active_error`.

---

## 7. Synchronizing `error_code` Enum with `spec/error_codes.json`

Do not invent ad-hoc error code strings in firmware. Generate or mirror your `WinderErrorCode` enum directly from `spec/error_codes.json`:

```cpp
const char* error_code_to_str(WinderErrorCode code) {
  switch (code) {
    case WinderErrorCode::ERR_FIBER_SNAP:        return "ERR_FIBER_SNAP";
    case WinderErrorCode::ERR_TENSION_FAULT:     return "ERR_TENSION_FAULT";
    case WinderErrorCode::ERR_SUBSYSTEM_TIMEOUT: return "ERR_SUBSYSTEM_TIMEOUT";
    case WinderErrorCode::ERR_BOBBIN_JAM:        return "ERR_BOBBIN_JAM";
    case WinderErrorCode::ERR_BROWNOUT_RESET:    return "ERR_BROWNOUT_RESET";
    case WinderErrorCode::ERR_WATCHDOG_RESET:    return "ERR_WATCHDOG_RESET";
    case WinderErrorCode::NONE:
    default:                                     return nullptr;
  }
}
```

When adding a new fault code in the future, add its entry to `spec/error_codes.json` first (matching `^[A-Z](?:[A-Z0-9]|_[A-Z0-9])*$`) so the backend Glossary seeds its plain-English fix steps automatically.

---

## 8. Pilot Verification Checklist (Local Stack)

Before flashing onto shop-floor machines, verify a pilot ESP32 against the local Docker Compose stack (`docker compose up -d`):

1. **Watch broker traffic:**
   ```bash
   mosquitto_sub -h <server-lan-ip> -p 1883 -t 'factory/winders/#' -v
   ```
2. **Boot & Diagnostics:** Power on ESP32; confirm retained `factory/winders/W-01/status` = `{"state":"IDLE"}` and `factory/winders/W-01/events` receives `BOOT` (or `CRASH_RESET`) with `reset_reason`, `rssi`, and `free_heap`.
3. **Fault & Glossary Pinning:** Trigger a test fault (e.g., `ERR_FIBER_SNAP`); verify `GET http://<server-lan-ip>:3000/api/machines/W-01` shows `current_state: "ERROR"` and `active_error: "ERR_FIBER_SNAP"`, and `GET /m/W-01/glossary` pins `ERR_FIBER_SNAP` at the top.
4. **Cycle Outcomes:** Complete one cycle and abort one cycle; confirm `COMPLETED` and `ABORTED` payloads are accepted and < 1024 bytes.
5. **Wi-Fi Drop Ring-Buffer:** Disable AP / block Wi-Fi for 30 seconds while triggering events, restore Wi-Fi, and verify buffered events arrive in `GET /api/machines/W-01/events` without crashing or stalling Core 1.
6. **LWT Offline Detection:** Unplug ESP32 USB/power cleanly without calling `disconnect()`; confirm within ~1.5x keepalive (`~30s`) Mosquitto publishes LWT `{"state":"OFFLINE"}` and `GET /m/W-01` shows `OFFLINE`.

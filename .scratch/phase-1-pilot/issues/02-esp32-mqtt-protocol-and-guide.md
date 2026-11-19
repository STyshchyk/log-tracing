# 02: ESP32 MQTT Protocol Contract & Behavioral Integration Guide

**What to build:** Deliver the self-contained firmware protocol contract and ESP32 behavioral integration guide so the external firmware developer (or their coding agent) can wire up pilot winders with minimal involvement from us.

**Blocked by:** 01: Shared Fault Registry (error_code Dictionary)

**Status:** done

- [x] Protocol contract defines the three per-machine topics under the winders machine-ID namespace (`status`, `events`, `coil`) with exact JSON payload shapes, required and optional fields, and validation rules.
- [x] Status contract specifies retained messages, canonical states (`WORKING`, `IDLE`, `ERROR`, `OFFLINE`), optional `active_error`, and MQTT Last Will & Testament configured to publish `OFFLINE` on ungraceful disconnect.
- [x] Events contract covers subsystem timeouts, `error_code` references from the shared fault registry, startup `esp_reset_reason()` crash/brownout forensics, Wi-Fi RSSI, and free heap diagnostics.
- [x] Coil contract specifies `COMPLETED` and `ABORTED` outcomes plus optional reason code and duration in seconds, explicitly noting that `REDO` is excluded in Phase 1.
- [x] Behavioral integration guide documents non-blocking FreeRTOS queueing from control loops and ISRs flushed by a low-priority Core 0 MQTT task, a bounded RAM or LittleFS ring-buffer for Wi-Fi drops, and strict `< 1 KB` JSON payload limits.
- [x] Protocol schemas are machine-validatable so backend ingestion tests enforce the exact same contract.

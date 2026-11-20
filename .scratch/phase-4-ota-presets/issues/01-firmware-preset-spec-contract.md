# 01: Firmware & Preset Spec Contract (`spec/`)

**What to build:** Define the MQTT and ESP32 integration contract for firmware OTA updates, version reporting, versioned JSON presets, and dual-partition automatic rollback.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `spec/MQTT_TOPICS.md` documents optional `fw_version`, `preset_version`, and `preset_name` fields in `factory/winders/{id}/status`.
- [ ] `spec/MQTT_TOPICS.md` defines `factory/winders/{id}/command` payloads for `OTA_UPDATE` (url, version, sha256) and `APPLY_PRESET` (version, config).
- [ ] `spec/ESP32_INTEGRATION.md` specifies dual-OTA partition layout and automatic rollback if MQTT fails to reconnect within ~60s after reboot.
- [ ] `spec/ESP32_INTEGRATION.md` documents idle-only execution guardrails on the ESP32 side.

# 05: `/fleet` PWA OTA, Preset & Check-Updates UI

**What to build:** Add **Check Updates**, firmware `.bin` upload/release selection, multi-select machine checkboxes, per-machine OTA/preset controls in the drill-down drawer, and `PENDING` status/cancel controls to the `/fleet` PWA.

**Blocked by:** 03: Single-Machine & Multi-Select OTA Dispatch + Pending Queue, 04: Versioned Presets Management & MQTT Push

**Status:** done

- [x] `/fleet` displays each machine's `fw_version` and `preset_version` and highlights outdated machines when **Check Updates** is clicked.
- [x] `/fleet` supports uploading a `.bin` firmware release and selecting a target release or preset.
- [x] `/fleet` supports multi-selecting machines and triggering a batch OTA or preset update.
- [x] Machine drill-down drawer supports single-machine OTA/preset dispatch and cancelling `PENDING` updates.
- [x] Unauthenticated `/m/:machineId` Worker Portal remains read-only with no OTA or preset controls.

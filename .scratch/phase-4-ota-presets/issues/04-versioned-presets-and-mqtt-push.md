# 04: Versioned Presets Management & MQTT Push

**What to build:** Store named, versioned JSON presets on the server and push them to individual or multi-selected machines over MQTT, reusing the `PENDING` idle-only queue when a machine is `WORKING`.

**Blocked by:** 03: Single-Machine & Multi-Select OTA Dispatch + Pending Queue

**Status:** ready-for-agent

- [ ] `machine_presets` table stores named, versioned JSONB presets (`name`, `version`, `config_json`, `created_at`).
- [ ] Authenticated `/api/fleet/presets` endpoints support creating, listing, and pushing presets to single or multi-selected machines.
- [ ] Pushing a preset dispatches `APPLY_PRESET` over MQTT immediately on `IDLE`/`ERROR` or queues as `PENDING` on `WORKING`.
- [ ] Integration tests cover preset CRUD, immediate push, and `WORKING → IDLE` queued push.

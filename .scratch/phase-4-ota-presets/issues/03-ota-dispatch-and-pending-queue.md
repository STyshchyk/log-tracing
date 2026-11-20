# 03: Single-Machine & Multi-Select OTA Dispatch + Pending Queue

**What to build:** Allow authenticated `/fleet` users to trigger OTA firmware updates for a single machine or a multi-selected group, blocking immediate flashes during `WORKING` by queueing them as `PENDING` and auto-dispatching on `WORKING → IDLE`.

**Blocked by:** 02: Firmware Version Tracking & Release Hosting

**Status:** ready-for-agent

- [ ] `pending_updates` table tracks `PENDING`, `DISPATCHED`, and `CANCELLED` updates per machine.
- [ ] Authenticated OTA dispatch endpoint accepts a single `machineId` or an array of `machineIds`.
- [ ] Machines in `IDLE` or `ERROR` receive the `OTA_UPDATE` MQTT command immediately; machines in `WORKING` are queued as `PENDING`.
- [ ] `status` ingestion automatically dispatches `PENDING` updates when a machine transitions to `IDLE`.
- [ ] Authenticated endpoint allows cancelling a `PENDING` update before dispatch.
- [ ] Integration tests cover immediate dispatch, `WORKING` queueing, `WORKING → IDLE` auto-dispatch, and cancellation.

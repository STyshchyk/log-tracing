# 14: Pilot Machine Seeding (W-01, W-02) & Shop-Floor Verification Runbook

**What to build:** Prepare the system for the live 1–2 winder shop-floor pilot by idempotently registering pilot machines (`W-01`, `W-02`) with forward-compatible floor-zone metadata and providing a repeatable LAN commissioning and simulation verification runbook.

**Blocked by:** 07: Inline Recent Errors Feed on Worker Portal, 09: Worker Portal Glossary / FAQ View with Active-Error Pinning, 11: Worker Portal Report-a-Bug Form & Confirmation UI, 12: Automatic Coil Outcome Ingestion (COMPLETED / ABORTED) & Rollup Views, 13: Live Mosquitto LWT OFFLINE Smoke Test

**Status:** done

- [x] Idempotent seed registers pilot machines (`W-01`, `W-02`) with display names and valid floor-zone metadata (`NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR` plus grid row and column) without overwriting live telemetry state on restart.
- [x] Documented pilot commissioning runbook covers starting the local Docker stack on a factory LAN host, generating printable Help/Report QR URLs for `W-01` and `W-02`, simulating MQTT status, event, coil, and LWT messages before flashing hardware, and validating Worker Portal flows on an Android handheld scanner over local LAN.
- [x] Full automated verification suite (unit/integration seam tests plus live LWT smoke test) passes end-to-end against seeded pilot machines.

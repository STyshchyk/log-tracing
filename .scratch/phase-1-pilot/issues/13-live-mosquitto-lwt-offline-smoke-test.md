# 13: Live Mosquitto LWT OFFLINE Smoke Test

**What to build:** Implement the secondary smoke seam against the live Docker Compose stack proving real broker-level MQTT Last Will & Testament delivery marks a disconnected ESP32 `OFFLINE` all the way to the Worker Portal.

**Blocked by:** 05: Worker Portal Landing Shell & Unknown-Machine Handling

**Status:** done

- [x] Smoke test connects a real MQTT client to the live Mosquitto container with LWT configured to publish `OFFLINE` on the pilot machine's status topic, publishes `WORKING`, and verifies the Worker Portal shows `WORKING`.
- [x] Terminating the MQTT client ungracefully (simulating power loss or Wi-Fi drop) triggers Mosquitto to publish the LWT `OFFLINE` payload.
- [x] Fastify ingests the broker-published LWT message, updates PostgreSQL to `OFFLINE`, and the Worker Portal HTTP response reflects `OFFLINE` within the expected keepalive window.
- [x] Test can be run repeatably via a single command against the local Docker Compose stack.

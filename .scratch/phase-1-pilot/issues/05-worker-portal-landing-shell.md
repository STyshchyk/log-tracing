# 05: Worker Portal Landing Shell & Unknown-Machine Handling

**What to build:** Deliver the zero-login, mobile-first Android Chrome Worker Portal landing screen opened when a worker scans a machine's Help/Report QR sticker, showing live status and the ultra-simple two-button home screen.

**Blocked by:** 04: Live Machine Status Ingestion (WORKING / IDLE / ERROR / OFFLINE)

**Status:** ready-for-agent

- [ ] Visiting the machine portal route for a registered machine renders cleanly in mobile Chrome over plain local LAN HTTP with zero login and zero APK install.
- [ ] Landing screen prominently shows the machine display name/ID, current live state (`WORKING`, `IDLE`, `ERROR`, `OFFLINE`), and active `error_code` badge when present.
- [ ] Home screen presents two large primary action buttons: `Report a Bug` and `Glossary / FAQ`, with no clutter or admin charts.
- [ ] Scanning or visiting an unregistered or invalid machine ID renders a clear, worker-friendly 404 error screen with a recovery link instead of a blank or raw error page.
- [ ] Verified via Fastify `app.inject()` against real database state for `WORKING`, `IDLE`, `ERROR`, `OFFLINE`, and unknown machine IDs.

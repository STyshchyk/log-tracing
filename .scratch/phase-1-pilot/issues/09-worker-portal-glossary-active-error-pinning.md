# 09: Worker Portal Glossary / FAQ View with Active-Error Pinning

**What to build:** Build the mobile-first `Glossary / FAQ` view reachable from the machine home screen so operators immediately see fix steps for the machine's active fault and can search other common issues over the local LAN.

**Blocked by:** 05: Worker Portal Landing Shell & Unknown-Machine Handling, 08: Idempotent Glossary Seeding & Search Endpoint

**Status:** done

- [x] Tapping `Glossary / FAQ` from a machine's landing page opens a readable, mobile-friendly troubleshooting view with a one-tap link back to the machine home screen.
- [x] When the machine has an active `error_code`, that fault's plain-English symptoms and step-by-step fix instructions are visually pinned at the very top of the page.
- [x] Workers can filter and search entries by keyword or `error_code` over the local LAN with zero external CDN or internet dependencies.
- [x] When no active error exists or a search yields no matches, the view displays clear, helpful feedback.
- [x] Verified end-to-end by publishing an `ERROR` status with an `error_code` via the MQTT adapter and asserting pinned ordering and search results via Fastify `app.inject()`.

# 08: Idempotent Glossary Seeding & Search Endpoint

**What to build:** Seed the `error_glossary` database table idempotently from the shared fault registry and expose a search and lookup HTTP endpoint for plain-English troubleshooting entries.

**Blocked by:** 01: Shared Fault Registry (error_code Dictionary), 03: Local Docker Stack, 5-Table Schema & Test Harness Bootstrap

**Status:** ready-for-agent

- [ ] Running Glossary seeding on startup or on demand inserts new `error_code` entries and updates changed titles, symptoms, or Markdown fix steps without duplicating rows or failing on repeat runs.
- [ ] Glossary HTTP endpoint returns all entries and supports case-insensitive filtering by `error_code`, title, symptoms, or fix-step keywords.
- [ ] When requested in the context of a machine with an active `error_code`, the response identifies or orders that active fault first.
- [ ] Verified against real PostgreSQL/TimescaleDB via Fastify `app.inject()`, including repeated idempotent seed runs.

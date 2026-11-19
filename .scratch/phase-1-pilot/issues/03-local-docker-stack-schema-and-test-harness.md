# 03: Local Docker Stack, 5-Table Schema & Test Harness Bootstrap

**What to build:** Stand up the local-first Docker Compose stack (Eclipse Mosquitto, PostgreSQL with TimescaleDB, and a Node.js/Fastify server skeleton with OpenAPI/Swagger) alongside the TypeScript test harness wired to an injectable MQTT transport adapter, Fastify `app.inject()`, and a real PostgreSQL/TimescaleDB test database.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Local Docker Compose launches Mosquitto (LAN-accessible), PostgreSQL/TimescaleDB with persistent volumes, and the Fastify server using `$0/month` open-source images.
- [x] Database initialization creates all five forward-compatible tables (`machines` with `NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR` zones and grid coordinates; `telemetry_events` TimescaleDB hypertable; `coil_outcomes`; `error_glossary`; and `bug_reports` with a nullable photo path column reserved for Phase 3).
- [x] Fastify application accepts an injectable MQTT client transport adapter and database connection at its top-level seam and exposes a healthcheck endpoint plus OpenAPI/Swagger documentation.
- [x] Automated test suite runs against real PostgreSQL/TimescaleDB via Fastify `app.inject()` with zero mocked SQL and verifies database connectivity, table presence, and OpenAPI availability.

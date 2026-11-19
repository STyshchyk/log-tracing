# 07: Inline Recent Errors Feed on Worker Portal

**What to build:** Surface the machine's 3–5 most recent error events inline at the bottom of its Worker Portal landing screen so shop-floor operators immediately spot recurring faults.

**Blocked by:** 05: Worker Portal Landing Shell & Unknown-Machine Handling, 06: Diagnostic Events Ingestion into TimescaleDB

**Status:** done

- [x] Machine landing screen displays the 3–5 most recent error events recorded for that specific machine (newest first), showing timestamp, `error_code`, and readable summary or title.
- [x] Non-error informational telemetry events do not crowd out recent faults in the inline error feed.
- [x] When a machine has zero recorded errors, the section displays a clear empty state rather than failing or breaking layout structure.
- [x] Verified end-to-end by publishing `events` via the injected MQTT adapter and asserting rendered output via Fastify `app.inject()`.

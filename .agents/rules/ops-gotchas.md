---
trigger: always_on
---

# Ops gotchas (log-telemetry)

- **Shell:** Windows PowerShell. Don't chain with `&&`. Use `cmd1; if ($LASTEXITCODE -eq 0) { cmd2 }`.
- **Docker images:** Never guess a tag. Pin a verified version (e.g. `grafana/grafana:11.6.2`; `grafana/grafana-oss` is deprecated and has no `:11` tag). If it won't pull, report it instead of guessing.
- **Docker Compose profiles:** Compose interpolates `${VAR}` across all services in `docker-compose.yml` even when a service's profile (`remote`, `engineering`) is inactive. Never use `${VAR:?error}` for profile-only secrets (e.g. `CF_TOKEN`); use `${VAR:-}` so default `docker compose up` and `docker compose config` succeed without `.env`.
- **Schema (`db/init.sql`):** Runs on every `ensureSchema()` call, concurrently in tests. Guard every `ALTER TABLE`, constraint change and view (re)creation with `DO $$ IF NOT EXISTS ... $$` so repeat runs take no `ACCESS EXCLUSIVE` locks. An unconditional `ALTER TABLE` followed by `CREATE OR REPLACE VIEW` deadlocks against concurrent view reads.
- **Tests:** Vitest runs suites in parallel against one shared Postgres DB. Never assert `after - before` room-wide `machines` or `bug_reports` deltas (use UUID-prefixed IDs and invariant/ID-scoped checks). Any suite that writes `coil_outcomes` can race with `tests/coil-outcomes.test.ts` (known: `grafana-provisioning`, plus `fleet-api` details test); if `pnpm test` shows only room-wide delta failures, re-run `pnpm vitest run --no-file-parallelism` to confirm.
- **Scope exclusions (user decision):** no voice-to-text, no bug-report photos, no QR/CRM `Redo`/`Completed`, and no non-winder machines. Coil outcomes are only `AUTO_FINISHED`/`ABORTED`/`FAULT_TERMINATED` plus `wound_length`.

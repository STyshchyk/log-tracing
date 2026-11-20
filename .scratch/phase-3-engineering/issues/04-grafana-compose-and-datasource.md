# 04: Grafana OSS Docker Compose engineering profile & TimescaleDB provisioning

**What to build:** Add an optional `grafana` (`grafana/grafana:11.6.2`) service to `docker-compose.yml` under `profiles: ["engineering"]` on LAN port `${GRAFANA_PORT:-3001}:3000`, create `grafana/provisioning/datasources/postgres.yml` and `grafana/provisioning/dashboards/dashboards.yml`, and document `GRAFANA_*` env vars in `.env.example`.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Default `docker compose config` / `docker compose up -d` remains unchanged (3 local LAN containers) with zero required Grafana secrets.
- [x] `docker compose --profile engineering config` configures `grafana/grafana:11.6.2` on port `${GRAFANA_PORT:-3001}:3000` with `grafana_data` persistence, `depends_on: postgres (service_healthy)`, `/api/health` healthcheck, and read-only provisioning + dashboard mounts.
- [x] `grafana/provisioning/datasources/postgres.yml` provisions `type: postgres`, `uid: telemetry-postgres`, `url: postgres:5432`, `sslmode: disable`, `postgresVersion: 1600`, and `timescaledb: true`, while `dashboards.yml` provisions folder `Winding Room Engineering` from `/var/lib/grafana/dashboards`.

# 04: Cloudflare tunnel service in Docker Compose

**What to build:** Update `docker-compose.yml` with an optional `remote` profile launching `cloudflare/cloudflared:latest` (`TUNNEL_TOKEN` via `CF_TOKEN`) pointing to the Fastify `app` service over the Compose network, pass `CF_ACCESS_*` environment variables into `app`, and provide `.env.example`.

**Blocked by:** 03: Cloudflare Access authentication middleware

**Status:** done

- [x] Default `docker compose up` remains zero-config LAN-only without requiring `CF_TOKEN`.
- [x] Starting `--profile remote` passes `CF_TOKEN` via `TUNNEL_TOKEN` to `cloudflared tunnel --no-autoupdate run`.
- [x] `.env.example` documents database settings, `CF_TOKEN`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and `CF_ACCESS_ALLOWED_EMAILS`.

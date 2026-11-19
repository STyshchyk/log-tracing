# 09: Fleet commissioning & Cloudflare remote access runbook

**What to build:** Write `docs/FLEET_RUNBOOK.md` documenting how to customize `docs/fleet-seed.csv`, run `pnpm seed:fleet` across all 50 winders, generate batch Help/Report QR stickers, set up a Cloudflare Tunnel (`CF_TOKEN`) and Cloudflare Access email OTP policy (`CF_ACCESS_*`), launch `--profile remote`, keep local LAN fallback working, and run full verification checks.

**Blocked by:** 04: Cloudflare tunnel service in Docker Compose, 05: Fleet PWA shell, L-shaped floor map & summary strip, 07: CLI command & CSV to seed the 50-winder fleet

**Status:** done

- [x] `docs/FLEET_RUNBOOK.md` covers 50-winder CSV seeding, batch QR generation, Cloudflare Tunnel startup, Cloudflare Access setup, and LAN fallback.
- [x] Verified Docker Compose commands and automated test commands match actual `package.json` and `docker-compose.yml`.

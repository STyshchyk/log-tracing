# Phase 2 Fleet Commissioning & Cloudflare Remote Access Runbook

Operations guide for scaling from the 2-winder pilot (`W-01`, `W-02`) to all 50 winding machines (`W-01` through `W-50`), launching the Department Heads `/fleet` PWA, and configuring optional HTTPS remote access via Cloudflare Tunnel and Cloudflare Access.

---

## 1. Registering the 50-Winder Floor Layout (`docs/fleet-seed.csv`)

The winding room layout is defined declaratively in `docs/fleet-seed.csv` (`id,display_name,zone,grid_row,grid_col`):

| Zone | Default Machines | Grid Coordinates |
| :--- | :--- | :--- |
| `NORTH_LEFT` | `W-01` – `W-10` | Rows `1–2`, Cols `1–5` (preserves pilot `W-01` and `W-02`) |
| `NORTH_RIGHT` | `W-11` – `W-20` | Rows `1–2`, Cols `1–5` |
| `MAIN_BANK` | `W-21` – `W-44` | Rows `1–6`, Cols `1–4` |
| `EAST_DOOR` | `W-45` – `W-50` | Rows `1–3`, Cols `1–2` |

### 1.1 Customize and Seed All 50 Machines

Edit `docs/fleet-seed.csv` if physical bays differ on the shop floor, then run the idempotent seeder (preserves live `current_state`, `active_error`, and `last_seen_at`):

```bash
pnpm seed:fleet
```

You can also target an alternate CSV file or database:

```bash
pnpm seed:fleet -- --file docs/fleet-seed.csv
```

Verify seeded count and Fleet API summary locally:

```bash
curl -s http://127.0.0.1:3000/api/fleet/summary
```

---

## 2. Batch Help/Report QR Stickers (`W-01` – `W-50`)

Each winding machine gets one Help/Report sticker pointing to the local LAN host IP (`<server-lan-ip>`):

- `http://<server-lan-ip>:3000/m/W-01` through `http://<server-lan-ip>:3000/m/W-50`

Generate all 50 PNG stickers offline with `qrcode`:

```powershell
New-Item -ItemType Directory -Force qr-stickers | Out-Null
1..50 | ForEach-Object {
  $id = "W-{0:D2}" -f $_
  npx --yes qrcode -o "qr-stickers/$id-qr.png" -w 400 "http://<server-lan-ip>:3000/m/$id"
}
```

Or on Linux / macOS:

```bash
mkdir -p qr-stickers
for i in $(seq -w 1 50); do
  qrencode -o "qr-stickers/W-$i-qr.png" -s 10 -m 2 "http://<server-lan-ip>:3000/m/W-$i"
done
```

> Operators continue using existing QR workflows on the third-party Android app during normal cycles. Only scan the machine Help/Report sticker on faults or troubleshooting.

---

## 3. Local LAN vs. Remote HTTPS Access (`cloudflared` + Cloudflare Access)

### 3.1 Local LAN Fallback (Zero Internet / Zero Cloud Auth)

When `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are unset:
- Starting `docker compose up -d --build` runs **without** `cloudflared`.
- Shop-floor Worker Portal (`http://<server-lan-ip>:3000/m/W-01`) works without login.
- Department Heads Fleet PWA (`http://<server-lan-ip>:3000/fleet`) operates in `Local LAN Mode`.

### 3.2 Remote HTTPS Setup via Cloudflare Zero Trust

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. In the **Cloudflare Zero Trust** dashboard:
   - Create a **Cloudflare Tunnel** and copy its tunnel token into `CF_TOKEN` in `.env`.
   - Add a **Public Hostname** route on that tunnel pointing to service URL `http://app:3000`.
   - Create a **Cloudflare Access Self-Hosted Application** protecting paths `/fleet`, `/fleet/*`, and `/api/fleet/*` with an **Email One-Time Pin** policy for department heads.
   - Leave `/`, `/m/*`, `/api/machines/*`, and `/api/glossary` **unauthenticated** (or Bypass policy) so LAN workers are unaffected.
   - Set `CF_ACCESS_TEAM_DOMAIN` (e.g., `yourteam.cloudflareaccess.com`) and `CF_ACCESS_AUD` (Application Audience Tag) in `.env`.
   - Optionally restrict accepted emails in the backend via `CF_ACCESS_ALLOWED_EMAILS=lead@company.com,manager@company.com`.
3. Launch the stack with the `remote` profile enabled:
   ```bash
   docker compose --profile remote up -d --build
   ```

> **Fail-Closed Safety:** Setting only one of `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD` causes `/fleet` and `/api/fleet/*` to respond with HTTP `503` until both values are set or both are cleared.

---

## 4. Verification Checklist

Run full static checks, integration tests against PostgreSQL/TimescaleDB, live Mosquitto LWT smoke tests, and Compose validation:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:smoke
docker compose config --quiet
CF_TOKEN=verify-only docker compose --profile remote config --quiet
```

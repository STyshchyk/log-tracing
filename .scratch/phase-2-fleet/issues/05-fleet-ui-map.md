# 05: Fleet PWA shell, L-shaped floor map & summary strip

**What to build:** Create `src/ui/fleet-layout.ts` and `src/routes/fleet-portal.ts` serving `GET /fleet` and `GET /fleet/manifest.webmanifest`. Render the zero-CDN Department Heads PWA featuring the machine status + open bug summary strip, interactive `Today | Week | Month | All-Time` coil rollup switcher, accessible 3-tab shell (`Floor Map`, `Room History`, `Master Glossary`), L-shaped CSS Grid floor plan (`NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`), and 10-second live polling.

**Blocked by:** 01: Fleet summary, machines list & room history APIs, 02: Fleet machine-details API, 03: Cloudflare Access authentication middleware

**Status:** done

- [x] `GET /fleet` renders initial SSR HTML with summary strip, all four L-shaped floor zones positioned by `grid_row`/`grid_col`, and non-color state badges.
- [x] `GET /fleet/manifest.webmanifest` returns a valid PWA web app manifest rooted at `/fleet`.
- [x] Three-tab interface follows accessible `tablist`/`tabpanel` semantics (`focusgroup="tablist nomemory"`, `hidden="until-found"`, `beforematch` sync, non-color selected underline, keyboard arrow fallback).
- [x] Auto-polls summary/machines/history every 10 seconds while visible without disturbing active filters or open drawers.

# 07: CLI command & CSV to seed the 50-winder fleet

**What to build:** Create `docs/fleet-seed.csv` containing `W-01` through `W-50` arranged across the L-shaped floor layout (`NORTH_LEFT`, `NORTH_RIGHT`, `MAIN_BANK`, `EAST_DOOR`) and `src/db/seed-fleet-machines.ts` exposed via `pnpm seed:fleet` (and `pnpm seed:full`). Parse and validate CSV integrity (including duplicate ID and duplicate coordinate checks) and idempotently upsert metadata without touching live `current_state`, `active_error`, or `last_seen_at` columns.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `docs/fleet-seed.csv` defines all 50 winders (`W-01`..`W-50`) preserving `W-01` at `NORTH_LEFT (1,1)` and `W-02` at `NORTH_LEFT (1,2)`.
- [x] CSV parser validates header, required fields, zone enum, positive integer grid coordinates, unique IDs, and unique `(zone, grid_row, grid_col)` positions.
- [x] Upsert preserves live telemetry state on conflict and accurately reports inserted, updated, and unchanged counts.

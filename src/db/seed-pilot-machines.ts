import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import type { FloorZone } from '../spec/mqtt-contract.js';
import { createDbPool, ensureSchema } from './pool.js';
import { seedGlossary } from './seed-glossary.js';

const DEFAULT_DATABASE_URL =
  'postgresql://telemetry:telemetry@localhost:5432/telemetry';

/**
 * Static registration and floor-layout metadata for a seeded winding machine.
 */
export interface PilotMachineSeed {
  id: string;
  display_name: string;
  zone: FloorZone;
  grid_row: number;
  grid_col: number;
}

/**
 * Canonical Phase 1 pilot winding machines mounted in the north-left shop-floor bay.
 */
export const PILOT_MACHINES: readonly PilotMachineSeed[] = [
  {
    id: 'W-01',
    display_name: 'Winder 01',
    zone: 'NORTH_LEFT',
    grid_row: 1,
    grid_col: 1,
  },
  {
    id: 'W-02',
    display_name: 'Winder 02',
    zone: 'NORTH_LEFT',
    grid_row: 1,
    grid_col: 2,
  },
] as const;

/**
 * Idempotently register or update pilot machine metadata without altering live telemetry
 * (`current_state`, `active_error`, or `last_seen_at`).
 */
export async function seedPilotMachines(
  db: Pool,
  machines: readonly PilotMachineSeed[] = PILOT_MACHINES,
): Promise<void> {
  if (machines.length === 0) {
    return;
  }

  const sorted = [...machines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const ids = sorted.map((machine) => machine.id);
  const displayNames = sorted.map((machine) => machine.display_name);
  const zones = sorted.map((machine) => machine.zone);
  const gridRows = sorted.map((machine) => machine.grid_row);
  const gridCols = sorted.map((machine) => machine.grid_col);

  await db.query(
    `INSERT INTO machines (id, display_name, zone, grid_row, grid_col)
     SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::integer[], $5::integer[])
     ON CONFLICT (id) DO UPDATE
     SET
       display_name = EXCLUDED.display_name,
       zone = EXCLUDED.zone,
       grid_row = EXCLUDED.grid_row,
       grid_col = EXCLUDED.grid_col
     WHERE
       machines.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR machines.zone IS DISTINCT FROM EXCLUDED.zone
       OR machines.grid_row IS DISTINCT FROM EXCLUDED.grid_row
       OR machines.grid_col IS DISTINCT FROM EXCLUDED.grid_col`,
    [ids, displayNames, zones, gridRows, gridCols],
  );
}

/**
 * Run schema initialization, glossary seeding, and pilot machine seeding for CLI invocations,
 * then close the database pool cleanly.
 */
export async function runPilotSeedCli(
  connectionString: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Promise<void> {
  const db = createDbPool(connectionString);
  try {
    await ensureSchema(db);
    await seedGlossary(db);
    await seedPilotMachines(db);
  } finally {
    await db.end();
  }
}

function normalizeExecutionPath(targetPath: string): string {
  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(targetPath);
  } catch {
    resolvedPath = resolve(targetPath);
  }
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function isExecutedAsCli(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }
  const currentFile = normalizeExecutionPath(fileURLToPath(import.meta.url));
  const invokedFile = normalizeExecutionPath(entryPoint);
  return currentFile === invokedFile;
}

if (isExecutedAsCli()) {
  void runPilotSeedCli()
    .then(() => {
      console.log(
        `Seeded ${PILOT_MACHINES.length} pilot machines: ${PILOT_MACHINES.map((m) => m.id).join(', ')}`,
      );
    })
    .catch((err) => {
      console.error('Failed to seed pilot machines:', err);
      process.exitCode = 1;
    });
}

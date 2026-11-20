import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { createDbPool, ensureSchema } from './pool.js';
import { seedGlossary } from './seed-glossary.js';

const DEFAULT_DATABASE_URL =
  'postgresql://telemetry:telemetry@localhost:5432/telemetry';

/**
 * Static physical floor-position registration and optional initial ESP32 hardware assignment.
 */
export interface PilotMachineSeed {
  id: string;
  display_name: string;
  floor_position: number;
  hardware_id?: string | null;
}

/**
 * Outcome counts from an idempotent machine seed upsert.
 */
export interface MachineSeedCounts {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Canonical Phase 1 pilot winding positions mounted at floor slots #1 and #2.
 */
export const PILOT_MACHINES: readonly PilotMachineSeed[] = [
  {
    id: 'W-01',
    display_name: 'Winder 01',
    floor_position: 1,
    hardware_id: null,
  },
  {
    id: 'W-02',
    display_name: 'Winder 02',
    floor_position: 2,
    hardware_id: null,
  },
] as const;

/**
 * Idempotently upsert machine positions without altering live telemetry (`current_state`,
 * `active_error`, `fw_version`, `preset_version`, `preset_name`, or `last_seen_at`) and without
 * overwriting an already-assigned `hardware_id` when the seed leaves it empty.
 */
export async function upsertSeedMachines(
  db: Pool,
  machines: readonly PilotMachineSeed[],
): Promise<MachineSeedCounts> {
  if (machines.length === 0) {
    return { total: 0, inserted: 0, updated: 0, unchanged: 0 };
  }

  const sorted = [...machines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const ids = sorted.map((machine) => machine.id);
  const displayNames = sorted.map((machine) => machine.display_name);
  const floorPositions = sorted.map((machine) => machine.floor_position);
  const hardwareIds = sorted.map((machine) => machine.hardware_id ?? null);

  const upsertResult = await db.query<{ inserted: boolean }>(
    `INSERT INTO machines (id, display_name, floor_position, hardware_id)
     SELECT * FROM UNNEST($1::text[], $2::text[], $3::integer[], $4::text[])
     ON CONFLICT (id) DO UPDATE
     SET
       display_name = EXCLUDED.display_name,
       zone = 'FLOOR',
       floor_position = EXCLUDED.floor_position,
       hardware_id = COALESCE(machines.hardware_id, EXCLUDED.hardware_id)
     WHERE
       machines.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR machines.zone IS DISTINCT FROM 'FLOOR'
       OR machines.floor_position IS DISTINCT FROM EXCLUDED.floor_position
       OR (machines.hardware_id IS NULL AND EXCLUDED.hardware_id IS NOT NULL)
     RETURNING (xmax = 0) AS inserted`,
    [ids, displayNames, floorPositions, hardwareIds],
  );

  let inserted = 0;
  let updated = 0;
  for (const row of upsertResult.rows) {
    if (row.inserted) {
      inserted += 1;
    } else {
      updated += 1;
    }
  }

  const total = sorted.length;
  return {
    total,
    inserted,
    updated,
    unchanged: total - inserted - updated,
  };
}

/**
 * Idempotently register or update pilot machine metadata without altering live telemetry
 * (`current_state`, `active_error`, or `last_seen_at`).
 */
export async function seedPilotMachines(
  db: Pool,
  machines: readonly PilotMachineSeed[] = PILOT_MACHINES,
): Promise<void> {
  await upsertSeedMachines(db, machines);
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

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { FLOOR_ZONES, type FloorZone } from '../spec/mqtt-contract.js';
import { createDbPool, ensureSchema } from './pool.js';
import { seedGlossary } from './seed-glossary.js';
import type { PilotMachineSeed } from './seed-pilot-machines.js';

const DEFAULT_DATABASE_URL =
  'postgresql://telemetry:telemetry@localhost:5432/telemetry';
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FLEET_CSV_PATH = resolve(MODULE_DIR, '..', '..', 'docs', 'fleet-seed.csv');
const EXPECTED_HEADERS = ['id', 'display_name', 'zone', 'grid_row', 'grid_col'] as const;

/**
 * Summary counts returned by idempotent 50-winder fleet seeding.
 */
export interface SeedFleetResult {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Options for running the full-fleet CSV seed CLI workflow.
 */
export interface RunFleetSeedCliOptions {
  connectionString?: string;
  csvPath?: string;
}

/**
 * Parse and validate a fleet layout CSV containing `id,display_name,zone,grid_row,grid_col`.
 * Rejects invalid headers, invalid floor zones, non-positive coordinates, duplicate machine IDs,
 * and overlapping `(zone, grid_row, grid_col)` floor slots.
 */
export function parseFleetSeedCsv(csvContent: string): PilotMachineSeed[] {
  const normalized = csvContent.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length < 2) {
    throw new Error('Fleet seed CSV must contain a header row and at least one machine row');
  }

  const headerLine = lines[0]!;
  const headers = headerLine.split(',').map((col) => col.trim());
  const headerMatches =
    headers.length === EXPECTED_HEADERS.length &&
    EXPECTED_HEADERS.every((expected, idx) => headers[idx] === expected);
  if (!headerMatches) {
    throw new Error(
      `Invalid fleet CSV header "${headerLine}". Expected: ${EXPECTED_HEADERS.join(',')}`,
    );
  }

  const validZones = new Set<string>(FLOOR_ZONES);
  const seenIds = new Set<string>();
  const seenSlots = new Set<string>();
  const machines: PilotMachineSeed[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i]!;
    const cells = rawLine.split(',').map((cell) => cell.trim());
    if (cells.length !== EXPECTED_HEADERS.length) {
      throw new Error(
        `Invalid column count on CSV line ${lineNumber}: expected ${EXPECTED_HEADERS.length}, got ${cells.length}`,
      );
    }

    const [id, displayName, zoneRaw, rowRaw, colRaw] = cells;
    if (!id || !displayName || !zoneRaw || !rowRaw || !colRaw) {
      throw new Error(`Missing required field on CSV line ${lineNumber}`);
    }

    if (!validZones.has(zoneRaw)) {
      throw new Error(
        `Invalid floor zone "${zoneRaw}" on CSV line ${lineNumber}. Expected one of: ${FLOOR_ZONES.join(', ')}`,
      );
    }

    const gridRow = Number(rowRaw);
    const gridCol = Number(colRaw);
    if (
      !Number.isInteger(gridRow) ||
      gridRow < 1 ||
      !Number.isInteger(gridCol) ||
      gridCol < 1
    ) {
      throw new Error(
        `Invalid grid coordinates (${rowRaw}, ${colRaw}) on CSV line ${lineNumber}; expected positive integers`,
      );
    }

    if (seenIds.has(id)) {
      throw new Error(`Duplicate machine ID "${id}" on CSV line ${lineNumber}`);
    }
    seenIds.add(id);

    const slotKey = `${zoneRaw}:${gridRow}:${gridCol}`;
    if (seenSlots.has(slotKey)) {
      throw new Error(
        `Duplicate floor slot ${zoneRaw} (${gridRow}, ${gridCol}) on CSV line ${lineNumber}`,
      );
    }
    seenSlots.add(slotKey);

    machines.push({
      id,
      display_name: displayName,
      zone: zoneRaw as FloorZone,
      grid_row: gridRow,
      grid_col: gridCol,
    });
  }

  return machines;
}

/**
 * Load and validate fleet machine records from a CSV file on disk.
 */
export function loadFleetSeedCsv(csvPath: string = DEFAULT_FLEET_CSV_PATH): PilotMachineSeed[] {
  const csvContent = readFileSync(csvPath, 'utf8');
  return parseFleetSeedCsv(csvContent);
}

/**
 * Idempotently upsert winding machine registration and floor coordinates without modifying
 * live telemetry state (`current_state`, `active_error`, or `last_seen_at`).
 */
export async function seedFleetMachines(
  db: Pool,
  machines: readonly PilotMachineSeed[],
): Promise<SeedFleetResult> {
  if (machines.length === 0) {
    return { total: 0, inserted: 0, updated: 0, unchanged: 0 };
  }

  const sorted = [...machines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = sorted.map((machine) => machine.id);
  const displayNames = sorted.map((machine) => machine.display_name);
  const zones = sorted.map((machine) => machine.zone);
  const gridRows = sorted.map((machine) => machine.grid_row);
  const gridCols = sorted.map((machine) => machine.grid_col);

  const upsertResult = await db.query<{ inserted: boolean }>(
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
       OR machines.grid_col IS DISTINCT FROM EXCLUDED.grid_col
     RETURNING (xmax = 0) AS inserted`,
    [ids, displayNames, zones, gridRows, gridCols],
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
  const unchanged = total - inserted - updated;
  return { total, inserted, updated, unchanged };
}

function resolveCliCsvPath(argv: readonly string[]): string {
  const fileFlagIdx = argv.findIndex((arg) => arg === '--file' || arg === '-f');
  if (fileFlagIdx !== -1) {
    const candidate = argv[fileFlagIdx + 1];
    if (!candidate) {
      throw new Error('Missing path argument after --file');
    }
    return resolve(candidate);
  }
  return DEFAULT_FLEET_CSV_PATH;
}

/**
 * Initialize schema, seed the fault glossary, and seed all fleet machines from CSV.
 */
export async function runFleetSeedCli(
  options: RunFleetSeedCliOptions = {},
): Promise<SeedFleetResult> {
  const connectionString =
    options.connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const csvPath = options.csvPath ?? resolveCliCsvPath(process.argv.slice(2));
  const machines = loadFleetSeedCsv(csvPath);

  const db = createDbPool(connectionString);
  try {
    await ensureSchema(db);
    await seedGlossary(db);
    return await seedFleetMachines(db, machines);
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
  void runFleetSeedCli()
    .then((result) => {
      console.log(
        `Fleet seed complete (${result.total} total): ${result.inserted} inserted, ${result.updated} updated, ${result.unchanged} unchanged.`,
      );
    })
    .catch((err) => {
      console.error('Failed to seed fleet machines:', err);
      process.exitCode = 1;
    });
}

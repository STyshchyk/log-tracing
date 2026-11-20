import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { HARDWARE_ID_REGEX } from '../services/machines.js';
import { createDbPool, ensureSchema } from './pool.js';
import { seedGlossary } from './seed-glossary.js';
import { upsertSeedMachines, type PilotMachineSeed } from './seed-pilot-machines.js';

const DEFAULT_DATABASE_URL =
  'postgresql://telemetry:telemetry@localhost:5432/telemetry';
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FLEET_CSV_PATH = resolve(MODULE_DIR, '..', '..', 'docs', 'fleet-seed.csv');
const EXPECTED_HEADERS = ['id', 'display_name', 'floor_position', 'hardware_id'] as const;

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
 * Parse and validate a fleet layout CSV containing `id,display_name,floor_position,hardware_id`.
 * Rejects invalid headers, non-positive floor positions, invalid hardware IDs, duplicate machine
 * IDs, duplicate floor positions, and duplicate hardware IDs.
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

  const seenIds = new Set<string>();
  const seenPositions = new Set<number>();
  const seenHardwareIds = new Set<string>();
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

    const [id, displayName, floorPositionRaw, hardwareIdRaw] = cells;
    if (!id || !displayName || !floorPositionRaw) {
      throw new Error(`Missing required field on CSV line ${lineNumber}`);
    }

    const floorPosition = Number(floorPositionRaw);
    if (!Number.isInteger(floorPosition) || floorPosition < 1) {
      throw new Error(
        `Invalid floor_position "${floorPositionRaw}" on CSV line ${lineNumber}; expected a positive integer`,
      );
    }

    const hardwareId = hardwareIdRaw ? hardwareIdRaw : null;
    if (hardwareId !== null && !HARDWARE_ID_REGEX.test(hardwareId)) {
      throw new Error(
        `Invalid hardware_id "${hardwareId}" on CSV line ${lineNumber}; expected 1-64 chars matching [A-Za-z0-9_-]`,
      );
    }

    if (seenIds.has(id)) {
      throw new Error(`Duplicate machine ID "${id}" on CSV line ${lineNumber}`);
    }
    seenIds.add(id);

    if (seenPositions.has(floorPosition)) {
      throw new Error(`Duplicate floor_position ${floorPosition} on CSV line ${lineNumber}`);
    }
    seenPositions.add(floorPosition);

    if (hardwareId !== null) {
      if (seenHardwareIds.has(hardwareId)) {
        throw new Error(`Duplicate hardware_id "${hardwareId}" on CSV line ${lineNumber}`);
      }
      seenHardwareIds.add(hardwareId);
    }

    machines.push({
      id,
      display_name: displayName,
      floor_position: floorPosition,
      hardware_id: hardwareId,
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
 * Idempotently upsert winding machine registration and floor positions without modifying live
 * telemetry state (`current_state`, `active_error`, or `last_seen_at`).
 */
export async function seedFleetMachines(
  db: Pool,
  machines: readonly PilotMachineSeed[],
): Promise<SeedFleetResult> {
  return upsertSeedMachines(db, machines);
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

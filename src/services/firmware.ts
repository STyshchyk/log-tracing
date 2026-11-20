import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { Pool } from 'pg';
import {
  SHA256_HEX_REGEX,
  type MachineState,
} from '../spec/mqtt-contract.js';
import { listFleetMachines } from './fleet.js';

/**
 * Maximum accepted ESP32 firmware binary upload size (4 MiB).
 */
export const MAX_FIRMWARE_BYTES = 4 * 1024 * 1024;

/**
 * Pattern matching valid firmware release version strings.
 */
export const FIRMWARE_VERSION_REGEX = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

const MAX_FILENAME_LENGTH = 128;
const MAX_NOTES_LENGTH = 2000;

/**
 * Error thrown when a firmware upload request fails input validation or checksum matching.
 */
export class InvalidFirmwareInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFirmwareInputError';
  }
}

/**
 * Error thrown when uploading a firmware version that already exists.
 */
export class DuplicateFirmwareVersionError extends Error {
  readonly version: string;

  constructor(version: string) {
    super(`Firmware release version already exists: ${version}`);
    this.name = 'DuplicateFirmwareVersionError';
    this.version = version;
  }
}

/**
 * Error thrown when a stored firmware binary is missing, escapes storage, or fails SHA-256 verification.
 */
export class FirmwareIntegrityError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FirmwareIntegrityError';
  }
}

/**
 * Serialized firmware release metadata returned by Fleet APIs.
 */
export interface FirmwareReleaseRecord {
  id: number;
  version: string;
  filename: string;
  file_path: string;
  sha256: string;
  size_bytes: number;
  notes: string | null;
  download_url: string;
  created_at: string;
}

/**
 * Machine firmware comparison status against a target firmware release.
 */
export type FirmwareUpdateStatus = 'UP_TO_DATE' | 'OUTDATED' | 'UNKNOWN' | 'NO_RELEASE';

/**
 * Per-machine firmware and preset version status computed by `checkFleetFirmwareUpdates`.
 */
export interface MachineUpdateCheckRecord {
  machine_id: string;
  display_name: string;
  zone: string;
  floor_position: number | null;
  hardware_id: string | null;
  current_state: MachineState;
  fw_version: string | null;
  preset_version: string | null;
  preset_name: string | null;
  target_version: string | null;
  update_status: FirmwareUpdateStatus;
  is_outdated: boolean;
}

/**
 * Fleet-wide firmware update check summary and per-machine comparison rows.
 */
export interface FirmwareUpdateCheckResult {
  checked_at: string;
  latest_release: FirmwareReleaseRecord | null;
  target_version: string | null;
  total_machines: number;
  up_to_date_count: number;
  outdated_count: number;
  unknown_version_count: number;
  needs_update_count: number;
  machines: MachineUpdateCheckRecord[];
}

/**
 * Input payload accepted when registering and storing an uploaded firmware `.bin` release.
 */
export interface UploadFirmwareReleaseInput {
  version: string;
  filename?: string | undefined;
  notes?: string | undefined;
  expectedSha256?: string | undefined;
  binary: Buffer;
}

interface FirmwareReleaseRow {
  id: number | string;
  version: string;
  filename: string;
  file_path: string;
  sha256: string;
  size_bytes: number | string;
  notes: string | null;
  created_at: Date;
}

const FIRMWARE_RELEASE_COLUMNS = `
  id,
  version,
  filename,
  file_path,
  sha256,
  size_bytes,
  notes,
  created_at
`;

function mapFirmwareReleaseRow(row: FirmwareReleaseRow): FirmwareReleaseRecord {
  return {
    id: Number(row.id),
    version: row.version,
    filename: row.filename,
    file_path: row.file_path,
    sha256: row.sha256,
    size_bytes: Number(row.size_bytes),
    notes: row.notes,
    download_url: buildFirmwareDownloadUrl(row.version),
    created_at: row.created_at.toISOString(),
  };
}

function normalizeFirmwareVersion(version: string): string {
  const trimmed = typeof version === 'string' ? version.trim() : '';
  if (!FIRMWARE_VERSION_REGEX.test(trimmed)) {
    throw new InvalidFirmwareInputError(
      'Firmware version must be 1-64 characters starting with alphanumeric and containing only [A-Za-z0-9._+-]',
    );
  }
  return trimmed;
}

function normalizeFirmwareFilename(filename: string | undefined, version: string): string {
  if (filename === undefined) {
    return `firmware-${version}.bin`;
  }
  const clean = basename(filename.trim().replace(/\\/g, '/'));
  if (
    clean.length === 0 ||
    clean.length > MAX_FILENAME_LENGTH ||
    /[\x00-\x1f\x7f"']/.test(clean) ||
    !/\.bin$/i.test(clean)
  ) {
    throw new InvalidFirmwareInputError(
      'Firmware filename must be a safe .bin filename up to 128 characters',
    );
  }
  return clean;
}

function normalizeFirmwareNotes(notes: string | undefined): string | null {
  if (notes === undefined) {
    return null;
  }
  const trimmed = notes.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw new InvalidFirmwareInputError(
      `Firmware notes must not exceed ${MAX_NOTES_LENGTH} characters`,
    );
  }
  return trimmed;
}

/**
 * Resolve the directory used to store uploaded firmware `.bin` files.
 */
export function resolveFirmwareStorageDir(overrideDir?: string): string {
  const explicit = overrideDir?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  const fromEnv = process.env.FIRMWARE_STORAGE_DIR?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return resolve(process.cwd(), 'data', 'firmware');
}

/**
 * Build the LAN HTTP download path for a firmware release version.
 */
export function buildFirmwareDownloadUrl(version: string): string {
  return `/api/firmware/${encodeURIComponent(version)}/download`;
}

/**
 * Resolve and confine a stored relative `.bin` filename inside `storageDir`.
 */
export function resolveStoredBinaryPath(storageDir: string, relativeFilePath: string): string {
  if (
    !relativeFilePath ||
    relativeFilePath.includes('/') ||
    relativeFilePath.includes('\\') ||
    basename(relativeFilePath) !== relativeFilePath
  ) {
    throw new FirmwareIntegrityError(`Unsafe stored firmware path: ${relativeFilePath}`);
  }

  const baseDir = resolve(storageDir);
  const resolvedPath = resolve(baseDir, relativeFilePath);
  const rel = relative(baseDir, resolvedPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new FirmwareIntegrityError(`Firmware path escapes storage directory: ${relativeFilePath}`);
  }

  return resolvedPath;
}

/**
 * Validate, atomically store on disk, and record a new `.bin` firmware release with SHA-256 verification.
 */
export async function uploadFirmwareRelease(
  db: Pool,
  storageDir: string,
  input: UploadFirmwareReleaseInput,
): Promise<FirmwareReleaseRecord> {
  const version = normalizeFirmwareVersion(input.version);

  if (!Buffer.isBuffer(input.binary) || input.binary.byteLength === 0) {
    throw new InvalidFirmwareInputError('Firmware binary payload must not be empty');
  }
  if (input.binary.byteLength > MAX_FIRMWARE_BYTES) {
    throw new InvalidFirmwareInputError(
      `Firmware binary exceeds maximum allowed size of ${MAX_FIRMWARE_BYTES} bytes`,
    );
  }

  const filename = normalizeFirmwareFilename(input.filename, version);
  const notes = normalizeFirmwareNotes(input.notes);
  const sha256 = createHash('sha256').update(input.binary).digest('hex');

  if (input.expectedSha256 !== undefined) {
    const expected = input.expectedSha256.trim();
    if (!SHA256_HEX_REGEX.test(expected)) {
      throw new InvalidFirmwareInputError(
        'Expected sha256 must be a 64-character lowercase hexadecimal digest',
      );
    }
    if (expected !== sha256) {
      throw new InvalidFirmwareInputError(
        `Firmware SHA-256 mismatch: expected ${expected}, computed ${sha256}`,
      );
    }
  }

  const resolvedStorageDir = resolve(storageDir);
  await mkdir(resolvedStorageDir, { recursive: true });

  const diskFilename = `${version.replace(/[^A-Za-z0-9._-]/g, '_')}-${randomUUID().slice(0, 8)}.bin`;
  const targetPath = resolveStoredBinaryPath(resolvedStorageDir, diskFilename);
  const tempPath = join(resolvedStorageDir, `.tmp-${diskFilename}-${randomUUID().slice(0, 8)}`);

  let fileCommitted = false;
  try {
    await writeFile(tempPath, input.binary);
    await rename(tempPath, targetPath);
    fileCommitted = true;

    const result = await db.query<FirmwareReleaseRow>(
      `INSERT INTO firmware_releases (version, filename, file_path, sha256, size_bytes, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${FIRMWARE_RELEASE_COLUMNS}`,
      [version, filename, diskFilename, sha256, input.binary.byteLength, notes],
    );

    const inserted = result.rows[0];
    if (!inserted) {
      throw new Error('Failed to insert firmware release metadata');
    }

    return mapFirmwareReleaseRow(inserted);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    if (fileCommitted) {
      await unlink(targetPath).catch(() => {});
    }

    if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
      throw new DuplicateFirmwareVersionError(version);
    }

    throw err;
  }
}

/**
 * List uploaded firmware releases ordered newest-first.
 */
export async function listFirmwareReleases(db: Pool): Promise<FirmwareReleaseRecord[]> {
  const result = await db.query<FirmwareReleaseRow>(
    `SELECT ${FIRMWARE_RELEASE_COLUMNS}
     FROM firmware_releases
     ORDER BY created_at DESC, id DESC`,
  );

  return result.rows.map(mapFirmwareReleaseRow);
}

/**
 * Fetch metadata for a single firmware release by version string.
 */
export async function getFirmwareReleaseByVersion(
  db: Pool,
  version: string,
): Promise<FirmwareReleaseRecord | null> {
  const trimmed = typeof version === 'string' ? version.trim() : '';
  if (!trimmed) {
    return null;
  }

  const result = await db.query<FirmwareReleaseRow>(
    `SELECT ${FIRMWARE_RELEASE_COLUMNS}
     FROM firmware_releases
     WHERE version = $1`,
    [trimmed],
  );

  const row = result.rows[0];
  return row ? mapFirmwareReleaseRow(row) : null;
}

/**
 * Read a stored firmware `.bin` file and verify its byte length and SHA-256 against PostgreSQL metadata.
 */
export async function readFirmwareBinary(
  db: Pool,
  storageDir: string,
  version: string,
): Promise<{ release: FirmwareReleaseRecord; binary: Buffer } | null> {
  const release = await getFirmwareReleaseByVersion(db, version);
  if (!release) {
    return null;
  }

  const filePath = resolveStoredBinaryPath(storageDir, release.file_path);
  let binary: Buffer;
  try {
    binary = await readFile(filePath);
  } catch (err) {
    throw new FirmwareIntegrityError(
      `Stored binary missing or unreadable for firmware ${release.version}`,
      { cause: err },
    );
  }

  const actualSha256 = createHash('sha256').update(binary).digest('hex');
  if (binary.byteLength !== release.size_bytes || actualSha256 !== release.sha256) {
    throw new FirmwareIntegrityError(
      `Stored binary integrity mismatch for firmware ${release.version}`,
    );
  }

  return { release, binary };
}

/**
 * Compare every registered machine's reported `fw_version` against the latest (or requested) firmware release.
 * Returns `null` when an explicit `targetVersion` does not match any uploaded release.
 */
export async function checkFleetFirmwareUpdates(
  db: Pool,
  targetVersion?: string,
): Promise<FirmwareUpdateCheckResult | null> {
  const [releases, machines] = await Promise.all([
    listFirmwareReleases(db),
    listFleetMachines(db),
  ]);

  const latestRelease = releases[0] ?? null;
  const trimmedTarget = targetVersion?.trim();
  let comparisonRelease: FirmwareReleaseRecord | null = latestRelease;

  if (trimmedTarget) {
    comparisonRelease = releases.find((r) => r.version === trimmedTarget) ?? null;
    if (!comparisonRelease) {
      return null;
    }
  }

  const resolvedTargetVersion = comparisonRelease?.version ?? null;
  let upToDateCount = 0;
  let outdatedCount = 0;
  let unknownVersionCount = 0;

  const checkedMachines: MachineUpdateCheckRecord[] = machines.map((machine) => {
    let updateStatus: FirmwareUpdateStatus;
    let isOutdated = false;

    if (resolvedTargetVersion === null) {
      updateStatus = 'NO_RELEASE';
    } else if (machine.fw_version === null) {
      updateStatus = 'UNKNOWN';
      isOutdated = true;
      unknownVersionCount += 1;
    } else if (machine.fw_version === resolvedTargetVersion) {
      updateStatus = 'UP_TO_DATE';
      upToDateCount += 1;
    } else {
      updateStatus = 'OUTDATED';
      isOutdated = true;
      outdatedCount += 1;
    }

    return {
      machine_id: machine.id,
      display_name: machine.display_name,
      zone: machine.zone,
      floor_position: machine.floor_position,
      hardware_id: machine.hardware_id,
      current_state: machine.current_state,
      fw_version: machine.fw_version,
      preset_version: machine.preset_version,
      preset_name: machine.preset_name,
      target_version: resolvedTargetVersion,
      update_status: updateStatus,
      is_outdated: isOutdated,
    };
  });

  return {
    checked_at: new Date().toISOString(),
    latest_release: latestRelease,
    target_version: resolvedTargetVersion,
    total_machines: checkedMachines.length,
    up_to_date_count: upToDateCount,
    outdated_count: outdatedCount,
    unknown_version_count: unknownVersionCount,
    needs_update_count: outdatedCount + unknownVersionCount,
    machines: checkedMachines,
  };
}

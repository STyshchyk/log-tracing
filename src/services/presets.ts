import type { Pool } from 'pg';
import {
  applyPresetCommandSchema,
  presetConfigSchema,
  serializeMqttJsonPayload,
  type PresetConfig,
} from '../spec/mqtt-contract.js';
import {
  queueOrDispatchCommandForMachines,
  type BatchUpdateDispatchResult,
  type MqttCommandPublisher,
} from './pending-updates.js';

/**
 * Serialized versioned machine preset record stored in PostgreSQL.
 */
export interface PresetRecord {
  id: number;
  name: string;
  version: string;
  config_json: PresetConfig;
  notes: string | null;
  created_at: string;
}

/**
 * Error thrown when a preset create or push request fails input or MQTT-size validation.
 */
export class InvalidPresetInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPresetInputError';
  }
}

/**
 * Error thrown when creating a preset `(name, version)` pair that already exists.
 */
export class DuplicatePresetError extends Error {
  readonly presetName: string;
  readonly version: string;

  constructor(presetName: string, version: string) {
    super(`Preset already exists: ${presetName} (${version})`);
    this.name = 'DuplicatePresetError';
    this.presetName = presetName;
    this.version = version;
  }
}

/**
 * Error thrown when a referenced preset ID or `(name, version)` does not exist.
 */
export class PresetNotFoundError extends Error {
  readonly identifier: string;

  constructor(identifier: string) {
    super(`Preset not found: ${identifier}`);
    this.name = 'PresetNotFoundError';
    this.identifier = identifier;
  }
}

interface PresetRow {
  id: number | string;
  name: string;
  version: string;
  config_json: PresetConfig;
  notes: string | null;
  created_at: Date;
}

const MAX_LABEL_LENGTH = 64;
const MAX_NOTES_LENGTH = 2000;

const PRESET_COLUMNS = `
  id,
  name,
  version,
  config_json,
  notes,
  created_at
`;

function mapPresetRow(row: PresetRow): PresetRecord {
  return {
    id: Number(row.id),
    name: row.name,
    version: row.version,
    config_json: row.config_json,
    notes: row.notes,
    created_at: row.created_at.toISOString(),
  };
}

function normalizeLabel(raw: string, fieldName: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_LABEL_LENGTH ||
    /[\x00-\x1f\x7f]/.test(trimmed)
  ) {
    throw new InvalidPresetInputError(
      `Preset ${fieldName} must be 1-${MAX_LABEL_LENGTH} printable characters`,
    );
  }
  return trimmed;
}

function normalizeNotes(notes: string | undefined): string | null {
  if (notes === undefined) {
    return null;
  }
  const trimmed = notes.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw new InvalidPresetInputError(
      `Preset notes must not exceed ${MAX_NOTES_LENGTH} characters`,
    );
  }
  return trimmed;
}

function validatePresetConfigAndBudget(
  name: string,
  version: string,
  configJson: unknown,
): PresetConfig {
  const parsed = presetConfigSchema.safeParse(configJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new InvalidPresetInputError(issue?.message ?? 'Invalid preset config_json');
  }

  try {
    serializeMqttJsonPayload(
      {
        command: 'APPLY_PRESET',
        version,
        preset_name: name,
        config: parsed.data,
        command_id: 'upd-999999999',
        ts: '2026-11-20T00:00:00.000Z',
      },
      applyPresetCommandSchema,
    );
  } catch (err) {
    throw new InvalidPresetInputError(
      err instanceof Error ? err.message : 'Preset payload exceeds MQTT size limit',
    );
  }

  return parsed.data;
}

/**
 * Validate and store a new versioned JSON preset in `machine_presets`.
 */
export async function createMachinePreset(
  db: Pool,
  input: {
    name: string;
    version: string;
    config_json: unknown;
    notes?: string | undefined;
  },
): Promise<PresetRecord> {
  const name = normalizeLabel(input.name, 'name');
  const version = normalizeLabel(input.version, 'version');
  const notes = normalizeNotes(input.notes);
  const config = validatePresetConfigAndBudget(name, version, input.config_json);

  try {
    const result = await db.query<PresetRow>(
      `INSERT INTO machine_presets (name, version, config_json, notes)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING ${PRESET_COLUMNS}`,
      [name, version, JSON.stringify(config), notes],
    );

    return mapPresetRow(result.rows[0]!);
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
      throw new DuplicatePresetError(name, version);
    }
    throw err;
  }
}

/**
 * List stored versioned presets ordered newest-first, optionally filtered case-insensitively by `name`.
 */
export async function listMachinePresets(
  db: Pool,
  filters: { name?: string | undefined } = {},
): Promise<PresetRecord[]> {
  const trimmedName = filters.name?.trim();
  const result = trimmedName
    ? await db.query<PresetRow>(
        `SELECT ${PRESET_COLUMNS}
         FROM machine_presets
         WHERE LOWER(name) = LOWER($1)
         ORDER BY created_at DESC, id DESC`,
        [trimmedName],
      )
    : await db.query<PresetRow>(
        `SELECT ${PRESET_COLUMNS}
         FROM machine_presets
         ORDER BY created_at DESC, id DESC`,
      );

  return result.rows.map(mapPresetRow);
}

/**
 * Fetch a single stored preset by numeric primary key ID.
 */
export async function getMachinePresetById(
  db: Pool,
  presetId: number,
): Promise<PresetRecord | null> {
  if (!Number.isInteger(presetId) || presetId < 1) {
    return null;
  }

  const result = await db.query<PresetRow>(
    `SELECT ${PRESET_COLUMNS}
     FROM machine_presets
     WHERE id = $1`,
    [presetId],
  );

  const row = result.rows[0];
  return row ? mapPresetRow(row) : null;
}

/**
 * Fetch a single stored preset by `(name, version)` pair.
 */
export async function getMachinePresetByNameVersion(
  db: Pool,
  name: string,
  version: string,
): Promise<PresetRecord | null> {
  const trimmedName = name.trim();
  const trimmedVersion = version.trim();
  if (!trimmedName || !trimmedVersion) {
    return null;
  }

  const result = await db.query<PresetRow>(
    `SELECT ${PRESET_COLUMNS}
     FROM machine_presets
     WHERE name = $1
       AND version = $2`,
    [trimmedName, trimmedVersion],
  );

  const row = result.rows[0];
  return row ? mapPresetRow(row) : null;
}

/**
 * Delete a stored preset by ID and return the deleted record, or null if not found.
 */
export async function deleteMachinePreset(
  db: Pool,
  presetId: number,
): Promise<PresetRecord | null> {
  if (!Number.isInteger(presetId) || presetId < 1) {
    return null;
  }

  const result = await db.query<PresetRow>(
    `DELETE FROM machine_presets
     WHERE id = $1
     RETURNING ${PRESET_COLUMNS}`,
    [presetId],
  );

  const row = result.rows[0];
  return row ? mapPresetRow(row) : null;
}

/**
 * Push a stored preset to one or more machines, dispatching immediately on `IDLE`/`ERROR`
 * or queueing as `PENDING` while `WORKING`/`OFFLINE`.
 */
export async function pushMachinePreset(
  db: Pool,
  mqtt: MqttCommandPublisher,
  input: {
    presetId?: number | undefined;
    name?: string | undefined;
    version?: string | undefined;
    machineId?: string | undefined;
    machineIds?: readonly string[] | undefined;
  },
): Promise<BatchUpdateDispatchResult> {
  let preset: PresetRecord | null = null;

  if (input.presetId !== undefined) {
    if (!Number.isInteger(input.presetId) || input.presetId < 1) {
      throw new InvalidPresetInputError('presetId must be a positive integer');
    }
    preset = await getMachinePresetById(db, input.presetId);
    if (!preset) {
      throw new PresetNotFoundError(String(input.presetId));
    }
  } else if (input.name !== undefined && input.version !== undefined) {
    const trimmedName = input.name.trim();
    const trimmedVersion = input.version.trim();
    if (!trimmedName || !trimmedVersion) {
      throw new InvalidPresetInputError('Both preset name and version must be non-empty');
    }
    preset = await getMachinePresetByNameVersion(db, trimmedName, trimmedVersion);
    if (!preset) {
      throw new PresetNotFoundError(`${trimmedName}@${trimmedVersion}`);
    }
  } else {
    throw new InvalidPresetInputError('Specify presetId or both name and version');
  }

  return queueOrDispatchCommandForMachines(db, mqtt, {
    machineId: input.machineId,
    machineIds: input.machineIds,
    updateType: 'APPLY_PRESET',
    targetVersion: preset.version,
    targetName: preset.name,
    commandPayload: {
      command: 'APPLY_PRESET',
      version: preset.version,
      preset_name: preset.name,
      config: preset.config_json,
    },
  });
}

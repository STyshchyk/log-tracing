import type { Pool } from 'pg';
import type { MachineState } from '../spec/mqtt-contract.js';

/**
 * Valid ESP32 hardware identifier format compatible with MQTT single-level topics.
 */
export const HARDWARE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Error thrown when an operator submits a malformed ESP32 hardware identifier.
 */
export class InvalidHardwareIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidHardwareIdError';
  }
}

/**
 * Error thrown when an ESP32 hardware ID is already assigned to another floor position without `force`.
 */
export class HardwareAlreadyAssignedError extends Error {
  constructor(
    readonly hardwareId: string,
    readonly existingMachineId: string,
  ) {
    super(`Hardware ID "${hardwareId}" is already assigned to position ${existingMachineId}.`);
    this.name = 'HardwareAlreadyAssignedError';
  }
}

/**
 * Registered machine record and live telemetry status returned by machine lookup queries.
 */
export interface MachineRecord {
  id: string;
  display_name: string;
  zone: string;
  grid_row: number;
  grid_col: number;
  floor_position: number | null;
  hardware_id: string | null;
  current_state: MachineState;
  active_error: string | null;
  fw_version: string | null;
  preset_version: string | null;
  preset_name: string | null;
  last_seen_at: string | null;
}

/**
 * Database row shape returned by queries on the `machines` table.
 */
export interface MachineRow {
  id: string;
  display_name: string;
  zone: string;
  grid_row: number;
  grid_col: number;
  floor_position: number | null;
  hardware_id: string | null;
  current_state: MachineState;
  active_error: string | null;
  fw_version: string | null;
  preset_version: string | null;
  preset_name: string | null;
  last_seen_at: Date | null;
}

/**
 * Outcome returned after assigning or unassigning a physical machine's ESP32 hardware ID.
 */
export interface HardwareAssignmentResult {
  machine: MachineRecord;
  previous_hardware_id: string | null;
  unassigned_from_machine_id: string | null;
}

/**
 * Canonical column list for `machines` queries.
 */
export const MACHINE_COLUMNS = `
  id,
  display_name,
  zone,
  grid_row,
  grid_col,
  floor_position,
  hardware_id,
  current_state,
  active_error,
  fw_version,
  preset_version,
  preset_name,
  last_seen_at
`;

/**
 * Map a raw PostgreSQL `machines` row into a JSON-serializable `MachineRecord`.
 */
export function mapMachineRow(row: MachineRow): MachineRecord {
  return {
    id: row.id,
    display_name: row.display_name,
    zone: row.zone,
    grid_row: row.grid_row,
    grid_col: row.grid_col,
    floor_position: row.floor_position,
    hardware_id: row.hardware_id,
    current_state: row.current_state,
    active_error: row.active_error,
    fw_version: row.fw_version,
    preset_version: row.preset_version,
    preset_name: row.preset_name,
    last_seen_at: row.last_seen_at ? row.last_seen_at.toISOString() : null,
  };
}

/**
 * Fetch all registered machines ordered deterministically by floor position then ID.
 */
export async function listMachines(db: Pool): Promise<MachineRecord[]> {
  const result = await db.query<MachineRow>(
    `SELECT ${MACHINE_COLUMNS}
     FROM machines
     ORDER BY floor_position ASC NULLS LAST, id ASC`,
  );

  return result.rows.map(mapMachineRow);
}

/**
 * Trim a machine ID and return `null` when it is missing or whitespace-only.
 */
export function normalizeMachineId(machineId: string | null | undefined): string | null {
  if (typeof machineId !== 'string') {
    return null;
  }
  const trimmed = machineId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Fetch a single registered machine by ID, or return null if no matching row exists.
 */
export async function getMachineById(db: Pool, machineId: string): Promise<MachineRecord | null> {
  const trimmedId = normalizeMachineId(machineId);
  if (!trimmedId) {
    return null;
  }

  const result = await db.query<MachineRow>(
    `SELECT ${MACHINE_COLUMNS}
     FROM machines
     WHERE id = $1`,
    [trimmedId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return mapMachineRow(row);
}

/**
 * Validate and normalize an ESP32 hardware identifier, allowing `null` to clear assignment.
 */
function normalizeHardwareIdInput(hardwareId: string | null): string | null {
  if (hardwareId === null) {
    return null;
  }
  const trimmed = hardwareId.trim();
  if (!HARDWARE_ID_REGEX.test(trimmed)) {
    throw new InvalidHardwareIdError(
      'Hardware ID must be 1–64 characters matching /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.',
    );
  }
  return trimmed;
}

/**
 * Bind (or clear) the physical ESP32 hardware ID assigned to a floor machine position.
 * Preserves all historical telemetry, coil outcomes, bug reports, and pending commands on `machineId`.
 */
export async function assignMachineHardware(
  db: Pool,
  options: {
    machineId: string;
    hardwareId: string | null;
    force?: boolean;
  },
): Promise<HardwareAssignmentResult | null> {
  const targetId = normalizeMachineId(options.machineId);
  if (!targetId) {
    return null;
  }

  const normalizedHardwareId = normalizeHardwareIdInput(options.hardwareId);
  const force = options.force === true;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const targetRes = await client.query<MachineRow>(
      `SELECT ${MACHINE_COLUMNS}
       FROM machines
       WHERE id = $1
       FOR UPDATE`,
      [targetId],
    );
    const targetRow = targetRes.rows[0];
    if (!targetRow) {
      await client.query('ROLLBACK');
      return null;
    }

    const previousHardwareId = targetRow.hardware_id;
    let unassignedFromMachineId: string | null = null;

    if (normalizedHardwareId !== null) {
      const conflictRes = await client.query<{ id: string }>(
        `SELECT id
         FROM machines
         WHERE hardware_id = $1
           AND id <> $2
         FOR UPDATE`,
        [normalizedHardwareId, targetId],
      );
      const conflictRow = conflictRes.rows[0];
      if (conflictRow) {
        if (!force) {
          throw new HardwareAlreadyAssignedError(normalizedHardwareId, conflictRow.id);
        }

        await client.query(
          `UPDATE machines
           SET hardware_id = NULL
           WHERE id = $1`,
          [conflictRow.id],
        );
        await client.query(
          `INSERT INTO telemetry_events (time, machine_id, event_type, error_code, payload_json)
           VALUES (NOW(), $1, 'INFO', NULL, $2::jsonb)`,
          [
            conflictRow.id,
            JSON.stringify({
              subsystem: 'hardware_registry',
              event: 'HARDWARE_UNASSIGNED',
              hardware_id: normalizedHardwareId,
              reassigned_to: targetId,
            }),
          ],
        );
        unassignedFromMachineId = conflictRow.id;
      }
    }

    const updatedRes = await client.query<MachineRow>(
      `UPDATE machines
       SET hardware_id = $2
       WHERE id = $1
       RETURNING ${MACHINE_COLUMNS}`,
      [targetId, normalizedHardwareId],
    );
    const updatedRow = updatedRes.rows[0];
    if (!updatedRow) {
      throw new Error(`Failed to update hardware assignment for machine ${targetId}`);
    }

    if (previousHardwareId !== normalizedHardwareId) {
      await client.query(
        `INSERT INTO telemetry_events (time, machine_id, event_type, error_code, payload_json)
         VALUES (NOW(), $1, 'INFO', NULL, $2::jsonb)`,
        [
          targetId,
          JSON.stringify({
            subsystem: 'hardware_registry',
            event: normalizedHardwareId ? 'HARDWARE_ASSIGNED' : 'HARDWARE_UNASSIGNED',
            previous_hardware_id: previousHardwareId,
            hardware_id: normalizedHardwareId,
            unassigned_from_machine_id: unassignedFromMachineId,
          }),
        ],
      );
    }

    await client.query('COMMIT');
    return {
      machine: mapMachineRow(updatedRow),
      previous_hardware_id: previousHardwareId,
      unassigned_from_machine_id: unassignedFromMachineId,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors so the original domain/database error surfaces cleanly.
    }
    throw err;
  } finally {
    client.release();
  }
}

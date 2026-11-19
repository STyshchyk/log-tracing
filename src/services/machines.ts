import type { Pool } from 'pg';
import type { FloorZone, MachineState } from '../spec/mqtt-contract.js';

/**
 * Registered machine record and live telemetry status returned by machine lookup queries.
 */
export interface MachineRecord {
  id: string;
  display_name: string;
  zone: FloorZone;
  grid_row: number;
  grid_col: number;
  current_state: MachineState;
  active_error: string | null;
  last_seen_at: string | null;
}

interface MachineRow {
  id: string;
  display_name: string;
  zone: FloorZone;
  grid_row: number;
  grid_col: number;
  current_state: MachineState;
  active_error: string | null;
  last_seen_at: Date | null;
}

function mapMachineRow(row: MachineRow): MachineRecord {
  return {
    id: row.id,
    display_name: row.display_name,
    zone: row.zone,
    grid_row: row.grid_row,
    grid_col: row.grid_col,
    current_state: row.current_state,
    active_error: row.active_error,
    last_seen_at: row.last_seen_at ? row.last_seen_at.toISOString() : null,
  };
}

/**
 * Fetch all registered machines ordered deterministically by ID for the Worker Portal directory.
 */
export async function listMachines(db: Pool): Promise<MachineRecord[]> {
  const result = await db.query<MachineRow>(
    `SELECT
       id,
       display_name,
       zone,
       grid_row,
       grid_col,
       current_state,
       active_error,
       last_seen_at
     FROM machines
     ORDER BY id ASC`,
  );

  return result.rows.map(mapMachineRow);
}

/**
 * Fetch a single registered machine by ID, or return null if no matching row exists.
 */
export async function getMachineById(db: Pool, machineId: string): Promise<MachineRecord | null> {
  const trimmedId = machineId.trim();
  if (!trimmedId) {
    return null;
  }

  const result = await db.query<MachineRow>(
    `SELECT
       id,
       display_name,
       zone,
       grid_row,
       grid_col,
       current_state,
       active_error,
       last_seen_at
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

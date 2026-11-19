import type { Pool } from 'pg';
import { normalizeMachineId } from './machines.js';

/**
 * Canonical rollup aggregation windows matching `coil_rollup_machine` and `coil_rollup_room`.
 */
export const COIL_ROLLUP_WINDOWS = ['TODAY', 'WEEK', 'MONTH', 'ALL_TIME'] as const;

/**
 * Rollup time window identifier.
 */
export type CoilRollupWindow = (typeof COIL_ROLLUP_WINDOWS)[number];

/**
 * Aggregated coil outcome counts for a single time window.
 */
export interface CoilRollupCounts {
  window: CoilRollupWindow;
  completed_count: number;
  aborted_count: number;
  total_count: number;
}

/**
 * Per-machine coil rollup payload across all canonical windows.
 */
export interface MachineCoilRollupsResult {
  machine_id: string;
  rollups: CoilRollupCounts[];
}

/**
 * Room-wide coil rollup payload across all canonical windows.
 */
export interface RoomCoilRollupsResult {
  rollups: CoilRollupCounts[];
}

interface RollupViewRow {
  time_window: CoilRollupWindow;
  completed_count: number | string;
  aborted_count: number | string;
  total_count: number | string;
}

const WINDOW_ORDER_SQL = `CASE time_window
  WHEN 'TODAY' THEN 1
  WHEN 'WEEK' THEN 2
  WHEN 'MONTH' THEN 3
  WHEN 'ALL_TIME' THEN 4
  ELSE 5
END ASC`;

function mapRollupRows(rows: RollupViewRow[]): CoilRollupCounts[] {
  return rows.map((row) => ({
    window: row.time_window,
    completed_count: Number(row.completed_count),
    aborted_count: Number(row.aborted_count),
    total_count: Number(row.total_count),
  }));
}

/**
 * Fetch coil outcome rollups across TODAY, WEEK, MONTH, and ALL_TIME for a registered machine.
 * Returns `null` when the machine ID is empty or does not exist in `machines`.
 */
export async function getMachineCoilRollups(
  db: Pool,
  machineId: string,
): Promise<MachineCoilRollupsResult | null> {
  const trimmedId = normalizeMachineId(machineId);
  if (!trimmedId) {
    return null;
  }

  const result = await db.query<RollupViewRow>(
    `SELECT time_window, completed_count, aborted_count, total_count
     FROM coil_rollup_machine
     WHERE machine_id = $1
     ORDER BY ${WINDOW_ORDER_SQL}`,
    [trimmedId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    machine_id: trimmedId,
    rollups: mapRollupRows(result.rows),
  };
}

/**
 * Fetch room-wide coil outcome rollups across TODAY, WEEK, MONTH, and ALL_TIME.
 */
export async function getRoomCoilRollups(db: Pool): Promise<RoomCoilRollupsResult> {
  const result = await db.query<RollupViewRow>(
    `SELECT time_window, completed_count, aborted_count, total_count
     FROM coil_rollup_room
     ORDER BY ${WINDOW_ORDER_SQL}`,
  );

  return {
    rollups: mapRollupRows(result.rows),
  };
}

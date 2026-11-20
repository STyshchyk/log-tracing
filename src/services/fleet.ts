import type { Pool } from 'pg';
import type {
  FloorZone,
  MachineState,
} from '../spec/mqtt-contract.js';
import { listBugReports, type BugReportRecord } from './bug-reports.js';
import { getMachineCoilRollups, getRoomCoilRollups, type CoilRollupCounts } from './coil-rollups.js';
import {
  FLEET_HISTORY_KINDS,
  listFleetHistory,
  type FleetHistoryBugReportItem,
  type FleetHistoryErrorEventItem,
  type FleetHistoryItem,
  type FleetHistoryKind,
  type ListFleetHistoryOptions,
} from './fleet-history.js';
import type { GlossaryEntry } from './glossary.js';
import {
  MACHINE_COLUMNS,
  getMachineById,
  mapMachineRow,
  type MachineRecord,
  type MachineRow,
} from './machines.js';
import {
  listRecentErrorSummaries,
  type RecentErrorSummary,
} from './telemetry-events.js';

export {
  FLEET_HISTORY_KINDS,
  listFleetHistory,
  type FleetHistoryBugReportItem,
  type FleetHistoryErrorEventItem,
  type FleetHistoryItem,
  type FleetHistoryKind,
  type ListFleetHistoryOptions,
};

/**
 * Room-wide count of registered winding machines grouped by operational state.
 */
export interface FleetMachineCounts {
  total: number;
  WORKING: number;
  IDLE: number;
  ERROR: number;
  OFFLINE: number;
}

/**
 * Aggregate Fleet summary returned to the Department Heads PWA and `/api/fleet/summary`.
 */
export interface FleetSummaryResult {
  generated_at: string;
  machine_counts: FleetMachineCounts;
  open_bug_reports: number;
  coil_rollups: CoilRollupCounts[];
}

/**
 * Optional query filters when listing winding machines across the floor.
 */
export interface ListFleetMachinesFilters {
  state?: MachineState | undefined;
  zone?: FloorZone | undefined;
}

/**
 * Complete drill-down payload for a single machine inside the Fleet PWA drawer.
 */
export interface FleetMachineDetailsResult {
  machine: MachineRecord;
  active_glossary: GlossaryEntry | null;
  recent_errors: RecentErrorSummary[];
  recent_bug_reports: BugReportRecord[];
  coil_rollups: CoilRollupCounts[];
  worker_portal_url: string;
}

interface MachineStateCountRow {
  current_state: MachineState;
  count: number | string;
}

interface CountRow {
  count: number | string;
}

interface ActiveGlossaryRow {
  error_code: string;
  title: string;
  symptoms: string;
  fix_steps_md: string;
  updated_at: Date;
}

const DETAILS_LIST_LIMIT = 5;

const ZONE_ORDER_SQL = `CASE zone
  WHEN 'NORTH_LEFT' THEN 1
  WHEN 'NORTH_RIGHT' THEN 2
  WHEN 'MAIN_BANK' THEN 3
  WHEN 'EAST_DOOR' THEN 4
  ELSE 5
END ASC`;

/**
 * Aggregate room-wide machine state counts, open bug report totals, and coil rollups.
 */
export async function getFleetSummary(db: Pool): Promise<FleetSummaryResult> {
  const [stateCountsResult, openBugReportsResult, coilRollupsResult] = await Promise.all([
    db.query<MachineStateCountRow>(
      `SELECT current_state, COUNT(*)::integer AS count
       FROM machines
       GROUP BY current_state`,
    ),
    db.query<CountRow>(
      `SELECT COUNT(*)::integer AS count
       FROM bug_reports
       WHERE status = 'OPEN'`,
    ),
    getRoomCoilRollups(db),
  ]);

  const machineCounts: FleetMachineCounts = {
    total: 0,
    WORKING: 0,
    IDLE: 0,
    ERROR: 0,
    OFFLINE: 0,
  };

  for (const row of stateCountsResult.rows) {
    const count = Number(row.count);
    if (row.current_state in machineCounts) {
      machineCounts[row.current_state] = count;
      machineCounts.total += count;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    machine_counts: machineCounts,
    open_bug_reports: Number(openBugReportsResult.rows[0]?.count ?? 0),
    coil_rollups: coilRollupsResult.rollups,
  };
}

/**
 * List winding machines ordered deterministically by floor zone and grid coordinates,
 * with optional state and floor-zone filters.
 */
export async function listFleetMachines(
  db: Pool,
  filters: ListFleetMachinesFilters = {},
): Promise<MachineRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.state) {
    params.push(filters.state);
    conditions.push(`current_state = $${params.length}`);
  }
  if (filters.zone) {
    params.push(filters.zone);
    conditions.push(`zone = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.query<MachineRow>(
    `SELECT ${MACHINE_COLUMNS}
     FROM machines
     ${whereClause}
     ORDER BY ${ZONE_ORDER_SQL}, grid_row ASC, grid_col ASC, id ASC`,
    params,
  );

  return result.rows.map(mapMachineRow);
}

/**
 * Fetch drill-down diagnostics, active glossary guidance, recent bug reports, and coil rollups
 * for a single registered machine. Returns null when the machine ID does not exist.
 */
export async function getFleetMachineDetails(
  db: Pool,
  machineId: string,
): Promise<FleetMachineDetailsResult | null> {
  const machine = await getMachineById(db, machineId);
  if (machine === null) {
    return null;
  }

  const activeGlossaryPromise: Promise<GlossaryEntry | null> = machine.active_error
    ? db
        .query<ActiveGlossaryRow>(
          `SELECT error_code, title, symptoms, fix_steps_md, updated_at
           FROM error_glossary
           WHERE error_code = $1`,
          [machine.active_error],
        )
        .then((res) => {
          const row = res.rows[0];
          if (!row) {
            return null;
          }
          return {
            error_code: row.error_code,
            title: row.title,
            symptoms: row.symptoms,
            fix_steps_md: row.fix_steps_md,
            updated_at: row.updated_at.toISOString(),
            is_active: true,
          };
        })
    : Promise.resolve(null);

  const [activeGlossary, recentErrors, rollupsResult, bugReports] = await Promise.all([
    activeGlossaryPromise,
    listRecentErrorSummaries(db, machine.id, DETAILS_LIST_LIMIT),
    getMachineCoilRollups(db, machine.id),
    listBugReports(db, machine.id),
  ]);

  return {
    machine,
    active_glossary: activeGlossary,
    recent_errors: recentErrors,
    recent_bug_reports: (bugReports ?? []).slice(0, DETAILS_LIST_LIMIT),
    coil_rollups: rollupsResult?.rollups ?? [],
    worker_portal_url: `/m/${encodeURIComponent(machine.id)}`,
  };
}

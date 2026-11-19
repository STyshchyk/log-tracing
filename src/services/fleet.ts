import type { Pool } from 'pg';
import {
  ERROR_EVENT_TYPES,
  type BugReportTag,
  type FloorZone,
  type MachineState,
} from '../spec/mqtt-contract.js';
import { listBugReports, type BugReportRecord } from './bug-reports.js';
import { getMachineCoilRollups, getRoomCoilRollups, type CoilRollupCounts } from './coil-rollups.js';
import type { GlossaryEntry } from './glossary.js';
import {
  MACHINE_COLUMNS,
  getMachineById,
  mapMachineRow,
  normalizeMachineId,
  type MachineRecord,
  type MachineRow,
} from './machines.js';
import {
  deriveErrorSummary,
  listRecentErrorSummaries,
  type RecentErrorSummary,
  type TelemetryEventMetadata,
} from './telemetry-events.js';

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

/**
 * Allowed record kinds when filtering the room-wide Fleet history timeline.
 */
export const FLEET_HISTORY_KINDS = ['all', 'errors', 'bug_reports'] as const;

/**
 * Room-wide Fleet history filter kind union.
 */
export type FleetHistoryKind = (typeof FLEET_HISTORY_KINDS)[number];

/**
 * Optional filters for the room-wide Fleet history timeline.
 */
export interface ListFleetHistoryOptions {
  limit?: number | undefined;
  machineId?: string | undefined;
  zone?: FloorZone | undefined;
  kind?: FleetHistoryKind | undefined;
}

/**
 * Error telemetry item in the merged room-wide Fleet history feed.
 */
export interface FleetHistoryErrorEventItem {
  kind: 'error_event';
  time: string;
  machine_id: string;
  machine_display_name: string;
  zone: FloorZone;
  event_type: string;
  error_code: string | null;
  glossary_title: string | null;
  summary: string;
}

/**
 * Worker bug-report item in the merged room-wide Fleet history feed.
 */
export interface FleetHistoryBugReportItem {
  kind: 'bug_report';
  time: string;
  machine_id: string;
  machine_display_name: string;
  zone: FloorZone;
  bug_report_id: number;
  tag: BugReportTag;
  error_code: string | null;
  worker_note: string | null;
  status: string;
}

/**
 * Discriminated union item in the room-wide Fleet history feed.
 */
export type FleetHistoryItem = FleetHistoryErrorEventItem | FleetHistoryBugReportItem;

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

interface FleetHistoryEventRow {
  time: Date;
  machine_id: string;
  machine_display_name: string;
  zone: FloorZone;
  event_type: string;
  error_code: string | null;
  glossary_title: string | null;
  payload_json: TelemetryEventMetadata;
}

interface FleetHistoryBugReportRow {
  id: string | number;
  created_at: Date;
  machine_id: string;
  machine_display_name: string;
  zone: FloorZone;
  tag: BugReportTag;
  error_code: string | null;
  worker_note: string | null;
  status: string;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;
const DETAILS_LIST_LIMIT = 5;

const ZONE_ORDER_SQL = `CASE zone
  WHEN 'NORTH_LEFT' THEN 1
  WHEN 'NORTH_RIGHT' THEN 2
  WHEN 'MAIN_BANK' THEN 3
  WHEN 'EAST_DOOR' THEN 4
  ELSE 5
END ASC`;

function clampHistoryLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_HISTORY_LIMIT;
  }
  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.trunc(limit)));
}

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

/**
 * List merged room-wide fault telemetry events and operator bug reports newest-first.
 */
export async function listFleetHistory(
  db: Pool,
  options: ListFleetHistoryOptions = {},
): Promise<FleetHistoryItem[]> {
  const limit = clampHistoryLimit(options.limit);
  const kind: FleetHistoryKind = options.kind ?? 'all';
  const machineId = normalizeMachineId(options.machineId);
  const zone = options.zone;

  const fetchErrors = kind !== 'bug_reports';
  const fetchBugReports = kind !== 'errors';

  const errorEventsPromise: Promise<FleetHistoryErrorEventItem[]> = fetchErrors
    ? (() => {
        const params: unknown[] = [[...ERROR_EVENT_TYPES]];
        const conditions: string[] = [
          '(te.error_code IS NOT NULL OR te.event_type = ANY($1::text[]))',
        ];
        if (machineId) {
          params.push(machineId);
          conditions.push(`te.machine_id = $${params.length}`);
        }
        if (zone) {
          params.push(zone);
          conditions.push(`m.zone = $${params.length}`);
        }
        params.push(limit);

        return db
          .query<FleetHistoryEventRow>(
            `SELECT
               te.time,
               te.machine_id,
               m.display_name AS machine_display_name,
               m.zone,
               te.event_type,
               te.error_code,
               eg.title AS glossary_title,
               te.payload_json
             FROM telemetry_events te
             INNER JOIN machines m ON m.id = te.machine_id
             LEFT JOIN error_glossary eg ON eg.error_code = te.error_code
             WHERE ${conditions.join(' AND ')}
             ORDER BY te.time DESC
             LIMIT $${params.length}`,
            params,
          )
          .then((res) =>
            res.rows.map((row) => ({
              kind: 'error_event' as const,
              time: row.time.toISOString(),
              machine_id: row.machine_id,
              machine_display_name: row.machine_display_name,
              zone: row.zone,
              event_type: row.event_type,
              error_code: row.error_code,
              glossary_title: row.glossary_title,
              summary: deriveErrorSummary(row.event_type, row.payload_json),
            })),
          );
      })()
    : Promise.resolve([]);

  const bugReportsPromise: Promise<FleetHistoryBugReportItem[]> = fetchBugReports
    ? (() => {
        const params: unknown[] = [];
        const conditions: string[] = [];
        if (machineId) {
          params.push(machineId);
          conditions.push(`br.machine_id = $${params.length}`);
        }
        if (zone) {
          params.push(zone);
          conditions.push(`m.zone = $${params.length}`);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(limit);

        return db
          .query<FleetHistoryBugReportRow>(
            `SELECT
               br.id,
               br.created_at,
               br.machine_id,
               m.display_name AS machine_display_name,
               m.zone,
               br.tag,
               br.error_code,
               br.worker_note,
               br.status
             FROM bug_reports br
             INNER JOIN machines m ON m.id = br.machine_id
             ${whereClause}
             ORDER BY br.created_at DESC, br.id DESC
             LIMIT $${params.length}`,
            params,
          )
          .then((res) =>
            res.rows.map((row) => ({
              kind: 'bug_report' as const,
              time: row.created_at.toISOString(),
              machine_id: row.machine_id,
              machine_display_name: row.machine_display_name,
              zone: row.zone,
              bug_report_id: Number(row.id),
              tag: row.tag,
              error_code: row.error_code,
              worker_note: row.worker_note,
              status: row.status,
            })),
          );
      })()
    : Promise.resolve([]);

  const [errorItems, bugReportItems] = await Promise.all([
    errorEventsPromise,
    bugReportsPromise,
  ]);

  return [...errorItems, ...bugReportItems]
    .sort((a, b) => {
      const timeDiff = Date.parse(b.time) - Date.parse(a.time);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      if (a.kind !== b.kind) {
        return a.kind === 'bug_report' ? -1 : 1;
      }
      if (a.kind === 'bug_report' && b.kind === 'bug_report') {
        return b.bug_report_id - a.bug_report_id;
      }
      return a.machine_id < b.machine_id ? -1 : a.machine_id > b.machine_id ? 1 : 0;
    })
    .slice(0, limit);
}

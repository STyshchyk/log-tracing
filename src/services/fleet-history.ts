import type { Pool } from 'pg';
import {
  ERROR_EVENT_TYPES,
  type BugReportTag,
  type FloorZone,
} from '../spec/mqtt-contract.js';
import { normalizeMachineId } from './machines.js';
import {
  deriveErrorSummary,
  type TelemetryEventMetadata,
} from './telemetry-events.js';

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

function clampHistoryLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_HISTORY_LIMIT;
  }
  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.trunc(limit)));
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

import type { Pool } from 'pg';
import { ERROR_EVENT_TYPES, type EventType } from '../spec/mqtt-contract.js';
import { normalizeMachineId } from './machines.js';

/**
 * Structured diagnostic metadata persisted alongside a telemetry event.
 */
export interface TelemetryEventMetadata {
  reset_reason?: string;
  rssi?: number;
  free_heap?: number;
  subsystem?: string;
  message?: string;
  details?: Record<string, string | number | boolean | null>;
  ts?: string | number;
}

/**
 * Serialized telemetry event record returned by telemetry query services and APIs.
 */
export interface TelemetryEventRecord {
  time: string;
  machine_id: string;
  event_type: EventType | string;
  error_code: string | null;
  payload_json: TelemetryEventMetadata;
}

/**
 * Query options for retrieving recent diagnostic events for a registered machine.
 */
export interface ListRecentEventsOptions {
  machineId: string;
  limit?: number | undefined;
  errorsOnly?: boolean | undefined;
}

/**
 * Concise error event summary joined with glossary metadata for the Worker Portal feed.
 */
export interface RecentErrorSummary {
  time: string;
  event_type: EventType | string;
  error_code: string | null;
  glossary_title: string | null;
  summary: string;
}

interface TelemetryEventRow {
  time: Date;
  machine_id: string;
  event_type: string;
  error_code: string | null;
  payload_json: TelemetryEventMetadata;
}

interface RecentErrorSummaryRow {
  time: Date;
  event_type: string;
  error_code: string | null;
  glossary_title: string | null;
  payload_json: TelemetryEventMetadata;
}

const DEFAULT_EVENTS_LIMIT = 20;
const DEFAULT_RECENT_ERRORS_LIMIT = 5;
const MAX_EVENTS_LIMIT = 100;

function normalizeLimit(limit?: number, defaultLimit = DEFAULT_EVENTS_LIMIT): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return defaultLimit;
  }
  return Math.min(MAX_EVENTS_LIMIT, Math.max(1, Math.trunc(limit)));
}

function formatEventTypeLabel(eventType: string): string {
  const words = eventType.trim().toLowerCase().replaceAll('_', ' ');
  if (!words) {
    return 'Error';
  }
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * Derive a concise operator-facing error summary string from a telemetry event type and payload.
 */
export function deriveErrorSummary(
  eventType: string,
  payload: TelemetryEventMetadata | null | undefined,
): string {
  const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
  if (message.length > 0) {
    return message;
  }

  const resetReason =
    typeof payload?.reset_reason === 'string' ? payload.reset_reason.trim() : '';
  if (resetReason.length > 0) {
    return `Reset reason: ${resetReason}`;
  }

  const subsystem = typeof payload?.subsystem === 'string' ? payload.subsystem.trim() : '';
  if (subsystem.length > 0) {
    return `Subsystem: ${subsystem}`;
  }

  return formatEventTypeLabel(eventType);
}

/**
 * List recent telemetry events for a registered machine ordered newest-first.
 * Returns null when the machine ID is not registered.
 */
export async function listRecentEvents(
  db: Pool,
  options: ListRecentEventsOptions,
): Promise<TelemetryEventRecord[] | null> {
  const machineId = normalizeMachineId(options.machineId);
  if (!machineId) {
    return null;
  }

  const machineResult = await db.query<{ id: string }>(
    'SELECT id FROM machines WHERE id = $1',
    [machineId],
  );
  if (!machineResult.rows[0]) {
    return null;
  }

  const limit = normalizeLimit(options.limit);
  const params: unknown[] = [machineId, limit];
  let errorFilterClause = '';

  if (options.errorsOnly) {
    params.push([...ERROR_EVENT_TYPES]);
    errorFilterClause = 'AND (error_code IS NOT NULL OR event_type = ANY($3::text[]))';
  }

  const result = await db.query<TelemetryEventRow>(
    `SELECT time, machine_id, event_type, error_code, payload_json
     FROM telemetry_events
     WHERE machine_id = $1
       ${errorFilterClause}
     ORDER BY time DESC
     LIMIT $2`,
    params,
  );

  return result.rows.map((row) => ({
    time: row.time.toISOString(),
    machine_id: row.machine_id,
    event_type: row.event_type,
    error_code: row.error_code,
    payload_json: row.payload_json,
  }));
}

/**
 * List up to `limit` newest error/fault summaries for a machine joined with glossary titles.
 */
export async function listRecentErrorSummaries(
  db: Pool,
  machineId: string,
  limit = DEFAULT_RECENT_ERRORS_LIMIT,
): Promise<RecentErrorSummary[]> {
  const trimmedId = normalizeMachineId(machineId);
  if (!trimmedId) {
    return [];
  }

  const normalizedLimit = normalizeLimit(limit, DEFAULT_RECENT_ERRORS_LIMIT);
  const result = await db.query<RecentErrorSummaryRow>(
    `SELECT
       te.time,
       te.event_type,
       te.error_code,
       eg.title AS glossary_title,
       te.payload_json
     FROM telemetry_events te
     LEFT JOIN error_glossary eg
       ON eg.error_code = te.error_code
     WHERE te.machine_id = $1
       AND (te.error_code IS NOT NULL OR te.event_type = ANY($2::text[]))
     ORDER BY te.time DESC
     LIMIT $3`,
    [trimmedId, [...ERROR_EVENT_TYPES], normalizedLimit],
  );

  return result.rows.map((row) => ({
    time: row.time.toISOString(),
    event_type: row.event_type,
    error_code: row.error_code,
    glossary_title: row.glossary_title,
    summary: deriveErrorSummary(row.event_type, row.payload_json),
  }));
}

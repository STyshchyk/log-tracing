import type { Pool } from 'pg';
import { ERROR_EVENT_TYPES, type EventType } from '../spec/mqtt-contract.js';

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

interface TelemetryEventRow {
  time: Date;
  machine_id: string;
  event_type: string;
  error_code: string | null;
  payload_json: TelemetryEventMetadata;
}

const DEFAULT_EVENTS_LIMIT = 20;
const MAX_EVENTS_LIMIT = 100;

function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_EVENTS_LIMIT;
  }
  return Math.min(MAX_EVENTS_LIMIT, Math.max(1, Math.trunc(limit)));
}

/**
 * List recent telemetry events for a registered machine ordered newest-first.
 * Returns null when the machine ID is not registered.
 */
export async function listRecentEvents(
  db: Pool,
  options: ListRecentEventsOptions,
): Promise<TelemetryEventRecord[] | null> {
  const machineId = options.machineId.trim();
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

import type { Pool } from 'pg';
import { z } from 'zod';
import { BUG_REPORT_TAGS, type BugReportTag } from '../spec/mqtt-contract.js';
import { normalizeMachineId } from './machines.js';
import type { TelemetryEventMetadata, TelemetryEventRecord } from './telemetry-events.js';

export { BUG_REPORT_TAGS, type BugReportTag };

/**
 * Zod schema validating an operator quick tag against the canonical allowed list.
 */
export const bugReportTagSchema = z.enum(BUG_REPORT_TAGS);

/**
 * Strict Zod schema validating HTTP bug-report creation payloads without type coercion or key stripping.
 */
export const createBugReportBodySchema = z.strictObject({
  tag: bugReportTagSchema,
  worker_note: z.string().nullish(),
});

/**
 * Error thrown when bug-report input fails contract validation (maps to HTTP 400).
 */
export class BugReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BugReportValidationError';
  }
}

/**
 * Return true when the given value is one of the allowed bug report quick tags.
 */
export function isValidBugReportTag(tag: unknown): tag is BugReportTag {
  return bugReportTagSchema.safeParse(tag).success;
}

/**
 * Input parameters for creating a bug report with an automatic 20-event telemetry snapshot.
 */
export interface CreateBugReportInput {
  machineId: string;
  tag: string;
  workerNote?: string | null | undefined;
}

/**
 * Persisted bug report record returned by bug-report services and HTTP APIs.
 */
export interface BugReportRecord {
  id: number;
  machine_id: string;
  error_code: string | null;
  tag: BugReportTag;
  worker_note: string | null;
  photo_path: string | null;
  attached_logs_json: TelemetryEventRecord[];
  status: string;
  created_at: string;
}

interface TelemetryEventSnapshotRow {
  time: Date;
  machine_id: string;
  event_type: string;
  error_code: string | null;
  payload_json: TelemetryEventMetadata;
}

interface BugReportRow {
  id: string | number;
  machine_id: string;
  error_code: string | null;
  tag: BugReportTag;
  worker_note: string | null;
  photo_path: string | null;
  attached_logs_json: TelemetryEventRecord[];
  status: string;
  created_at: Date;
}

const SNAPSHOT_EVENT_LIMIT = 20;

const BUG_REPORT_COLUMNS = `
  id,
  machine_id,
  error_code,
  tag,
  worker_note,
  photo_path,
  attached_logs_json,
  status,
  created_at
`;

function validateTag(tag: unknown): BugReportTag {
  const parsed = bugReportTagSchema.safeParse(tag);
  if (!parsed.success) {
    throw new BugReportValidationError(
      `Invalid bug report tag. Expected one of: ${BUG_REPORT_TAGS.join(', ')}`,
    );
  }
  return parsed.data;
}

function normalizeWorkerNote(workerNote: unknown): string | null {
  if (workerNote === undefined || workerNote === null) {
    return null;
  }
  if (typeof workerNote !== 'string') {
    throw new BugReportValidationError('worker_note must be a string or null');
  }
  const trimmed = workerNote.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapBugReportRow(row: BugReportRow): BugReportRecord {
  return {
    id: Number(row.id),
    machine_id: row.machine_id,
    error_code: row.error_code,
    tag: row.tag,
    worker_note: row.worker_note,
    photo_path: row.photo_path,
    attached_logs_json: row.attached_logs_json,
    status: row.status,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Atomically create a bug report for a registered machine inside a PostgreSQL transaction,
 * preserving the machine's active_error and attaching up to 20 newest telemetry events.
 * Returns null when the machine ID is not registered.
 */
export async function createBugReport(
  db: Pool,
  input: CreateBugReportInput,
): Promise<BugReportRecord | null> {
  const validTag = validateTag(input.tag);
  const normalizedNote = normalizeWorkerNote(input.workerNote);
  const machineId = normalizeMachineId(input.machineId);

  if (!machineId) {
    return null;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const machineResult = await client.query<{ id: string; active_error: string | null }>(
      'SELECT id, active_error FROM machines WHERE id = $1',
      [machineId],
    );
    const machine = machineResult.rows[0];
    if (!machine) {
      await client.query('ROLLBACK');
      return null;
    }

    const eventsResult = await client.query<TelemetryEventSnapshotRow>(
      `SELECT time, machine_id, event_type, error_code, payload_json
       FROM telemetry_events
       WHERE machine_id = $1
       ORDER BY time DESC
       LIMIT $2`,
      [machine.id, SNAPSHOT_EVENT_LIMIT],
    );

    const attachedLogs: TelemetryEventRecord[] = eventsResult.rows.map((row) => ({
      time: row.time.toISOString(),
      machine_id: row.machine_id,
      event_type: row.event_type,
      error_code: row.error_code,
      payload_json: row.payload_json,
    }));

    const insertResult = await client.query<BugReportRow>(
      `INSERT INTO bug_reports (
         machine_id,
         error_code,
         tag,
         worker_note,
         attached_logs_json
       )
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING ${BUG_REPORT_COLUMNS}`,
      [machine.id, machine.active_error, validTag, normalizedNote, JSON.stringify(attachedLogs)],
    );

    await client.query('COMMIT');

    const created = insertResult.rows[0];
    if (!created) {
      throw new Error('Failed to insert bug report');
    }

    return mapBugReportRow(created);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List persisted bug reports for a registered machine ordered newest-first.
 * Returns null when the machine ID is not registered.
 */
export async function listBugReports(
  db: Pool,
  machineId: string,
): Promise<BugReportRecord[] | null> {
  const trimmedId = normalizeMachineId(machineId);
  if (!trimmedId) {
    return null;
  }

  const machineResult = await db.query<{ id: string }>(
    'SELECT id FROM machines WHERE id = $1',
    [trimmedId],
  );
  if (!machineResult.rows[0]) {
    return null;
  }

  const result = await db.query<BugReportRow>(
    `SELECT ${BUG_REPORT_COLUMNS}
     FROM bug_reports
     WHERE machine_id = $1
     ORDER BY created_at DESC, id DESC`,
    [trimmedId],
  );

  return result.rows.map(mapBugReportRow);
}

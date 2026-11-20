import type { Pool } from 'pg';
import {
  buildWinderTopic,
  commandPayloadSchema,
  serializeMqttJsonPayload,
  type CommandPayload,
  type CommandType,
  type MachineState,
} from '../spec/mqtt-contract.js';
import { normalizeMachineId } from './machines.js';

/**
 * Canonical lifecycle statuses for queued and dispatched machine update commands.
 */
export const PENDING_UPDATE_STATUSES = ['PENDING', 'DISPATCHED', 'CANCELLED'] as const;

/**
 * Lifecycle status union for a `pending_updates` record.
 */
export type PendingUpdateStatus = (typeof PENDING_UPDATE_STATUSES)[number];

/**
 * Minimal MQTT publishing contract required to dispatch commands without importing concrete transports.
 */
export interface MqttCommandPublisher {
  publish(
    topic: string,
    payload: string | Buffer,
    options?: { qos?: 0 | 1 | 2; retain?: boolean },
  ): Promise<void>;
}

/**
 * Serialized pending or completed machine update command row.
 */
export interface PendingUpdateRecord {
  id: number;
  machine_id: string;
  update_type: CommandType;
  target_version: string;
  target_name: string | null;
  status: PendingUpdateStatus;
  created_at: string;
  dispatched_at: string | null;
  cancelled_at: string | null;
}

/**
 * Immediate dispatch action outcome for one target machine.
 */
export type DispatchAction = 'DISPATCHED' | 'QUEUED';

/**
 * Per-machine outcome returned by a single or batch update dispatch operation.
 */
export interface MachineUpdateDispatchResult {
  machine_id: string;
  current_state: MachineState;
  action: DispatchAction;
  update: PendingUpdateRecord;
}

/**
 * Summary outcome returned by a single or batch update dispatch operation.
 */
export interface BatchUpdateDispatchResult {
  update_type: CommandType;
  target_version: string;
  target_name: string | null;
  total: number;
  dispatched_count: number;
  queued_count: number;
  results: MachineUpdateDispatchResult[];
}

/**
 * Error thrown when target machine selection or update identifier validation fails.
 */
export class InvalidUpdateTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUpdateTargetError';
  }
}

/**
 * Error thrown when one or more requested target machines are not registered.
 */
export class MachinesNotFoundError extends Error {
  readonly missingMachineIds: string[];

  constructor(missingMachineIds: string[]) {
    super(`Machine(s) not found: ${missingMachineIds.join(', ')}`);
    this.name = 'MachinesNotFoundError';
    this.missingMachineIds = missingMachineIds;
  }
}

/**
 * Error thrown when a referenced pending update record ID does not exist.
 */
export class PendingUpdateNotFoundError extends Error {
  readonly updateId: number;

  constructor(updateId: number) {
    super(`Pending update not found: ${updateId}`);
    this.name = 'PendingUpdateNotFoundError';
    this.updateId = updateId;
  }
}

/**
 * Error thrown when attempting to cancel an update that is no longer `PENDING`.
 */
export class PendingUpdateNotCancellableError extends Error {
  readonly updateId: number;
  readonly currentStatus: PendingUpdateStatus;

  constructor(updateId: number, currentStatus: PendingUpdateStatus) {
    super(`Update ${updateId} cannot be cancelled because status is ${currentStatus}`);
    this.name = 'PendingUpdateNotCancellableError';
    this.updateId = updateId;
    this.currentStatus = currentStatus;
  }
}

interface PendingUpdateRow {
  id: number | string;
  machine_id: string;
  update_type: CommandType;
  target_version: string;
  target_name: string | null;
  payload_json: unknown;
  status: PendingUpdateStatus;
  created_at: Date;
  dispatched_at: Date | null;
  cancelled_at: Date | null;
}

interface MachineStateRow {
  id: string;
  hardware_id: string | null;
  current_state: MachineState;
}

const MAX_TARGET_MACHINES = 200;
const DEFAULT_UPDATES_LIMIT = 50;
const MAX_UPDATES_LIMIT = 200;

const PENDING_UPDATE_COLUMNS = `
  id,
  machine_id,
  update_type,
  target_version,
  target_name,
  payload_json,
  status,
  created_at,
  dispatched_at,
  cancelled_at
`;

function mapPendingUpdateRow(row: PendingUpdateRow): PendingUpdateRecord {
  return {
    id: Number(row.id),
    machine_id: row.machine_id,
    update_type: row.update_type,
    target_version: row.target_version,
    target_name: row.target_name,
    status: row.status,
    created_at: row.created_at.toISOString(),
    dispatched_at: row.dispatched_at ? row.dispatched_at.toISOString() : null,
    cancelled_at: row.cancelled_at ? row.cancelled_at.toISOString() : null,
  };
}

function defaultOtaFallbackUrl(): string {
  const port = Number(process.env.PORT ?? 3000);
  const resolvedPort = Number.isInteger(port) && port > 0 ? port : 3000;
  return `http://127.0.0.1:${resolvedPort}`;
}

function parseHttpBaseUrl(candidate: string | undefined): string | null {
  const trimmed = candidate?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return trimmed.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Resolve the LAN HTTP base URL included in MQTT `OTA_UPDATE` download URLs.
 */
export function resolveOtaBaseUrl(
  overrideBaseUrl?: string,
  requestProtocol?: string,
  requestHost?: string,
): string {
  const fromOverride = parseHttpBaseUrl(overrideBaseUrl);
  if (fromOverride) {
    return fromOverride;
  }

  const fromEnv = parseHttpBaseUrl(process.env.OTA_BASE_URL);
  if (fromEnv) {
    return fromEnv;
  }

  const trimmedHost = requestHost?.trim();
  if (trimmedHost) {
    const protocol = requestProtocol === 'https' ? 'https' : 'http';
    const fromRequest = parseHttpBaseUrl(`${protocol}://${trimmedHost}`);
    if (fromRequest) {
      return fromRequest;
    }
  }

  return defaultOtaFallbackUrl();
}

/**
 * Validate, trim, and deduplicate single or multi-select machine target IDs.
 */
export function normalizeTargetMachineIds(input: {
  machineId?: string | undefined;
  machineIds?: readonly string[] | undefined;
}): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];

  if (input.machineId !== undefined) {
    const normalized = normalizeMachineId(input.machineId);
    if (!normalized) {
      throw new InvalidUpdateTargetError('Target machineId must not be empty');
    }
    seen.add(normalized);
    targets.push(normalized);
  }

  if (input.machineIds !== undefined) {
    for (const rawId of input.machineIds) {
      const normalized = typeof rawId === 'string' ? normalizeMachineId(rawId) : null;
      if (!normalized) {
        throw new InvalidUpdateTargetError('Target machineIds must not contain empty values');
      }
      if (!seen.has(normalized)) {
        seen.add(normalized);
        targets.push(normalized);
      }
    }
  }

  if (targets.length === 0) {
    throw new InvalidUpdateTargetError('At least one target machineId or machineIds is required');
  }
  if (targets.length > MAX_TARGET_MACHINES) {
    throw new InvalidUpdateTargetError(
      `Target machine count cannot exceed ${MAX_TARGET_MACHINES}`,
    );
  }

  return targets;
}

function buildDispatchedCommandJson(basePayload: CommandPayload, updateId: number | string): string {
  return serializeMqttJsonPayload(
    {
      ...basePayload,
      command_id: `upd-${updateId}`,
      ts: new Date().toISOString(),
    },
    commandPayloadSchema,
  );
}

/**
 * Queue or immediately dispatch an `OTA_UPDATE` or `APPLY_PRESET` command across target machines.
 * Machines in `IDLE` or `ERROR` receive the command over MQTT immediately; `WORKING` and `OFFLINE`
 * machines are queued as `PENDING` until transitioning to `IDLE`.
 */
export async function queueOrDispatchCommandForMachines(
  db: Pool,
  mqtt: MqttCommandPublisher,
  input: {
    machineId?: string | undefined;
    machineIds?: readonly string[] | undefined;
    updateType: CommandType;
    targetVersion: string;
    targetName?: string | null | undefined;
    commandPayload: CommandPayload;
  },
): Promise<BatchUpdateDispatchResult> {
  const targets = normalizeTargetMachineIds({
    machineId: input.machineId,
    machineIds: input.machineIds,
  });

  const validatedPayload = commandPayloadSchema.parse(input.commandPayload);
  serializeMqttJsonPayload(
    {
      ...validatedPayload,
      command_id: 'upd-999999999',
      ts: '2026-11-20T00:00:00.000Z',
    },
    commandPayloadSchema,
  );

  for (const machineId of targets) {
    buildWinderTopic(machineId, 'command');
  }

  const existingResult = await db.query<MachineStateRow>(
    `SELECT id, hardware_id, current_state
     FROM machines
     WHERE id = ANY($1::text[])`,
    [targets],
  );

  const existingIds = new Set(existingResult.rows.map((row) => row.id));
  const missingIds = targets.filter((id) => !existingIds.has(id));
  if (missingIds.length > 0) {
    throw new MachinesNotFoundError(missingIds);
  }
  for (const row of existingResult.rows) {
    buildWinderTopic(row.hardware_id ?? row.id, 'command');
  }

  const results: MachineUpdateDispatchResult[] = [];
  let dispatchedCount = 0;
  let queuedCount = 0;
  const targetName = input.targetName ?? null;

  for (const machineId of targets) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const lockedMachine = await client.query<MachineStateRow>(
        `SELECT id, hardware_id, current_state
         FROM machines
         WHERE id = $1
         FOR UPDATE`,
        [machineId],
      );

      const machineRow = lockedMachine.rows[0];
      if (!machineRow) {
        throw new MachinesNotFoundError([machineId]);
      }

      await client.query(
        `UPDATE pending_updates
         SET status = 'CANCELLED',
             cancelled_at = NOW()
         WHERE machine_id = $1
           AND update_type = $2
           AND status = 'PENDING'`,
        [machineId, input.updateType],
      );

      const shouldDispatchNow =
        machineRow.current_state === 'IDLE' || machineRow.current_state === 'ERROR';

      if (shouldDispatchNow) {
        const insertedRes = await client.query<PendingUpdateRow>(
          `INSERT INTO pending_updates (
             machine_id, update_type, target_version, target_name, payload_json, status, dispatched_at
           )
           VALUES ($1, $2, $3, $4, $5::jsonb, 'DISPATCHED', NOW())
           RETURNING ${PENDING_UPDATE_COLUMNS}`,
          [
            machineId,
            input.updateType,
            input.targetVersion,
            targetName,
            JSON.stringify(validatedPayload),
          ],
        );

        const row = insertedRes.rows[0]!;
        const commandJson = buildDispatchedCommandJson(validatedPayload, row.id);
        await mqtt.publish(
          buildWinderTopic(machineRow.hardware_id ?? machineRow.id, 'command'),
          commandJson,
          {
            qos: 1,
            retain: false,
          },
        );

        await client.query('COMMIT');
        dispatchedCount += 1;
        results.push({
          machine_id: machineId,
          current_state: machineRow.current_state,
          action: 'DISPATCHED',
          update: mapPendingUpdateRow(row),
        });
      } else {
        const insertedRes = await client.query<PendingUpdateRow>(
          `INSERT INTO pending_updates (
             machine_id, update_type, target_version, target_name, payload_json, status
           )
           VALUES ($1, $2, $3, $4, $5::jsonb, 'PENDING')
           RETURNING ${PENDING_UPDATE_COLUMNS}`,
          [
            machineId,
            input.updateType,
            input.targetVersion,
            targetName,
            JSON.stringify(validatedPayload),
          ],
        );

        const row = insertedRes.rows[0]!;
        await client.query('COMMIT');
        queuedCount += 1;
        results.push({
          machine_id: machineId,
          current_state: machineRow.current_state,
          action: 'QUEUED',
          update: mapPendingUpdateRow(row),
        });
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    update_type: input.updateType,
    target_version: input.targetVersion,
    target_name: targetName,
    total: results.length,
    dispatched_count: dispatchedCount,
    queued_count: queuedCount,
    results,
  };
}

/**
 * Build an `OTA_UPDATE` MQTT command for a resolved firmware release and queue or dispatch it.
 */
export async function dispatchOtaFirmwareUpdate(
  db: Pool,
  mqtt: MqttCommandPublisher,
  input: {
    release: {
      version: string;
      download_url: string;
      sha256: string;
    };
    baseUrl: string;
    machineId?: string | undefined;
    machineIds?: readonly string[] | undefined;
  },
): Promise<BatchUpdateDispatchResult> {
  const baseUrl = resolveOtaBaseUrl(input.baseUrl);
  const url = `${baseUrl}${input.release.download_url}`;

  return queueOrDispatchCommandForMachines(db, mqtt, {
    machineId: input.machineId,
    machineIds: input.machineIds,
    updateType: 'OTA_UPDATE',
    targetVersion: input.release.version,
    targetName: null,
    commandPayload: {
      command: 'OTA_UPDATE',
      version: input.release.version,
      url,
      sha256: input.release.sha256,
    },
  });
}

/**
 * Automatically dispatch all `PENDING` updates queued for a machine upon transitioning to `IDLE`.
 */
export async function dispatchPendingUpdatesForMachine(
  db: Pool,
  mqtt: MqttCommandPublisher,
  machineId: string,
): Promise<PendingUpdateRecord[]> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const pendingRes = await client.query<PendingUpdateRow>(
      `SELECT ${PENDING_UPDATE_COLUMNS}
       FROM pending_updates
       WHERE machine_id = $1
         AND status = 'PENDING'
       ORDER BY created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED`,
      [machineId],
    );

    if (pendingRes.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    const machineRes = await client.query<{ id: string; hardware_id: string | null }>(
      `SELECT id, hardware_id
       FROM machines
       WHERE id = $1`,
      [machineId],
    );
    const topicTarget = machineRes.rows[0]?.hardware_id ?? machineId;
    const topic = buildWinderTopic(topicTarget, 'command');
    const dispatched: PendingUpdateRecord[] = [];

    for (const row of pendingRes.rows) {
      const basePayload = commandPayloadSchema.parse(row.payload_json);
      const commandJson = buildDispatchedCommandJson(basePayload, row.id);
      await mqtt.publish(topic, commandJson, { qos: 1, retain: false });

      const updatedRes = await client.query<PendingUpdateRow>(
        `UPDATE pending_updates
         SET status = 'DISPATCHED',
             dispatched_at = NOW()
         WHERE id = $1
         RETURNING ${PENDING_UPDATE_COLUMNS}`,
        [row.id],
      );

      if (updatedRes.rows[0]) {
        dispatched.push(mapPendingUpdateRow(updatedRes.rows[0]));
      }
    }

    await client.query('COMMIT');
    return dispatched;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List queued, dispatched, or cancelled machine update commands ordered newest-first.
 */
export async function listPendingUpdates(
  db: Pool,
  filters: {
    machineId?: string | undefined;
    status?: PendingUpdateStatus | undefined;
    updateType?: CommandType | undefined;
    limit?: number | undefined;
  } = {},
): Promise<PendingUpdateRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const normalizedMachineId = normalizeMachineId(filters.machineId);
  if (normalizedMachineId) {
    params.push(normalizedMachineId);
    conditions.push(`machine_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.updateType) {
    params.push(filters.updateType);
    conditions.push(`update_type = $${params.length}`);
  }

  const rawLimit = filters.limit ?? DEFAULT_UPDATES_LIMIT;
  const clampedLimit = Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_UPDATES_LIMIT);
  params.push(clampedLimit);
  const limitParam = `$${params.length}`;

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.query<PendingUpdateRow>(
    `SELECT ${PENDING_UPDATE_COLUMNS}
     FROM pending_updates
     ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limitParam}`,
    params,
  );

  return result.rows.map(mapPendingUpdateRow);
}

/**
 * Cancel a `PENDING` update command before it is dispatched to the machine.
 */
export async function cancelPendingUpdate(
  db: Pool,
  updateId: number,
): Promise<PendingUpdateRecord> {
  if (!Number.isInteger(updateId) || updateId < 1) {
    throw new InvalidUpdateTargetError('updateId must be a positive integer');
  }

  const updatedRes = await db.query<PendingUpdateRow>(
    `UPDATE pending_updates
     SET status = 'CANCELLED',
         cancelled_at = NOW()
     WHERE id = $1
       AND status = 'PENDING'
     RETURNING ${PENDING_UPDATE_COLUMNS}`,
    [updateId],
  );

  const row = updatedRes.rows[0];
  if (row) {
    return mapPendingUpdateRow(row);
  }

  const existingRes = await db.query<{ status: PendingUpdateStatus }>(
    `SELECT status
     FROM pending_updates
     WHERE id = $1`,
    [updateId],
  );
  const existing = existingRes.rows[0];
  if (!existing) {
    throw new PendingUpdateNotFoundError(updateId);
  }

  throw new PendingUpdateNotCancellableError(updateId, existing.status);
}

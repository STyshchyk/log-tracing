import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { MqttTransport } from '../mqtt/transport.js';
import { getFirmwareReleaseByVersion } from '../services/firmware.js';
import {
  cancelPendingUpdate,
  dispatchOtaFirmwareUpdate,
  InvalidUpdateTargetError,
  listPendingUpdates,
  MachinesNotFoundError,
  PENDING_UPDATE_STATUSES,
  PendingUpdateNotCancellableError,
  PendingUpdateNotFoundError,
  resolveOtaBaseUrl,
  type PendingUpdateStatus,
} from '../services/pending-updates.js';
import {
  COMMAND_TYPES,
  MACHINE_STATES,
  type CommandType,
} from '../spec/mqtt-contract.js';
import { pendingUpdateRecordResponseSchema } from './api-schemas.js';

interface DispatchOtaBody {
  version: string;
  machineId?: string;
  machineIds?: string[];
}

interface ListUpdatesQuerystring {
  machineId?: string;
  status?: PendingUpdateStatus;
  updateType?: CommandType;
  limit?: number;
}

interface CancelUpdateParams {
  updateId: number;
}

/**
 * Shared OpenAPI/JSON schema for single and batch update dispatch responses.
 */
export const batchUpdateDispatchResponseSchema = {
  type: 'object',
  required: [
    'update_type',
    'target_version',
    'target_name',
    'total',
    'dispatched_count',
    'queued_count',
    'results',
  ],
  properties: {
    update_type: { type: 'string', enum: [...COMMAND_TYPES] },
    target_version: { type: 'string' },
    target_name: { type: 'string', nullable: true },
    total: { type: 'integer', minimum: 1 },
    dispatched_count: { type: 'integer', minimum: 0 },
    queued_count: { type: 'integer', minimum: 0 },
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['machine_id', 'current_state', 'action', 'update'],
        properties: {
          machine_id: { type: 'string' },
          current_state: { type: 'string', enum: [...MACHINE_STATES] },
          action: { type: 'string', enum: ['DISPATCHED', 'QUEUED'] },
          update: pendingUpdateRecordResponseSchema,
        },
      },
    },
  },
} as const;

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
  },
} as const;

/**
 * Register authenticated Department Heads Fleet OTA dispatch and pending-queue endpoints.
 */
export function registerFleetUpdatesApi(
  app: FastifyInstance,
  db: Pool,
  mqtt: MqttTransport,
  otaBaseUrl?: string,
): void {
  app.post<{ Body: DispatchOtaBody }>(
    '/api/fleet/firmware/ota',
    {
      schema: {
        description:
          'Trigger an OTA_UPDATE for a single machine or multi-selected group; dispatches immediately on IDLE/ERROR or queues as PENDING when WORKING',
        body: {
          type: 'object',
          required: ['version'],
          additionalProperties: false,
          properties: {
            version: { type: 'string', minLength: 1, maxLength: 64 },
            machineId: { type: 'string', minLength: 1, maxLength: 64 },
            machineIds: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: { type: 'string', minLength: 1, maxLength: 64 },
            },
          },
        },
        response: {
          200: batchUpdateDispatchResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const release = await getFirmwareReleaseByVersion(db, request.body.version);
      if (!release) {
        return reply.status(404).send({
          error: 'Firmware release not found',
          version: request.body.version.trim(),
        });
      }

      const baseUrl = resolveOtaBaseUrl(otaBaseUrl, request.protocol, request.headers.host);
      try {
        const result = await dispatchOtaFirmwareUpdate(db, mqtt, {
          release,
          baseUrl,
          machineId: request.body.machineId,
          machineIds: request.body.machineIds,
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof InvalidUpdateTargetError) {
          return reply.status(400).send({ error: err.message });
        }
        if (err instanceof MachinesNotFoundError) {
          return reply.status(404).send({
            error: err.message,
            missing_machine_ids: err.missingMachineIds,
          });
        }
        throw err;
      }
    },
  );

  app.get<{ Querystring: ListUpdatesQuerystring }>(
    '/api/fleet/updates',
    {
      schema: {
        description: 'List pending, dispatched, and cancelled machine update commands newest-first',
        querystring: {
          type: 'object',
          properties: {
            machineId: { type: 'string' },
            status: { type: 'string', enum: [...PENDING_UPDATE_STATUSES] },
            updateType: { type: 'string', enum: [...COMMAND_TYPES] },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['total', 'updates'],
            properties: {
              total: { type: 'integer', minimum: 0 },
              updates: {
                type: 'array',
                items: pendingUpdateRecordResponseSchema,
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const updates = await listPendingUpdates(db, {
        machineId: request.query.machineId,
        status: request.query.status,
        updateType: request.query.updateType,
        limit: request.query.limit,
      });

      return reply.send({
        total: updates.length,
        updates,
      });
    },
  );

  app.post<{ Params: CancelUpdateParams }>(
    '/api/fleet/updates/:updateId/cancel',
    {
      schema: {
        description: 'Cancel a PENDING OTA or preset update before it is dispatched',
        params: {
          type: 'object',
          required: ['updateId'],
          properties: {
            updateId: { type: 'integer', minimum: 1 },
          },
        },
        response: {
          200: pendingUpdateRecordResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const cancelled = await cancelPendingUpdate(db, request.params.updateId);
        return reply.send(cancelled);
      } catch (err) {
        if (err instanceof InvalidUpdateTargetError) {
          return reply.status(400).send({ error: err.message });
        }
        if (err instanceof PendingUpdateNotFoundError) {
          return reply.status(404).send({
            error: err.message,
            update_id: err.updateId,
          });
        }
        if (err instanceof PendingUpdateNotCancellableError) {
          return reply.status(409).send({
            error: err.message,
            update_id: err.updateId,
            current_status: err.currentStatus,
          });
        }
        throw err;
      }
    },
  );
}

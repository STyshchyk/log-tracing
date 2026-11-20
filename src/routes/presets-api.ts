import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { MqttTransport } from '../mqtt/transport.js';
import {
  InvalidUpdateTargetError,
  MachinesNotFoundError,
} from '../services/pending-updates.js';
import {
  createMachinePreset,
  deleteMachinePreset,
  DuplicatePresetError,
  getMachinePresetById,
  InvalidPresetInputError,
  listMachinePresets,
  PresetNotFoundError,
  pushMachinePreset,
} from '../services/presets.js';
import { batchUpdateDispatchResponseSchema } from './updates-api.js';

interface CreatePresetBody {
  name: string;
  version: string;
  config_json: Record<string, unknown>;
  notes?: string;
}

interface ListPresetsQuerystring {
  name?: string;
}

interface PresetIdParams {
  presetId: number;
}

interface PushPresetByIdBody {
  machineId?: string;
  machineIds?: string[];
}

interface PushPresetBody {
  presetId?: number;
  name?: string;
  version?: string;
  machineId?: string;
  machineIds?: string[];
}

const presetRecordResponseSchema = {
  type: 'object',
  required: ['id', 'name', 'version', 'config_json', 'notes', 'created_at'],
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    version: { type: 'string' },
    config_json: {
      type: 'object',
      additionalProperties: true,
    },
    notes: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
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

function mapPresetPushError(
  err: unknown,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (err instanceof InvalidPresetInputError || err instanceof InvalidUpdateTargetError) {
    return reply.status(400).send({ error: err.message });
  }
  if (err instanceof PresetNotFoundError) {
    return reply.status(404).send({ error: err.message, preset: err.identifier });
  }
  if (err instanceof MachinesNotFoundError) {
    return reply.status(404).send({
      error: err.message,
      missing_machine_ids: err.missingMachineIds,
    });
  }
  throw err;
}

/**
 * Register authenticated Department Heads Fleet versioned preset CRUD and push endpoints.
 */
export function registerFleetPresetsApi(
  app: FastifyInstance,
  db: Pool,
  mqtt: MqttTransport,
): void {
  app.post<{ Body: CreatePresetBody }>(
    '/api/fleet/presets',
    {
      schema: {
        description:
          'Create a named, versioned JSON machine preset validated against the MQTT < 1024-byte APPLY_PRESET budget',
        body: {
          type: 'object',
          required: ['name', 'version', 'config_json'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 64 },
            version: { type: 'string', minLength: 1, maxLength: 64 },
            config_json: {
              type: 'object',
              additionalProperties: true,
            },
            notes: { type: 'string', maxLength: 2000 },
          },
        },
        response: {
          201: presetRecordResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const created = await createMachinePreset(db, {
          name: request.body.name,
          version: request.body.version,
          config_json: request.body.config_json,
          notes: request.body.notes,
        });
        return reply.status(201).send(created);
      } catch (err) {
        if (err instanceof InvalidPresetInputError) {
          return reply.status(400).send({ error: err.message });
        }
        if (err instanceof DuplicatePresetError) {
          return reply.status(409).send({
            error: err.message,
            name: err.presetName,
            version: err.version,
          });
        }
        throw err;
      }
    },
  );

  app.get<{ Querystring: ListPresetsQuerystring }>(
    '/api/fleet/presets',
    {
      schema: {
        description: 'List stored versioned presets newest-first with optional name filter',
        querystring: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['total', 'presets'],
            properties: {
              total: { type: 'integer', minimum: 0 },
              presets: {
                type: 'array',
                items: presetRecordResponseSchema,
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const presets = await listMachinePresets(db, { name: request.query.name });
      return reply.send({
        total: presets.length,
        presets,
      });
    },
  );

  app.get<{ Params: PresetIdParams }>(
    '/api/fleet/presets/:presetId',
    {
      schema: {
        description: 'Fetch a stored versioned machine preset by ID',
        params: {
          type: 'object',
          required: ['presetId'],
          properties: {
            presetId: { type: 'integer', minimum: 1 },
          },
        },
        response: {
          200: presetRecordResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const preset = await getMachinePresetById(db, request.params.presetId);
      if (!preset) {
        return reply.status(404).send({
          error: `Preset not found: ${request.params.presetId}`,
        });
      }
      return reply.send(preset);
    },
  );

  app.delete<{ Params: PresetIdParams }>(
    '/api/fleet/presets/:presetId',
    {
      schema: {
        description: 'Delete a stored versioned machine preset by ID',
        params: {
          type: 'object',
          required: ['presetId'],
          properties: {
            presetId: { type: 'integer', minimum: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['deleted', 'preset'],
            properties: {
              deleted: { type: 'boolean' },
              preset: presetRecordResponseSchema,
            },
          },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const deleted = await deleteMachinePreset(db, request.params.presetId);
      if (!deleted) {
        return reply.status(404).send({
          error: `Preset not found: ${request.params.presetId}`,
        });
      }
      return reply.send({
        deleted: true,
        preset: deleted,
      });
    },
  );

  app.post<{ Params: PresetIdParams; Body: PushPresetByIdBody }>(
    '/api/fleet/presets/:presetId/push',
    {
      schema: {
        description:
          'Push a stored preset by ID to single or multi-selected machines over MQTT (immediate on IDLE/ERROR, queued PENDING on WORKING)',
        params: {
          type: 'object',
          required: ['presetId'],
          properties: {
            presetId: { type: 'integer', minimum: 1 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
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
      try {
        const result = await pushMachinePreset(db, mqtt, {
          presetId: request.params.presetId,
          machineId: request.body.machineId,
          machineIds: request.body.machineIds,
        });
        return reply.send(result);
      } catch (err) {
        return mapPresetPushError(err, reply);
      }
    },
  );

  app.post<{ Body: PushPresetBody }>(
    '/api/fleet/presets/push',
    {
      schema: {
        description:
          'Push a stored preset by presetId or (name, version) to single or multi-selected machines over MQTT',
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            presetId: { type: 'integer', minimum: 1 },
            name: { type: 'string', minLength: 1, maxLength: 64 },
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
      try {
        const result = await pushMachinePreset(db, mqtt, {
          presetId: request.body.presetId,
          name: request.body.name,
          version: request.body.version,
          machineId: request.body.machineId,
          machineIds: request.body.machineIds,
        });
        return reply.send(result);
      } catch (err) {
        return mapPresetPushError(err, reply);
      }
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  FLEET_HISTORY_KINDS,
  getFleetMachineDetails,
  getFleetSummary,
  listFleetHistory,
  listFleetMachines,
  type FleetHistoryKind,
} from '../services/fleet.js';
import {
  assignMachineHardware,
  HardwareAlreadyAssignedError,
  InvalidHardwareIdError,
} from '../services/machines.js';
import {
  BUG_REPORT_TAGS,
  MACHINE_STATES,
  type MachineState,
} from '../spec/mqtt-contract.js';
import {
  bugReportRecordResponseSchema,
  coilRollupBucketResponseSchema,
  glossaryEntryResponseSchema,
  machineNotFoundResponseSchema,
  machineRecordResponseSchema,
  pendingUpdateRecordResponseSchema,
  sendMachineNotFound,
} from './api-schemas.js';

interface FleetMachinesQuerystring {
  state?: MachineState;
  zone?: string;
}

interface FleetMachineParams {
  machineId: string;
}

interface AssignHardwareBody {
  hardware_id: string | null;
  force?: boolean;
}

interface FleetHistoryQuerystring {
  limit?: number;
  machineId?: string;
  zone?: string;
  kind?: FleetHistoryKind;
}

const recentErrorSummaryResponseSchema = {
  type: 'object',
  required: ['time', 'event_type', 'error_code', 'glossary_title', 'summary'],
  properties: {
    time: { type: 'string', format: 'date-time' },
    event_type: { type: 'string' },
    error_code: { type: 'string', nullable: true },
    glossary_title: { type: 'string', nullable: true },
    summary: { type: 'string' },
  },
} as const;

const fleetHistoryErrorEventSchema = {
  type: 'object',
  required: [
    'kind',
    'time',
    'machine_id',
    'machine_display_name',
    'zone',
    'floor_position',
    'hardware_id',
    'event_type',
    'error_code',
    'glossary_title',
    'summary',
  ],
  properties: {
    kind: { type: 'string', enum: ['error_event'] },
    time: { type: 'string', format: 'date-time' },
    machine_id: { type: 'string' },
    machine_display_name: { type: 'string' },
    zone: { type: 'string' },
    floor_position: { type: 'integer', nullable: true },
    hardware_id: { type: 'string', nullable: true },
    event_type: { type: 'string' },
    error_code: { type: 'string', nullable: true },
    glossary_title: { type: 'string', nullable: true },
    summary: { type: 'string' },
  },
} as const;

const fleetHistoryBugReportSchema = {
  type: 'object',
  required: [
    'kind',
    'time',
    'machine_id',
    'machine_display_name',
    'zone',
    'floor_position',
    'hardware_id',
    'bug_report_id',
    'tag',
    'error_code',
    'worker_note',
    'status',
  ],
  properties: {
    kind: { type: 'string', enum: ['bug_report'] },
    time: { type: 'string', format: 'date-time' },
    machine_id: { type: 'string' },
    machine_display_name: { type: 'string' },
    zone: { type: 'string' },
    floor_position: { type: 'integer', nullable: true },
    hardware_id: { type: 'string', nullable: true },
    bug_report_id: { type: 'integer' },
    tag: { type: 'string', enum: [...BUG_REPORT_TAGS] },
    error_code: { type: 'string', nullable: true },
    worker_note: { type: 'string', nullable: true },
    status: { type: 'string' },
  },
} as const;

/**
 * Register the authenticated Department Heads Fleet JSON endpoints on the Fastify scope.
 */
export function registerFleetApi(app: FastifyInstance, db: Pool): void {
  app.get(
    '/api/fleet/summary',
    {
      schema: {
        description:
          'Get room-wide winding machine state counts, open bug reports, and ESP32 winding cycle rollups across TODAY, WEEK, MONTH, and ALL_TIME',
        response: {
          200: {
            type: 'object',
            required: ['generated_at', 'machine_counts', 'open_bug_reports', 'coil_rollups'],
            properties: {
              generated_at: { type: 'string', format: 'date-time' },
              machine_counts: {
                type: 'object',
                required: ['total', ...MACHINE_STATES],
                properties: {
                  total: { type: 'integer', minimum: 0 },
                  WORKING: { type: 'integer', minimum: 0 },
                  IDLE: { type: 'integer', minimum: 0 },
                  ERROR: { type: 'integer', minimum: 0 },
                  OFFLINE: { type: 'integer', minimum: 0 },
                },
              },
              open_bug_reports: { type: 'integer', minimum: 0 },
              coil_rollups: {
                type: 'array',
                items: coilRollupBucketResponseSchema,
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const summary = await getFleetSummary(db);
      return reply.send(summary);
    },
  );

  app.get<{ Querystring: FleetMachinesQuerystring }>(
    '/api/fleet/machines',
    {
      schema: {
        description:
          'List all registered winding machines ordered by physical floor position with optional state and legacy zone filters',
        querystring: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              enum: [...MACHINE_STATES],
              description: 'Optional operational state filter',
            },
            zone: {
              type: 'string',
              description: 'Optional legacy floor zone filter',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['total', 'machines'],
            properties: {
              total: { type: 'integer', minimum: 0 },
              machines: {
                type: 'array',
                items: machineRecordResponseSchema,
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const machines = await listFleetMachines(db, {
        state: request.query.state,
        zone: request.query.zone,
      });

      return reply.send({
        total: machines.length,
        machines,
      });
    },
  );

  app.get<{ Params: FleetMachineParams }>(
    '/api/fleet/machines/:machineId/details',
    {
      schema: {
        description:
          'Fetch machine drill-down details including active glossary guidance, recent errors, recent bug reports, ESP32 winding cycle rollups, and Worker Portal URL',
        params: {
          type: 'object',
          required: ['machineId'],
          properties: {
            machineId: {
              type: 'string',
              minLength: 1,
              description: 'Registered winding machine ID (e.g. W-01)',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: [
              'machine',
              'active_glossary',
              'recent_errors',
              'recent_bug_reports',
              'coil_rollups',
              'pending_updates',
              'worker_portal_url',
            ],
            properties: {
              machine: machineRecordResponseSchema,
              active_glossary: {
                ...glossaryEntryResponseSchema,
                nullable: true,
              },
              recent_errors: {
                type: 'array',
                items: recentErrorSummaryResponseSchema,
              },
              recent_bug_reports: {
                type: 'array',
                items: bugReportRecordResponseSchema,
              },
              coil_rollups: {
                type: 'array',
                items: coilRollupBucketResponseSchema,
              },
              pending_updates: {
                type: 'array',
                items: pendingUpdateRecordResponseSchema,
              },
              worker_portal_url: { type: 'string' },
            },
          },
          404: machineNotFoundResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const details = await getFleetMachineDetails(db, request.params.machineId);
      if (details === null) {
        return sendMachineNotFound(reply, request.params.machineId);
      }

      return reply.send(details);
    },
  );

  app.put<{ Params: FleetMachineParams; Body: AssignHardwareBody }>(
    '/api/fleet/machines/:machineId/hardware',
    {
      schema: {
        description:
          'Bind or unassign a replaceable ESP32 hardware ID on a fixed physical machine position while preserving all position history',
        params: {
          type: 'object',
          required: ['machineId'],
          properties: {
            machineId: {
              type: 'string',
              minLength: 1,
              description: 'Registered physical winding position ID (e.g. W-23)',
            },
          },
        },
        body: {
          type: 'object',
          required: ['hardware_id'],
          additionalProperties: false,
          properties: {
            hardware_id: {
              type: 'string',
              nullable: true,
              description: 'Replacement ESP32 hardware identifier, or null to unassign',
            },
            force: {
              type: 'boolean',
              description: 'Reassign hardware_id even if currently bound to another floor position',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['machine', 'previous_hardware_id', 'unassigned_from_machine_id'],
            properties: {
              machine: machineRecordResponseSchema,
              previous_hardware_id: { type: 'string', nullable: true },
              unassigned_from_machine_id: { type: 'string', nullable: true },
            },
          },
          400: {
            type: 'object',
            required: ['error'],
            properties: {
              error: { type: 'string' },
            },
          },
          404: machineNotFoundResponseSchema,
          409: {
            type: 'object',
            required: ['error', 'hardware_id', 'existing_machine_id'],
            properties: {
              error: { type: 'string' },
              hardware_id: { type: 'string' },
              existing_machine_id: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await assignMachineHardware(db, {
          machineId: request.params.machineId,
          hardwareId: request.body.hardware_id,
          force: request.body.force ?? false,
        });
        if (result === null) {
          return sendMachineNotFound(reply, request.params.machineId);
        }
        return reply.send(result);
      } catch (err) {
        if (err instanceof InvalidHardwareIdError) {
          return reply.status(400).send({ error: err.message });
        }
        if (err instanceof HardwareAlreadyAssignedError) {
          return reply.status(409).send({
            error: err.message,
            hardware_id: err.hardwareId,
            existing_machine_id: err.existingMachineId,
          });
        }
        throw err;
      }
    },
  );

  app.get<{ Querystring: FleetHistoryQuerystring }>(
    '/api/fleet/history',
    {
      schema: {
        description:
          'List merged room-wide fault telemetry events and operator bug reports newest-first with optional filters',
        querystring: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
              description: 'Maximum number of merged history items to return (1..100, default 50)',
            },
            machineId: {
              type: 'string',
              description: 'Optional machine ID filter',
            },
            zone: {
              type: 'string',
              description: 'Optional legacy floor zone filter',
            },
            kind: {
              type: 'string',
              enum: [...FLEET_HISTORY_KINDS],
              default: 'all',
              description: 'Filter by record kind: all, errors, or bug_reports',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['total', 'items'],
            properties: {
              total: { type: 'integer', minimum: 0 },
              items: {
                type: 'array',
                items: {
                  oneOf: [fleetHistoryErrorEventSchema, fleetHistoryBugReportSchema],
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const items = await listFleetHistory(db, {
        limit: request.query.limit,
        machineId: request.query.machineId,
        zone: request.query.zone,
        kind: request.query.kind,
      });

      return reply.send({
        total: items.length,
        items,
      });
    },
  );
}

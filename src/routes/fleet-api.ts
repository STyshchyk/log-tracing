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
  BUG_REPORT_TAGS,
  FLOOR_ZONES,
  MACHINE_STATES,
  type FloorZone,
  type MachineState,
} from '../spec/mqtt-contract.js';
import {
  bugReportRecordResponseSchema,
  coilRollupBucketResponseSchema,
  glossaryEntryResponseSchema,
  machineNotFoundResponseSchema,
  machineRecordResponseSchema,
  sendMachineNotFound,
} from './api-schemas.js';

interface FleetMachinesQuerystring {
  state?: MachineState;
  zone?: FloorZone;
}

interface FleetMachineParams {
  machineId: string;
}

interface FleetHistoryQuerystring {
  limit?: number;
  machineId?: string;
  zone?: FloorZone;
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
    zone: { type: 'string', enum: [...FLOOR_ZONES] },
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
    zone: { type: 'string', enum: [...FLOOR_ZONES] },
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
          'Get room-wide winding machine state counts, open bug reports, and coil outcome rollups across TODAY, WEEK, MONTH, and ALL_TIME',
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
          'List all registered winding machines ordered by floor zone and grid coordinates with optional state and zone filters',
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
              enum: [...FLOOR_ZONES],
              description: 'Optional floor zone filter',
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
          'Fetch machine drill-down details including active glossary guidance, recent errors, recent bug reports, coil rollups, and Worker Portal URL',
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
              enum: [...FLOOR_ZONES],
              description: 'Optional floor zone filter',
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

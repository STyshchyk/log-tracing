import type { FastifyInstance, FastifySchemaCompiler, FastifySchemaValidationError } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  BUG_REPORT_TAGS,
  BugReportValidationError,
  createBugReport,
  createBugReportBodySchema,
  listBugReports,
} from '../services/bug-reports.js';

interface MachineBugReportsParams {
  machineId: string;
}

interface CreateBugReportBody {
  tag: string;
  worker_note?: string | null;
}

const machineIdParamsSchema = z.object({
  machineId: z.string().min(1),
});

function toFastifyValidationErrors(issues: z.ZodIssue[]): FastifySchemaValidationError[] {
  return issues.map((issue) => ({
    keyword: issue.code,
    instancePath: issue.path.length > 0 ? `/${issue.path.join('/')}` : '',
    schemaPath: `#/${issue.path.join('/')}`,
    params: {},
    message: issue.message,
  }));
}

const strictBugReportValidatorCompiler: FastifySchemaCompiler<unknown> = ({ httpPart }) => {
  const zodSchema =
    httpPart === 'body'
      ? createBugReportBodySchema
      : httpPart === 'params'
        ? machineIdParamsSchema
        : null;

  return (data: unknown) => {
    if (!zodSchema) {
      return { value: data };
    }
    const parsed = zodSchema.safeParse(data);
    if (parsed.success) {
      return { value: parsed.data };
    }
    return { error: toFastifyValidationErrors(parsed.error.issues) };
  };
};

const telemetrySnapshotItemSchema = {
  type: 'object',
  required: ['time', 'machine_id', 'event_type', 'error_code', 'payload_json'],
  properties: {
    time: { type: 'string', format: 'date-time' },
    machine_id: { type: 'string' },
    event_type: { type: 'string' },
    error_code: { type: 'string', nullable: true },
    payload_json: {
      type: 'object',
      additionalProperties: true,
      properties: {
        reset_reason: { type: 'string' },
        rssi: { type: 'number' },
        free_heap: { type: 'integer' },
        subsystem: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
        ts: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },
    },
  },
} as const;

const bugReportRecordSchema = {
  type: 'object',
  required: [
    'id',
    'machine_id',
    'error_code',
    'tag',
    'worker_note',
    'photo_path',
    'attached_logs_json',
    'status',
    'created_at',
  ],
  properties: {
    id: { type: 'integer' },
    machine_id: { type: 'string' },
    error_code: { type: 'string', nullable: true },
    tag: { type: 'string', enum: [...BUG_REPORT_TAGS] },
    worker_note: { type: 'string', nullable: true },
    photo_path: { type: 'string', nullable: true },
    attached_logs_json: {
      type: 'array',
      items: telemetrySnapshotItemSchema,
    },
    status: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

const machineNotFoundSchema = {
  type: 'object',
  required: ['error', 'machineId'],
  properties: {
    error: { type: 'string' },
    machineId: { type: 'string' },
  },
} as const;

const validationErrorSchema = {
  type: 'object',
  required: ['error', 'message'],
  properties: {
    statusCode: { type: 'integer' },
    code: { type: 'string' },
    error: { type: 'string' },
    message: { type: 'string' },
  },
} as const;

/**
 * Register the HTTP JSON bug-report submission and listing endpoints on the Fastify instance.
 */
export function registerBugReportsApi(app: FastifyInstance, db: Pool): void {
  app.post<{ Params: MachineBugReportsParams; Body: CreateBugReportBody }>(
    '/api/machines/:machineId/bug-reports',
    {
      validatorCompiler: strictBugReportValidatorCompiler,
      schema: {
        description:
          'Submit a machine bug report with a validated quick tag, optional worker note, and an auto-attached snapshot of up to 20 newest telemetry events',
        params: {
          type: 'object',
          required: ['machineId'],
          properties: {
            machineId: {
              type: 'string',
              minLength: 1,
              description: 'Registered winding machine ID',
            },
          },
        },
        body: {
          type: 'object',
          required: ['tag'],
          additionalProperties: false,
          properties: {
            tag: {
              type: 'string',
              enum: [...BUG_REPORT_TAGS],
              description: '1-tap quick tag categorizing the reported issue',
            },
            worker_note: {
              type: 'string',
              nullable: true,
              description: 'Optional plain-text operator note',
            },
          },
        },
        response: {
          201: bugReportRecordSchema,
          400: validationErrorSchema,
          404: machineNotFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const machineId = request.params.machineId.trim();

      try {
        const created = await createBugReport(db, {
          machineId,
          tag: request.body.tag,
          workerNote: request.body.worker_note,
        });

        if (created === null) {
          return reply.status(404).send({
            error: 'Machine not found',
            machineId,
          });
        }

        return reply.status(201).send(created);
      } catch (err) {
        if (err instanceof BugReportValidationError) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: MachineBugReportsParams }>(
    '/api/machines/:machineId/bug-reports',
    {
      schema: {
        description: 'List bug reports submitted for a registered winding machine newest-first',
        params: {
          type: 'object',
          required: ['machineId'],
          properties: {
            machineId: {
              type: 'string',
              minLength: 1,
              description: 'Registered winding machine ID',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['machine_id', 'bug_reports'],
            properties: {
              machine_id: { type: 'string' },
              bug_reports: {
                type: 'array',
                items: bugReportRecordSchema,
              },
            },
          },
          404: machineNotFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const machineId = request.params.machineId.trim();
      const bugReports = await listBugReports(db, machineId);

      if (bugReports === null) {
        return reply.status(404).send({
          error: 'Machine not found',
          machineId,
        });
      }

      return reply.send({
        machine_id: machineId,
        bug_reports: bugReports,
      });
    },
  );
}

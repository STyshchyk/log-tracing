import type { FastifyReply } from 'fastify';
import { BUG_REPORT_TAGS, FLOOR_ZONES, MACHINE_STATES } from '../spec/mqtt-contract.js';

/**
 * Shared OpenAPI/JSON schema for standardized HTTP 404 machine-not-found responses.
 */
export const machineNotFoundResponseSchema = {
  type: 'object',
  required: ['error', 'machineId'],
  properties: {
    error: { type: 'string' },
    machineId: { type: 'string' },
  },
} as const;

/**
 * Send a consistent HTTP 404 JSON payload when a requested machine ID does not exist.
 */
export function sendMachineNotFound(
  reply: FastifyReply,
  machineId: string | undefined,
): FastifyReply {
  return reply.status(404).send({
    error: 'Machine not found',
    machineId: machineId?.trim() ?? '',
  });
}

/**
 * Shared OpenAPI/JSON schema for serialized machine records.
 */
export const machineRecordResponseSchema = {
  type: 'object',
  required: [
    'id',
    'display_name',
    'zone',
    'grid_row',
    'grid_col',
    'current_state',
    'active_error',
    'last_seen_at',
  ],
  properties: {
    id: { type: 'string' },
    display_name: { type: 'string' },
    zone: { type: 'string', enum: [...FLOOR_ZONES] },
    grid_row: { type: 'integer' },
    grid_col: { type: 'integer' },
    current_state: { type: 'string', enum: [...MACHINE_STATES] },
    active_error: { type: 'string', nullable: true },
    last_seen_at: { type: 'string', format: 'date-time', nullable: true },
  },
} as const;

/**
 * Shared OpenAPI/JSON schema for coil outcome rollup buckets.
 */
export const coilRollupBucketResponseSchema = {
  type: 'object',
  required: ['window', 'completed_count', 'aborted_count', 'total_count'],
  properties: {
    window: { type: 'string', enum: ['TODAY', 'WEEK', 'MONTH', 'ALL_TIME'] },
    completed_count: { type: 'integer', minimum: 0 },
    aborted_count: { type: 'integer', minimum: 0 },
    total_count: { type: 'integer', minimum: 0 },
  },
} as const;

/**
 * Shared OpenAPI/JSON schema for glossary entries returned by JSON APIs.
 */
export const glossaryEntryResponseSchema = {
  type: 'object',
  required: [
    'error_code',
    'title',
    'symptoms',
    'fix_steps_md',
    'updated_at',
    'is_active',
  ],
  properties: {
    error_code: { type: 'string' },
    title: { type: 'string' },
    symptoms: { type: 'string' },
    fix_steps_md: { type: 'string' },
    updated_at: { type: 'string', format: 'date-time' },
    is_active: { type: 'boolean' },
  },
} as const;

/**
 * Shared OpenAPI/JSON schema for serialized telemetry event records.
 */
export const telemetryEventResponseSchema = {
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

/**
 * Shared OpenAPI/JSON schema for serialized bug report records.
 */
export const bugReportRecordResponseSchema = {
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
      items: telemetryEventResponseSchema,
    },
    status: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

import type { FastifyReply } from 'fastify';

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

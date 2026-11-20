import { z } from 'zod';
import { errorCodeSchema, nonEmptyText } from './fault-registry.js';

/**
 * Canonical MQTT topic prefix shared by firmware and backend ingestion.
 */
export const MQTT_TOPIC_PREFIX = 'factory/winders' as const;

/**
 * Exclusive upper bound on UTF-8 payload byte size (< 1024 bytes) to prevent ESP32 heap fragmentation.
 */
export const MAX_MQTT_PAYLOAD_BYTES = 1024;

/**
 * Allowed per-machine MQTT channels under factory/winders/{machineId}/{channel}.
 */
export const MQTT_CHANNELS = ['status', 'events', 'coil'] as const;

/**
 * Valid per-machine MQTT channel name.
 */
export type MqttChannel = (typeof MQTT_CHANNELS)[number];

/**
 * Canonical winding machine operational states.
 */
export const MACHINE_STATES = ['WORKING', 'IDLE', 'ERROR', 'OFFLINE'] as const;

/**
 * Canonical machine operational state string union.
 */
export type MachineState = (typeof MACHINE_STATES)[number];

/**
 * Canonical diagnostic/telemetry event types accepted on the events channel.
 */
export const EVENT_TYPES = [
  'ERROR',
  'FAULT',
  'SUBSYSTEM_TIMEOUT',
  'CRASH_RESET',
  'BOOT',
  'HEARTBEAT',
  'DIAGNOSTIC',
  'INFO',
] as const;

/**
 * Telemetry event type union.
 */
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Event types classified as error/fault events regardless of whether error_code is present.
 */
export const ERROR_EVENT_TYPES = [
  'ERROR',
  'FAULT',
  'SUBSYSTEM_TIMEOUT',
  'CRASH_RESET',
] as const;

/**
 * Subset of telemetry event types always classified as error events.
 */
export type ErrorEventType = (typeof ERROR_EVENT_TYPES)[number];

/**
 * Canonical ESP32 internal winding cycle stop modes (CRM/QR outcomes such as COMPLETED/FAILED/REDO are excluded).
 */
export const COIL_OUTCOMES = ['AUTO_FINISHED', 'ABORTED', 'FAULT_TERMINATED'] as const;

/**
 * Canonical ESP32 winding cycle outcome union.
 */
export type CoilOutcome = (typeof COIL_OUTCOMES)[number];

/**
 * Allowed 1-tap quick tags for operator bug reports.
 */
export const BUG_REPORT_TAGS = [
  'Fiber Snap',
  'Tension',
  'Unit Dead',
  'Bobbin Jam',
  'Other',
] as const;

/**
 * Operator bug report quick tag union.
 */
export type BugReportTag = (typeof BUG_REPORT_TAGS)[number];

/**
 * Canonical winding room floor zones.
 */
export const FLOOR_ZONES = ['NORTH_LEFT', 'NORTH_RIGHT', 'MAIN_BANK', 'EAST_DOOR'] as const;

/**
 * Winding room floor zone union.
 */
export type FloorZone = (typeof FLOOR_ZONES)[number];

const MACHINE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOPIC_PREFIX_PARTS = MQTT_TOPIC_PREFIX.split('/');

const timestampSchema = z.union([nonEmptyText, z.number().finite().nonnegative()]);

/**
 * Schema for `factory/winders/{machineId}/status` payloads (including LWT `{"state":"OFFLINE"}`).
 */
export const statusPayloadSchema = z.strictObject({
  state: z.enum(MACHINE_STATES),
  error_code: errorCodeSchema.nullish(),
  ts: timestampSchema.optional(),
});

/**
 * Validated machine operational status payload.
 */
export type StatusPayload = z.infer<typeof statusPayloadSchema>;

const eventDetailValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

/**
 * Schema for `factory/winders/{machineId}/events` diagnostic telemetry payloads.
 */
export const eventPayloadSchema = z.strictObject({
  event_type: z.enum(EVENT_TYPES),
  error_code: errorCodeSchema.nullish(),
  reset_reason: nonEmptyText.optional(),
  rssi: z.number().finite().optional(),
  free_heap: z.number().int().nonnegative().optional(),
  subsystem: nonEmptyText.optional(),
  message: nonEmptyText.optional(),
  details: z.record(z.string(), eventDetailValueSchema).optional(),
  ts: timestampSchema.optional(),
});

/**
 * Validated machine diagnostic event payload.
 */
export type EventPayload = z.infer<typeof eventPayloadSchema>;

/**
 * Schema for `factory/winders/{machineId}/coil` ESP32 internal cycle outcome payloads.
 * Accepts only `AUTO_FINISHED`, `ABORTED`, and `FAULT_TERMINATED` plus optional `wound_length`.
 * CRM/QR outcomes (`COMPLETED`, `FAILED`, `REDO`) are explicitly rejected.
 */
export const coilPayloadSchema = z.strictObject({
  outcome: z.enum(COIL_OUTCOMES),
  reason_code: nonEmptyText.nullish(),
  duration_sec: z.number().int().nonnegative().optional(),
  wound_length: z.number().finite().nonnegative().optional(),
  ts: timestampSchema.optional(),
});

/**
 * Validated coil cycle outcome payload.
 */
export type CoilPayload = z.infer<typeof coilPayloadSchema>;

/**
 * Return true when an event carries a fault `error_code` or has an error-class `event_type`.
 */
export function isErrorEvent(
  eventType: EventType | (string & {}),
  errorCode?: string | null,
): boolean {
  if (errorCode != null && errorCode.trim().length > 0) {
    return true;
  }
  return (ERROR_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Validate UTF-8 payload size (< 1024 bytes), parse JSON, and enforce a Zod contract schema.
 */
export function parseMqttJsonPayload<TSchema extends z.ZodType>(
  rawPayload: string | Buffer,
  schema: TSchema,
): z.infer<TSchema> {
  const byteLength =
    typeof rawPayload === 'string' ? Buffer.byteLength(rawPayload, 'utf8') : rawPayload.byteLength;

  if (byteLength >= MAX_MQTT_PAYLOAD_BYTES) {
    throw new Error(
      `MQTT payload byte length (${byteLength}) must be strictly less than ${MAX_MQTT_PAYLOAD_BYTES} bytes`,
    );
  }

  const jsonText = typeof rawPayload === 'string' ? rawPayload : rawPayload.toString('utf8');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid MQTT JSON payload: ${message}`, { cause: err });
  }

  return schema.parse(parsedJson);
}

/**
 * Parsed components of a valid winder MQTT topic.
 */
export interface ParsedWinderTopic {
  machineId: string;
  channel: MqttChannel;
}

/**
 * Parse a winder MQTT topic matching `factory/winders/{machineId}/{channel}`.
 * Returns `null` when the topic does not conform to the contract.
 */
export function parseWinderTopic(topic: string): ParsedWinderTopic | null {
  const parts = topic.split('/');
  if (parts.length !== 4) {
    return null;
  }

  const [prefix0, prefix1, machineId, channel] = parts;
  if (prefix0 !== TOPIC_PREFIX_PARTS[0] || prefix1 !== TOPIC_PREFIX_PARTS[1]) {
    return null;
  }

  if (!machineId || !MACHINE_ID_REGEX.test(machineId)) {
    return null;
  }

  if (!channel || !(MQTT_CHANNELS as readonly string[]).includes(channel)) {
    return null;
  }

  return {
    machineId,
    channel: channel as MqttChannel,
  };
}

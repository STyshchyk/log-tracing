import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  checkFleetFirmwareUpdates,
  DuplicateFirmwareVersionError,
  FirmwareIntegrityError,
  InvalidFirmwareInputError,
  listFirmwareReleases,
  readFirmwareBinary,
  uploadFirmwareRelease,
} from '../services/firmware.js';
import { MACHINE_STATES } from '../spec/mqtt-contract.js';

interface UploadFirmwareQuerystring {
  version: string;
  filename?: string;
  notes?: string;
  sha256?: string;
}

interface CheckUpdatesQuerystring {
  targetVersion?: string;
}

interface DownloadFirmwareParams {
  version: string;
}

const firmwareReleaseResponseSchema = {
  type: 'object',
  required: [
    'id',
    'version',
    'filename',
    'file_path',
    'sha256',
    'size_bytes',
    'notes',
    'download_url',
    'created_at',
  ],
  properties: {
    id: { type: 'integer' },
    version: { type: 'string' },
    filename: { type: 'string' },
    file_path: { type: 'string' },
    sha256: { type: 'string' },
    size_bytes: { type: 'integer', minimum: 1 },
    notes: { type: 'string', nullable: true },
    download_url: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

const firmwareNotFoundResponseSchema = {
  type: 'object',
  required: ['error', 'version'],
  properties: {
    error: { type: 'string' },
    version: { type: 'string' },
  },
} as const;

const errorMessageSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string' },
  },
} as const;

/**
 * Register authenticated Department Heads Fleet firmware management and update-check endpoints.
 */
export function registerFleetFirmwareApi(
  app: FastifyInstance,
  db: Pool,
  firmwareDir: string,
): void {
  app.post<{ Querystring: UploadFirmwareQuerystring }>(
    '/api/fleet/firmware',
    {
      schema: {
        description:
          'Upload a versioned ESP32 .bin firmware release (application/octet-stream raw body) with SHA-256 verification',
        querystring: {
          type: 'object',
          required: ['version'],
          properties: {
            version: { type: 'string', minLength: 1, maxLength: 64 },
            filename: { type: 'string', maxLength: 128 },
            notes: { type: 'string', maxLength: 2000 },
            sha256: { type: 'string', minLength: 64, maxLength: 64 },
          },
        },
        response: {
          201: firmwareReleaseResponseSchema,
          400: errorMessageSchema,
          409: firmwareNotFoundResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) {
        return reply.status(400).send({
          error: 'Request body must be raw application/octet-stream firmware binary bytes',
        });
      }

      try {
        const release = await uploadFirmwareRelease(db, firmwareDir, {
          version: request.query.version,
          filename: request.query.filename,
          notes: request.query.notes,
          expectedSha256: request.query.sha256,
          binary: request.body,
        });
        return reply.status(201).send(release);
      } catch (err) {
        if (err instanceof InvalidFirmwareInputError) {
          return reply.status(400).send({ error: err.message });
        }
        if (err instanceof DuplicateFirmwareVersionError) {
          return reply.status(409).send({ error: err.message, version: err.version });
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/fleet/firmware',
    {
      schema: {
        description: 'List uploaded ESP32 firmware releases newest-first',
        response: {
          200: {
            type: 'object',
            required: ['total', 'latest_version', 'releases'],
            properties: {
              total: { type: 'integer', minimum: 0 },
              latest_version: { type: 'string', nullable: true },
              releases: {
                type: 'array',
                items: firmwareReleaseResponseSchema,
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const releases = await listFirmwareReleases(db);
      return reply.send({
        total: releases.length,
        latest_version: releases[0]?.version ?? null,
        releases,
      });
    },
  );

  app.get<{ Querystring: CheckUpdatesQuerystring }>(
    '/api/fleet/firmware/check-updates',
    {
      schema: {
        description:
          'Compare all machines reported fw_version against the latest or specified firmware release',
        querystring: {
          type: 'object',
          properties: {
            targetVersion: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: [
              'checked_at',
              'latest_release',
              'target_version',
              'total_machines',
              'up_to_date_count',
              'outdated_count',
              'unknown_version_count',
              'needs_update_count',
              'machines',
            ],
            properties: {
              checked_at: { type: 'string', format: 'date-time' },
              latest_release: { ...firmwareReleaseResponseSchema, nullable: true },
              target_version: { type: 'string', nullable: true },
              total_machines: { type: 'integer', minimum: 0 },
              up_to_date_count: { type: 'integer', minimum: 0 },
              outdated_count: { type: 'integer', minimum: 0 },
              unknown_version_count: { type: 'integer', minimum: 0 },
              needs_update_count: { type: 'integer', minimum: 0 },
              machines: {
                type: 'array',
                items: {
                  type: 'object',
                  required: [
                    'machine_id',
                    'display_name',
                    'zone',
                    'floor_position',
                    'hardware_id',
                    'current_state',
                    'fw_version',
                    'preset_version',
                    'preset_name',
                    'target_version',
                    'update_status',
                    'is_outdated',
                  ],
                  properties: {
                    machine_id: { type: 'string' },
                    display_name: { type: 'string' },
                    zone: { type: 'string' },
                    floor_position: { type: 'integer', nullable: true },
                    hardware_id: { type: 'string', nullable: true },
                    current_state: { type: 'string', enum: [...MACHINE_STATES] },
                    fw_version: { type: 'string', nullable: true },
                    preset_version: { type: 'string', nullable: true },
                    preset_name: { type: 'string', nullable: true },
                    target_version: { type: 'string', nullable: true },
                    update_status: {
                      type: 'string',
                      enum: ['UP_TO_DATE', 'OUTDATED', 'UNKNOWN', 'NO_RELEASE'],
                    },
                    is_outdated: { type: 'boolean' },
                  },
                },
              },
            },
          },
          404: firmwareNotFoundResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await checkFleetFirmwareUpdates(db, request.query.targetVersion);
      if (result === null) {
        return reply.status(404).send({
          error: 'Firmware release not found',
          version: request.query.targetVersion?.trim() ?? '',
        });
      }

      return reply.send(result);
    },
  );
}

/**
 * Register the LAN HTTP firmware `.bin` download endpoint used by ESP32 devices during OTA updates.
 */
export function registerFirmwareDownloadApi(
  app: FastifyInstance,
  db: Pool,
  firmwareDir: string,
): void {
  app.get<{ Params: DownloadFirmwareParams }>(
    '/api/firmware/:version/download',
    {
      schema: {
        description:
          'Download raw .bin firmware binary bytes for an uploaded release version over LAN HTTP',
        params: {
          type: 'object',
          required: ['version'],
          properties: {
            version: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
        response: {
          404: firmwareNotFoundResponseSchema,
          500: firmwareNotFoundResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const version = request.params.version.trim();
      try {
        const result = await readFirmwareBinary(db, firmwareDir, version);
        if (!result) {
          return reply.status(404).send({
            error: 'Firmware release not found',
            version,
          });
        }

        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Length', String(result.binary.byteLength));
        reply.header('Content-Disposition', `attachment; filename="${result.release.filename}"`);
        reply.header('X-Firmware-Version', result.release.version);
        reply.header('X-Firmware-Sha256', result.release.sha256);
        reply.header('ETag', `"${result.release.sha256}"`);
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        return reply.send(result.binary);
      } catch (err) {
        if (err instanceof FirmwareIntegrityError) {
          request.log.error(
            { err, version },
            'Stored firmware binary failed integrity verification',
          );
          return reply.status(500).send({
            error: 'Firmware binary integrity check failed',
            version,
          });
        }
        throw err;
      }
    },
  );
}

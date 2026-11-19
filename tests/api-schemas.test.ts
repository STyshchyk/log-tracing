import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  machineNotFoundResponseSchema,
  sendMachineNotFound,
  telemetryEventResponseSchema,
} from '../src/routes/api-schemas.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('shared API schemas and 404 handling', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('exports machineNotFoundResponseSchema, sendMachineNotFound, and telemetryEventResponseSchema', () => {
    expect(machineNotFoundResponseSchema).toMatchObject({
      type: 'object',
      required: ['error', 'machineId'],
    });
    expect(telemetryEventResponseSchema).toMatchObject({
      type: 'object',
      required: ['time', 'machine_id', 'event_type', 'error_code', 'payload_json'],
    });
    expect(typeof sendMachineNotFound).toBe('function');
  });

  it('documents consistent 404 and telemetry event schemas in OpenAPI /docs/json across all API routes', async () => {
    const specRes = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(specRes.statusCode).toBe(200);

    const spec = specRes.json<{
      paths: Record<
        string,
        Record<
          string,
          {
            responses?: Record<
              string,
              {
                content?: {
                  'application/json'?: {
                    schema?: Record<string, unknown>;
                  };
                };
              }
            >;
          }
        >
      >;
    }>();

    const endpointsWith404: Array<[string, string]> = [
      ['/api/machines/{machineId}', 'get'],
      ['/api/machines/{machineId}/events', 'get'],
      ['/api/machines/{machineId}/bug-reports', 'post'],
      ['/api/machines/{machineId}/bug-reports', 'get'],
      ['/api/machines/{machineId}/coils/rollups', 'get'],
      ['/api/glossary', 'get'],
    ];

    for (const [path, method] of endpointsWith404) {
      const schema404 =
        spec.paths[path]?.[method]?.responses?.['404']?.content?.['application/json']?.schema;
      expect(schema404).toMatchObject({
        type: 'object',
        required: ['error', 'machineId'],
        properties: {
          error: { type: 'string' },
          machineId: { type: 'string' },
        },
      });
    }

    const events200 = spec.paths['/api/machines/{machineId}/events']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema as { properties?: { events?: { items?: Record<string, unknown> } } } | undefined;

    const bugReports201 = spec.paths['/api/machines/{machineId}/bug-reports']?.post?.responses?.[
      '201'
    ]?.content?.['application/json']?.schema as
      | { properties?: { attached_logs_json?: { items?: Record<string, unknown> } } }
      | undefined;

    expect(events200?.properties?.events?.items).toEqual(
      bugReports201?.properties?.attached_logs_json?.items,
    );
  });
});

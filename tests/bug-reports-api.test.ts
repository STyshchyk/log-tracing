import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BUG_REPORT_TAGS,
  BugReportValidationError,
  createBugReport,
  isValidBugReportTag,
  listBugReports,
} from '../src/services/bug-reports.js';
import { BUG_REPORT_TAGS as CONTRACT_BUG_REPORT_TAGS } from '../src/spec/mqtt-contract.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('bug report API and 20-event telemetry snapshot', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    if (createdMachineIds.length > 0) {
      await ctx.db.query('DELETE FROM machines WHERE id = ANY($1)', [
        createdMachineIds.splice(0),
      ]);
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  async function registerMachine(
    overrides: Partial<{
      id: string;
      current_state: 'WORKING' | 'IDLE' | 'ERROR' | 'OFFLINE';
      active_error: string | null;
    }> = {},
  ): Promise<string> {
    const id = overrides.id ?? `T10-${randomUUID().slice(0, 8)}`;
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, active_error)
       VALUES ($1, $2, 'MAIN_BANK', 1, 1, $3, $4)`,
      [
        id,
        `Test Winder ${id}`,
        overrides.current_state ?? 'IDLE',
        overrides.active_error ?? null,
      ],
    );
    return id;
  }

  it('POST /api/machines/:machineId/bug-reports creates a bug report with active_error and exactly the newest 20 telemetry events', async () => {
    const machineId = await registerMachine({
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
    });

    const baseMs = Date.parse('2026-11-19T09:00:00.000Z');
    for (let i = 1; i <= 25; i += 1) {
      await ctx.mqtt.emit(
        `factory/winders/${machineId}/events`,
        JSON.stringify({
          event_type: i === 25 ? 'ERROR' : 'DIAGNOSTIC',
          error_code: i === 25 ? 'ERR_FIBER_SNAP' : null,
          rssi: -60 - (i % 5),
          message: `seq-${String(i).padStart(2, '0')}`,
          ts: new Date(baseMs + i * 1000).toISOString(),
        }),
      );
    }

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/machines/${machineId}/bug-reports`,
      payload: {
        tag: 'Fiber Snap',
        worker_note: '  Strand broke near upper eyelet  ',
      },
    });

    expect(response.statusCode).toBe(201);
    const created = response.json<{
      id: number;
      machine_id: string;
      error_code: string | null;
      tag: string;
      worker_note: string | null;
      photo_path: string | null;
      attached_logs_json: Array<{
        time: string;
        machine_id: string;
        event_type: string;
        error_code: string | null;
        payload_json: {
          message?: string;
          rssi?: number;
          ts?: string | number;
        };
      }>;
      status: string;
      created_at: string;
    }>();

    expect(Number.isInteger(created.id)).toBe(true);
    expect(created.id).toBeGreaterThan(0);
    expect(created.machine_id).toBe(machineId);
    expect(created.error_code).toBe('ERR_FIBER_SNAP');
    expect(created.tag).toBe('Fiber Snap');
    expect(created.worker_note).toBe('Strand broke near upper eyelet');
    expect(created.photo_path).toBeNull();
    expect(created.status).toBe('OPEN');
    expect(Number.isNaN(Date.parse(created.created_at))).toBe(false);

    expect(created.attached_logs_json).toHaveLength(20);
    expect(created.attached_logs_json.map((e) => e.payload_json.message)).toEqual([
      'seq-25',
      'seq-24',
      'seq-23',
      'seq-22',
      'seq-21',
      'seq-20',
      'seq-19',
      'seq-18',
      'seq-17',
      'seq-16',
      'seq-15',
      'seq-14',
      'seq-13',
      'seq-12',
      'seq-11',
      'seq-10',
      'seq-09',
      'seq-08',
      'seq-07',
      'seq-06',
    ]);
    expect(created.attached_logs_json[0]).toEqual({
      time: new Date(baseMs + 25 * 1000).toISOString(),
      machine_id: machineId,
      event_type: 'ERROR',
      error_code: 'ERR_FIBER_SNAP',
      payload_json: {
        rssi: -60,
        message: 'seq-25',
        ts: new Date(baseMs + 25 * 1000).toISOString(),
      },
    });
  });

  it('preserves saved snapshots and error_code across subsequent MQTT events/state changes and lists bug reports newest-first', async () => {
    const machineId = await registerMachine({
      current_state: 'ERROR',
      active_error: 'ERR_TENSION_FAULT',
    });
    const otherMachineId = await registerMachine({
      current_state: 'IDLE',
      active_error: null,
    });

    const baseMs = Date.parse('2026-11-19T10:00:00.000Z');
    for (let i = 1; i <= 22; i += 1) {
      await ctx.mqtt.emit(
        `factory/winders/${machineId}/events`,
        JSON.stringify({
          event_type: 'DIAGNOSTIC',
          message: `ev-${String(i).padStart(2, '0')}`,
          ts: new Date(baseMs + i * 1000).toISOString(),
        }),
      );
    }

    const firstRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/machines/${machineId}/bug-reports`,
      payload: { tag: 'Tension', worker_note: 'First snapshot' },
    });
    expect(firstRes.statusCode).toBe(201);
    const firstReport = firstRes.json<{
      id: number;
      error_code: string | null;
      attached_logs_json: Array<{ payload_json: { message?: string } }>;
    }>();
    expect(firstReport.error_code).toBe('ERR_TENSION_FAULT');
    expect(firstReport.attached_logs_json.map((e) => e.payload_json.message)).toEqual(
      Array.from({ length: 20 }, (_, idx) => `ev-${String(22 - idx).padStart(2, '0')}`),
    );

    // Emit new telemetry events and transition machine back to WORKING (clearing machines.active_error)
    for (let i = 23; i <= 26; i += 1) {
      await ctx.mqtt.emit(
        `factory/winders/${machineId}/events`,
        JSON.stringify({
          event_type: 'INFO',
          message: `ev-${String(i).padStart(2, '0')}`,
          ts: new Date(baseMs + i * 1000).toISOString(),
        }),
      );
    }
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'WORKING' }),
    );
    await ctx.mqtt.emit(
      `factory/winders/${otherMachineId}/events`,
      JSON.stringify({
        event_type: 'ERROR',
        error_code: 'ERR_BOBBIN_JAM',
        message: 'other-machine-event',
        ts: new Date(baseMs + 30 * 1000).toISOString(),
      }),
    );

    const otherReportRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/machines/${otherMachineId}/bug-reports`,
      payload: { tag: 'Bobbin Jam' },
    });
    expect(otherReportRes.statusCode).toBe(201);

    const secondRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/machines/${machineId}/bug-reports`,
      payload: { tag: 'Other', worker_note: 'Second snapshot after recovery' },
    });
    expect(secondRes.statusCode).toBe(201);
    const secondReport = secondRes.json<{ id: number }>();

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${machineId}/bug-reports`,
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json<{
      machine_id: string;
      bug_reports: Array<{
        id: number;
        machine_id: string;
        error_code: string | null;
        tag: string;
        worker_note: string | null;
        photo_path: string | null;
        attached_logs_json: Array<{ payload_json: { message?: string } }>;
        status: string;
        created_at: string;
      }>;
    }>();

    expect(listed.machine_id).toBe(machineId);
    expect(listed.bug_reports).toHaveLength(2);
    expect(listed.bug_reports.map((r) => r.id)).toEqual([secondReport.id, firstReport.id]);

    // First report remains immutable: still has ev-22..ev-03 and ERR_TENSION_FAULT
    const persistedFirst = listed.bug_reports[1]!;
    expect(persistedFirst.error_code).toBe('ERR_TENSION_FAULT');
    expect(persistedFirst.tag).toBe('Tension');
    expect(persistedFirst.worker_note).toBe('First snapshot');
    expect(persistedFirst.attached_logs_json.map((e) => e.payload_json.message)).toEqual(
      Array.from({ length: 20 }, (_, idx) => `ev-${String(22 - idx).padStart(2, '0')}`),
    );

    // Second report captured ev-26..ev-07 and cleared active_error (null)
    const persistedSecond = listed.bug_reports[0]!;
    expect(persistedSecond.error_code).toBeNull();
    expect(persistedSecond.tag).toBe('Other');
    expect(persistedSecond.worker_note).toBe('Second snapshot after recovery');
    expect(persistedSecond.attached_logs_json.map((e) => e.payload_json.message)).toEqual(
      Array.from({ length: 20 }, (_, idx) => `ev-${String(26 - idx).padStart(2, '0')}`),
    );
  });

  it('attaches fewer than 20 events (0 or 3), normalizes omitted/blank/null worker_note to null, and accepts all 5 BUG_REPORT_TAGS', async () => {
    const emptyEventsMachine = await registerMachine({ current_state: 'IDLE', active_error: null });

    const emptyListRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${emptyEventsMachine}/bug-reports`,
    });
    expect(emptyListRes.statusCode).toBe(200);
    expect(emptyListRes.json()).toEqual({
      machine_id: emptyEventsMachine,
      bug_reports: [],
    });

    const zeroEventRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/machines/${emptyEventsMachine}/bug-reports`,
      payload: { tag: 'Unit Dead' },
    });
    expect(zeroEventRes.statusCode).toBe(201);
    const zeroEventBody = zeroEventRes.json<{
      error_code: string | null;
      worker_note: string | null;
      photo_path: string | null;
      attached_logs_json: unknown[];
    }>();
    expect(zeroEventBody.error_code).toBeNull();
    expect(zeroEventBody.worker_note).toBeNull();
    expect(zeroEventBody.photo_path).toBeNull();
    expect(zeroEventBody.attached_logs_json).toEqual([]);

    const partialEventsMachine = await registerMachine({
      current_state: 'ERROR',
      active_error: 'ERR_BOBBIN_JAM',
    });
    const baseMs = Date.parse('2026-11-19T11:00:00.000Z');
    for (let i = 1; i <= 3; i += 1) {
      await ctx.mqtt.emit(
        `factory/winders/${partialEventsMachine}/events`,
        JSON.stringify({
          event_type: 'DIAGNOSTIC',
          message: `partial-${i}`,
          ts: new Date(baseMs + i * 1000).toISOString(),
        }),
      );
    }

    const noteVariants: Array<{
      tag: 'Fiber Snap' | 'Tension' | 'Unit Dead' | 'Bobbin Jam' | 'Other';
      worker_note?: string | null;
    }> = [
      { tag: 'Fiber Snap', worker_note: null },
      { tag: 'Tension', worker_note: '' },
      { tag: 'Unit Dead', worker_note: '   \t\n  ' },
      { tag: 'Bobbin Jam' },
      { tag: 'Other', worker_note: 'Check spool holder' },
    ];

    for (const variant of noteVariants) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/machines/${partialEventsMachine}/bug-reports`,
        payload: variant,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        tag: string;
        worker_note: string | null;
        attached_logs_json: Array<{ payload_json: { message?: string } }>;
      }>();
      expect(body.tag).toBe(variant.tag);
      expect(body.worker_note).toBe(
        variant.tag === 'Other' ? 'Check spool holder' : null,
      );
      expect(body.attached_logs_json.map((e) => e.payload_json.message)).toEqual([
        'partial-3',
        'partial-2',
        'partial-1',
      ]);
    }
  });

  it('distinguishes 400 validation errors (invalid/missing tag, bad payload) from 404 unknown machine across HTTP and service seams', async () => {
    const machineId = await registerMachine();
    const unknownMachineId = `T10-UNKNOWN-${randomUUID().slice(0, 8)}`;

    expect(BUG_REPORT_TAGS).toBe(CONTRACT_BUG_REPORT_TAGS);
    for (const tag of CONTRACT_BUG_REPORT_TAGS) {
      expect(isValidBugReportTag(tag)).toBe(true);
    }
    expect(isValidBugReportTag('Invalid Tag')).toBe(false);
    expect(isValidBugReportTag('fiber snap')).toBe(false);
    expect(isValidBugReportTag('')).toBe(false);
    expect(isValidBugReportTag(null)).toBe(false);

    // Unknown machine with valid tag -> 404
    const unknownPostRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/machines/${unknownMachineId}/bug-reports`,
      payload: { tag: 'Fiber Snap' },
    });
    expect(unknownPostRes.statusCode).toBe(404);
    expect(unknownPostRes.json()).toEqual({
      error: 'Machine not found',
      machineId: unknownMachineId,
    });

    const unknownGetRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${unknownMachineId}/bug-reports`,
    });
    expect(unknownGetRes.statusCode).toBe(404);
    expect(unknownGetRes.json()).toEqual({
      error: 'Machine not found',
      machineId: unknownMachineId,
    });

    const blankGetRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/machines/%20%20/bug-reports',
    });
    expect(blankGetRes.statusCode).toBe(404);

    // Invalid payloads -> 400 (both on registered machine and unknown machine)
    const invalidPayloads: Array<Record<string, unknown>> = [
      {},
      { tag: '' },
      { tag: 'Unknown Tag' },
      { tag: 'fiber snap' },
      { tag: ' Fiber Snap ' },
      { tag: 123 },
      { tag: 'Other', worker_note: 42 },
      { tag: 'Other', unexpected_field: 'nope' },
    ];

    for (const badPayload of invalidPayloads) {
      const badRes = await ctx.app.inject({
        method: 'POST',
        url: `/api/machines/${machineId}/bug-reports`,
        payload: badPayload,
      });
      expect(badRes.statusCode).toBe(400);

      const badUnknownRes = await ctx.app.inject({
        method: 'POST',
        url: `/api/machines/${unknownMachineId}/bug-reports`,
        payload: badPayload,
      });
      expect(badUnknownRes.statusCode).toBe(400);
    }

    // No bug reports were persisted from failed validation attempts
    const afterBadList = await listBugReports(ctx.db, machineId);
    expect(afterBadList).toEqual([]);

    // Direct service contract validation and unknown-machine checks
    await expect(
      createBugReport(ctx.db, { machineId, tag: 'Not A Tag' }),
    ).rejects.toBeInstanceOf(BugReportValidationError);
    await expect(
      createBugReport(ctx.db, {
        machineId,
        tag: 'Other',
        workerNote: 123 as unknown as string,
      }),
    ).rejects.toBeInstanceOf(BugReportValidationError);
    await expect(
      createBugReport(ctx.db, { machineId: unknownMachineId, tag: 'Other' }),
    ).resolves.toBeNull();
    await expect(
      createBugReport(ctx.db, { machineId: '   ', tag: 'Other' }),
    ).resolves.toBeNull();
    await expect(listBugReports(ctx.db, unknownMachineId)).resolves.toBeNull();

    const emptyBodyPostRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/machines/${machineId}/bug-reports`,
    });
    expect(emptyBodyPostRes.statusCode).toBe(400);

    const blankMachinePostRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/machines/%20%20/bug-reports',
      payload: { tag: 'Other' },
    });
    expect(blankMachinePostRes.statusCode).toBe(404);
  });

  it('documents POST and GET /api/machines/{machineId}/bug-reports with schemas and 201/200/400/404 responses in OpenAPI /docs/json', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/docs/json',
    });

    expect(res.statusCode).toBe(200);
    const spec = res.json<{
      paths: Record<
        string,
        {
          post?: {
            parameters?: Array<{ name: string; in: string; required?: boolean }>;
            requestBody?: {
              required?: boolean;
              content?: Record<
                string,
                {
                  schema?: {
                    required?: string[];
                    properties?: {
                      tag?: { enum?: string[] };
                      worker_note?: { type?: string; nullable?: boolean };
                    };
                  };
                }
              >;
            };
            responses?: Record<string, unknown>;
          };
          get?: {
            parameters?: Array<{ name: string; in: string; required?: boolean }>;
            responses?: Record<string, unknown>;
          };
        }
      >;
    }>();

    const pathItem = spec.paths['/api/machines/{machineId}/bug-reports'];
    expect(pathItem).toBeDefined();

    const postOp = pathItem?.post;
    expect(postOp).toBeDefined();
    expect(postOp?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'machineId', in: 'path', required: true }),
      ]),
    );
    expect(postOp?.requestBody?.required).toBe(true);
    const bodySchema = postOp?.requestBody?.content?.['application/json']?.schema;
    expect(bodySchema?.required).toEqual(['tag']);
    expect(bodySchema?.properties?.tag?.enum).toEqual([...CONTRACT_BUG_REPORT_TAGS]);
    expect(bodySchema?.properties?.worker_note).toBeDefined();
    expect(postOp?.responses?.['201']).toBeDefined();
    expect(postOp?.responses?.['400']).toBeDefined();
    expect(postOp?.responses?.['404']).toBeDefined();

    const getOp = pathItem?.get;
    expect(getOp).toBeDefined();
    expect(getOp?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'machineId', in: 'path', required: true }),
      ]),
    );
    expect(getOp?.responses?.['200']).toBeDefined();
    expect(getOp?.responses?.['404']).toBeDefined();
  });
});

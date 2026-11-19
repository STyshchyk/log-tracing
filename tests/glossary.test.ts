import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db/pool.js';
import { seedGlossary } from '../src/db/seed-glossary.js';
import type { FaultEntry } from '../src/spec/fault-registry.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

describe('glossary seeding and search', () => {
  let ctx: TestAppContext;
  const createdErrorCodes: string[] = [];
  const createdMachineIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    if (createdErrorCodes.length > 0) {
      await ctx.db.query('DELETE FROM error_glossary WHERE error_code = ANY($1)', [
        createdErrorCodes.splice(0),
      ]);
    }
    if (createdMachineIds.length > 0) {
      await ctx.db.query('DELETE FROM machines WHERE id = ANY($1)', [
        createdMachineIds.splice(0),
      ]);
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('serializes concurrent ensureSchema calls using a PostgreSQL session advisory lock', async () => {
    const holder = await ctx.db.connect();
    let holdingLock = false;

    try {
      await holder.query('SELECT pg_advisory_lock(7391824)');
      holdingLock = true;

      let schemaDone = false;
      const pendingSchema = ensureSchema(ctx.db).then(() => {
        schemaDone = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(schemaDone).toBe(false);

      await holder.query('SELECT pg_advisory_unlock(7391824)');
      holdingLock = false;

      await pendingSchema;
      expect(schemaDone).toBe(true);
    } finally {
      if (holdingLock) {
        await holder.query('SELECT pg_advisory_unlock(7391824)').catch(() => {});
      }
      holder.release();
    }
  });

  it('seedGlossary inserts new entries idempotently and updates changed fields without touching unchanged timestamps', async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
    const codeA = `TEST_${suffix}_ALPHA`;
    const codeB = `TEST_${suffix}_BETA`;
    const codeC = `TEST_${suffix}_GAMMA`;
    createdErrorCodes.push(codeA, codeB, codeC);

    const initial: FaultEntry[] = [
      {
        error_code: codeC,
        title: 'Gamma Title',
        symptoms: 'Gamma symptoms',
        fix_steps_md: '1. Gamma step.',
      },
      {
        error_code: codeA,
        title: 'Alpha Title',
        symptoms: 'Alpha symptoms',
        fix_steps_md: '1. Alpha step.',
      },
      {
        error_code: codeB,
        title: 'Beta Title',
        symptoms: 'Beta symptoms',
        fix_steps_md: '1. Beta step.',
      },
    ];

    await seedGlossary(ctx.db, initial);

    const afterFirst = await ctx.db.query<{
      error_code: string;
      title: string;
      symptoms: string;
      fix_steps_md: string;
      updated_at: Date;
    }>(
      `SELECT error_code, title, symptoms, fix_steps_md, updated_at
       FROM error_glossary
       WHERE error_code = ANY($1)
       ORDER BY error_code ASC`,
      [[codeA, codeB, codeC]],
    );

    expect(afterFirst.rows).toHaveLength(3);
    expect(afterFirst.rows.map((r) => r.error_code)).toEqual([codeA, codeB, codeC]);

    // Repeat identical seed should not duplicate rows or bump updated_at
    await new Promise((resolve) => setTimeout(resolve, 20));
    await seedGlossary(ctx.db, initial);

    const afterRepeat = await ctx.db.query<{
      error_code: string;
      updated_at: Date;
    }>(
      `SELECT error_code, updated_at
       FROM error_glossary
       WHERE error_code = ANY($1)
       ORDER BY error_code ASC`,
      [[codeA, codeB, codeC]],
    );

    expect(afterRepeat.rows).toHaveLength(3);
    expect(afterRepeat.rows.map((r) => r.updated_at.toISOString())).toEqual(
      afterFirst.rows.map((r) => r.updated_at.toISOString()),
    );

    // Modify title on A, symptoms on B, fix_steps_md on C -> all update; then keep A unchanged while updating B -> A's timestamp stays put
    await new Promise((resolve) => setTimeout(resolve, 20));
    await seedGlossary(ctx.db, [
      {
        error_code: codeA,
        title: 'Alpha Updated Title',
        symptoms: 'Alpha symptoms',
        fix_steps_md: '1. Alpha step.',
      },
      {
        error_code: codeB,
        title: 'Beta Title',
        symptoms: 'Beta updated symptoms',
        fix_steps_md: '1. Beta step.',
      },
      {
        error_code: codeC,
        title: 'Gamma Title',
        symptoms: 'Gamma symptoms',
        fix_steps_md: '1. Gamma updated step.',
      },
    ]);

    const afterUpdate = await ctx.db.query<{
      error_code: string;
      title: string;
      symptoms: string;
      fix_steps_md: string;
      updated_at: Date;
    }>(
      `SELECT error_code, title, symptoms, fix_steps_md, updated_at
       FROM error_glossary
       WHERE error_code = ANY($1)
       ORDER BY error_code ASC`,
      [[codeA, codeB, codeC]],
    );

    expect(afterUpdate.rows[0]?.title).toBe('Alpha Updated Title');
    expect(afterUpdate.rows[1]?.symptoms).toBe('Beta updated symptoms');
    expect(afterUpdate.rows[2]?.fix_steps_md).toBe('1. Gamma updated step.');
    expect(afterUpdate.rows[0]?.updated_at.getTime()).toBeGreaterThan(
      afterFirst.rows[0]!.updated_at.getTime(),
    );

    // Update only B again; A and C timestamps must stay unchanged
    await new Promise((resolve) => setTimeout(resolve, 20));
    await seedGlossary(ctx.db, [
      {
        error_code: codeA,
        title: 'Alpha Updated Title',
        symptoms: 'Alpha symptoms',
        fix_steps_md: '1. Alpha step.',
      },
      {
        error_code: codeB,
        title: 'Beta Second Title',
        symptoms: 'Beta updated symptoms',
        fix_steps_md: '1. Beta step.',
      },
      {
        error_code: codeC,
        title: 'Gamma Title',
        symptoms: 'Gamma symptoms',
        fix_steps_md: '1. Gamma updated step.',
      },
    ]);

    const afterPartial = await ctx.db.query<{
      error_code: string;
      updated_at: Date;
    }>(
      `SELECT error_code, updated_at
       FROM error_glossary
       WHERE error_code = ANY($1)
       ORDER BY error_code ASC`,
      [[codeA, codeB, codeC]],
    );

    expect(afterPartial.rows[0]?.updated_at.toISOString()).toBe(
      afterUpdate.rows[0]?.updated_at.toISOString(),
    );
    expect(afterPartial.rows[1]?.updated_at.getTime()).toBeGreaterThan(
      afterUpdate.rows[1]!.updated_at.getTime(),
    );
    expect(afterPartial.rows[2]?.updated_at.toISOString()).toBe(
      afterUpdate.rows[2]?.updated_at.toISOString(),
    );
  });

  it('seeds canonical fault registry on app startup and serves sorted entries via GET /api/glossary', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/glossary',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      active_error: string | null;
      entries: Array<{
        error_code: string;
        title: string;
        symptoms: string;
        fix_steps_md: string;
        updated_at: string;
        is_active: boolean;
      }>;
    }>();

    expect(body.active_error).toBeNull();
    const canonical = body.entries.filter((entry) => entry.error_code.startsWith('ERR_'));
    expect(canonical.map((entry) => entry.error_code)).toEqual([
      'ERR_BOBBIN_JAM',
      'ERR_BROWNOUT_RESET',
      'ERR_FIBER_SNAP',
      'ERR_SUBSYSTEM_TIMEOUT',
      'ERR_TENSION_FAULT',
      'ERR_WATCHDOG_RESET',
    ]);

    const fiberSnap = canonical.find((entry) => entry.error_code === 'ERR_FIBER_SNAP');
    expect(fiberSnap).toMatchObject({
      error_code: 'ERR_FIBER_SNAP',
      title: 'Fiber Snap Detected',
      is_active: false,
    });
    expect(fiberSnap?.symptoms).toContain('Strand tension dropped to zero');
    expect(fiberSnap?.fix_steps_md).toContain('Press Stop');
    expect(Number.isNaN(Date.parse(fiberSnap?.updated_at ?? ''))).toBe(false);
    expect(canonical.every((entry) => entry.is_active === false)).toBe(true);
  });

  it('GET /api/glossary?q= filters case-insensitively across error_code, title, symptoms, and fix_steps_md', async () => {
    const byCode = await ctx.app.inject({ method: 'GET', url: '/api/glossary?q=err_fiber_snap' });
    expect(byCode.statusCode).toBe(200);
    expect(byCode.json<{ entries: Array<{ error_code: string }> }>().entries.map((e) => e.error_code)).toEqual([
      'ERR_FIBER_SNAP',
    ]);

    const byTitle = await ctx.app.inject({ method: 'GET', url: '/api/glossary?q=brownout' });
    expect(byTitle.statusCode).toBe(200);
    expect(byTitle.json<{ entries: Array<{ error_code: string }> }>().entries.map((e) => e.error_code)).toEqual([
      'ERR_BROWNOUT_RESET',
    ]);

    const bySymptoms = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?q=${encodeURIComponent('debounce window')}`,
    });
    expect(bySymptoms.statusCode).toBe(200);
    expect(
      bySymptoms.json<{ entries: Array<{ error_code: string }> }>().entries.map((e) => e.error_code),
    ).toEqual(['ERR_TENSION_FAULT']);

    const byFixSteps = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?q=${encodeURIComponent('  ceramic eyelets  ')}`,
    });
    expect(byFixSteps.statusCode).toBe(200);
    expect(
      byFixSteps.json<{ entries: Array<{ error_code: string }> }>().entries.map((e) => e.error_code),
    ).toEqual(['ERR_FIBER_SNAP']);

    const blankQuery = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?q=${encodeURIComponent('   ')}`,
    });
    expect(blankQuery.statusCode).toBe(200);
    expect(
      blankQuery
        .json<{ entries: Array<{ error_code: string }> }>()
        .entries.filter((e) => e.error_code.startsWith('ERR_')),
    ).toHaveLength(6);

    const noMatches = await ctx.app.inject({
      method: 'GET',
      url: '/api/glossary?q=NONEXISTENT_GLOSSARY_TERM_XYZ',
    });
    expect(noMatches.statusCode).toBe(200);
    expect(noMatches.json()).toEqual({
      active_error: null,
      entries: [],
    });
  });

  it('escapes %, _, and backslash characters in ILIKE search queries', async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
    const codePct = `TEST_${suffix}_PCT`;
    const codeUnd = `TEST_${suffix}_UND`;
    const codeBsl = `TEST_${suffix}_BSL`;
    const codeCtrl = `TEST_${suffix}_CTRL`;
    createdErrorCodes.push(codePct, codeUnd, codeBsl, codeCtrl);

    await seedGlossary(ctx.db, [
      {
        error_code: codePct,
        title: `Percent Fault ${suffix}`,
        symptoms: `Voltage dropped 50% on rail ${suffix}`,
        fix_steps_md: '1. Check 50% threshold.',
      },
      {
        error_code: codeUnd,
        title: `Underscore Fault ${suffix}`,
        symptoms: `Signal wire_a disconnected ${suffix}`,
        fix_steps_md: '1. Reseat wire_a.',
      },
      {
        error_code: codeBsl,
        title: `Backslash Fault ${suffix}`,
        symptoms: `Log path C:\\logs\\err ${suffix}`,
        fix_steps_md: '1. Inspect C:\\logs.',
      },
      {
        error_code: codeCtrl,
        title: `Control Fault ${suffix}`,
        symptoms: `Voltage dropped 500 on rail wireXa C:logserr ${suffix}`,
        fix_steps_md: '1. Control only.',
      },
    ]);

    const pctRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?q=${encodeURIComponent(`50% on rail ${suffix}`)}`,
    });
    expect(pctRes.statusCode).toBe(200);
    expect(pctRes.json<{ entries: Array<{ error_code: string }> }>().entries.map((e) => e.error_code)).toEqual([
      codePct,
    ]);

    const undRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?q=${encodeURIComponent(`wire_a disconnected ${suffix}`)}`,
    });
    expect(undRes.statusCode).toBe(200);
    expect(undRes.json<{ entries: Array<{ error_code: string }> }>().entries.map((e) => e.error_code)).toEqual([
      codeUnd,
    ]);

    const bslRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?q=${encodeURIComponent(`C:\\logs\\err ${suffix}`)}`,
    });
    expect(bslRes.statusCode).toBe(200);
    expect(bslRes.json<{ entries: Array<{ error_code: string }> }>().entries.map((e) => e.error_code)).toEqual([
      codeBsl,
    ]);
  });

  it('pins the machine active_error first when machineId is provided and returns 404 for unknown machines', async () => {
    const unknownRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?machineId=T08-UNKNOWN-${randomUUID().slice(0, 8)}`,
    });
    expect(unknownRes.statusCode).toBe(404);

    // Empty machineId query parameter behaves as omitted
    const emptyParamRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/glossary?q=&machineId=',
    });
    expect(emptyParamRes.statusCode).toBe(200);
    expect(emptyParamRes.json<{ active_error: string | null }>().active_error).toBeNull();

    const idleMachineId = `T08-IDLE-${randomUUID().slice(0, 8)}`;
    const errorMachineId = `T08-ERR-${randomUUID().slice(0, 8)}`;
    const unlistedMachineId = `T08-UNL-${randomUUID().slice(0, 8)}`;
    createdMachineIds.push(idleMachineId, errorMachineId, unlistedMachineId);

    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, active_error)
       VALUES
         ($1, 'Winder Idle', 'NORTH_LEFT', 1, 1, 'IDLE', NULL),
         ($2, 'Winder Faulted', 'MAIN_BANK', 2, 3, 'ERROR', 'ERR_WATCHDOG_RESET'),
         ($3, 'Winder Unlisted', 'EAST_DOOR', 1, 4, 'ERROR', 'ERR_CUSTOM_UNLISTED')`,
      [idleMachineId, errorMachineId, unlistedMachineId],
    );

    const idleRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?machineId=${idleMachineId}`,
    });
    expect(idleRes.statusCode).toBe(200);
    const idleBody = idleRes.json<{
      active_error: string | null;
      entries: Array<{ error_code: string; is_active: boolean }>;
    }>();
    expect(idleBody.active_error).toBeNull();
    expect(idleBody.entries.every((e) => e.is_active === false)).toBe(true);

    const pinnedRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?machineId=${errorMachineId}`,
    });
    expect(pinnedRes.statusCode).toBe(200);
    const pinnedBody = pinnedRes.json<{
      active_error: string | null;
      entries: Array<{ error_code: string; is_active: boolean }>;
    }>();
    expect(pinnedBody.active_error).toBe('ERR_WATCHDOG_RESET');
    expect(pinnedBody.entries[0]?.error_code).toBe('ERR_WATCHDOG_RESET');
    expect(pinnedBody.entries[0]?.is_active).toBe(true);

    const canonicalRest = pinnedBody.entries
      .slice(1)
      .filter((e) => e.error_code.startsWith('ERR_'));
    expect(canonicalRest.map((e) => e.error_code)).toEqual([
      'ERR_BOBBIN_JAM',
      'ERR_BROWNOUT_RESET',
      'ERR_FIBER_SNAP',
      'ERR_SUBSYSTEM_TIMEOUT',
      'ERR_TENSION_FAULT',
    ]);
    expect(canonicalRest.every((e) => e.is_active === false)).toBe(true);

    // Search filter that excludes the active error still reports top-level active_error
    const filteredOutRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?machineId=${errorMachineId}&q=err_fiber_snap`,
    });
    expect(filteredOutRes.statusCode).toBe(200);
    const filteredOutBody = filteredOutRes.json<{
      active_error: string | null;
      entries: Array<{ error_code: string; is_active: boolean }>;
    }>();
    expect(filteredOutBody.active_error).toBe('ERR_WATCHDOG_RESET');
    expect(filteredOutBody.entries.map((e) => e.error_code)).toEqual(['ERR_FIBER_SNAP']);
    expect(filteredOutBody.entries[0]?.is_active).toBe(false);

    // Search filter matching the active error still marks it active
    const filteredInRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?machineId=${errorMachineId}&q=watchdog`,
    });
    expect(filteredInRes.statusCode).toBe(200);
    const filteredInBody = filteredInRes.json<{
      active_error: string | null;
      entries: Array<{ error_code: string; is_active: boolean }>;
    }>();
    expect(filteredInBody.active_error).toBe('ERR_WATCHDOG_RESET');
    expect(filteredInBody.entries.map((e) => e.error_code)).toEqual(['ERR_WATCHDOG_RESET']);
    expect(filteredInBody.entries[0]?.is_active).toBe(true);

    // Unlisted active_error is preserved at top level with no entry marked active
    const unlistedRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/glossary?machineId=${unlistedMachineId}`,
    });
    expect(unlistedRes.statusCode).toBe(200);
    const unlistedBody = unlistedRes.json<{
      active_error: string | null;
      entries: Array<{ error_code: string; is_active: boolean }>;
    }>();
    expect(unlistedBody.active_error).toBe('ERR_CUSTOM_UNLISTED');
    expect(unlistedBody.entries.every((e) => e.is_active === false)).toBe(true);
  });

  it('documents GET /api/glossary with query parameters and 200/404 responses in OpenAPI /docs/json', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/docs/json',
    });

    expect(res.statusCode).toBe(200);
    const spec = res.json<{
      paths: Record<
        string,
        {
          get?: {
            parameters?: Array<{ name: string; in: string; required?: boolean }>;
            responses?: Record<string, unknown>;
          };
        }
      >;
    }>();

    const op = spec.paths['/api/glossary']?.get;
    expect(op).toBeDefined();
    expect(op?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'q', in: 'query', required: false }),
        expect.objectContaining({ name: 'machineId', in: 'query', required: false }),
      ]),
    );
    expect(op?.responses?.['200']).toBeDefined();
    expect(op?.responses?.['404']).toBeDefined();
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seedGlossary } from '../src/db/seed-glossary.js';
import { renderMarkdownToHtml } from '../src/ui/markdown.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T09-${label}-${randomUUID().slice(0, 8)}`;
}

describe('safe markdown renderer for fix_steps_md', () => {
  it('converts numbered lists, bulleted lists, paragraphs, and inline code into semantic HTML while escaping all raw HTML and XSS payloads', () => {
    expect(renderMarkdownToHtml('')).toBe('');
    expect(renderMarkdownToHtml('   \n\t  ')).toBe('');

    const numbered = renderMarkdownToHtml(
      '1. Press Stop on the touchscreen.\n2. Inspect `esp_reset_reason()` and press `Start`.',
    );
    expect(numbered).toBe(
      '<ol><li>Press Stop on the touchscreen.</li><li>Inspect <code>esp_reset_reason()</code> and press <code>Start</code>.</li></ol>',
    );

    const mixed = renderMarkdownToHtml(
      [
        'Check power supply <script>alert(1)</script> & "breaker".',
        '',
        '- Verify `24V` rail & <img src=x onerror=alert(2)>',
        '* Check `<svg onload="alert(3)">` connector',
        '',
        '1. Wait 10 seconds before restarting.',
        '2. Keep unmatched `backtick literal & safe.',
      ].join('\n'),
    );

    expect(mixed).not.toContain('<script>');
    expect(mixed).not.toContain('<img');
    expect(mixed).not.toContain('<svg');
    expect(mixed).toContain(
      '<p>Check power supply &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;breaker&quot;.</p>',
    );
    expect(mixed).toContain(
      '<ul><li>Verify <code>24V</code> rail &amp; &lt;img src=x onerror=alert(2)&gt;</li><li>Check <code>&lt;svg onload=&quot;alert(3)&quot;&gt;</code> connector</li></ul>',
    );
    expect(mixed).toContain(
      '<ol><li>Wait 10 seconds before restarting.</li><li>Keep unmatched `backtick literal &amp; safe.</li></ol>',
    );
  });
});

describe('worker portal glossary route GET /m/:machineId/glossary', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];
  const createdErrorCodes: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    if (createdMachineIds.length > 0) {
      await ctx.db.query('DELETE FROM machines WHERE id = ANY($1)', [
        createdMachineIds.splice(0),
      ]);
    }
    if (createdErrorCodes.length > 0) {
      await ctx.db.query('DELETE FROM error_glossary WHERE error_code = ANY($1)', [
        createdErrorCodes.splice(0),
      ]);
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  async function registerMachine(
    id: string,
    overrides: Partial<{
      display_name: string;
      zone: 'NORTH_LEFT' | 'NORTH_RIGHT' | 'MAIN_BANK' | 'EAST_DOOR';
      grid_row: number;
      grid_col: number;
      current_state: 'WORKING' | 'IDLE' | 'ERROR' | 'OFFLINE';
      active_error: string | null;
      last_seen_at: string | null;
    }> = {},
  ): Promise<void> {
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, active_error, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        overrides.display_name ?? `Winder ${id}`,
        overrides.zone ?? 'NORTH_LEFT',
        overrides.grid_row ?? 1,
        overrides.grid_col ?? 1,
        overrides.current_state ?? 'IDLE',
        overrides.active_error ?? null,
        overrides.last_seen_at ?? null,
      ],
    );
  }

  it('returns worker-friendly 404 recovery HTML when machine does not exist and escapes XSS in machineId', async () => {
    const missingId = makeMachineId('MISSING');
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/m/${missingId}/glossary`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
    expect(res.body).toContain('Machine Not Found');
    expect(res.body).toContain(missingId);
    expect(res.body).toContain('href="/"');

    const xssRes = await ctx.app.inject({
      method: 'GET',
      url: '/m/%3Cscript%3Ealert(1)%3C%2Fscript%3E/glossary',
    });
    expect(xssRes.statusCode).toBe(404);
    expect(xssRes.body).not.toContain('<script>alert(1)</script>');
    expect(xssRes.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('serves Glossary / FAQ HTML with Back to Machine link, no-active-error notice, and alphabetically sorted canonical entries', async () => {
    const machineId = makeMachineId('NOERR');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder 01',
      current_state: 'WORKING',
      active_error: null,
    });

    const landingRes = await ctx.app.inject({ method: 'GET', url: `/m/${machineId}` });
    expect(landingRes.statusCode).toBe(200);
    expect(landingRes.body).toContain(`href="/m/${encodeURIComponent(machineId)}/glossary"`);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);

    const html = res.body;
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).toContain(`href="/m/${encodeURIComponent(machineId)}"`);
    expect(html).toContain('Back to Machine');
    expect(html).toContain('Pilot Winder 01');
    expect(html).not.toContain('data-pinned="true"');
    expect(html).toMatch(/no active error/i);

    // Canonical entries appear in alphabetical order with rendered fix steps
    const expectedOrder = [
      'ERR_BOBBIN_JAM',
      'ERR_BROWNOUT_RESET',
      'ERR_FIBER_SNAP',
      'ERR_SUBSYSTEM_TIMEOUT',
      'ERR_TENSION_FAULT',
      'ERR_WATCHDOG_RESET',
    ];
    let prevIndex = -1;
    for (const code of expectedOrder) {
      const idx = html.indexOf(code);
      expect(idx).toBeGreaterThan(prevIndex);
      prevIndex = idx;
    }
    expect(html).toContain('<ol><li>Press Stop on the touchscreen');
  });

  it('pins the machine active_error at the top via MQTT ERROR/OFFLINE/WORKING transitions and notes unlisted active errors', async () => {
    const machineId = makeMachineId('PIN');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder 02',
      current_state: 'IDLE',
      active_error: null,
    });

    // Publish ERROR status with ERR_WATCHDOG_RESET via MQTT adapter
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: 'ERR_WATCHDOG_RESET' }),
    );

    const pinnedRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary`,
    });
    expect(pinnedRes.statusCode).toBe(200);
    const pinnedHtml = pinnedRes.body;

    expect(pinnedHtml).toContain('data-pinned="true"');
    expect(pinnedHtml).toContain('Active Error');
    expect(pinnedHtml).toContain('ERR_WATCHDOG_RESET');
    expect(pinnedHtml).toContain('Controller Watchdog Reset');
    expect(pinnedHtml).toContain('hardware task watchdog timer');
    expect(pinnedHtml).toContain('<ol><li>Wait 15 seconds for the controller and touchscreen');

    // Pinned card appears at the very top, before all other glossary entries, and is not duplicated
    const pinnedAttrIdx = pinnedHtml.indexOf('data-pinned="true"');
    const watchdogIdx = pinnedHtml.indexOf('ERR_WATCHDOG_RESET');
    const bobbinIdx = pinnedHtml.indexOf('ERR_BOBBIN_JAM');
    expect(pinnedAttrIdx).toBeGreaterThan(-1);
    expect(watchdogIdx).toBeGreaterThan(pinnedAttrIdx);
    expect(bobbinIdx).toBeGreaterThan(watchdogIdx);
    expect(pinnedHtml.match(/ERR_WATCHDOG_RESET/g)).toHaveLength(1);

    // Remaining canonical entries appear in alphabetical order below
    const restOrder = [
      'ERR_BOBBIN_JAM',
      'ERR_BROWNOUT_RESET',
      'ERR_FIBER_SNAP',
      'ERR_SUBSYSTEM_TIMEOUT',
      'ERR_TENSION_FAULT',
    ];
    let prevIdx = watchdogIdx;
    for (const code of restOrder) {
      const idx = pinnedHtml.indexOf(code);
      expect(idx).toBeGreaterThan(prevIdx);
      prevIdx = idx;
    }

    // LWT OFFLINE preserves active_error pinning
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'OFFLINE' }));
    const offlineRes = await ctx.app.inject({ method: 'GET', url: `/m/${machineId}/glossary` });
    expect(offlineRes.statusCode).toBe(200);
    expect(offlineRes.body).toContain('data-pinned="true"');
    expect(offlineRes.body).toContain('ERR_WATCHDOG_RESET');

    // Transition to WORKING clears active_error and unpins
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'WORKING' }));
    const clearedRes = await ctx.app.inject({ method: 'GET', url: `/m/${machineId}/glossary` });
    expect(clearedRes.statusCode).toBe(200);
    expect(clearedRes.body).not.toContain('data-pinned="true"');
    expect(clearedRes.body).toMatch(/no active error/i);

    // Active error code not present in error_glossary shows a clear helpful note
    const unlistedCode = 'ERR_T09_UNLISTED_CUSTOM';
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: unlistedCode }),
    );
    const unlistedRes = await ctx.app.inject({ method: 'GET', url: `/m/${machineId}/glossary` });
    expect(unlistedRes.statusCode).toBe(200);
    expect(unlistedRes.body).not.toContain('data-pinned="true"');
    expect(unlistedRes.body).toContain(unlistedCode);
    expect(unlistedRes.body).toMatch(/not listed in the fault glossary|no glossary entry/i);
    expect(unlistedRes.body).toContain(`href="/m/${encodeURIComponent(machineId)}/report-bug"`);
  });

  it('provides an accessible <search><form> bar, filters by keyword or error_code, handles active_error during search, and renders empty-state feedback', async () => {
    const machineId = makeMachineId('SEARCH');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder 03',
      current_state: 'IDLE',
      active_error: null,
    });
    const encodedId = encodeURIComponent(machineId);

    // Unfiltered search form checks
    const initialRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary`,
    });
    expect(initialRes.statusCode).toBe(200);
    const initialHtml = initialRes.body;
    expect(initialHtml).toContain('<search');
    expect(initialHtml).toContain(`<form`);
    expect(initialHtml).toContain(`method="GET"`);
    expect(initialHtml).toContain(`action="/m/${encodedId}/glossary"`);
    expect(initialHtml).toContain('<label');
    expect(initialHtml).toContain('for="glossary-q"');
    expect(initialHtml).toContain('type="search"');
    expect(initialHtml).toContain('id="glossary-q"');
    expect(initialHtml).toContain('name="q"');
    expect(initialHtml).toContain('autocorrect="off"');
    expect(initialHtml).toContain('autocapitalize="none"');
    expect(initialHtml).toContain('spellcheck="false"');
    expect(initialHtml).toContain('enterkeyhint="search"');
    expect(initialHtml).toContain('<button');
    expect(initialHtml).toContain('type="submit"');
    expect(initialHtml).toContain('>Search</button>');
    expect(initialHtml).not.toContain('>Clear</a>');

    // Keyword filter matches ERR_BROWNOUT_RESET and preserves query + Clear link
    const keywordRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary?q=brownout`,
    });
    expect(keywordRes.statusCode).toBe(200);
    expect(keywordRes.body).toContain('value="brownout"');
    expect(keywordRes.body).toContain(`href="/m/${encodedId}/glossary">Clear</a>`);
    expect(keywordRes.body).toContain('ERR_BROWNOUT_RESET');
    expect(keywordRes.body).not.toContain('ERR_FIBER_SNAP');
    expect(keywordRes.body).not.toContain('ERR_BOBBIN_JAM');

    // Error-code case-insensitive filter
    const codeRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary?q=err_fiber_snap`,
    });
    expect(codeRes.statusCode).toBe(200);
    expect(codeRes.body).toContain('ERR_FIBER_SNAP');
    expect(codeRes.body).not.toContain('ERR_BROWNOUT_RESET');

    // No matches displays clear empty-state feedback with escaped query and reset link
    const emptyRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary?q=NONEXISTENT_XYZ_999`,
    });
    expect(emptyRes.statusCode).toBe(200);
    expect(emptyRes.body).toContain('NONEXISTENT_XYZ_999');
    expect(emptyRes.body).toMatch(/no (glossary entries|faults|matches)/i);
    expect(emptyRes.body).toContain(`href="/m/${encodedId}/glossary"`);

    // Active error interaction with search
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: 'ERR_WATCHDOG_RESET' }),
    );

    // Search matching active error still pins it at top and does not show "no matches"
    const matchActiveRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary?q=watchdog`,
    });
    expect(matchActiveRes.statusCode).toBe(200);
    expect(matchActiveRes.body).toContain('data-pinned="true"');
    expect(matchActiveRes.body).toContain('ERR_WATCHDOG_RESET');
    expect(matchActiveRes.body).not.toMatch(/no (glossary entries|faults|matches)/i);

    // Search excluding active error shows matching entry and notes active error is filtered out (NOT "not listed in glossary")
    const excludeActiveRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary?q=brownout`,
    });
    expect(excludeActiveRes.statusCode).toBe(200);
    expect(excludeActiveRes.body).not.toContain('data-pinned="true"');
    expect(excludeActiveRes.body).toContain('ERR_BROWNOUT_RESET');
    expect(excludeActiveRes.body).toContain('ERR_WATCHDOG_RESET');
    expect(excludeActiveRes.body).not.toMatch(/not listed in the fault glossary/i);
    expect(excludeActiveRes.body).toMatch(/filtered|hidden by/i);
  });

  it('escapes XSS payloads in error_code, title, symptoms, fix_steps_md, q, and display_name while meeting mobile web guidance constraints', async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
    const xssErrorCode = `TEST_T09_XSS_${suffix}_<img src=x>`;
    createdErrorCodes.push(xssErrorCode);

    await seedGlossary(ctx.db, [
      {
        error_code: xssErrorCode,
        title: `Fault <script>alert("t")</script> & "Relay"`,
        symptoms: `Sensor read <svg onload=alert(1)> & 'quote'`,
        fix_steps_md: [
          '1. Reset `<script>bad()</script>` relay.',
          '- Inspect <img src=x onerror=alert(2)> cable.',
        ].join('\n'),
      },
    ]);

    const machineId = makeMachineId('XSS');
    await registerMachine(machineId, {
      display_name: 'Winder <b onclick=alert(1)>Alpha</b> & "One"',
      current_state: 'ERROR',
      active_error: xssErrorCode,
    });

    const xssQuery = `"><script>alert(9)</script>&'test'`;
    const xssSearchRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary?q=${encodeURIComponent(xssQuery)}`,
    });
    expect(xssSearchRes.statusCode).toBe(200);
    expect(xssSearchRes.body).not.toContain('<script>');
    expect(xssSearchRes.body).not.toContain('<img');
    expect(xssSearchRes.body).not.toContain('<svg');
    expect(xssSearchRes.body).not.toContain('<b onclick');
    expect(xssSearchRes.body).toContain(
      'value="&quot;&gt;&lt;script&gt;alert(9)&lt;/script&gt;&amp;&#39;test&#39;"',
    );
    expect(xssSearchRes.body).toContain(
      'TEST_T09_XSS_' + suffix + '_&lt;img src=x&gt;',
    );
    expect(xssSearchRes.body).toContain(
      'Winder &lt;b onclick=alert(1)&gt;Alpha&lt;/b&gt; &amp; &quot;One&quot;',
    );

    // Pinned XSS glossary entry also renders safely when unfiltered
    const pinnedXssRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary`,
    });
    expect(pinnedXssRes.statusCode).toBe(200);
    const html = pinnedXssRes.body;
    expect(html).toContain('data-pinned="true"');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).toContain('Fault &lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt; &amp; &quot;Relay&quot;');
    expect(html).toContain('Sensor read &lt;svg onload=alert(1)&gt; &amp; &#39;quote&#39;');
    expect(html).toContain('<code>&lt;script&gt;bad()&lt;/script&gt;</code>');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');

    // Mobile web guidance & landmark/heading invariants
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    );
    expect(html).toContain('env(safe-area-inset-top');
    expect(html).toContain('env(safe-area-inset-bottom');
    expect(html).toContain('overflow-wrap: break-word');
    expect(html).toContain('overflow-wrap: anywhere');
    expect(html).toContain('--target-min: 48px');
    expect(html).toContain('@media (pointer: coarse)');
    expect(html).toContain('--target-min: 52px');
    expect(html).toContain(':focus-visible');
    expect(html).toContain('@media (forced-colors: active)');
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h4\b/i);
    expect(html).not.toMatch(/https?:\/\//i);

    // Blank whitespace query behaves as unfiltered
    const blankRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary?q=%20%20%20`,
    });
    expect(blankRes.statusCode).toBe(200);
    expect(blankRes.body).not.toContain('>Clear</a>');
    expect(blankRes.body).toContain('value=""');

    // Repeated q parameter does not crash
    const multiQueryRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/glossary?q=fiber&q=brownout`,
    });
    expect(multiQueryRes.statusCode).toBe(200);
    expect(multiQueryRes.body).toContain('ERR_FIBER_SNAP');

    // Whitespace-only machineId yields 404 recovery page
    const whitespaceIdRes = await ctx.app.inject({
      method: 'GET',
      url: '/m/%20%20%20/glossary',
    });
    expect(whitespaceIdRes.statusCode).toBe(404);
    expect(whitespaceIdRes.body).toContain('Machine Not Found');

    // HTML glossary route stays hidden from OpenAPI docs
    const docsRes = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(docsRes.statusCode).toBe(200);
    const docs = docsRes.json<{ paths: Record<string, unknown> }>();
    expect(docs.paths['/m/{machineId}/glossary']).toBeUndefined();
  });
});

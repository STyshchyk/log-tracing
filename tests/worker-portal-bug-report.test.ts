import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BUG_REPORT_TAGS } from '../src/spec/mqtt-contract.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T11-${label}-${randomUUID().slice(0, 8)}`;
}

describe('worker portal report-a-bug form and confirmation UI', () => {
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
        overrides.zone ?? 'MAIN_BANK',
        overrides.grid_row ?? 1,
        overrides.grid_col ?? 1,
        overrides.current_state ?? 'IDLE',
        overrides.active_error ?? null,
        overrides.last_seen_at ?? null,
      ],
    );
  }

  it('GET /m/:machineId/report-bug renders mobile-first form with 5 radio quick-tag cards, plain textarea, and unknown-machine 404 handling', async () => {
    const machineId = makeMachineId('GET');
    await registerMachine(machineId, {
      display_name: 'Pilot <Winder> & "11"',
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}/report-bug`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);

    const html = res.body;
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);

    // Back link and machine identity (escaped)
    const encodedId = encodeURIComponent(machineId);
    expect(html).toContain(`href="/m/${encodedId}"`);
    expect(html).toContain('Pilot &lt;Winder&gt; &amp; &quot;11&quot;');
    expect(html).not.toContain('Pilot <Winder>');
    expect(html).toContain(machineId);
    expect(html).toContain('status-error');
    expect(html).toContain('ERROR');
    expect(html).toContain('ERR_FIBER_SNAP');

    // Form structure, fieldset + legend, 5 radio quick tags (no <select>)
    expect(html).toMatch(
      new RegExp(`<form[^>]*method="POST"[^>]*action="/m/${encodedId}/report-bug"`, 'i'),
    );
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend>What happened? (Required)</legend>');
    expect(html).not.toMatch(/<select\b/i);

    for (const tag of BUG_REPORT_TAGS) {
      expect(html).toMatch(
        new RegExp(
          `<label[^>]*>[\\s\\S]*?<input[^>]*type="radio"[^>]*name="tag"[^>]*value="${tag}"[^>]*required[\\s\\S]*?${tag}[\\s\\S]*?</label>`,
        ),
      );
    }

    // Plain textarea with visible label, zero speech API / file input / external CDNs
    expect(html).toContain('<label for="worker-note">Optional note</label>');
    expect(html).toMatch(/<textarea[^>]*id="worker-note"[^>]*name="worker_note"/);
    expect(html).not.toMatch(/SpeechRecognition/i);
    expect(html).not.toMatch(/<input[^>]*type="file"/i);
    expect(html).not.toMatch(/https?:\/\//i);

    // Enabled submit button on initial load
    const submitMatch = html.match(/<button\b[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/i);
    expect(submitMatch).not.toBeNull();
    expect(submitMatch?.[0]).not.toMatch(/\bdisabled\b/i);
    expect(submitMatch?.[0]).toContain('Submit Bug Report');

    // Modern web guidance CSS checks (:user-invalid, never raw :invalid)
    expect(html).toContain(':user-invalid');
    expect(html).not.toMatch(/(?<!:user):invalid\b/);
    expect(html).toContain('--target-min: 48px');
    expect(html).toContain('@media (pointer: coarse)');
    expect(html).toContain('--target-min: 52px');
    expect(html).toContain(':focus-visible');
    expect(html).toContain('@media (forced-colors: active)');

    // Unknown machine IDs -> 404 recovery page with XSS escaping
    const unknownId = makeMachineId('MISSING');
    const missingRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${unknownId}/report-bug`,
    });
    expect(missingRes.statusCode).toBe(404);
    expect(missingRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
    expect(missingRes.body).toContain('Machine Not Found');
    expect(missingRes.body).toContain(unknownId);
    expect(missingRes.body).toContain('href="/"');

    const xssRes = await ctx.app.inject({
      method: 'GET',
      url: '/m/%3Cscript%3Ealert(1)%3C%2Fscript%3E/report-bug',
    });
    expect(xssRes.statusCode).toBe(404);
    expect(xssRes.body).not.toContain('<script>alert(1)</script>');
    expect(xssRes.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('POST /m/:machineId/report-bug persists urlencoded and JSON submissions with 20-event snapshot and renders 201 confirmation or 404 unknown machine', async () => {
    const machineId = makeMachineId('POST');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder Post',
      current_state: 'IDLE',
      active_error: null,
    });

    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: 'ERR_TENSION_FAULT' }),
    );

    const baseMs = Date.parse('2026-11-19T12:00:00.000Z');
    for (let i = 1; i <= 25; i += 1) {
      await ctx.mqtt.emit(
        `factory/winders/${machineId}/events`,
        JSON.stringify({
          event_type: i === 25 ? 'ERROR' : 'DIAGNOSTIC',
          error_code: i === 25 ? 'ERR_TENSION_FAULT' : null,
          message: `ev-${String(i).padStart(2, '0')}`,
          ts: new Date(baseMs + i * 1000).toISOString(),
        }),
      );
    }

    const encodedId = encodeURIComponent(machineId);
    const formPayload = new URLSearchParams({
      tag: 'Tension',
      worker_note: '  Upper guide <jammed> & loose  ',
    }).toString();

    const postRes = await ctx.app.inject({
      method: 'POST',
      url: `/m/${encodedId}/report-bug`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: formPayload,
    });

    expect(postRes.statusCode).toBe(201);
    expect(postRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${encodedId}/bug-reports`,
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json<{
      bug_reports: Array<{
        id: number;
        tag: string;
        error_code: string | null;
        worker_note: string | null;
        attached_logs_json: Array<{ payload_json: { message?: string } }>;
      }>;
    }>();

    expect(listed.bug_reports).toHaveLength(1);
    const saved = listed.bug_reports[0]!;
    expect(saved.tag).toBe('Tension');
    expect(saved.error_code).toBe('ERR_TENSION_FAULT');
    expect(saved.worker_note).toBe('Upper guide <jammed> & loose');
    expect(saved.attached_logs_json).toHaveLength(20);
    expect(saved.attached_logs_json[0]?.payload_json.message).toBe('ev-25');
    expect(saved.attached_logs_json[19]?.payload_json.message).toBe('ev-06');

    const html = postRes.body;
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`#${saved.id}`);
    expect(html).toContain('Tension');
    expect(html).toContain('ERR_TENSION_FAULT');
    expect(html).toContain('20');
    expect(html).toContain('Upper guide &lt;jammed&gt; &amp; loose');
    expect(html).not.toContain('Upper guide <jammed>');
    expect(html).toContain(`href="/m/${encodedId}"`);

    // Submission without note (whitespace only) with charset=utf-8 header
    const noNoteRes = await ctx.app.inject({
      method: 'POST',
      url: `/m/${encodedId}/report-bug`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      payload: new URLSearchParams({
        tag: 'Fiber Snap',
        worker_note: '   ',
      }).toString(),
    });
    expect(noNoteRes.statusCode).toBe(201);
    expect(noNoteRes.body).toContain('Fiber Snap');
    expect(noNoteRes.body).not.toContain('>null<');

    // JSON body also works cleanly
    const jsonRes = await ctx.app.inject({
      method: 'POST',
      url: `/m/${encodedId}/report-bug`,
      payload: {
        tag: 'Unit Dead',
        worker_note: 'No LEDs lit',
      },
    });
    expect(jsonRes.statusCode).toBe(201);
    expect(jsonRes.body).toContain('Unit Dead');
    expect(jsonRes.body).toContain('No LEDs lit');

    // Unknown machine POST -> 404 HTML
    const unknownId = makeMachineId('UNKNOWN');
    const unknownPostRes = await ctx.app.inject({
      method: 'POST',
      url: `/m/${unknownId}/report-bug`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams({ tag: 'Other' }).toString(),
    });
    expect(unknownPostRes.statusCode).toBe(404);
    expect(unknownPostRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
    expect(unknownPostRes.body).toContain('Machine Not Found');
    expect(unknownPostRes.body).toContain(unknownId);
    expect(unknownPostRes.body).toContain('href="/"');
  });

  it('POST /m/:machineId/report-bug returns 400 with inline role="alert" validation error and preserves escaped worker_note when tag is missing or invalid', async () => {
    const machineId = makeMachineId('VAL400');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder Validation',
      current_state: 'ERROR',
      active_error: 'ERR_BOBBIN_JAM',
    });

    const encodedId = encodeURIComponent(machineId);

    // 1. Missing tag with note typed
    const missingTagRes = await ctx.app.inject({
      method: 'POST',
      url: `/m/${encodedId}/report-bug`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams({
        worker_note: 'Spool shuddered before stopping',
      }).toString(),
    });

    expect(missingTagRes.statusCode).toBe(400);
    expect(missingTagRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
    expect(missingTagRes.body).toContain('aria-invalid="true"');
    expect(missingTagRes.body).toContain('role="alert"');
    expect(missingTagRes.body).not.toMatch(/<p[^>]*id="tag-error"[^>]*\bhidden\b/i);
    expect(missingTagRes.body).toContain('Please choose what happened before submitting.');
    expect(missingTagRes.body).toMatch(
      /<textarea[^>]*id="worker-note"[^>]*>Spool shuddered before stopping<\/textarea>/,
    );

    // 2. Invalid tag with XSS payload inside worker_note
    const invalidTagRes = await ctx.app.inject({
      method: 'POST',
      url: `/m/${encodedId}/report-bug`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams({
        tag: 'Not A Tag',
        worker_note: '</textarea><script>alert(1)</script> & "test"',
      }).toString(),
    });

    expect(invalidTagRes.statusCode).toBe(400);
    expect(invalidTagRes.body).toContain('aria-invalid="true"');
    expect(invalidTagRes.body).toContain('role="alert"');
    expect(invalidTagRes.body).not.toContain('</textarea><script>alert(1)</script>');
    expect(invalidTagRes.body).toContain(
      '&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;test&quot;',
    );

    // 3. Empty body POST & invalid JSON worker_note type -> 400
    const emptyRes = await ctx.app.inject({
      method: 'POST',
      url: `/m/${encodedId}/report-bug`,
    });
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.body).toContain('role="alert"');

    const badNoteTypeRes = await ctx.app.inject({
      method: 'POST',
      url: `/m/${encodedId}/report-bug`,
      payload: { tag: 'Other', worker_note: 42 },
    });
    expect(badNoteTypeRes.statusCode).toBe(400);

    // Zero bug reports persisted from invalid submissions
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${encodedId}/bug-reports`,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json<{ bug_reports: unknown[] }>().bug_reports).toHaveLength(0);
  });

  it('includes valid lightweight progressive-enhancement script for post-validation double-tap guard and round-trips all 5 tags from landing page to confirmation', async () => {
    const machineId = makeMachineId('FLOW');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder Flow',
      current_state: 'WORKING',
      active_error: null,
    });
    const encodedId = encodeURIComponent(machineId);

    // 1. Start at machine landing screen and follow Report a Bug link
    const landingRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${encodedId}`,
    });
    expect(landingRes.statusCode).toBe(200);
    expect(landingRes.body).toContain(`href="/m/${encodedId}/report-bug"`);

    // 2. Load Report a Bug form and verify inline progressive-enhancement script
    const formRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${encodedId}/report-bug`,
    });
    expect(formRes.statusCode).toBe(200);

    const scriptMatch = formRes.body.match(/<script>([\s\S]*?)<\/script>/i);
    expect(scriptMatch).not.toBeNull();
    const scriptBody = scriptMatch![1]!;

    // Syntax check: must compile cleanly in Node
    expect(() => new Function(scriptBody)).not.toThrow();

    expect(scriptBody).toContain("form.dataset.submitted === 'true'");
    expect(scriptBody).toContain('form.checkValidity()');
    expect(scriptBody).toContain('submitButton.disabled = true');
    expect(scriptBody).toContain('Submitting...');
    expect(scriptBody).toContain('aria-invalid');
    expect(scriptBody).toContain("'change'");
    expect(scriptBody).toContain("'invalid'");
    expect(scriptBody).toContain("'submit'");
    expect(scriptBody).toContain("'pageshow'");
    expect(scriptBody).not.toMatch(/SpeechRecognition|fetch\(|XMLHttpRequest|https?:\/\//i);

    // 3. Submit each of the 5 canonical quick tags end-to-end and verify confirmation & return link
    for (const tag of BUG_REPORT_TAGS) {
      const submitRes = await ctx.app.inject({
        method: 'POST',
        url: `/m/${encodedId}/report-bug`,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: new URLSearchParams({ tag }).toString(),
      });

      expect(submitRes.statusCode).toBe(201);
      expect(submitRes.body).toContain('Bug Report Submitted');
      expect(submitRes.body).toContain(tag);
      expect(submitRes.body).toContain('0 events');
      expect(submitRes.body).toContain(`href="/m/${encodedId}"`);
      expect(submitRes.body).not.toMatch(/<script\b/i);
    }

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/machines/${encodedId}/bug-reports`,
    });
    expect(listRes.statusCode).toBe(200);
    const reports = listRes.json<{ bug_reports: Array<{ tag: string }> }>().bug_reports;
    expect(reports).toHaveLength(BUG_REPORT_TAGS.length);
    expect(new Set(reports.map((r) => r.tag))).toEqual(new Set(BUG_REPORT_TAGS));
  });
});

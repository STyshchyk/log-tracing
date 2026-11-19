import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seedGlossary } from '../src/db/seed-glossary.js';
import { listRecentErrorSummaries } from '../src/services/telemetry-events.js';
import { renderRecentErrorsSection } from '../src/ui/recent-errors-section.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T07-${label}-${randomUUID().slice(0, 8)}`;
}

describe('inline recent errors feed on worker portal', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];
  const createdErrorCodes: string[] = [];

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

  async function registerMachine(id: string, displayName = `Winder ${id}`): Promise<void> {
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state)
       VALUES ($1, $2, 'NORTH_LEFT', 1, 1, 'IDLE')`,
      [id, displayName],
    );
  }

  it('displays a calm empty state in the inline Recent Errors section when a machine has zero error events', async () => {
    const machineId = makeMachineId('EMPTY');
    await registerMachine(machineId, 'Pilot Winder Empty');

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="recent-errors"');
    expect(res.body).toContain('Recent Errors</h2>');
    expect(res.body).toContain('class="machine-meta empty-state-note"');
    expect(res.body).toContain('No recent errors recorded for this machine.');
    expect(res.body).toContain('.empty-state-note');
    expect(res.body).toContain('.recent-error-item');
    expect(res.body).toContain('.recent-error-title');
    expect(res.body).toContain('.recent-error-summary');
    expect(res.body).toContain('.recent-error-code');
    expect(renderRecentErrorsSection([])).not.toContain('style=');
    expect(res.body.match(/<main\b/g)).toHaveLength(1);
    expect(res.body.match(/<h1\b/g)).toHaveLength(1);
  });

  it('displays up to 5 newest error events for the target machine newest-first with timestamp, error_code, glossary title, and summary', async () => {
    const machineA = makeMachineId('A');
    const machineB = makeMachineId('B');
    await registerMachine(machineA, 'Pilot Winder A');
    await registerMachine(machineB, 'Pilot Winder B');

    const baseMs = Date.parse('2026-11-19T08:00:00.000Z');
    const machineAEvents = [
      { code: 'ERR_FIBER_SNAP', message: 'fault-01-oldest', offsetSec: 10 },
      { code: 'ERR_TENSION_FAULT', message: 'fault-02-older', offsetSec: 20 },
      { code: 'ERR_SUBSYSTEM_TIMEOUT', message: 'fault-03-fifth', offsetSec: 30 },
      { code: 'ERR_BOBBIN_JAM', message: 'fault-04-fourth', offsetSec: 40 },
      { code: 'ERR_BROWNOUT_RESET', message: 'fault-05-third', offsetSec: 50 },
      { code: 'ERR_WATCHDOG_RESET', message: 'fault-06-second', offsetSec: 60 },
      { code: 'ERR_FIBER_SNAP', message: 'fault-07-newest', offsetSec: 70 },
    ];

    for (const item of machineAEvents) {
      await ctx.mqtt.emit(
        `factory/winders/${machineA}/events`,
        JSON.stringify({
          event_type: 'ERROR',
          error_code: item.code,
          message: item.message,
          ts: new Date(baseMs + item.offsetSec * 1000).toISOString(),
        }),
      );
    }

    await ctx.mqtt.emit(
      `factory/winders/${machineB}/events`,
      JSON.stringify({
        event_type: 'ERROR',
        error_code: 'ERR_BOBBIN_JAM',
        message: 'machine-b-isolated-fault',
        ts: new Date(baseMs + 90_000).toISOString(),
      }),
    );

    const summaries = await listRecentErrorSummaries(ctx.db, machineA);
    expect(summaries).toHaveLength(5);
    expect(summaries).toEqual([
      {
        time: new Date(baseMs + 70_000).toISOString(),
        event_type: 'ERROR',
        error_code: 'ERR_FIBER_SNAP',
        glossary_title: 'Fiber Snap Detected',
        summary: 'fault-07-newest',
      },
      {
        time: new Date(baseMs + 60_000).toISOString(),
        event_type: 'ERROR',
        error_code: 'ERR_WATCHDOG_RESET',
        glossary_title: 'Controller Watchdog Reset',
        summary: 'fault-06-second',
      },
      {
        time: new Date(baseMs + 50_000).toISOString(),
        event_type: 'ERROR',
        error_code: 'ERR_BROWNOUT_RESET',
        glossary_title: 'Controller Brownout Reset',
        summary: 'fault-05-third',
      },
      {
        time: new Date(baseMs + 40_000).toISOString(),
        event_type: 'ERROR',
        error_code: 'ERR_BOBBIN_JAM',
        glossary_title: 'Bobbin or Traverse Jam',
        summary: 'fault-04-fourth',
      },
      {
        time: new Date(baseMs + 30_000).toISOString(),
        event_type: 'ERROR',
        error_code: 'ERR_SUBSYSTEM_TIMEOUT',
        glossary_title: 'Motor or Subsystem Timeout',
        summary: 'fault-03-fifth',
      },
    ]);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineA}`,
    });

    expect(res.statusCode).toBe(200);
    const html = res.body;

    expect(html).not.toContain('No recent errors recorded for this machine.');
    expect(html).toContain('<ul class="machine-list" role="list">');

    // Oldest 2 faults and other machine's fault are excluded
    expect(html).not.toContain('fault-01-oldest');
    expect(html).not.toContain('fault-02-older');
    expect(html).not.toContain('machine-b-isolated-fault');

    // 5 newest appear in newest-first order with timestamps, codes, glossary titles, and summaries
    const expectedOrder = [
      'fault-07-newest',
      'fault-06-second',
      'fault-05-third',
      'fault-04-fourth',
      'fault-03-fifth',
    ];
    let lastPos = -1;
    for (const msg of expectedOrder) {
      const pos = html.indexOf(msg);
      expect(pos).toBeGreaterThan(lastPos);
      lastPos = pos;
    }

    expect(html).toContain(`datetime="${new Date(baseMs + 70_000).toISOString()}"`);
    expect(html).toContain('2026-11-19 08:01:10 UTC');
    expect(html).toContain('ERR_FIBER_SNAP');
    expect(html).toContain('Fiber Snap Detected');
    expect(html).toContain('Controller Watchdog Reset');
    expect(html).toContain('Controller Brownout Reset');
    expect(html).toContain('Bobbin or Traverse Jam');
    expect(html).toContain('Motor or Subsystem Timeout');
  });

  it('prevents newer HEARTBEAT, INFO, DIAGNOSTIC, and BOOT events from crowding out recent fault events', async () => {
    const machineId = makeMachineId('FILTER');
    await registerMachine(machineId, 'Pilot Winder Filter');

    const baseMs = Date.parse('2026-11-19T09:00:00.000Z');
    const errorPayloads = [
      {
        event_type: 'ERROR',
        error_code: 'ERR_FIBER_SNAP',
        message: 'err-01-fiber-snap',
        ts: new Date(baseMs + 10_000).toISOString(),
      },
      {
        event_type: 'FAULT',
        error_code: null,
        message: 'err-02-fault-no-code',
        ts: new Date(baseMs + 20_000).toISOString(),
      },
      {
        event_type: 'SUBSYSTEM_TIMEOUT',
        subsystem: 'creel_feeder',
        ts: new Date(baseMs + 30_000).toISOString(),
      },
      {
        event_type: 'INFO',
        error_code: 'ERR_TENSION_FAULT',
        message: 'err-04-info-with-code',
        ts: new Date(baseMs + 40_000).toISOString(),
      },
    ];

    for (const payload of errorPayloads) {
      await ctx.mqtt.emit(`factory/winders/${machineId}/events`, JSON.stringify(payload));
    }

    const noiseTypes = [
      'HEARTBEAT',
      'INFO',
      'DIAGNOSTIC',
      'BOOT',
      'HEARTBEAT',
      'INFO',
      'DIAGNOSTIC',
      'HEARTBEAT',
      'INFO',
      'BOOT',
    ] as const;

    for (let i = 0; i < noiseTypes.length; i += 1) {
      const eventType = noiseTypes[i]!;
      await ctx.mqtt.emit(
        `factory/winders/${machineId}/events`,
        JSON.stringify({
          event_type: eventType,
          rssi: -62,
          free_heap: 182000,
          message: `noise-event-${i + 1}-${eventType}`,
          ts: new Date(baseMs + (50 + i) * 1000).toISOString(),
        }),
      );
    }

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}`,
    });

    expect(res.statusCode).toBe(200);
    const html = res.body;

    expect(html).toContain('err-01-fiber-snap');
    expect(html).toContain('err-02-fault-no-code');
    expect(html).toContain('SUBSYSTEM_TIMEOUT');
    expect(html).toContain('Subsystem: creel_feeder');
    expect(html).toContain('err-04-info-with-code');
    expect(html).toContain('ERR_FIBER_SNAP');
    expect(html).toContain('ERR_TENSION_FAULT');

    for (let i = 0; i < noiseTypes.length; i += 1) {
      expect(html).not.toContain(`noise-event-${i + 1}-${noiseTypes[i]}`);
    }
    expect(html).not.toContain('HEARTBEAT');
    expect(html).not.toContain('DIAGNOSTIC');
  });

  it('derives readable fallback summaries from message, reset_reason, subsystem, or event_type and escapes all HTML content', async () => {
    const machineId = makeMachineId('FALLBACK');
    await registerMachine(machineId, 'Pilot Winder Fallback');

    const suffix = randomUUID().slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
    const customCode = `TEST_${suffix}_XSS`;
    createdErrorCodes.push(customCode);

    await seedGlossary(ctx.db, [
      {
        error_code: customCode,
        title: 'Title <img src=x onerror=alert(1)> & "Fault"',
        symptoms: 'Test symptoms',
        fix_steps_md: '1. Test fix.',
      },
    ]);

    const baseMs = Date.parse('2026-11-19T10:00:00.000Z');
    const events = [
      // 1. No payload details, no error_code -> falls back to readable event_type
      {
        event_type: 'CRASH_RESET',
        ts: new Date(baseMs + 10_000).toISOString(),
      },
      // 2. subsystem only -> Subsystem: <name>
      {
        event_type: 'SUBSYSTEM_TIMEOUT',
        subsystem: 'traverse_motor',
        ts: new Date(baseMs + 20_000).toISOString(),
      },
      // 3. reset_reason beats subsystem -> Reset reason: <reason>
      {
        event_type: 'CRASH_RESET',
        error_code: 'ERR_BROWNOUT_RESET',
        reset_reason: 'ESP_RST_BROWNOUT',
        subsystem: 'power',
        ts: new Date(baseMs + 30_000).toISOString(),
      },
      // 4. message beats reset_reason and subsystem, plus unlisted error_code & XSS characters
      {
        event_type: 'ERROR',
        error_code: 'ERR_UNLISTED_SENSOR',
        reset_reason: 'ESP_RST_SW',
        subsystem: 'tension_adc',
        message: '<script>alert("xss")</script> & \'quote\'',
        ts: new Date(baseMs + 40_000).toISOString(),
      },
      // 5. Glossary title containing HTML-sensitive chars with no payload message
      {
        event_type: 'ERROR',
        error_code: customCode,
        ts: new Date(baseMs + 50_000).toISOString(),
      },
    ];

    for (const ev of events) {
      await ctx.mqtt.emit(`factory/winders/${machineId}/events`, JSON.stringify(ev));
    }

    const summaries = await listRecentErrorSummaries(ctx.db, machineId, 5);
    expect(summaries).toEqual([
      {
        time: new Date(baseMs + 50_000).toISOString(),
        event_type: 'ERROR',
        error_code: customCode,
        glossary_title: 'Title <img src=x onerror=alert(1)> & "Fault"',
        summary: 'Error',
      },
      {
        time: new Date(baseMs + 40_000).toISOString(),
        event_type: 'ERROR',
        error_code: 'ERR_UNLISTED_SENSOR',
        glossary_title: null,
        summary: '<script>alert("xss")</script> & \'quote\'',
      },
      {
        time: new Date(baseMs + 30_000).toISOString(),
        event_type: 'CRASH_RESET',
        error_code: 'ERR_BROWNOUT_RESET',
        glossary_title: 'Controller Brownout Reset',
        summary: 'Reset reason: ESP_RST_BROWNOUT',
      },
      {
        time: new Date(baseMs + 20_000).toISOString(),
        event_type: 'SUBSYSTEM_TIMEOUT',
        error_code: null,
        glossary_title: null,
        summary: 'Subsystem: traverse_motor',
      },
      {
        time: new Date(baseMs + 10_000).toISOString(),
        event_type: 'CRASH_RESET',
        error_code: null,
        glossary_title: null,
        summary: 'Crash reset',
      },
    ]);

    const limitedThree = await listRecentErrorSummaries(ctx.db, machineId, 3);
    expect(limitedThree).toHaveLength(3);
    await expect(listRecentErrorSummaries(ctx.db, '   ')).resolves.toEqual([]);
    await expect(listRecentErrorSummaries(ctx.db, makeMachineId('UNKNOWN'))).resolves.toEqual([]);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}`,
    });

    expect(res.statusCode).toBe(200);
    const html = res.body;

    // Fallback summaries and unlisted error codes appear properly
    expect(html).toContain('Crash reset');
    expect(html).toContain('Subsystem: traverse_motor');
    expect(html).toContain('Controller Brownout Reset');
    expect(html).toContain('Reset reason: ESP_RST_BROWNOUT');
    expect(html).toContain('ERR_UNLISTED_SENSOR');

    // Escaping is strict across glossary titles and telemetry messages
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;quote&#39;');
    expect(html).toContain('Title &lt;img src=x onerror=alert(1)&gt; &amp; &quot;Fault&quot;');
    expect(html).not.toMatch(/<script\b/i);

    // Direct renderRecentErrorsSection caps at 5 items even if caller passes more
    const sixItems = Array.from({ length: 6 }, (_, index) => ({
      time: new Date(baseMs + index * 1000).toISOString(),
      event_type: 'ERROR',
      error_code: null,
      glossary_title: null,
      summary: `item-${index + 1}`,
    }));
    const cappedHtml = renderRecentErrorsSection(sixItems);
    expect(cappedHtml).toContain('item-5');
    expect(cappedHtml).not.toContain('item-6');
    expect(cappedHtml).not.toContain('style=');
    expect(cappedHtml).toContain('class="recent-error-item"');
    expect(cappedHtml).toContain('class="recent-error-code"');
    expect(cappedHtml).toContain('class="recent-error-summary"');
    expect(html).toContain('class="recent-error-title"');
    expect(html).not.toMatch(/<section[^>]*id="recent-errors"[\s\S]*style=/);
  });
});

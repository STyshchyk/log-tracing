import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T21-${label}-${randomUUID().slice(0, 8)}`;
}

describe('Department Heads /fleet SSR PWA and web manifest', () => {
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

  it('GET /fleet renders summary strip, L-shaped floor zones, accessible tabs, modal drawer, and scroll containment CSS', async () => {
    const idNorth = makeMachineId('UI-N');
    const idMain = makeMachineId('UI-M');
    createdMachineIds.push(idNorth, idMain);

    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, active_error)
       VALUES
         ($1, 'North Test Winder', 'NORTH_LEFT', 1, 1, 'ERROR', 'ERR_FIBER_SNAP'),
         ($2, 'Main Bank Winder', 'MAIN_BANK', 3, 2, 'WORKING', NULL)`,
      [idNorth, idMain],
    );

    const res = await ctx.app.inject({ method: 'GET', url: '/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html; charset=utf-8');

    const html = res.body;
    expect(html).toContain('<link rel="manifest" href="/fleet/manifest.webmanifest">');
    expect(html).toContain('id="count-working"');
    expect(html).toContain('id="count-error"');
    expect(html).toContain('data-coil-window="TODAY"');
    expect(html).toContain('data-coil-window="ALL_TIME"');
    expect(html).toContain('Winding Cycles (ESP32)');
    expect(html).toContain('Auto-Finished');
    expect(html).toContain('Aborted');
    expect(html).toContain('Fault-Stopped');
    expect(html).toContain('Wound Fiber');
    expect(html).toContain('id="coil-auto-finished"');
    expect(html).toContain('id="coil-aborted"');
    expect(html).toContain('id="coil-fault-terminated"');
    expect(html).toContain('id="coil-wound-length"');
    expect(html).toContain('Winding Cycle Telemetry (ESP32)');
    expect(html).not.toContain('Coil Outcomes');
    expect(html).not.toContain('Coil Production Rollups');
    expect(html).not.toContain('>Completed<');
    expect(html).not.toContain('>Completion<');

    // Accessible 3-tab structure with focusgroup and hidden="until-found"
    expect(html).toContain('focusgroup="tablist nomemory"');
    expect(html).toContain('aria-selected="true" focusgroupstart>Floor Map</button>');
    expect(html).toContain('id="panel-history" aria-labelledby="tab-history" hidden="until-found"');
    expect(html).toContain('id="panel-glossary" aria-labelledby="tab-glossary" hidden="until-found"');
    expect(html).toContain('beforematch');

    // L-shaped floor map zones & machine buttons
    expect(html).toContain('data-zone="NORTH_LEFT"');
    expect(html).toContain('data-zone="NORTH_RIGHT"');
    expect(html).toContain('data-zone="MAIN_BANK"');
    expect(html).toContain('data-zone="EAST_DOOR"');
    expect(html).toContain(`data-machine-id="${idNorth}"`);
    expect(html).toContain(`data-machine-id="${idMain}"`);
    expect(html).toContain('ERR_FIBER_SNAP');

    // Native modal <dialog> drawer + scroll containment + light-dismiss fallback
    expect(html).toContain('<dialog id="machine-drawer" class="machine-drawer" closedby="any" aria-labelledby="drawer-title">');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal=');
    expect(html).toContain('dialog.machine-drawer:modal');
    expect(html).toContain('overscroll-behavior: contain');
    expect(html).toContain("closedBy' in HTMLDialogElement.prototype");

    // /fleet/ trailing slash alias also works
    const slashRes = await ctx.app.inject({ method: 'GET', url: '/fleet/' });
    expect(slashRes.statusCode).toBe(200);
  });

  it('escapes untrusted machine names and worker notes in both SSR HTML and embedded bootstrap JSON', async () => {
    const id = makeMachineId('XSS');
    createdMachineIds.push(id);

    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state)
       VALUES ($1, $2, 'EAST_DOOR', 1, 1, 'IDLE')`,
      [id, '</script><script>alert("xss")</script>'],
    );
    await ctx.db.query(
      `INSERT INTO bug_reports (machine_id, tag, worker_note)
       VALUES ($1, 'Other', '<img src=x onerror=alert(1)>')`,
      [id],
    );

    const res = await ctx.app.inject({ method: 'GET', url: '/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<script>alert("xss")</script>');
    expect(res.body).not.toContain('<img src=x onerror=alert(1)>');
    expect(res.body).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(\\"xss\\")\\u003c/script\\u003e');
  });

  it('GET /fleet/manifest.webmanifest returns a valid standalone PWA manifest', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/fleet/manifest.webmanifest',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/manifest+json');

    const manifest = res.json<{
      name: string;
      start_url: string;
      display: string;
      icons: unknown[];
    }>();
    expect(manifest.name).toBe('Winding Room Fleet');
    expect(manifest.start_url).toBe('/fleet');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });
});

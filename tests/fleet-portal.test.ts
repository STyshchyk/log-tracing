import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PresetRecord } from '../src/services/presets.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T21-${label}-${randomUUID().slice(0, 8)}`;
}

describe('Department Heads /fleet SSR PWA and web manifest', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];
  const createdReleaseVersions: string[] = [];
  const createdPresetIds: number[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    if (createdMachineIds.length > 0) {
      await ctx.db.query('DELETE FROM machines WHERE id = ANY($1)', [
        createdMachineIds.splice(0),
      ]);
    }
    if (createdReleaseVersions.length > 0) {
      await ctx.db.query('DELETE FROM firmware_releases WHERE version = ANY($1)', [
        createdReleaseVersions.splice(0),
      ]);
    }
    if (createdPresetIds.length > 0) {
      await ctx.db.query('DELETE FROM machine_presets WHERE id = ANY($1::bigint[])', [
        createdPresetIds.splice(0),
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

    // Accessible 4-tab structure with focusgroup and hidden="until-found"
    expect(html).toContain('focusgroup="tablist nomemory"');
    expect(html).toContain('aria-selected="true" focusgroupstart>Floor Map</button>');
    expect(html).toContain('id="panel-history" aria-labelledby="tab-history" hidden="until-found"');
    expect(html).toContain('id="panel-glossary" aria-labelledby="tab-glossary" hidden="until-found"');
    expect(html).toContain('id="tab-ota"');
    expect(html).toContain('id="panel-ota" aria-labelledby="tab-ota" hidden="until-found"');
    expect(html).toContain('beforematch');

    // Architectural 44-Machine-Tool Workshop Floor Plan + L-shaped floor sections & machine buttons without legacy zones
    expect(html).toContain('WORKSHOP FLOOR PLAN — 44 MACHINE TOOLS');
    expect(html).toContain('44 UNITS');
    expect(html).toContain('NARROW WING');
    expect(html).toContain('12 UNITS (7 + 5)');
    expect(html).toContain('MAIN HALL ROWS:');
    expect(html).toContain('24 UNITS (5 + 7 + 6 + 6)');
    expect(html).toContain('RIGHT STACK:');
    expect(html).toContain('8 UNITS (4 &times; 2)');
    expect(html).toContain('ROW 1 (5 UNITS');
    expect(html).toContain('ROW 2 (7 UNITS');
    expect(html).toContain('ROW 3 (6 UNITS');
    expect(html).toContain('ROW 4 (6 UNITS');
    expect(html).toContain('&#1041;&#1056;&#1040;&#1050;');
    expect(html).toContain('data-section="narrow_west"');
    expect(html).toContain('data-section="narrow_east"');
    expect(html).toContain('data-section="main_hall"');
    expect(html).toContain('data-section="right_stack"');
    expect(html).toContain('data-view-mode="section"');
    expect(html).not.toContain('NORTH_LEFT');
    expect(html).not.toContain('NORTH_RIGHT');
    expect(html).not.toContain('MAIN_BANK');
    expect(html).not.toContain('EAST_DOOR');
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

    // Industrial Console & Fleet Triage UI elements
    expect(html).toContain('id="fleet-access-pill"');
    expect(html).toContain('id="fleet-poll-toggle-btn"');
    expect(html).toContain('data-kpi-filter="ERROR"');
    expect(html).toContain('data-kpi-filter="BUGS"');
    expect(html).toContain('id="coil-auto-rate"');
    expect(html).toContain('data-view-mode="urgency"');
    expect(html).toContain('data-view-mode="blueprint"');
    expect(html).toContain('id="fleet-map-search"');
    expect(html).toContain('id="fleet-triage-board"');
    expect(html).toContain('id="glossary-popover"');
    expect(html).toContain('data-glossary-code="ERR_FIBER_SNAP"');
    expect(html).toContain('id="drawer-prev-error-btn"');
    expect(html).toContain('id="drawer-next-error-btn"');

    // /fleet/ trailing slash alias also works
    const slashRes = await ctx.app.inject({ method: 'GET', url: '/fleet/' });
    expect(slashRes.statusCode).toBe(200);
  });

  it('renders machine fw_version/preset_version, Check Updates, multi-select batch toolbar, OTA upload, preset controls, and pending queue cancel buttons', async () => {
    const mWorking = makeMachineId('OTA-W');
    const fwVer = `9.45.fw-${randomUUID().slice(0, 6)}`;
    const presetName = `preset-ui-${randomUUID().slice(0, 6)}`;
    createdMachineIds.push(mWorking);

    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, fw_version, preset_version, preset_name)
       VALUES ($1, 'OTA Working Winder', 'MAIN_BANK', 1, 1, 'WORKING', '1.0.0', '2026.10.1', 'old-preset')`,
      [mWorking],
    );

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/firmware?version=${encodeURIComponent(fwVer)}&notes=${encodeURIComponent('Phase 4 OTA UI release')}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('phase4-ui-bin'),
    });
    expect(uploadRes.statusCode).toBe(201);
    createdReleaseVersions.push(fwVer);

    const presetRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/presets',
      payload: {
        name: presetName,
        version: '2026.11.9',
        config_json: { target_rpm: 1500 },
        notes: 'High speed preset',
      },
    });
    expect(presetRes.statusCode).toBe(201);
    const preset = presetRes.json<PresetRecord>();
    createdPresetIds.push(preset.id);

    // Queue a PENDING update on the WORKING machine
    const queueRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/firmware/ota',
      payload: { version: fwVer, machineId: mWorking },
    });
    expect(queueRes.statusCode).toBe(200);
    const updateId = queueRes.json<{ results: Array<{ update: { id: number } }> }>().results[0]!.update.id;

    const res = await ctx.app.inject({ method: 'GET', url: '/fleet' });
    expect(res.statusCode).toBe(200);
    const html = res.body;

    // Machine node exposes reported fw_version, preset_version, and multi-select checkbox
    expect(html).toContain('data-fw-version="1.0.0"');
    expect(html).toContain('data-preset-version="2026.10.1"');
    expect(html).toContain('FW 1.0.0 · PR 2026.10.1');
    expect(html).toContain(`data-select-machine="${mWorking}"`);

    // Check Updates + batch OTA/preset toolbar
    expect(html).toContain('id="fleet-check-updates-btn"');
    expect(html).toContain('id="batch-select-outdated-btn"');
    expect(html).toContain('id="batch-select-visible-btn"');
    expect(html).toContain('id="batch-clear-selection-btn"');
    expect(html).toContain('id="batch-firmware-select"');
    expect(html).toContain('id="batch-preset-select"');
    expect(html).toContain('id="batch-push-ota-btn"');
    expect(html).toContain('id="batch-push-preset-btn"');

    // OTA upload form, preset form, releases list, presets list, and pending queue cancel button
    expect(html).toContain('id="firmware-upload-form"');
    expect(html).toContain('id="fw-upload-file"');
    expect(html).toContain('accept=".bin"');
    expect(html).toContain('id="preset-create-form"');
    expect(html).toContain('id="preset-config-json"');
    expect(html).toContain(fwVer);
    expect(html).toContain(presetName);
    expect(html).toContain(`data-delete-preset="${preset.id}"`);
    expect(html).toContain(`data-cancel-update="${updateId}"`);

    // Single-machine drawer OTA/preset client hooks
    expect(html).toContain('fleet:drawer-rendered');
    expect(html).toContain('/api/fleet/firmware/ota');
    expect(html).toContain('/api/fleet/updates/');
  });

  it('escapes untrusted machine names, worker notes, firmware notes, and preset names in both SSR HTML and embedded bootstrap JSON', async () => {
    const id = makeMachineId('XSS');
    const fwVer = `9.45.xss-${randomUUID().slice(0, 6)}`;
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

    const fwUploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/fleet/firmware?version=${encodeURIComponent(fwVer)}&notes=${encodeURIComponent('<img src=x onerror=alert("fw")>')}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('xss-fw-test'),
    });
    expect(fwUploadRes.statusCode).toBe(201);
    createdReleaseVersions.push(fwVer);

    const presetRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/fleet/presets',
      payload: {
        name: '</script><script>alert("preset")</script>',
        version: '1.0.0',
        config_json: { rpm: 1000 },
      },
    });
    expect(presetRes.statusCode).toBe(201);
    createdPresetIds.push(presetRes.json<PresetRecord>().id);

    const res = await ctx.app.inject({ method: 'GET', url: '/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<script>alert("xss")</script>');
    expect(res.body).not.toContain('<script>alert("preset")</script>');
    expect(res.body).not.toContain('<img src=x onerror=alert(1)>');
    expect(res.body).not.toContain('<img src=x onerror=alert("fw")>');
    expect(res.body).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(\\"xss\\")\\u003c/script\\u003e');
  });

  it('keeps unauthenticated Worker Portal routes strictly read-only with no OTA or preset controls', async () => {
    const id = makeMachineId('WORKER-RO');
    createdMachineIds.push(id);
    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, fw_version, preset_version)
       VALUES ($1, 'Worker ReadOnly Winder', 'NORTH_LEFT', 1, 1, 'IDLE', '1.2.0', '2026.11.1')`,
      [id],
    );

    for (const url of [
      '/',
      `/m/${encodeURIComponent(id)}`,
      `/m/${encodeURIComponent(id)}/glossary`,
      `/m/${encodeURIComponent(id)}/report-bug`,
    ]) {
      const res = await ctx.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('/api/fleet/');
      expect(res.body).not.toContain('firmware-upload-form');
      expect(res.body).not.toContain('preset-create-form');
      expect(res.body).not.toContain('data-cancel-update');
      expect(res.body).not.toContain('Push OTA');
      expect(res.body).not.toContain('Push Preset');
    }
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

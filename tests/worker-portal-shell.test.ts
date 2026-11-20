import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listMachines, normalizeMachineId } from '../src/services/machines.js';
import {
  renderMachineDirectoryPage,
  renderMachineLandingPage,
} from '../src/routes/worker-portal.js';
import { escapeHtml, renderStatusBadge } from '../src/ui/portal-layout.js';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

function makeMachineId(label: string): string {
  return `T05-${label}-${randomUUID().slice(0, 8)}`;
}

describe('worker portal landing shell and unknown-machine handling', () => {
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
        overrides.zone ?? 'NORTH_LEFT',
        overrides.grid_row ?? 1,
        overrides.grid_col ?? 1,
        overrides.current_state ?? 'OFFLINE',
        overrides.active_error ?? null,
        overrides.last_seen_at ?? null,
      ],
    );
  }

  it('GET /m/:machineId serves a mobile-first zero-login HTML landing screen with machine info, live state, and two primary action links', async () => {
    const machineId = makeMachineId('LAND');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder 01',
      current_state: 'WORKING',
      active_error: null,
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);

    const html = res.body;
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Pilot Winder 01');
    expect(html).toContain(machineId);
    expect(html).toContain('WORKING');
    expect(html).toContain(`href="/m/${encodeURIComponent(machineId)}/report-bug"`);
    expect(html).toContain('Report a Bug');
    expect(html).toContain(`href="/m/${encodeURIComponent(machineId)}/glossary"`);
    expect(html).toContain('Glossary / FAQ');
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<script\b/i);
  });

  it('reflects live WORKING, IDLE, ERROR, and OFFLINE MQTT status transitions, active error_code badge, and last_seen_at timestamp', async () => {
    const machineId = makeMachineId('STATES');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder 02',
      current_state: 'OFFLINE',
      active_error: null,
      last_seen_at: null,
    });

    // Initial OFFLINE without active_error or last_seen_at
    const initialRes = await ctx.app.inject({ method: 'GET', url: `/m/${machineId}` });
    expect(initialRes.statusCode).toBe(200);
    expect(initialRes.body).toContain('status-offline');
    expect(initialRes.body).toContain('OFFLINE');
    expect(initialRes.body).not.toContain('Active error:');
    expect(initialRes.body).toContain('Not yet reported');

    // Transition to WORKING via MQTT
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'WORKING', ts: '2026-11-19T12:10:00Z' }),
    );
    const workingRes = await ctx.app.inject({ method: 'GET', url: `/m/${machineId}` });
    expect(workingRes.statusCode).toBe(200);
    expect(workingRes.body).toContain('status-working');
    expect(workingRes.body).toContain('WORKING');
    expect(workingRes.body).not.toContain('Active error:');
    expect(workingRes.body).toContain('<time datetime=');

    // Transition to IDLE via MQTT
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'IDLE' }));
    const idleRes = await ctx.app.inject({ method: 'GET', url: `/m/${machineId}` });
    expect(idleRes.statusCode).toBe(200);
    expect(idleRes.body).toContain('status-idle');
    expect(idleRes.body).toContain('IDLE');
    expect(idleRes.body).not.toContain('Active error:');

    // Transition to ERROR with error_code via MQTT
    await ctx.mqtt.emit(
      `factory/winders/${machineId}/status`,
      JSON.stringify({ state: 'ERROR', error_code: 'ERR_FIBER_SNAP' }),
    );
    const errorRes = await ctx.app.inject({ method: 'GET', url: `/m/${machineId}` });
    expect(errorRes.statusCode).toBe(200);
    expect(errorRes.body).toContain('status-error');
    expect(errorRes.body).toContain('ERROR');
    expect(errorRes.body).toContain('Active error:');
    expect(errorRes.body).toContain('ERR_FIBER_SNAP');

    // LWT OFFLINE preserves active_error and renders both OFFLINE state and active error_code badge
    await ctx.mqtt.emit(`factory/winders/${machineId}/status`, JSON.stringify({ state: 'OFFLINE' }));
    const offlineLwtRes = await ctx.app.inject({ method: 'GET', url: `/m/${machineId}` });
    expect(offlineLwtRes.statusCode).toBe(200);
    expect(offlineLwtRes.body).toContain('status-offline');
    expect(offlineLwtRes.body).toContain('OFFLINE');
    expect(offlineLwtRes.body).toContain('Active error:');
    expect(offlineLwtRes.body).toContain('ERR_FIBER_SNAP');
  });

  it('renders a worker-friendly 404 recovery page for unknown, empty, or invalid machine IDs and HTML-escapes all dynamic strings', async () => {
    const unknownId = makeMachineId('MISSING');
    const missingRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${unknownId}`,
    });

    expect(missingRes.statusCode).toBe(404);
    expect(missingRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
    expect(missingRes.body).toContain('Machine Not Found');
    expect(missingRes.body).toContain(unknownId);
    expect(missingRes.body).toContain('href="/"');

    const xssRes = await ctx.app.inject({
      method: 'GET',
      url: '/m/%3Cscript%3Ealert(1)%3C%2Fscript%3E',
    });
    expect(xssRes.statusCode).toBe(404);
    expect(xssRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
    expect(xssRes.body).not.toContain('<script>alert(1)</script>');
    expect(xssRes.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(xssRes.body).toContain('href="/"');

    const emptySlashRes = await ctx.app.inject({
      method: 'GET',
      url: '/m/',
    });
    expect(emptySlashRes.statusCode).toBe(404);
    expect(emptySlashRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
    expect(emptySlashRes.body).toContain('Machine Not Found');
    expect(emptySlashRes.body).toContain('href="/"');

    const barePrefixRes = await ctx.app.inject({
      method: 'GET',
      url: '/m',
    });
    expect(barePrefixRes.statusCode).toBe(404);
    expect(barePrefixRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
    expect(barePrefixRes.body).toContain('Machine Not Found');
    expect(barePrefixRes.body).toContain('href="/"');

    const xssMachineId = makeMachineId('XSS');
    await registerMachine(xssMachineId, {
      display_name: 'Winder <img src=x onerror=alert(1)> & "Alpha"',
      current_state: 'ERROR',
      active_error: 'ERR_FIBER_SNAP',
    });

    const escapedRes = await ctx.app.inject({
      method: 'GET',
      url: `/m/${xssMachineId}`,
    });
    expect(escapedRes.statusCode).toBe(200);
    expect(escapedRes.body).not.toContain('<img src=x onerror=alert(1)>');
    expect(escapedRes.body).toContain(
      'Winder &lt;img src=x onerror=alert(1)&gt; &amp; &quot;Alpha&quot;',
    );
  });

  it('listMachines(db) and GET / list registered machines with portal links, state badges, and clean empty state', async () => {
    const idB = makeMachineId('B');
    const idA = makeMachineId('A');

    await registerMachine(idB, {
      display_name: 'Winder Bravo <safe>',
      current_state: 'ERROR',
      active_error: 'ERR_BOBBIN_JAM',
    });
    await registerMachine(idA, {
      display_name: 'Winder Alpha',
      current_state: 'WORKING',
      active_error: null,
    });

    const listed = await listMachines(ctx.db);
    const ours = listed.filter((m) => m.id === idA || m.id === idB);
    expect(ours.map((m) => m.id)).toEqual([idA, idB]);
    expect(ours[0]).toMatchObject({
      id: idA,
      display_name: 'Winder Alpha',
      current_state: 'WORKING',
      active_error: null,
    });
    expect(ours[1]).toMatchObject({
      id: idB,
      display_name: 'Winder Bravo <safe>',
      current_state: 'ERROR',
      active_error: 'ERR_BOBBIN_JAM',
    });

    const dirRes = await ctx.app.inject({
      method: 'GET',
      url: '/',
    });

    expect(dirRes.statusCode).toBe(200);
    expect(dirRes.headers['content-type']).toMatch(/text\/html;\s*charset=utf-8/i);
    expect(dirRes.body).toContain('Winding Room Machines');
    expect(dirRes.body).toContain(`href="/m/${encodeURIComponent(idA)}"`);
    expect(dirRes.body).toContain('Winder Alpha');
    expect(dirRes.body).toContain(`href="/m/${encodeURIComponent(idB)}"`);
    expect(dirRes.body).toContain('Winder Bravo &lt;safe&gt;');
    expect(dirRes.body).not.toContain('Winder Bravo <safe>');
    expect(dirRes.body).toContain('ERR_BOBBIN_JAM');
    expect(dirRes.body).toContain('status-working');
    expect(dirRes.body).toContain('status-error');

    const emptyHtml = renderMachineDirectoryPage([]);
    expect(emptyHtml).toContain('Winding Room Machines');
    expect(emptyHtml).toContain('No winding machines are registered yet.');
  });

  it('satisfies modern mobile web guidance constraints, non-color status badges, single-landmark hierarchy, and recent-errors slot', async () => {
    const machineId = makeMachineId('UI');
    await registerMachine(machineId, {
      display_name: 'Pilot Winder UI',
      current_state: 'IDLE',
      active_error: null,
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/m/${machineId}`,
    });

    expect(res.statusCode).toBe(200);
    const html = res.body;

    // Viewport, safe-area insets, wrapping, target sizing, focus ring, forced-colors
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    );
    expect(html).toContain('env(safe-area-inset-top');
    expect(html).toContain('env(safe-area-inset-bottom');
    expect(html).toContain('env(safe-area-inset-left');
    expect(html).toContain('env(safe-area-inset-right');
    expect(html).toContain('overflow-wrap: break-word');
    expect(html).toContain('overflow-wrap: anywhere');
    expect(html).toContain('min-block-size: 100dvh');
    expect(html).toContain('--target-min: 48px');
    expect(html).toContain('@media (pointer: coarse)');
    expect(html).toContain('--target-min: 52px');
    expect(html).toContain(':focus-visible');
    expect(html).toContain('@media (forced-colors: active)');

    // Single <main> and single <h1>
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);

    // Non-color cues on every status badge
    expect(renderStatusBadge('WORKING')).toContain('&#9679;');
    expect(renderStatusBadge('IDLE')).toContain('&#9680;');
    expect(renderStatusBadge('ERROR')).toContain('&#9650;');
    expect(renderStatusBadge('OFFLINE')).toContain('&#10005;');

    // Escaping covers all HTML-sensitive characters
    expect(escapeHtml(`<tag attr="a" single='b'>&`)).toBe(
      '&lt;tag attr=&quot;a&quot; single=&#39;b&#39;&gt;&amp;',
    );

    // Recent-errors slot accepts bottom section cleanly
    const withErrorsSlot = renderMachineLandingPage(
      {
        id: machineId,
        display_name: 'Pilot Winder UI',
        zone: 'FLOOR',
        grid_row: 1,
        grid_col: 1,
        floor_position: null,
        hardware_id: null,
        current_state: 'IDLE',
        active_error: null,
        fw_version: null,
        preset_version: null,
        preset_name: null,
        last_seen_at: null,
      },
      '<section id="recent-errors"><h2>Recent Errors</h2></section>',
    );
    expect(withErrorsSlot).toContain('<section id="recent-errors"><h2>Recent Errors</h2></section>');
  });

  it('normalizeMachineId trims non-empty IDs and returns null for empty or whitespace-only inputs', () => {
    expect(normalizeMachineId('W-01')).toBe('W-01');
    expect(normalizeMachineId('  W-01  ')).toBe('W-01');
    expect(normalizeMachineId('')).toBeNull();
    expect(normalizeMachineId('   ')).toBeNull();
  });
});

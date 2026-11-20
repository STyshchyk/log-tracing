import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestAppContext } from './helpers/test-app.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, '..');

interface GrafanaTarget {
  refId: string;
  rawSql?: string;
  rawQuery?: boolean;
  datasource?: { type?: string; uid?: string };
}

interface GrafanaPanel {
  id: number;
  title: string;
  type: string;
  datasource?: { type?: string; uid?: string };
  targets?: GrafanaTarget[];
}

interface GrafanaVariable {
  name: string;
  type: string;
  query?: string;
  datasource?: { type?: string; uid?: string };
  current?: { text?: unknown; value?: unknown };
}

interface GrafanaDashboard {
  uid: string;
  title: string;
  schemaVersion: number;
  panels: GrafanaPanel[];
  templating?: { list?: GrafanaVariable[] };
}

interface ComposeJson {
  services: Record<
    string,
    {
      image?: string;
      profiles?: string[];
      ports?: Array<{ published?: string; target?: number }>;
      volumes?: Array<{ type?: string; source?: string; target?: string }>;
      depends_on?: Record<string, { condition?: string }>;
      healthcheck?: { test?: string[] };
    }
  >;
  volumes?: Record<string, unknown>;
}

function readDashboard(fileName: string): { raw: string; parsed: GrafanaDashboard } {
  const fullPath = resolve(ROOT_DIR, 'grafana', 'dashboards', fileName);
  const raw = readFileSync(fullPath, 'utf8');
  return {
    raw,
    parsed: JSON.parse(raw) as GrafanaDashboard,
  };
}

function runComposeConfig(args: string[]): ComposeJson {
  const stdout = execFileSync('docker', ['compose', ...args, 'config', '--format', 'json'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(stdout) as ComposeJson;
}

function substituteGrafanaMacros(
  rawSql: string,
  machineIds: readonly string[],
  zones: readonly string[],
): string {
  const sqlQuote = (val: string) => `'${val.replace(/'/g, "''")}'`;
  const quotedMachines = machineIds.map(sqlQuote).join(', ');
  const quotedZones = zones.map(sqlQuote).join(', ');

  return rawSql
    .replace(
      /\$__timeFilter\(([^)]+)\)/g,
      (_m, expr: string) =>
        `${expr} BETWEEN NOW() - INTERVAL '30 days' AND NOW() + INTERVAL '1 day'`,
    )
    .replace(
      /\$__timeGroupAlias\(([^,]+),\s*\$__interval\)/g,
      (_m, expr: string) => `time_bucket(INTERVAL '5 minutes', ${expr.trim()}) AS "time"`,
    )
    .replace(
      /\$__timeGroup\(([^,]+),\s*\$__interval\)/g,
      (_m, expr: string) => `time_bucket(INTERVAL '5 minutes', ${expr.trim()})`,
    )
    .replace(/\$zone\b/g, quotedZones)
    .replace(/\$machine\b/g, quotedMachines);
}

describe('Grafana OSS provisioning, dashboard JSON & Compose profiles', () => {
  it('provisions TimescaleDB PostgreSQL datasource and dashboard file loader cleanly', () => {
    const datasourceYaml = readFileSync(
      resolve(ROOT_DIR, 'grafana', 'provisioning', 'datasources', 'postgres.yml'),
      'utf8',
    );
    expect(datasourceYaml).toContain('apiVersion: 1');
    expect(datasourceYaml).toContain('name: Telemetry TimescaleDB');
    expect(datasourceYaml).toContain('type: postgres');
    expect(datasourceYaml).toContain('uid: telemetry-postgres');
    expect(datasourceYaml).toContain('access: proxy');
    expect(datasourceYaml).toContain('url: postgres:5432');
    expect(datasourceYaml).toContain('user: ${POSTGRES_USER}');
    expect(datasourceYaml).toContain('database: ${POSTGRES_DB}');
    expect(datasourceYaml).toContain('sslmode: disable');
    expect(datasourceYaml).toContain('postgresVersion: 1600');
    expect(datasourceYaml).toContain('timescaledb: true');
    expect(datasourceYaml).toContain('password: ${POSTGRES_PASSWORD}');

    const dashboardsYaml = readFileSync(
      resolve(ROOT_DIR, 'grafana', 'provisioning', 'dashboards', 'dashboards.yml'),
      'utf8',
    );
    expect(dashboardsYaml).toContain('apiVersion: 1');
    expect(dashboardsYaml).toContain('name: Winding Room Engineering');
    expect(dashboardsYaml).toContain('folder: Winding Room Engineering');
    expect(dashboardsYaml).toContain('type: file');
    expect(dashboardsYaml).toContain('allowUiUpdates: false');
    expect(dashboardsYaml).toContain('path: /var/lib/grafana/dashboards');
  });

  it('validates both provisioned dashboards, template variables, deep-links, and exclusions', () => {
    const fw = readDashboard('esp32-firmware-health.json');
    const cycle = readDashboard('winding-cycle-telemetry.json');

    expect(fw.parsed.uid).toBe('esp32-firmware-health');
    expect(cycle.parsed.uid).toBe('winding-cycle-telemetry');
    expect(fw.parsed.uid).not.toBe(cycle.parsed.uid);

    for (const { raw, parsed } of [fw, cycle]) {
      expect(parsed.schemaVersion).toBeGreaterThanOrEqual(36);
      expect(parsed.panels.length).toBeGreaterThanOrEqual(5);

      const vars = parsed.templating?.list ?? [];
      expect(vars.map((v) => v.name)).toEqual(
        expect.arrayContaining(['zone', 'machine', 'app_url']),
      );

      const appUrlVar = vars.find((v) => v.name === 'app_url');
      expect(appUrlVar?.type).toBe('textbox');
      expect(appUrlVar?.query).toBe('http://localhost:3000');

      for (const qVar of vars.filter((v) => v.type === 'query')) {
        expect(qVar.datasource).toEqual({ type: 'postgres', uid: 'telemetry-postgres' });
      }

      for (const panel of parsed.panels) {
        expect(panel.datasource).toEqual({ type: 'postgres', uid: 'telemetry-postgres' });
        expect(panel.targets?.length ?? 0).toBeGreaterThan(0);
        for (const target of panel.targets ?? []) {
          expect(target.datasource).toEqual({ type: 'postgres', uid: 'telemetry-postgres' });
          expect(target.rawQuery).toBe(true);
          expect(typeof target.rawSql).toBe('string');
          expect(target.rawSql!.trim().length).toBeGreaterThan(0);
        }
      }

      // Clickable Worker Portal & Fault Glossary deep-links
      expect(raw).toContain('${app_url}/m/${__data.fields.machine_id}');
      expect(raw).toContain('/glossary?q=');

      // Explicitly excluded features/labels must never appear
      expect(raw).not.toContain('photo_path');
      expect(raw).not.toContain('COMPLETED');
      expect(raw).not.toContain('REDO');
      expect(raw).not.toMatch(/SpeechRecognition|webkitSpeechRecognition/i);
    }
  });

  it('keeps default docker compose LAN stack untouched while wiring engineering and remote profiles cleanly', () => {
    const defaultCfg = runComposeConfig([]);
    expect(Object.keys(defaultCfg.services).sort()).toEqual(['app', 'mosquitto', 'postgres']);

    const engCfg = runComposeConfig(['--profile', 'engineering']);
    expect(Object.keys(engCfg.services).sort()).toEqual([
      'app',
      'grafana',
      'mosquitto',
      'postgres',
    ]);
    const grafana = engCfg.services.grafana!;
    expect(grafana.image).toBe('grafana/grafana:11.6.2');
    expect(grafana.profiles).toEqual(['engineering']);
    expect(grafana.depends_on?.postgres?.condition).toBe('service_healthy');
    expect(grafana.ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ published: '3001', target: 3000 }),
      ]),
    );
    expect(grafana.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'grafana_data', target: '/var/lib/grafana' }),
        expect.objectContaining({ target: '/etc/grafana/provisioning/datasources' }),
        expect.objectContaining({ target: '/etc/grafana/provisioning/dashboards' }),
        expect.objectContaining({ target: '/var/lib/grafana/dashboards' }),
      ]),
    );
    expect(grafana.healthcheck?.test?.join(' ')).toContain('/api/health');
    expect(engCfg.volumes).toHaveProperty('grafana_data');

    const combinedCfg = runComposeConfig(['--profile', 'engineering', '--profile', 'remote']);
    expect(Object.keys(combinedCfg.services).sort()).toEqual([
      'app',
      'cloudflared',
      'grafana',
      'mosquitto',
      'postgres',
    ]);
  });
});

describe('Grafana dashboard SQL execution against real PostgreSQL/TimescaleDB', () => {
  let ctx: TestAppContext;
  const createdMachineIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();

    const m1 = `T30-G1-${randomUUID().slice(0, 8)}`;
    const m2 = `T30-G2-${randomUUID().slice(0, 8)}`;
    createdMachineIds.push(m1, m2);

    await ctx.db.query(
      `INSERT INTO machines (id, display_name, zone, grid_row, grid_col, current_state, active_error, last_seen_at)
       VALUES
         ($1, 'Grafana Test Winder 1', 'NORTH_LEFT', 1, 1, 'ERROR', 'ERR_FIBER_SNAP', NOW()),
         ($2, 'Grafana Test Winder 2', 'MAIN_BANK', 1, 1, 'WORKING', NULL, NOW())`,
      [m1, m2],
    );

    await ctx.db.query(
      `INSERT INTO telemetry_events (time, machine_id, event_type, error_code, payload_json)
       VALUES
         (NOW() - INTERVAL '2 hours', $1, 'BOOT', NULL, '{"reset_reason":"ESP_RST_POWERON","rssi":-61,"free_heap":192000,"details":{"min_free_heap":175000}}'::jsonb),
         (NOW() - INTERVAL '90 minutes', $1, 'CRASH_RESET', 'ERR_BROWNOUT_RESET', '{"reset_reason":"ESP_RST_BROWNOUT","rssi":-74,"free_heap":164000,"subsystem":"power","message":"Brownout reboot","details":{"min_free_heap":132000}}'::jsonb),
         (NOW() - INTERVAL '45 minutes', $1, 'SUBSYSTEM_TIMEOUT', 'ERR_SUBSYSTEM_TIMEOUT', '{"subsystem":"traverse_stepper","rssi":-82,"free_heap":158000,"message":"Stepper ack timeout"}'::jsonb),
         (NOW() - INTERVAL '15 minutes', $2, 'HEARTBEAT', NULL, '{"rssi":-63,"free_heap":188400,"details":{"min_free_heap":168000}}'::jsonb)`,
      [m1, m2],
    );

    await ctx.db.query(
      `INSERT INTO coil_outcomes (machine_id, outcome, reason_code, duration_sec, wound_length, created_at)
       VALUES
         ($1, 'AUTO_FINISHED', NULL, 150, 125.5, NOW() - INTERVAL '3 hours'),
         ($1, 'ABORTED', 'OPERATOR_ABORT', 45, 38.0, NOW() - INTERVAL '2 hours'),
         ($1, 'FAULT_TERMINATED', 'ERR_FIBER_SNAP', 62, 54.25, NOW() - INTERVAL '1 hour'),
         ($2, 'AUTO_FINISHED', NULL, 142, 118.75, NOW() - INTERVAL '30 minutes')`,
      [m1, m2],
    );

    await ctx.db.query(
      `INSERT INTO bug_reports (machine_id, error_code, tag, worker_note, status, created_at)
       VALUES ($1, 'ERR_FIBER_SNAP', 'Fiber Snap', 'Snapped at tension roller', 'OPEN', NOW() - INTERVAL '10 minutes')`,
      [m1],
    );
  });

  afterAll(async () => {
    if (ctx && createdMachineIds.length > 0) {
      await ctx.db.query('DELETE FROM machines WHERE id = ANY($1)', [
        createdMachineIds.splice(0),
      ]);
    }
    await ctx?.close();
  });

  it('executes every template variable and panel rawSql query in both dashboards without errors', async () => {
    const dashboards = [
      readDashboard('esp32-firmware-health.json').parsed,
      readDashboard('winding-cycle-telemetry.json').parsed,
    ];
    const zones = ['NORTH_LEFT', 'MAIN_BANK'];

    for (const dashboard of dashboards) {
      for (const variable of dashboard.templating?.list ?? []) {
        if (variable.type === 'query' && variable.query) {
          const sql = substituteGrafanaMacros(variable.query, createdMachineIds, zones);
          const res = await ctx.db.query(sql);
          expect(res.rows.length).toBeGreaterThan(0);
        }
      }

      for (const panel of dashboard.panels) {
        for (const target of panel.targets ?? []) {
          const sql = substituteGrafanaMacros(target.rawSql ?? '', createdMachineIds, zones);
          const res = await ctx.db.query(sql);
          expect(
            res.rows.length,
            `Expected non-empty rows for "${dashboard.uid}" panel #${panel.id} (${panel.title}) ref ${target.refId}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});

import type { FleetAuthUser } from '../auth/cloudflare-access.js';
import type { CoilRollupCounts } from '../services/coil-rollups.js';
import type { FirmwareReleaseRecord } from '../services/firmware.js';
import type {
  FleetHistoryItem,
  FleetSummaryResult,
} from '../services/fleet.js';
import type { GlossaryEntry } from '../services/glossary.js';
import type { MachineRecord } from '../services/machines.js';
import type { PendingUpdateRecord } from '../services/pending-updates.js';
import type { PresetRecord } from '../services/presets.js';
import {
  MACHINE_STATES,
  type MachineState,
} from '../spec/mqtt-contract.js';
import { FLEET_CLIENT_SCRIPT } from './fleet/fleet-client-script.js';
import { FLEET_DRAWER_CONTROLS_SCRIPT } from './fleet/fleet-drawer-controls-script.js';
import { FLEET_OTA_CLIENT_SCRIPT } from './fleet/fleet-ota-client-script.js';
import {
  renderFloorBatchToolbarHtml,
  renderOtaManagementTabPanelHtml,
} from './fleet/fleet-ota-panel.js';
import { FLEET_STYLES } from './fleet/fleet-styles.js';
import { FLEET_TRIAGE_CLIENT_SCRIPT } from './fleet/fleet-triage-client-script.js';
import {
  renderGlossaryPopoverHtml,
  renderRepeatFaultBannerHtml,
  renderTriageBoardHtml,
  renderTriageToolbarHtml,
} from './fleet/fleet-triage-view.js';
import {
  FLOOR_SECTION_META,
  deriveToolLabel,
  renderWorkshopFloorPlan,
  resolveMachineFloorSection,
} from './fleet/floor-plan.js';
import { renderMarkdownToHtml } from './markdown.js';
import { escapeHtml, renderStatusBadge } from './portal-layout.js';
import { formatTimestampUtc } from './recent-errors-section.js';

/**
 * Initial server-rendered snapshot passed into the `/fleet` Department Heads PWA layout.
 */
export interface FleetPageViewModel {
  user: FleetAuthUser;
  summary: FleetSummaryResult;
  machines: MachineRecord[];
  history: FleetHistoryItem[];
  glossary: GlossaryEntry[];
  releases?: FirmwareReleaseRecord[];
  presets?: PresetRecord[];
  updates?: PendingUpdateRecord[];
}

const ROLLUP_WINDOW_LABELS: Record<CoilRollupCounts['window'], string> = {
  TODAY: 'Today',
  WEEK: 'Week',
  MONTH: 'Month',
  ALL_TIME: 'All-Time',
};

function serializeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function formatWoundLength(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(safe * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function renderHistoryItemsHtml(items: readonly FleetHistoryItem[]): string {
  if (items.length === 0) {
    return '<li class="card"><p class="machine-meta empty-state-note">No room-wide fault events or bug reports match the selected filters.</p></li>';
  }

  return items
    .map((item) => {
      const timeLabel = formatTimestampUtc(item.time);
      const sec = resolveMachineFloorSection({
        id: item.machine_id,
        floor_position: item.floor_position,
      });
      const sectionTitle = FLOOR_SECTION_META[sec].title;
      const toolLabel = deriveToolLabel(item.machine_id, item.floor_position);
      const hwPillHtml = item.hardware_id
        ? `<span class="zone-pill">${escapeHtml(item.hardware_id)}</span>`
        : '';

      if (item.kind === 'error_event') {
        const badgeLabel = item.error_code ?? item.event_type;
        const titleText = item.glossary_title
          ? `${item.glossary_title}${item.summary && item.summary !== item.glossary_title ? ` — ${item.summary}` : ''}`
          : item.summary;

        const badgeHtml = item.error_code
          ? `<button type="button" class="error-code-pill" data-glossary-code="${escapeHtml(item.error_code)}">&#9650; ${escapeHtml(badgeLabel)}</button>`
          : `<span class="status-badge status-error"><span class="badge-icon" aria-hidden="true">&#9650;</span><code>${escapeHtml(badgeLabel)}</code></span>`;

        return `<li class="card history-item history-error-item">
          <div class="history-item-top">
            <div class="history-badges">
              ${badgeHtml}
              <button type="button" class="history-machine-btn" data-open-machine="${escapeHtml(item.machine_id)}">${escapeHtml(toolLabel)} &middot; ${escapeHtml(item.machine_id)} &middot; ${escapeHtml(item.machine_display_name)}</button>
              <span class="zone-pill">${escapeHtml(sectionTitle)}</span>
              ${hwPillHtml}
            </div>
            <time class="last-seen" datetime="${escapeHtml(item.time)}">${escapeHtml(timeLabel)}</time>
          </div>
          <p class="history-body">${escapeHtml(titleText)}</p>
        </li>`;
      }

      const errorTagHtml = item.error_code
        ? `<code class="history-inline-code">${escapeHtml(item.error_code)}</code>`
        : '';
      const noteHtml = item.worker_note
        ? `<p class="history-body">${escapeHtml(item.worker_note)}</p>`
        : '<p class="machine-meta empty-state-note">No worker note attached.</p>';

      return `<li class="card history-item history-bug-item">
        <div class="history-item-top">
          <div class="history-badges">
            <span class="bug-tag-pill">Bug #${item.bug_report_id}: ${escapeHtml(item.tag)}</span>
            ${errorTagHtml}
            <button type="button" class="history-machine-btn" data-open-machine="${escapeHtml(item.machine_id)}">${escapeHtml(toolLabel)} &middot; ${escapeHtml(item.machine_id)} &middot; ${escapeHtml(item.machine_display_name)}</button>
            <span class="zone-pill">${escapeHtml(sectionTitle)}</span>
            ${hwPillHtml}
          </div>
          <time class="last-seen" datetime="${escapeHtml(item.time)}">${escapeHtml(timeLabel)}</time>
        </div>
        ${noteHtml}
      </li>`;
    })
    .join('');
}

function renderGlossaryListHtml(entries: readonly GlossaryEntry[]): string {
  if (entries.length === 0) {
    return '<li class="card"><p class="machine-meta empty-state-note">No fault glossary entries matched your search.</p></li>';
  }

  return entries
    .map(
      (entry) => `<li class="card glossary-card">
        <div class="glossary-card-header">
          <h3>${escapeHtml(entry.title)}</h3>
          <code>${escapeHtml(entry.error_code)}</code>
        </div>
        <p class="glossary-symptoms"><strong>Symptoms:</strong> ${escapeHtml(entry.symptoms)}</p>
        <div class="fix-steps">${renderMarkdownToHtml(entry.fix_steps_md)}</div>
      </li>`,
    )
    .join('');
}

/**
 * Render the complete zero-CDN server-side HTML document for the Department Heads `/fleet` PWA.
 */
export function renderFleetDashboardPage(model: FleetPageViewModel): string {
  const { user, summary, machines, history, glossary } = model;
  const releases = model.releases ?? [];
  const presets = model.presets ?? [];
  const updates = model.updates ?? [];
  const counts = summary.machine_counts;
  const defaultBucket =
    summary.coil_rollups.find((bucket) => bucket.window === 'TODAY') ??
    summary.coil_rollups[0] ?? {
      window: 'TODAY' as const,
      auto_finished_count: 0,
      aborted_count: 0,
      fault_terminated_count: 0,
      total_count: 0,
      total_wound_length: 0,
    };

  const authSummary =
    user.source === 'cloudflare-access'
      ? `Authenticated as ${user.email}`
      : 'Factory Workshop Local Console (LAN Zero-Login)';
  const accessBadgeLabel =
    user.source === 'cloudflare-access' ? 'Remote · Cloudflare Access' : 'LAN · Zero-Login';
  const accessBadgeMode = user.source === 'cloudflare-access' ? 'remote' : 'lan';
  const autoRate =
    defaultBucket.total_count > 0
      ? Math.round((defaultBucket.auto_finished_count / defaultBucket.total_count) * 100)
      : 0;

  const stripZone = <T extends Record<string, unknown>>(row: T): Omit<T, 'zone'> => {
    const { zone: _ignoredZone, ...rest } = row;
    return rest;
  };

  const bootstrapPayload = serializeJsonForScript({
    summary,
    machines: machines.map((m) => stripZone({ ...m })),
    history: history.map((h) => stripZone({ ...h })),
    glossary,
    releases,
    presets,
    updates,
  });

  const filterStatePills = [
    { key: 'ALL', label: 'All', count: counts.total, symbol: '' },
    { key: 'WORKING', label: 'Working', count: counts.WORKING, symbol: '&#9679;' },
    { key: 'IDLE', label: 'Idle', count: counts.IDLE, symbol: '&#9680;' },
    { key: 'ERROR', label: 'Error', count: counts.ERROR, symbol: '&#9650;' },
    { key: 'OFFLINE', label: 'Offline', count: counts.OFFLINE, symbol: '&#10005;' },
  ] as const;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0b1120">
  <link rel="manifest" href="/fleet/manifest.webmanifest">
  <title>Winding Room Fleet | Department Heads PWA</title>
  <style>${FLEET_STYLES}</style>
</head>
<body>
  <div class="fleet-shell">
    <header class="fleet-header">
      <div class="fleet-brand-wrap">
        <span class="brand-badge" aria-hidden="true">MCU</span>
        <div class="fleet-title-group">
          <div class="fleet-title-row">
            <h1>Winding Room Fleet</h1>
            <span class="access-pill" id="fleet-access-pill" data-access-mode="${accessBadgeMode}">${escapeHtml(accessBadgeLabel)}</span>
          </div>
          <p class="fleet-meta-line">
            <span>${escapeHtml(authSummary)}</span>
            <span>Last updated: <time id="fleet-last-updated" datetime="${escapeHtml(summary.generated_at)}">${escapeHtml(formatTimestampUtc(summary.generated_at))}</time></span>
          </p>
        </div>
      </div>
      <div class="fleet-header-actions">
        <button type="button" id="fleet-poll-toggle-btn" class="poll-toggle-btn" data-paused="false" aria-pressed="false" title="Pause or resume 10s live polling">
          <span class="poll-dot-wrap" aria-hidden="true">
            <span class="poll-dot-ping"></span>
            <span class="poll-dot"></span>
          </span>
          <span id="fleet-poll-countdown">Live (10s)</span>
        </button>
        <button type="button" id="fleet-refresh-btn" class="btn btn-primary">Refresh Now</button>
        <a class="nav-link" href="/">Worker Directory</a>
      </div>
    </header>

    <div id="fleet-auth-alert" class="card auth-alert" role="alert" hidden>
      Session expired or unauthorized. <a href="/fleet">Reload page</a> to sign in again through Cloudflare Access.
    </div>

    <section class="summary-strip" aria-label="Fleet status and winding cycle summary">
      <div class="card">
        <div class="state-counts-grid">
          <button type="button" class="metric-box kpi-filter-card" data-kpi-filter="ALL" aria-pressed="true">
            <span class="metric-label">Total Winders</span>
            <span class="metric-value" id="count-total">${counts.total}</span>
          </button>
          <button type="button" class="metric-box kpi-filter-card status-working" data-kpi-filter="WORKING" aria-pressed="false">
            <span class="metric-label"><span aria-hidden="true">&#9679;</span> Working</span>
            <span class="metric-value" id="count-working">${counts.WORKING}</span>
          </button>
          <button type="button" class="metric-box kpi-filter-card status-idle" data-kpi-filter="IDLE" aria-pressed="false">
            <span class="metric-label"><span aria-hidden="true">&#9680;</span> Idle</span>
            <span class="metric-value" id="count-idle">${counts.IDLE}</span>
          </button>
          <button type="button" class="metric-box kpi-filter-card status-error" data-kpi-filter="ERROR" aria-pressed="false">
            <span class="metric-label"><span aria-hidden="true">&#9650;</span> Error</span>
            <span class="metric-value" id="count-error">${counts.ERROR}</span>
          </button>
          <button type="button" class="metric-box kpi-filter-card status-offline" data-kpi-filter="OFFLINE" aria-pressed="false">
            <span class="metric-label"><span aria-hidden="true">&#10005;</span> Offline</span>
            <span class="metric-value" id="count-offline">${counts.OFFLINE}</span>
          </button>
          <button type="button" class="metric-box kpi-filter-card kpi-bugs" data-kpi-filter="BUGS" aria-pressed="false">
            <span class="metric-label">Open Bugs</span>
            <span class="metric-value" id="count-open-bugs">${summary.open_bug_reports}</span>
          </button>
        </div>
      </div>

      <div class="card">
        <div class="coil-summary-header">
          <div>
            <h2>Winding Cycles (ESP32)</h2>
            <span class="machine-meta" id="coil-total-cycles">${defaultBucket.total_count} cycles</span>
          </div>
          <div class="window-toggle-group" role="group" aria-label="Winding cycle summary time window">
            ${summary.coil_rollups
              .map(
                (bucket) => `<button type="button" class="window-btn" data-coil-window="${escapeHtml(bucket.window)}" aria-pressed="${bucket.window === 'TODAY' ? 'true' : 'false'}">${escapeHtml(ROLLUP_WINDOW_LABELS[bucket.window])}</button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="coil-metrics-row">
          <div class="metric-box status-working">
            <span class="metric-label">Auto-Finished</span>
            <div class="coil-value-row">
              <span class="metric-value" id="coil-auto-finished">${defaultBucket.auto_finished_count}</span>
              <span class="coil-rate-pill" id="coil-auto-rate">${autoRate}%</span>
            </div>
          </div>
          <div class="metric-box status-idle">
            <span class="metric-label">Aborted</span>
            <span class="metric-value" id="coil-aborted">${defaultBucket.aborted_count}</span>
          </div>
          <div class="metric-box status-error">
            <span class="metric-label">Fault-Stopped</span>
            <span class="metric-value" id="coil-fault-terminated">${defaultBucket.fault_terminated_count}</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Wound Fiber</span>
            <span class="metric-value" id="coil-wound-length">${escapeHtml(formatWoundLength(defaultBucket.total_wound_length))}</span>
          </div>
        </div>
      </div>
    </section>

    <div class="fleet-tablist" role="tablist" focusgroup="tablist nomemory" aria-label="Fleet views">
      <button type="button" role="tab" id="tab-map" data-tab="map" aria-selected="true" focusgroupstart>Floor Map</button>
      <button type="button" role="tab" id="tab-history" data-tab="history" aria-selected="false">Room History</button>
      <button type="button" role="tab" id="tab-glossary" data-tab="glossary" aria-selected="false">Master Glossary</button>
      <button type="button" role="tab" id="tab-ota" data-tab="ota" aria-selected="false">Firmware &amp; Presets</button>
    </div>

    <div class="tabpanels-stack">
      <div role="tabpanel" id="panel-map" aria-labelledby="tab-map" tabindex="0">
        <div class="tabpanel-body">
          ${renderRepeatFaultBannerHtml(history)}
          ${renderTriageToolbarHtml(machines.length)}

          <div class="card filter-bar">
            <div class="filter-pills" role="group" aria-label="Filter floor map by status">
              ${filterStatePills
                .map(
                  (pill) => `<button type="button" class="filter-pill" data-filter-state="${pill.key}" aria-pressed="${pill.key === 'ALL' ? 'true' : 'false'}">${pill.symbol ? `<span aria-hidden="true">${pill.symbol}</span>` : ''}<span>${pill.label}</span><span data-pill-count="${pill.key}">${pill.count}</span></button>`,
                )
                .join('')}
            </div>
          </div>

          ${renderFloorBatchToolbarHtml(releases, presets)}
          ${renderTriageBoardHtml(machines, history)}
          <div id="fleet-blueprint-view" hidden>
            ${renderWorkshopFloorPlan(machines)}
          </div>
        </div>
      </div>

      <div role="tabpanel" id="panel-history" aria-labelledby="tab-history" hidden="until-found">
        <div class="tabpanel-body">
          <form id="history-filter-form" class="card history-controls">
            <div class="control-field">
              <label for="history-kind">Record Type</label>
              <select id="history-kind" name="kind">
                <option value="all">All Faults &amp; Bug Reports</option>
                <option value="errors">Fault Events Only</option>
                <option value="bug_reports">Bug Reports Only</option>
              </select>
            </div>
            <div class="control-field">
              <label for="history-machine">Machine ID</label>
              <input id="history-machine" name="machineId" type="search" placeholder="e.g. W-01" autocapitalize="characters" spellcheck="false">
            </div>
            <button type="submit" class="btn btn-primary">Filter</button>
            <button type="button" id="history-reset-btn" class="btn">Reset</button>
          </form>

          <ul id="fleet-history-list" class="history-list" role="list">
            ${renderHistoryItemsHtml(history)}
          </ul>
        </div>
      </div>

      <div role="tabpanel" id="panel-glossary" aria-labelledby="tab-glossary" hidden="until-found">
        <div class="tabpanel-body">
          <search class="card">
            <form id="fleet-glossary-form" class="glossary-controls">
              <div class="control-field">
                <label for="fleet-glossary-search">Search Master Fault Glossary</label>
                <input id="fleet-glossary-search" type="search" placeholder="Keyword, symptom, or error_code (e.g. ERR_FIBER_SNAP)" spellcheck="false">
              </div>
              <button type="submit" class="btn btn-primary">Search</button>
            </form>
          </search>

          <ul id="fleet-glossary-list" class="glossary-list" role="list">
            ${renderGlossaryListHtml(glossary)}
          </ul>
        </div>
      </div>

      ${renderOtaManagementTabPanelHtml(releases, presets, updates)}
    </div>
  </div>

  <dialog id="machine-drawer" class="machine-drawer" closedby="any" aria-labelledby="drawer-title">
    <div class="drawer-header">
      <h2 id="drawer-title">Machine Details</h2>
      <div class="drawer-header-actions">
        <button type="button" id="drawer-prev-error-btn" class="drawer-step-btn" title="Previous Error Machine (Left Arrow)" aria-label="Previous Error Machine">&lsaquo;</button>
        <button type="button" id="drawer-next-error-btn" class="drawer-step-btn" title="Next Error Machine (Right Arrow)" aria-label="Next Error Machine">&rsaquo;</button>
        <form method="dialog">
          <button type="submit" class="btn" autofocus>Close</button>
        </form>
      </div>
    </div>
    <div class="drawer-hotkey-bar">
      <span id="drawer-error-count">Use &larr; / &rarr; arrows to step through active errors</span>
      <span>ESP32 Pico</span>
    </div>
    <div id="drawer-body" class="drawer-body">
      <p class="machine-meta">Select any machine on the floor map to inspect live diagnostics.</p>
    </div>
  </dialog>

  ${renderGlossaryPopoverHtml()}

  <script type="application/json" id="fleet-bootstrap-data">${bootstrapPayload}</script>
  <script>${FLEET_CLIENT_SCRIPT}</script>
  <script>${FLEET_OTA_CLIENT_SCRIPT}</script>
  <script>${FLEET_DRAWER_CONTROLS_SCRIPT}</script>
  <script>${FLEET_TRIAGE_CLIENT_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Helper used to verify valid MachineState keys at compile time without unused exports.
 */
export function isKnownMachineState(value: string): value is MachineState {
  return (MACHINE_STATES as readonly string[]).includes(value);
}

export { renderStatusBadge };

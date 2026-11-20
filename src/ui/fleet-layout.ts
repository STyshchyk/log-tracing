import type { FleetAuthUser } from '../auth/cloudflare-access.js';
import type { CoilRollupCounts } from '../services/coil-rollups.js';
import type {
  FleetHistoryItem,
  FleetSummaryResult,
} from '../services/fleet.js';
import type { GlossaryEntry } from '../services/glossary.js';
import type { MachineRecord } from '../services/machines.js';
import {
  FLOOR_ZONES,
  MACHINE_STATES,
  type FloorZone,
  type MachineState,
} from '../spec/mqtt-contract.js';
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
}

const ZONE_META: Record<FloorZone, { title: string; areaClass: string }> = {
  NORTH_LEFT: { title: 'North Left Bay', areaClass: 'zone-north-left' },
  NORTH_RIGHT: { title: 'North Right Bay', areaClass: 'zone-north-right' },
  MAIN_BANK: { title: 'Main Bank', areaClass: 'zone-main-bank' },
  EAST_DOOR: { title: 'East Door Bay', areaClass: 'zone-east-door' },
};

const STATE_SYMBOLS: Record<MachineState, string> = {
  WORKING: '&#9679;',
  IDLE: '&#9680;',
  ERROR: '&#9650;',
  OFFLINE: '&#10005;',
};

const STATE_CSS_CLASSES: Record<MachineState, string> = {
  WORKING: 'status-working',
  IDLE: 'status-idle',
  ERROR: 'status-error',
  OFFLINE: 'status-offline',
};

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

function renderZoneBay(zone: FloorZone, machines: readonly MachineRecord[]): string {
  const meta = ZONE_META[zone];
  const zoneMachines = machines.filter((machine) => machine.zone === zone);
  const maxCol = zoneMachines.reduce(
    (highest, machine) => Math.max(highest, machine.grid_col),
    1,
  );

  const nodesHtml =
    zoneMachines.length === 0
      ? '<p class="machine-meta empty-zone-note">No machines assigned to this bay yet.</p>'
      : `<div class="zone-grid" style="--zone-cols: ${maxCol};">${zoneMachines
          .map((machine) => {
            const symbol = STATE_SYMBOLS[machine.current_state];
            const stateClass = STATE_CSS_CLASSES[machine.current_state];
            const errorHtml = machine.active_error
              ? `<span class="node-error-code">${escapeHtml(machine.active_error)}</span>`
              : '';

            return `<button
              type="button"
              class="map-node ${stateClass}"
              style="grid-row: ${machine.grid_row}; grid-column: ${machine.grid_col};"
              data-machine-id="${escapeHtml(machine.id)}"
              data-state="${escapeHtml(machine.current_state)}"
              data-zone="${escapeHtml(machine.zone)}"
              aria-label="${escapeHtml(`${machine.id} ${machine.display_name}, ${machine.current_state}${machine.active_error ? `, active error ${machine.active_error}` : ''}`)}"
            >
              <span class="node-top">
                <strong class="node-id">${escapeHtml(machine.id)}</strong>
                <span class="badge-icon" aria-hidden="true">${symbol}</span>
              </span>
              <span class="node-state-label">${escapeHtml(machine.current_state)}</span>
              ${errorHtml}
            </button>`;
          })
          .join('')}</div>`;

  return `<section class="card zone-bay ${meta.areaClass}" data-zone="${escapeHtml(zone)}" aria-labelledby="zone-heading-${escapeHtml(zone)}">
    <div class="zone-header">
      <h2 id="zone-heading-${escapeHtml(zone)}">${escapeHtml(meta.title)}</h2>
      <span class="zone-count" data-zone-count="${escapeHtml(zone)}">${zoneMachines.length}</span>
    </div>
    ${nodesHtml}
  </section>`;
}

export function renderHistoryItemsHtml(items: readonly FleetHistoryItem[]): string {
  if (items.length === 0) {
    return '<li class="card"><p class="machine-meta empty-state-note">No room-wide fault events or bug reports match the selected filters.</p></li>';
  }

  return items
    .map((item) => {
      const timeLabel = formatTimestampUtc(item.time);
      const zoneTitle = ZONE_META[item.zone]?.title ?? item.zone;

      if (item.kind === 'error_event') {
        const badgeLabel = item.error_code ?? item.event_type;
        const titleText = item.glossary_title
          ? `${item.glossary_title}${item.summary && item.summary !== item.glossary_title ? ` — ${item.summary}` : ''}`
          : item.summary;

        return `<li class="card history-item history-error-item">
          <div class="history-item-top">
            <div class="history-badges">
              <span class="status-badge status-error"><span class="badge-icon" aria-hidden="true">&#9650;</span><code>${escapeHtml(badgeLabel)}</code></span>
              <button type="button" class="history-machine-btn" data-open-machine="${escapeHtml(item.machine_id)}">${escapeHtml(item.machine_id)} &middot; ${escapeHtml(item.machine_display_name)}</button>
              <span class="zone-pill">${escapeHtml(zoneTitle)}</span>
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
            <button type="button" class="history-machine-btn" data-open-machine="${escapeHtml(item.machine_id)}">${escapeHtml(item.machine_id)} &middot; ${escapeHtml(item.machine_display_name)}</button>
            <span class="zone-pill">${escapeHtml(zoneTitle)}</span>
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

const FLEET_STYLES = `
@layer base, components;

@layer base {
  :root {
    color-scheme: light dark;
    --bg: #f4f6f8;
    --surface: #ffffff;
    --surface-subtle: #edf1f5;
    --text: #111827;
    --text-muted: #4b5563;
    --border: #9ca3af;
    --focus-ring: #0b57d0;
    --accent-primary: #0f4c81;
    --accent-primary-hover: #0b3a63;
    --accent-primary-text: #ffffff;
    --working-bg: #e6f4ea;
    --working-text: #0d5c2d;
    --working-border: #1e7e44;
    --idle-bg: #fef7e0;
    --idle-text: #7a4f01;
    --idle-border: #b06e00;
    --error-bg: #fce8e6;
    --error-text: #a50e0e;
    --error-border: #c5221f;
    --offline-bg: #f1f3f4;
    --offline-text: #3c4043;
    --offline-border: #5f6368;
    --target-min: 48px;
  }

  @media (pointer: coarse) {
    :root {
      --target-min: 52px;
    }
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1419;
      --surface: #1a2129;
      --surface-subtle: #242d38;
      --text: #f3f4f6;
      --text-muted: #cbd5e1;
      --border: #64748b;
      --focus-ring: #7cb3ff;
      --accent-primary: #2563eb;
      --accent-primary-hover: #1d4ed8;
      --accent-primary-text: #ffffff;
      --working-bg: #0f2f1c;
      --working-text: #86efac;
      --working-border: #22c55e;
      --idle-bg: #332404;
      --idle-text: #fde68a;
      --idle-border: #f59e0b;
      --error-bg: #3b1214;
      --error-text: #fca5a5;
      --error-border: #ef4444;
      --offline-bg: #1f2937;
      --offline-text: #d1d5db;
      --offline-border: #9ca3af;
    }
  }

  html {
    box-sizing: border-box;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-block-size: 100dvh;
    background-color: var(--bg);
    color: var(--text);
    overflow-wrap: break-word;
    padding-block-start: max(0.75rem, env(safe-area-inset-top, 0px));
    padding-block-end: max(1.5rem, env(safe-area-inset-bottom, 0px));
    padding-inline-start: max(1rem, env(safe-area-inset-left, 0px));
    padding-inline-end: max(1rem, env(safe-area-inset-right, 0px));
  }

  :where(h1, h2, h3) {
    margin-block-start: 0;
    line-height: 1.25;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.92em;
    background-color: var(--surface-subtle);
    padding: 0.1em 0.35em;
    border-radius: 0.25rem;
  }

  :where(a:any-link, button, input, select, [tabindex="0"]):focus-visible {
    outline: 3px solid var(--focus-ring);
    outline-offset: 2px;
  }

  :where(button, select, input[type="search"], input[type="text"], .nav-link) {
    min-block-size: var(--target-min);
  }
}

@layer components {
  .fleet-shell {
    max-inline-size: 80rem;
    margin-inline: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .fleet-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .fleet-title-group h1 {
    margin: 0;
    font-size: clamp(1.45rem, 1.15rem + 1.2vw, 2rem);
  }

  .fleet-meta-line {
    margin: 0.2rem 0 0;
    color: var(--text-muted);
    font-size: 0.9rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
  }

  .fleet-header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .btn,
  .nav-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.55rem 0.95rem;
    border-radius: 0.55rem;
    border: 2px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
  }

  .btn-primary {
    background-color: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--accent-primary-text);
  }

  .btn-primary:hover {
    background-color: var(--accent-primary-hover);
  }

  .card {
    background-color: var(--surface);
    border: 2px solid var(--border);
    border-radius: 0.75rem;
    padding: 1rem;
  }

  .auth-alert {
    border-color: var(--error-border);
    background-color: var(--error-bg);
    color: var(--error-text);
    font-weight: 600;
  }

  .summary-strip {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.9rem;
  }

  @media (min-width: 900px) {
    .summary-strip {
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    }
  }

  .state-counts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.25rem, 1fr));
    gap: 0.6rem;
  }

  .metric-box {
    border: 2px solid var(--border);
    border-radius: 0.6rem;
    padding: 0.65rem 0.75rem;
    background-color: var(--surface-subtle);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .metric-label {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .metric-value {
    font-size: 1.55rem;
    font-weight: 800;
    line-height: 1.15;
  }

  .status-working {
    background-color: var(--working-bg);
    color: var(--working-text);
    border-color: var(--working-border);
  }

  .status-idle {
    background-color: var(--idle-bg);
    color: var(--idle-text);
    border-color: var(--idle-border);
  }

  .status-error {
    background-color: var(--error-bg);
    color: var(--error-text);
    border-color: var(--error-border);
  }

  .status-offline {
    background-color: var(--offline-bg);
    color: var(--offline-text);
    border-color: var(--offline-border);
  }

  .coil-summary-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-block-end: 0.7rem;
  }

  .coil-summary-header h2 {
    margin: 0;
    font-size: 1.05rem;
  }

  .window-toggle-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .window-btn {
    min-inline-size: 48px;
    padding: 0.35rem 0.65rem;
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    background-color: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 700;
    cursor: pointer;
  }

  .window-btn[aria-pressed="true"] {
    background-color: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--accent-primary-text);
  }

  .coil-metrics-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
  }

  @media (max-width: 520px) {
    .coil-metrics-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .fleet-tablist {
    display: flex;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 0.25rem;
    border-block-end: 2px solid var(--border);
    scrollbar-width: thin;
  }

  [role="tab"] {
    flex: none;
    position: relative;
    padding: 0.65rem 1.05rem;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }

  [role="tab"][aria-selected="true"] {
    color: var(--accent-primary);
  }

  [role="tab"][aria-selected="true"]::after {
    content: "";
    position: absolute;
    inset: auto 0 0;
    border-block-end: 3px solid var(--accent-primary);
  }

  .tabpanels-stack {
    display: block;
  }

  .tabpanel-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-block-start: 0.25rem;
  }

  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
  }

  .filter-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .filter-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 0.85rem;
    border-radius: 999px;
    border: 2px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.92rem;
    font-weight: 700;
    cursor: pointer;
  }

  .filter-pill[aria-pressed="true"] {
    background-color: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--accent-primary-text);
  }

  .floor-layout-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  @media (min-width: 780px) {
    .floor-layout-grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(13rem, 0.52fr);
      grid-template-areas:
        "north-left north-right east-door"
        "floor-note main-bank   east-door";
      align-items: start;
    }

    .zone-north-left { grid-area: north-left; }
    .zone-north-right { grid-area: north-right; }
    .zone-main-bank { grid-area: main-bank; }
    .zone-east-door { grid-area: east-door; }
  }

  .zone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-block-end: 0.75rem;
  }

  .zone-header h2 {
    margin: 0;
    font-size: 1.08rem;
  }

  .zone-count {
    font-weight: 800;
    font-size: 0.9rem;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    background-color: var(--surface-subtle);
    border: 1px solid var(--border);
  }

  .zone-grid {
    display: grid;
    grid-template-columns: repeat(var(--zone-cols, 1), minmax(0, 1fr));
    gap: 0.5rem;
  }

  @media (max-width: 560px) {
    .zone-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .zone-grid .map-node {
      grid-row: auto !important;
      grid-column: auto !important;
    }
  }

  .map-node {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.18rem;
    min-block-size: 52px;
    min-inline-size: 0;
    padding: 0.45rem 0.55rem;
    border-radius: 0.6rem;
    border: 2px solid var(--border);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .map-node[hidden] {
    display: none;
  }

  .zone-bay[data-empty-filtered="true"] {
    opacity: 0.65;
  }

  .node-top {
    inline-size: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem;
  }

  .node-id {
    font-size: 0.92rem;
  }

  .node-state-label {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .node-error-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.72rem;
    font-weight: 700;
    max-inline-size: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-controls,
  .glossary-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    align-items: flex-end;
  }

  .control-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-inline-size: 9rem;
    flex: 1 1 10rem;
  }

  .control-field label {
    font-weight: 700;
    font-size: 0.88rem;
  }

  .control-field select,
  .control-field input {
    font: inherit;
    padding: 0.5rem 0.65rem;
    border-radius: 0.5rem;
    border: 2px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
  }

  .history-list,
  .glossary-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .history-item-top,
  .glossary-card-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .history-badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    border: 2px solid currentColor;
    font-weight: 700;
    font-size: 0.85rem;
  }

  .bug-tag-pill,
  .zone-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background-color: var(--surface-subtle);
    font-size: 0.85rem;
    font-weight: 700;
  }

  .history-machine-btn {
    padding: 0.3rem 0.65rem;
    min-block-size: 40px;
    border-radius: 0.5rem;
    border: 2px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
  }

  .history-body {
    margin: 0.45rem 0 0;
  }

  .machine-meta {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.92rem;
  }

  .last-seen {
    color: var(--text-muted);
    font-size: 0.88rem;
  }

  .glossary-card {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .glossary-card h3 {
    margin: 0;
  }

  .glossary-symptoms {
    margin: 0;
  }

  .fix-steps :is(p, ol, ul) {
    margin-block: 0.35rem;
  }

  .fix-steps :is(ol, ul) {
    padding-inline-start: 1.35rem;
  }

  dialog.machine-drawer {
    margin: 0 0 0 auto;
    block-size: 100dvh;
    max-block-size: 100dvh;
    inline-size: min(32rem, 100vw);
    max-inline-size: 100vw;
    border: 0;
    border-inline-start: 2px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    padding: 1.15rem;
    box-shadow: -8px 0 28px rgba(0, 0, 0, 0.25);
  }

  dialog.machine-drawer[open] {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  dialog.machine-drawer:modal {
    overscroll-behavior: contain;
  }

  dialog.machine-drawer::backdrop {
    overflow: hidden;
    overscroll-behavior: contain;
    background-color: rgba(15, 23, 42, 0.55);
  }

  .drawer-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    border-block-end: 1px solid var(--border);
    padding-block-end: 0.75rem;
  }

  .drawer-header h2 {
    margin: 0;
  }

  .drawer-body {
    flex: 1 1 auto;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .drawer-section {
    border: 1px solid var(--border);
    border-radius: 0.65rem;
    padding: 0.85rem;
    background-color: var(--surface-subtle);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .drawer-section h3 {
    margin: 0;
    font-size: 1rem;
  }

  .rollup-table {
    inline-size: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .rollup-table th,
  .rollup-table td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-block-end: 1px solid var(--border);
  }

  .drawer-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .drawer-list li {
    padding: 0.55rem;
    border-radius: 0.45rem;
    border: 1px solid var(--border);
    background-color: var(--surface);
  }

  .drawer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  @media (forced-colors: active) {
    .card,
    .btn,
    .nav-link,
    .map-node,
    .filter-pill,
    .window-btn,
    .metric-box,
    dialog.machine-drawer {
      border-color: CanvasText;
    }

    [role="tab"][aria-selected="true"]::after {
      border-block-end-color: Highlight;
    }
  }
}
`;

const FLEET_CLIENT_SCRIPT = `
(() => {
  const bootstrapEl = document.getElementById('fleet-bootstrap-data');
  if (!bootstrapEl) return;

  const state = {
    selectedWindow: 'TODAY',
    selectedFilterState: 'ALL',
    activeTab: 'map',
    summary: null,
    machines: [],
    openMachineId: null,
    authPaused: false,
  };

  try {
    const initial = JSON.parse(bootstrapEl.textContent || '{}');
    state.summary = initial.summary || null;
    state.machines = Array.isArray(initial.machines) ? initial.machines : [];
  } catch {
    return;
  }

  const STATE_SYMBOLS = {
    WORKING: '\\u25CF',
    IDLE: '\\u25D0',
    ERROR: '\\u25B2',
    OFFLINE: '\\u2715',
  };

  const STATE_CLASSES = {
    WORKING: 'status-working',
    IDLE: 'status-idle',
    ERROR: 'status-error',
    OFFLINE: 'status-offline',
  };

  const ZONE_TITLES = {
    NORTH_LEFT: 'North Left Bay',
    NORTH_RIGHT: 'North Right Bay',
    MAIN_BANK: 'Main Bank',
    EAST_DOOR: 'East Door Bay',
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function formatUtc(iso) {
    if (!iso) return 'Not yet reported';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  }

  function formatWoundLength(value) {
    const safe = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
    const normalized = Number.isFinite(safe) ? safe : 0;
    const rounded = Math.round(normalized * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function appendInlineCode(parent, text) {
    let cursor = 0;
    const str = String(text || '');
    while (cursor < str.length) {
      const open = str.indexOf('\`', cursor);
      if (open === -1) {
        parent.appendChild(document.createTextNode(str.slice(cursor)));
        break;
      }
      const close = str.indexOf('\`', open + 1);
      if (close === -1) {
        parent.appendChild(document.createTextNode(str.slice(cursor)));
        break;
      }
      if (open > cursor) {
        parent.appendChild(document.createTextNode(str.slice(cursor, open)));
      }
      parent.appendChild(el('code', '', str.slice(open + 1, close)));
      cursor = close + 1;
    }
  }

  function renderMarkdownSafe(markdown) {
    const container = el('div', 'fix-steps');
    const lines = String(markdown || '').replace(/\\r\\n?/g, '\\n').split('\\n');
    let listEl = null;
    let listTag = null;
    let paraLines = [];

    const flushPara = () => {
      if (paraLines.length > 0) {
        const p = el('p');
        appendInlineCode(p, paraLines.join(' '));
        container.appendChild(p);
        paraLines = [];
      }
    };
    const flushList = () => {
      if (listEl) {
        container.appendChild(listEl);
      }
      listEl = null;
      listTag = null;
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        flushPara();
        flushList();
        continue;
      }
      const ordered = /^\\s*\\d+\\.\\s+(.+)$/.exec(rawLine);
      if (ordered) {
        flushPara();
        if (listTag !== 'ol') {
          flushList();
          listTag = 'ol';
          listEl = document.createElement('ol');
        }
        const li = el('li');
        appendInlineCode(li, ordered[1].trim());
        listEl.appendChild(li);
        continue;
      }
      const bullet = /^\\s*[-*]\\s+(.+)$/.exec(rawLine);
      if (bullet) {
        flushPara();
        if (listTag !== 'ul') {
          flushList();
          listTag = 'ul';
          listEl = document.createElement('ul');
        }
        const li = el('li');
        appendInlineCode(li, bullet[1].trim());
        listEl.appendChild(li);
        continue;
      }
      flushList();
      paraLines.push(trimmed);
    }
    flushPara();
    flushList();
    return container;
  }

  function renderSummaryStrip() {
    if (!state.summary) return;
    const mc = state.summary.machine_counts || {};
    const countMap = {
      'count-total': mc.total ?? 0,
      'count-working': mc.WORKING ?? 0,
      'count-idle': mc.IDLE ?? 0,
      'count-error': mc.ERROR ?? 0,
      'count-offline': mc.OFFLINE ?? 0,
      'count-open-bugs': state.summary.open_bug_reports ?? 0,
    };
    for (const [id, val] of Object.entries(countMap)) {
      const target = document.getElementById(id);
      if (target) target.textContent = String(val);
    }

    const updatedEl = document.getElementById('fleet-last-updated');
    if (updatedEl && state.summary.generated_at) {
      updatedEl.textContent = formatUtc(state.summary.generated_at);
      updatedEl.setAttribute('datetime', state.summary.generated_at);
    }

    const pillCounts = {
      ALL: mc.total ?? 0,
      WORKING: mc.WORKING ?? 0,
      IDLE: mc.IDLE ?? 0,
      ERROR: mc.ERROR ?? 0,
      OFFLINE: mc.OFFLINE ?? 0,
    };
    for (const [key, val] of Object.entries(pillCounts)) {
      const span = document.querySelector('[data-pill-count="' + key + '"]');
      if (span) span.textContent = String(val);
    }

    const rollups = Array.isArray(state.summary.coil_rollups) ? state.summary.coil_rollups : [];
    const bucket = rollups.find((r) => r.window === state.selectedWindow) || rollups[0];
    if (bucket) {
      const autoEl = document.getElementById('coil-auto-finished');
      const abortEl = document.getElementById('coil-aborted');
      const faultEl = document.getElementById('coil-fault-terminated');
      const woundEl = document.getElementById('coil-wound-length');
      const totCyclesEl = document.getElementById('coil-total-cycles');
      if (autoEl) autoEl.textContent = String(bucket.auto_finished_count ?? 0);
      if (abortEl) abortEl.textContent = String(bucket.aborted_count ?? 0);
      if (faultEl) faultEl.textContent = String(bucket.fault_terminated_count ?? 0);
      if (woundEl) woundEl.textContent = formatWoundLength(bucket.total_wound_length ?? 0);
      if (totCyclesEl) totCyclesEl.textContent = String(bucket.total_count ?? 0) + ' cycles';
    }
  }

  function applyMapFilter() {
    let visibleCount = 0;
    const totalCount = document.querySelectorAll('.map-node').length;
    const zoneVisible = { NORTH_LEFT: 0, NORTH_RIGHT: 0, MAIN_BANK: 0, EAST_DOOR: 0 };

    for (const node of document.querySelectorAll('.map-node')) {
      const matches = state.selectedFilterState === 'ALL' || node.dataset.state === state.selectedFilterState;
      node.hidden = !matches;
      if (matches) {
        visibleCount += 1;
        const z = node.dataset.zone;
        if (z && z in zoneVisible) zoneVisible[z] += 1;
      }
    }

    for (const zoneEl of document.querySelectorAll('.zone-bay')) {
      const z = zoneEl.dataset.zone;
      const count = z && z in zoneVisible ? zoneVisible[z] : 0;
      zoneEl.dataset.emptyFiltered = count === 0 ? 'true' : 'false';
      const badge = zoneEl.querySelector('[data-zone-count]');
      if (badge) badge.textContent = String(count);
    }

    const statusEl = document.getElementById('map-filter-status');
    if (statusEl) {
      statusEl.textContent = state.selectedFilterState === 'ALL'
        ? 'Showing all ' + totalCount + ' machines'
        : 'Showing ' + visibleCount + ' of ' + totalCount + ' machines (' + state.selectedFilterState + ')';
    }
  }

  function updateMapNodes() {
    for (const machine of state.machines) {
      const node = document.querySelector('.map-node[data-machine-id="' + CSS.escape(machine.id) + '"]');
      if (!node) continue;
      node.dataset.state = machine.current_state;
      node.className = 'map-node ' + (STATE_CLASSES[machine.current_state] || 'status-offline');
      node.setAttribute(
        'aria-label',
        machine.id + ' ' + machine.display_name + ', ' + machine.current_state +
          (machine.active_error ? ', active error ' + machine.active_error : ''),
      );
      const iconEl = node.querySelector('.badge-icon');
      if (iconEl) iconEl.textContent = STATE_SYMBOLS[machine.current_state] || '?';
      const labelEl = node.querySelector('.node-state-label');
      if (labelEl) labelEl.textContent = machine.current_state;

      let errEl = node.querySelector('.node-error-code');
      if (machine.active_error) {
        if (!errEl) {
          errEl = el('span', 'node-error-code');
          node.appendChild(errEl);
        }
        errEl.textContent = machine.active_error;
      } else if (errEl) {
        errEl.remove();
      }
    }
    applyMapFilter();
  }

  // Tabs (selection follows focus / click + beforematch for hidden="until-found")
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
  const hasNativeFocusGroup = Object.hasOwn(HTMLElement.prototype, 'focusGroup');

  function syncTabFocusability(selectedTab) {
    if (hasNativeFocusGroup) return;
    for (const tab of tabs) {
      tab.tabIndex = tab === selectedTab ? 0 : -1;
    }
  }

  function selectTab(targetTab, focusTab) {
    state.activeTab = targetTab.dataset.tab || 'map';
    for (const tab of tabs) {
      const isSelected = tab === targetTab;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.toggleAttribute('focusgroupstart', isSelected);
    }
    syncTabFocusability(targetTab);
    for (const panel of panels) {
      const isTarget = panel.getAttribute('aria-labelledby') === targetTab.id;
      if (isTarget) {
        panel.removeAttribute('hidden');
        panel.setAttribute('tabindex', '0');
      } else {
        panel.setAttribute('hidden', 'until-found');
        panel.removeAttribute('tabindex');
      }
    }
    if (typeof targetTab.scrollIntoView === 'function') {
      targetTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (focusTab) targetTab.focus();
  }

  const initialTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0];
  if (initialTab) syncTabFocusability(initialTab);

  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (event) => {
      const idx = tabs.indexOf(tab);
      let nextIdx = -1;
      if (event.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIdx = 0;
      else if (event.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx >= 0) {
        event.preventDefault();
        selectTab(tabs[nextIdx], true);
      }
    });
  }

  for (const panel of panels) {
    panel.addEventListener('beforematch', () => {
      const tabId = panel.getAttribute('aria-labelledby');
      const matchingTab = tabs.find((t) => t.id === tabId);
      if (matchingTab) selectTab(matchingTab, false);
    });
  }

  // Coil window switcher
  for (const btn of document.querySelectorAll('.window-btn')) {
    btn.addEventListener('click', () => {
      state.selectedWindow = btn.dataset.coilWindow || 'TODAY';
      for (const b of document.querySelectorAll('.window-btn')) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      renderSummaryStrip();
    });
  }

  // Floor status filter pills
  for (const pill of document.querySelectorAll('.filter-pill')) {
    pill.addEventListener('click', () => {
      state.selectedFilterState = pill.dataset.filterState || 'ALL';
      for (const p of document.querySelectorAll('.filter-pill')) {
        p.setAttribute('aria-pressed', String(p === pill));
      }
      applyMapFilter();
    });
  }

  // Native modal drawer + closedby="any" Safari fallback
  const drawer = document.getElementById('machine-drawer');
  const drawerTitle = document.getElementById('drawer-title');
  const drawerBody = document.getElementById('drawer-body');

  if (drawer) {
    drawer.addEventListener('close', () => {
      drawer.returnValue = '';
      state.openMachineId = null;
    });

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (event) => {
        const rect = drawer.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };
      let pressedOutside = false;
      drawer.addEventListener('pointerdown', (e) => { pressedOutside = isOutside(e); });
      drawer.addEventListener('pointerup', (e) => {
        if (pressedOutside && isOutside(e)) drawer.close();
      });
    }
  }

  function renderDrawerContent(details) {
    if (!drawerBody || !drawerTitle) return;
    const m = details.machine;
    drawerTitle.textContent = m.id + ' — ' + m.display_name;
    drawerBody.textContent = '';

    // Overview section
    const overview = el('div', 'drawer-section');
    const zoneName = ZONE_TITLES[m.zone] || m.zone;
    overview.appendChild(el('p', 'machine-meta', zoneName + ' · Row ' + m.grid_row + ', Col ' + m.grid_col));

    const badge = el('span', 'status-badge ' + (STATE_CLASSES[m.current_state] || 'status-offline'));
    badge.textContent = (STATE_SYMBOLS[m.current_state] || '') + ' ' + m.current_state;
    overview.appendChild(badge);

    if (m.active_error) {
      const errLine = el('p');
      errLine.appendChild(document.createTextNode('Active error: '));
      errLine.appendChild(el('code', '', m.active_error));
      overview.appendChild(errLine);
    }
    overview.appendChild(el('p', 'last-seen', 'Last seen: ' + formatUtc(m.last_seen_at)));

    const actions = el('div', 'drawer-actions');
    const portalLink = el('a', 'nav-link btn-primary', 'Open Worker Portal');
    portalLink.href = details.worker_portal_url || ('/m/' + encodeURIComponent(m.id));
    actions.appendChild(portalLink);
    const bugLink = el('a', 'nav-link', 'Report a Bug');
    bugLink.href = '/m/' + encodeURIComponent(m.id) + '/report-bug';
    actions.appendChild(bugLink);
    overview.appendChild(actions);
    drawerBody.appendChild(overview);

    // Pinned Glossary Fix
    if (details.active_glossary) {
      const g = details.active_glossary;
      const gSec = el('div', 'drawer-section');
      gSec.appendChild(el('h3', '', 'Active Fault Fix: ' + g.title));
      gSec.appendChild(el('p', '', g.symptoms));
      gSec.appendChild(renderMarkdownSafe(g.fix_steps_md));
      drawerBody.appendChild(gSec);
    }

    // ESP32 Winding Cycle Rollups
    const coilSec = el('div', 'drawer-section');
    coilSec.appendChild(el('h3', '', 'Winding Cycle Telemetry (ESP32)'));
    const table = el('table', 'rollup-table');
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    for (const h of ['Window', 'Auto-Finished', 'Aborted', 'Fault-Stopped', 'Total', 'Wound Fiber']) {
      hRow.appendChild(el('th', '', h));
    }
    thead.appendChild(hRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of details.coil_rollups || []) {
      const tr = document.createElement('tr');
      tr.appendChild(el('td', '', row.window));
      tr.appendChild(el('td', '', row.auto_finished_count ?? 0));
      tr.appendChild(el('td', '', row.aborted_count ?? 0));
      tr.appendChild(el('td', '', row.fault_terminated_count ?? 0));
      tr.appendChild(el('td', '', row.total_count ?? 0));
      tr.appendChild(el('td', '', formatWoundLength(row.total_wound_length ?? 0)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    coilSec.appendChild(table);
    drawerBody.appendChild(coilSec);

    // Recent Errors
    const errSec = el('div', 'drawer-section');
    errSec.appendChild(el('h3', '', 'Recent Errors (last 5)'));
    if (!details.recent_errors || details.recent_errors.length === 0) {
      errSec.appendChild(el('p', 'machine-meta', 'No recent error events recorded.'));
    } else {
      const ul = el('ul', 'drawer-list');
      for (const item of details.recent_errors) {
        const li = document.createElement('li');
        const head = el('div', 'history-item-top');
        head.appendChild(el('code', '', item.error_code || item.event_type));
        head.appendChild(el('span', 'last-seen', formatUtc(item.time)));
        li.appendChild(head);
        li.appendChild(el('p', 'history-body', item.glossary_title || item.summary));
        ul.appendChild(li);
      }
      errSec.appendChild(ul);
    }
    drawerBody.appendChild(errSec);

    // Recent Bug Reports
    const bugSec = el('div', 'drawer-section');
    bugSec.appendChild(el('h3', '', 'Recent Bug Reports'));
    if (!details.recent_bug_reports || details.recent_bug_reports.length === 0) {
      bugSec.appendChild(el('p', 'machine-meta', 'No bug reports submitted for this machine.'));
    } else {
      const ul = el('ul', 'drawer-list');
      for (const br of details.recent_bug_reports) {
        const li = document.createElement('li');
        const head = el('div', 'history-item-top');
        head.appendChild(el('strong', '', '#' + br.id + ' · ' + br.tag));
        head.appendChild(el('span', 'last-seen', formatUtc(br.created_at)));
        li.appendChild(head);
        if (br.worker_note) {
          li.appendChild(el('p', 'history-body', br.worker_note));
        }
        ul.appendChild(li);
      }
      bugSec.appendChild(ul);
    }
    drawerBody.appendChild(bugSec);
  }

  function handleAuthFailure(res) {
    if (res.status === 401 || res.status === 403) {
      state.authPaused = true;
      const alertEl = document.getElementById('fleet-auth-alert');
      if (alertEl) alertEl.hidden = false;
      return true;
    }
    return false;
  }

  async function openMachineDrawer(machineId) {
    if (!drawer || !drawerTitle || !drawerBody) return;
    state.openMachineId = machineId;
    drawerTitle.textContent = 'Loading ' + machineId + '...';
    drawerBody.textContent = '';
    drawerBody.appendChild(el('p', 'machine-meta', 'Fetching live diagnostics...'));
    if (!drawer.open) {
      drawer.showModal();
    }
    try {
      const res = await fetch('/api/fleet/machines/' + encodeURIComponent(machineId) + '/details', {
        headers: { accept: 'application/json' },
      });
      if (handleAuthFailure(res)) return;
      if (!res.ok) {
        drawerBody.textContent = '';
        drawerBody.appendChild(el('p', '', 'Failed to load machine details (HTTP ' + res.status + ').'));
        return;
      }
      const details = await res.json();
      renderDrawerContent(details);
    } catch {
      drawerBody.textContent = '';
      drawerBody.appendChild(el('p', '', 'Network error while fetching machine details.'));
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const nodeBtn = target.closest('.map-node[data-machine-id]');
    if (nodeBtn) {
      const id = nodeBtn.getAttribute('data-machine-id');
      if (id) void openMachineDrawer(id);
      return;
    }
    const histBtn = target.closest('[data-open-machine]');
    if (histBtn) {
      const id = histBtn.getAttribute('data-open-machine');
      if (id) void openMachineDrawer(id);
    }
  });

  // Room History filters + rendering
  const historyForm = document.getElementById('history-filter-form');
  const historyList = document.getElementById('fleet-history-list');

  function renderHistoryListSafe(items) {
    if (!historyList) return;
    historyList.textContent = '';
    if (!Array.isArray(items) || items.length === 0) {
      const li = el('li', 'card');
      li.appendChild(el('p', 'machine-meta', 'No room-wide fault events or bug reports match the selected filters.'));
      historyList.appendChild(li);
      return;
    }

    for (const item of items) {
      const li = el('li', 'card history-item');
      const top = el('div', 'history-item-top');
      const badges = el('div', 'history-badges');

      if (item.kind === 'error_event') {
        const b = el('span', 'status-badge status-error', '\\u25B2 ' + (item.error_code || item.event_type));
        badges.appendChild(b);
      } else {
        badges.appendChild(el('span', 'bug-tag-pill', 'Bug #' + item.bug_report_id + ': ' + item.tag));
        if (item.error_code) badges.appendChild(el('code', 'history-inline-code', item.error_code));
      }

      const mBtn = el('button', 'history-machine-btn', item.machine_id + ' · ' + item.machine_display_name);
      mBtn.type = 'button';
      mBtn.setAttribute('data-open-machine', item.machine_id);
      badges.appendChild(mBtn);
      badges.appendChild(el('span', 'zone-pill', ZONE_TITLES[item.zone] || item.zone));
      top.appendChild(badges);

      const t = el('time', 'last-seen', formatUtc(item.time));
      t.setAttribute('datetime', item.time);
      top.appendChild(t);
      li.appendChild(top);

      if (item.kind === 'error_event') {
        const text = item.glossary_title
          ? item.glossary_title + (item.summary && item.summary !== item.glossary_title ? ' — ' + item.summary : '')
          : item.summary;
        li.appendChild(el('p', 'history-body', text));
      } else if (item.worker_note) {
        li.appendChild(el('p', 'history-body', item.worker_note));
      } else {
        li.appendChild(el('p', 'machine-meta', 'No worker note attached.'));
      }

      historyList.appendChild(li);
    }
  }

  async function refreshHistory() {
    if (!historyForm || state.authPaused) return;
    const params = new URLSearchParams();
    const kind = historyForm.querySelector('#history-kind')?.value;
    const zone = historyForm.querySelector('#history-zone')?.value;
    const machineId = historyForm.querySelector('#history-machine')?.value?.trim();
    if (kind && kind !== 'all') params.set('kind', kind);
    if (zone) params.set('zone', zone);
    if (machineId) params.set('machineId', machineId);

    const res = await fetch('/api/fleet/history?' + params.toString(), {
      headers: { accept: 'application/json' },
    });
    if (handleAuthFailure(res) || !res.ok) return;
    const data = await res.json();
    renderHistoryListSafe(data.items || []);
  }

  if (historyForm) {
    historyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void refreshHistory();
    });
    for (const sel of historyForm.querySelectorAll('select')) {
      sel.addEventListener('change', () => { void refreshHistory(); });
    }
    const resetBtn = document.getElementById('history-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        historyForm.reset();
        void refreshHistory();
      });
    }
  }

  // Master Glossary live search
  const glossaryForm = document.getElementById('fleet-glossary-form');
  const glossaryInput = document.getElementById('fleet-glossary-search');
  const glossaryList = document.getElementById('fleet-glossary-list');
  let glossaryTimer = null;

  function renderGlossarySafe(entries) {
    if (!glossaryList) return;
    glossaryList.textContent = '';
    if (!Array.isArray(entries) || entries.length === 0) {
      const li = el('li', 'card');
      li.appendChild(el('p', 'machine-meta', 'No fault glossary entries matched your search.'));
      glossaryList.appendChild(li);
      return;
    }
    for (const entry of entries) {
      const li = el('li', 'card glossary-card');
      const header = el('div', 'glossary-card-header');
      header.appendChild(el('h3', '', entry.title));
      header.appendChild(el('code', '', entry.error_code));
      li.appendChild(header);

      const sym = el('p', 'glossary-symptoms');
      const strong = el('strong', '', 'Symptoms: ');
      sym.appendChild(strong);
      sym.appendChild(document.createTextNode(entry.symptoms));
      li.appendChild(sym);
      li.appendChild(renderMarkdownSafe(entry.fix_steps_md));
      glossaryList.appendChild(li);
    }
  }

  async function refreshGlossary() {
    if (!glossaryInput) return;
    const q = glossaryInput.value.trim();
    const url = q ? '/api/glossary?q=' + encodeURIComponent(q) : '/api/glossary';
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    renderGlossarySafe(data.entries || []);
  }

  if (glossaryForm && glossaryInput) {
    glossaryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void refreshGlossary();
    });
    glossaryInput.addEventListener('input', () => {
      if (glossaryTimer) clearTimeout(glossaryTimer);
      glossaryTimer = setTimeout(() => { void refreshGlossary(); }, 200);
    });
  }

  // Live 10s polling + manual Refresh
  async function refreshAll(includeHistory) {
    if (state.authPaused) return;
    try {
      const [sumRes, machRes] = await Promise.all([
        fetch('/api/fleet/summary', { headers: { accept: 'application/json' } }),
        fetch('/api/fleet/machines', { headers: { accept: 'application/json' } }),
      ]);
      if (handleAuthFailure(sumRes) || handleAuthFailure(machRes)) return;
      if (sumRes.ok) {
        state.summary = await sumRes.json();
        renderSummaryStrip();
      }
      if (machRes.ok) {
        const payload = await machRes.json();
        state.machines = Array.isArray(payload.machines) ? payload.machines : [];
        updateMapNodes();
      }
      if (includeHistory || state.activeTab === 'history') {
        await refreshHistory();
      }
    } catch {
      // Transient LAN glitches will retry cleanly on the next 10s poll tick.
    }
  }

  const refreshBtn = document.getElementById('fleet-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => { void refreshAll(true); });
  }

  setInterval(() => {
    if (!document.hidden && !state.authPaused) {
      void refreshAll(false);
    }
  }, 10000);

  renderSummaryStrip();
  applyMapFilter();
})();
`;

/**
 * Render the complete zero-CDN server-side HTML document for the Department Heads `/fleet` PWA.
 */
export function renderFleetDashboardPage(model: FleetPageViewModel): string {
  const { user, summary, machines, history, glossary } = model;
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
      ? `Signed in as ${user.email}`
      : 'Local LAN Mode (Cloudflare Access disabled)';

  const bootstrapPayload = serializeJsonForScript({
    summary,
    machines,
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
  <meta name="theme-color" content="#0f4c81">
  <link rel="manifest" href="/fleet/manifest.webmanifest">
  <title>Winding Room Fleet | Department Heads PWA</title>
  <style>${FLEET_STYLES}</style>
</head>
<body>
  <div class="fleet-shell">
    <header class="fleet-header">
      <div class="fleet-title-group">
        <h1>Winding Room Fleet</h1>
        <p class="fleet-meta-line">
          <span>${escapeHtml(authSummary)}</span>
          <span>Last updated: <time id="fleet-last-updated" datetime="${escapeHtml(summary.generated_at)}">${escapeHtml(formatTimestampUtc(summary.generated_at))}</time></span>
        </p>
      </div>
      <div class="fleet-header-actions">
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
          <div class="metric-box">
            <span class="metric-label">Total Winders</span>
            <span class="metric-value" id="count-total">${counts.total}</span>
          </div>
          <div class="metric-box status-working">
            <span class="metric-label"><span aria-hidden="true">&#9679;</span> Working</span>
            <span class="metric-value" id="count-working">${counts.WORKING}</span>
          </div>
          <div class="metric-box status-idle">
            <span class="metric-label"><span aria-hidden="true">&#9680;</span> Idle</span>
            <span class="metric-value" id="count-idle">${counts.IDLE}</span>
          </div>
          <div class="metric-box status-error">
            <span class="metric-label"><span aria-hidden="true">&#9650;</span> Error</span>
            <span class="metric-value" id="count-error">${counts.ERROR}</span>
          </div>
          <div class="metric-box status-offline">
            <span class="metric-label"><span aria-hidden="true">&#10005;</span> Offline</span>
            <span class="metric-value" id="count-offline">${counts.OFFLINE}</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Open Bugs</span>
            <span class="metric-value" id="count-open-bugs">${summary.open_bug_reports}</span>
          </div>
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
            <span class="metric-value" id="coil-auto-finished">${defaultBucket.auto_finished_count}</span>
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
    </div>

    <div class="tabpanels-stack">
      <div role="tabpanel" id="panel-map" aria-labelledby="tab-map" tabindex="0">
        <div class="tabpanel-body">
          <div class="card filter-bar">
            <div class="filter-pills" role="group" aria-label="Filter floor map by status">
              ${filterStatePills
                .map(
                  (pill) => `<button type="button" class="filter-pill" data-filter-state="${pill.key}" aria-pressed="${pill.key === 'ALL' ? 'true' : 'false'}">${pill.symbol ? `<span aria-hidden="true">${pill.symbol}</span>` : ''}<span>${pill.label}</span><span data-pill-count="${pill.key}">${pill.count}</span></button>`,
                )
                .join('')}
            </div>
            <span id="map-filter-status" class="machine-meta" aria-live="polite">Showing all ${machines.length} machines</span>
          </div>

          <div class="floor-layout-grid" aria-label="L-shaped winding room floor map">
            ${FLOOR_ZONES.map((zone) => renderZoneBay(zone, machines)).join('')}
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
              <label for="history-zone">Floor Zone</label>
              <select id="history-zone" name="zone">
                <option value="">All Zones</option>
                ${FLOOR_ZONES.map((z) => `<option value="${escapeHtml(z)}">${escapeHtml(ZONE_META[z].title)}</option>`).join('')}
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
    </div>
  </div>

  <dialog id="machine-drawer" class="machine-drawer" closedby="any" aria-labelledby="drawer-title">
    <div class="drawer-header">
      <h2 id="drawer-title">Machine Details</h2>
      <form method="dialog">
        <button type="submit" class="btn" autofocus>Close</button>
      </form>
    </div>
    <div id="drawer-body" class="drawer-body">
      <p class="machine-meta">Select any machine on the floor map to inspect live diagnostics.</p>
    </div>
  </dialog>

  <script type="application/json" id="fleet-bootstrap-data">${bootstrapPayload}</script>
  <script>${FLEET_CLIENT_SCRIPT}</script>
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

import type { FleetHistoryBugReportItem, FleetHistoryItem } from '../../services/fleet.js';
import type { MachineRecord } from '../../services/machines.js';
import { escapeHtml } from '../portal-layout.js';
import { formatTimestampUtc } from '../recent-errors-section.js';
import {
  FLOOR_SECTION_META,
  deriveToolLabel,
  resolveMachineFloorSection,
} from './floor-plan.js';

export interface RepeatFaultSummary {
  errorCode: string;
  count: number;
  sections: string[];
  machineLabels: string[];
}

/**
 * Compute the most frequent repeated `error_code` across recent room history events.
 */
export function computeTopRepeatFault(
  history: readonly FleetHistoryItem[],
): RepeatFaultSummary | null {
  const counts = new Map<
    string,
    { count: number; sections: Set<string>; machines: Set<string> }
  >();

  for (const item of history) {
    if (item.kind !== 'error_event' || !item.error_code) continue;
    let bucket = counts.get(item.error_code);
    if (!bucket) {
      bucket = { count: 0, sections: new Set(), machines: new Set() };
      counts.set(item.error_code, bucket);
    }
    bucket.count += 1;
    const section = resolveMachineFloorSection({
      id: item.machine_id,
      floor_position: item.floor_position,
    });
    bucket.sections.add(FLOOR_SECTION_META[section].title);
    bucket.machines.add(deriveToolLabel(item.machine_id, item.floor_position));
  }

  let best: RepeatFaultSummary | null = null;
  for (const [errorCode, bucket] of counts.entries()) {
    if (bucket.count < 2) continue;
    if (!best || bucket.count > best.count) {
      best = {
        errorCode,
        count: bucket.count,
        sections: Array.from(bucket.sections),
        machineLabels: Array.from(bucket.machines),
      };
    }
  }
  return best;
}

/**
 * Render the dismissible repeat-fault alert strip above the Fleet Triage toolbar.
 */
export function renderRepeatFaultBannerHtml(history: readonly FleetHistoryItem[]): string {
  const top = computeTopRepeatFault(history);
  if (!top) {
    return `<div id="repeat-fault-banner" class="repeat-fault-banner" hidden>
      <div class="repeat-fault-main" id="repeat-fault-content"></div>
      <button type="button" id="repeat-fault-dismiss-btn" class="repeat-fault-dismiss-btn" aria-label="Dismiss repeat fault notice">&#10005;</button>
    </div>`;
  }

  const sectionText = top.sections.slice(0, 2).join(' & ');
  const machineText = top.machineLabels.slice(0, 4).join(', ');

  return `<div id="repeat-fault-banner" class="repeat-fault-banner">
    <div class="repeat-fault-main" id="repeat-fault-content">
      <span class="repeat-fault-title">&#128293; Repeat Fault:</span>
      <button type="button" class="error-code-pill" data-glossary-code="${escapeHtml(top.errorCode)}">&#9650; ${escapeHtml(top.errorCode)}</button>
      <span><strong>&times;${top.count}</strong> recent hits across <strong>${escapeHtml(sectionText)}</strong> (${escapeHtml(machineText)})</span>
      <button type="button" class="repeat-fault-jump-btn" data-jump-history-code="${escapeHtml(top.errorCode)}">View filtered Room History &rarr;</button>
    </div>
    <button type="button" id="repeat-fault-dismiss-btn" class="repeat-fault-dismiss-btn" aria-label="Dismiss repeat fault notice">&#10005;</button>
  </div>`;
}

/**
 * Render the Triage view-mode switcher, active KPI filter badge, and instant search box.
 */
export function renderTriageToolbarHtml(totalMachines: number): string {
  return `<div class="triage-toolbar">
    <div class="triage-toolbar-left">
      <div class="view-mode-group" role="group" aria-label="Fleet layout mode">
        <button type="button" class="view-mode-btn" data-view-mode="urgency" aria-pressed="true">Urgency</button>
        <button type="button" class="view-mode-btn" data-view-mode="blueprint" aria-pressed="false">Floor Blueprint</button>
        <button type="button" class="view-mode-btn" data-view-mode="section" aria-pressed="false">By Section</button>
        <button type="button" class="view-mode-btn" data-view-mode="id" aria-pressed="false">Machine #</button>
      </div>
      <span id="active-filter-badge" class="active-filter-badge" hidden>
        <span id="active-filter-label">Filter</span>
        <button type="button" id="active-filter-clear-btn" class="active-filter-clear" aria-label="Clear active filter">&#10005;</button>
      </span>
      <span id="map-filter-status" class="machine-meta" aria-live="polite">Showing all ${totalMachines} machines</span>
    </div>

    <div class="triage-search-wrap">
      <label class="visually-hidden" for="fleet-map-search">Search winders by ID, floor slot, ESP32 hardware ID, error code, or firmware</label>
      <input id="fleet-map-search" type="search" placeholder="Search #ID, W-XX, ESP32 HW, ERR_CODE, FW..." spellcheck="false" autocomplete="off">
      <button type="button" id="fleet-map-search-clear" class="triage-search-clear" hidden aria-label="Clear search">&#10005;</button>
    </div>
  </div>`;
}

function buildOpenBugsMap(
  history: readonly FleetHistoryItem[],
): Map<string, FleetHistoryBugReportItem[]> {
  const byMachine = new Map<string, FleetHistoryBugReportItem[]>();
  for (const item of history) {
    if (item.kind !== 'bug_report') continue;
    if (item.status && item.status.toUpperCase() === 'RESOLVED') continue;
    let list = byMachine.get(item.machine_id);
    if (!list) {
      list = [];
      byMachine.set(item.machine_id, list);
    }
    list.push(item);
  }
  return byMachine;
}

function renderAttentionCardHtml(
  m: MachineRecord,
  openBugs: readonly FleetHistoryBugReportItem[],
): string {
  const toolLabel = deriveToolLabel(m.id, m.floor_position);
  const section = resolveMachineFloorSection(m);
  const sectionTitle = FLOOR_SECTION_META[section].title;
  const isError = m.current_state === 'ERROR';
  const isOffline = m.current_state === 'OFFLINE';
  const cardVariant = isError
    ? 'attention-error'
    : isOffline
      ? 'attention-offline'
      : 'attention-bug';
  const seenLabel = m.last_seen_at ? formatTimestampUtc(m.last_seen_at) : 'No heartbeat yet';
  const versionSummary = [
    m.hardware_id ? `HW ${m.hardware_id}` : null,
    m.fw_version ? `FW ${m.fw_version}` : null,
    m.preset_version ? `PR ${m.preset_version}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const searchTokens = [
    toolLabel,
    m.id,
    m.display_name,
    sectionTitle,
    m.hardware_id ?? '',
    m.active_error ?? '',
    m.fw_version ?? '',
    m.preset_version ?? '',
    ...openBugs.map((b) => `${b.tag} ${b.worker_note ?? ''}`),
  ]
    .join(' ')
    .toLowerCase();

  const errorBlock = m.active_error
    ? `<div><button type="button" class="error-code-pill" data-glossary-code="${escapeHtml(m.active_error)}">&#9650; ${escapeHtml(m.active_error)}</button></div>`
    : '';

  const offlineBlock = isOffline
    ? `<p class="machine-meta">Last seen: ${escapeHtml(seenLabel)}</p>`
    : '';

  const firstBug = openBugs[0];
  const bugBlock = firstBug
    ? `<div class="attention-bug-box">
        <strong>Bug #${firstBug.bug_report_id}: ${escapeHtml(firstBug.tag)}</strong>
        ${firstBug.worker_note ? `<div>${escapeHtml(firstBug.worker_note)}</div>` : ''}
      </div>`
    : '';

  return `<article
    class="attention-card ${cardVariant}"
    data-triage-card="attention"
    data-machine-id="${escapeHtml(m.id)}"
    data-state="${escapeHtml(m.current_state)}"
    data-section="${escapeHtml(section)}"
    data-hardware-id="${escapeHtml(m.hardware_id ?? '')}"
    data-has-bug="${openBugs.length > 0 ? 'true' : 'false'}"
    data-search-text="${escapeHtml(searchTokens)}"
  >
    <div class="attention-top">
      <div class="attention-id-row">
        <strong class="attention-tool-num">${escapeHtml(toolLabel)}</strong>
        <span class="attention-machine-id">${escapeHtml(m.id)}</span>
        <span class="zone-pill">${escapeHtml(sectionTitle)}</span>
        ${m.hardware_id ? `<span class="zone-pill">${escapeHtml(m.hardware_id)}</span>` : ''}
      </div>
      <span class="status-badge status-${escapeHtml(m.current_state.toLowerCase())}">${escapeHtml(m.current_state)}</span>
    </div>
    ${errorBlock}
    ${offlineBlock}
    ${bugBlock}
    <div class="attention-footer">
      <span class="machine-meta">${escapeHtml(versionSummary || seenLabel)}</span>
      <button type="button" class="attention-inspect-btn" data-open-machine="${escapeHtml(m.id)}">Inspect &rarr;</button>
    </div>
  </article>`;
}

function renderCompactTileHtml(
  m: MachineRecord,
  openBugs: readonly FleetHistoryBugReportItem[],
): string {
  const toolLabel = deriveToolLabel(m.id, m.floor_position);
  const section = resolveMachineFloorSection(m);
  const sectionTitle = FLOOR_SECTION_META[section].title;
  const stateLower = m.current_state.toLowerCase();
  const versionSummary = [
    m.hardware_id ? `HW ${m.hardware_id}` : null,
    m.fw_version ? `FW ${m.fw_version}` : null,
    m.preset_version ? `PR ${m.preset_version}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const searchTokens = [
    toolLabel,
    m.id,
    m.display_name,
    sectionTitle,
    m.hardware_id ?? '',
    m.active_error ?? '',
    m.fw_version ?? '',
    m.preset_version ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return `<div
    class="compact-tile status-${escapeHtml(stateLower)}"
    data-triage-card="compact"
    data-machine-id="${escapeHtml(m.id)}"
    data-state="${escapeHtml(m.current_state)}"
    data-section="${escapeHtml(section)}"
    data-hardware-id="${escapeHtml(m.hardware_id ?? '')}"
    data-has-bug="${openBugs.length > 0 ? 'true' : 'false'}"
    data-search-text="${escapeHtml(searchTokens)}"
  >
    <button type="button" class="compact-tile-btn" data-open-machine="${escapeHtml(m.id)}">
      <div class="compact-tile-top">
        <strong class="attention-tool-num">${escapeHtml(toolLabel)}</strong>
        <span class="zone-pill">${escapeHtml(m.id)}</span>
      </div>
      <div class="compact-tile-meta">${escapeHtml(m.active_error || versionSummary || m.current_state)}</div>
    </button>
  </div>`;
}

/**
 * Render the 3-tier Urgency Triage board (Attention Required / Idle / Working).
 */
export function renderTriageBoardHtml(
  machines: readonly MachineRecord[],
  history: readonly FleetHistoryItem[],
): string {
  const bugsByMachine = buildOpenBugsMap(history);
  const attention: MachineRecord[] = [];
  const idle: MachineRecord[] = [];
  const working: MachineRecord[] = [];

  for (const m of machines) {
    const hasBug = (bugsByMachine.get(m.id)?.length ?? 0) > 0;
    if (m.current_state === 'ERROR' || m.current_state === 'OFFLINE' || hasBug) {
      attention.push(m);
    } else if (m.current_state === 'IDLE') {
      idle.push(m);
    } else {
      working.push(m);
    }
  }

  attention.sort((a, b) => {
    const rank = (m: MachineRecord) =>
      m.current_state === 'ERROR' ? 0 : m.current_state === 'OFFLINE' ? 1 : 2;
    return rank(a) - rank(b) || a.id.localeCompare(b.id);
  });

  const sections: string[] = [];
  if (attention.length > 0) {
    sections.push(`<section class="triage-section" aria-label="Attention required">
      <div class="triage-section-header">
        <h3 class="triage-section-title">&#9888; Attention Required</h3>
        <span class="triage-section-count">(${attention.length} units &mdash; Faults, Offline &amp; Open Bugs)</span>
      </div>
      <div class="attention-grid">
        ${attention.map((m) => renderAttentionCardHtml(m, bugsByMachine.get(m.id) ?? [])).join('')}
      </div>
    </section>`);
  }

  if (idle.length > 0) {
    sections.push(`<section class="triage-section" aria-label="Idle and standby units">
      <div class="triage-section-header">
        <h3 class="triage-section-title">&#9680; Idle &amp; Standby</h3>
        <span class="triage-section-count">(${idle.length})</span>
      </div>
      <div class="compact-grid">
        ${idle.map((m) => renderCompactTileHtml(m, bugsByMachine.get(m.id) ?? [])).join('')}
      </div>
    </section>`);
  }

  if (working.length > 0) {
    sections.push(`<section class="triage-section" aria-label="Working units">
      <div class="triage-section-header">
        <h3 class="triage-section-title">&#9679; Working Normally</h3>
        <span class="triage-section-count">(${working.length})</span>
      </div>
      <div class="compact-grid">
        ${working.map((m) => renderCompactTileHtml(m, bugsByMachine.get(m.id) ?? [])).join('')}
      </div>
    </section>`);
  }

  if (sections.length === 0) {
    sections.push(
      '<div class="card"><p class="machine-meta empty-state-note">No registered winders match your current filter or search.</p></div>',
    );
  }

  return `<div id="fleet-triage-board" class="triage-board">${sections.join('')}</div>`;
}

/**
 * Render the floating inline glossary popover container for instant `ERR_CODE` inspection.
 */
export function renderGlossaryPopoverHtml(): string {
  return `<div id="glossary-popover" class="glossary-popover" popover="auto" hidden aria-labelledby="glossary-popover-title">
    <div class="glossary-popover-header">
      <div>
        <code id="glossary-popover-code"></code>
        <h3 id="glossary-popover-title" class="glossary-popover-title"></h3>
      </div>
      <button type="button" id="glossary-popover-close-btn" class="repeat-fault-dismiss-btn" aria-label="Close glossary popover">&#10005;</button>
    </div>
    <div id="glossary-popover-body" class="glossary-popover-body"></div>
    <div class="glossary-popover-footer">
      <span class="machine-meta">Master Glossary Reference</span>
      <button type="button" id="glossary-popover-open-btn" class="attention-inspect-btn">Open full guide &rarr;</button>
    </div>
  </div>`;
}

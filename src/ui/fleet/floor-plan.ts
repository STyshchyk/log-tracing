import type { MachineRecord } from '../../services/machines.js';
import type { MachineState } from '../../spec/mqtt-contract.js';
import { escapeHtml } from '../portal-layout.js';

export type FloorBaySection =
  | 'narrow_west'
  | 'narrow_east'
  | 'main_hall'
  | 'right_stack'
  | 'reserve_bay';

export const FLOOR_SECTION_META: Record<FloorBaySection, { title: string }> = {
  narrow_west: { title: 'Narrow Wing — West Wall (#1–#7)' },
  narrow_east: { title: 'Narrow Wing — East Wall (#8–#12)' },
  main_hall: { title: 'Main Hall Rows (#13–#36)' },
  right_stack: { title: 'Right Stack (#37–#44)' },
  reserve_bay: { title: 'Additional Units (#45+)' },
};

/**
 * Shared client-side JS snippet defining `SECTION_TITLES`, `resolveSection(m)`, and
 * `deriveToolLabel(machineId, floorPosition)` so `/fleet` inline scripts stay DRY.
 */
export const FLEET_FLOOR_SECTION_CLIENT_HELPER = `
  const SECTION_TITLES = {
    narrow_west: 'Narrow Wing — West Wall (#1–#7)',
    narrow_east: 'Narrow Wing — East Wall (#8–#12)',
    main_hall: 'Main Hall Rows (#13–#36)',
    right_stack: 'Right Stack (#37–#44)',
    reserve_bay: 'Additional Units (#45+)',
  };

  function resolveSection(m) {
    const pos = m && typeof m.floor_position === 'number' ? m.floor_position : null;
    if (pos && pos > 0) {
      if (pos <= 7) return 'narrow_west';
      if (pos <= 12) return 'narrow_east';
      if (pos <= 36) return 'main_hall';
      if (pos <= 44) return 'right_stack';
      return 'reserve_bay';
    }
    const wMatch = /^W-0*(\\d+)$/i.exec(String(m?.id || ''));
    const num = wMatch ? Number(wMatch[1]) : NaN;
    if (num >= 1 && num <= 7) return 'narrow_west';
    if (num >= 8 && num <= 12) return 'narrow_east';
    if (num >= 13 && num <= 36) return 'main_hall';
    if (num >= 37 && num <= 44) return 'right_stack';
    return 'reserve_bay';
  }

  function deriveToolLabel(machineId, floorPosition) {
    if (typeof floorPosition === 'number' && floorPosition > 0) return '#' + floorPosition;
    const m = /^W-0*(\\d+)$/i.exec(String(machineId || ''));
    return m ? '#' + m[1] : String(machineId || '');
  }
`;

export const STATE_SYMBOLS: Record<MachineState, string> = {
  WORKING: '&#9679;',
  IDLE: '&#9680;',
  ERROR: '&#9650;',
  OFFLINE: '&#10005;',
};

export const STATE_CSS_CLASSES: Record<MachineState, string> = {
  WORKING: 'status-working',
  IDLE: 'status-idle',
  ERROR: 'status-error',
  OFFLINE: 'status-offline',
};

export interface FloorPlanSlot {
  slotIndex: number;
  label: string;
  defaultId: string;
  baySection: Exclude<FloorBaySection, 'reserve_bay'>;
  section:
    | 'narrow_west'
    | 'narrow_east'
    | 'main_row_1'
    | 'main_row_2'
    | 'main_row_3'
    | 'main_row_4'
    | 'right_stack';
  seatPosition: 'left' | 'right' | 'top' | 'bottom';
  pairIndex?: number;
}

export const WORKSHOP_44_SLOTS: readonly FloorPlanSlot[] = [
  // Narrow Wing West Wall: #1..#7 (7 units)
  { slotIndex: 1, label: '#1', defaultId: 'W-01', baySection: 'narrow_west', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 2, label: '#2', defaultId: 'W-02', baySection: 'narrow_west', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 3, label: '#3', defaultId: 'W-03', baySection: 'narrow_west', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 4, label: '#4', defaultId: 'W-04', baySection: 'narrow_west', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 5, label: '#5', defaultId: 'W-05', baySection: 'narrow_west', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 6, label: '#6', defaultId: 'W-06', baySection: 'narrow_west', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 7, label: '#7', defaultId: 'W-07', baySection: 'narrow_west', section: 'narrow_west', seatPosition: 'right' },
  // Narrow Wing East Wall: #8..#12 (5 units)
  { slotIndex: 8, label: '#8', defaultId: 'W-08', baySection: 'narrow_east', section: 'narrow_east', seatPosition: 'left' },
  { slotIndex: 9, label: '#9', defaultId: 'W-09', baySection: 'narrow_east', section: 'narrow_east', seatPosition: 'left' },
  { slotIndex: 10, label: '#10', defaultId: 'W-10', baySection: 'narrow_east', section: 'narrow_east', seatPosition: 'left' },
  { slotIndex: 11, label: '#11', defaultId: 'W-11', baySection: 'narrow_east', section: 'narrow_east', seatPosition: 'left' },
  { slotIndex: 12, label: '#12', defaultId: 'W-12', baySection: 'narrow_east', section: 'narrow_east', seatPosition: 'left' },
  // Main Hall Row 1: #13..#17 (5 units, faces bottom)
  { slotIndex: 13, label: '#13', defaultId: 'W-13', baySection: 'main_hall', section: 'main_row_1', seatPosition: 'bottom' },
  { slotIndex: 14, label: '#14', defaultId: 'W-14', baySection: 'main_hall', section: 'main_row_1', seatPosition: 'bottom' },
  { slotIndex: 15, label: '#15', defaultId: 'W-15', baySection: 'main_hall', section: 'main_row_1', seatPosition: 'bottom' },
  { slotIndex: 16, label: '#16', defaultId: 'W-16', baySection: 'main_hall', section: 'main_row_1', seatPosition: 'bottom' },
  { slotIndex: 17, label: '#17', defaultId: 'W-17', baySection: 'main_hall', section: 'main_row_1', seatPosition: 'bottom' },
  // Main Hall Row 2: #18..#24 (7 units, staggered seats)
  { slotIndex: 18, label: '#18', defaultId: 'W-18', baySection: 'main_hall', section: 'main_row_2', seatPosition: 'top' },
  { slotIndex: 19, label: '#19', defaultId: 'W-19', baySection: 'main_hall', section: 'main_row_2', seatPosition: 'bottom' },
  { slotIndex: 20, label: '#20', defaultId: 'W-20', baySection: 'main_hall', section: 'main_row_2', seatPosition: 'top' },
  { slotIndex: 21, label: '#21', defaultId: 'W-21', baySection: 'main_hall', section: 'main_row_2', seatPosition: 'bottom' },
  { slotIndex: 22, label: '#22', defaultId: 'W-22', baySection: 'main_hall', section: 'main_row_2', seatPosition: 'top' },
  { slotIndex: 23, label: '#23', defaultId: 'W-23', baySection: 'main_hall', section: 'main_row_2', seatPosition: 'bottom' },
  { slotIndex: 24, label: '#24', defaultId: 'W-24', baySection: 'main_hall', section: 'main_row_2', seatPosition: 'top' },
  // Main Hall Row 3: #25..#30 (6 units)
  { slotIndex: 25, label: '#25', defaultId: 'W-25', baySection: 'main_hall', section: 'main_row_3', seatPosition: 'top' },
  { slotIndex: 26, label: '#26', defaultId: 'W-26', baySection: 'main_hall', section: 'main_row_3', seatPosition: 'bottom' },
  { slotIndex: 27, label: '#27', defaultId: 'W-27', baySection: 'main_hall', section: 'main_row_3', seatPosition: 'top' },
  { slotIndex: 28, label: '#28', defaultId: 'W-28', baySection: 'main_hall', section: 'main_row_3', seatPosition: 'bottom' },
  { slotIndex: 29, label: '#29', defaultId: 'W-29', baySection: 'main_hall', section: 'main_row_3', seatPosition: 'top' },
  { slotIndex: 30, label: '#30', defaultId: 'W-30', baySection: 'main_hall', section: 'main_row_3', seatPosition: 'bottom' },
  // Main Hall Row 4: #31..#36 (6 units, faces top)
  { slotIndex: 31, label: '#31', defaultId: 'W-31', baySection: 'main_hall', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 32, label: '#32', defaultId: 'W-32', baySection: 'main_hall', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 33, label: '#33', defaultId: 'W-33', baySection: 'main_hall', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 34, label: '#34', defaultId: 'W-34', baySection: 'main_hall', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 35, label: '#35', defaultId: 'W-35', baySection: 'main_hall', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 36, label: '#36', defaultId: 'W-36', baySection: 'main_hall', section: 'main_row_4', seatPosition: 'top' },
  // Right Stack: #37..#44 (8 units: 4 rows x 2 columns)
  { slotIndex: 37, label: '#37', defaultId: 'W-37', baySection: 'right_stack', section: 'right_stack', seatPosition: 'left', pairIndex: 1 },
  { slotIndex: 38, label: '#38', defaultId: 'W-38', baySection: 'right_stack', section: 'right_stack', seatPosition: 'left', pairIndex: 1 },
  { slotIndex: 39, label: '#39', defaultId: 'W-39', baySection: 'right_stack', section: 'right_stack', seatPosition: 'left', pairIndex: 2 },
  { slotIndex: 40, label: '#40', defaultId: 'W-40', baySection: 'right_stack', section: 'right_stack', seatPosition: 'left', pairIndex: 2 },
  { slotIndex: 41, label: '#41', defaultId: 'W-41', baySection: 'right_stack', section: 'right_stack', seatPosition: 'left', pairIndex: 3 },
  { slotIndex: 42, label: '#42', defaultId: 'W-42', baySection: 'right_stack', section: 'right_stack', seatPosition: 'left', pairIndex: 3 },
  { slotIndex: 43, label: '#43', defaultId: 'W-43', baySection: 'right_stack', section: 'right_stack', seatPosition: 'left', pairIndex: 4 },
  { slotIndex: 44, label: '#44', defaultId: 'W-44', baySection: 'right_stack', section: 'right_stack', seatPosition: 'left', pairIndex: 4 },
];

const DEFAULT_ID_TO_SLOT = new Map<string, FloorPlanSlot>(
  WORKSHOP_44_SLOTS.map((slot) => [slot.defaultId, slot]),
);

/**
 * Resolve the physical floor bay section from a machine's `floor_position` (or legacy `W-XX` ID).
 */
export function resolveMachineFloorSection(
  machine: Pick<MachineRecord, 'id' | 'floor_position'>,
): FloorBaySection {
  const pos = machine.floor_position;
  if (typeof pos === 'number' && Number.isInteger(pos) && pos > 0) {
    if (pos <= 7) return 'narrow_west';
    if (pos <= 12) return 'narrow_east';
    if (pos <= 36) return 'main_hall';
    if (pos <= 44) return 'right_stack';
    return 'reserve_bay';
  }
  const slot = DEFAULT_ID_TO_SLOT.get(machine.id);
  return slot ? slot.baySection : 'reserve_bay';
}

/**
 * Derive the short floor slot badge (e.g. `#23`) preferring an explicit `floor_position`.
 */
export function deriveToolLabel(
  machineId: string,
  floorPosition?: number | null,
): string {
  if (typeof floorPosition === 'number' && Number.isInteger(floorPosition) && floorPosition > 0) {
    return `#${floorPosition}`;
  }
  const mapped = DEFAULT_ID_TO_SLOT.get(machineId);
  if (mapped) {
    return mapped.label;
  }
  const wMatch = /^W-0*(\d+)$/i.exec(machineId);
  if (wMatch) {
    return `#${wMatch[1]}`;
  }
  return machineId;
}

function formatNodeVersionLabel(machine: MachineRecord): string {
  const parts: string[] = [];
  if (machine.fw_version) parts.push(`FW ${machine.fw_version}`);
  if (machine.preset_version) parts.push(`PR ${machine.preset_version}`);
  return parts.join(' · ');
}

function renderMachineToolButton(
  machine: MachineRecord,
  options: {
    slotLabel?: string;
    baySection: FloorBaySection;
    seatPosition?: 'left' | 'right' | 'top' | 'bottom';
    variant?: 'blueprint' | 'bay';
  },
): string {
  const symbol = STATE_SYMBOLS[machine.current_state];
  const stateClass = STATE_CSS_CLASSES[machine.current_state];
  const toolLabel = options.slotLabel ?? deriveToolLabel(machine.id, machine.floor_position);
  const seatAttr = options.seatPosition ? ` data-seat="${options.seatPosition}"` : '';
  const variantClass = options.variant === 'blueprint' ? 'mt-unit' : '';
  const errorHtml = machine.active_error
    ? `<span class="node-error-code">${escapeHtml(machine.active_error)}</span>`
    : '';
  const versionLabel = formatNodeVersionLabel(machine);
  const versionHtml = versionLabel
    ? `<span class="node-fw-meta">${escapeHtml(versionLabel)}</span>`
    : '';
  const hwHtml = machine.hardware_id
    ? `<span class="node-hw-meta">${escapeHtml(machine.hardware_id)}</span>`
    : '';
  const posAttr = machine.floor_position != null ? String(machine.floor_position) : '';
  const hwAttr = machine.hardware_id ?? '';
  const ariaHw = machine.hardware_id ? `, ESP32 ${machine.hardware_id}` : '';

  return `<div
    class="map-unit-cell"
    data-machine-id="${escapeHtml(machine.id)}"
    data-state="${escapeHtml(machine.current_state)}"
    data-section="${escapeHtml(options.baySection)}"
    data-floor-position="${escapeHtml(posAttr)}"
    data-hardware-id="${escapeHtml(hwAttr)}"${seatAttr}
  ><button
    type="button"
    class="map-node ${variantClass} ${stateClass}"
    data-machine-id="${escapeHtml(machine.id)}"
    data-tool-label="${escapeHtml(toolLabel)}"
    data-state="${escapeHtml(machine.current_state)}"
    data-section="${escapeHtml(options.baySection)}"
    data-floor-position="${escapeHtml(posAttr)}"
    data-hardware-id="${escapeHtml(hwAttr)}"
    data-fw-version="${escapeHtml(machine.fw_version ?? '')}"
    data-preset-version="${escapeHtml(machine.preset_version ?? '')}"${seatAttr}
    aria-label="${escapeHtml(`${toolLabel} (${machine.id} ${machine.display_name}${ariaHw}), ${machine.current_state}${machine.active_error ? `, active error ${machine.active_error}` : ''}`)}"
  >
    <span class="mt-chair" aria-hidden="true"></span>
    <span class="mt-desk">
      <span class="mt-spindle" aria-hidden="true"></span>
      <span class="node-top">
        <strong class="node-num">${escapeHtml(toolLabel)}</strong>
        <span class="badge-icon" aria-hidden="true">${symbol}</span>
      </span>
      <span class="node-id">${escapeHtml(machine.id)}</span>
      <span class="node-state-label">${escapeHtml(machine.current_state)}</span>
      ${hwHtml}
      ${versionHtml}
      <span class="node-update-pill" hidden></span>
      ${errorHtml}
    </span>
  </button><label class="machine-select-label" title="Select ${escapeHtml(machine.id)} for batch OTA or preset push">
    <input type="checkbox" class="machine-select-cb" data-select-machine="${escapeHtml(machine.id)}" aria-label="${escapeHtml(`Select ${toolLabel} (${machine.id}) for batch update`)}">
    <span class="machine-select-text">Select</span>
  </label></div>`;
}

function renderUnseededSlotPlaceholder(slot: FloorPlanSlot): string {
  return `<div
    class="mt-placeholder"
    data-slot-placeholder="${escapeHtml(slot.defaultId)}"
    data-seat="${slot.seatPosition}"
    aria-label="${escapeHtml(`${slot.label} (${slot.defaultId}) slot not registered`)}"
  >
    <span class="mt-chair" aria-hidden="true"></span>
    <span class="mt-desk">
      <span class="mt-spindle" aria-hidden="true"></span>
      <span class="node-top">
        <strong class="node-num">${escapeHtml(slot.label)}</strong>
      </span>
      <span class="node-id">${escapeHtml(slot.defaultId)}</span>
      <span class="node-state-label">UNASSIGNED</span>
    </span>
  </div>`;
}

function renderSlotOrPlaceholder(
  slot: FloorPlanSlot,
  byPosition: ReadonlyMap<number, MachineRecord>,
  byId: ReadonlyMap<string, MachineRecord>,
  consumedIds: Set<string>,
): string {
  const positioned = byPosition.get(slot.slotIndex);
  const legacyCandidate = !positioned ? byId.get(slot.defaultId) : undefined;
  const machine = positioned ?? (legacyCandidate?.floor_position == null ? legacyCandidate : undefined);

  if (machine) {
    consumedIds.add(machine.id);
    return renderMachineToolButton(machine, {
      slotLabel: slot.label,
      baySection: slot.baySection,
      seatPosition: slot.seatPosition,
      variant: 'blueprint',
    });
  }
  return renderUnseededSlotPlaceholder(slot);
}

/**
 * Render the architectural L-shaped 44-unit winding room floor plan and overflow bay.
 */
export function renderWorkshopFloorPlan(machines: readonly MachineRecord[]): string {
  const byPosition = new Map<number, MachineRecord>();
  const byId = new Map<string, MachineRecord>(machines.map((m) => [m.id, m]));
  for (const m of machines) {
    if (typeof m.floor_position === 'number' && m.floor_position > 0) {
      byPosition.set(m.floor_position, m);
    }
  }
  const consumedIds = new Set<string>();

  const renderSection = (section: FloorPlanSlot['section']) =>
    WORKSHOP_44_SLOTS.filter((s) => s.section === section)
      .map((slot) => renderSlotOrPlaceholder(slot, byPosition, byId, consumedIds))
      .join('');

  const narrowWestHtml = renderSection('narrow_west');
  const narrowEastHtml = renderSection('narrow_east');
  const mainRow1Html = renderSection('main_row_1');
  const mainRow2Html = renderSection('main_row_2');
  const mainRow3Html = renderSection('main_row_3');
  const mainRow4Html = renderSection('main_row_4');
  const rightStackHtml = renderSection('right_stack');

  const reserveFleetMachines = machines
    .filter((m) => !consumedIds.has(m.id))
    .sort((a, b) => {
      const pa = a.floor_position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.floor_position ?? Number.MAX_SAFE_INTEGER;
      return pa - pb || a.id.localeCompare(b.id);
    });

  const sectionCounts: Record<FloorBaySection, number> = {
    narrow_west: 0,
    narrow_east: 0,
    main_hall: 0,
    right_stack: 0,
    reserve_bay: 0,
  };
  for (const m of machines) {
    const sec = consumedIds.has(m.id) ? resolveMachineFloorSection(m) : 'reserve_bay';
    sectionCounts[sec] += 1;
  }

  const reserveBayHtml =
    reserveFleetMachines.length > 0
      ? `<section class="card reserve-fleet-bay zone-bay" data-section="reserve_bay" aria-labelledby="reserve-bay-heading">
          <div class="zone-header">
            <div>
              <h3 id="reserve-bay-heading">Additional Registered Fleet Units (#45+ &amp; Unslotted)</h3>
              <p class="machine-meta">Extra or custom-positioned units outside slots #1–#44 — click any machine tool to inspect diagnostics or reassign its ESP32 hardware.</p>
            </div>
            <span class="zone-count" id="reserve-bay-count" data-section-count="reserve_bay">${sectionCounts.reserve_bay}</span>
          </div>
          <div class="reserve-bay-grid">
            ${reserveFleetMachines
              .map((machine) =>
                renderMachineToolButton(machine, {
                  slotLabel: deriveToolLabel(machine.id, machine.floor_position),
                  baySection: 'reserve_bay',
                  seatPosition: 'bottom',
                  variant: 'blueprint',
                }),
              )
              .join('')}
          </div>
        </section>`
      : '';

  return `<div class="workshop-blueprint-shell" aria-label="44-Unit Winding Workshop Blueprint">
    <div class="blueprint-titlebar">
      <div class="blueprint-title">
        <strong>WORKSHOP FLOOR PLAN — 44 MACHINE TOOLS</strong>
        <span class="machine-meta">Fixed floor slots (#1–#44) decoupled from swappable ESP32 hardware IDs. Click any machine tool to inspect or reassign hardware.</span>
      </div>
      <span class="zone-pill">Scale: Schematic · L-Plan</span>
    </div>

    <div class="workshop-l-plan">
      <!-- Top-Left: NARROW WING (12 UNITS: 7 West + 5 East) -->
      <div class="plan-narrow-wing" aria-label="Narrow Wing (12 Units)">
        <div class="wing-top-label">NARROW WING</div>
        <div class="wing-side-label" aria-hidden="true">NARROW WING</div>

        <div class="wing-interior">
          <div class="wing-top-storage" aria-hidden="true">
            <span class="prop-coil" title="Spool"></span>
            <span class="prop-coil" title="Spool"></span>
            <span class="prop-crate"></span>
            <span class="prop-crate"></span>
            <span class="prop-crate"></span>
          </div>

          <div class="wing-bays-columns">
            <section
              class="zone-bay blueprint-zone"
              data-section="narrow_west"
              aria-labelledby="section-heading-narrow_west"
            >
              <div class="zone-header header-compact">
                <h3 id="section-heading-narrow_west">West Wall (#1–#7)</h3>
                <span class="zone-count" data-section-count="narrow_west">${sectionCounts.narrow_west}</span>
              </div>
              <div class="wing-wall-stack wing-west-stack">
                ${narrowWestHtml}
              </div>
            </section>

            <div class="wing-central-aisle" aria-hidden="true">
              <span class="aisle-label">AISLE</span>
            </div>

            <section
              class="zone-bay blueprint-zone"
              data-section="narrow_east"
              aria-labelledby="section-heading-narrow_east"
            >
              <div class="zone-header header-compact">
                <h3 id="section-heading-narrow_east">East Wall (#8–#12)</h3>
                <span class="zone-count" data-section-count="narrow_east">${sectionCounts.narrow_east}</span>
              </div>
              <div class="wing-wall-stack wing-east-stack">
                ${narrowEastHtml}
              </div>
              <div class="wing-corner-crates" aria-hidden="true">
                <span class="prop-crate"></span>
                <span class="prop-crate"></span>
              </div>
            </section>
          </div>
        </div>
      </div>

      <!-- Top-Right: FLOOR PLAN LEGEND BOX -->
      <aside class="plan-legend-panel" aria-label="Workshop floor plan unit totals">
        <div class="plan-legend-box">
          <div class="legend-total-label">TOTAL:</div>
          <div class="legend-total-value">44 UNITS</div>
          <dl class="legend-breakdown">
            <div>
              <dt>NARROW WING:</dt>
              <dd>12 UNITS (7 + 5) &middot; #1–#12</dd>
            </div>
            <div>
              <dt>MAIN HALL ROWS:</dt>
              <dd>24 UNITS (5 + 7 + 6 + 6) &middot; #13–#36</dd>
            </div>
            <div>
              <dt>RIGHT STACK:</dt>
              <dd>8 UNITS (4 &times; 2) &middot; #37–#44</dd>
            </div>
          </dl>
          <div class="legend-status-key" aria-label="Machine status key">
            <span class="status-badge status-working"><span aria-hidden="true">&#9679;</span> WORKING</span>
            <span class="status-badge status-idle"><span aria-hidden="true">&#9680;</span> IDLE</span>
            <span class="status-badge status-error"><span aria-hidden="true">&#9650;</span> ERROR</span>
            <span class="status-badge status-offline"><span aria-hidden="true">&#10005;</span> OFFLINE</span>
          </div>
        </div>
      </aside>

      <!-- Bottom Span: MAIN HALL (24 UNITS) + RIGHT STACK (8 UNITS) -->
      <div class="plan-main-hall" aria-label="Main Hall and Right Stack">
        <div class="main-hall-top-bar">
          <span class="hall-section-title">MAIN HALL</span>
          <div class="double-door-marker" aria-label="Main Hall North Double Doors">
            <span class="door-leaf door-left"></span>
            <span class="door-leaf door-right"></span>
            <span class="door-caption">ENTRANCE</span>
          </div>
        </div>

        <div class="main-hall-interior">
          <!-- Left storage rack & side row annotations -->
          <div class="hall-left-wall" aria-hidden="true">
            <div class="prop-spool-rack" title="Fiber Spool Rack">
              <span></span><span></span><span></span><span></span>
            </div>
            <div class="prop-crate-stack">
              <span class="prop-crate"></span>
              <span class="prop-crate"></span>
            </div>
            <div class="side-row-markers">
              <span>ROW 1 (5 UNITS)</span>
              <span>ROW 2 (7 UNITS)</span>
              <span>ROW 3 (6 UNITS)</span>
              <span>ROW 4 (6 UNITS)</span>
            </div>
          </div>

          <!-- Center: MAIN HALL ROWS (24 UNITS) -->
          <section
            class="zone-bay blueprint-zone"
            data-section="main_hall"
            aria-labelledby="section-heading-main_hall"
          >
            <div class="zone-header header-compact">
              <h3 id="section-heading-main_hall">Main Hall Rows (#13–#36)</h3>
              <span class="zone-count" data-section-count="main_hall">${sectionCounts.main_hall}</span>
            </div>

            <div class="hall-rows-stack">
              <div class="hall-row-group" aria-label="Row 1 (5 Units)">
                <div class="hall-bench-row hall-row-1">
                  ${mainRow1Html}
                </div>
                <div class="hall-row-caption">ROW 1 (5 UNITS &middot; #13–#17)</div>
              </div>

              <div class="hall-row-group" aria-label="Row 2 (7 Units)">
                <div class="hall-bench-row hall-row-2">
                  ${mainRow2Html}
                </div>
                <div class="hall-row-caption">ROW 2 (7 UNITS &middot; #18–#24)</div>
              </div>

              <div class="hall-row-group" aria-label="Row 3 (6 Units)">
                <div class="hall-bench-row hall-row-3">
                  ${mainRow3Html}
                </div>
                <div class="hall-row-caption">ROW 3 (6 UNITS &middot; #25–#30)</div>
              </div>

              <div class="hall-row-group" aria-label="Row 4 (6 Units)">
                <div class="hall-bench-row hall-row-4">
                  ${mainRow4Html}
                </div>
                <div class="hall-row-caption">ROW 4 (6 UNITS &middot; #31–#36)</div>
              </div>
            </div>
          </section>

          <!-- Right Wall: RIGHT STACK (8 UNITS, 4x2) + БРАК + East Door -->
          <section
            class="zone-bay blueprint-zone"
            data-section="right_stack"
            aria-labelledby="section-heading-right_stack"
          >
            <div class="zone-header header-compact">
              <h3 id="section-heading-right_stack">Right Stack (#37–#44 &middot; 4 &times; 2)</h3>
              <span class="zone-count" data-section-count="right_stack">${sectionCounts.right_stack}</span>
            </div>

            <div class="right-wall-cabinet" aria-hidden="true">CABINET</div>

            <div class="right-stack-grid" aria-label="Right Stack 8 Units (4 by 2)">
              ${rightStackHtml}
            </div>

            <div class="right-stack-footer" aria-hidden="true">
              <div class="brak-bin" title="Scrap / Reject Bin (БРАК)">
                <span class="brak-box"></span>
                <span class="brak-label">&#1041;&#1056;&#1040;&#1050;</span>
              </div>
              <div class="east-side-door" title="East Side Door">DOOR</div>
              <div class="bottom-right-crates">
                <span class="prop-crate"></span>
                <span class="prop-crate"></span>
                <span class="prop-crate"></span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    ${reserveBayHtml}
  </div>`;
}

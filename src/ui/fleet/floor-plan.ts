import type { MachineRecord } from '../../services/machines.js';
import type { FloorZone, MachineState } from '../../spec/mqtt-contract.js';
import { escapeHtml } from '../portal-layout.js';

export const ZONE_META: Record<FloorZone, { title: string; areaClass: string }> = {
  NORTH_LEFT: { title: 'Narrow Wing — West Wall (#1–#7)', areaClass: 'zone-north-left' },
  NORTH_RIGHT: { title: 'Narrow Wing — East Wall (#8–#12)', areaClass: 'zone-north-right' },
  MAIN_BANK: { title: 'Main Hall Rows (24 Units)', areaClass: 'zone-main-bank' },
  EAST_DOOR: { title: 'Right Stack (8 Units)', areaClass: 'zone-east-door' },
};

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
  zone: FloorZone;
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
  { slotIndex: 1, label: '#1', defaultId: 'W-01', zone: 'NORTH_LEFT', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 2, label: '#2', defaultId: 'W-02', zone: 'NORTH_LEFT', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 3, label: '#3', defaultId: 'W-03', zone: 'NORTH_LEFT', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 4, label: '#4', defaultId: 'W-04', zone: 'NORTH_LEFT', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 5, label: '#5', defaultId: 'W-05', zone: 'NORTH_LEFT', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 6, label: '#6', defaultId: 'W-06', zone: 'NORTH_LEFT', section: 'narrow_west', seatPosition: 'right' },
  { slotIndex: 7, label: '#7', defaultId: 'W-07', zone: 'NORTH_LEFT', section: 'narrow_west', seatPosition: 'right' },
  // Narrow Wing East Wall: #8..#12 (5 units)
  { slotIndex: 8, label: '#8', defaultId: 'W-08', zone: 'NORTH_RIGHT', section: 'narrow_east', seatPosition: 'left' },
  { slotIndex: 9, label: '#9', defaultId: 'W-09', zone: 'NORTH_RIGHT', section: 'narrow_east', seatPosition: 'left' },
  { slotIndex: 10, label: '#10', defaultId: 'W-10', zone: 'NORTH_RIGHT', section: 'narrow_east', seatPosition: 'left' },
  { slotIndex: 11, label: '#11', defaultId: 'W-11', zone: 'NORTH_RIGHT', section: 'narrow_east', seatPosition: 'left' },
  { slotIndex: 12, label: '#12', defaultId: 'W-12', zone: 'NORTH_RIGHT', section: 'narrow_east', seatPosition: 'left' },
  // Main Hall Row 1: #13..#17 (5 units, chairs on bottom)
  { slotIndex: 13, label: '#13', defaultId: 'W-13', zone: 'MAIN_BANK', section: 'main_row_1', seatPosition: 'bottom' },
  { slotIndex: 14, label: '#14', defaultId: 'W-14', zone: 'MAIN_BANK', section: 'main_row_1', seatPosition: 'bottom' },
  { slotIndex: 15, label: '#15', defaultId: 'W-15', zone: 'MAIN_BANK', section: 'main_row_1', seatPosition: 'bottom' },
  { slotIndex: 16, label: '#16', defaultId: 'W-16', zone: 'MAIN_BANK', section: 'main_row_1', seatPosition: 'bottom' },
  { slotIndex: 17, label: '#17', defaultId: 'W-17', zone: 'MAIN_BANK', section: 'main_row_1', seatPosition: 'bottom' },
  // Main Hall Row 2: #18..#24 (7 units, double-bench island)
  { slotIndex: 18, label: '#18', defaultId: 'W-18', zone: 'MAIN_BANK', section: 'main_row_2', seatPosition: 'top' },
  { slotIndex: 19, label: '#19', defaultId: 'W-19', zone: 'MAIN_BANK', section: 'main_row_2', seatPosition: 'bottom' },
  { slotIndex: 20, label: '#20', defaultId: 'W-20', zone: 'MAIN_BANK', section: 'main_row_2', seatPosition: 'top' },
  { slotIndex: 21, label: '#21', defaultId: 'W-21', zone: 'MAIN_BANK', section: 'main_row_2', seatPosition: 'bottom' },
  { slotIndex: 22, label: '#22', defaultId: 'W-22', zone: 'MAIN_BANK', section: 'main_row_2', seatPosition: 'top' },
  { slotIndex: 23, label: '#23', defaultId: 'W-23', zone: 'MAIN_BANK', section: 'main_row_2', seatPosition: 'bottom' },
  { slotIndex: 24, label: '#24', defaultId: 'W-24', zone: 'MAIN_BANK', section: 'main_row_2', seatPosition: 'top' },
  // Main Hall Row 3: #25..#30 (6 units, double-bench island)
  { slotIndex: 25, label: '#25', defaultId: 'W-25', zone: 'MAIN_BANK', section: 'main_row_3', seatPosition: 'top' },
  { slotIndex: 26, label: '#26', defaultId: 'W-26', zone: 'MAIN_BANK', section: 'main_row_3', seatPosition: 'bottom' },
  { slotIndex: 27, label: '#27', defaultId: 'W-27', zone: 'MAIN_BANK', section: 'main_row_3', seatPosition: 'top' },
  { slotIndex: 28, label: '#28', defaultId: 'W-28', zone: 'MAIN_BANK', section: 'main_row_3', seatPosition: 'bottom' },
  { slotIndex: 29, label: '#29', defaultId: 'W-29', zone: 'MAIN_BANK', section: 'main_row_3', seatPosition: 'top' },
  { slotIndex: 30, label: '#30', defaultId: 'W-30', zone: 'MAIN_BANK', section: 'main_row_3', seatPosition: 'bottom' },
  // Main Hall Row 4: #31..#36 (6 units along bottom wall, chairs on top)
  { slotIndex: 31, label: '#31', defaultId: 'W-31', zone: 'MAIN_BANK', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 32, label: '#32', defaultId: 'W-32', zone: 'MAIN_BANK', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 33, label: '#33', defaultId: 'W-33', zone: 'MAIN_BANK', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 34, label: '#34', defaultId: 'W-34', zone: 'MAIN_BANK', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 35, label: '#35', defaultId: 'W-35', zone: 'MAIN_BANK', section: 'main_row_4', seatPosition: 'top' },
  { slotIndex: 36, label: '#36', defaultId: 'W-36', zone: 'MAIN_BANK', section: 'main_row_4', seatPosition: 'top' },
  // Right Stack: #37..#44 (8 units, 4 x 2 along right wall)
  { slotIndex: 37, label: '#37', defaultId: 'W-37', zone: 'EAST_DOOR', section: 'right_stack', seatPosition: 'left', pairIndex: 1 },
  { slotIndex: 38, label: '#38', defaultId: 'W-38', zone: 'EAST_DOOR', section: 'right_stack', seatPosition: 'left', pairIndex: 1 },
  { slotIndex: 39, label: '#39', defaultId: 'W-39', zone: 'EAST_DOOR', section: 'right_stack', seatPosition: 'left', pairIndex: 2 },
  { slotIndex: 40, label: '#40', defaultId: 'W-40', zone: 'EAST_DOOR', section: 'right_stack', seatPosition: 'left', pairIndex: 2 },
  { slotIndex: 41, label: '#41', defaultId: 'W-41', zone: 'EAST_DOOR', section: 'right_stack', seatPosition: 'left', pairIndex: 3 },
  { slotIndex: 42, label: '#42', defaultId: 'W-42', zone: 'EAST_DOOR', section: 'right_stack', seatPosition: 'left', pairIndex: 3 },
  { slotIndex: 43, label: '#43', defaultId: 'W-43', zone: 'EAST_DOOR', section: 'right_stack', seatPosition: 'left', pairIndex: 4 },
  { slotIndex: 44, label: '#44', defaultId: 'W-44', zone: 'EAST_DOOR', section: 'right_stack', seatPosition: 'left', pairIndex: 4 },
];

const DEFAULT_ID_TO_SLOT = new Map<string, FloorPlanSlot>(
  WORKSHOP_44_SLOTS.map((slot) => [slot.defaultId, slot]),
);

export function deriveToolLabel(machineId: string, fallbackIndex?: number): string {
  const mapped = DEFAULT_ID_TO_SLOT.get(machineId);
  if (mapped) {
    return mapped.label;
  }
  const wMatch = /^W-0*(\d+)$/i.exec(machineId);
  if (wMatch) {
    return `#${wMatch[1]}`;
  }
  if (fallbackIndex !== undefined) {
    return `#${fallbackIndex}`;
  }
  return machineId;
}

function renderMachineToolButton(
  machine: MachineRecord,
  options: {
    slotLabel?: string;
    seatPosition?: 'left' | 'right' | 'top' | 'bottom';
    variant?: 'blueprint' | 'bay';
  } = {},
): string {
  const symbol = STATE_SYMBOLS[machine.current_state];
  const stateClass = STATE_CSS_CLASSES[machine.current_state];
  const toolLabel = options.slotLabel ?? deriveToolLabel(machine.id);
  const seatAttr = options.seatPosition ? ` data-seat="${options.seatPosition}"` : '';
  const variantClass = options.variant === 'blueprint' ? 'mt-unit' : '';
  const errorHtml = machine.active_error
    ? `<span class="node-error-code">${escapeHtml(machine.active_error)}</span>`
    : '';

  return `<button
    type="button"
    class="map-node ${variantClass} ${stateClass}"
    data-machine-id="${escapeHtml(machine.id)}"
    data-tool-label="${escapeHtml(toolLabel)}"
    data-state="${escapeHtml(machine.current_state)}"
    data-zone="${escapeHtml(machine.zone)}"${seatAttr}
    aria-label="${escapeHtml(`${toolLabel} (${machine.id} ${machine.display_name}), ${machine.current_state}${machine.active_error ? `, active error ${machine.active_error}` : ''}`)}"
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
      ${errorHtml}
    </span>
  </button>`;
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
  byId: ReadonlyMap<string, MachineRecord>,
  consumedIds: Set<string>,
): string {
  const machine = byId.get(slot.defaultId);
  if (machine) {
    consumedIds.add(machine.id);
    return renderMachineToolButton(machine, {
      slotLabel: slot.label,
      seatPosition: slot.seatPosition,
      variant: 'blueprint',
    });
  }
  return renderUnseededSlotPlaceholder(slot);
}

function renderExtraZoneMachines(
  zone: FloorZone,
  extraMachines: readonly MachineRecord[],
): string {
  if (extraMachines.length === 0) {
    return '';
  }
  return `<div class="zone-extra-machines" data-zone-extra="${escapeHtml(zone)}">
    ${extraMachines
      .map((machine) =>
        renderMachineToolButton(machine, {
          slotLabel: deriveToolLabel(machine.id),
          seatPosition: 'bottom',
          variant: 'blueprint',
        }),
      )
      .join('')}
  </div>`;
}

/**
 * Render the architectural L-shaped 44-unit winding room floor plan and overflow bay.
 */
export function renderWorkshopFloorPlan(machines: readonly MachineRecord[]): string {
  const byId = new Map<string, MachineRecord>(machines.map((m) => [m.id, m]));
  const consumedIds = new Set<string>();

  const narrowWestSlots = WORKSHOP_44_SLOTS.filter((s) => s.section === 'narrow_west');
  const narrowEastSlots = WORKSHOP_44_SLOTS.filter((s) => s.section === 'narrow_east');
  const mainRow1Slots = WORKSHOP_44_SLOTS.filter((s) => s.section === 'main_row_1');
  const mainRow2Slots = WORKSHOP_44_SLOTS.filter((s) => s.section === 'main_row_2');
  const mainRow3Slots = WORKSHOP_44_SLOTS.filter((s) => s.section === 'main_row_3');
  const mainRow4Slots = WORKSHOP_44_SLOTS.filter((s) => s.section === 'main_row_4');
  const rightStackSlots = WORKSHOP_44_SLOTS.filter((s) => s.section === 'right_stack');

  const narrowWestHtml = narrowWestSlots
    .map((slot) => renderSlotOrPlaceholder(slot, byId, consumedIds))
    .join('');
  const narrowEastHtml = narrowEastSlots
    .map((slot) => renderSlotOrPlaceholder(slot, byId, consumedIds))
    .join('');
  const mainRow1Html = mainRow1Slots
    .map((slot) => renderSlotOrPlaceholder(slot, byId, consumedIds))
    .join('');
  const mainRow2Html = mainRow2Slots
    .map((slot) => renderSlotOrPlaceholder(slot, byId, consumedIds))
    .join('');
  const mainRow3Html = mainRow3Slots
    .map((slot) => renderSlotOrPlaceholder(slot, byId, consumedIds))
    .join('');
  const mainRow4Html = mainRow4Slots
    .map((slot) => renderSlotOrPlaceholder(slot, byId, consumedIds))
    .join('');
  const rightStackHtml = rightStackSlots
    .map((slot) => renderSlotOrPlaceholder(slot, byId, consumedIds))
    .join('');

  // Machines that aren't W-01..W-44:
  // - Non-W-* custom or test machines appear directly inside their assigned floor zone bay
  // - Extra W-45..W-50 machines appear in the Reserve / Overflow Fleet Bay (#45–#50) below the blueprint
  const remainingMachines = machines.filter((m) => !consumedIds.has(m.id));
  const reserveFleetMachines: MachineRecord[] = [];
  const zoneExtras: Record<FloorZone, MachineRecord[]> = {
    NORTH_LEFT: [],
    NORTH_RIGHT: [],
    MAIN_BANK: [],
    EAST_DOOR: [],
  };

  for (const machine of remainingMachines) {
    const wNumMatch = /^W-0*(\d+)$/i.exec(machine.id);
    const wNum = wNumMatch ? Number(wNumMatch[1]) : NaN;
    if (Number.isInteger(wNum) && wNum > 44) {
      reserveFleetMachines.push(machine);
    } else {
      zoneExtras[machine.zone].push(machine);
    }
  }

  const countForZone = (zone: FloorZone) =>
    machines.filter((m) => m.zone === zone).length;

  const reserveBayHtml =
    reserveFleetMachines.length > 0
      ? `<section class="card reserve-fleet-bay" aria-labelledby="reserve-bay-heading">
          <div class="zone-header">
            <div>
              <h3 id="reserve-bay-heading">Additional Registered Fleet Units (#45–#50)</h3>
              <p class="machine-meta">Extra seeded winders outside the 44-unit workshop schematic — click any machine tool to inspect live diagnostics.</p>
            </div>
            <span class="zone-count" id="reserve-bay-count">${reserveFleetMachines.length}</span>
          </div>
          <div class="reserve-fleet-grid">
            ${reserveFleetMachines
              .map((m) =>
                renderMachineToolButton(m, {
                  slotLabel: deriveToolLabel(m.id),
                  seatPosition: 'bottom',
                  variant: 'blueprint',
                }),
              )
              .join('')}
          </div>
        </section>`
      : '';

  return `<div class="workshop-blueprint-wrapper" aria-label="L-shaped winding room floor map">
    <div class="blueprint-title-banner">
      <h2>WORKSHOP FLOOR PLAN — 44 MACHINE TOOLS</h2>
      <span class="machine-meta">Click any machine tool (#1–#44) to open live telemetry, active fault fix steps, and winding cycle rollups</span>
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
              class="zone-bay blueprint-zone zone-north-left"
              data-zone="NORTH_LEFT"
              aria-labelledby="zone-heading-NORTH_LEFT"
            >
              <div class="zone-header sr- header-compact">
                <h3 id="zone-heading-NORTH_LEFT">West Wall (#1–#7)</h3>
                <span class="zone-count" data-zone-count="NORTH_LEFT">${countForZone('NORTH_LEFT')}</span>
              </div>
              <div class="wing-wall-stack wing-west-stack">
                ${narrowWestHtml}
              </div>
              ${renderExtraZoneMachines('NORTH_LEFT', zoneExtras.NORTH_LEFT)}
            </section>

            <div class="wing-central-aisle" aria-hidden="true">
              <span class="aisle-label">AISLE</span>
            </div>

            <section
              class="zone-bay blueprint-zone zone-north-right"
              data-zone="NORTH_RIGHT"
              aria-labelledby="zone-heading-NORTH_RIGHT"
            >
              <div class="zone-header header-compact">
                <h3 id="zone-heading-NORTH_RIGHT">East Wall (#8–#12)</h3>
                <span class="zone-count" data-zone-count="NORTH_RIGHT">${countForZone('NORTH_RIGHT')}</span>
              </div>
              <div class="wing-wall-stack wing-east-stack">
                ${narrowEastHtml}
              </div>
              ${renderExtraZoneMachines('NORTH_RIGHT', zoneExtras.NORTH_RIGHT)}
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
            class="zone-bay blueprint-zone zone-main-bank"
            data-zone="MAIN_BANK"
            aria-labelledby="zone-heading-MAIN_BANK"
          >
            <div class="zone-header header-compact">
              <h3 id="zone-heading-MAIN_BANK">Main Hall Rows (#13–#36)</h3>
              <span class="zone-count" data-zone-count="MAIN_BANK">${countForZone('MAIN_BANK')}</span>
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

            ${renderExtraZoneMachines('MAIN_BANK', zoneExtras.MAIN_BANK)}
          </section>

          <!-- Right Wall: RIGHT STACK (8 UNITS, 4x2) + БРАК + East Door -->
          <section
            class="zone-bay blueprint-zone zone-east-door"
            data-zone="EAST_DOOR"
            aria-labelledby="zone-heading-EAST_DOOR"
          >
            <div class="zone-header header-compact">
              <h3 id="zone-heading-EAST_DOOR">Right Stack (#37–#44 &middot; 4 &times; 2)</h3>
              <span class="zone-count" data-zone-count="EAST_DOOR">${countForZone('EAST_DOOR')}</span>
            </div>

            <div class="right-wall-cabinet" aria-hidden="true">CABINET</div>

            <div class="right-stack-grid" aria-label="Right Stack 8 Units (4 by 2)">
              ${rightStackHtml}
            </div>

            ${renderExtraZoneMachines('EAST_DOOR', zoneExtras.EAST_DOOR)}

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

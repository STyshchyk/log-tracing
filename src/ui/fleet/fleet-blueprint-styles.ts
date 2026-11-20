/**
 * Architectural L-shaped 44-unit workshop schematic and machine tool node CSS rules
 * included inside `@layer components` of the Fleet PWA stylesheet.
 */
export const FLEET_BLUEPRINT_COMPONENT_STYLES = `
  /* ==========================================================================
     WORKSHOP FLOOR PLAN — 44 MACHINE TOOLS (Architectural L-Shaped Schematic)
     ========================================================================== */
  .workshop-blueprint-wrapper {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background-color: var(--surface);
    border: 3px solid var(--blueprint-wall-border);
    border-radius: 0.85rem;
    padding: clamp(0.75rem, 1.5vw, 1.35rem);
  }

  .blueprint-title-banner {
    text-align: center;
    border: 2px solid var(--blueprint-wall-border);
    background-color: var(--blueprint-floor);
    padding: 0.6rem 1rem;
    border-radius: 0.45rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
  }

  .blueprint-title-banner h2 {
    margin: 0;
    font-size: clamp(1.1rem, 1rem + 0.7vw, 1.45rem);
    letter-spacing: 0.04em;
    font-weight: 900;
  }

  .workshop-l-plan {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  @media (min-width: 980px) {
    .workshop-l-plan {
      grid-template-columns: minmax(22rem, 42%) minmax(0, 58%);
      grid-template-areas:
        "narrow-wing legend-panel"
        "main-hall   main-hall";
      row-gap: 0;
      column-gap: 1.25rem;
      align-items: stretch;
    }

    .plan-narrow-wing {
      grid-area: narrow-wing;
    }

    .plan-legend-panel {
      grid-area: legend-panel;
    }

    .plan-main-hall {
      grid-area: main-hall;
    }
  }

  /* Architectural Wall Shells */
  .plan-narrow-wing {
    position: relative;
    background-color: var(--blueprint-floor);
    border: 6px solid var(--blueprint-wall);
    outline: 2px solid var(--blueprint-wall-border);
    border-radius: 0.35rem 0.35rem 0 0;
    padding: 0.75rem 0.85rem 1rem;
  }

  @media (min-width: 980px) {
    .plan-narrow-wing {
      border-block-end: 0;
      z-index: 2;
    }
  }

  .wing-top-label {
    font-size: 0.82rem;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-block-end: 0.45rem;
    color: var(--text);
  }

  .wing-side-label {
    display: none;
  }

  @media (min-width: 1180px) {
    .wing-side-label {
      display: block;
      position: absolute;
      inset-inline-start: -3.2rem;
      inset-block-start: 45%;
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      writing-mode: vertical-rl;
      transform: rotate(180deg);
    }
  }

  .wing-interior {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .wing-top-storage {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.35rem;
    border-block-end: 1px dashed var(--border);
  }

  .prop-coil {
    inline-size: 1.25rem;
    block-size: 1.25rem;
    border-radius: 999px;
    background-color: var(--blueprint-wood);
    border: 2px solid var(--blueprint-wood-border);
    box-shadow: inset 0 0 0 3px var(--blueprint-floor);
  }

  .prop-crate {
    inline-size: 1.45rem;
    block-size: 1.35rem;
    background-color: var(--blueprint-wood);
    border: 2px solid var(--blueprint-wood-border);
    border-radius: 0.15rem;
  }

  .wing-bays-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 0.5rem;
    align-items: start;
  }

  @media (max-width: 560px) {
    .wing-bays-columns {
      grid-template-columns: 1fr;
    }
    .wing-central-aisle {
      display: none;
    }
  }

  .wing-central-aisle {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    padding-inline: 0.25rem;
    color: var(--text-muted);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.18em;
    writing-mode: vertical-rl;
    opacity: 0.65;
  }

  .wing-wall-stack {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .wing-corner-crates {
    margin-block-start: 0.85rem;
    display: flex;
    justify-content: flex-end;
    gap: 0.35rem;
  }

  /* Legend Box (Top-Right of L-shape) */
  .plan-legend-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
  }

  .plan-legend-box {
    inline-size: 100%;
    max-inline-size: 28rem;
    border: 2px solid var(--blueprint-wall-border);
    background-color: var(--blueprint-floor);
    padding: 1.1rem 1.25rem;
    border-radius: 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .legend-total-label {
    font-size: 0.95rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }

  .legend-total-value {
    font-size: clamp(1.75rem, 1.4rem + 1vw, 2.3rem);
    font-weight: 900;
    line-height: 1.05;
  }

  .legend-breakdown {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    font-size: 0.92rem;
  }

  .legend-breakdown dt {
    font-weight: 800;
  }

  .legend-breakdown dd {
    margin: 0.1rem 0 0;
    color: var(--text-muted);
    font-weight: 600;
  }

  .legend-status-key {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding-block-start: 0.5rem;
    border-block-start: 1px solid var(--border);
  }

  /* Main Hall (Bottom Horizontal Wing of L-shape) */
  .plan-main-hall {
    background-color: var(--blueprint-floor);
    border: 6px solid var(--blueprint-wall);
    outline: 2px solid var(--blueprint-wall-border);
    border-radius: 0 0.35rem 0.35rem 0.35rem;
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .main-hall-top-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-inline: 0.5rem;
    border-block-end: 2px solid var(--border);
    padding-block-end: 0.45rem;
  }

  .hall-section-title {
    font-size: 0.95rem;
    font-weight: 900;
    letter-spacing: 0.06em;
  }

  .double-door-marker {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--text-muted);
    padding: 0.15rem 0.6rem;
    border: 1px dashed var(--blueprint-wall-border);
    border-radius: 999px;
    background-color: var(--surface);
  }

  .door-leaf {
    inline-size: 0.85rem;
    block-size: 0.85rem;
    border: 2px solid var(--blueprint-wall-border);
    display: inline-block;
  }

  .door-left {
    border-radius: 0 100% 0 0;
    border-inline-start: 0;
  }

  .door-right {
    border-radius: 100% 0 0 0;
    border-inline-end: 0;
  }

  .main-hall-interior {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    align-items: start;
  }

  @media (min-width: 1020px) {
    .main-hall-interior {
      grid-template-columns: 6.5rem minmax(0, 1fr) minmax(14rem, 17.5rem);
      gap: 0.9rem;
    }
  }

  .hall-left-wall {
    display: none;
  }

  @media (min-width: 1020px) {
    .hall-left-wall {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.85rem;
      padding: 0.45rem;
      border-inline-end: 1px dashed var(--border);
      align-self: stretch;
    }
  }

  .prop-spool-rack {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.35rem;
    background-color: var(--blueprint-wood);
    border: 2px solid var(--blueprint-wood-border);
    border-radius: 0.25rem;
  }

  .prop-spool-rack span {
    inline-size: 1.3rem;
    block-size: 0.75rem;
    border-radius: 999px;
    background-color: var(--surface);
    border: 2px solid var(--blueprint-wood-border);
    display: block;
  }

  .prop-crate-stack {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .side-row-markers {
    margin-block-start: auto;
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--text-muted);
    text-align: center;
  }

  /* Blueprint Zones & Headers */
  .blueprint-zone {
    background-color: rgba(255, 255, 255, 0.45);
    border: 1.5px solid var(--border);
    border-radius: 0.55rem;
    padding: 0.55rem;
  }

  @media (prefers-color-scheme: dark) {
    .blueprint-zone {
      background-color: rgba(15, 20, 25, 0.45);
    }
  }

  .zone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-block-end: 0.55rem;
  }

  .zone-header.header-compact h3 {
    margin: 0;
    font-size: 0.84rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .zone-header h2,
  .zone-header h3 {
    margin: 0;
    font-size: 1rem;
  }

  .zone-count {
    font-weight: 800;
    font-size: 0.82rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background-color: var(--surface);
    border: 1px solid var(--border);
  }

  /* Main Hall 4 Rows (5 + 7 + 6 + 6 = 24 Units) */
  .hall-rows-stack {
    display: flex;
    flex-direction: column;
    gap: 0.95rem;
  }

  .hall-row-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
  }

  .hall-row-caption {
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .hall-bench-row {
    inline-size: 100%;
    display: grid;
    gap: 0.4rem;
    padding: 0.45rem;
    background-color: var(--blueprint-wood);
    border: 2px solid var(--blueprint-wood-border);
    border-radius: 0.45rem;
  }

  /* Row 1: 5 units across */
  .hall-row-1 {
    max-inline-size: 40rem;
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  /* Row 2: 7 units across (double-bench island) */
  .hall-row-2 {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  /* Row 3: 6 units across (double-bench island) */
  .hall-row-3 {
    max-inline-size: 46rem;
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  /* Row 4: 6 units across bottom wall */
  .hall-row-4 {
    max-inline-size: 46rem;
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  @media (max-width: 780px) {
    .hall-row-1,
    .hall-row-2,
    .hall-row-3,
    .hall-row-4 {
      grid-template-columns: repeat(auto-fit, minmax(5.75rem, 1fr));
    }
  }

  /* Right Stack: 8 units (4 x 2) */
  .right-wall-cabinet {
    margin-block-end: 0.5rem;
    padding: 0.35rem 0.5rem;
    background-color: var(--blueprint-wood);
    border: 2px solid var(--blueprint-wood-border);
    border-radius: 0.25rem;
    font-size: 0.7rem;
    font-weight: 800;
    text-align: center;
    letter-spacing: 0.06em;
  }

  .right-stack-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
    padding: 0.45rem;
    background-color: var(--blueprint-wood);
    border: 2px solid var(--blueprint-wood-border);
    border-radius: 0.45rem;
  }

  .right-stack-footer {
    margin-block-start: 0.65rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .brak-bin {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }

  .brak-box {
    inline-size: 2rem;
    block-size: 1.6rem;
    background: repeating-linear-gradient(
      45deg,
      var(--offline-bg),
      var(--offline-bg) 4px,
      var(--border) 4px,
      var(--border) 8px
    );
    border: 2px solid var(--blueprint-wall-border);
    border-radius: 0.2rem;
  }

  .brak-label {
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.05em;
  }

  .east-side-door {
    font-size: 0.7rem;
    font-weight: 800;
    padding: 0.2rem 0.5rem;
    border: 1px dashed var(--blueprint-wall-border);
    border-radius: 0.25rem;
    background-color: var(--surface);
  }

  .bottom-right-crates {
    display: flex;
    gap: 0.25rem;
  }

  /* Machine Tool Workstation Button (.map-node.mt-unit) */
  .map-node {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 0.12rem;
    min-block-size: var(--target-min);
    min-inline-size: 0;
    padding: 0.35rem 0.45rem;
    border-radius: 0.45rem;
    border: 2px solid var(--border);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: transform 100ms ease, box-shadow 100ms ease;
  }

  .map-node:hover {
    transform: translateY(-1px);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.18);
  }

  .map-node:active {
    transform: translateY(0);
  }

  .map-node[hidden] {
    display: none;
  }

  .mt-placeholder {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-block-size: var(--target-min);
    padding: 0.35rem 0.45rem;
    border-radius: 0.45rem;
    border: 2px dashed var(--border);
    background-color: var(--surface-subtle);
    color: var(--text-muted);
    opacity: 0.65;
  }

  .mt-desk {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-inline-size: 0;
  }

  .mt-spindle {
    display: block;
    inline-size: 100%;
    block-size: 4px;
    border-radius: 2px;
    background-color: currentColor;
    opacity: 0.35;
    margin-block-end: 0.1rem;
  }

  /* Operator Stool / Chair Indicator */
  .mt-chair {
    position: absolute;
    inline-size: 0.85rem;
    block-size: 0.45rem;
    background-color: var(--blueprint-chair);
    border: 1.5px solid var(--blueprint-wall-border);
    border-radius: 999px;
    pointer-events: none;
  }

  [data-seat="bottom"] .mt-chair {
    inset-block-end: -0.42rem;
    inset-inline-start: 50%;
    transform: translateX(-50%);
  }

  [data-seat="top"] .mt-chair {
    inset-block-start: -0.42rem;
    inset-inline-start: 50%;
    transform: translateX(-50%);
  }

  [data-seat="right"] .mt-chair {
    inline-size: 0.45rem;
    block-size: 0.85rem;
    inset-inline-end: -0.42rem;
    inset-block-start: 50%;
    transform: translateY(-50%);
  }

  [data-seat="left"] .mt-chair {
    inline-size: 0.45rem;
    block-size: 0.85rem;
    inset-inline-start: -0.42rem;
    inset-block-start: 50%;
    transform: translateY(-50%);
  }

  .zone-bay[data-empty-filtered="true"] {
    opacity: 0.65;
  }

  .node-top {
    inline-size: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.2rem;
  }

  .node-num {
    font-size: 0.92rem;
    font-weight: 900;
    line-height: 1.1;
  }

  .node-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.72rem;
    font-weight: 700;
    opacity: 0.9;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-state-label {
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.03em;
    line-height: 1.15;
  }

  .node-error-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.66rem;
    font-weight: 800;
    max-inline-size: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .zone-extra-machines {
    margin-block-start: 0.5rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr));
    gap: 0.4rem;
  }

  .reserve-fleet-bay {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    border-style: dashed;
  }

  .reserve-fleet-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
    gap: 0.6rem;
  }
`;

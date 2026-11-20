import { FLEET_BLUEPRINT_COMPONENT_STYLES } from './fleet-blueprint-styles.js';

/**
 * Complete embedded CSS stylesheet for the zero-CDN `/fleet` Department Heads PWA.
 */
export const FLEET_STYLES = `
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
    --blueprint-floor: #e5eff5;
    --blueprint-wall: #7d8790;
    --blueprint-wall-border: #2f3740;
    --blueprint-wood: #d9bf8c;
    --blueprint-wood-border: #6b5328;
    --blueprint-chair: #8b96a3;
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
      --blueprint-floor: #16222c;
      --blueprint-wall: #475569;
      --blueprint-wall-border: #94a3b8;
      --blueprint-wood: #524124;
      --blueprint-wood-border: #a18049;
      --blueprint-chair: #64748b;
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
    max-inline-size: 86rem;
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
    align-items: safe center;
    justify-content: space-between;
    gap: 0.65rem;
  }

  .filter-pills {
    display: flex;
    flex-wrap: wrap;
    flex-wrap: balance;
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
${FLEET_BLUEPRINT_COMPONENT_STYLES}
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
    inline-size: min(32rem, 100dvw);
    max-inline-size: 100dvw;
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
    scrollbar-gutter: stable;
    overscroll-behavior: contain;
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
    .workshop-blueprint-wrapper,
    .plan-narrow-wing,
    .plan-main-hall,
    .plan-legend-box,
    dialog.machine-drawer {
      border-color: CanvasText;
    }

    [role="tab"][aria-selected="true"]::after {
      border-block-end-color: Highlight;
    }
  }
}
`;

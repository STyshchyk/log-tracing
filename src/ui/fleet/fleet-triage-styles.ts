/**
 * CSS rules for the `/fleet` Industrial Console & Triage UI:
 * sticky header, access badge, live 10s poller pill, clickable KPI filter cards,
 * repeat-fault micro-strip, urgency/zone/id triage board, inline glossary popover,
 * and slide-over drawer enhancements (error stepper, QR handoff, checkable fix steps).
 * Included inside `@layer components` of `FLEET_STYLES`.
 */
export const FLEET_TRIAGE_COMPONENT_STYLES = `
  .fleet-header {
    position: sticky;
    inset-block-start: 0;
    z-index: 30;
    background-color: color-mix(in srgb, var(--bg) 90%, transparent);
    backdrop-filter: blur(10px);
    border-block-end: 1px solid var(--border);
    padding-block: 0.75rem;
    margin-inline: -0.25rem;
    padding-inline: 0.25rem;
  }

  .fleet-brand-wrap, .fleet-title-row, .coil-value-row, .repeat-fault-main, .triage-toolbar-left, .triage-section-header, .attention-id-row, .drawer-header-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
  }
  .fleet-brand-wrap { gap: 0.75rem; flex-wrap: nowrap; }
  .drawer-header-actions { gap: 0.35rem; flex: none; flex-wrap: nowrap; }

  .brand-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 2.25rem;
    block-size: 2.25rem;
    border-radius: 0.6rem;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 45%, transparent);
    background-color: color-mix(in srgb, var(--accent-primary) 18%, transparent);
    color: #818cf8;
    font-weight: 900;
    font-size: 0.95rem;
    flex: none;
  }

  .access-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.65rem;
    border-radius: 999px;
    border: 1px solid var(--working-border);
    background-color: var(--working-bg);
    color: var(--working-text);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .access-pill[data-access-mode="remote"] { border-color: #0284c7; background-color: #0c2d48; color: #7dd3fc; }

  .poll-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.85rem;
    border-radius: 0.55rem;
    border: 1px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    font: inherit;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
  }
  .poll-toggle-btn[data-paused="true"] { border-color: var(--idle-border); background-color: var(--idle-bg); color: var(--idle-text); }

  .poll-dot-wrap { position: relative; display: inline-flex; inline-size: 0.55rem; block-size: 0.55rem; }
  .poll-dot { inline-size: 100%; block-size: 100%; border-radius: 999px; background-color: #22c55e; }
  .poll-toggle-btn[data-paused="true"] .poll-dot { background-color: #f59e0b; }
  .poll-dot-ping {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background-color: #4ade80;
    opacity: 0.75;
    animation: fleet-poll-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
  }
  .poll-toggle-btn[data-paused="true"] .poll-dot-ping { display: none; }

  @keyframes fleet-poll-ping {
    75%, 100% { transform: scale(2); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .poll-dot-ping { animation: none; display: none; }
  }

  .kpi-filter-card {
    appearance: none;
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
  }
  .kpi-filter-card:hover { border-color: var(--focus-ring); }
  .kpi-filter-card[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent-primary); border-color: var(--accent-primary); }
  .kpi-filter-card .metric-value { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .kpi-bugs { background-color: #21163b; border-color: #7c3aed; color: #ddd6fe; }
  .kpi-bugs .metric-label { color: #c4b5fd; }

  .coil-rate-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.1rem 0.4rem;
    border-radius: 0.35rem;
    background-color: color-mix(in srgb, var(--working-border) 22%, transparent);
    color: var(--working-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    font-weight: 800;
  }
  .coil-value-row { align-items: baseline; gap: 0.4rem; }

  .repeat-fault-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    padding: 0.65rem 0.9rem;
    border-radius: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--idle-border) 55%, transparent);
    background-color: color-mix(in srgb, var(--idle-bg) 75%, var(--surface));
    color: var(--text);
    font-size: 0.88rem;
  }
  .repeat-fault-banner[hidden], .triage-search-clear[hidden], .active-filter-badge[hidden], .triage-board[hidden], .qr-preview-box[hidden] { display: none; }
  .repeat-fault-title { font-weight: 800; color: var(--idle-text); }

  .repeat-fault-jump-btn, .repeat-fault-dismiss-btn {
    border: 1px solid transparent;
    background: transparent;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 700;
    cursor: pointer;
    border-radius: 0.4rem;
    padding: 0.25rem 0.55rem;
    min-block-size: 36px;
  }
  .repeat-fault-jump-btn { color: var(--idle-text); text-decoration: underline; text-underline-offset: 2px; }
  .repeat-fault-dismiss-btn { color: var(--text-muted); min-inline-size: 36px; }
  .repeat-fault-dismiss-btn:hover { background-color: var(--surface-subtle); color: var(--text); }

  .triage-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .view-mode-group {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    padding: 0.2rem;
    border-radius: 0.6rem;
    border: 1px solid var(--border);
    background-color: var(--surface);
  }
  .view-mode-btn {
    padding: 0.45rem 0.8rem;
    border-radius: 0.45rem;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.86rem;
    font-weight: 700;
    cursor: pointer;
    min-block-size: 40px;
  }
  .view-mode-btn[aria-pressed="true"] { background-color: var(--accent-primary); color: var(--accent-primary-text); }

  .triage-search-wrap { position: relative; flex: 1 1 16rem; max-inline-size: 22rem; }
  .triage-search-wrap input {
    inline-size: 100%;
    padding: 0.5rem 2.2rem 0.5rem 0.75rem;
    border-radius: 0.55rem;
    border: 1px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
  }
  .triage-search-clear {
    position: absolute;
    inset-inline-end: 0.35rem;
    inset-block-start: 50%;
    transform: translateY(-50%);
    border: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    min-inline-size: 32px;
    min-block-size: 32px;
    border-radius: 0.35rem;
    font-weight: 800;
  }

  .active-filter-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.65rem;
    border-radius: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 50%, transparent);
    background-color: color-mix(in srgb, var(--accent-primary) 16%, transparent);
    color: #c7d2fe;
    font-size: 0.82rem;
    font-weight: 700;
  }
  .active-filter-clear { border: 0; background: transparent; color: inherit; cursor: pointer; font-weight: 900; padding: 0 0.25rem; min-block-size: 28px; }

  .triage-board { display: flex; flex-direction: column; gap: 1.25rem; }
  .triage-section { display: flex; flex-direction: column; gap: 0.65rem; }
  .triage-section-title { margin: 0; font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .triage-section-count { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.78rem; color: var(--text-muted); }

  .attention-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr)); gap: 0.75rem; }
  .attention-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.65rem;
    padding: 0.85rem 0.95rem;
    border-radius: 0.75rem;
    border: 1px solid var(--border);
    border-inline-start-width: 4px;
    background-color: var(--surface);
    text-align: left;
    transition: border-color 0.15s ease, transform 0.12s ease;
  }
  .attention-card:hover { border-color: var(--focus-ring); }
  .attention-card.attention-error { border-inline-start-color: var(--error-border); background-color: color-mix(in srgb, var(--error-bg) 42%, var(--surface)); }
  .attention-card.attention-offline { border-inline-start-color: var(--offline-border); background-color: var(--surface); }
  .attention-card.attention-bug { border-inline-start-color: #8b5cf6; background-color: color-mix(in srgb, #21163b 38%, var(--surface)); }

  .attention-top, .attention-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.45rem; }
  .attention-tool-num { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 1rem; font-weight: 800; color: var(--text); }
  .attention-machine-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.78rem; color: var(--text-muted); }
  .attention-bug-box { border-radius: 0.5rem; border: 1px solid color-mix(in srgb, #8b5cf6 45%, transparent); background-color: color-mix(in srgb, #8b5cf6 12%, transparent); padding: 0.45rem 0.65rem; font-size: 0.82rem; color: #e9d5ff; }
  .attention-footer { border-block-start: 1px solid color-mix(in srgb, var(--border) 60%, transparent); padding-block-start: 0.55rem; font-size: 0.8rem; }

  .attention-inspect-btn { border: 0; background: transparent; color: #818cf8; font: inherit; font-weight: 700; cursor: pointer; padding: 0.2rem 0.45rem; min-block-size: 36px; border-radius: 0.35rem; }
  .attention-inspect-btn:hover { background-color: color-mix(in srgb, var(--accent-primary) 18%, transparent); color: #c7d2fe; }

  .compact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr)); gap: 0.55rem; }
  .compact-tile { display: flex; flex-direction: column; gap: 0.35rem; padding: 0.55rem 0.65rem; border-radius: 0.6rem; border: 1px solid var(--border); border-inline-start-width: 3px; background-color: var(--surface-subtle); }
  .compact-tile.status-working { border-inline-start-color: var(--working-border); background-color: var(--surface-subtle); color: var(--text); }
  .compact-tile.status-idle { border-inline-start-color: var(--idle-border); background-color: var(--surface-subtle); color: var(--text); }
  .compact-tile.status-error { border-inline-start-color: var(--error-border); background-color: color-mix(in srgb, var(--error-bg) 45%, var(--surface)); color: var(--text); }
  .compact-tile.status-offline { border-inline-start-color: var(--offline-border); background-color: var(--surface); color: var(--text-muted); }

  .compact-tile-btn {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-block-size: 44px;
  }
  .compact-tile-top { display: flex; align-items: center; justify-content: space-between; gap: 0.3rem; }
  .compact-tile-meta { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.72rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .zone-groups-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); gap: 0.85rem; }
  .zone-group-card { display: flex; flex-direction: column; gap: 0.75rem; }

  .error-code-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.5rem;
    border-radius: 0.4rem;
    border: 1px solid color-mix(in srgb, var(--error-border) 60%, transparent);
    background-color: color-mix(in srgb, var(--error-bg) 80%, transparent);
    color: var(--error-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
    min-block-size: 32px;
  }
  .error-code-pill:hover { border-color: var(--error-border); background-color: var(--error-bg); }

  .glossary-popover {
    inline-size: min(24rem, calc(100dvw - 1.5rem));
    max-block-size: 24rem;
    overflow-y: auto;
    padding: 0.9rem 1rem;
    border-radius: 0.75rem;
    border: 1px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    box-shadow: 0 20px 45px rgba(0, 0, 0, 0.65);
    z-index: 60;
  }
  [popover].glossary-popover:is(:popover-open, .\:popover-open) { display: block; }
  @supports (position-area: block-end) {
    [popover].glossary-popover {
      inset: auto;
      margin: 0.4rem 0 0;
      position-anchor: --glossary-trigger;
      position-area: block-end span-inline-end;
      position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline;
    }
  }
  @supports not (position-area: block-end) {
    .glossary-popover { position: fixed; inset: auto; margin: 0; }
  }

  .glossary-popover-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; padding-block-end: 0.55rem; border-block-end: 1px solid var(--border); }
  .glossary-popover-body { margin-block-start: 0.6rem; font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.55rem; }
  .glossary-popover-footer { margin-block-start: 0.75rem; padding-block-start: 0.55rem; border-block-start: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.8rem; }

  .drawer-step-btn { min-inline-size: 40px; min-block-size: 40px; padding: 0.25rem 0.55rem; border-radius: 0.5rem; border: 1px solid var(--border); background-color: var(--surface-subtle); color: var(--text); font: inherit; font-weight: 800; cursor: pointer; }
  .drawer-step-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .drawer-hotkey-bar { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.35rem 0.65rem; border-radius: 0.45rem; background-color: var(--surface-subtle); font-size: 0.76rem; color: var(--text-muted); }
  .drawer-handoff-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.65rem; }

  .qr-preview-box { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; padding: 0.75rem; border-radius: 0.6rem; background-color: #ffffff; color: #0f172a; align-self: center; }
  .qr-preview-label { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.72rem; font-weight: 700; color: #0f172a; }

  .fix-steps-checklist { display: flex; flex-direction: column; gap: 0.4rem; }
  .fix-step-item { display: flex; align-items: flex-start; gap: 0.55rem; padding: 0.45rem 0.6rem; border-radius: 0.45rem; border: 1px solid var(--border); background-color: var(--surface); font-size: 0.86rem; cursor: pointer; }
  .fix-step-item input[type="checkbox"] { margin-block-start: 0.2rem; inline-size: 1rem; block-size: 1rem; flex: none; }
  .fix-step-item:has(input:checked) { border-color: var(--working-border); background-color: color-mix(in srgb, var(--working-bg) 45%, var(--surface)); color: var(--text-muted); text-decoration: line-through; }
`;

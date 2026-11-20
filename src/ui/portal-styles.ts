/**
 * Shared zero-CDN, mobile-first base & component stylesheet for the Worker Portal (`/`, `/m/*`).
 */
export const PORTAL_STYLES = `
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
    --accent-secondary: #ffffff;
    --accent-secondary-text: #111827;
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
      --accent-secondary: #1e293b;
      --accent-secondary-text: #f8fafc;
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

  :where(body, header, main, footer, nav, section, article, ul, ol, li, div, a, button, input, textarea, fieldset, label, p, h1, h2, h3) {
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

  :where(a, code) {
    overflow-wrap: anywhere;
  }

  :where(h1, h2, h3) {
    margin-block-start: 0;
    text-wrap: balance;
    line-height: 1.25;
  }

  h1 {
    font-size: clamp(1.5rem, 1.15rem + 1.5vw, 2.25rem);
    margin-block-end: 0.5rem;
  }

  h2 {
    font-size: clamp(1.15rem, 1rem + 0.75vw, 1.5rem);
    margin-block-end: 0.5rem;
  }

  :where(p, li) {
    text-wrap: pretty;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.95em;
    background-color: var(--surface-subtle);
    padding-block: 0.1em;
    padding-inline: 0.35em;
    border-radius: 0.25rem;
  }

  :where(a:any-link, button, input, textarea, select, summary, [tabindex="0"]):focus-visible {
    outline: 3px solid var(--focus-ring);
    outline-offset: 3px;
  }

  :where(button, select, textarea, input:not([type="checkbox"], [type="radio"]), [role="button"], .back-link, .action-card, .machine-card-link, .recovery-link) {
    min-block-size: var(--target-min);
    min-inline-size: var(--target-min);
  }
}

@layer components {
  .portal-shell {
    max-inline-size: 40rem;
    margin-inline: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .portal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding-block: 0.5rem;
    padding-inline: 0.85rem;
    border-radius: 0.5rem;
    border: 2px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    font-weight: 600;
    text-decoration: none;
  }

  .portal-main {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .card {
    background-color: var(--surface);
    border: 2px solid var(--border);
    border-radius: 0.75rem;
    padding: 1.15rem;
    min-block-size: 4rem;
  }

  .machine-meta {
    margin-block: 0 0.75rem;
    color: var(--text-muted);
    font-size: 0.95rem;
  }

  .status-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem;
    margin-block-end: 0.75rem;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding-block: 0.35rem;
    padding-inline: 0.75rem;
    border-radius: 999px;
    border: 2px solid currentColor;
    font-weight: 700;
    font-size: 0.95rem;
    letter-spacing: 0.02em;
  }

  .status-working {
    background-color: var(--working-bg);
    color: var(--working-text);
    border-color: var(--working-border);
    border-style: solid;
  }

  .status-idle {
    background-color: var(--idle-bg);
    color: var(--idle-text);
    border-color: var(--idle-border);
    border-style: dashed;
  }

  .status-error {
    background-color: var(--error-bg);
    color: var(--error-text);
    border-color: var(--error-border);
    border-style: double;
    border-width: 4px;
  }

  .status-offline {
    background-color: var(--offline-bg);
    color: var(--offline-text);
    border-color: var(--offline-border);
    border-style: dotted;
  }

  .error-code-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 0.9rem;
    margin-block-end: 0.75rem;
    border-radius: 0.5rem;
    border: 2px solid var(--error-border);
    background-color: var(--error-bg);
    color: var(--error-text);
    font-weight: 700;
    min-block-size: 3rem;
  }

  .last-seen {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.92rem;
  }

  .action-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.9rem;
  }

  .action-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.25rem;
    padding: 1.15rem 1.25rem;
    min-block-size: 4.5rem;
    border-radius: 0.75rem;
    border: 2px solid var(--border);
    text-decoration: none;
    font-weight: 700;
  }

  .action-primary {
    background-color: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--accent-primary-text);
  }

  .action-primary:hover {
    background-color: var(--accent-primary-hover);
  }

  .action-secondary {
    background-color: var(--accent-secondary);
    border-color: var(--border);
    color: var(--accent-secondary-text);
  }

  .action-title {
    font-size: 1.2rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .action-hint {
    font-size: 0.92rem;
    font-weight: 400;
    opacity: 0.92;
  }

  .machine-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .machine-card-link {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 1rem 1.15rem;
    background-color: var(--surface);
    border: 2px solid var(--border);
    border-radius: 0.75rem;
    color: var(--text);
    text-decoration: none;
  }

  .machine-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .machine-name {
    font-weight: 700;
    font-size: 1.1rem;
  }

  .recovery-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.85rem 1.25rem;
    border-radius: 0.65rem;
    background-color: var(--accent-primary);
    border: 2px solid var(--accent-primary);
    color: var(--accent-primary-text);
    font-weight: 700;
    text-decoration: none;
    inline-size: 100%;
  }

  .portal-footer {
    color: var(--text-muted);
    font-size: 0.85rem;
    padding-block-start: 0.25rem;
  }

  .recent-error-item {
    padding: 0.85rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background-color: var(--surface-subtle);
    min-block-size: 3.5rem;
  }

  .recent-error-code {
    background: transparent;
    padding: 0;
    color: inherit;
  }

  .recent-error-title {
    margin: 0.45rem 0 0;
    font-weight: 700;
  }

  .recent-error-summary {
    margin: 0.45rem 0 0;
    font-weight: 600;
  }

  .recent-error-title + .recent-error-summary {
    margin: 0.2rem 0 0;
    font-weight: 400;
  }

  .empty-state-note {
    margin-block-end: 0;
  }

  @media (forced-colors: active) {
    .card,
    .back-link,
    .action-card,
    .machine-card-link,
    .recovery-link,
    .status-badge,
    .error-code-badge,
    .recent-error-item {
      border-color: CanvasText;
    }

    :where(a:any-link, button, input, textarea, select, summary, [tabindex="0"]):focus-visible {
      outline: 3px solid Highlight;
    }
  }
}
`;

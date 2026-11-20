/**
 * CSS rules for `/fleet` multi-select unit checkboxes, firmware update badges,
 * batch OTA/preset toolbar, upload/preset forms with post-interaction validation,
 * and drawer rollout controls. Included inside `@layer components`.
 */
export const FLEET_OTA_COMPONENT_STYLES = `
  .fleet-shell {
    accent-color: var(--accent-primary);
  }

  .visually-hidden:where(:not(:focus-within, :active)) {
    position: absolute !important;
    clip-path: inset(50%) !important;
    overflow: hidden !important;
    width: 1px !important;
    height: 1px !important;
    margin: -1px !important;
    padding: 0 !important;
    border: 0 !important;
    white-space: nowrap !important;
  }

  .map-unit-cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-inline-size: 0;
  }

  .map-unit-cell[hidden] {
    display: none;
  }

  .map-unit-cell .map-node {
    inline-size: 100%;
    flex: 1 1 auto;
  }

  .map-node[data-selected="true"] {
    outline: 3px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .map-node[data-update-status="OUTDATED"],
  .map-node[data-update-status="UNKNOWN"] {
    border-style: dashed;
    border-width: 3px;
  }

  .node-fw-meta,
  .node-hw-meta {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.62rem;
    font-weight: 700;
    opacity: 0.85;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-hw-meta {
    color: var(--accent-primary);
  }

  .node-update-pill {
    display: inline-flex;
    align-self: flex-start;
    padding: 0.05rem 0.3rem;
    border-radius: 0.25rem;
    border: 1px solid currentColor;
    font-size: 0.6rem;
    font-weight: 900;
    letter-spacing: 0.03em;
  }

  .node-update-pill[hidden] {
    display: none;
  }

  .machine-select-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    min-block-size: var(--target-min);
    padding: 0.2rem 0.4rem;
    border-radius: 0.35rem;
    border: 1px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
    user-select: none;
  }

  .machine-select-cb {
    inline-size: 1.15rem;
    block-size: 1.15rem;
    margin: 0;
    cursor: pointer;
  }

  @supports not (accent-color: auto) {
    .machine-select-label {
      position: relative;
      padding-inline-start: 1.75rem;
    }

    .machine-select-cb {
      position: absolute !important;
      clip-path: inset(50%) !important;
      overflow: hidden !important;
      width: 1px !important;
      height: 1px !important;
      margin: -1px !important;
      padding: 0 !important;
      border: 0 !important;
      white-space: nowrap !important;
    }

    .machine-select-text::before {
      content: "";
      position: absolute;
      inset-inline-start: 0.4rem;
      inset-block-start: 50%;
      transform: translateY(-50%);
      inline-size: 1.05rem;
      block-size: 1.05rem;
      border: 2px solid var(--border);
      background-color: var(--surface);
      border-radius: 0.2rem;
    }

    .machine-select-cb:focus-visible + .machine-select-text::before {
      outline: 3px solid var(--focus-ring);
      outline-offset: 2px;
    }

    .machine-select-cb:checked + .machine-select-text::before {
      background-color: var(--accent-primary);
      border-color: var(--accent-primary);
    }

    .machine-select-cb:checked + .machine-select-text::after {
      content: "\\2713";
      position: absolute;
      inset-inline-start: 0.56rem;
      inset-block-start: 50%;
      transform: translateY(-50%);
      color: var(--accent-primary-text);
      font-weight: 900;
      font-size: 0.8rem;
    }
  }

  .batch-toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .batch-toolbar-row,
  .batch-dispatch-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.65rem 1rem;
  }

  .batch-check-group,
  .batch-selection-actions,
  .batch-action-group {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.5rem;
  }

  .batch-action-group {
    flex: 1 1 20rem;
  }

  .batch-status-msg:empty {
    display: none;
  }

  .ota-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  @media (min-width: 960px) {
    .ota-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .ota-card {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .ota-card h2,
  .ota-card h3 {
    margin: 0;
  }

  .ota-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .ota-form-pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.65rem;
  }

  .control-field input[type="file"],
  .control-field textarea {
    font: inherit;
    padding: 0.5rem 0.65rem;
    border-radius: 0.5rem;
    border: 2px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    min-block-size: var(--target-min);
  }

  .field-hint {
    display: block;
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  .field-error {
    display: none;
    color: var(--error-text);
    font-size: 0.84rem;
    font-weight: 600;
  }

  :is(:user-invalid, .user-invalid-fallback) {
    border-color: var(--error-border);
    background-color: var(--error-bg);
  }

  :is(:user-invalid, .user-invalid-fallback) + .field-error {
    display: block;
  }

  :is(:user-valid, .user-valid-fallback) {
    border-color: var(--working-border);
  }

  .ota-item-card {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .preset-json-preview {
    margin: 0;
    padding: 0.45rem 0.6rem;
    border-radius: 0.45rem;
    background-color: var(--surface-subtle);
    overflow-x: auto;
    font-size: 0.82rem;
  }

  .drawer-ota-controls,
  .drawer-hw-form {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .drawer-hw-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
  }

  .drawer-hw-actions .btn {
    min-block-size: var(--target-min);
  }

  .drawer-force-toggle {
    justify-content: flex-start;
    padding: 0.35rem 0.65rem;
  }

  @media (forced-colors: active) {
    .machine-select-label,
    .node-update-pill,
    .preset-json-preview {
      border-color: CanvasText;
    }

    .node-hw-meta {
      color: Highlight;
    }

    .map-node[data-selected="true"] {
      outline-color: Highlight;
    }
  }
`;

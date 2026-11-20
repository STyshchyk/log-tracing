import type { FirmwareReleaseRecord } from '../../services/firmware.js';
import type { PendingUpdateRecord } from '../../services/pending-updates.js';
import type { PresetRecord } from '../../services/presets.js';
import { escapeHtml } from '../portal-layout.js';
import { formatTimestampUtc } from '../recent-errors-section.js';

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
}

export function renderFirmwareSelectOptionsHtml(
  releases: readonly FirmwareReleaseRecord[],
): string {
  if (releases.length === 0) {
    return '<option value="">No firmware releases uploaded</option>';
  }
  return releases
    .map(
      (r, idx) =>
        `<option value="${escapeHtml(r.version)}"${idx === 0 ? ' selected' : ''}>${escapeHtml(`${r.version} (${r.filename}, ${formatByteSize(r.size_bytes)})`)}</option>`,
    )
    .join('');
}

export function renderPresetSelectOptionsHtml(presets: readonly PresetRecord[]): string {
  if (presets.length === 0) {
    return '<option value="">No presets saved</option>';
  }
  return presets
    .map(
      (p, idx) =>
        `<option value="${p.id}"${idx === 0 ? ' selected' : ''}>${escapeHtml(`${p.name} (${p.version})`)}</option>`,
    )
    .join('');
}

/**
 * Render the Floor Map Check Updates + multi-select batch OTA/preset toolbar.
 */
export function renderFloorBatchToolbarHtml(
  releases: readonly FirmwareReleaseRecord[],
  presets: readonly PresetRecord[],
): string {
  return `<section class="card batch-toolbar" aria-label="Firmware update check and batch rollout controls">
    <div class="batch-toolbar-row">
      <div class="batch-check-group">
        <button type="button" id="fleet-check-updates-btn" class="btn btn-primary">Check Updates</button>
        <span id="check-updates-summary" class="machine-meta" aria-live="polite">Compare machines against latest firmware release.</span>
      </div>
      <div class="batch-selection-actions">
        <span id="batch-selected-count" class="zone-pill" aria-live="polite">0 selected</span>
        <button type="button" id="batch-select-outdated-btn" class="btn">Select Outdated</button>
        <button type="button" id="batch-select-visible-btn" class="btn">Select Visible</button>
        <button type="button" id="batch-clear-selection-btn" class="btn" disabled>Clear</button>
      </div>
    </div>

    <div class="batch-dispatch-row">
      <div class="batch-action-group">
        <div class="control-field">
          <label for="batch-firmware-select">Target Firmware (.bin)</label>
          <select id="batch-firmware-select" name="targetFirmwareVersion">
            ${renderFirmwareSelectOptionsHtml(releases)}
          </select>
        </div>
        <button type="button" id="batch-push-ota-btn" class="btn btn-primary" disabled>Push OTA to Selected</button>
      </div>

      <div class="batch-action-group">
        <div class="control-field">
          <label for="batch-preset-select">Target Preset (JSON)</label>
          <select id="batch-preset-select" name="targetPresetId">
            ${renderPresetSelectOptionsHtml(presets)}
          </select>
        </div>
        <button type="button" id="batch-push-preset-btn" class="btn" disabled>Push Preset to Selected</button>
      </div>
    </div>

    <p id="fleet-ota-status" class="machine-meta batch-status-msg" role="status" aria-live="polite"></p>
  </section>`;
}

/**
 * Render the list of uploaded firmware `.bin` releases.
 */
export function renderFirmwareReleasesListHtml(releases: readonly FirmwareReleaseRecord[]): string {
  if (releases.length === 0) {
    return '<li class="card"><p class="machine-meta empty-state-note">No firmware releases uploaded yet.</p></li>';
  }
  return releases
    .map(
      (r) => `<li class="card ota-item-card">
        <div class="history-item-top">
          <div class="history-badges">
            <strong>v${escapeHtml(r.version)}</strong>
            <code>${escapeHtml(r.filename)}</code>
            <span class="zone-pill">${escapeHtml(formatByteSize(r.size_bytes))}</span>
            <code title="${escapeHtml(r.sha256)}">sha256:${escapeHtml(r.sha256.slice(0, 12))}</code>
          </div>
          <time class="last-seen" datetime="${escapeHtml(r.created_at)}">${escapeHtml(formatTimestampUtc(r.created_at))}</time>
        </div>
        ${r.notes ? `<p class="history-body">${escapeHtml(r.notes)}</p>` : ''}
        <div class="drawer-actions">
          <a class="nav-link" href="${escapeHtml(r.download_url)}">Download .bin</a>
        </div>
      </li>`,
    )
    .join('');
}

/**
 * Render the list of saved versioned JSON presets.
 */
export function renderPresetsListHtml(presets: readonly PresetRecord[]): string {
  if (presets.length === 0) {
    return '<li class="card"><p class="machine-meta empty-state-note">No versioned presets saved yet.</p></li>';
  }
  return presets
    .map(
      (p) => `<li class="card ota-item-card">
        <div class="history-item-top">
          <div class="history-badges">
            <strong>${escapeHtml(p.name)}</strong>
            <code>${escapeHtml(p.version)}</code>
          </div>
          <div class="drawer-actions">
            <time class="last-seen" datetime="${escapeHtml(p.created_at)}">${escapeHtml(formatTimestampUtc(p.created_at))}</time>
            <button type="button" class="btn" data-delete-preset="${p.id}">Delete</button>
          </div>
        </div>
        ${p.notes ? `<p class="history-body">${escapeHtml(p.notes)}</p>` : ''}
        <pre class="preset-json-preview"><code>${escapeHtml(JSON.stringify(p.config_json))}</code></pre>
      </li>`,
    )
    .join('');
}

/**
 * Render the list of pending, dispatched, and cancelled machine updates.
 */
export function renderUpdatesQueueListHtml(updates: readonly PendingUpdateRecord[]): string {
  if (updates.length === 0) {
    return '<li class="card"><p class="machine-meta empty-state-note">No OTA or preset updates queued or dispatched yet.</p></li>';
  }
  return updates
    .map((u) => {
      const statusClass =
        u.status === 'PENDING'
          ? 'status-idle'
          : u.status === 'DISPATCHED'
            ? 'status-working'
            : 'status-offline';
      const targetDesc = u.target_name
        ? `${u.target_name} (${u.target_version})`
        : u.target_version;
      const cancelBtn =
        u.status === 'PENDING'
          ? `<button type="button" class="btn" data-cancel-update="${u.id}">Cancel</button>`
          : '';

      return `<li class="card ota-item-card">
        <div class="history-item-top">
          <div class="history-badges">
            <span class="status-badge ${statusClass}">${escapeHtml(u.status)}</span>
            <button type="button" class="history-machine-btn" data-open-machine="${escapeHtml(u.machine_id)}">${escapeHtml(u.machine_id)}</button>
            <code>${escapeHtml(u.update_type)}</code>
            <span>${escapeHtml(targetDesc)}</span>
          </div>
          <div class="drawer-actions">
            <time class="last-seen" datetime="${escapeHtml(u.created_at)}">${escapeHtml(formatTimestampUtc(u.created_at))}</time>
            ${cancelBtn}
          </div>
        </div>
      </li>`;
    })
    .join('');
}

/**
 * Render the 4th `/fleet` tab panel for firmware upload, preset creation, and update queue control.
 */
export function renderOtaManagementTabPanelHtml(
  releases: readonly FirmwareReleaseRecord[],
  presets: readonly PresetRecord[],
  updates: readonly PendingUpdateRecord[],
): string {
  return `<div role="tabpanel" id="panel-ota" aria-labelledby="tab-ota" hidden="until-found">
    <div class="tabpanel-body">
      <div class="ota-grid">
        <section class="card ota-card" aria-labelledby="fw-upload-heading">
          <h2 id="fw-upload-heading">Upload Firmware Release (.bin)</h2>
          <form id="firmware-upload-form" class="ota-form">
            <div class="control-field">
              <label for="fw-upload-version">Firmware Version</label>
              <span id="fw-version-hint" class="field-hint">Alphanumeric start, 1–64 chars (e.g. 1.3.0)</span>
              <input
                id="fw-upload-version"
                name="version"
                type="text"
                required
                pattern="^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$"
                maxlength="64"
                placeholder="1.3.0"
                autocomplete="off"
                aria-invalid="false"
                aria-describedby="fw-version-hint"
                data-error="fw-version-error"
              >
              <div id="fw-version-error" class="field-error">
                <span role="img" aria-label="Error">&#9888;</span> Enter a valid version starting with a letter or digit (e.g. 1.3.0).
              </div>
            </div>

            <div class="control-field">
              <label for="fw-upload-file">Compiled ESP32 Binary (.bin)</label>
              <span id="fw-file-hint" class="field-hint">Max 4 MB .bin image; SHA-256 computed on upload</span>
              <input
                id="fw-upload-file"
                name="binary"
                type="file"
                accept=".bin"
                required
                aria-invalid="false"
                aria-describedby="fw-file-hint"
                data-error="fw-file-error"
              >
              <div id="fw-file-error" class="field-error">
                <span role="img" aria-label="Error">&#9888;</span> Select a .bin firmware file to upload.
              </div>
            </div>

            <div class="control-field">
              <label for="fw-upload-notes">Release Notes (optional)</label>
              <input id="fw-upload-notes" name="notes" type="text" maxlength="2000" placeholder="Brownout WDT fix and tension PID tweak">
            </div>

            <div class="drawer-actions">
              <button type="submit" id="fw-upload-submit" class="btn btn-primary">Upload Firmware</button>
              <span id="fw-upload-status" class="machine-meta" role="status" aria-live="polite"></span>
            </div>
          </form>

          <h3>Uploaded Releases</h3>
          <ul id="firmware-releases-list" class="history-list" role="list">
            ${renderFirmwareReleasesListHtml(releases)}
          </ul>
        </section>

        <section class="card ota-card" aria-labelledby="preset-create-heading">
          <h2 id="preset-create-heading">Versioned Presets (JSON)</h2>
          <form id="preset-create-form" class="ota-form">
            <div class="ota-form-pair">
              <div class="control-field">
                <label for="preset-name">Preset Name</label>
                <span id="preset-name-hint" class="field-hint">1–64 chars (e.g. fiberglass-2400)</span>
                <input
                  id="preset-name"
                  name="name"
                  type="text"
                  required
                  maxlength="64"
                  placeholder="fiberglass-2400"
                  aria-invalid="false"
                  aria-describedby="preset-name-hint"
                  data-error="preset-name-error"
                >
                <div id="preset-name-error" class="field-error">
                  <span role="img" aria-label="Error">&#9888;</span> Enter a preset name (1–64 characters).
                </div>
              </div>

              <div class="control-field">
                <label for="preset-version">Preset Version</label>
                <span id="preset-version-hint" class="field-hint">1–64 chars (e.g. 2026.11.1)</span>
                <input
                  id="preset-version"
                  name="version"
                  type="text"
                  required
                  maxlength="64"
                  placeholder="2026.11.1"
                  aria-invalid="false"
                  aria-describedby="preset-version-hint"
                  data-error="preset-version-error"
                >
                <div id="preset-version-error" class="field-error">
                  <span role="img" aria-label="Error">&#9888;</span> Enter a preset version (1–64 characters).
                </div>
              </div>
            </div>

            <div class="control-field">
              <label for="preset-config-json">Config JSON</label>
              <span id="preset-config-hint" class="field-hint">Keep JSON under 1024 bytes so MQTT APPLY_PRESET fits ESP32 budget</span>
              <textarea
                id="preset-config-json"
                name="config_json"
                rows="4"
                required
                spellcheck="false"
                placeholder='{"target_rpm": 1400, "tension_setpoint_n": 18.5}'
                aria-invalid="false"
                aria-describedby="preset-config-hint"
                data-error="preset-config-error"
              ></textarea>
              <div id="preset-config-error" class="field-error">
                <span role="img" aria-label="Error">&#9888;</span> Enter a valid non-empty JSON object.
              </div>
            </div>

            <div class="control-field">
              <label for="preset-notes">Notes (optional)</label>
              <input id="preset-notes" name="notes" type="text" maxlength="2000" placeholder="High-tension 2400 tex setup">
            </div>

            <div class="drawer-actions">
              <button type="submit" id="preset-create-submit" class="btn btn-primary">Save Preset</button>
              <span id="preset-form-status" class="machine-meta" role="status" aria-live="polite"></span>
            </div>
          </form>

          <h3>Saved Presets</h3>
          <ul id="presets-list" class="history-list" role="list">
            ${renderPresetsListHtml(presets)}
          </ul>
        </section>
      </div>

      <section class="card ota-card" aria-labelledby="updates-queue-heading">
        <div class="history-item-top">
          <h2 id="updates-queue-heading">Pending &amp; Recent Updates Queue</h2>
          <button type="button" id="refresh-updates-btn" class="btn">Refresh Queue</button>
        </div>
        <ul id="fleet-updates-list" class="history-list" role="list">
          ${renderUpdatesQueueListHtml(updates)}
        </ul>
      </section>
    </div>
  </div>`;
}

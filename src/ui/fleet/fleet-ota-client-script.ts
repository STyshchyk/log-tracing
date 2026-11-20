/**
 * Inline vanilla JS client runtime for `/fleet` Firmware OTA, Versioned Presets,
 * Check Updates, multi-select batch rollouts, pending queue management, and
 * accessible post-interaction form validation.
 */
export const FLEET_OTA_CLIENT_SCRIPT = `
(() => {
  const bootstrapEl = document.getElementById('fleet-bootstrap-data');
  if (!bootstrapEl) return;

  const otaState = {
    releases: [],
    presets: [],
    updates: [],
    selectedIds: new Set(),
    updateStatusById: new Map(),
    outdatedIds: new Set(),
  };

  try {
    const initial = JSON.parse(bootstrapEl.textContent || '{}');
    otaState.releases = Array.isArray(initial.releases) ? initial.releases : [];
    otaState.presets = Array.isArray(initial.presets) ? initial.presets : [];
    otaState.updates = Array.isArray(initial.updates) ? initial.updates : [];
  } catch {
    return;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function formatUtc(iso) {
    if (!iso) return 'Not yet reported';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  }

  function formatByteSize(bytes) {
    const n = Number(bytes || 0);
    if (n < 1024) return n + ' B';
    const kb = n / 1024;
    return kb < 1024 ? kb.toFixed(1) + ' KB' : (kb / 1024).toFixed(2) + ' MB';
  }

  function setStatus(targetId, message) {
    const node = document.getElementById(targetId);
    if (node) node.textContent = message || '';
  }

  function syncSelectionUi() {
    const count = otaState.selectedIds.size;
    const countEl = document.getElementById('batch-selected-count');
    if (countEl) countEl.textContent = count + ' selected';

    const clearBtn = document.getElementById('batch-clear-selection-btn');
    if (clearBtn) clearBtn.disabled = count === 0;

    const fwSel = document.getElementById('batch-firmware-select');
    const pushOtaBtn = document.getElementById('batch-push-ota-btn');
    if (pushOtaBtn) pushOtaBtn.disabled = count === 0 || !fwSel || !fwSel.value;

    const presetSel = document.getElementById('batch-preset-select');
    const pushPresetBtn = document.getElementById('batch-push-preset-btn');
    if (pushPresetBtn) pushPresetBtn.disabled = count === 0 || !presetSel || !presetSel.value;

    for (const cb of document.querySelectorAll('.machine-select-cb[data-select-machine]')) {
      const id = cb.getAttribute('data-select-machine');
      const isSelected = Boolean(id && otaState.selectedIds.has(id));
      cb.checked = isSelected;
      const cell = cb.closest('.map-unit-cell');
      const node = cell ? cell.querySelector('.map-node') : null;
      if (node) {
        if (isSelected) node.setAttribute('data-selected', 'true');
        else node.removeAttribute('data-selected');
      }
    }
  }

  function applyNodeUpdateBadges() {
    for (const node of document.querySelectorAll('.map-node[data-machine-id]')) {
      const id = node.getAttribute('data-machine-id');
      const status = id ? otaState.updateStatusById.get(id) : null;
      const pill = node.querySelector('.node-update-pill');
      if (status === 'OUTDATED' || status === 'UNKNOWN') {
        node.setAttribute('data-update-status', status);
        if (pill) {
          pill.textContent = status === 'OUTDATED' ? 'OUTDATED' : 'FW?';
          pill.hidden = false;
        }
      } else {
        if (status) node.setAttribute('data-update-status', status);
        else node.removeAttribute('data-update-status');
        if (pill) {
          pill.textContent = '';
          pill.hidden = true;
        }
      }
    }
  }

  function renderSelectOptions(selectEl, items, emptyLabel, toOption, selectedValue) {
    if (!selectEl) return;
    selectEl.textContent = '';
    if (items.length === 0) {
      const opt = el('option', '', emptyLabel);
      opt.value = '';
      selectEl.appendChild(opt);
      return;
    }
    for (const item of items) {
      const spec = toOption(item);
      const opt = el('option', '', spec.label);
      opt.value = spec.value;
      if (selectedValue && selectedValue === spec.value) opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  function renderFirmwareSelect(selectEl, selectedValue) {
    renderSelectOptions(
      selectEl,
      otaState.releases,
      'No firmware releases uploaded',
      (r) => ({ value: r.version, label: r.version + ' (' + r.filename + ', ' + formatByteSize(r.size_bytes) + ')' }),
      selectedValue,
    );
  }

  function renderPresetSelect(selectEl, selectedValue) {
    renderSelectOptions(
      selectEl,
      otaState.presets,
      'No presets saved',
      (p) => ({ value: String(p.id), label: p.name + ' (' + p.version + ')' }),
      selectedValue,
    );
  }

  function renderEmptyListMessage(listEl, message) {
    const li = el('li', 'card');
    li.appendChild(el('p', 'machine-meta empty-state-note', message));
    listEl.appendChild(li);
  }

  function renderFirmwareReleasesList() {
    const listEl = document.getElementById('firmware-releases-list');
    if (!listEl) return;
    listEl.textContent = '';
    if (otaState.releases.length === 0) return renderEmptyListMessage(listEl, 'No firmware releases uploaded yet.');
    for (const r of otaState.releases) {
      const li = el('li', 'card ota-item-card');
      const top = el('div', 'history-item-top');
      const badges = el('div', 'history-badges');
      badges.appendChild(el('strong', '', 'v' + r.version));
      badges.appendChild(el('code', '', r.filename));
      badges.appendChild(el('span', 'zone-pill', formatByteSize(r.size_bytes)));
      const shaCode = el('code', '', 'sha256:' + String(r.sha256 || '').slice(0, 12));
      shaCode.title = r.sha256 || '';
      badges.appendChild(shaCode);
      top.appendChild(badges);
      const t = el('time', 'last-seen', formatUtc(r.created_at));
      t.setAttribute('datetime', r.created_at);
      top.appendChild(t);
      li.appendChild(top);
      if (r.notes) li.appendChild(el('p', 'history-body', r.notes));
      const actions = el('div', 'drawer-actions');
      const dl = el('a', 'nav-link', 'Download .bin');
      dl.href = r.download_url;
      actions.appendChild(dl);
      li.appendChild(actions);
      listEl.appendChild(li);
    }
  }

  function renderPresetsList() {
    const listEl = document.getElementById('presets-list');
    if (!listEl) return;
    listEl.textContent = '';
    if (otaState.presets.length === 0) return renderEmptyListMessage(listEl, 'No versioned presets saved yet.');
    for (const p of otaState.presets) {
      const li = el('li', 'card ota-item-card');
      const top = el('div', 'history-item-top');
      const badges = el('div', 'history-badges');
      badges.appendChild(el('strong', '', p.name));
      badges.appendChild(el('code', '', p.version));
      top.appendChild(badges);
      const actions = el('div', 'drawer-actions');
      const t = el('time', 'last-seen', formatUtc(p.created_at));
      t.setAttribute('datetime', p.created_at);
      actions.appendChild(t);
      const delBtn = el('button', 'btn', 'Delete');
      delBtn.type = 'button';
      delBtn.setAttribute('data-delete-preset', String(p.id));
      actions.appendChild(delBtn);
      top.appendChild(actions);
      li.appendChild(top);
      if (p.notes) li.appendChild(el('p', 'history-body', p.notes));
      const pre = el('pre', 'preset-json-preview');
      pre.appendChild(el('code', '', JSON.stringify(p.config_json)));
      li.appendChild(pre);
      listEl.appendChild(li);
    }
  }

  function renderUpdatesList() {
    const listEl = document.getElementById('fleet-updates-list');
    if (!listEl) return;
    listEl.textContent = '';
    if (otaState.updates.length === 0) return renderEmptyListMessage(listEl, 'No OTA or preset updates queued or dispatched yet.');
    for (const u of otaState.updates) {
      const li = el('li', 'card ota-item-card');
      const top = el('div', 'history-item-top');
      const badges = el('div', 'history-badges');
      const statusCls = u.status === 'PENDING' ? 'status-idle' : (u.status === 'DISPATCHED' ? 'status-working' : 'status-offline');
      badges.appendChild(el('span', 'status-badge ' + statusCls, u.status));
      const mBtn = el('button', 'history-machine-btn', u.machine_id);
      mBtn.type = 'button';
      mBtn.setAttribute('data-open-machine', u.machine_id);
      badges.appendChild(mBtn);
      badges.appendChild(el('code', '', u.update_type));
      badges.appendChild(el('span', '', u.target_name ? u.target_name + ' (' + u.target_version + ')' : u.target_version));
      top.appendChild(badges);
      const actions = el('div', 'drawer-actions');
      const t = el('time', 'last-seen', formatUtc(u.created_at));
      t.setAttribute('datetime', u.created_at);
      actions.appendChild(t);
      if (u.status === 'PENDING') {
        const cancelBtn = el('button', 'btn', 'Cancel');
        cancelBtn.type = 'button';
        cancelBtn.setAttribute('data-cancel-update', String(u.id));
        actions.appendChild(cancelBtn);
      }
      top.appendChild(actions);
      li.appendChild(top);
      listEl.appendChild(li);
    }
  }

  async function refreshReleases() {
    const res = await fetch('/api/fleet/firmware', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    otaState.releases = Array.isArray(data.releases) ? data.releases : [];
    const batchSel = document.getElementById('batch-firmware-select');
    renderFirmwareSelect(batchSel, batchSel ? batchSel.value : '');
    renderFirmwareReleasesList();
    syncSelectionUi();
    document.dispatchEvent(
      new CustomEvent('fleet:catalog-updated', {
        detail: { releases: otaState.releases, presets: otaState.presets },
      }),
    );
  }

  async function refreshPresets() {
    const res = await fetch('/api/fleet/presets', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    otaState.presets = Array.isArray(data.presets) ? data.presets : [];
    const batchSel = document.getElementById('batch-preset-select');
    renderPresetSelect(batchSel, batchSel ? batchSel.value : '');
    renderPresetsList();
    syncSelectionUi();
    document.dispatchEvent(
      new CustomEvent('fleet:catalog-updated', {
        detail: { releases: otaState.releases, presets: otaState.presets },
      }),
    );
  }

  async function refreshUpdates() {
    const res = await fetch('/api/fleet/updates?limit=50', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    otaState.updates = Array.isArray(data.updates) ? data.updates : [];
    renderUpdatesList();
  }

  document.addEventListener('fleet:updates-dirty', () => {
    void refreshUpdates();
  });

  async function runCheckUpdates() {
    setStatus('check-updates-summary', 'Checking machine firmware versions...');
    const res = await fetch('/api/fleet/firmware/check-updates', { headers: { accept: 'application/json' } });
    if (!res.ok) {
      setStatus('check-updates-summary', 'Failed to check updates (HTTP ' + res.status + ').');
      return null;
    }
    const data = await res.json();
    otaState.updateStatusById.clear();
    otaState.outdatedIds.clear();
    for (const m of data.machines || []) {
      otaState.updateStatusById.set(m.machine_id, m.update_status);
      if (m.is_outdated) otaState.outdatedIds.add(m.machine_id);
    }
    applyNodeUpdateBadges();
    setStatus(
      'check-updates-summary',
      data.target_version
        ? data.outdated_count + ' outdated, ' + data.unknown_version_count + ' unknown, ' + data.up_to_date_count + ' up to date (target v' + data.target_version + ')'
        : 'No firmware releases uploaded yet.',
    );
    return data;
  }

  async function dispatchCommand(url, payload, label, statusTargetId) {
    setStatus(statusTargetId, 'Sending ' + label + '...');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(statusTargetId, body.error || (label + ' failed (HTTP ' + res.status + ')'));
      return false;
    }
    setStatus(
      statusTargetId,
      label + ': dispatched ' + body.dispatched_count + ', queued PENDING ' + body.queued_count + '.',
    );
    await refreshUpdates();
    return true;
  }

  function dispatchOta(version, machineIds, statusTargetId) {
    return dispatchCommand('/api/fleet/firmware/ota', { version, machineIds }, 'OTA v' + version, statusTargetId);
  }

  function dispatchPreset(presetId, machineIds, statusTargetId) {
    return dispatchCommand('/api/fleet/presets/' + encodeURIComponent(presetId) + '/push', { machineIds }, 'Preset', statusTargetId);
  }

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('machine-select-cb')) return;
    const id = target.getAttribute('data-select-machine');
    if (!id) return;
    if (target.checked) otaState.selectedIds.add(id);
    else otaState.selectedIds.delete(id);
    syncSelectionUi();
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const cancelBtn = target.closest('[data-cancel-update]');
    if (cancelBtn) {
      const updateId = cancelBtn.getAttribute('data-cancel-update');
      if (!updateId) return;
      void (async () => {
        const res = await fetch('/api/fleet/updates/' + encodeURIComponent(updateId) + '/cancel', {
          method: 'POST',
          headers: { accept: 'application/json' },
        });
        if (res.ok) {
          setStatus('fleet-ota-status', 'Cancelled pending update #' + updateId + '.');
          await refreshUpdates();
          document.dispatchEvent(new CustomEvent('fleet:refresh-drawer'));
        }
      })();
      return;
    }

    const delPresetBtn = target.closest('[data-delete-preset]');
    if (delPresetBtn) {
      const presetId = delPresetBtn.getAttribute('data-delete-preset');
      if (!presetId) return;
      void (async () => {
        const res = await fetch('/api/fleet/presets/' + encodeURIComponent(presetId), {
          method: 'DELETE',
          headers: { accept: 'application/json' },
        });
        if (res.ok) {
          setStatus('preset-form-status', 'Deleted preset #' + presetId + '.');
          await refreshPresets();
        }
      })();
    }
  });

  document.getElementById('fleet-check-updates-btn')?.addEventListener('click', () => { void runCheckUpdates(); });
  document.getElementById('batch-select-outdated-btn')?.addEventListener('click', () => {
    void (async () => {
      if (otaState.updateStatusById.size === 0) await runCheckUpdates();
      otaState.selectedIds.clear();
      for (const id of otaState.outdatedIds) otaState.selectedIds.add(id);
      syncSelectionUi();
    })();
  });
  document.getElementById('batch-select-visible-btn')?.addEventListener('click', () => {
    for (const cb of document.querySelectorAll('.map-unit-cell:not([hidden]) .machine-select-cb[data-select-machine]')) {
      const id = cb.getAttribute('data-select-machine');
      if (id) otaState.selectedIds.add(id);
    }
    syncSelectionUi();
  });
  document.getElementById('batch-clear-selection-btn')?.addEventListener('click', () => {
    otaState.selectedIds.clear();
    syncSelectionUi();
  });
  document.getElementById('refresh-updates-btn')?.addEventListener('click', () => { void refreshUpdates(); });

  const batchFwSelect = document.getElementById('batch-firmware-select');
  const batchPresetSelect = document.getElementById('batch-preset-select');
  batchFwSelect?.addEventListener('change', syncSelectionUi);
  batchPresetSelect?.addEventListener('change', syncSelectionUi);

  document.getElementById('batch-push-ota-btn')?.addEventListener('click', () => {
    if (batchFwSelect?.value && otaState.selectedIds.size > 0) {
      void dispatchOta(batchFwSelect.value, Array.from(otaState.selectedIds), 'fleet-ota-status');
    }
  });
  document.getElementById('batch-push-preset-btn')?.addEventListener('click', () => {
    if (batchPresetSelect?.value && otaState.selectedIds.size > 0) {
      void dispatchPreset(batchPresetSelect.value, Array.from(otaState.selectedIds), 'fleet-ota-status');
    }
  });

  const fwForm = document.getElementById('firmware-upload-form');
  fwForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const verEl = document.getElementById('fw-upload-version');
    const fileEl = document.getElementById('fw-upload-file');
    const notesEl = document.getElementById('fw-upload-notes');
    const file = fileEl && fileEl.files ? fileEl.files[0] : null;
    const version = verEl ? verEl.value.trim() : '';
    if (!version || !file) return;

    void (async () => {
      setStatus('fw-upload-status', 'Uploading ' + file.name + '...');
      const params = new URLSearchParams({ version, filename: file.name });
      if (notesEl && notesEl.value.trim()) params.set('notes', notesEl.value.trim());
      const res = await fetch('/api/fleet/firmware?' + params.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', accept: 'application/json' },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setStatus('fw-upload-status', body.error || ('Upload failed (HTTP ' + res.status + ')'));
      fwForm.reset();
      setStatus('fw-upload-status', 'Uploaded firmware v' + body.version + ' (' + formatByteSize(body.size_bytes) + ').');
      await refreshReleases();
    })();
  });

  const presetForm = document.getElementById('preset-create-form');
  presetForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const nameEl = document.getElementById('preset-name');
    const verEl = document.getElementById('preset-version');
    const cfgEl = document.getElementById('preset-config-json');
    const notesEl = document.getElementById('preset-notes');
    const name = nameEl ? nameEl.value.trim() : '';
    const version = verEl ? verEl.value.trim() : '';
    if (!name || !version || !cfgEl) return;

    let parsedCfg;
    try {
      parsedCfg = JSON.parse(cfgEl.value);
    } catch {
      return setStatus('preset-form-status', 'Invalid JSON syntax in Config JSON.');
    }

    void (async () => {
      setStatus('preset-form-status', 'Saving preset...');
      const res = await fetch('/api/fleet/presets', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          name,
          version,
          config_json: parsedCfg,
          notes: notesEl && notesEl.value.trim() ? notesEl.value.trim() : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setStatus('preset-form-status', body.error || ('Save failed (HTTP ' + res.status + ')'));
      presetForm.reset();
      setStatus('preset-form-status', 'Saved preset ' + body.name + ' (' + body.version + ').');
      await refreshPresets();
    })();
  });

  document.addEventListener('fleet:machines-updated', () => {
    syncSelectionUi();
    applyNodeUpdateBadges();
  });

  // Post-interaction accessible validation sync (:user-invalid + fallback)
  const supportsUserInvalid = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('selector(:user-invalid)');
  const dirtyState = new WeakMap();
  const announcer = el('div', 'visually-hidden');
  announcer.setAttribute('aria-live', 'polite');
  document.body.appendChild(announcer);
  let announceTimer = null;

  function linkFieldError(input, shown) {
    const errorId = input.dataset ? input.dataset.error : null;
    if (!errorId) return;
    const ids = (input.getAttribute('aria-describedby') || '').split(/\\s+/).filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  }

  function syncValidationControl(input, announce) {
    if (!input.matches || !input.matches('input, select, textarea') || !input.dataset?.error) return;
    let invalid = false;
    if (supportsUserInvalid) {
      invalid = input.matches(':user-invalid');
    } else {
      const st = dirtyState.get(input);
      if (st && st.hasBlurred) {
        invalid = !input.validity.valid;
        input.classList.toggle('user-invalid-fallback', invalid);
        input.classList.toggle('user-valid-fallback', !invalid);
      }
    }
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    linkFieldError(input, invalid);
    if (invalid && announce) {
      const errEl = document.getElementById(input.dataset.error);
      if (errEl) {
        clearTimeout(announceTimer);
        announcer.textContent = '';
        announceTimer = setTimeout(() => { announcer.textContent = errEl.textContent.trim(); }, 350);
      }
    }
  }

  for (const form of [fwForm, presetForm]) {
    if (!form) continue;
    form.addEventListener('blur', (e) => {
      const st = dirtyState.get(e.target) || { hasInteracted: false, hasBlurred: false };
      st.hasBlurred = true;
      dirtyState.set(e.target, st);
      syncValidationControl(e.target, true);
    }, true);
    form.addEventListener('input', (e) => {
      const st = dirtyState.get(e.target) || { hasInteracted: false, hasBlurred: false };
      st.hasInteracted = true;
      dirtyState.set(e.target, st);
      syncValidationControl(e.target, false);
    });
    form.addEventListener('change', (e) => {
      dirtyState.set(e.target, { hasInteracted: true, hasBlurred: true });
      syncValidationControl(e.target, true);
    });
    form.addEventListener('invalid', (e) => {
      dirtyState.set(e.target, { hasInteracted: true, hasBlurred: true });
      syncValidationControl(e.target, false);
    }, true);
    form.addEventListener('reset', () => {
      setTimeout(() => {
        for (const ctrl of form.elements) {
          dirtyState.delete(ctrl);
          ctrl.classList?.remove('user-invalid-fallback', 'user-valid-fallback');
          if (ctrl.dataset?.error) {
            ctrl.setAttribute('aria-invalid', 'false');
            linkFieldError(ctrl, false);
          }
        }
      });
    });
  }

  syncSelectionUi();
})();
`;

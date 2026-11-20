/**
 * Inline vanilla JS client runtime for `/fleet` machine drawer controls:
 * - ESP32 hardware ID assignment / replacement / unassignment (preserving floor history)
 * - Single-machine Firmware OTA release & JSON preset push + pending update cancellation
 */
export const FLEET_DRAWER_CONTROLS_SCRIPT = `
(() => {
  const bootstrapEl = document.getElementById('fleet-bootstrap-data');
  if (!bootstrapEl) return;

  let initial = {};
  try {
    initial = JSON.parse(bootstrapEl.textContent || '{}');
  } catch {
    return;
  }

  const catalogState = {
    releases: Array.isArray(initial.releases) ? initial.releases : [],
    presets: Array.isArray(initial.presets) ? initial.presets : [],
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function populateSelectOptions(selectEl, items, getValue, getLabel, emptyLabel) {
    if (!selectEl) return;
    const prev = selectEl.value;
    selectEl.textContent = '';
    if (items.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = emptyLabel;
      selectEl.appendChild(opt);
      selectEl.disabled = true;
      return;
    }
    selectEl.disabled = false;
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = getValue(item);
      opt.textContent = getLabel(item);
      selectEl.appendChild(opt);
    }
    if (prev && items.some((item) => getValue(item) === prev)) selectEl.value = prev;
  }

  function refreshDrawerCatalogSelects() {
    const fwSel = document.getElementById('drawer-fw-select');
    if (fwSel) {
      populateSelectOptions(
        fwSel,
        catalogState.releases,
        (r) => r.version,
        (r) => 'v' + r.version + ' — ' + r.filename,
        'No firmware releases uploaded',
      );
      const btn = document.getElementById('drawer-fw-send-btn');
      if (btn) btn.disabled = !fwSel.value;
    }
    const presetSel = document.getElementById('drawer-preset-select');
    if (presetSel) {
      populateSelectOptions(
        presetSel,
        catalogState.presets,
        (p) => String(p.id),
        (p) => p.name + ' (v' + p.version + ')',
        'No presets saved',
      );
      const btn = document.getElementById('drawer-preset-send-btn');
      if (btn) btn.disabled = !presetSel.value;
    }
  }

  document.addEventListener('fleet:catalog-updated', (event) => {
    const detail = event.detail || {};
    if (Array.isArray(detail.releases)) catalogState.releases = detail.releases;
    if (Array.isArray(detail.presets)) catalogState.presets = detail.presets;
    refreshDrawerCatalogSelects();
  });

  async function dispatchSingleCommand(url, payload, label, statusEl) {
    if (statusEl) statusEl.textContent = 'Sending ' + label + '...';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (statusEl) statusEl.textContent = body.error || (label + ' failed (HTTP ' + res.status + ')');
      return false;
    }
    if (statusEl) {
      statusEl.textContent =
        label + ': dispatched ' + body.dispatched_count + ', queued PENDING ' + body.queued_count + '.';
    }
    document.dispatchEvent(new CustomEvent('fleet:updates-dirty'));
    return true;
  }

  function buildHardwareSection(m) {
    const sec = el('div', 'drawer-section drawer-ota-controls');
    sec.id = 'drawer-hardware-section';
    sec.appendChild(el('h3', '', 'ESP32 Hardware Assignment'));
    sec.appendChild(
      el(
        'p',
        'machine-meta',
        'Bound board: ' + (m.hardware_id || 'Unassigned') + ' · Swapping hardware preserves all ' + m.id + ' history.',
      ),
    );

    const form = el('form', 'drawer-hw-form');
    form.id = 'drawer-hardware-form';

    const field = el('div', 'control-field');
    const label = el('label', '', 'Assigned ESP32 Hardware ID');
    label.setAttribute('for', 'drawer-hardware-id');
    const input = document.createElement('input');
    input.id = 'drawer-hardware-id';
    input.name = 'hardware_id';
    input.type = 'text';
    input.pattern = '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$';
    input.placeholder = 'e.g. esp32-a1b2c3';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = m.hardware_id || '';
    field.appendChild(label);
    field.appendChild(input);
    form.appendChild(field);

    const forceLabel = el('label', 'machine-select-label drawer-force-toggle');
    const forceCb = document.createElement('input');
    forceCb.type = 'checkbox';
    forceCb.id = 'drawer-hardware-force';
    forceCb.className = 'machine-select-cb';
    forceLabel.appendChild(forceCb);
    forceLabel.appendChild(el('span', '', 'Reassign if bound to another position'));
    form.appendChild(forceLabel);

    const actions = el('div', 'drawer-hw-actions');
    const assignBtn = el('button', 'btn btn-primary', 'Assign ESP32');
    assignBtn.type = 'submit';
    assignBtn.id = 'drawer-hardware-assign-btn';
    actions.appendChild(assignBtn);

    const unassignBtn = el('button', 'btn', 'Unassign');
    unassignBtn.type = 'button';
    unassignBtn.id = 'drawer-hardware-unassign-btn';
    unassignBtn.disabled = !m.hardware_id;
    actions.appendChild(unassignBtn);
    form.appendChild(actions);

    const hwStatus = el('p', 'machine-meta');
    hwStatus.id = 'drawer-hardware-status';
    hwStatus.setAttribute('role', 'status');
    hwStatus.setAttribute('aria-live', 'polite');

    async function submitHardwareUpdate(hardwareId, force) {
      hwStatus.textContent = hardwareId === null ? 'Unassigning ESP32...' : 'Assigning ESP32 ' + hardwareId + '...';
      const res = await fetch('/api/fleet/machines/' + encodeURIComponent(m.id) + '/hardware', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ hardware_id: hardwareId, force: Boolean(force) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        hwStatus.textContent =
          (body.error || 'Hardware ID conflict') + ' Check "Reassign if bound" to move from ' + (body.existing_machine_id || 'other position') + '.';
        return;
      }
      if (!res.ok) {
        hwStatus.textContent = body.error || 'Hardware update failed (HTTP ' + res.status + ').';
        return;
      }
      hwStatus.textContent = body.machine?.hardware_id
        ? 'Bound ' + body.machine.hardware_id + ' to ' + m.id + '.'
        : 'Cleared hardware assignment for ' + m.id + '.';
      document.dispatchEvent(new CustomEvent('fleet:refresh-drawer'));
      document.dispatchEvent(new CustomEvent('fleet:refresh-all'));
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(val)) {
        hwStatus.textContent = 'Enter a valid hardware ID (1–64 chars: letters, digits, _ or -).';
        input.focus();
        return;
      }
      void submitHardwareUpdate(val, forceCb.checked);
    });

    unassignBtn.addEventListener('click', () => {
      void submitHardwareUpdate(null, false);
    });

    sec.appendChild(form);
    sec.appendChild(hwStatus);
    return sec;
  }

  function buildOtaSection(details) {
    const m = details.machine;
    const sec = el('div', 'drawer-section drawer-ota-controls');
    sec.id = 'drawer-ota-section';
    sec.appendChild(el('h3', '', 'Firmware OTA & Presets'));
    sec.appendChild(
      el(
        'p',
        'machine-meta',
        'Firmware: ' + (m.fw_version || 'Not reported') + ' · Preset: ' +
          (m.preset_name ? m.preset_name + ' (' + (m.preset_version || '-') + ')' : (m.preset_version || 'Not reported')),
      ),
    );
    if (m.current_state === 'WORKING' || m.current_state === 'OFFLINE') {
      sec.appendChild(el('p', 'machine-meta', 'Machine is ' + m.current_state + ' — updates will queue as PENDING until IDLE.'));
    }

    const fwField = el('div', 'control-field');
    const fwLabel = el('label', '', 'Firmware Release (.bin)');
    fwLabel.setAttribute('for', 'drawer-fw-select');
    const fwSel = document.createElement('select');
    fwSel.id = 'drawer-fw-select';
    fwField.appendChild(fwLabel);
    fwField.appendChild(fwSel);
    sec.appendChild(fwField);

    const fwBtn = el('button', 'btn btn-primary', 'Send OTA Update');
    fwBtn.type = 'button';
    fwBtn.id = 'drawer-fw-send-btn';
    sec.appendChild(fwBtn);

    const presetField = el('div', 'control-field');
    const presetLabel = el('label', '', 'Preset (JSON)');
    presetLabel.setAttribute('for', 'drawer-preset-select');
    const presetSel = document.createElement('select');
    presetSel.id = 'drawer-preset-select';
    presetField.appendChild(presetLabel);
    presetField.appendChild(presetSel);
    sec.appendChild(presetField);

    const presetBtn = el('button', 'btn', 'Push Preset');
    presetBtn.type = 'button';
    presetBtn.id = 'drawer-preset-send-btn';
    sec.appendChild(presetBtn);

    const drawerStatus = el('p', 'machine-meta');
    drawerStatus.id = 'drawer-ota-status';
    drawerStatus.setAttribute('role', 'status');
    drawerStatus.setAttribute('aria-live', 'polite');
    sec.appendChild(drawerStatus);

    fwBtn.addEventListener('click', () => {
      if (!fwSel.value) return;
      void (async () => {
        const ok = await dispatchSingleCommand(
          '/api/fleet/firmware/ota',
          { version: fwSel.value, machineIds: [m.id] },
          'OTA v' + fwSel.value,
          drawerStatus,
        );
        if (ok) document.dispatchEvent(new CustomEvent('fleet:refresh-drawer'));
      })();
    });

    presetBtn.addEventListener('click', () => {
      if (!presetSel.value) return;
      void (async () => {
        const ok = await dispatchSingleCommand(
          '/api/fleet/presets/' + encodeURIComponent(presetSel.value) + '/push',
          { machineIds: [m.id] },
          'Preset',
          drawerStatus,
        );
        if (ok) document.dispatchEvent(new CustomEvent('fleet:refresh-drawer'));
      })();
    });

    const pending = Array.isArray(details.pending_updates) ? details.pending_updates : [];
    if (pending.length > 0) {
      sec.appendChild(el('h4', '', 'Pending Updates (' + pending.length + ')'));
      const ul = el('ul', 'drawer-list');
      for (const u of pending) {
        const li = document.createElement('li');
        const row = el('div', 'history-item-top');
        row.appendChild(el('code', '', u.update_type));
        row.appendChild(el('span', '', u.target_name ? u.target_name + ' (' + u.target_version + ')' : u.target_version));
        const cancelBtn = el('button', 'btn', 'Cancel');
        cancelBtn.type = 'button';
        cancelBtn.setAttribute('data-cancel-update', String(u.id));
        row.appendChild(cancelBtn);
        li.appendChild(row);
        ul.appendChild(li);
      }
      sec.appendChild(ul);
    }

    return sec;
  }

  document.addEventListener('fleet:drawer-rendered', (event) => {
    const { details, drawerBody } = event.detail || {};
    if (!details || !details.machine || !drawerBody) return;
    drawerBody.appendChild(buildHardwareSection(details.machine));
    drawerBody.appendChild(buildOtaSection(details));
    refreshDrawerCatalogSelects();
  });
})();
`;

import { FLEET_MARKDOWN_CLIENT_SCRIPT } from './fleet-client-markdown.js';
import { FLEET_FLOOR_SECTION_CLIENT_HELPER } from './floor-plan.js';

/**
 * Inline vanilla JS client runtime for the `/fleet` Department Heads PWA:
 * 10-second polling, floor status filters, tab switching, `<dialog>` machine drawer,
 * room history filters, and master glossary live search.
 */
export const FLEET_CLIENT_SCRIPT = `
(() => {
  const bootstrapEl = document.getElementById('fleet-bootstrap-data');
  if (!bootstrapEl) return;

  const state = {
    selectedWindow: 'TODAY',
    selectedFilterState: 'ALL',
    activeTab: 'map',
    summary: null,
    machines: [],
    openMachineId: null,
    authPaused: false,
    pollPaused: false,
  };

  try {
    const initial = JSON.parse(bootstrapEl.textContent || '{}');
    state.summary = initial.summary || null;
    state.machines = Array.isArray(initial.machines) ? initial.machines : [];
  } catch {
    return;
  }

  const STATE_SYMBOLS = { WORKING: '\\u25CF', IDLE: '\\u25D0', ERROR: '\\u25B2', OFFLINE: '\\u2715' };
  const STATE_CLASSES = { WORKING: 'status-working', IDLE: 'status-idle', ERROR: 'status-error', OFFLINE: 'status-offline' };
${FLEET_FLOOR_SECTION_CLIENT_HELPER}

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function formatUtc(iso) {
    if (!iso) return 'Not yet reported';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  }

  function formatWoundLength(value) {
    const safe = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
    const normalized = Number.isFinite(safe) ? safe : 0;
    const rounded = Math.round(normalized * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function formatNodeVersionLabel(machine) {
    const parts = [];
    if (machine.fw_version) parts.push('FW ' + machine.fw_version);
    if (machine.preset_version) parts.push('PR ' + machine.preset_version);
    return parts.join(' · ');
  }
${FLEET_MARKDOWN_CLIENT_SCRIPT}
  function renderSummaryStrip() {
    if (!state.summary) return;
    const mc = state.summary.machine_counts || {};
    const countMap = {
      'count-total': mc.total ?? 0,
      'count-working': mc.WORKING ?? 0,
      'count-idle': mc.IDLE ?? 0,
      'count-error': mc.ERROR ?? 0,
      'count-offline': mc.OFFLINE ?? 0,
      'count-open-bugs': state.summary.open_bug_reports ?? 0,
    };
    for (const [id, val] of Object.entries(countMap)) {
      const target = document.getElementById(id);
      if (target) target.textContent = String(val);
    }

    const updatedEl = document.getElementById('fleet-last-updated');
    if (updatedEl && state.summary.generated_at) {
      updatedEl.textContent = formatUtc(state.summary.generated_at);
      updatedEl.setAttribute('datetime', state.summary.generated_at);
    }

    const pillCounts = {
      ALL: mc.total ?? 0,
      WORKING: mc.WORKING ?? 0,
      IDLE: mc.IDLE ?? 0,
      ERROR: mc.ERROR ?? 0,
      OFFLINE: mc.OFFLINE ?? 0,
    };
    for (const [key, val] of Object.entries(pillCounts)) {
      const span = document.querySelector('[data-pill-count="' + key + '"]');
      if (span) span.textContent = String(val);
    }

    const rollups = Array.isArray(state.summary.coil_rollups) ? state.summary.coil_rollups : [];
    const bucket = rollups.find((r) => r.window === state.selectedWindow) || rollups[0];
    if (bucket) {
      const autoEl = document.getElementById('coil-auto-finished');
      const rateEl = document.getElementById('coil-auto-rate');
      const abortEl = document.getElementById('coil-aborted');
      const faultEl = document.getElementById('coil-fault-terminated');
      const woundEl = document.getElementById('coil-wound-length');
      const totCyclesEl = document.getElementById('coil-total-cycles');
      const autoCount = bucket.auto_finished_count ?? 0;
      const totCount = bucket.total_count ?? 0;
      if (autoEl) autoEl.textContent = String(autoCount);
      if (rateEl) rateEl.textContent = totCount > 0 ? Math.round((autoCount / totCount) * 100) + '%' : '0%';
      if (abortEl) abortEl.textContent = String(bucket.aborted_count ?? 0);
      if (faultEl) faultEl.textContent = String(bucket.fault_terminated_count ?? 0);
      if (woundEl) woundEl.textContent = formatWoundLength(bucket.total_wound_length ?? 0);
      if (totCyclesEl) totCyclesEl.textContent = String(totCount) + ' cycles';
    }
  }

  function applyMapFilter() {
    let visibleCount = 0;
    const totalCount = document.querySelectorAll('.map-node').length;
    const sectionVisible = { narrow_west: 0, narrow_east: 0, main_hall: 0, right_stack: 0, reserve_bay: 0 };

    for (const node of document.querySelectorAll('.map-node')) {
      const matches = state.selectedFilterState === 'ALL' || node.dataset.state === state.selectedFilterState;
      const cell = node.closest('.map-unit-cell');
      if (cell) cell.hidden = !matches;
      else node.hidden = !matches;
      if (matches) {
        visibleCount += 1;
        const sec = node.dataset.section;
        if (sec && sec in sectionVisible) sectionVisible[sec] += 1;
      }
    }

    for (const secEl of document.querySelectorAll('.zone-bay')) {
      const sec = secEl.dataset.section;
      const count = sec && sec in sectionVisible ? sectionVisible[sec] : 0;
      secEl.dataset.emptyFiltered = count === 0 ? 'true' : 'false';
      const badge = secEl.querySelector('[data-section-count]');
      if (badge) badge.textContent = String(count);
    }

    const statusEl = document.getElementById('map-filter-status');
    if (statusEl) {
      statusEl.textContent = state.selectedFilterState === 'ALL'
        ? 'Showing all ' + totalCount + ' machines'
        : 'Showing ' + visibleCount + ' of ' + totalCount + ' machines (' + state.selectedFilterState + ')';
    }
  }

  function updateMapNodes() {
    for (const machine of state.machines) {
      const node = document.querySelector('.map-node[data-machine-id="' + CSS.escape(machine.id) + '"]');
      if (!node) continue;
      const posStr = machine.floor_position != null ? String(machine.floor_position) : '';
      const hwStr = machine.hardware_id || '';
      const cell = node.closest('.map-unit-cell');
      if (cell) {
        cell.dataset.state = machine.current_state;
        cell.dataset.floorPosition = posStr;
        cell.dataset.hardwareId = hwStr;
      }

      const toolLabel = deriveToolLabel(machine.id, machine.floor_position);
      node.dataset.toolLabel = toolLabel;
      node.dataset.state = machine.current_state;
      node.dataset.floorPosition = posStr;
      node.dataset.hardwareId = hwStr;
      node.dataset.fwVersion = machine.fw_version || '';
      node.dataset.presetVersion = machine.preset_version || '';
      node.className = 'map-node mt-unit ' + (STATE_CLASSES[machine.current_state] || 'status-offline');
      node.setAttribute(
        'aria-label',
        toolLabel + ' (' + machine.id + ' ' + machine.display_name + (hwStr ? ', ESP32 ' + hwStr : '') + '), ' + machine.current_state +
          (machine.active_error ? ', active error ' + machine.active_error : ''),
      );
      const iconEl = node.querySelector('.badge-icon');
      if (iconEl) iconEl.textContent = STATE_SYMBOLS[machine.current_state] || '?';
      const labelEl = node.querySelector('.node-state-label');
      if (labelEl) labelEl.textContent = machine.current_state;

      const deskEl = node.querySelector('.mt-desk') || node;
      let hwEl = node.querySelector('.node-hw-meta');
      if (hwStr) {
        if (!hwEl) {
          hwEl = el('span', 'node-hw-meta');
          const insertRef = node.querySelector('.node-fw-meta') || node.querySelector('.node-update-pill');
          deskEl.insertBefore(hwEl, insertRef || null);
        }
        hwEl.textContent = hwStr;
      } else if (hwEl) {
        hwEl.remove();
      }

      const versionLabel = formatNodeVersionLabel(machine);
      let fwEl = node.querySelector('.node-fw-meta');
      if (versionLabel) {
        if (!fwEl) {
          fwEl = el('span', 'node-fw-meta');
          deskEl.appendChild(fwEl);
        }
        fwEl.textContent = versionLabel;
      } else if (fwEl) {
        fwEl.remove();
      }

      let errEl = node.querySelector('.node-error-code');
      if (machine.active_error) {
        if (!errEl) {
          errEl = el('span', 'node-error-code');
          deskEl.appendChild(errEl);
        }
        errEl.textContent = machine.active_error;
      } else if (errEl) {
        errEl.remove();
      }
    }
    applyMapFilter();
    document.dispatchEvent(new CustomEvent('fleet:machines-updated', { detail: { machines: state.machines } }));
  }

  // Tabs (selection follows focus / click + beforematch for hidden="until-found")
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
  const hasNativeFocusGroup = Object.hasOwn(HTMLElement.prototype, 'focusGroup');

  function syncTabFocusability(selectedTab) {
    if (hasNativeFocusGroup) return;
    for (const tab of tabs) {
      tab.tabIndex = tab === selectedTab ? 0 : -1;
    }
  }

  function selectTab(targetTab, focusTab) {
    state.activeTab = targetTab.dataset.tab || 'map';
    for (const tab of tabs) {
      const isSelected = tab === targetTab;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.toggleAttribute('focusgroupstart', isSelected);
    }
    syncTabFocusability(targetTab);
    for (const panel of panels) {
      const isTarget = panel.getAttribute('aria-labelledby') === targetTab.id;
      if (isTarget) {
        panel.removeAttribute('hidden');
        panel.setAttribute('tabindex', '0');
      } else {
        panel.setAttribute('hidden', 'until-found');
        panel.removeAttribute('tabindex');
      }
    }
    if (typeof targetTab.scrollIntoView === 'function') {
      targetTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (focusTab) targetTab.focus();
  }

  const initialTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0];
  if (initialTab) syncTabFocusability(initialTab);

  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (event) => {
      const idx = tabs.indexOf(tab);
      let nextIdx = -1;
      if (event.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIdx = 0;
      else if (event.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx >= 0) {
        event.preventDefault();
        selectTab(tabs[nextIdx], true);
      }
    });
  }

  for (const panel of panels) {
    panel.addEventListener('beforematch', () => {
      const tabId = panel.getAttribute('aria-labelledby');
      const matchingTab = tabs.find((t) => t.id === tabId);
      if (matchingTab) selectTab(matchingTab, false);
    });
  }

  // Coil window switcher
  for (const btn of document.querySelectorAll('.window-btn')) {
    btn.addEventListener('click', () => {
      state.selectedWindow = btn.dataset.coilWindow || 'TODAY';
      for (const b of document.querySelectorAll('.window-btn')) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      renderSummaryStrip();
    });
  }

  // Floor status filter pills
  for (const pill of document.querySelectorAll('.filter-pill')) {
    pill.addEventListener('click', () => {
      state.selectedFilterState = pill.dataset.filterState || 'ALL';
      for (const p of document.querySelectorAll('.filter-pill')) {
        p.setAttribute('aria-pressed', String(p === pill));
      }
      applyMapFilter();
    });
  }

  // Native modal drawer + closedby="any" Safari fallback
  const drawer = document.getElementById('machine-drawer');
  const drawerTitle = document.getElementById('drawer-title');
  const drawerBody = document.getElementById('drawer-body');

  if (drawer) {
    drawer.addEventListener('close', () => {
      drawer.returnValue = '';
      state.openMachineId = null;
    });

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (e) => {
        const r = drawer.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      drawer.addEventListener('pointerdown', (e) => { pressedOutside = isOutside(e); });
      drawer.addEventListener('pointerup', (e) => { if (pressedOutside && isOutside(e)) drawer.close(); });
    }
  }

  function renderDrawerContent(details) {
    if (!drawerBody || !drawerTitle) return;
    const m = details.machine;
    const toolLabel = deriveToolLabel(m.id, m.floor_position);
    const secKey = resolveSection(m);
    const sectionTitle = SECTION_TITLES[secKey] || secKey;
    drawerTitle.textContent = toolLabel + ' (' + m.id + ') — ' + m.display_name;
    drawerBody.textContent = '';

    // Overview section
    const overview = el('div', 'drawer-section');
    overview.appendChild(el('p', 'machine-meta', 'Floor Position ' + toolLabel + ' · ' + sectionTitle));
    overview.appendChild(el('p', 'machine-meta', 'ESP32 Hardware: ' + (m.hardware_id || 'Unassigned (legacy ID fallback)')));

    const badge = el('span', 'status-badge ' + (STATE_CLASSES[m.current_state] || 'status-offline'));
    badge.textContent = (STATE_SYMBOLS[m.current_state] || '') + ' ' + m.current_state;
    overview.appendChild(badge);

    if (m.active_error) {
      const errLine = el('p');
      errLine.appendChild(document.createTextNode('Active error: '));
      errLine.appendChild(el('code', '', m.active_error));
      overview.appendChild(errLine);
    }
    overview.appendChild(el('p', 'last-seen', 'Last seen: ' + formatUtc(m.last_seen_at)));

    const actions = el('div', 'drawer-actions');
    const portalLink = el('a', 'nav-link btn-primary', 'Open Worker Portal');
    portalLink.href = details.worker_portal_url || ('/m/' + encodeURIComponent(m.id));
    actions.appendChild(portalLink);
    const bugLink = el('a', 'nav-link', 'Report a Bug');
    bugLink.href = '/m/' + encodeURIComponent(m.id) + '/report-bug';
    actions.appendChild(bugLink);
    overview.appendChild(actions);
    drawerBody.appendChild(overview);

    // Pinned Glossary Fix
    if (details.active_glossary) {
      const g = details.active_glossary;
      const gSec = el('div', 'drawer-section');
      gSec.appendChild(el('h3', '', 'Active Fault Fix: ' + g.title));
      gSec.appendChild(el('p', '', g.symptoms));
      gSec.appendChild(renderMarkdownSafe(g.fix_steps_md));
      drawerBody.appendChild(gSec);
    }

    // ESP32 Winding Cycle Rollups
    const coilSec = el('div', 'drawer-section');
    coilSec.appendChild(el('h3', '', 'Winding Cycle Telemetry (ESP32)'));
    const table = el('table', 'rollup-table');
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    for (const h of ['Window', 'Auto-Finished', 'Aborted', 'Fault-Stopped', 'Total', 'Wound Fiber']) {
      hRow.appendChild(el('th', '', h));
    }
    thead.appendChild(hRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of details.coil_rollups || []) {
      const tr = document.createElement('tr');
      tr.appendChild(el('td', '', row.window));
      tr.appendChild(el('td', '', row.auto_finished_count ?? 0));
      tr.appendChild(el('td', '', row.aborted_count ?? 0));
      tr.appendChild(el('td', '', row.fault_terminated_count ?? 0));
      tr.appendChild(el('td', '', row.total_count ?? 0));
      tr.appendChild(el('td', '', formatWoundLength(row.total_wound_length ?? 0)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    coilSec.appendChild(table);
    drawerBody.appendChild(coilSec);

    // Recent Errors
    const errSec = el('div', 'drawer-section');
    errSec.appendChild(el('h3', '', 'Recent Errors (last 5)'));
    if (!details.recent_errors || details.recent_errors.length === 0) {
      errSec.appendChild(el('p', 'machine-meta', 'No recent error events recorded.'));
    } else {
      const ul = el('ul', 'drawer-list');
      for (const item of details.recent_errors) {
        const li = document.createElement('li');
        const head = el('div', 'history-item-top');
        head.appendChild(el('code', '', item.error_code || item.event_type));
        head.appendChild(el('span', 'last-seen', formatUtc(item.time)));
        li.appendChild(head);
        li.appendChild(el('p', 'history-body', item.glossary_title || item.summary));
        ul.appendChild(li);
      }
      errSec.appendChild(ul);
    }
    drawerBody.appendChild(errSec);

    // Recent Bug Reports
    const bugSec = el('div', 'drawer-section');
    bugSec.appendChild(el('h3', '', 'Recent Bug Reports'));
    if (!details.recent_bug_reports || details.recent_bug_reports.length === 0) {
      bugSec.appendChild(el('p', 'machine-meta', 'No bug reports submitted for this machine.'));
    } else {
      const ul = el('ul', 'drawer-list');
      for (const br of details.recent_bug_reports) {
        const li = document.createElement('li');
        const head = el('div', 'history-item-top');
        head.appendChild(el('strong', '', '#' + br.id + ' · ' + br.tag));
        head.appendChild(el('span', 'last-seen', formatUtc(br.created_at)));
        li.appendChild(head);
        if (br.worker_note) {
          li.appendChild(el('p', 'history-body', br.worker_note));
        }
        ul.appendChild(li);
      }
      bugSec.appendChild(ul);
    }
    drawerBody.appendChild(bugSec);
    document.dispatchEvent(new CustomEvent('fleet:drawer-rendered', { detail: { details, drawerBody } }));
  }

  function handleAuthFailure(res) {
    if (res.status === 401 || res.status === 403) {
      state.authPaused = true;
      const alertEl = document.getElementById('fleet-auth-alert');
      if (alertEl) alertEl.hidden = false;
      return true;
    }
    return false;
  }

  async function openMachineDrawer(machineId) {
    if (!drawer || !drawerTitle || !drawerBody) return;
    state.openMachineId = machineId;
    const toolLabel = deriveToolLabel(machineId);
    drawerTitle.textContent = 'Loading ' + toolLabel + ' (' + machineId + ')...';
    drawerBody.textContent = '';
    drawerBody.appendChild(el('p', 'machine-meta', 'Fetching live diagnostics...'));
    if (!drawer.open) {
      drawer.showModal();
    }
    try {
      const res = await fetch('/api/fleet/machines/' + encodeURIComponent(machineId) + '/details', {
        headers: { accept: 'application/json' },
      });
      if (handleAuthFailure(res)) return;
      if (!res.ok) {
        drawerBody.textContent = '';
        drawerBody.appendChild(el('p', '', 'Failed to load machine details (HTTP ' + res.status + ').'));
        return;
      }
      const details = await res.json();
      renderDrawerContent(details);
    } catch {
      drawerBody.textContent = '';
      drawerBody.appendChild(el('p', '', 'Network error while fetching machine details.'));
    }
  }

  document.addEventListener('fleet:refresh-drawer', () => {
    if (state.openMachineId && drawer && drawer.open) {
      void openMachineDrawer(state.openMachineId);
    }
  });

  document.addEventListener('fleet:open-machine', (event) => {
    const id = event.detail && event.detail.machineId;
    if (id) void openMachineDrawer(id);
  });

  document.addEventListener('fleet:set-poll-paused', (event) => {
    state.pollPaused = Boolean(event.detail && event.detail.paused);
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const nodeBtn = target.closest('.map-node[data-machine-id]');
    if (nodeBtn) {
      const id = nodeBtn.getAttribute('data-machine-id');
      if (id) void openMachineDrawer(id);
      return;
    }
    const histBtn = target.closest('[data-open-machine]');
    if (histBtn) {
      const id = histBtn.getAttribute('data-open-machine');
      if (id) void openMachineDrawer(id);
    }
  });

  // Room History filters + rendering
  const historyForm = document.getElementById('history-filter-form');
  const historyList = document.getElementById('fleet-history-list');

  function renderHistoryListSafe(items) {
    if (!historyList) return;
    historyList.textContent = '';
    if (!Array.isArray(items) || items.length === 0) {
      const li = el('li', 'card');
      li.appendChild(el('p', 'machine-meta', 'No room-wide fault events or bug reports match the selected filters.'));
      historyList.appendChild(li);
      return;
    }

    for (const item of items) {
      const li = el('li', 'card history-item');
      const top = el('div', 'history-item-top');
      const badges = el('div', 'history-badges');

      if (item.kind === 'error_event') {
        const b = el('span', 'status-badge status-error', '\\u25B2 ' + (item.error_code || item.event_type));
        badges.appendChild(b);
      } else {
        badges.appendChild(el('span', 'bug-tag-pill', 'Bug #' + item.bug_report_id + ': ' + item.tag));
        if (item.error_code) badges.appendChild(el('code', 'history-inline-code', item.error_code));
      }

      const toolLabel = deriveToolLabel(item.machine_id, item.floor_position);
      const secKey = resolveSection({ id: item.machine_id, floor_position: item.floor_position });
      const mBtn = el('button', 'history-machine-btn', toolLabel + ' · ' + item.machine_id + ' · ' + item.machine_display_name);
      mBtn.type = 'button';
      mBtn.setAttribute('data-open-machine', item.machine_id);
      badges.appendChild(mBtn);
      badges.appendChild(el('span', 'zone-pill', SECTION_TITLES[secKey] || secKey));
      if (item.hardware_id) badges.appendChild(el('span', 'zone-pill', item.hardware_id));
      top.appendChild(badges);

      const t = el('time', 'last-seen', formatUtc(item.time));
      t.setAttribute('datetime', item.time);
      top.appendChild(t);
      li.appendChild(top);

      if (item.kind === 'error_event') {
        const text = item.glossary_title
          ? item.glossary_title + (item.summary && item.summary !== item.glossary_title ? ' — ' + item.summary : '')
          : item.summary;
        li.appendChild(el('p', 'history-body', text));
      } else if (item.worker_note) {
        li.appendChild(el('p', 'history-body', item.worker_note));
      } else {
        li.appendChild(el('p', 'machine-meta', 'No worker note attached.'));
      }

      historyList.appendChild(li);
    }
    document.dispatchEvent(new CustomEvent('fleet:history-rendered'));
  }

  async function refreshHistory() {
    if (!historyForm || state.authPaused) return;
    const params = new URLSearchParams();
    const kind = historyForm.querySelector('#history-kind')?.value;
    const machineId = historyForm.querySelector('#history-machine')?.value?.trim();
    if (kind && kind !== 'all') params.set('kind', kind);
    if (machineId) params.set('machineId', machineId);

    const res = await fetch('/api/fleet/history?' + params.toString(), {
      headers: { accept: 'application/json' },
    });
    if (handleAuthFailure(res) || !res.ok) return;
    const data = await res.json();
    renderHistoryListSafe(data.items || []);
  }

  if (historyForm) {
    historyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void refreshHistory();
    });
    for (const sel of historyForm.querySelectorAll('select')) {
      sel.addEventListener('change', () => { void refreshHistory(); });
    }
    const resetBtn = document.getElementById('history-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        historyForm.reset();
        void refreshHistory();
      });
    }
  }

  // Master Glossary live search
  const glossaryForm = document.getElementById('fleet-glossary-form');
  const glossaryInput = document.getElementById('fleet-glossary-search');
  const glossaryList = document.getElementById('fleet-glossary-list');
  let glossaryTimer = null;

  function renderGlossarySafe(entries) {
    if (!glossaryList) return;
    glossaryList.textContent = '';
    if (!Array.isArray(entries) || entries.length === 0) {
      const li = el('li', 'card');
      li.appendChild(el('p', 'machine-meta', 'No fault glossary entries matched your search.'));
      glossaryList.appendChild(li);
      return;
    }
    for (const entry of entries) {
      const li = el('li', 'card glossary-card');
      const header = el('div', 'glossary-card-header');
      header.appendChild(el('h3', '', entry.title));
      header.appendChild(el('code', '', entry.error_code));
      li.appendChild(header);

      const sym = el('p', 'glossary-symptoms');
      const strong = el('strong', '', 'Symptoms: ');
      sym.appendChild(strong);
      sym.appendChild(document.createTextNode(entry.symptoms));
      li.appendChild(sym);
      li.appendChild(renderMarkdownSafe(entry.fix_steps_md));
      glossaryList.appendChild(li);
    }
  }

  async function refreshGlossary() {
    if (!glossaryInput) return;
    const q = glossaryInput.value.trim();
    const url = q ? '/api/glossary?q=' + encodeURIComponent(q) : '/api/glossary';
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    renderGlossarySafe(data.entries || []);
  }

  if (glossaryForm && glossaryInput) {
    glossaryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void refreshGlossary();
    });
    glossaryInput.addEventListener('input', () => {
      if (glossaryTimer) clearTimeout(glossaryTimer);
      glossaryTimer = setTimeout(() => { void refreshGlossary(); }, 200);
    });
  }

  // Live 10s polling + manual Refresh
  async function refreshAll(includeHistory) {
    if (state.authPaused) return;
    try {
      const [sumRes, machRes] = await Promise.all([
        fetch('/api/fleet/summary', { headers: { accept: 'application/json' } }),
        fetch('/api/fleet/machines', { headers: { accept: 'application/json' } }),
      ]);
      if (handleAuthFailure(sumRes) || handleAuthFailure(machRes)) return;
      if (sumRes.ok) {
        state.summary = await sumRes.json();
        renderSummaryStrip();
      }
      if (machRes.ok) {
        const payload = await machRes.json();
        state.machines = Array.isArray(payload.machines) ? payload.machines : [];
        updateMapNodes();
      }
      if (includeHistory || state.activeTab === 'history') {
        await refreshHistory();
      }
      document.dispatchEvent(new CustomEvent('fleet:refreshed'));
    } catch {
      // Transient LAN glitches will retry cleanly on the next 10s poll tick.
    }
  }

  document.getElementById('fleet-refresh-btn')?.addEventListener('click', () => { void refreshAll(true); });
  document.addEventListener('fleet:refresh-all', () => { void refreshAll(true); });
  setInterval(() => {
    if (!document.hidden && !state.authPaused && !state.pollPaused) void refreshAll(false);
  }, 10000);

  renderSummaryStrip();
  applyMapFilter();
})();
`;

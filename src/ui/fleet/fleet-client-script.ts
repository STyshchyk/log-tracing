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
  };

  try {
    const initial = JSON.parse(bootstrapEl.textContent || '{}');
    state.summary = initial.summary || null;
    state.machines = Array.isArray(initial.machines) ? initial.machines : [];
  } catch {
    return;
  }

  const STATE_SYMBOLS = {
    WORKING: '\\u25CF',
    IDLE: '\\u25D0',
    ERROR: '\\u25B2',
    OFFLINE: '\\u2715',
  };

  const STATE_CLASSES = {
    WORKING: 'status-working',
    IDLE: 'status-idle',
    ERROR: 'status-error',
    OFFLINE: 'status-offline',
  };

  const ZONE_TITLES = {
    NORTH_LEFT: 'Narrow Wing — West Wall (#1–#7)',
    NORTH_RIGHT: 'Narrow Wing — East Wall (#8–#12)',
    MAIN_BANK: 'Main Hall Rows (24 Units)',
    EAST_DOOR: 'Right Stack (8 Units)',
  };

  function deriveToolLabel(machineId) {
    const m = /^W-0*(\\d+)$/i.exec(String(machineId || ''));
    return m ? '#' + m[1] : String(machineId || '');
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
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  }

  function formatWoundLength(value) {
    const safe = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
    const normalized = Number.isFinite(safe) ? safe : 0;
    const rounded = Math.round(normalized * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function appendInlineCode(parent, text) {
    let cursor = 0;
    const str = String(text || '');
    while (cursor < str.length) {
      const open = str.indexOf('\`', cursor);
      if (open === -1) {
        parent.appendChild(document.createTextNode(str.slice(cursor)));
        break;
      }
      const close = str.indexOf('\`', open + 1);
      if (close === -1) {
        parent.appendChild(document.createTextNode(str.slice(cursor)));
        break;
      }
      if (open > cursor) {
        parent.appendChild(document.createTextNode(str.slice(cursor, open)));
      }
      parent.appendChild(el('code', '', str.slice(open + 1, close)));
      cursor = close + 1;
    }
  }

  function renderMarkdownSafe(markdown) {
    const container = el('div', 'fix-steps');
    const lines = String(markdown || '').replace(/\\r\\n?/g, '\\n').split('\\n');
    let listEl = null;
    let listTag = null;
    let paraLines = [];

    const flushPara = () => {
      if (paraLines.length > 0) {
        const p = el('p');
        appendInlineCode(p, paraLines.join(' '));
        container.appendChild(p);
        paraLines = [];
      }
    };
    const flushList = () => {
      if (listEl) {
        container.appendChild(listEl);
      }
      listEl = null;
      listTag = null;
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        flushPara();
        flushList();
        continue;
      }
      const ordered = /^\\s*\\d+\\.\\s+(.+)$/.exec(rawLine);
      if (ordered) {
        flushPara();
        if (listTag !== 'ol') {
          flushList();
          listTag = 'ol';
          listEl = document.createElement('ol');
        }
        const li = el('li');
        appendInlineCode(li, ordered[1].trim());
        listEl.appendChild(li);
        continue;
      }
      const bullet = /^\\s*[-*]\\s+(.+)$/.exec(rawLine);
      if (bullet) {
        flushPara();
        if (listTag !== 'ul') {
          flushList();
          listTag = 'ul';
          listEl = document.createElement('ul');
        }
        const li = el('li');
        appendInlineCode(li, bullet[1].trim());
        listEl.appendChild(li);
        continue;
      }
      flushList();
      paraLines.push(trimmed);
    }
    flushPara();
    flushList();
    return container;
  }

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
      const abortEl = document.getElementById('coil-aborted');
      const faultEl = document.getElementById('coil-fault-terminated');
      const woundEl = document.getElementById('coil-wound-length');
      const totCyclesEl = document.getElementById('coil-total-cycles');
      if (autoEl) autoEl.textContent = String(bucket.auto_finished_count ?? 0);
      if (abortEl) abortEl.textContent = String(bucket.aborted_count ?? 0);
      if (faultEl) faultEl.textContent = String(bucket.fault_terminated_count ?? 0);
      if (woundEl) woundEl.textContent = formatWoundLength(bucket.total_wound_length ?? 0);
      if (totCyclesEl) totCyclesEl.textContent = String(bucket.total_count ?? 0) + ' cycles';
    }
  }

  function applyMapFilter() {
    let visibleCount = 0;
    const totalCount = document.querySelectorAll('.map-node').length;
    const zoneVisible = { NORTH_LEFT: 0, NORTH_RIGHT: 0, MAIN_BANK: 0, EAST_DOOR: 0 };

    for (const node of document.querySelectorAll('.map-node')) {
      const matches = state.selectedFilterState === 'ALL' || node.dataset.state === state.selectedFilterState;
      node.hidden = !matches;
      if (matches) {
        visibleCount += 1;
        const z = node.dataset.zone;
        if (z && z in zoneVisible) zoneVisible[z] += 1;
      }
    }

    for (const zoneEl of document.querySelectorAll('.zone-bay')) {
      const z = zoneEl.dataset.zone;
      const count = z && z in zoneVisible ? zoneVisible[z] : 0;
      zoneEl.dataset.emptyFiltered = count === 0 ? 'true' : 'false';
      const badge = zoneEl.querySelector('[data-zone-count]');
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
      const toolLabel = node.getAttribute('data-tool-label') || deriveToolLabel(machine.id);
      node.dataset.state = machine.current_state;
      node.className = 'map-node mt-unit ' + (STATE_CLASSES[machine.current_state] || 'status-offline');
      node.setAttribute(
        'aria-label',
        toolLabel + ' (' + machine.id + ' ' + machine.display_name + '), ' + machine.current_state +
          (machine.active_error ? ', active error ' + machine.active_error : ''),
      );
      const iconEl = node.querySelector('.badge-icon');
      if (iconEl) iconEl.textContent = STATE_SYMBOLS[machine.current_state] || '?';
      const labelEl = node.querySelector('.node-state-label');
      if (labelEl) labelEl.textContent = machine.current_state;

      const deskEl = node.querySelector('.mt-desk') || node;
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
      const isOutside = (event) => {
        const rect = drawer.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };
      let pressedOutside = false;
      drawer.addEventListener('pointerdown', (e) => { pressedOutside = isOutside(e); });
      drawer.addEventListener('pointerup', (e) => {
        if (pressedOutside && isOutside(e)) drawer.close();
      });
    }
  }

  function renderDrawerContent(details) {
    if (!drawerBody || !drawerTitle) return;
    const m = details.machine;
    const toolLabel = deriveToolLabel(m.id);
    drawerTitle.textContent = toolLabel + ' (' + m.id + ') — ' + m.display_name;
    drawerBody.textContent = '';

    // Overview section
    const overview = el('div', 'drawer-section');
    const zoneName = ZONE_TITLES[m.zone] || m.zone;
    overview.appendChild(el('p', 'machine-meta', 'Floor Slot ' + toolLabel + ' · ' + zoneName + ' · Grid (' + m.grid_row + ', ' + m.grid_col + ')'));

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

      const toolLabel = deriveToolLabel(item.machine_id);
      const mBtn = el('button', 'history-machine-btn', toolLabel + ' · ' + item.machine_id + ' · ' + item.machine_display_name);
      mBtn.type = 'button';
      mBtn.setAttribute('data-open-machine', item.machine_id);
      badges.appendChild(mBtn);
      badges.appendChild(el('span', 'zone-pill', ZONE_TITLES[item.zone] || item.zone));
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
  }

  async function refreshHistory() {
    if (!historyForm || state.authPaused) return;
    const params = new URLSearchParams();
    const kind = historyForm.querySelector('#history-kind')?.value;
    const zone = historyForm.querySelector('#history-zone')?.value;
    const machineId = historyForm.querySelector('#history-machine')?.value?.trim();
    if (kind && kind !== 'all') params.set('kind', kind);
    if (zone) params.set('zone', zone);
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
    } catch {
      // Transient LAN glitches will retry cleanly on the next 10s poll tick.
    }
  }

  const refreshBtn = document.getElementById('fleet-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => { void refreshAll(true); });
  }

  setInterval(() => {
    if (!document.hidden && !state.authPaused) {
      void refreshAll(false);
    }
  }, 10000);

  renderSummaryStrip();
  applyMapFilter();
})();
`;

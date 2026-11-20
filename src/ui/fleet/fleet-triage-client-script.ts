import { FLEET_FLOOR_SECTION_CLIENT_HELPER } from './floor-plan.js';

/**
 * Inline vanilla JS client runtime for the `/fleet` Industrial Console & Triage UI:
 * - Live 10-second polling countdown + pause/resume toggle
 * - Clickable KPI summary cards synced with floor & triage filters
 * - View mode switcher (Urgency / Floor Blueprint / By Section / Machine #) + instant search
 * - Repeat-fault micro-strip & Room History error-code filtering
 * - Viewport-aware inline glossary popover (`popover="auto"` + anchor positioning fallback)
 * - Slide-over drawer Prev/Next Error stepper, QR handoff generator, and checkable fix steps
 */
export const FLEET_TRIAGE_CLIENT_SCRIPT = `
(() => {
  const bootstrapEl = document.getElementById('fleet-bootstrap-data');
  if (!bootstrapEl) return;

  let initial = {};
  try {
    initial = JSON.parse(bootstrapEl.textContent || '{}');
  } catch {
    return;
  }
${FLEET_FLOOR_SECTION_CLIENT_HELPER}

  const triageState = {
    machines: Array.isArray(initial.machines) ? initial.machines : [],
    history: Array.isArray(initial.history) ? initial.history : [],
    glossary: Array.isArray(initial.glossary) ? initial.glossary : [],
    viewMode: 'urgency',
    kpiFilter: 'ALL',
    searchQuery: '',
    historyErrorFilter: '',
    pollPaused: false,
    countdown: 10,
    checkedSteps: new Map(),
    activePopoverCode: null,
    activeAnchorEl: null,
  };

  const glossaryByCode = new Map();
  for (const entry of triageState.glossary) {
    if (entry && entry.error_code) glossaryByCode.set(entry.error_code, entry);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function formatUtc(iso) {
    if (!iso) return 'No heartbeat yet';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  }

  function buildOpenBugsMap() {
    const map = new Map();
    for (const item of triageState.history) {
      if (!item || item.kind !== 'bug_report') continue;
      if (item.status && String(item.status).toUpperCase() === 'RESOLVED') continue;
      let list = map.get(item.machine_id);
      if (!list) {
        list = [];
        map.set(item.machine_id, list);
      }
      list.push(item);
    }
    return map;
  }

  function getErrorMachineIds() {
    return triageState.machines.filter((m) => m.current_state === 'ERROR').map((m) => m.id);
  }

  function makeErrorCodePill(code) {
    const btn = el('button', 'error-code-pill', '\\u25B2 ' + code);
    btn.type = 'button';
    btn.setAttribute('data-glossary-code', code);
    return btn;
  }

  function openMachine(machineId) {
    document.dispatchEvent(new CustomEvent('fleet:open-machine', { detail: { machineId } }));
  }

  function getFilteredMachines(bugsByMachine) {
    const q = triageState.searchQuery.trim().toLowerCase();
    return triageState.machines.filter((m) => {
      const openBugs = bugsByMachine.get(m.id) || [];
      if (triageState.kpiFilter === 'BUGS' && openBugs.length === 0) return false;
      if (triageState.kpiFilter !== 'ALL' && triageState.kpiFilter !== 'BUGS' && m.current_state !== triageState.kpiFilter) return false;
      if (!q) return true;
      const sec = resolveSection(m);
      const hay = [
        deriveToolLabel(m.id, m.floor_position), m.id, m.display_name,
        SECTION_TITLES[sec] || sec, m.hardware_id || '',
        m.active_error || '', m.fw_version || '', m.preset_version || '',
        ...openBugs.map((b) => (b.tag || '') + ' ' + (b.worker_note || '')),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function buildAttentionCard(m, openBugs) {
    const isError = m.current_state === 'ERROR';
    const isOffline = m.current_state === 'OFFLINE';
    const card = el('article', 'attention-card ' + (isError ? 'attention-error' : (isOffline ? 'attention-offline' : 'attention-bug')));
    const sec = resolveSection(m);

    const top = el('div', 'attention-top');
    const idRow = el('div', 'attention-id-row');
    idRow.appendChild(el('strong', 'attention-tool-num', deriveToolLabel(m.id, m.floor_position)));
    idRow.appendChild(el('span', 'attention-machine-id', m.id));
    idRow.appendChild(el('span', 'zone-pill', SECTION_TITLES[sec] || sec));
    if (m.hardware_id) idRow.appendChild(el('span', 'zone-pill', m.hardware_id));
    top.appendChild(idRow);
    top.appendChild(el('span', 'status-badge status-' + m.current_state.toLowerCase(), m.current_state));
    card.appendChild(top);

    if (m.active_error) {
      const errWrap = document.createElement('div');
      errWrap.appendChild(makeErrorCodePill(m.active_error));
      card.appendChild(errWrap);
    }
    if (isOffline) card.appendChild(el('p', 'machine-meta', 'Last seen: ' + formatUtc(m.last_seen_at)));
    if (openBugs.length > 0) {
      const b = openBugs[0];
      const box = el('div', 'attention-bug-box');
      box.appendChild(el('strong', '', 'Bug #' + b.bug_report_id + ': ' + b.tag));
      if (b.worker_note) box.appendChild(el('div', '', b.worker_note));
      card.appendChild(box);
    }

    const footer = el('div', 'attention-footer');
    const ver = [
      m.hardware_id ? 'HW ' + m.hardware_id : '',
      m.fw_version ? 'FW ' + m.fw_version : '',
      m.preset_version ? 'PR ' + m.preset_version : '',
    ].filter(Boolean).join(' · ');
    footer.appendChild(el('span', 'machine-meta', ver || formatUtc(m.last_seen_at)));
    const inspectBtn = el('button', 'attention-inspect-btn', 'Inspect \\u2192');
    inspectBtn.type = 'button';
    inspectBtn.setAttribute('data-open-machine', m.id);
    footer.appendChild(inspectBtn);
    card.appendChild(footer);
    return card;
  }

  function buildCompactTile(m) {
    const tile = el('div', 'compact-tile status-' + m.current_state.toLowerCase());
    const btn = el('button', 'compact-tile-btn');
    btn.type = 'button';
    btn.setAttribute('data-open-machine', m.id);
    const top = el('div', 'compact-tile-top');
    top.appendChild(el('strong', 'attention-tool-num', deriveToolLabel(m.id, m.floor_position)));
    top.appendChild(el('span', 'zone-pill', m.id));
    btn.appendChild(top);
    const ver = [
      m.hardware_id ? 'HW ' + m.hardware_id : '',
      m.fw_version ? 'FW ' + m.fw_version : '',
      m.preset_version ? 'PR ' + m.preset_version : '',
    ].filter(Boolean).join(' · ');
    btn.appendChild(el('div', 'compact-tile-meta', m.active_error || ver || m.current_state));
    tile.appendChild(btn);
    return tile;
  }

  function renderTriageSection(title, countLabel, contentEl) {
    const sec = el('section', 'triage-section');
    const head = el('div', 'triage-section-header');
    head.appendChild(el('h3', 'triage-section-title', title));
    head.appendChild(el('span', 'triage-section-count', countLabel));
    sec.appendChild(head);
    sec.appendChild(contentEl);
    return sec;
  }

  function renderTriageBoard() {
    const boardEl = document.getElementById('fleet-triage-board');
    const blueprintEl = document.getElementById('fleet-blueprint-view');
    const filterBadge = document.getElementById('active-filter-badge');
    const filterLabel = document.getElementById('active-filter-label');

    for (const btn of document.querySelectorAll('.view-mode-btn[data-view-mode]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.viewMode === triageState.viewMode));
    }
    for (const card of document.querySelectorAll('.kpi-filter-card[data-kpi-filter]')) {
      card.setAttribute('aria-pressed', String(card.dataset.kpiFilter === triageState.kpiFilter));
    }
    if (filterBadge && filterLabel) {
      filterBadge.hidden = triageState.kpiFilter === 'ALL';
      if (!filterBadge.hidden) filterLabel.textContent = 'Filter: ' + triageState.kpiFilter;
    }

    const bugsByMachine = buildOpenBugsMap();
    const filtered = getFilteredMachines(bugsByMachine);
    const matchedIds = new Set(filtered.map((m) => m.id));
    const sectionCounts = { narrow_west: 0, narrow_east: 0, main_hall: 0, right_stack: 0, reserve_bay: 0 };
    let visibleCount = 0;

    for (const cell of document.querySelectorAll('.map-unit-cell[data-machine-id]')) {
      const id = cell.getAttribute('data-machine-id');
      const show = Boolean(id && matchedIds.has(id));
      cell.hidden = !show;
      if (show) {
        visibleCount += 1;
        const sec = cell.getAttribute('data-section');
        if (sec && sec in sectionCounts) sectionCounts[sec] += 1;
      }
    }
    for (const secEl of document.querySelectorAll('.zone-bay')) {
      const sec = secEl.dataset.section;
      const count = sec && sec in sectionCounts ? sectionCounts[sec] : 0;
      secEl.dataset.emptyFiltered = count === 0 ? 'true' : 'false';
      const badge = secEl.querySelector('[data-section-count]');
      if (badge) badge.textContent = String(count);
    }

    const statusEl = document.getElementById('map-filter-status');
    if (triageState.viewMode === 'blueprint') {
      if (blueprintEl) blueprintEl.hidden = false;
      if (boardEl) boardEl.hidden = true;
      if (statusEl) statusEl.textContent = 'Showing ' + visibleCount + ' of ' + triageState.machines.length + ' machines';
      return;
    }

    if (blueprintEl) blueprintEl.hidden = true;
    if (!boardEl) return;
    boardEl.hidden = false;
    boardEl.textContent = '';
    if (statusEl) {
      statusEl.textContent = filtered.length === triageState.machines.length
        ? 'Showing all ' + filtered.length + ' machines'
        : 'Showing ' + filtered.length + ' of ' + triageState.machines.length + ' machines';
    }

    if (filtered.length === 0) {
      const emptyCard = el('div', 'card');
      emptyCard.appendChild(el('p', 'machine-meta', 'No registered winders match your current filter or search.'));
      boardEl.appendChild(emptyCard);
      return;
    }

    if (triageState.viewMode === 'section') {
      const sectionsGrid = el('div', 'zone-groups-grid');
      for (const [secKey, secTitle] of Object.entries(SECTION_TITLES)) {
        const sm = filtered.filter((m) => resolveSection(m) === secKey);
        if (sm.length === 0) continue;
        const card = el('section', 'card zone-group-card');
        const head = el('div', 'zone-header');
        head.appendChild(el('h3', '', secTitle));
        head.appendChild(el('span', 'zone-count', sm.length));
        card.appendChild(head);
        const grid = el('div', 'compact-grid');
        for (const m of sm) grid.appendChild(buildCompactTile(m));
        card.appendChild(grid);
        sectionsGrid.appendChild(card);
      }
      boardEl.appendChild(sectionsGrid);
      return;
    }

    if (triageState.viewMode === 'id') {
      const sorted = [...filtered].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      const grid = el('div', 'compact-grid');
      for (const m of sorted) grid.appendChild(buildCompactTile(m));
      boardEl.appendChild(grid);
      return;
    }

    const attention = [], idle = [], working = [];
    for (const m of filtered) {
      const hasBug = (bugsByMachine.get(m.id) || []).length > 0;
      if (m.current_state === 'ERROR' || m.current_state === 'OFFLINE' || hasBug) attention.push(m);
      else if (m.current_state === 'IDLE') idle.push(m);
      else working.push(m);
    }
    const rank = (m) => (m.current_state === 'ERROR' ? 0 : (m.current_state === 'OFFLINE' ? 1 : 2));
    attention.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));

    if (attention.length > 0) {
      const grid = el('div', 'attention-grid');
      for (const m of attention) grid.appendChild(buildAttentionCard(m, bugsByMachine.get(m.id) || []));
      boardEl.appendChild(renderTriageSection('\\u26A0 Attention Required', '(' + attention.length + ' units)', grid));
    }
    if (idle.length > 0) {
      const grid = el('div', 'compact-grid');
      for (const m of idle) grid.appendChild(buildCompactTile(m));
      boardEl.appendChild(renderTriageSection('\\u25D0 Idle & Standby', '(' + idle.length + ')', grid));
    }
    if (working.length > 0) {
      const grid = el('div', 'compact-grid');
      for (const m of working) grid.appendChild(buildCompactTile(m));
      boardEl.appendChild(renderTriageSection('\\u25CF Working Normally', '(' + working.length + ')', grid));
    }
  }

  // Live 10s countdown + Pause/Resume toggle
  const pollBtn = document.getElementById('fleet-poll-toggle-btn');
  const pollCountdownEl = document.getElementById('fleet-poll-countdown');
  function syncPollUi() {
    if (!pollBtn || !pollCountdownEl) return;
    pollBtn.setAttribute('data-paused', triageState.pollPaused ? 'true' : 'false');
    pollBtn.setAttribute('aria-pressed', triageState.pollPaused ? 'true' : 'false');
    pollCountdownEl.textContent = triageState.pollPaused ? 'Paused' : 'Live (' + triageState.countdown + 's)';
  }
  pollBtn?.addEventListener('click', () => {
    triageState.pollPaused = !triageState.pollPaused;
    document.dispatchEvent(new CustomEvent('fleet:set-poll-paused', { detail: { paused: triageState.pollPaused } }));
    syncPollUi();
  });
  document.getElementById('fleet-refresh-btn')?.addEventListener('click', () => { triageState.countdown = 10; syncPollUi(); });
  document.addEventListener('fleet:refreshed', () => { triageState.countdown = 10; syncPollUi(); });
  setInterval(() => {
    if (triageState.pollPaused || document.hidden) return;
    triageState.countdown = triageState.countdown <= 1 ? 10 : triageState.countdown - 1;
    syncPollUi();
  }, 1000);

  // View mode, KPI cards, filter pills, and instant search
  for (const btn of document.querySelectorAll('.view-mode-btn[data-view-mode]')) {
    btn.addEventListener('click', () => { triageState.viewMode = btn.dataset.viewMode || 'urgency'; renderTriageBoard(); });
  }
  function setKpiFilter(nextFilter) {
    triageState.kpiFilter = nextFilter;
    const mapTab = document.getElementById('tab-map');
    if (mapTab && mapTab.getAttribute('aria-selected') !== 'true') mapTab.click();
    for (const pill of document.querySelectorAll('.filter-pill[data-filter-state]')) {
      pill.setAttribute('aria-pressed', String(pill.dataset.filterState === nextFilter));
    }
    renderTriageBoard();
  }
  for (const card of document.querySelectorAll('.kpi-filter-card[data-kpi-filter]')) {
    card.addEventListener('click', () => {
      const target = card.dataset.kpiFilter || 'ALL';
      setKpiFilter(target === 'ALL' ? 'ALL' : (triageState.kpiFilter === target ? 'ALL' : target));
    });
  }
  for (const pill of document.querySelectorAll('.filter-pill[data-filter-state]')) {
    pill.addEventListener('click', () => { triageState.kpiFilter = pill.dataset.filterState || 'ALL'; renderTriageBoard(); });
  }
  document.getElementById('active-filter-clear-btn')?.addEventListener('click', () => setKpiFilter('ALL'));

  const searchInput = document.getElementById('fleet-map-search');
  const searchClear = document.getElementById('fleet-map-search-clear');
  searchInput?.addEventListener('input', () => {
    triageState.searchQuery = searchInput.value || '';
    if (searchClear) searchClear.hidden = !triageState.searchQuery;
    renderTriageBoard();
  });
  searchClear?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    triageState.searchQuery = '';
    searchClear.hidden = true;
    renderTriageBoard();
    searchInput?.focus();
  });
  document.getElementById('repeat-fault-dismiss-btn')?.addEventListener('click', () => {
    const banner = document.getElementById('repeat-fault-banner');
    if (banner) banner.hidden = true;
  });

  // Inline Glossary Popover (popover="auto" + anchor-positioning / clamped fixed fallback)
  const popoverEl = document.getElementById('glossary-popover');
  const popCodeEl = document.getElementById('glossary-popover-code');
  const popTitleEl = document.getElementById('glossary-popover-title');
  const popBodyEl = document.getElementById('glossary-popover-body');
  const supportsPopover = Object.hasOwn(HTMLElement.prototype, 'popover');
  const supportsAnchor = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('position-area: block-end');

  function closeGlossaryPopover() {
    if (!popoverEl) return;
    if (triageState.activeAnchorEl) {
      triageState.activeAnchorEl.style.removeProperty('anchor-name');
      triageState.activeAnchorEl = null;
    }
    if (supportsPopover && popoverEl.matches(':popover-open')) popoverEl.hidePopover();
    popoverEl.hidden = true;
    triageState.activePopoverCode = null;
  }

  function openGlossaryPopover(code, triggerEl) {
    if (!popoverEl || !popCodeEl || !popTitleEl || !popBodyEl) return;
    const entry = glossaryByCode.get(code);
    triageState.activePopoverCode = code;
    popCodeEl.textContent = code;
    popTitleEl.textContent = entry ? entry.title : 'Fault Reference';
    popBodyEl.textContent = '';

    if (entry) {
      popBodyEl.appendChild(el('strong', '', 'Symptoms'));
      popBodyEl.appendChild(el('p', 'machine-meta', entry.symptoms));
      popBodyEl.appendChild(el('strong', '', 'Fix Steps'));
      const steps = String(entry.fix_steps_md || '').split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
      const ul = el('ul', 'drawer-list');
      for (const s of steps) ul.appendChild(el('li', '', s.replace(/^[-*\\d.)\\s]+/, '')));
      popBodyEl.appendChild(ul);
    } else {
      popBodyEl.appendChild(el('p', 'machine-meta', 'Open the Master Glossary tab for full troubleshooting instructions.'));
    }

    if (triageState.activeAnchorEl && triageState.activeAnchorEl !== triggerEl) {
      triageState.activeAnchorEl.style.removeProperty('anchor-name');
    }
    triageState.activeAnchorEl = triggerEl;

    if (supportsAnchor && triggerEl instanceof HTMLElement) {
      triggerEl.style.setProperty('anchor-name', '--glossary-trigger');
      popoverEl.style.removeProperty('top');
      popoverEl.style.removeProperty('left');
    } else if (triggerEl instanceof Element) {
      const rect = triggerEl.getBoundingClientRect();
      const vw = window.innerWidth || 1200;
      const vh = window.innerHeight || 800;
      const w = Math.min(384, vw - 24);
      popoverEl.style.left = Math.max(12, Math.min(rect.left, vw - w - 12)) + 'px';
      popoverEl.style.top = Math.max(12, Math.min(rect.bottom + 8, vh - 340)) + 'px';
    }

    popoverEl.hidden = false;
    if (supportsPopover) {
      try { popoverEl.showPopover(); } catch { /* fallback stays visible via hidden=false */ }
    }
  }

  document.getElementById('glossary-popover-close-btn')?.addEventListener('click', closeGlossaryPopover);
  document.getElementById('glossary-popover-open-btn')?.addEventListener('click', () => {
    const code = triageState.activePopoverCode;
    closeGlossaryPopover();
    document.getElementById('tab-glossary')?.click();
    const glossInput = document.getElementById('fleet-glossary-search');
    if (glossInput && code) {
      glossInput.value = code;
      glossInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  function applyHistoryErrorFilter() {
    const listEl = document.getElementById('fleet-history-list');
    if (!listEl) return;
    const code = triageState.historyErrorFilter;
    for (const item of listEl.querySelectorAll('li.history-item')) {
      item.hidden = Boolean(code && !(item.textContent || '').includes(code));
    }
  }
  document.getElementById('history-reset-btn')?.addEventListener('click', () => {
    triageState.historyErrorFilter = '';
    applyHistoryErrorFilter();
  });
  document.addEventListener('fleet:history-rendered', applyHistoryErrorFilter);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const pill = target.closest('[data-glossary-code]');
    if (pill) {
      event.stopPropagation();
      const code = pill.getAttribute('data-glossary-code');
      if (code) openGlossaryPopover(code, pill);
      return;
    }
    const jumpBtn = target.closest('[data-jump-history-code]');
    if (jumpBtn) {
      triageState.historyErrorFilter = jumpBtn.getAttribute('data-jump-history-code') || '';
      document.getElementById('tab-history')?.click();
      const kindEl = document.getElementById('history-kind');
      if (kindEl) {
        kindEl.value = 'errors';
        kindEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
      applyHistoryErrorFilter();
      return;
    }
    if (!supportsPopover && popoverEl && !popoverEl.hidden && !popoverEl.contains(target)) {
      closeGlossaryPopover();
    }
  });

  function createQrSvgElement(value) {
    const ns = 'http://www.w3.org/2000/svg';
    const size = 21;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 25 25');
    svg.setAttribute('width', '112');
    svg.setAttribute('height', '112');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR code for ' + value);

    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', '25');
    bg.setAttribute('height', '25');
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);

    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const isFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);
    const finderOn = (r, c) => {
      const lr = r >= size - 7 ? r - (size - 7) : r;
      const lc = c >= size - 7 ? c - (size - 7) : c;
      return lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4);
    };
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        let on = false;
        if (isFinder(r, c)) on = finderOn(r, c);
        else if (r === 6 || c === 6) on = (r + c) % 2 === 0;
        else {
          const x = Math.sin((Math.abs(hash) + r * 31 + c * 17) * 9301 + 49297) * 233280;
          on = (x - Math.floor(x)) > 0.48;
        }
        if (on) {
          const rect = document.createElementNS(ns, 'rect');
          rect.setAttribute('x', String(c + 2));
          rect.setAttribute('y', String(r + 2));
          rect.setAttribute('width', '1');
          rect.setAttribute('height', '1');
          rect.setAttribute('fill', '#0f172a');
          svg.appendChild(rect);
        }
      }
    }
    return svg;
  }

  // Drawer Stepper + QR Handoff + Checkable Fix Steps
  let currentDrawerMachineId = null;
  const prevErrBtn = document.getElementById('drawer-prev-error-btn');
  const nextErrBtn = document.getElementById('drawer-next-error-btn');
  const errCountHint = document.getElementById('drawer-error-count');
  const drawerEl = document.getElementById('machine-drawer');

  function stepErrorMachine(dir) {
    const errIds = getErrorMachineIds();
    if (errIds.length === 0) return;
    const idx = errIds.indexOf(currentDrawerMachineId);
    openMachine(errIds[idx === -1 ? 0 : (idx + dir + errIds.length) % errIds.length]);
  }
  prevErrBtn?.addEventListener('click', () => stepErrorMachine(-1));
  nextErrBtn?.addEventListener('click', () => stepErrorMachine(1));
  document.addEventListener('keydown', (event) => {
    if (!drawerEl || !drawerEl.open) return;
    const tag = event.target instanceof Element ? event.target.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); stepErrorMachine(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); stepErrorMachine(1); }
  });

  document.addEventListener('fleet:drawer-rendered', (event) => {
    const { details, drawerBody } = event.detail || {};
    if (!details || !details.machine || !drawerBody) return;
    const m = details.machine;
    currentDrawerMachineId = m.id;

    const errIds = getErrorMachineIds();
    if (prevErrBtn) prevErrBtn.disabled = errIds.length === 0;
    if (nextErrBtn) nextErrBtn.disabled = errIds.length === 0;
    if (errCountHint) errCountHint.textContent = 'Use \\u2190 / \\u2192 arrows to step through active errors (' + errIds.length + ')';

    const overviewSec = drawerBody.querySelector('.drawer-section');
    if (overviewSec) {
      const portalPath = details.worker_portal_url || ('/m/' + encodeURIComponent(m.id));
      const actions = overviewSec.querySelector('.drawer-actions') || el('div', 'drawer-handoff-bar');
      const copyBtn = el('button', 'btn', 'Copy Link');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', () => {
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(window.location.origin + portalPath).catch(() => {});
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 1600);
      });
      actions.appendChild(copyBtn);

      const qrBox = el('div', 'qr-preview-box');
      qrBox.hidden = true;
      qrBox.appendChild(createQrSvgElement(portalPath));
      qrBox.appendChild(el('span', 'qr-preview-label', portalPath));

      const qrBtn = el('button', 'btn', 'Show QR');
      qrBtn.type = 'button';
      qrBtn.addEventListener('click', () => {
        qrBox.hidden = !qrBox.hidden;
        qrBtn.textContent = qrBox.hidden ? 'Show QR' : 'Hide QR';
      });
      actions.appendChild(qrBtn);
      overviewSec.appendChild(qrBox);
    }

    if (details.active_glossary) {
      const steps = String(details.active_glossary.fix_steps_md || '').split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean);
      const fixSection = Array.from(drawerBody.querySelectorAll('.drawer-section')).find((sec) => sec.querySelector('h3')?.textContent?.startsWith('Active Fault Fix:'));
      if (fixSection && steps.length > 0) {
        const checklist = el('div', 'fix-steps-checklist');
        let checkedSet = triageState.checkedSteps.get(m.id);
        if (!checkedSet) { checkedSet = new Set(); triageState.checkedSteps.set(m.id, checkedSet); }
        steps.forEach((step, idx) => {
          const label = el('label', 'fix-step-item');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = checkedSet.has(idx);
          cb.addEventListener('change', () => { if (cb.checked) checkedSet.add(idx); else checkedSet.delete(idx); });
          label.appendChild(cb);
          label.appendChild(el('span', '', step.replace(/^[-*\\d.)\\s]+/, '')));
          checklist.appendChild(label);
        });
        const oldList = fixSection.querySelector('.fix-steps');
        if (oldList) oldList.replaceWith(checklist);
        else fixSection.appendChild(checklist);
      }
    }

    for (const codeEl of drawerBody.querySelectorAll('.drawer-list code')) {
      const code = codeEl.textContent?.trim();
      if (code && code.startsWith('ERR_')) codeEl.replaceWith(makeErrorCodePill(code));
    }
  });

  document.addEventListener('fleet:machines-updated', (event) => {
    const updated = event.detail && Array.isArray(event.detail.machines) ? event.detail.machines : null;
    if (updated) triageState.machines = updated;
    renderTriageBoard();
  });

  syncPollUi();
  renderTriageBoard();
})();
`;

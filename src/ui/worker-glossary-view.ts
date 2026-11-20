import type { GlossaryEntry } from '../services/glossary.js';
import type { MachineRecord } from '../services/machines.js';
import { renderMarkdownToHtml } from './markdown.js';
import {
  escapeHtml,
  renderPortalLayout,
  renderStatusBadge,
} from './portal-layout.js';

const GLOSSARY_STYLES = `
@layer components {
  search,
  form {
    box-sizing: border-box;
  }

  .glossary-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .pinned-fault-card {
    border-color: var(--error-border);
    border-width: 3px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .pinned-fault-card h2 {
    margin: 0;
  }

  .pinned-fault-card h3 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    color: var(--text-muted);
  }

  .pinned-fault-card p {
    margin: 0;
  }

  .active-fault-badge {
    margin-block-end: 0;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .status-notice {
    border-style: dashed;
    background-color: var(--surface-subtle);
  }

  .status-notice p {
    margin: 0;
  }

  .unlisted-error-notice {
    border-color: var(--error-border);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .unlisted-error-notice p {
    margin: 0;
  }

  .search-card {
    display: block;
  }

  .search-label {
    display: block;
    font-weight: 700;
    margin-block-end: 0.45rem;
  }

  .search-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: stretch;
  }

  .search-input {
    flex: 1 1 12rem;
    min-inline-size: 0;
    font: inherit;
    font-size: max(1rem, 1em);
    padding: 0.6rem 0.75rem;
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    background-color: var(--surface);
    color: var(--text);
  }

  .search-submit {
    flex: 0 0 auto;
    font: inherit;
    font-size: max(1rem, 1em);
    font-weight: 700;
    padding: 0.6rem 1.1rem;
    border-radius: 0.5rem;
    border: 2px solid var(--accent-primary);
    background-color: var(--accent-primary);
    color: var(--accent-primary-text);
    cursor: pointer;
  }

  .search-submit:hover {
    background-color: var(--accent-primary-hover);
  }

  .clear-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-block-size: var(--target-min);
    min-inline-size: var(--target-min);
    padding: 0.6rem 1rem;
    border-radius: 0.5rem;
    border: 2px solid var(--border);
    background-color: var(--surface);
    color: var(--text);
    font-weight: 600;
    text-decoration: none;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .empty-state p {
    margin: 0;
  }

  .glossary-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .glossary-card {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .glossary-card-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .glossary-card-header h3 {
    margin: 0;
    font-size: 1.15rem;
  }

  .glossary-symptoms {
    margin: 0;
  }

  .fix-steps :is(p, ol, ul) {
    margin-block: 0.4rem;
  }

  .fix-steps :is(ol, ul) {
    padding-inline-start: 1.4rem;
  }

  .fix-steps li + li {
    margin-block-start: 0.35rem;
  }

  @media (forced-colors: active) {
    .pinned-fault-card,
    .unlisted-error-notice,
    .status-notice,
    .search-input,
    .search-submit,
    .clear-link {
      border-color: CanvasText;
    }
  }
}
`;

function renderPinnedFaultCard(entry: GlossaryEntry): string {
  return `
    <section class="card pinned-fault-card" data-pinned="true" aria-labelledby="pinned-fault-heading">
      <div class="error-code-badge active-fault-badge" role="status">
        <span><span class="badge-icon" aria-hidden="true">&#9650;</span> Active Error</span>
        <code>${escapeHtml(entry.error_code)}</code>
      </div>
      <h2 id="pinned-fault-heading">${escapeHtml(entry.title)}</h2>
      <div>
        <h3>Symptoms</h3>
        <p>${escapeHtml(entry.symptoms)}</p>
      </div>
      <div>
        <h3>Step-by-Step Fix</h3>
        <div class="fix-steps">${renderMarkdownToHtml(entry.fix_steps_md)}</div>
      </div>
    </section>
  `;
}

export function renderGlossaryEntryCard(entry: GlossaryEntry): string {
  return `
    <li class="card glossary-card">
      <div class="glossary-card-header">
        <h3>${escapeHtml(entry.title)}</h3>
        <code>${escapeHtml(entry.error_code)}</code>
      </div>
      <p class="glossary-symptoms"><strong>Symptoms:</strong> ${escapeHtml(entry.symptoms)}</p>
      <div class="fix-steps">${renderMarkdownToHtml(entry.fix_steps_md)}</div>
    </li>
  `;
}

function renderActiveStatusSection(
  machine: MachineRecord,
  activeError: string | null,
  pinnedEntry: GlossaryEntry | null,
  isActiveInGlossary: boolean,
): string {
  if (pinnedEntry) {
    return renderPinnedFaultCard(pinnedEntry);
  }

  const encodedId = encodeURIComponent(machine.id);
  if (activeError) {
    if (isActiveInGlossary) {
      return `
        <section class="card status-notice" role="status">
          <p>Active error <code>${escapeHtml(activeError)}</code> is hidden by your current search filter. <a href="/m/${encodedId}/glossary">Clear search</a> to view pinned fix steps.</p>
        </section>
      `;
    }

    return `
      <section class="card unlisted-error-notice" role="status">
        <div class="error-code-badge active-fault-badge">
          <span><span class="badge-icon" aria-hidden="true">&#9650;</span> Active Error</span>
          <code>${escapeHtml(activeError)}</code>
        </div>
        <p>This error code is not listed in the fault glossary yet. Check common faults below or <a href="/m/${encodedId}/report-bug">report a bug</a> with details.</p>
      </section>
    `;
  }

  return `
    <section class="card status-notice" aria-label="Active error status">
      <p>No active error reported for this machine right now. Browse common fault codes below.</p>
    </section>
  `;
}

function renderSearchSection(encodedId: string, query: string): string {
  const clearLinkHtml = query
    ? `<a class="clear-link" href="/m/${encodedId}/glossary">Clear</a>`
    : '';

  return `
    <search class="card search-card">
      <form class="glossary-search-form" method="GET" action="/m/${encodedId}/glossary">
        <label class="search-label" for="glossary-q">Search faults by keyword or error code</label>
        <div class="search-controls">
          <input
            class="search-input"
            type="search"
            id="glossary-q"
            name="q"
            value="${escapeHtml(query)}"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
            enterkeyhint="search"
            placeholder="e.g. tension, jam, or error code"
          >
          <button class="search-submit" type="submit">Search</button>
          ${clearLinkHtml}
        </div>
      </form>
    </search>
  `;
}

function renderResultsSection(
  encodedId: string,
  query: string,
  pinnedEntry: GlossaryEntry | null,
  remainingEntries: GlossaryEntry[],
): string {
  if (!pinnedEntry && remainingEntries.length === 0) {
    const emptyBodyHtml = query
      ? `<p>No glossary entries matched &quot;<code>${escapeHtml(query)}</code>&quot;.</p><a class="clear-link" href="/m/${encodedId}/glossary">Show all glossary entries</a>`
      : '<p>No glossary entries are available yet.</p>';

    return `
      <section aria-labelledby="glossary-list-heading">
        <h2 id="glossary-list-heading">${query ? 'Search Results (0)' : 'Fault Codes &amp; Fix Steps (0)'}</h2>
        <div class="card empty-state" role="status">
          ${emptyBodyHtml}
        </div>
      </section>
    `;
  }

  if (pinnedEntry && remainingEntries.length === 0) {
    return '';
  }

  const heading = pinnedEntry
    ? query
      ? `Other Matching Fault Codes (${remainingEntries.length})`
      : `Other Fault Codes (${remainingEntries.length})`
    : query
      ? `Matching Fault Codes (${remainingEntries.length})`
      : `Fault Codes &amp; Fix Steps (${remainingEntries.length})`;

  const listHtml = `<ul class="glossary-list" role="list">${remainingEntries.map(renderGlossaryEntryCard).join('')}</ul>`;

  return `
    <section aria-labelledby="glossary-list-heading">
      <h2 id="glossary-list-heading">${heading}</h2>
      ${listHtml}
    </section>
  `;
}

/**
 * Render the Worker Portal Glossary / FAQ HTML page with pinned active-fault guidance.
 */
export function renderGlossaryPage(
  machine: MachineRecord,
  activeError: string | null,
  entries: GlossaryEntry[],
  query: string,
  isActiveInGlossary: boolean,
): string {
  const encodedId = encodeURIComponent(machine.id);
  const pinnedEntry = entries.find((entry) => entry.is_active) ?? null;
  const remainingEntries = entries.filter((entry) => !entry.is_active);
  const activeSectionHtml = renderActiveStatusSection(
    machine,
    activeError,
    pinnedEntry,
    isActiveInGlossary,
  );
  const searchSectionHtml = renderSearchSection(encodedId, query);
  const resultsSectionHtml = renderResultsSection(encodedId, query, pinnedEntry, remainingEntries);

  const bodyHtml = `
    <section class="card">
      <div class="glossary-header-row">
        <h1>Glossary / FAQ</h1>
        ${renderStatusBadge(machine.current_state)}
      </div>
      <p class="machine-meta">${escapeHtml(machine.display_name)} &middot; ID: <code>${escapeHtml(machine.id)}</code></p>
    </section>

    ${activeSectionHtml}
    ${searchSectionHtml}
    ${resultsSectionHtml}
  `;

  return renderPortalLayout({
    title: `Glossary / FAQ — ${machine.display_name} | Winding Room Portal`,
    bodyHtml,
    backHref: `/m/${encodedId}`,
    backLabel: 'Back to Machine',
    extraStyles: GLOSSARY_STYLES,
  });
}

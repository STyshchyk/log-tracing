import type { RecentErrorSummary } from '../services/telemetry-events.js';
import { escapeHtml } from './portal-layout.js';

const MAX_RECENT_ERRORS = 5;

/**
 * Format an ISO timestamp string as compact `YYYY-MM-DD HH:MM:SS UTC` for shop-floor display.
 */
export function formatTimestampUtc(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function isFallbackEventSummary(item: RecentErrorSummary): boolean {
  const trimmedSummary = item.summary.trim();
  if (!trimmedSummary) {
    return true;
  }
  const normalizedEventType = item.event_type.trim().toLowerCase().replaceAll('_', ' ');
  return (
    trimmedSummary.toLowerCase() === normalizedEventType ||
    trimmedSummary === item.event_type
  );
}

function renderErrorItem(item: RecentErrorSummary): string {
  const badgeLabel = item.error_code ?? item.event_type;
  const timestampText = formatTimestampUtc(item.time);

  let detailsHtml: string;
  if (item.glossary_title) {
    const titleHtml = `<p class="recent-error-title">${escapeHtml(item.glossary_title)}</p>`;
    const showSummary =
      !isFallbackEventSummary(item) && item.summary.trim() !== item.glossary_title.trim();
    const summaryHtml = showSummary
      ? `<p class="machine-meta recent-error-summary">${escapeHtml(item.summary)}</p>`
      : '';
    detailsHtml = `${titleHtml}${summaryHtml}`;
  } else {
    const summaryText = item.summary.trim() || item.event_type;
    detailsHtml = `<p class="recent-error-summary">${escapeHtml(summaryText)}</p>`;
  }

  return `<li class="recent-error-item">
    <div class="machine-card-top">
      <span class="status-badge status-error"><span class="badge-icon" aria-hidden="true">&#9650;</span><code class="recent-error-code">${escapeHtml(badgeLabel)}</code></span>
      <time class="last-seen" datetime="${escapeHtml(item.time)}">${escapeHtml(timestampText)}</time>
    </div>
    ${detailsHtml}
  </li>`;
}

/**
 * Render the inline Recent Errors HTML section (up to 5 newest faults or a calm empty state).
 */
export function renderRecentErrorsSection(errors: readonly RecentErrorSummary[]): string {
  const visibleErrors = errors.slice(0, MAX_RECENT_ERRORS);
  const contentHtml =
    visibleErrors.length === 0
      ? '<p class="machine-meta empty-state-note">No recent errors recorded for this machine.</p>'
      : `<ul class="machine-list" role="list">${visibleErrors.map(renderErrorItem).join('')}</ul>`;

  return `<section class="card" id="recent-errors" aria-labelledby="recent-errors-heading">
  <h2 id="recent-errors-heading">Recent Errors</h2>
  ${contentHtml}
</section>`;
}

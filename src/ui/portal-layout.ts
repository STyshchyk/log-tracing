import type { MachineState } from '../spec/mqtt-contract.js';
import { PORTAL_STYLES } from './portal-styles.js';

/**
 * Options for rendering the shared zero-CDN, mobile-first Worker Portal HTML shell.
 */
export interface PortalLayoutOptions {
  title: string;
  bodyHtml: string;
  backHref?: string;
  backLabel?: string;
  extraStyles?: string;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape untrusted or dynamic strings before interpolating into HTML text or attributes.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

interface StatusBadgeMeta {
  symbol: string;
  label: string;
  cssClass: string;
}

const STATUS_BADGE_META: Record<MachineState, StatusBadgeMeta> = {
  WORKING: { symbol: '&#9679;', label: 'WORKING', cssClass: 'status-working' },
  IDLE: { symbol: '&#9680;', label: 'IDLE', cssClass: 'status-idle' },
  ERROR: { symbol: '&#9650;', label: 'ERROR', cssClass: 'status-error' },
  OFFLINE: { symbol: '&#10005;', label: 'OFFLINE', cssClass: 'status-offline' },
};

/**
 * Render an accessible machine operational state badge with non-color symbol, label, and CSS class.
 */
export function renderStatusBadge(state: MachineState): string {
  const meta = STATUS_BADGE_META[state];
  return `<span class="status-badge ${meta.cssClass}" data-state="${escapeHtml(state)}"><span class="badge-icon" aria-hidden="true">${meta.symbol}</span><span>${escapeHtml(meta.label)}</span></span>`;
}

/**
 * Render a prominent active fault error_code badge with non-color warning symbol.
 */
export function renderErrorCodeBadge(errorCode: string): string {
  return `<div class="error-code-badge" role="status"><span class="badge-icon" aria-hidden="true">&#9650;</span><span>Active error: <code>${escapeHtml(errorCode)}</code></span></div>`;
}

/**
 * Wrap page content inside the standardized, accessible, zero-CDN Worker Portal HTML5 document.
 */
export function renderPortalLayout(options: PortalLayoutOptions): string {
  const headerHtml = options.backHref
    ? `<header class="portal-header"><nav aria-label="Portal navigation"><a class="back-link" href="${escapeHtml(options.backHref)}"><span aria-hidden="true">&#8592;</span><span>${escapeHtml(options.backLabel ?? 'All Machines')}</span></a></nav></header>`
    : '';
  const styles = options.extraStyles
    ? `${PORTAL_STYLES}\n${options.extraStyles}`
    : PORTAL_STYLES;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(options.title)}</title>
  <style>${styles}</style>
</head>
<body>
  <div class="portal-shell">
    ${headerHtml}
    <main class="portal-main">
      ${options.bodyHtml}
    </main>
    <footer class="portal-footer">Local LAN Worker Portal &middot; Zero login required</footer>
  </div>
</body>
</html>`;
}

/**
 * Render a worker-friendly 404 HTML page when a scanned or entered machine ID does not exist.
 */
export function renderUnknownMachinePage(machineId: string): string {
  const trimmed = machineId.trim();
  const idDetailHtml = trimmed
    ? `<p>Requested machine ID: <code>${escapeHtml(trimmed)}</code></p>`
    : '<p>No machine ID was provided in the address.</p>';

  const bodyHtml = `
    <section class="card">
      <h1>Machine Not Found</h1>
      <p>This Help/Report QR code or link does not match a registered winding machine.</p>
      ${idDetailHtml}
      <p>Check the machine sticker or pick your machine from the winding room directory below.</p>
      <a class="recovery-link" href="/">View All Machines</a>
    </section>
  `;

  return renderPortalLayout({
    title: 'Machine Not Found | Winding Room Portal',
    bodyHtml,
  });
}

import { escapeHtml } from './portal-layout.js';

const ORDERED_LIST_RE = /^\s*\d+\.\s+(.+)$/;
const BULLET_LIST_RE = /^\s*[-*]\s+(.+)$/;

function renderInlineCodeAndText(text: string): string {
  const parts: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const openTick = text.indexOf('`', cursor);
    if (openTick === -1) {
      parts.push(escapeHtml(text.slice(cursor)));
      break;
    }

    const closeTick = text.indexOf('`', openTick + 1);
    if (closeTick === -1) {
      parts.push(escapeHtml(text.slice(cursor)));
      break;
    }

    if (openTick > cursor) {
      parts.push(escapeHtml(text.slice(cursor, openTick)));
    }
    const codeContent = text.slice(openTick + 1, closeTick);
    parts.push(`<code>${escapeHtml(codeContent)}</code>`);
    cursor = closeTick + 1;
  }

  return parts.join('');
}

/**
 * Convert plain-English fix-step Markdown (numbered lists, bulleted lists, inline `code`,
 * and paragraphs) into semantic HTML with all dynamic/raw text XSS-escaped.
 */
export function renderMarkdownToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  const blocks: string[] = [];
  let listType: 'ol' | 'ul' | null = null;
  let listItems: string[] = [];
  let paragraphLines: string[] = [];

  const flushList = (): void => {
    if (listType && listItems.length > 0) {
      blocks.push(`<${listType}>${listItems.join('')}</${listType}>`);
    }
    listType = null;
    listItems = [];
  };

  const flushParagraph = (): void => {
    if (paragraphLines.length > 0) {
      blocks.push(`<p>${renderInlineCodeAndText(paragraphLines.join(' '))}</p>`);
      paragraphLines = [];
    }
  };

  for (const line of normalized.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      flushParagraph();
      continue;
    }

    const orderedMatch = ORDERED_LIST_RE.exec(line);
    if (orderedMatch) {
      flushParagraph();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(`<li>${renderInlineCodeAndText(orderedMatch[1]!.trim())}</li>`);
      continue;
    }

    const bulletMatch = BULLET_LIST_RE.exec(line);
    if (bulletMatch) {
      flushParagraph();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(`<li>${renderInlineCodeAndText(bulletMatch[1]!.trim())}</li>`);
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushList();
  flushParagraph();

  return blocks.join('');
}

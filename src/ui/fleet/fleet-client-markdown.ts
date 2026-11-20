/**
 * Client-side DOM-safe Markdown renderer (`appendInlineCode` and `renderMarkdownSafe`)
 * shared inside the `/fleet` inline script bundle.
 */
export const FLEET_MARKDOWN_CLIENT_SCRIPT = `
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
`;

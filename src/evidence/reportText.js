'use strict';

// Reads the released report HTML that src/evidence/reports.js produced (the
// exact artifact the independent reviewer signed) back into structured blocks,
// for the chat summary and the PDF. It accepts only the markup render() emits;
// anything else fails closed rather than being guessed at, so a delivered copy
// can never silently drop or rewrite approved content.

const ALLOWED = new Set([
  'article',
  'section',
  'aside',
  'h1',
  'h2',
  'h3',
  'p',
  'strong',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

// render() escapes every '&', so any other entity or bare ampersand means the
// input did not come from it.
function unescape(value) {
  if (/&(?!(?:amp|lt|gt|quot|#39);)/.test(value) || value.includes('>'))
    throw new Error('RENDER_UNSUPPORTED_MARKUP');
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ENTITIES[entity]);
}

// Returns [{ type: 'h1'|'h2'|'h3', text } | { type: 'p', runs: [{ text, bold }] }
//          | { type: 'table', headers: [..], rows: [[..]] }]
function parse(html) {
  if (typeof html !== 'string' || !html) throw new Error('RENDER_UNSUPPORTED_MARKUP');
  const blocks = [];
  let block = null;
  let table = null;
  let row = null;
  let cell = null;
  let bold = false;
  const token = /<(\/?)([a-z0-9]+)>|([^<]+)|(<)/gi;
  let match;
  while ((match = token.exec(html))) {
    const [, closing, rawTag, text, stray] = match;
    if (stray) throw new Error('RENDER_UNSUPPORTED_MARKUP');
    if (text !== undefined) {
      const value = unescape(text);
      if (cell !== null) cell.text += value;
      else if (block?.type === 'p') block.runs.push({ text: value, bold });
      else if (block) block.text += value;
      else if (value.trim()) throw new Error('RENDER_UNSUPPORTED_MARKUP');
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (!ALLOWED.has(tag)) throw new Error('RENDER_UNSUPPORTED_MARKUP');
    if (['article', 'section', 'aside', 'thead', 'tbody'].includes(tag)) continue;
    if (tag === 'strong') {
      if (block?.type !== 'p' && cell === null) throw new Error('RENDER_UNSUPPORTED_MARKUP');
      bold = !closing;
      continue;
    }
    if (['h1', 'h2', 'h3', 'p'].includes(tag)) {
      if (closing) {
        if (block) blocks.push(block);
        block = null;
      } else block = tag === 'p' ? { type: 'p', runs: [] } : { type: tag, text: '' };
      continue;
    }
    if (tag === 'table') {
      if (closing) {
        blocks.push(table);
        table = null;
      } else table = { type: 'table', headers: [], rows: [] };
      continue;
    }
    if (!table) throw new Error('RENDER_UNSUPPORTED_MARKUP');
    if (tag === 'tr') {
      if (closing) {
        if (row.header) table.headers = row.cells;
        else table.rows.push(row.cells);
        row = null;
      } else row = { cells: [], header: false };
    } else if (closing) {
      row.cells.push(cell.text);
      cell = null;
    } else {
      row.header = tag === 'th';
      cell = { text: '' };
    }
  }
  if (block || table || row || cell) throw new Error('RENDER_UNSUPPORTED_MARKUP');
  return blocks;
}

// Plain text for WhatsApp, keeping every section in order. Headings use
// WhatsApp's *bold* marker; table rows become labelled lines.
function toChat(html) {
  return parse(html)
    .map(block => {
      if (block.type === 'h1') return `*${block.text.trim()}*`;
      if (block.type === 'h2' || block.type === 'h3') return `*${block.text.trim()}*`;
      if (block.type === 'p')
        return block.runs
          .map(r => r.text)
          .join('')
          .trim();
      return block.rows
        .map(
          (cells, i) =>
            `Row ${i + 1}\n` +
            cells.map((c, j) => `${block.headers[j] ?? `Column ${j + 1}`}: ${c}`).join('\n'),
        )
        .join('\n\n');
    })
    .join('\n\n');
}

module.exports = { parse, toChat };

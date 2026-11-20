'use strict';
// Minimal RFC 4180 CSV, so reviewers can work in any spreadsheet program
// without a new dependency.

function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function stringify(header, rows) {
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) lines.push(header.map(key => escapeCell(row[key])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function parse(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV_UNTERMINATED_QUOTE');
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter(cells => cells.some(value => value.trim() !== ''));
  if (!nonEmpty.length) return [];
  const [header, ...body] = nonEmpty;
  return body.map(cells => Object.fromEntries(header.map((key, index) => [key.trim(), (cells[index] ?? '').trim()])));
}

module.exports = { parse, stringify };

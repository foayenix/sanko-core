'use strict';

// Renders a released evidence report to PDF for delivery in WhatsApp.
//
// The input is the exact released artifact HTML (brief and technical dossier)
// that the independent reviewer signed, read back by reportText.parse. The PDF
// adds only a control block (reference, version, release, review and status)
// and page footers. Nothing is summarised, reordered or generated. Any
// character the font cannot draw, or any markup the parser does not expect,
// fails the render instead of being dropped, so an incomplete copy is never
// produced and nothing unreviewed is sent in its place.
//
// Fonts: set EVIDENCE_PDF_FONT (and optionally EVIDENCE_PDF_FONT_BOLD) to a
// TrueType file with the scripts your reports use, for example DejaVu Sans for
// Yorùbá, Hausa and Igbo diacritics. Without it the built-in Helvetica is used,
// which can only encode Windows-1252 characters. Output is deterministic for a
// given content, renderer version and font, and the renderer id names both.

const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { parse } = require('./reportText');

const RENDERER_VERSION = 'sanko-pdf-1';
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const FOOTER = 34;
const INK = '0.090 0.075 0.310';
const MUTED = '0.35 0.35 0.40';
// C0 controls other than tab and line breaks, and DEL, cannot be drawn.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

const fail = (code, detail) => {
  const error = new Error(code);
  error.detail = detail;
  throw error;
};

// ─── built-in Helvetica (WinAnsi) ─────────────────────────────────────────────

// Adobe's Helvetica advance widths for ASCII 32–126 (per 1000 em).
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const CP1252 = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

class StandardFont {
  constructor(bold) {
    this.bold = bold;
    this.id = 'helvetica';
  }
  byte(cp) {
    if (cp >= 0x20 && cp <= 0x7e) return cp;
    if (cp >= 0xa0 && cp <= 0xff) return cp;
    if (CP1252[cp]) return CP1252[cp];
    return fail(
      'RENDER_UNSUPPORTED_CHARACTER',
      `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
    );
  }
  advance(cp) {
    // Non-ASCII characters are given a deliberately wide advance.
    const regular = cp >= 0x20 && cp <= 0x7e ? HELVETICA[cp - 0x20] : 722;
    // Bold metrics are not tabulated; this bound is never narrower than
    // Helvetica-Bold, so wrapped lines cannot overflow the margin.
    return this.bold ? Math.max(regular * 1.1, regular + 56) : regular;
  }
  width(text, size) {
    let total = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      this.byte(cp);
      total += this.advance(cp);
    }
    return (total * size) / 1000;
  }
  encode(text) {
    let out = '(';
    for (const ch of text) {
      const b = this.byte(ch.codePointAt(0));
      if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
      else if (b < 0x80) out += String.fromCharCode(b);
      else out += `\\${b.toString(8).padStart(3, '0')}`;
    }
    return `${out})`;
  }
  write(pdf) {
    this.ref ??= pdf.add(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${this.bold ? 'Helvetica-Bold' : 'Helvetica'} ` +
        '/Encoding /WinAnsiEncoding >>',
    );
    return this.ref;
  }
}

// ─── embedded TrueType (Identity-H) ───────────────────────────────────────────

class TrueTypeFont {
  constructor(data, label) {
    this.data = data;
    this.id = crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
    this.name = String(label).replace(/[^A-Za-z0-9-]/g, '') || 'Embedded';
    const tables = {};
    const count = data.readUInt16BE(4);
    for (let i = 0; i < count; i++) {
      const o = 12 + i * 16;
      tables[data.toString('latin1', o, o + 4)] = data.readUInt32BE(o + 8);
    }
    for (const tag of ['head', 'hhea', 'hmtx', 'cmap', 'maxp'])
      if (tables[tag] === undefined) fail('RENDER_FONT_INVALID', tag);
    const head = tables.head;
    this.unitsPerEm = data.readUInt16BE(head + 18);
    this.bbox = [36, 38, 40, 42].map(o => data.readInt16BE(head + o));
    this.ascent = data.readInt16BE(tables.hhea + 4);
    this.descent = data.readInt16BE(tables.hhea + 6);
    const metrics = data.readUInt16BE(tables.hhea + 34);
    const glyphs = data.readUInt16BE(tables.maxp + 4);
    this.advances = new Uint16Array(glyphs);
    for (let g = 0; g < glyphs; g++)
      this.advances[g] = data.readUInt16BE(tables.hmtx + 4 * Math.min(g, metrics - 1));
    const os2 = tables['OS/2'];
    this.capHeight =
      os2 !== undefined && data.readUInt16BE(os2) >= 2 ? data.readInt16BE(os2 + 88) : this.ascent;
    this.lookup = this.cmap(tables.cmap);
    this.used = new Map();
    this.cache = new Map();
  }
  cmap(base) {
    const d = this.data;
    const subtables = [];
    for (let i = 0; i < d.readUInt16BE(base + 2); i++) {
      const o = base + 4 + i * 8;
      const platform = d.readUInt16BE(o);
      const encoding = d.readUInt16BE(o + 2);
      const sub = base + d.readUInt32BE(o + 4);
      const format = d.readUInt16BE(sub);
      const rank =
        platform === 3 && encoding === 10 && format === 12
          ? 0
          : platform === 0 && format === 12
            ? 1
            : platform === 3 && encoding === 1 && format === 4
              ? 2
              : platform === 0 && format === 4
                ? 3
                : null;
      if (rank !== null) subtables.push({ rank, sub, format });
    }
    subtables.sort((a, b) => a.rank - b.rank);
    const best = subtables[0] ?? fail('RENDER_FONT_INVALID', 'cmap');
    const sub = best.sub;
    if (best.format === 12) {
      const groups = d.readUInt32BE(sub + 12);
      return cp => {
        for (let k = 0; k < groups; k++) {
          const g = sub + 16 + 12 * k;
          const start = d.readUInt32BE(g);
          if (cp >= start && cp <= d.readUInt32BE(g + 4)) return d.readUInt32BE(g + 8) + cp - start;
        }
        return 0;
      };
    }
    const segX2 = d.readUInt16BE(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    return cp => {
      if (cp > 0xffff) return 0;
      for (let i = 0; i < segX2 / 2; i++) {
        if (cp > d.readUInt16BE(ends + 2 * i)) continue;
        const start = d.readUInt16BE(starts + 2 * i);
        if (cp < start) return 0;
        const delta = d.readUInt16BE(deltas + 2 * i);
        const offset = d.readUInt16BE(ranges + 2 * i);
        if (offset === 0) return (cp + delta) & 0xffff;
        const glyph = d.readUInt16BE(ranges + 2 * i + offset + 2 * (cp - start));
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
      return 0;
    };
  }
  glyph(cp) {
    if (!this.cache.has(cp)) this.cache.set(cp, this.lookup(cp));
    const g = this.cache.get(cp);
    if (!g)
      fail('RENDER_UNSUPPORTED_CHARACTER', `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    return g;
  }
  width(text, size) {
    let total = 0;
    for (const ch of text) total += this.advances[this.glyph(ch.codePointAt(0))];
    return (total * size) / this.unitsPerEm;
  }
  encode(text) {
    let hex = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      const g = this.glyph(cp);
      if (!this.used.has(g)) this.used.set(g, cp);
      hex += g.toString(16).padStart(4, '0');
    }
    return `<${hex}>`;
  }
  write(pdf) {
    if (this.ref) return this.ref;
    const scale = 1000 / this.unitsPerEm;
    const gids = [...this.used.keys()].sort((a, b) => a - b);
    const widths = gids.map(g => `${g} [${Math.round(this.advances[g] * scale)}]`).join(' ');
    const file = pdf.stream(`/Length1 ${this.data.length}`, this.data);
    const descriptor = pdf.add(
      `<< /Type /FontDescriptor /FontName /${this.name} /Flags 32 ` +
        `/FontBBox [${this.bbox.map(v => Math.round(v * scale)).join(' ')}] ` +
        `/ItalicAngle 0 /Ascent ${Math.round(this.ascent * scale)} ` +
        `/Descent ${Math.round(this.descent * scale)} ` +
        `/CapHeight ${Math.round(this.capHeight * scale)} /StemV 80 /FontFile2 ${file} 0 R >>`,
    );
    const cid = pdf.add(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${this.name} ` +
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
        `/FontDescriptor ${descriptor} 0 R /W [${widths}] /CIDToGIDMap /Identity >>`,
    );
    const toUnicode = pdf.stream(
      '',
      Buffer.from(unicodeMap(gids.map(g => [g, this.used.get(g)])), 'latin1'),
    );
    this.ref = pdf.add(
      `<< /Type /Font /Subtype /Type0 /BaseFont /${this.name} /Encoding /Identity-H ` +
        `/DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
    );
    return this.ref;
  }
}

// Lets readers copy, search and extract the text (and lets tests check it).
function unicodeMap(pairs) {
  const utf16 = cp =>
    cp > 0xffff
      ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)]
          .map(u => u.toString(16).padStart(4, '0'))
          .join('')
      : cp.toString(16).padStart(4, '0');
  let body = '';
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100);
    const entries = chunk.map(([g, cp]) => `<${g.toString(16).padStart(4, '0')}> <${utf16(cp)}>`);
    body += `${chunk.length} beginbfchar\n${entries.join('\n')}\nendbfchar\n`;
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    `${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`
  );
}

// ─── document assembly ────────────────────────────────────────────────────────

class Pdf {
  constructor() {
    this.objects = [];
  }
  add(body) {
    this.objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
    return this.objects.length;
  }
  reserve() {
    this.objects.push(null);
    return this.objects.length;
  }
  set(id, body) {
    this.objects[id - 1] = Buffer.from(body, 'latin1');
  }
  stream(dict, data) {
    const compressed = zlib.deflateSync(data, { level: 9 });
    return this.add(
      Buffer.concat([
        Buffer.from(
          `<< /Length ${compressed.length} /Filter /FlateDecode ${dict} >>\nstream\n`,
          'latin1',
        ),
        compressed,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }
  build(root, info) {
    const chunks = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let length = chunks[0].length;
    const offsets = [];
    this.objects.forEach((body, i) => {
      offsets.push(length);
      const chunk = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
        body,
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      chunks.push(chunk);
      length += chunk.length;
    });
    const xref =
      `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
      `trailer\n<< /Size ${this.objects.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\n` +
      `startxref\n${length}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}

function loadFonts(env = process.env) {
  if (!env.EVIDENCE_PDF_FONT)
    return {
      regular: new StandardFont(false),
      bold: new StandardFont(true),
      fakeBold: false,
      id: 'helvetica',
    };
  let regular;
  let bold;
  try {
    regular = new TrueTypeFont(
      fs.readFileSync(env.EVIDENCE_PDF_FONT),
      require('node:path').basename(env.EVIDENCE_PDF_FONT, '.ttf'),
    );
    bold = env.EVIDENCE_PDF_FONT_BOLD
      ? new TrueTypeFont(
          fs.readFileSync(env.EVIDENCE_PDF_FONT_BOLD),
          require('node:path').basename(env.EVIDENCE_PDF_FONT_BOLD, '.ttf'),
        )
      : null;
  } catch (err) {
    if (err.message?.startsWith('RENDER_')) throw err;
    fail('RENDER_FONT_UNAVAILABLE');
  }
  return {
    regular,
    bold: bold ?? regular,
    fakeBold: !bold,
    id: `${regular.id}${bold ? `+${bold.id}` : ''}`,
  };
}

const rendererId = (env = process.env) => `${RENDERER_VERSION}:${loadFonts(env).id}`;

// Lays out paragraphs of styled runs onto pages of draw operations.
class Layout {
  constructor(fonts) {
    this.fonts = fonts;
    this.pages = [];
    this.newPage();
  }
  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_HEIGHT - MARGIN;
  }
  room(height) {
    if (this.y - height < MARGIN + FOOTER) this.newPage();
  }
  // runs: [{ text, bold }]; text may contain line breaks.
  paragraph(runs, { size = 10.5, indent = 0, color = INK, after = 6, keep = 0 } = {}) {
    const width = PAGE_WIDTH - 2 * MARGIN - indent;
    const leading = size * 1.38;
    const lines = [];
    let line = [];
    let lineWidth = 0;
    const font = bold => (bold ? this.fonts.bold : this.fonts.regular);
    const push = () => {
      lines.push(line);
      line = [];
      lineWidth = 0;
    };
    const place = (text, bold) => {
      const w = font(bold).width(text, size);
      const last = line.at(-1);
      if (last && last.bold === bold) last.text += text;
      else line.push({ text, bold });
      lineWidth += w;
    };
    for (const run of runs) {
      const text = run.text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
      if (CONTROL.test(text)) fail('RENDER_UNSUPPORTED_CHARACTER', 'control');
      text.split('\n').forEach((segment, index) => {
        if (index > 0) push();
        for (const word of segment.split(/(\s+)/).filter(Boolean)) {
          const space = /^\s+$/.test(word);
          const w = font(run.bold).width(word, size);
          if (space) {
            if (line.length) place(' ', run.bold);
            continue;
          }
          if (lineWidth + w <= width) {
            place(word, run.bold);
            continue;
          }
          if (line.length) {
            // Trailing space is not drawn width-wise; drop it before breaking.
            const last = line.at(-1);
            if (last.text.endsWith(' ')) {
              last.text = last.text.slice(0, -1);
            }
            push();
          }
          if (w <= width) {
            place(word, run.bold);
            continue;
          }
          // A single token wider than the line (hashes, identifiers) is split.
          let piece = '';
          for (const ch of word) {
            if (font(run.bold).width(piece + ch, size) > width) {
              place(piece, run.bold);
              push();
              piece = '';
            }
            piece += ch;
          }
          if (piece) place(piece, run.bold);
        }
      });
    }
    if (line.length) push();
    this.room(leading * Math.min(lines.length, 4) + keep * 14);
    for (const parts of lines) {
      this.room(leading);
      let x = MARGIN + indent;
      this.y -= leading;
      for (const part of parts) {
        const text = part.text.replace(/ +$/, '');
        if (text)
          this.ops.push({
            x,
            y: this.y + leading - size * 1.05,
            text,
            bold: part.bold,
            size,
            color,
          });
        x += font(part.bold).width(part.text, size);
      }
    }
    this.y -= after;
  }
  heading(text, level) {
    const size = { 1: 17, 2: 13.5, 3: 11.5 }[level];
    this.y -= level === 1 ? 6 : 8;
    this.paragraph([{ text, bold: true }], { size, after: 4, keep: 3 });
  }
  rule() {
    this.room(10);
    this.ops.push({ rule: true, y: this.y - 4 });
    this.y -= 12;
  }
}

function draw(layout, fonts, pdf, footer) {
  const fontKey = bold => (bold ? 'F2' : 'F1');
  return layout.pages.map((ops, index) => {
    let content = '';
    for (const op of ops) {
      if (op.rule) {
        const y = op.y.toFixed(2);
        const right = (PAGE_WIDTH - MARGIN).toFixed(2);
        content += `${MUTED} RG 0.6 w ${MARGIN} ${y} m ${right} ${y} l S\n`;
        continue;
      }
      const font = op.bold ? fonts.bold : fonts.regular;
      const fake = op.bold && fonts.fakeBold ? `2 Tr 0.35 w ${op.color} RG ` : '0 Tr ';
      content +=
        `BT /${fontKey(op.bold)} ${op.size} Tf ${op.color} rg ${fake}` +
        `${op.x.toFixed(2)} ${op.y.toFixed(2)} Td ` +
        `${font.encode(op.text)} Tj ET\n`;
    }
    const label = `${footer} · page ${index + 1} of ${layout.pages.length}`;
    content +=
      `BT /F1 8 Tf ${MUTED} rg 0 Tr ${MARGIN} ${(MARGIN - 12).toFixed(2)} Td ` +
      `${fonts.regular.encode(label)} Tj ET\n`;
    return pdf.stream('', Buffer.from(content, 'latin1'));
  });
}

function blocksInto(layout, blocks) {
  for (const block of blocks) {
    if (block.type === 'h1') layout.heading(block.text, 1);
    else if (block.type === 'h2') layout.heading(block.text, 2);
    else if (block.type === 'h3') layout.heading(block.text, 3);
    else if (block.type === 'p')
      layout.paragraph(block.runs.length ? block.runs : [{ text: '', bold: false }]);
    else
      block.rows.forEach((cells, i) => {
        layout.paragraph([{ text: `Evidence table row ${i + 1}`, bold: true }], {
          size: 10,
          after: 2,
          keep: 2,
        });
        cells.forEach((cell, j) =>
          layout.paragraph(
            [
              { text: `${block.headers[j] ?? `Column ${j + 1}`}: `, bold: true },
              { text: cell, bold: false },
            ],
            { size: 9.5, indent: 12, after: 1 },
          ),
        );
        layout.y -= 6;
      });
  }
}

// meta: formulation_code, request_id, report_number, release_id, released_at,
// status, reviewer, reviewed_at, currency, manifest_hash.
// Returns { buffer, sha256, renderer, pages }.
function renderDossier({ brief, technical, meta }, env = process.env) {
  const briefBlocks = parse(brief);
  const technicalBlocks = parse(technical);
  const fonts = loadFonts(env);
  const layout = new Layout(fonts);
  const day = value => (value ? String(value).slice(0, 10) : 'not recorded');
  layout.paragraph([{ text: 'Sanko private evidence report — control record', bold: true }], {
    size: 12,
    after: 4,
  });
  const control = [
    ['Formulation', meta.formulation_code ?? 'not recorded'],
    ['Request reference', meta.request_id],
    ['Report version', `${meta.report_number} (release ${meta.release_id})`],
    ['Released', day(meta.released_at)],
    ['Release status when sent', meta.status],
    ['Independent review', `${meta.reviewer ?? 'not recorded'}, ${day(meta.reviewed_at)}`],
    ['Source currency', meta.currency ?? 'not recorded'],
    ['Signed manifest', meta.manifest_hash],
    [
      'This copy',
      'Contains the released practitioner brief and technical dossier exactly as approved. ' +
        'Sanko added only this control record and the page footers. Whoever holds this file ' +
        'can keep or forward it; it cannot be recalled.',
    ],
    [
      'Check current status',
      'In WhatsApp: My vault > Evidence reports > My reports, or in the private evidence ' +
        'portal. Corrections, new ' +
        'versions and withdrawals are shown there, not in this copy.',
    ],
  ];
  for (const [label, value] of control)
    layout.paragraph(
      [
        { text: `${label}: `, bold: true },
        { text: String(value ?? ''), bold: false },
      ],
      { size: 9.5, after: 2 },
    );
  layout.rule();
  layout.paragraph([{ text: 'Part 1 of 2 — Practitioner brief (released)', bold: true }], {
    size: 9.5,
    color: MUTED,
    after: 2,
  });
  blocksInto(layout, briefBlocks);
  layout.newPage();
  layout.paragraph([{ text: 'Part 2 of 2 — Technical dossier (released)', bold: true }], {
    size: 9.5,
    color: MUTED,
    after: 2,
  });
  blocksInto(layout, technicalBlocks);

  const pdf = new Pdf();
  const catalog = pdf.reserve();
  const pagesId = pdf.reserve();
  const contents = draw(
    layout,
    fonts,
    pdf,
    `Private · Sanko evidence report ${meta.formulation_code ?? ''} · ` +
      `version ${meta.report_number}`,
  );
  const f1 = fonts.regular.write(pdf);
  const f2 = fonts.bold.write(pdf);
  const resources = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >>`;
  const kids = contents.map(content =>
    pdf.add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources ${resources} /Contents ${content} 0 R >>`,
    ),
  );
  pdf.set(
    pagesId,
    `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,
  );
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const info = pdf.add(
    `<< /Title (Sanko private evidence report) /Producer (${RENDERER_VERSION}) >>`,
  );
  const buffer = pdf.build(catalog, info);
  return {
    buffer,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    renderer: `${RENDERER_VERSION}:${fonts.id}`,
    pages: kids.length,
  };
}

module.exports = { renderDossier, rendererId, loadFonts, RENDERER_VERSION };

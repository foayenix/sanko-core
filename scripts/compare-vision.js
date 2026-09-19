#!/usr/bin/env node
// Compare vision models on the same pages.
//
//   node scripts/compare-vision.js ./pages
//   node scripts/compare-vision.js ./pages --models glm-ocr,qwen3.5:27b,qwen2.5vl:7b
//   node scripts/compare-vision.js ./pages --language yo --out report.json
//
// `pages` is a directory of photographed pages. A `<name>.txt` beside `<name>.jpg`
// is that page's ground truth — what the page actually says, typed by a human who
// looked at it. With ground truth you get scores; without it you get the readings
// side by side, which is the mode you are in before anyone has corrected anything.
//
// Why this exists: every published OCR benchmark measures printed documents —
// invoices, tables, formulas, screenshots. None of them contain handwriting in
// Yorùbá, Igbo or Hausa, so a model's OmniDocBench rank predicts very little about
// a practitioner's notebook. The only number worth having is one measured on these
// pages.
//
// Three metrics, because "worse" has two quite different causes:
//
//   cer           character error rate against the truth. The headline.
//   cer_stripped  the same after removing every diacritic from both sides. If this
//                 is low while cer is high, the model read the words correctly and
//                 dropped the marks — a different failure with a different fix, and
//                 the one that silently corrupts a Yorùbá record.
//   diacritics    how many marks the truth has and how many the reading kept.
//
// Nothing here writes to the database and nothing is sent off the machine unless
// you pass --backend anthropic explicitly.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const vision = require('../src/services/vision');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic']);
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/jpeg' };

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

// Marks removed, case folded, whitespace collapsed. Hausa's hooked letters are
// folded to their plain counterparts too: ɓ and b are the same word to this
// measure, which is the point — it is asking whether the words were read, setting
// the marks aside.
const HOOKED = { 'ɓ': 'b', 'ɗ': 'd', 'ƙ': 'k', 'ƴ': 'y', 'Ɓ': 'b', 'Ɗ': 'd', 'Ƙ': 'k', 'Ƴ': 'y' };
function strip(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ɓɗƙƴƁƊƘƳ]/g, ch => HOOKED[ch] ?? ch)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function countMarks(text) {
  const d = text.normalize('NFD');
  return (d.match(/[̀-ͯ]/g) ?? []).length + (d.match(/[ɓɗƙƴƁƊƘƳ]/g) ?? []).length;
}

// Two rows rather than a full matrix: a page is a few thousand characters and the
// full table would be tens of megabytes for no benefit.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

// Divided by the reference length, so it is "errors per character of truth" and
// stays comparable across pages of different lengths. It can exceed 1 when a
// model rambles; that is real information, not a bug to clamp away.
function cer(reference, output) {
  const ref = reference.replace(/\s+/g, ' ').trim();
  if (!ref) return null;
  return levenshtein(ref, output.replace(/\s+/g, ' ').trim()) / ref.length;
}

function pct(value) {
  return value === null || value === undefined ? '   —  ' : `${(value * 100).toFixed(1).padStart(5)}%`;
}

async function main() {
  const dir = process.argv[2];
  if (!dir || dir.startsWith('--')) {
    console.error('Usage: node scripts/compare-vision.js <pages-dir> [--models a,b] [--language yo] [--out report.json]');
    process.exit(1);
  }
  if (!fs.existsSync(dir)) {
    console.error(`No such directory: ${dir}`);
    process.exit(1);
  }

  const models = (arg('models') ?? process.env.VISION_MODEL ?? 'qwen2.5vl:7b').split(',').map(m => m.trim()).filter(Boolean);
  const backend = arg('backend', 'ollama');
  const language = arg('language', null);
  const outFile = arg('out', null);

  if (backend === 'anthropic') {
    console.warn('\n  ⚠  --backend anthropic sends every page in this directory to a hosted API.');
    console.warn('     Use it to measure the gap, never as a runtime for practitioner pages.\n');
  }

  const pages = fs.readdirSync(dir)
    .filter(name => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .sort()
    .map(name => {
      const truthFile = path.join(dir, `${path.basename(name, path.extname(name))}.txt`);
      return {
        name,
        buffer: fs.readFileSync(path.join(dir, name)),
        mimeType: MIME[path.extname(name).toLowerCase()] ?? 'image/jpeg',
        truth: fs.existsSync(truthFile) ? fs.readFileSync(truthFile, 'utf8').trim() : null,
      };
    });

  if (!pages.length) {
    console.error(`No images in ${dir}. Put the photographed pages there, and a <name>.txt beside any page you have typed out.`);
    process.exit(1);
  }

  const scored = pages.filter(p => p.truth).length;
  console.log(`\n  ${pages.length} page(s), ${scored} with ground truth · ${models.length} model(s)\n`);
  if (!scored) {
    console.log('  No .txt files found, so this run cannot score anything — it will print the readings');
    console.log('  for you to compare by eye. Type out two or three pages to get numbers.\n');
  }

  const results = [];
  for (const model of models) {
    for (const page of pages) {
      process.stdout.write(`  ${model} · ${page.name} … `);
      const started = Date.now();
      const read = await vision.transcribePage(page.buffer, page.mimeType, { model, backend, language });
      const seconds = (Date.now() - started) / 1000;

      const row = {
        model,
        page: page.name,
        seconds,
        error: read.error,
        text: read.text,
        confidence: read.confidence,
        unreadable: read.unreadable,
        marks_read: countMarks(read.text),
        marks_truth: page.truth ? countMarks(page.truth) : null,
        cer: page.truth ? cer(page.truth, read.text) : null,
        cer_stripped: page.truth ? cer(strip(page.truth), strip(read.text)) : null,
      };
      results.push(row);
      console.log(read.error ? `failed: ${read.error}` : `${read.text.length} chars, ${seconds.toFixed(1)}s`);
    }
  }

  // ── scores ──
  if (scored) {
    console.log('\n  Scores (lower CER is better)\n');
    console.log('  model                      cer   cer-stripped   marks kept    mean s');
    console.log('  ' + '─'.repeat(68));
    for (const model of models) {
      const rows = results.filter(r => r.model === model && r.cer !== null && !r.error);
      if (!rows.length) { console.log(`  ${model.padEnd(24)}  every page failed`); continue; }
      const mean = key => rows.reduce((sum, r) => sum + r[key], 0) / rows.length;
      const marksTruth = rows.reduce((sum, r) => sum + r.marks_truth, 0);
      const marksRead = rows.reduce((sum, r) => sum + r.marks_read, 0);
      const kept = marksTruth ? marksRead / marksTruth : null;
      console.log(`  ${model.padEnd(24)} ${pct(mean('cer'))}        ${pct(mean('cer_stripped'))}      ${pct(kept)}    ${mean('seconds').toFixed(1).padStart(6)}`);
    }
    console.log(`
  cer-stripped far below cer means the words were read and the diacritics were not.
  "marks kept" well under 100% says the same thing from the other side: that is the
  failure that produces a confident, fluent, subtly wrong record.
`);
  }

  // ── readings, for the eye ──
  const readable = results.map(r =>
    `${'─'.repeat(72)}\n${r.model} · ${r.page} · ${r.seconds.toFixed(1)}s${r.error ? ` · FAILED: ${r.error}` : ''}\n${'─'.repeat(72)}\n${r.text || '(nothing)'}\n`
  ).join('\n');
  const sideBySide = outFile ? outFile.replace(/\.json$/, '') + '.txt' : path.join(dir, 'readings.txt');
  fs.writeFileSync(sideBySide, readable);
  console.log(`  Readings written to ${path.relative(process.cwd(), sideBySide)}`);

  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify({ ran_at: new Date().toISOString(), backend, language, models, results }, null, 2));
    console.log(`  Report written to ${path.relative(process.cwd(), outFile)}`);
  }
  console.log();
}

// The measures are pure and are the part worth being sure about — a scoring bug
// would not announce itself, it would just rank the wrong model first.
module.exports = { strip, countMarks, levenshtein, cer, _main: main };

if (require.main === module) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

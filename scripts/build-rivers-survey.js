#!/usr/bin/env node
// Table 1 of the Rivers State ethnomedicinal survey, into a survey file.
//
//   node scripts/build-rivers-survey.js
//
// Ajibesin, Bala & Umoh 2012, Pharmaceutical Biology 50(9):1123-1143,
// doi:10.3109/13880209.2012.661740. One hundred and eighty-eight species from
// 460 households across every local government area of Rivers State, with
// local names in four languages the index held none of.
//
// ── why the input is a transcription and not the PDF ──
// The article is a scan. Its pages carry no text layer at all — pdffonts lists
// nothing, pdfimages shows one 2550×3300 image per page — so there is no table
// to parse and no OCR was available. Table 1 was read off the page images and
// written down, and that transcription is committed beside this script at
// data/plants/surveys/transcriptions/, because it is the only form of the
// source this repository can rebuild from.
//
// That makes the transcription itself the thing to check. Three properties are
// checkable and are asserted below: 188 rows, specimen numbers running 1 to 188
// with no gap and no repeat, and a family on every row. The botanical names are
// checked by GBIF downstream, where a misread letter shows up as an unresolved
// name rather than a wrong species. The local names cannot be checked by
// anything — a misread there is invisible, which is the honest cost of using a
// scan, and the reason the source records how it was read.
//
// ── the languages ──
// The paper says its local names are in "four major ethnic languages: Ikwerre,
// Kalabari, Ogoni, and Ekpeye", and prints one in brackets after each name.
// Three map cleanly onto ISO 639-3. "Ogoni" does not: it names a cluster —
// Khana, Gokana, Eleme, Baan, Tee — and picking one of them would be inventing
// a fact the paper does not state. Those rows keep the published label and no
// code, which costs them a language attribution and keeps their mapping.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const transcriptionPath = path.join(root, 'data', 'plants', 'surveys', 'transcriptions', 'ajibesin-2012-rivers-table1.json');
const outputPath = path.join(root, 'data', 'plants', 'surveys', 'ajibesin-2012-rivers.json');

const SOURCE_ID = 'ajibesin-2012-rivers';
const USE_CONTEXT = 'medicinal plant reported across the local government areas of Rivers State';
const EXPECTED_ROWS = 188;

// ISO 639-3 where the published label names one language.
// The plant-part column, which is a column of running prose more than a list.
// It carries the part, sometimes several parts for several preparations, and
// always a bracketed run of numbers that are local-government codes rather
// than parts. Cells also run words together where the print wrapped:
// "RootLeaves", "LeavesBran", "leavesTuber".
//
// So parts are read by looking for known terms rather than by splitting on
// punctuation, longest term first so "whole plant" is not read as "plant" and
// "fruit pericarp" is not read as "fruit". Anything in a cell that matches no
// term is reported by the builder rather than dropped silently — an unknown
// part is either a term worth adding here or a transcription to check.
//
// "stem bark" and "root bark" are deliberately absent, though both are real
// parts and appear in other sources. In this table that word pair only ever
// arises from a wrap — "Stem and bark", or Root and Bark printed on two lines
// against two preparations — so reading it as one part would invent a part
// and lose one.
const PART_TERMS = [
  'whole plant', 'fruit pericarp', 'seed shell', 'flower bud', 'leaf sap',
  'leaves', 'leaf', 'bark', 'roots', 'root', 'stem', 'seeds', 'seed', 'fruits', 'fruit',
  'flowers', 'flower', 'tubers', 'tuber', 'corm', 'rhizome', 'twigs', 'twig', 'nut', 'nuts',
  'bulb', 'clove', 'bran', 'pericarp', 'shell', 'sap', 'plant'
];

const LANGUAGE_CODES = {
  Ikwerre: 'ikw',
  Kalabari: 'ijn',
  Ekpeye: 'ekp',
  // Ogoni is deliberately absent: see the header.
  Ogoni: null
};

// The paper prints "Ikwere" once, at specimen 23, and "kalabari" lowercase
// once. Spelling of the label is normalised; the label itself is kept.
const LABEL_SPELLINGS = { Ikwere: 'Ikwerre', Kalabari: 'Kalabari' };

// Two cells hold the botanical name again rather than a local name. A binomial
// in the local-name column is not a mapping this index can use.
const NOT_LOCAL_NAMES = new Set(['aloe vera']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// "Ekpegwo (Kalabari)" → name and label. A cell with no bracket has no label,
// which happens five times and is recorded as such rather than guessed at.
function splitLocalName(cell) {
  const match = String(cell).match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!match) return { name: String(cell).trim(), label: null };
  const label = match[2].trim();
  const spelled = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
  return { name: match[1].trim(), label: LABEL_SPELLINGS[spelled] ?? spelled };
}

// "Akilu, akama" is two names in one language; the quotes around "Pawpaw" and
// "Guava" are the authors marking a borrowed word, and are dropped.
function localNames(name) {
  return name
    .split(',')
    .map(part => part.replace(/[“”"']/g, '').trim())
    .filter(Boolean);
}

function parseParts(cell) {
  if (!cell) return { parts: [], unrecognised: [] };

  const cleaned = String(cell)
    // The bracketed local-government codes, including the stray "((1-23)" and
    // "21-23-W" the print carries.
    .replace(/\(+[\d,\s\u2013-]*[\dW][\d,\s\u2013W-]*\)?/g, ' ')
    // "RootLeaves" → "Root Leaves"
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // "and", "or" and the punctuation are separators, not noise: splitting on
  // them first stops "stem and bark" being read as one part.
  const parts = [];
  const unrecognised = [];
  for (const segment of cleaned.split(/[;,]|\band\b|\bor\b/)) {
    let remaining = segment;
    for (;;) {
      // Earliest match wins, so parts come out in the order the cell prints
      // them; longest wins a tie, so "whole plant" beats "plant".
      const found = PART_TERMS
        .map(term => ({ term, index: remaining.indexOf(term) }))
        .filter(candidate => candidate.index !== -1)
        .sort((a, b) => a.index - b.index || b.term.length - a.term.length)[0];
      if (!found) break;
      if (!parts.includes(found.term)) parts.push(found.term);
      remaining = `${remaining.slice(0, found.index)} ${remaining.slice(found.index + found.term.length)}`;
    }
    unrecognised.push(...remaining.split(/\s+/).filter(Boolean));
  }

  return { parts, unrecognised };
}

function toSurveyRow(row) {
  const { name, label } = splitLocalName(row.local);
  const language = label ? LANGUAGE_CODES[label] ?? null : null;
  const names = NOT_LOCAL_NAMES.has(name.toLowerCase().replace(/[“”"']/g, '')) ? [] : localNames(name);

  const { unrecognised } = parseParts(row.parts);
  const flags = [];
  if (unrecognised.length) flags.push('plant_part_not_recognised');
  if (!label) flags.push('language_not_printed');
  if (label && language === null) flags.push('language_label_names_a_cluster');
  if (!names.length) flags.push('local_name_column_repeats_the_botanical_name');
  if (row.merged_cell) flags.push('specimen_shares_a_merged_cell');

  return {
    source_id: SOURCE_ID,
    source_row: row.pnm,
    specimen_number: `PNM ${row.pnm}`,
    botanical_as_published: row.botanical,
    family_as_published: row.family,
    common_english_as_published: null,
    // The cell as read, before it was split into name and language.
    vernacular_as_published: row.local,
    language_as_published: label,
    vernacular_names: names.map(local_name => ({ local_name, language })),
    parts_as_published: row.parts ?? null,
    parts_reported: parseParts(row.parts).parts,
    use_context: USE_CONTEXT,
    data_quality_flags: flags
  };
}

function main() {
  const transcription = readJson(transcriptionPath);

  if (transcription.length !== EXPECTED_ROWS) {
    throw new Error(`Transcription has ${transcription.length} rows; the paper reports ${EXPECTED_ROWS} species.`);
  }
  const numbers = transcription.map(row => row.pnm);
  const missing = Array.from({ length: EXPECTED_ROWS }, (_, index) => index + 1).filter(n => !numbers.includes(n));
  if (missing.length) throw new Error(`Specimen numbers missing from the transcription: ${missing.join(', ')}`);
  if (new Set(numbers).size !== numbers.length) throw new Error('A specimen number is transcribed twice.');
  const unfamilied = transcription.filter(row => !row.family?.trim());
  if (unfamilied.length) throw new Error(`${unfamilied.length} row(s) have no family.`);

  const rows = transcription
    .slice()
    .sort((a, b) => a.pnm - b.pnm)
    .map(toSurveyRow);

  fs.writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);

  const byLanguage = {};
  for (const row of rows) {
    for (const name of row.vernacular_names) {
      const key = name.language ?? `${row.language_as_published ?? 'unlabelled'} (no code)`;
      byLanguage[key] = (byLanguage[key] ?? 0) + 1;
    }
  }
  console.log(`${rows.length} rows → ${path.relative(process.cwd(), outputPath)}`);
  console.log(`  ${rows.reduce((total, row) => total + row.vernacular_names.length, 0)} local name(s): ${Object.entries(byLanguage).map(([key, count]) => `${key} ${count}`).join(', ')}`);

  const partCounts = {};
  for (const row of rows) for (const part of row.parts_reported) partCounts[part] = (partCounts[part] ?? 0) + 1;
  const withoutParts = rows.filter(row => !row.parts_reported.length);
  console.log(`  ${Object.keys(partCounts).length} distinct part(s) across ${rows.length - withoutParts.length} rows: ${Object.entries(partCounts).sort((a, b) => b[1] - a[1]).map(([part, count]) => `${part} ${count}`).join(', ')}`);
  for (const row of rows) {
    const { unrecognised } = parseParts(row.parts);
    if (unrecognised.length) console.log(`  PNM ${row.source_row}: unrecognised in the part cell — ${unrecognised.join(' ')} — from "${row.parts_as_published}"`);
  }
  for (const row of rows.filter(item => item.data_quality_flags.length)) {
    console.log(`  PNM ${row.source_row}: ${row.data_quality_flags.join(', ')} — "${row.vernacular_as_published}"`);
  }
  return rows;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { LANGUAGE_CODES, PART_TERMS, parseParts, splitLocalName, localNames, toSurveyRow, main };

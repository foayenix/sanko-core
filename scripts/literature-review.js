#!/usr/bin/env node
// Human verification of index entries (docs/SANKO_EVIDENCE_ATLAS_SPEC.md, 5.4 step 4).
//
//   node scripts/literature-review.js queue  [--taxa pilot|id,id] [--out file.csv]
//   node scripts/literature-review.js verify --file reviewed.csv --reviewer <id> [--date YYYY-MM-DD]
//   node scripts/literature-review.js status [--taxa pilot|id,id]
//
// `queue` writes a spreadsheet of unverified entries to data/literature/review/
// (gitignored working files). The `auto_*` columns show what the automated pass
// guessed; the reviewer reads the study through its link and fills the
// right-hand columns. `decision` (include/exclude) is required for a row to
// count. A blank reviewer column means "the automated value is correct" —
// except `voucher_reported`, and the name columns when the automated pass could
// not find the name in the title, which must always be filled for an include.
// Multi-value cells use "; ". Booleans are yes/no.
//
// `verify` turns each decided row into an append-only verification event in
// data/literature/verifications.json, checked against the full schema; nothing
// is written if any row is invalid. The reviewer id is a pseudonym (lowercase
// letters, digits, hyphens), never a name or email address.

const fs = require('fs');
const path = require('path');
const store = require('../src/literature/store');
const csv = require('../src/literature/csv');
const vocab = require('../src/literature/vocab');
const { hash } = require('../src/literature/records');
const { selectTaxa } = require('./literature-discover');

const root = path.join(__dirname, '..');

const AUTO_COLUMNS = [
  'screening', 'exclusion_reason', 'evidence_kind', 'is_safety_study', 'plant_part',
  'preparation', 'model', 'area_studied', 'collection_country', 'botanical_name_as_published',
  'name_resolution',
];
const REVIEW_COLUMNS = [
  'decision', 'exclusion_reason', 'botanical_name_as_published', 'name_resolution',
  'evidence_kind', 'is_safety_study', 'plant_part', 'preparation', 'model', 'area_studied',
  'collection_country', 'study_country', 'voucher_reported', 'notes',
];
const HEADER = [
  'entry_id', 'taxon', 'title', 'year', 'journal', 'link', 'source_status', 'publication_type',
  'mention_location', ...AUTO_COLUMNS.map(column => `auto_${column}`), ...REVIEW_COLUMNS,
];

const HUMAN_FIRST = ['human_interventional', 'human_observational', 'case_report', 'systematic_review'];

function plants() {
  return JSON.parse(fs.readFileSync(path.join(root, 'data', 'plants', 'plants.json'), 'utf8'));
}

function format(value) {
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return value ?? '';
}

function priority(entry) {
  if (entry.is_safety_study) return 0;
  if (HUMAN_FIRST.includes(entry.evidence_kind)) return 1;
  return entry.mention_location === 'title' ? 2 : 3;
}

function queueRows(data, taxonIds, names) {
  const studies = new Map(data.studies.map(study => [study.study_id, study]));
  return store.effectiveEntries(data)
    .filter(entry => !entry.verified && taxonIds.has(entry.taxon_id))
    .sort((a, b) => (names.get(a.taxon_id) < names.get(b.taxon_id) ? -1 : names.get(a.taxon_id) > names.get(b.taxon_id) ? 1 : 0)
      || priority(a) - priority(b)
      || (studies.get(b.study_id).year ?? 0) - (studies.get(a.study_id).year ?? 0)
      || (a.entry_id < b.entry_id ? -1 : 1))
    .map(entry => {
      const study = studies.get(entry.study_id);
      const row = {
        entry_id: entry.entry_id,
        taxon: names.get(entry.taxon_id),
        title: study.title,
        year: study.year,
        journal: study.journal,
        link: study.full_text_link,
        source_status: study.source_status,
        publication_type: study.publication_type,
        mention_location: entry.mention_location,
      };
      for (const column of AUTO_COLUMNS) row[`auto_${column}`] = format(entry[column]);
      return row;
    });
}

const LISTS = new Set(['plant_part', 'preparation', 'area_studied']);

function parseField(field, raw) {
  if (field === 'is_safety_study') {
    if (!/^(yes|no)$/i.test(raw)) throw new Error(`is_safety_study must be yes or no, got "${raw}"`);
    return /^yes$/i.test(raw);
  }
  if (LISTS.has(field)) return raw.split(';').map(item => item.trim()).filter(Boolean);
  if (field === 'collection_country' || field === 'study_country') return raw === 'not_reported' ? raw : raw.toUpperCase();
  return raw;
}

function toEvent(row, { reviewer, date, entries }) {
  const entry = entries.get(row.entry_id);
  if (!entry) throw new Error(`unknown entry_id ${row.entry_id}`);
  const decision = row.decision.toLowerCase();
  if (!['include', 'exclude'].includes(decision)) throw new Error(`${row.entry_id}: decision must be include or exclude`);
  const fields = {};
  for (const field of Object.keys(store.VERIFIABLE)) {
    if (row[field] === undefined || row[field] === '') continue;
    fields[field] = parseField(field, row[field]);
  }
  if (decision === 'include' && !fields.voucher_reported) {
    throw new Error(`${row.entry_id}: voucher_reported (${vocab.VOUCHER.join('/')}) is required for an include`);
  }
  if (decision === 'include' && entry.name_resolution === 'pending' && (!fields.botanical_name_as_published || !fields.name_resolution)) {
    throw new Error(`${row.entry_id}: the name was not in the title; fill botanical_name_as_published and name_resolution`);
  }
  const exclusionReason = decision === 'exclude' ? (row.exclusion_reason || null) : null;
  const notes = row.notes || null;
  return {
    event_id: `verify-${hash(row.entry_id, reviewer, date, decision, JSON.stringify(fields), exclusionReason ?? '', notes ?? '')}`,
    entry_id: row.entry_id,
    reviewer,
    verified_at: date,
    decision,
    exclusion_reason: exclusionReason,
    fields,
    notes,
  };
}

function verify(data, rows, { reviewer, date }) {
  if (!vocab.REVIEWER_ID.test(reviewer || '')) throw new Error('--reviewer must be a pseudonymous id (lowercase letters, digits, hyphens)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  const entries = new Map(data.entries.map(entry => [entry.entry_id, entry]));
  const known = new Set(data.verifications.map(event => event.event_id));
  const problems = [];
  const events = [];
  for (const row of rows) {
    if (!row.decision) continue;
    try {
      const event = toEvent(row, { reviewer, date, entries });
      if (!known.has(event.event_id)) events.push(event);
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (problems.length) throw new Error(`Nothing imported:\n${problems.join('\n')}`);
  const candidate = { ...data, verifications: [...data.verifications, ...events] };
  const errors = store.validate(candidate);
  if (errors.length) throw new Error(`Nothing imported:\n${errors.slice(0, 30).join('\n')}`);
  return { data: candidate, added: events.length };
}

function status(data, taxonIds, names) {
  const rows = new Map();
  for (const entry of store.effectiveEntries(data)) {
    if (!taxonIds.has(entry.taxon_id)) continue;
    const row = rows.get(entry.taxon_id) ?? { taxon: names.get(entry.taxon_id), total: 0, verified: 0, included: 0 };
    row.total += 1;
    if (entry.verified) row.verified += 1;
    if (entry.verified && entry.decision === 'include') row.included += 1;
    rows.set(entry.taxon_id, row);
  }
  return [...rows.values()].sort((a, b) => (a.taxon < b.taxon ? -1 : 1));
}

function main(argv = process.argv.slice(2)) {
  const [command] = argv;
  const flag = name => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1];
  };
  const data = store.load();
  const all = plants();
  const names = new Map(all.map(plant => [plant.id, plant.accepted_botanical]));

  if (command === 'queue' || command === 'status') {
    const taxa = selectTaxa(all, flag('--taxa') || 'pilot', store.DEFAULT_DIRECTORY);
    const ids = new Set(taxa.map(plant => plant.id));
    if (command === 'status') {
      for (const row of status(data, ids, names)) console.log(`${row.taxon.padEnd(34)} verified ${row.verified}/${row.total}  public ${row.included}`);
      return;
    }
    const rows = queueRows(data, ids, names);
    const out = flag('--out') || path.join(store.DEFAULT_DIRECTORY, 'review', `queue-${new Date().toISOString().slice(0, 10)}.csv`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, csv.stringify(HEADER, rows));
    console.log(`Wrote ${rows.length} unverified entries to ${path.relative(root, out)}`);
    return;
  }

  if (command === 'verify') {
    const file = flag('--file');
    if (!file) throw new Error('--file is required');
    const date = flag('--date') || new Date().toISOString().slice(0, 10);
    const result = verify(data, csv.parse(fs.readFileSync(file, 'utf8')), { reviewer: flag('--reviewer'), date });
    store.save(result.data, ['verifications']);
    console.log(`Imported ${result.added} verification events.`);
    return;
  }

  console.log('Usage: literature-review.js queue|verify|status — see the header of this file.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { HEADER, queueRows, status, toEvent, verify };

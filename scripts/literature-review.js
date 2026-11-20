#!/usr/bin/env node
// Human verification of index entries (docs/SANKO_EVIDENCE_ATLAS_SPEC.md, 5.4 step 4).
//
//   node scripts/literature-review.js queue  [--scope priority|all] [--taxa pilot|id,id] [--out file.csv] [--include-excluded]
//   node scripts/literature-review.js verify --file reviewed.csv --reviewer <id> [--date YYYY-MM-DD]
//   node scripts/literature-review.js status [--taxa pilot|id,id]
//   node scripts/literature-review.js calibration-sample [--seed calibration-1] [--size 50]
//   node scripts/literature-review.js calibration-sheet  --seed <seed>     # re-export a blank sheet from a committed sample
//   node scripts/literature-review.js calibration-report --seed <seed> --a a.csv --reviewer-a <id> --b b.csv --reviewer-b <id>
//
// The reviewer guide is docs/LITERATURE_REVIEWER_GUIDE.md; the session
// procedure for running these commands is docs/LITERATURE_COORDINATOR_RUNBOOK.md.
//
// `queue` defaults to --scope priority: entries the automated pass flagged as
// safety studies or human studies (founder decision, 19 November 2026). The
// calibration report measures how many such studies that flag misses.
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
const calibration = require('../src/literature/calibration');
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

const HUMAN_FIRST = calibration.HUMAN_KINDS;

// The calibration sheet is blind: no automated guesses, every field filled by
// the reviewer, plus the time each entry took.
const CALIBRATION_HEADER = [
  'entry_id', 'taxon', 'title', 'year', 'journal', 'link', 'source_status', 'publication_type',
  ...REVIEW_COLUMNS, 'minutes_spent',
];
const CALIBRATION_REQUIRED = ['evidence_kind', 'is_safety_study', 'voucher_reported', 'plant_part', 'model', 'area_studied', 'name_resolution', 'botanical_name_as_published'];

function allowedValues() {
  const rows = [
    ['decision', 'include; exclude', 'Required. Include = original data on this plant.'],
    ['exclusion_reason', vocab.EXCLUSION_REASON.join('; '), 'Required when decision is exclude.'],
    ['botanical_name_as_published', 'free text', 'The plant name exactly as the study prints it, without author abbreviation.'],
    ['name_resolution', 'exact; synonym; unresolved', 'exact = the accepted name; synonym = another name for the same plant.'],
    ['evidence_kind', vocab.EVIDENCE_KIND.join('; '), 'One value: the main design of the study.'],
    ['is_safety_study', 'yes; no', 'yes if toxicity, adverse effects or interactions are a stated aim or outcome.'],
    ['plant_part', vocab.PLANT_PART.join('; '), 'One or more, separated by "; ".'],
    ['preparation', 'free text', 'Extract or preparation as published, e.g. aqueous; ethanol. Use not_reported if absent.'],
    ['model', vocab.MODEL.join('; '), 'One value.'],
    ['area_studied', vocab.AREA.join('; '), 'One or more, separated by "; ".'],
    ['collection_country', 'two-letter ISO code (NG, GH, CM…) or not_reported', 'Where the plant material was collected.'],
    ['study_country', 'two-letter ISO code or not_reported', 'Where the experiment or study took place.'],
    ['voucher_reported', vocab.VOUCHER.join('; '), 'Required for every include. See the guide.'],
    ['notes', 'free text, at most 280 characters', 'Your own words only. Never paste abstract or article text.'],
    ['minutes_spent', 'number', 'Calibration sheets only: minutes spent on this entry.'],
  ];
  return csv.stringify(['column', 'allowed_values', 'notes'], rows.map(([column, allowed_values, notes]) => ({ column, allowed_values, notes })));
}

function writeSheet(file, header, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, csv.stringify(header, rows));
  fs.writeFileSync(path.join(path.dirname(file), 'allowed-values.csv'), allowedValues());
}

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

function queueRows(data, taxonIds, names, { includeExcluded = false, scope = 'priority' } = {}) {
  if (!['priority', 'all'].includes(scope)) throw new Error('--scope must be priority or all');
  const studies = new Map(data.studies.map(study => [study.study_id, study]));
  return store.effectiveEntries(data)
    // Automated exclusions (reviews, errata, patents) can never become public, so
    // reviewers only see them when asked to audit the automated screening.
    .filter(entry => !entry.verified && taxonIds.has(entry.taxon_id) && (includeExcluded || entry.screening !== 'exclude'))
    .filter(entry => scope === 'all' || calibration.isPriority(entry))
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

function calibrationRows(data, sample, names) {
  const studies = new Map(data.studies.map(study => [study.study_id, study]));
  return sample.map(({ entry }) => {
    const study = studies.get(entry.study_id);
    return {
      entry_id: entry.entry_id,
      taxon: names.get(entry.taxon_id),
      title: study.title,
      year: study.year,
      journal: study.journal,
      link: study.full_text_link,
      source_status: study.source_status,
      publication_type: study.publication_type,
    };
  });
}

// Checks both sheets cover the sample and are filled completely, then compares.
// Blind sheets have no automated fallback, so a blank required field is an error.
function calibrationReport({ data, manifest, rowsA, rowsB, reviewerA, reviewerB }) {
  const automated = new Map(data.entries.map(entry => [entry.entry_id, entry]));
  const sample = manifest.entries.map(({ entry_id, stratum }) => {
    if (!automated.has(entry_id)) throw new Error(`sample entry ${entry_id} no longer exists`);
    return { entry: automated.get(entry_id), stratum };
  });
  const ids = new Set(manifest.entries.map(item => item.entry_id));
  const problems = [];
  for (const [reviewer, rows] of [[reviewerA, rowsA], [reviewerB, rowsB]]) {
    for (const row of rows) {
      if (!ids.has(row.entry_id)) problems.push(`${reviewer}: ${row.entry_id} is not in sample ${manifest.seed}`);
      const decision = (row.decision || '').toLowerCase();
      if (row.decision && !['include', 'exclude'].includes(decision)) problems.push(`${reviewer}: ${row.entry_id} decision must be include or exclude`);
      if (decision === 'exclude' && !vocab.EXCLUSION_REASON.includes(row.exclusion_reason)) problems.push(`${reviewer}: ${row.entry_id} exclusion needs a reason`);
      if ((row.notes || '').length > store.NOTES_MAX) problems.push(`${reviewer}: ${row.entry_id} notes longer than ${store.NOTES_MAX} characters`);
      if (decision === 'include') {
        const missing = CALIBRATION_REQUIRED.filter(field => !row[field]);
        if (missing.length) problems.push(`${reviewer}: ${row.entry_id} missing ${missing.join(', ')}`);
      }
    }
  }
  if (problems.length) throw new Error(`Calibration sheets incomplete:\n${problems.join('\n')}`);
  return { seed: manifest.seed, ...calibration.compare({ rowsA, rowsB, sample, reviewerA, reviewerB }) };
}

function printReport(report) {
  const pct = value => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);
  console.log(`Calibration ${report.seed}: ${report.decided_by_both}/${report.sample_size} entries decided by both reviewers`);
  for (const [field, result] of Object.entries(report.inter_reviewer)) {
    console.log(`  ${field.padEnd(20)} agreement ${pct(result.agreement).padStart(4)}  kappa ${result.kappa ?? 'n/a'}  (n=${result.compared})`);
  }
  for (const [reviewer, result] of Object.entries(report.automated_vs_reviewer)) {
    console.log(`  automated vs ${reviewer}: study type ${pct(result.evidence_kind_agreement)}, safety flag ${pct(result.safety_flag_agreement)} (n=${result.included})`);
  }
  const misses = report.priority_scope_misses;
  console.log(`  priority-scope misses: ${misses.found_safety_or_human}/${misses.other_stratum_decided_by_both} non-priority entries were safety or human studies (${pct(misses.miss_rate)})`);
  console.log(`  median minutes per entry: ${Object.entries(report.median_minutes_per_entry).map(([id, value]) => `${id} ${value ?? 'not recorded'}`).join(', ')}`);
  console.log(`  ${report.disagreements.length} field disagreements to reconcile (listed in the report)`);
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
    const scope = flag('--scope') || 'priority';
    const rows = queueRows(data, ids, names, { includeExcluded: argv.includes('--include-excluded'), scope });
    const out = flag('--out') || path.join(store.DEFAULT_DIRECTORY, 'review', `queue-${scope}-${new Date().toISOString().slice(0, 10)}.csv`);
    writeSheet(out, HEADER, rows);
    console.log(`Wrote ${rows.length} unverified ${scope === 'priority' ? 'safety and human ' : ''}entries to ${path.relative(root, out)}`);
    return;
  }

  if (command === 'calibration-sample') {
    const seed = flag('--seed') || 'calibration-1';
    if (!/^[a-z0-9-]{3,40}$/.test(seed)) throw new Error('--seed must be lowercase letters, digits and hyphens');
    const manifestFile = path.join(store.DEFAULT_DIRECTORY, 'calibration', `${seed}-sample.json`);
    if (fs.existsSync(manifestFile)) throw new Error(`${path.relative(root, manifestFile)} exists; choose a new --seed`);
    const sample = calibration.drawSample(store.effectiveEntries(data), { size: Number(flag('--size') || 50), seed });
    const manifest = { seed, drawn_at: new Date().toISOString().slice(0, 10), entries: sample.map(({ entry, stratum }) => ({ entry_id: entry.entry_id, stratum })) };
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const rows = calibrationRows(data, sample, names);
    const out = path.join(store.DEFAULT_DIRECTORY, 'review', `${seed}.csv`);
    writeSheet(out, CALIBRATION_HEADER, rows);
    console.log(`Wrote ${rows.length} entries to ${path.relative(root, out)} (blind; give each reviewer their own copy)`);
    console.log(`Sample manifest: ${path.relative(root, manifestFile)} (commit it)`);
    return;
  }

  if (command === 'calibration-sheet') {
    // Sheets are gitignored and a new container has none; the committed manifest
    // is enough to regenerate the identical blank sheet.
    const seed = flag('--seed');
    const manifestFile = path.join(store.DEFAULT_DIRECTORY, 'calibration', `${seed}-sample.json`);
    if (!seed || !fs.existsSync(manifestFile)) throw new Error('--seed must name an existing calibration sample');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const entries = new Map(data.entries.map(entry => [entry.entry_id, entry]));
    const sample = manifest.entries.map(({ entry_id, stratum }) => ({ entry: entries.get(entry_id), stratum }));
    if (sample.some(item => !item.entry)) throw new Error('the sample names entries that no longer exist');
    const out = path.join(store.DEFAULT_DIRECTORY, 'review', `${seed}.csv`);
    writeSheet(out, CALIBRATION_HEADER, calibrationRows(data, sample, names));
    console.log(`Wrote ${sample.length} entries to ${path.relative(root, out)}`);
    return;
  }

  if (command === 'calibration-report') {
    const seed = flag('--seed');
    const manifestFile = path.join(store.DEFAULT_DIRECTORY, 'calibration', `${seed}-sample.json`);
    if (!seed || !fs.existsSync(manifestFile)) throw new Error('--seed must name an existing calibration sample');
    const reviewerA = flag('--reviewer-a');
    const reviewerB = flag('--reviewer-b');
    for (const id of [reviewerA, reviewerB]) if (!vocab.REVIEWER_ID.test(id || '')) throw new Error('reviewer ids must be pseudonyms');
    if (reviewerA === reviewerB) throw new Error('calibration needs two different reviewers');
    const report = calibrationReport({
      data,
      manifest: JSON.parse(fs.readFileSync(manifestFile, 'utf8')),
      rowsA: csv.parse(fs.readFileSync(flag('--a'), 'utf8')),
      rowsB: csv.parse(fs.readFileSync(flag('--b'), 'utf8')),
      reviewerA,
      reviewerB,
    });
    const out = path.join(store.DEFAULT_DIRECTORY, 'calibration', `${seed}-report.json`);
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    printReport(report);
    console.log(`Report: ${path.relative(root, out)} (commit it)`);
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

module.exports = { CALIBRATION_HEADER, HEADER, allowedValues, calibrationReport, calibrationRows, queueRows, status, toEvent, verify };

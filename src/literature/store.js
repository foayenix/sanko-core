'use strict';
// Committed literature data: load, merge, validate, and compute the effective
// (human-verified over automated) view of every entry.
//
// Files live in data/literature/ and are written with stable ordering so a
// rerun with the same inputs produces the same bytes, as the plant data does.

const fs = require('fs');
const path = require('path');
const vocab = require('./vocab');
const { normaliseTitle } = require('./records');

const DEFAULT_DIRECTORY = path.join(__dirname, '..', '..', 'data', 'literature');

const FILES = {
  searches: 'searches.json',
  studies: 'studies.json',
  entries: 'index_entries.json',
  verifications: 'verifications.json',
};

const SORT_KEY = {
  searches: 'search_id',
  studies: 'study_id',
  entries: 'entry_id',
  verifications: 'event_id',
};

function readArray(file) {
  if (!fs.existsSync(file)) return [];
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`LITERATURE_FILE_NOT_ARRAY: ${path.basename(file)}`);
  return value;
}

function load(directory = DEFAULT_DIRECTORY) {
  const store = { directory };
  for (const [key, file] of Object.entries(FILES)) store[key] = readArray(path.join(directory, file));
  return store;
}

function sorted(rows, key) {
  return [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
}

function save(store, keys = Object.keys(FILES)) {
  fs.mkdirSync(store.directory, { recursive: true });
  for (const key of keys) {
    // Verification events are an append-only log: their order is history.
    const rows = key === 'verifications' ? store[key] : sorted(store[key], SORT_KEY[key]);
    fs.writeFileSync(path.join(store.directory, FILES[key]), `${JSON.stringify(rows, null, 2)}\n`);
  }
}

// ─── merging discovered records ──────────────────────────────────────────────

function findStudy(store, study) {
  return store.studies.find(existing =>
    (study.doi && existing.doi === study.doi)
    || (study.pmid && existing.pmid === study.pmid)
    || (study.pmcid && existing.pmcid === study.pmcid)
    || (normaliseTitle(existing.title) === normaliseTitle(study.title) && existing.year === study.year));
}

// Returns the study_id to link entries to. An existing record keeps its id and
// first-indexed date; its status and identifiers are refreshed.
function mergeStudy(store, study) {
  const existing = findStudy(store, study);
  if (!existing) {
    store.studies.push(study);
    return study.study_id;
  }
  for (const key of ['doi', 'pmid', 'pmcid']) if (!existing[key] && study[key]) existing[key] = study[key];
  if (study.source_status !== 'active' || existing.source_status === 'unknown') existing.source_status = study.source_status;
  existing.last_status_check_at = study.last_status_check_at;
  return existing.study_id;
}

// Automated fields are re-derived on every discovery run; human decisions live
// in verifications.json and are never touched here.
function mergeEntry(store, entry) {
  const index = store.entries.findIndex(existing => existing.entry_id === entry.entry_id);
  if (index === -1) {
    store.entries.push(entry);
    return;
  }
  store.entries[index] = { ...entry, indexed_at: store.entries[index].indexed_at };
}

// ─── validation ──────────────────────────────────────────────────────────────

const STUDY_FIELDS = [
  'study_id', 'doi', 'pmid', 'pmcid', 'europepmc_id', 'title', 'authors', 'year', 'journal',
  'publication_type', 'pub_types_as_indexed', 'source_status', 'full_text_link', 'indexed_at',
  'last_status_check_at',
];

const ENTRY_FIELDS = [
  'entry_id', 'taxon_id', 'study_id', 'botanical_name_as_published', 'name_resolution',
  'mention_location', 'screening', 'exclusion_reason', 'evidence_kind', 'is_safety_study',
  'plant_part', 'preparation', 'model', 'area_studied', 'collection_country', 'study_country',
  'voucher_reported', 'classified_by', 'indexed_at',
];

// Fields a reviewer may set. Anything else in a verification event is rejected.
const VERIFIABLE = {
  botanical_name_as_published: 'string',
  name_resolution: vocab.NAME_RESOLUTION,
  evidence_kind: vocab.EVIDENCE_KIND,
  is_safety_study: 'boolean',
  plant_part: [vocab.PLANT_PART],
  preparation: ['string'],
  model: vocab.MODEL,
  area_studied: [vocab.AREA],
  collection_country: 'country',
  study_country: 'country',
  voucher_reported: vocab.VOUCHER,
};

const SEARCH_FIELDS = ['search_id', 'kind', 'taxon_id', 'provider', 'query', 'executed_at', 'hit_count', 'retrieved', 'error'];
const EVENT_FIELDS = ['event_id', 'entry_id', 'reviewer', 'verified_at', 'decision', 'exclusion_reason', 'fields', 'notes'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

function checkValue(value, rule) {
  if (value === null) return true;
  if (rule === 'string') return typeof value === 'string' && value.trim().length > 0;
  if (rule === 'boolean') return typeof value === 'boolean';
  if (rule === 'country') return value === 'not_reported' || COUNTRY.test(value);
  if (Array.isArray(rule) && rule.length === 1 && (Array.isArray(rule[0]) || rule[0] === 'string')) {
    return Array.isArray(value) && value.length > 0 && value.every(item => checkValue(item, rule[0]));
  }
  if (Array.isArray(rule)) return rule.includes(value);
  return false;
}

function exactFields(row, fields, where, errors) {
  const keys = Object.keys(row);
  for (const key of keys) if (!fields.includes(key)) errors.push(`${where}: unexpected field "${key}"`);
  for (const key of fields) if (!(key in row)) errors.push(`${where}: missing field "${key}"`);
}

function validate(store, { taxonIds = null } = {}) {
  const errors = [];
  const studyIds = new Set();
  for (const study of store.studies) {
    const where = `studies/${study.study_id}`;
    exactFields(study, STUDY_FIELDS, where, errors);
    if (studyIds.has(study.study_id)) errors.push(`${where}: duplicate study_id`);
    studyIds.add(study.study_id);
    if (!study.title) errors.push(`${where}: empty title`);
    if (!vocab.PUBLICATION_TYPE.includes(study.publication_type)) errors.push(`${where}: publication_type`);
    if (!vocab.SOURCE_STATUS.includes(study.source_status)) errors.push(`${where}: source_status`);
    if (!/^https:\/\//.test(study.full_text_link || '')) errors.push(`${where}: full_text_link must be an external https link`);
    if (!DATE.test(study.indexed_at) || !DATE.test(study.last_status_check_at)) errors.push(`${where}: dates`);
  }

  const entryIds = new Map();
  for (const entry of store.entries) {
    const where = `index_entries/${entry.entry_id}`;
    exactFields(entry, ENTRY_FIELDS, where, errors);
    if (entryIds.has(entry.entry_id)) errors.push(`${where}: duplicate entry_id`);
    entryIds.set(entry.entry_id, entry);
    if (!studyIds.has(entry.study_id)) errors.push(`${where}: unknown study_id`);
    if (taxonIds && !taxonIds.has(entry.taxon_id)) errors.push(`${where}: unknown taxon_id`);
    if (!vocab.NAME_RESOLUTION.includes(entry.name_resolution)) errors.push(`${where}: name_resolution`);
    if (!vocab.MENTION_LOCATION.includes(entry.mention_location)) errors.push(`${where}: mention_location`);
    if (!vocab.SCREENING.includes(entry.screening)) errors.push(`${where}: screening`);
    if (entry.exclusion_reason !== null && !vocab.EXCLUSION_REASON.includes(entry.exclusion_reason)) errors.push(`${where}: exclusion_reason`);
    if (entry.classified_by !== 'automated') errors.push(`${where}: classified_by must be automated; human decisions belong in verifications.json`);
    for (const [field, rule] of Object.entries(VERIFIABLE)) {
      if (!checkValue(entry[field], rule)) errors.push(`${where}: ${field}`);
    }
  }

  const eventIds = new Set();
  for (const event of store.verifications) {
    const where = `verifications/${event.event_id}`;
    exactFields(event, EVENT_FIELDS, where, errors);
    if (eventIds.has(event.event_id)) errors.push(`${where}: duplicate event_id`);
    eventIds.add(event.event_id);
    if (!entryIds.has(event.entry_id)) errors.push(`${where}: unknown entry_id`);
    if (!vocab.REVIEWER_ID.test(event.reviewer || '')) errors.push(`${where}: reviewer must be a pseudonymous id`);
    if (!DATE.test(event.verified_at || '')) errors.push(`${where}: verified_at`);
    if (!['include', 'exclude'].includes(event.decision)) errors.push(`${where}: decision`);
    if (event.decision === 'exclude' && !vocab.EXCLUSION_REASON.includes(event.exclusion_reason)) errors.push(`${where}: exclusion requires a reason`);
    if (event.decision === 'include' && event.exclusion_reason !== null) errors.push(`${where}: an include has no exclusion_reason`);
    if (event.notes !== null && typeof event.notes !== 'string') errors.push(`${where}: notes`);
    for (const [field, value] of Object.entries(event.fields || {})) {
      if (!(field in VERIFIABLE)) errors.push(`${where}: field "${field}" is not verifiable`);
      else if (!checkValue(value, VERIFIABLE[field])) errors.push(`${where}: ${field}`);
    }
  }

  for (const search of store.searches) {
    const where = `searches/${search.search_id}`;
    exactFields(search, SEARCH_FIELDS, where, errors);
    if (!['count', 'retrieve'].includes(search.kind)) errors.push(`${where}: kind`);
    if (!DATE.test(search.executed_at || '')) errors.push(`${where}: executed_at`);
  }

  // Every included verification must leave a publishable entry behind.
  for (const entry of effectiveEntries(store)) {
    if (!entry.verified || entry.decision !== 'include') continue;
    const where = `index_entries/${entry.entry_id} (verified)`;
    if (!entry.evidence_kind) errors.push(`${where}: an included entry needs evidence_kind`);
    if (['pending', 'unresolved'].includes(entry.name_resolution)) errors.push(`${where}: an included entry needs a resolved name`);
    if (!entry.botanical_name_as_published) errors.push(`${where}: an included entry needs the name as published`);
    if (entry.voucher_reported === null) errors.push(`${where}: an included entry needs voucher_reported`);
  }

  return errors;
}

// ─── the effective view ──────────────────────────────────────────────────────

// The latest verification event for an entry wins; its fields override the
// automated ones. An entry with no event is unverified and never public.
function effectiveEntries(store) {
  const latest = new Map();
  for (const event of store.verifications) latest.set(event.entry_id, event);
  return store.entries.map(entry => {
    const event = latest.get(entry.entry_id);
    if (!event) return { ...entry, verified: false, decision: null, verified_by: null, verified_at: null };
    return {
      ...entry,
      ...(event.fields || {}),
      classified_by: 'human',
      verified: true,
      decision: event.decision,
      screening: event.decision,
      exclusion_reason: event.exclusion_reason,
      verified_by: event.reviewer,
      verified_at: event.verified_at,
    };
  });
}

module.exports = {
  DEFAULT_DIRECTORY,
  FILES,
  VERIFIABLE,
  effectiveEntries,
  load,
  mergeEntry,
  mergeStudy,
  save,
  validate,
};

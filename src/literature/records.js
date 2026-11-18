'use strict';
// Turning a taxon into search names, and a Europe PMC record into an index study
// and entry. Pure functions: the network layer lives in scripts/literature-discover.js.
//
// What is kept is bibliographic fact (identifiers, title, authors, journal, year,
// publication type) plus Sanko's own classification. Abstracts, full text and
// affiliations are dropped here, before anything is written (spec 5.2).

const crypto = require('crypto');
const { classify } = require('./classify');

const MAX_AUTHORS = 10;

function hash(...values) {
  return crypto.createHash('sha256').update(values.join('\u0000')).digest('hex').slice(0, 12);
}

function normaliseTitle(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanTitle(title) {
  return String(title || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

// "Abelmoschus esculentus (L.) Moench" → "Abelmoschus esculentus". Names without a
// specific epithet ("Grewia sp") are not searchable as a taxon and are dropped.
function binomial(name) {
  const tokens = String(name || '').replace(/[×x]\s/, '').trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const [genus, epithet] = tokens;
  if (!/^[A-Z][a-z-]+$/.test(genus) || !/^[a-z][a-z-]+$/.test(epithet)) return null;
  if (/^(sp|spp|var|subsp|cf|aff)$/.test(epithet)) return null;
  return `${genus} ${epithet}`;
}

// The names a taxon is searched under: the accepted name plus every distinct
// binomial a source printed for it. GBIF synonym expansion is a later addition.
function searchNames(plant) {
  const accepted = binomial(plant.accepted_botanical) ?? plant.accepted_botanical;
  const published = (plant.botanical_names_as_published || []).map(binomial).filter(Boolean);
  const names = [accepted, ...published.filter(name => name !== accepted)];
  return [...new Set(names)];
}

function namesClause(names) {
  return `(${names.flatMap(name => [`TITLE:"${name}"`, `ABSTRACT:"${name}"`]).join(' OR ')})`;
}

const SAFETY_CLAUSE = '(TITLE:toxicity OR TITLE:toxic OR TITLE:safety OR TITLE:hepatotoxicity OR TITLE:nephrotoxicity OR TITLE:genotoxicity OR TITLE:adverse OR TITLE:"drug interaction" OR TITLE:LD50 OR TITLE:"subacute" OR TITLE:"subchronic" OR TITLE:poisoning)';
const HUMAN_CLAUSE = '(PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Clinical Trial" OR PUB_TYPE:"Case Reports" OR TITLE:patients OR TITLE:volunteers OR TITLE:randomized OR TITLE:randomised OR TITLE:"clinical trial")';

function countQueries(plant) {
  const clause = namesClause(searchNames(plant));
  return {
    total: clause,
    safety: `${clause} AND ${SAFETY_CLAUSE}`,
    human: `${clause} AND ${HUMAN_CLAUSE}`,
  };
}

function publicationType(source) {
  switch (source) {
    case 'MED':
    case 'PMC':
      return 'peer_reviewed';
    case 'PPR':
      return 'preprint';
    case 'ETH':
      return 'thesis';
    case 'NBK':
      return 'book_chapter';
    case 'HIR':
    case 'CTX':
      return 'report';
    default:
      return 'unknown';
  }
}

function list(value, key) {
  const items = value?.[key];
  return Array.isArray(items) ? items : [];
}

function pubTypesOf(record) {
  return list(record.pubTypeList, 'pubType').map(String);
}

function sourceStatus(pubTypes) {
  if (pubTypes.some(type => /^retracted publication$/i.test(type))) return 'retracted';
  if (pubTypes.some(type => /^expression of concern/i.test(type))) return 'questioned';
  return 'active';
}

function authors(record) {
  const names = list(record.authorList, 'author').map(author => author.fullName || author.collectiveName).filter(Boolean);
  if (names.length) return names.length > MAX_AUTHORS ? [...names.slice(0, MAX_AUTHORS), 'et al.'] : names;
  const fallback = String(record.authorString || '').replace(/\.$/, '').split(/,\s*/).filter(Boolean);
  return fallback.length > MAX_AUTHORS ? [...fallback.slice(0, MAX_AUTHORS), 'et al.'] : fallback;
}

function fullTextLink(record) {
  if (record.pmcid) return `https://pmc.ncbi.nlm.nih.gov/articles/${record.pmcid}/`;
  if (record.doi) return `https://doi.org/${record.doi}`;
  return `https://europepmc.org/article/${record.source}/${record.id}`;
}

// Stable across runs and across the taxa a study mentions, so one study is one
// record however many plants it covers.
function studyKey(record) {
  if (record.doi) return `doi:${String(record.doi).toLowerCase()}`;
  if (record.pmid) return `pmid:${record.pmid}`;
  if (record.pmcid) return `pmcid:${record.pmcid}`;
  return `title:${normaliseTitle(record.title)}:${record.pubYear || ''}`;
}

function toStudy(record, { indexedAt }) {
  const pubTypes = pubTypesOf(record);
  return {
    study_id: `study-${hash(studyKey(record))}`,
    doi: record.doi ? String(record.doi).toLowerCase() : null,
    pmid: record.pmid || null,
    pmcid: record.pmcid || null,
    europepmc_id: `${record.source}/${record.id}`,
    title: cleanTitle(record.title),
    authors: authors(record),
    year: record.pubYear ? Number(record.pubYear) : null,
    journal: record.journalInfo?.journal?.title || record.bookOrReportDetails?.publisher || null,
    publication_type: publicationType(record.source),
    pub_types_as_indexed: pubTypes,
    source_status: sourceStatus(pubTypes),
    full_text_link: fullTextLink(record),
    indexed_at: indexedAt,
    last_status_check_at: indexedAt,
  };
}

function nameInTitle(title, names) {
  const lower = title.toLowerCase();
  return names.find(name => lower.includes(name.toLowerCase())) ?? null;
}

function toEntry(record, study, plant, { indexedAt }) {
  const names = searchNames(plant);
  const accepted = names[0];
  const titleName = nameInTitle(study.title, names);
  const mentionLocation = titleName ? 'title' : 'abstract';
  const keywords = list(record.keywordList, 'keyword').map(String);
  const mesh = list(record.meshHeadingList, 'meshHeading').map(heading => heading.descriptorName).filter(Boolean);
  const automated = classify({
    title: study.title,
    keywords,
    mesh,
    pubTypes: study.pub_types_as_indexed,
    mentionLocation,
  });

  return {
    entry_id: `entry-${hash(plant.id, study.study_id)}`,
    taxon_id: plant.id,
    study_id: study.study_id,
    botanical_name_as_published: titleName,
    name_resolution: titleName ? (titleName === accepted ? 'exact' : 'synonym') : 'pending',
    mention_location: mentionLocation,
    ...automated,
    study_country: null,
    voucher_reported: null,
    classified_by: 'automated',
    indexed_at: indexedAt,
  };
}

module.exports = {
  binomial,
  countQueries,
  hash,
  namesClause,
  normaliseTitle,
  searchNames,
  studyKey,
  toEntry,
  toStudy,
};

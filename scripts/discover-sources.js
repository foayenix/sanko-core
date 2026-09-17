#!/usr/bin/env node
// Primary-source discovery for the plant mapping data.
//
//   node scripts/discover-sources.js                    # search, then resolve the catalogue
//   node scripts/discover-sources.js --search-only
//   node scripts/discover-sources.js --catalogue-only
//   node scripts/discover-sources.js --save-raw raw.json
//   node scripts/discover-sources.js --from raw.json    # replay a saved response set, offline
//
// Two jobs, both of them acquisition work that was previously done by hand.
//
// First, search: Europe PMC indexes the open-access Nigerian ethnobotanical
// literature, and every survey in it carries the same thing the three included
// sources carry — a table of local names against botanical names. The search is
// scoped by state and by ethnonym as well as by "Nigeria", because a survey of
// Enugu State does not always say Nigeria in its title.
//
// Second, the catalogue: data/plants/surveys/discovery/anumudu-2025-nigeria-review.json
// lists 79 original studies to acquire, by title only. A title is not an
// acquisition — it has to be resolved to a PMCID, a licence, and a full text the
// importer can actually read. That resolution is what blocks the backlog, so it
// is done here rather than in a browser tab.
//
// ── ranking ──
// Candidates are ranked by the gap they would close, and the gap is read from
// data/plants/vernacular_names.json at run time rather than hardcoded. Igbo sits
// at five names today, so a South-East survey outranks a fourth Yoruba one; when
// that stops being true the ranking changes on its own, with no edit here.
//
// ── what this does not do ──
// Nothing written here can reach the runtime index. The output is a discovery
// file, the same tier as the review catalogue: no vernacular rows, no taxonomy,
// no sources.json edit. A source becomes ingestable only when a person reads it,
// registers it in sources.json as active and included, and extracts its table.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const plantsDirectory = path.join(root, 'data', 'plants');
const outputPath = path.join(plantsDirectory, 'surveys', 'discovery', 'europepmc-candidates.json');
const cataloguePath = path.join(plantsDirectory, 'surveys', 'discovery', 'anumudu-2025-nigeria-review.json');

const SEARCH_ENDPOINT = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const CROSSREF_ENDPOINT = 'https://api.crossref.org/works';
const USER_AGENT = 'sanko-plant-data/1.0 (+https://www.sanko.africa)';
const SOURCE_ID = 'europepmc-discovery';

// A title match has to be close enough that we are proposing the study the
// catalogue meant. Publishers and indexes differ on subtitles and punctuation,
// so this compares tokens rather than strings, and abstains below the threshold
// instead of guessing.
const TITLE_MATCH_THRESHOLD = 0.8;
const NEAR_MISS_THRESHOLD = 0.6;

// ─── the map that does the ranking ────────────────────────────────────────────

// Zone codes are the ones the review catalogue publishes (NC, NE, NW, SE, SS, SW),
// so a resolved catalogue row and a search hit describe their region the same way.
const NIGERIAN_STATES = {
  Abia: 'SE', Anambra: 'SE', Ebonyi: 'SE', Enugu: 'SE', Imo: 'SE',
  'Akwa Ibom': 'SS', Bayelsa: 'SS', 'Cross River': 'SS', Delta: 'SS', Edo: 'SS', Rivers: 'SS',
  Ekiti: 'SW', Lagos: 'SW', Ogun: 'SW', Ondo: 'SW', Osun: 'SW', Oyo: 'SW',
  Benue: 'NC', Kogi: 'NC', Kwara: 'NC', Nasarawa: 'NC', Niger: 'NC', Plateau: 'NC',
  Abuja: 'NC', 'Federal Capital Territory': 'NC',
  Adamawa: 'NE', Bauchi: 'NE', Borno: 'NE', Gombe: 'NE', Taraba: 'NE', Yobe: 'NE',
  Jigawa: 'NW', Kaduna: 'NW', Kano: 'NW', Katsina: 'NW', Kebbi: 'NW', Sokoto: 'NW', Zamfara: 'NW'
};

// Which languages a survey in a zone is likely to record. An expectation used
// for ranking only — the language of a name is taken from the published table
// when the source is actually extracted, never from this map.
//
// Principal and also are scored differently on purpose. A South-East survey will
// almost certainly publish Igbo names; it might publish nothing in a minority
// language of the zone. Ranking on the scarcest language alone would put every
// North-Central study at the top on the strength of an Idoma column that may
// well not exist.
const ZONE_LANGUAGES = {
  SW: { principal: ['yo'], also: [] },
  SE: { principal: ['ig'], also: [] },
  SS: { principal: ['ig', 'efi'], also: ['ibb', 'urh', 'ijc', 'bin'] },
  NC: { principal: ['ha'], also: ['tiv', 'nup', 'idu', 'bom', 'igl', 'ff'] },
  NE: { principal: ['ha'], also: ['kr', 'ff'] },
  NW: { principal: ['ha'], also: ['ff'] }
};

function zoneLanguages(zone) {
  const entry = ZONE_LANGUAGES[zone];
  return entry ? [...entry.principal, ...entry.also] : [];
}

// An ethnonym in a title is often the only region signal a study gives.
const LANGUAGE_HINTS = {
  Yoruba: 'yo', Igbo: 'ig', Ibo: 'ig', Hausa: 'ha', Fulani: 'ff', Fulfulde: 'ff',
  Efik: 'efi', Ibibio: 'ibb', Tiv: 'tiv', Nupe: 'nup', Kanuri: 'kr', Idoma: 'idu',
  Berom: 'bom', Urhobo: 'urh', Ijaw: 'ijc', Izon: 'ijc', Bini: 'bin', Igala: 'igl'
};

const LANGUAGE_ZONES = Object.keys(ZONE_LANGUAGES).reduce((zones, zone) => {
  for (const language of zoneLanguages(zone)) (zones[language] ??= []).push(zone);
  return zones;
}, {});

const TOPIC_TITLE_TERMS = [
  'ethnobotanical', 'ethnobotany', 'ethnomedicinal', 'ethnomedicine', 'ethnoveterinary',
  'ethnopharmacological', 'medicinal plants', 'medicinal flora', 'herbal', 'traditional medicine',
  'folk medicine', 'indigenous knowledge'
];

// Titles that describe a name-bearing field study, and the two kinds that do
// not. Laboratory and desk work on plants already identified is the bulk of the
// Nigerian medicinal-plant literature. Health-services research — prevalence of
// herbal use, knowledge and attitudes among patients — is the other large class,
// and it is the one that fools a keyword search, because it says "survey" and
// "traditional medicine" in the title and publishes no plant table at all.
//
// Neither is filtered out, only ranked down: occasionally one carries an
// inventory, and a reviewer should be able to see it and decide.
const ETHNO_PATTERN = /\bethnobotanic|\bethnobotany\b|\bethnomedicin|\bethnoveterinar|\bethnopharmacolog/i;
const PLANT_NOUN_PATTERN = /\bplants?\b|\bflora\b|\bherbs?\b|\bspecies\b|\bvegetables?\b/i;
const FIELD_STUDY_PATTERN = /\bsurvey\b|\binventor|\bdocumentation\b|\bused by\b|\bused (in|for) the (treatment|management)\b|\bindigenous knowledge\b|\btraditional healers\b|\bfolk medicine\b|\bherbal remedies\b/i;
const HEALTH_SERVICES_PATTERNS = [
  /knowledge,? attitude/i, /\bKAP\b/, /\bprevalence\b/i, /\bpredictors?\b/i, /cross-sectional/i,
  /usage pattern/i, /self-medication/i, /\bpatients\b/i, /pregnant women/i, /\butili[sz]ation\b/i,
  /\bperception/i, /\bawareness\b/i, /\bpractices among\b/i, /\bcaregivers?\b/i, /\bconsumption\b/i,
  /\bamong (adolescents|students|residents|mothers|adults|women|men|children|nursing)\b/i
];
const LABORATORY_PATTERNS = [
  /\breview\b/i, /\bmeta-analysis\b/i, /\bdocking\b/i, /\bin silico\b/i, /\bin vitro\b/i, /\bin vivo\b/i,
  /\bphytochemicals?\b/i, /\bbioactivit/i, /\bpharmacologic/i, /\bantimicrobial activit/i,
  /\bantioxidant activit/i, /\bantiproliferative\b/i, /\btoxicity\b/i, /\bessential oils?\b/i,
  /\bcomputational\b/i, /\bendophyt/i, /\bheavy metals?\b/i, /\bproximate\b/i, /\bmicrobial burden\b/i,
  /\bmarketed\b/i, /\bextracts?\b/i, /\bassay\b/i
];

// ─── small helpers, in the shape the other plant scripts use ──────────────────

function readJson(...segments) {
  return JSON.parse(fs.readFileSync(path.join(...segments), 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function flag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

function slug(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'untitled';
}

function stableId(prefix, ...values) {
  const hash = crypto.createHash('sha1').update(values.join('|')).digest('hex').slice(0, 10);
  return `${prefix}-${slug(values[0])}-${hash}`;
}

function titleTokens(title) {
  return new Set(
    String(title ?? '')
      .toLowerCase()
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(token => token.length > 2)
  );
}

// Overlap against the shorter title, not the union: an index that appends a
// subtitle should still match the catalogue's shorter form.
function titleSimilarity(left, right) {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function cleanTitle(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&lt;|&gt;|&amp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── queries ──────────────────────────────────────────────────────────────────

function titleAny(terms) {
  return `(${terms.map(term => `TITLE:"${term}"`).join(' OR ')})`;
}

// Three angles on the same literature. "Nigeria" in the title is the obvious
// one and the one that misses most: a survey of Bokkos or of the Tiv says so in
// its title and leaves the country to its abstract.
function buildQueries() {
  const topic = titleAny(TOPIC_TITLE_TERMS);
  const queries = [
    { id: 'nigeria-titled', query: `${topic} AND (TITLE:"Nigeria" OR TITLE:"Nigerian")` },
    { id: 'ethnonym-titled', query: `${topic} AND ${titleAny(Object.keys(LANGUAGE_HINTS))} AND "Nigeria"` }
  ];
  for (const zone of Object.keys(ZONE_LANGUAGES)) {
    const states = Object.entries(NIGERIAN_STATES).filter(([, code]) => code === zone).map(([state]) => state);
    queries.push({ id: `states-${zone.toLowerCase()}`, zone, query: `${topic} AND ${titleAny(states)} AND "Nigeria"` });
  }
  return queries;
}

// The catalogue publishes a title and an author string ("Abdallah, Mustafa [11]"),
// nothing else. Try the title as a phrase first; fall back to the first surname
// with the title's distinctive words, which is what rescues a row whose title was
// transcribed loosely into the review's table.
function catalogueQueries(entry) {
  const title = cleanTitle(entry.title).replace(/"/g, '');
  const surname = String(entry.authors_as_published ?? '').split(',')[0].replace(/\[.*\]/, '').trim();
  const distinctive = [...titleTokens(title)].slice(0, 6).join(' ');
  const queries = [{ attempt: 'title_phrase', query: `TITLE:"${title}"` }];
  if (surname && distinctive) queries.push({ attempt: 'author_and_words', query: `AUTH:"${surname}" AND ${distinctive}` });
  return queries;
}

// ─── the network layer, isolated so --from can replace it ─────────────────────

// Both indexes are free, public, and shared. A 429 is the service asking to be
// treated better, not an error to retry harder at: back off, honour Retry-After
// when it is given, and give up after a few attempts rather than hammering.
async function getJson(url, { attempts = 5 } = {}) {
  let failure = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (failure) {
      // Honour Retry-After when the service names one; otherwise back off
      // exponentially from two seconds, capped so a long outage fails the run
      // rather than hanging it.
      await new Promise(resolve => setTimeout(resolve, failure.wait ?? Math.min(30000, 2000 * 2 ** (attempt - 2))));
    }

    let response;
    try {
      response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    } catch (error) {
      // A dropped connection mid-pass should cost seconds, not the whole run:
      // the catalogue pass is 79 titles long and restarting it is rude to both
      // services.
      failure = { error, wait: null };
      continue;
    }

    if (response.ok) return response.json();

    const retryAfter = Number(response.headers.get('retry-after'));
    const error = new Error(`${response.status} ${response.statusText}: ${url.split('?')[0]}`);
    if (response.status !== 429 && response.status < 500) throw error;
    failure = { error, wait: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null };
  }
  throw failure.error;
}

// Crossref's polite pool is one request at a time. The catalogue pass runs four
// workers, so the Crossref half is funnelled back into a single queue here
// rather than slowing the whole pass down to match it.
function serialize(minIntervalMs) {
  let chain = Promise.resolve();
  return work => {
    const result = chain.then(work);
    chain = result.then(() => new Promise(resolve => setTimeout(resolve, minIntervalMs)), () => new Promise(resolve => setTimeout(resolve, minIntervalMs)));
    return result;
  };
}

const crossrefQueue = serialize(1000);

async function searchEuropePmc(query, { pageSize = 100 } = {}) {
  const params = new URLSearchParams({
    query,
    format: 'json',
    pageSize: String(Math.min(pageSize, 1000)),
    resultType: 'core'
  });
  const body = await getJson(`${SEARCH_ENDPOINT}?${params}`);
  return { hitCount: body.hitCount ?? 0, results: body.resultList?.result ?? [] };
}

// Crossref is the fallback for the catalogue, and the reason the backlog is
// worth resolving at all: most of the 79 studies are in Nigerian and African
// journals that Europe PMC does not index but Crossref does, so a title that
// resolves to nothing above can still resolve to a DOI, a journal, and a licence
// here. There is no full text to fetch — what this produces is a citation solid
// enough to chase through AJOL or a library.
async function searchCrossref(title, { rows = 5 } = {}) {
  const params = new URLSearchParams({
    'query.bibliographic': cleanTitle(title),
    rows: String(rows),
    select: 'DOI,title,container-title,author,issued,license,link,type'
  });
  const body = await crossrefQueue(() => getJson(`${CROSSREF_ENDPOINT}?${params}`));
  return (body.message?.items ?? []).map(fromCrossrefWork);
}

// Adapted into the Europe PMC record shape so everything downstream — scoring,
// region inference, the candidate record — stays unaware of where a record came
// from. `source: 'CROSSREF'` is what tells them apart afterwards.
function fromCrossrefWork(work) {
  const licences = (work.license ?? []).map(entry => String(entry.URL ?? ''));
  const creativeCommons = licences.find(url => /creativecommons\.org\/licenses\//.test(url));
  const terms = creativeCommons?.match(/licenses\/([a-z-]+)\//)?.[1];
  return {
    id: work.DOI,
    source: 'CROSSREF',
    doi: work.DOI ?? null,
    pmid: null,
    pmcid: null,
    title: Array.isArray(work.title) ? work.title[0] : work.title,
    authorString: (work.author ?? []).map(author => [author.family, author.given?.[0]].filter(Boolean).join(' ')).join(', ') || null,
    journalInfo: { journal: { title: (work['container-title'] ?? [])[0] ?? null } },
    pubYear: String(work.issued?.['date-parts']?.[0]?.[0] ?? '') || null,
    license: terms ? `cc ${terms}` : (licences.length ? 'licence stated, terms not recognised' : null),
    isOpenAccess: creativeCommons ? 'Y' : 'N',
    inEPMC: 'N',
    hasPDF: 'N',
    abstractText: '',
    pubTypeList: { pubType: [work.type ?? ''] }
  };
}

// ─── reading a record ─────────────────────────────────────────────────────────

// "Niger Delta" is not Niger State. It is the one collision in the state list
// that matters, because half the South-South literature says it in the first line.
const REGION_ALIASES = [{ pattern: /niger\s+delta/gi, state: 'Niger Delta', zone: 'SS' }];

function scanRegion(text) {
  let haystack = String(text ?? '');
  const states = [];
  const zones = new Set();

  for (const alias of REGION_ALIASES) {
    if (!alias.pattern.test(haystack)) continue;
    haystack = haystack.replace(alias.pattern, ' ');
    states.push(alias.state);
    zones.add(alias.zone);
  }

  for (const [state, zone] of Object.entries(NIGERIAN_STATES)) {
    // \b stops "Niger" matching inside "Nigeria": the character after "Niger"
    // there is a word character, so the boundary fails.
    if (new RegExp(`\\b${state.replace(/\s+/g, '\\s+')}\\b`, 'i').test(haystack)) {
      states.push(state);
      zones.add(zone);
    }
  }

  const languages = [];
  for (const [ethnonym, language] of Object.entries(LANGUAGE_HINTS)) {
    if (!new RegExp(`\\b${ethnonym}\\b`, 'i').test(haystack)) continue;
    if (!languages.includes(language)) languages.push(language);
    for (const zone of LANGUAGE_ZONES[language] ?? []) zones.add(zone);
  }

  return { states: states.sort(), zones: [...zones].sort(), languages_named: languages.sort() };
}

// A region in the title is what the study is about. A region in the abstract may
// only be where one interviewee came from, or a sentence of background about the
// country — so the two are distinguished here and weighed differently when
// ranking, rather than pooled into one confident-looking list.
function inferRegion(title, abstract = '') {
  const fromTitle = scanRegion(title);
  if (fromTitle.zones.length) return { ...fromTitle, evidence: 'title' };
  const fromAbstract = scanRegion(abstract);
  if (fromAbstract.zones.length) return { ...fromAbstract, evidence: 'abstract' };
  return { states: [], zones: [], languages_named: [], evidence: null };
}

function studyShape(title) {
  const value = cleanTitle(title);
  const ethno = ETHNO_PATTERN.test(value);
  const fieldStudy = PLANT_NOUN_PATTERN.test(value) && FIELD_STUDY_PATTERN.test(value);
  const healthServices = HEALTH_SERVICES_PATTERNS.some(pattern => pattern.test(value));
  const laboratory = LABORATORY_PATTERNS.some(pattern => pattern.test(value));

  // "Ethnobotanical" outranks everything: a study that calls itself that
  // publishes a species list, whatever else its title says.
  if (ethno && !healthServices) return laboratory ? 'unclear' : 'primary_survey';
  if (healthServices) return ethno || fieldStudy ? 'unclear' : 'health_services';
  if (laboratory) return 'laboratory_or_review';
  if (fieldStudy) return 'primary_survey';
  return 'unclear';
}

// Licence strings from Europe PMC are lowercase and loose ("cc by", "cc by-nc-nd").
// Only an unrestricted CC BY can be redistributed the way the included surveys are.
function redistributability(record) {
  const licence = (record.license ?? '').toLowerCase().trim();
  if (/^cc[ -]by(\s|$|[ -]?\d)/.test(licence) && !/nc|nd/.test(licence)) return 'cc_by';
  if (licence.startsWith('cc')) return 'cc_restricted';
  if (record.isOpenAccess === 'Y') return 'open_access_terms_unstated';
  return 'not_open_access';
}

function expectedLanguages(region) {
  const languages = new Set(region.languages_named);
  for (const zone of region.zones) for (const language of zoneLanguages(zone)) languages.add(language);
  return [...languages].sort();
}

// ─── ranking ──────────────────────────────────────────────────────────────────

// Read the gap rather than assert it. A language with no names at all weighs 1,
// the best-covered language weighs 0, and everything else falls between them on
// a log scale — because the distance from 5 names to 64 matters more than the
// distance from 300 to 326, and a linear weight cannot say that. Unlabelled
// legacy rows are not counted: they are not evidence that any language is covered.
function coverageWeights(vernacularNames) {
  const counts = {};
  for (const name of vernacularNames) {
    if (!name.language) continue;
    counts[name.language] = (counts[name.language] ?? 0) + 1;
  }
  const best = Math.max(0, ...Object.values(counts));
  const ceiling = Math.log(1 + best) || 1;
  return {
    counts,
    weight: language => 1 - Math.min(1, Math.log(1 + (counts[language] ?? 0)) / ceiling)
  };
}

function scoreCandidate(candidate, coverage) {
  const reasons = [];
  let score = 0;

  // How much the region signal is worth believing. A title says what a study is
  // about; an abstract may only mention a place, and a study that touches every
  // zone is national in scope rather than a survey of the scarcest one.
  const evidenceWeight = candidate.region.evidence === 'abstract' ? 0.5 : 1;
  const breadthWeight = candidate.region.zones.length > 3 ? 0.4 : 1;
  const confidence = evidenceWeight * breadthWeight;

  const principal = [...new Set(candidate.region.zones.flatMap(zone => ZONE_LANGUAGES[zone]?.principal ?? []))];
  const scarcest = principal
    .map(language => ({ language, weight: coverage.weight(language), count: coverage.counts[language] ?? 0 }))
    .sort((a, b) => b.weight - a.weight)[0];

  if (scarcest) {
    const points = Math.round(40 * scarcest.weight * confidence);
    score += points;
    const qualifier = confidence === 1
      ? ''
      : ` · discounted: region ${candidate.region.evidence === 'abstract' ? 'named only in the abstract' : 'spans the country'}`;
    reasons.push(`+${points} principal language gap (${scarcest.language}: ${scarcest.count} name(s) in the index)${qualifier}`);
  } else if (candidate.languages_expected.length) {
    // A hinted language with no zone in the map. Nothing in LANGUAGE_HINTS is
    // unmapped today, but the two lists can drift, and a language signal is
    // still a language signal when they do.
    const named = candidate.languages_expected
      .map(language => ({ language, weight: coverage.weight(language), count: coverage.counts[language] ?? 0 }))
      .sort((a, b) => b.weight - a.weight)[0];
    const points = Math.round(40 * named.weight);
    score += points;
    reasons.push(`+${points} language named in the title (${named.language}: ${named.count} name(s) in the index)`);
  } else {
    // No region signal at all. Worth a look, but it cannot be claimed to close
    // a specific gap, so it scores the middle of the range rather than the top.
    score += 10;
    reasons.push('+10 region not stated in title or abstract');
  }

  // A zone whose minority languages are entirely absent from the index is worth
  // something beyond its principal language — but a fraction of it, because the
  // table may carry nothing in those languages at all.
  const uncovered = [...new Set(candidate.region.zones.flatMap(zone => ZONE_LANGUAGES[zone]?.also ?? []))]
    .filter(language => !(coverage.counts[language] > 0));
  if (uncovered.length) {
    const points = Math.round(10 * confidence);
    score += points;
    reasons.push(`+${points} zone languages absent from the index entirely (${uncovered.join(', ')})`);
  }

  if (candidate.full_text_xml) {
    score += 20;
    reasons.push('+20 JATS full text in Europe PMC (the importer can read it)');
  } else if (candidate.open_access) {
    score += 8;
    reasons.push('+8 open access, but no Europe PMC full text (PDF extraction)');
  }

  if (candidate.redistributable === 'cc_by') {
    score += 15;
    reasons.push('+15 CC BY');
  } else if (candidate.redistributable === 'cc_restricted') {
    score += 5;
    reasons.push('+5 CC with NC/ND terms — check before committing its table');
  } else if (candidate.redistributable === 'not_open_access') {
    score -= 10;
    reasons.push('-10 not open access');
  }

  if (candidate.study_shape === 'primary_survey') {
    score += 10;
    reasons.push('+10 title reads as a primary survey');
  } else if (candidate.study_shape === 'laboratory_or_review') {
    score -= 25;
    reasons.push('-25 title reads as laboratory or review work — probably no name table');
  } else if (candidate.study_shape === 'health_services') {
    score -= 25;
    reasons.push('-25 title reads as health-services research — reports who uses herbal medicine, not which plants');
  }

  if (candidate.is_preprint) {
    // Not a source you can register: it has not been through review, and the
    // version of record may differ from the table you would extract.
    score -= 20;
    reasons.push('-20 preprint — wait for, or find, the version of record');
  }

  if (candidate.catalogue_row) {
    score += 5;
    reasons.push('+5 listed as an original study in the 2025 review catalogue');
  }

  return { score, reasons };
}

// ─── candidates ───────────────────────────────────────────────────────────────

function registeredIdentifiers(sources) {
  const identifiers = new Map();
  for (const source of sources) {
    for (const value of [source.doi, source.url]) {
      if (!value) continue;
      const key = String(value).toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      identifiers.set(key, source.id);
      const pmcid = key.match(/pmc\d+/)?.[0];
      if (pmcid) identifiers.set(pmcid, source.id);
    }
  }
  return identifiers;
}

function alreadyRegistered(record, identifiers) {
  const keys = [record.doi?.toLowerCase(), record.pmcid?.toLowerCase()].filter(Boolean);
  for (const key of keys) if (identifiers.has(key)) return identifiers.get(key);
  return null;
}

function toCandidate(record, { coverage, identifiers, catalogueRow = null, foundBy = [] }) {
  const title = cleanTitle(record.title);
  const catalogueZones = (catalogueRow?.nigerian_region_as_published ?? '')
    .split(/[,/]/)
    .map(zone => zone.trim())
    .filter(zone => ZONE_LANGUAGES[zone]);
  const region = catalogueZones.length
    // The review states the region; trust it over anything inferred, and say so.
    ? { ...inferRegion(title, record.abstractText), zones: catalogueZones, evidence: 'review_catalogue' }
    : inferRegion(title, record.abstractText);

  const pmcid = record.pmcid ?? null;
  const fullTextXml = Boolean(pmcid && record.inEPMC === 'Y' && (record.fullTextIdList?.fullTextId ?? []).includes(pmcid));

  const candidate = {
    candidate_id: stableId('candidate', title, record.doi ?? record.id ?? ''),
    title,
    authors_as_published: record.authorString ?? null,
    journal: record.journalInfo?.journal?.title ?? null,
    year: record.pubYear ?? null,
    doi: record.doi ?? null,
    pmid: record.pmid ?? null,
    pmcid,
    url: pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/` : (record.doi ? `https://doi.org/${record.doi}` : null),
    licence_as_published: record.license ?? null,
    redistributable: redistributability(record),
    open_access: record.isOpenAccess === 'Y',
    full_text_xml: fullTextXml,
    full_text_xml_url: fullTextXml ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML` : null,
    has_pdf: record.hasPDF === 'Y',
    is_preprint: record.source === 'PPR' || (record.pubTypeList?.pubType ?? []).some(type => /preprint/i.test(type)),
    region,
    languages_expected: [],
    study_shape: studyShape(title),
    catalogue_row: catalogueRow?.source_row ?? null,
    catalogue_plant_count_as_published: catalogueRow?.plant_count_as_published ?? null,
    already_registered_as: alreadyRegistered(record, identifiers),
    found_by: [...foundBy].sort(),
    // Nothing in this file feeds the build. Restating it per row because this is
    // the field someone will check when they wonder why the counts did not move.
    runtime_export_eligible: false
  };

  candidate.languages_expected = expectedLanguages(candidate.region);
  const { score, reasons } = scoreCandidate(candidate, coverage);
  candidate.priority_score = score;
  candidate.priority_reasons = reasons;
  candidate.next_action = nextAction(candidate);
  return candidate;
}

function nextAction(candidate) {
  if (candidate.already_registered_as) return `Already registered in sources.json as "${candidate.already_registered_as}".`;
  if (candidate.duplicate_of) return 'Duplicate of a higher-ranked candidate for the same study.';
  if (candidate.is_preprint) return 'Preprint. Find the published version of record before registering anything.';
  if (candidate.study_shape === 'laboratory_or_review' || candidate.study_shape === 'health_services') {
    return 'Read the abstract before acquiring: the title suggests no local-name table.';
  }
  if (candidate.full_text_xml) return `Fetch ${candidate.full_text_xml_url}, confirm the table publishes local names against botanical names, then register it in sources.json and extract it.`;
  if (candidate.open_access) return 'Open access but not in Europe PMC full text — acquire the PDF and extract with scripts/extract-nigerian-plant-sources.py.';
  return 'Not open access. Acquire through a library, or approach the authors; do not commit its table without checking reuse terms.';
}

// ─── passes ───────────────────────────────────────────────────────────────────

// One index having a bad afternoon should cost the queries it actually broke,
// not the run. Europe PMC returns a 503 often enough that a pass which aborts
// on the first one is a pass that rarely finishes.
async function runSearch(search, { pageSize }) {
  const queries = buildQueries();
  const responses = [];
  for (const query of queries) {
    try {
      const result = await search(query.query, { pageSize });
      responses.push({ ...query, hit_count: result.hitCount, results: result.results });
    } catch (error) {
      responses.push({ ...query, hit_count: 0, results: [], error: error.message });
    }
    process.stdout.write(`\r  searched ${responses.length}/${queries.length} queries`);
  }
  process.stdout.write('\n');
  if (responses.every(response => response.error)) throw new Error(`every search query failed: ${responses[0].error}`);
  return responses;
}

function bestByTitle(entry, records) {
  return records
    .map(record => ({ record, similarity: titleSimilarity(entry.title, record.title) }))
    .sort((a, b) => b.similarity - a.similarity)[0];
}

async function runCatalogue(search, catalogue, { concurrency = 4, crossref = searchCrossref } = {}) {
  const resolutions = new Array(catalogue.length);
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, catalogue.length) }, async () => {
    while (cursor < catalogue.length) {
      const index = cursor++;
      const entry = catalogue[index];
      const resolution = {
        catalogue_row: entry.source_row,
        title: cleanTitle(entry.title),
        matched: null,
        resolved_via: null,
        near_miss: null,
        attempts: []
      };

      try {
        // A near miss is kept rather than discarded. Review tables transcribe
        // titles loosely, and 0.75 against a real paper is a person's ten-second
        // check — but it is not something a script should decide on its own.
        const consider = (source, attempt, records) => {
          const best = bestByTitle(entry, records);
          resolution.attempts.push({ source, attempt, returned: records.length, best_similarity: Number((best?.similarity ?? 0).toFixed(2)) });
          if (!best) return false;
          if (best.similarity >= TITLE_MATCH_THRESHOLD) {
            resolution.matched = best.record;
            resolution.resolved_via = source;
            return true;
          }
          if (best.similarity >= NEAR_MISS_THRESHOLD && best.similarity > (resolution.near_miss?.similarity ?? 0)) {
            resolution.near_miss = {
              source,
              similarity: Number(best.similarity.toFixed(2)),
              title: cleanTitle(best.record.title),
              doi: best.record.doi ?? null,
              pmcid: best.record.pmcid ?? null
            };
          }
          return false;
        };

        for (const { attempt, query } of catalogueQueries(entry)) {
          const { results } = await search(query, { pageSize: 10 });
          if (consider('europepmc', attempt, results)) break;
        }

        if (!resolution.matched && crossref) {
          consider('crossref', 'bibliographic', await crossref(entry.title));
        }
      } catch (error) {
        // Same reason as the search pass: a title that could not be looked up is
        // a title to retry, not a reason to discard 78 resolutions.
        resolution.error = error.message;
      }

      resolutions[index] = resolution;
      done += 1;
      process.stdout.write(`\r  resolved ${done}/${catalogue.length} catalogue titles`);
    }
  });
  await Promise.all(workers);
  process.stdout.write('\n');
  return resolutions;
}

// ─── assembly ─────────────────────────────────────────────────────────────────

function assemble({ searchResponses, catalogueResolutions, sources, vernacularNames, catalogue }) {
  const coverage = coverageWeights(vernacularNames);
  const identifiers = registeredIdentifiers(sources);
  const catalogueByRow = new Map(catalogue.map(entry => [entry.source_row, entry]));

  // One record can surface from several queries; keep the record once and
  // remember every query that found it, which is how a query earns its place.
  const records = new Map();
  const note = (record, foundBy, catalogueRow) => {
    const key = record.doi?.toLowerCase() ?? record.pmcid ?? record.id ?? cleanTitle(record.title).toLowerCase();
    const existing = records.get(key);
    if (existing) {
      existing.foundBy.add(foundBy);
      existing.catalogueRow ??= catalogueRow;
      return;
    }
    records.set(key, { record, foundBy: new Set([foundBy]), catalogueRow });
  };

  for (const response of searchResponses) for (const record of response.results) note(record, response.id, null);
  for (const resolution of catalogueResolutions) {
    if (resolution.matched) note(resolution.matched, 'review-catalogue', catalogueByRow.get(resolution.catalogue_row) ?? null);
  }

  const candidates = [...records.values()]
    .map(({ record, foundBy, catalogueRow }) => toCandidate(record, { coverage, identifiers, catalogueRow, foundBy: [...foundBy] }))
    .sort((a, b) => b.priority_score - a.priority_score || a.title.localeCompare(b.title));

  // A preprint and its published version carry different identifiers, so they
  // survive the identifier de-duplication above and arrive here as two rows for
  // one study. Mark the lower-ranked one rather than dropping it: which version
  // to acquire is a judgement, and the row is the evidence for making it.
  const kept = [];
  for (const candidate of candidates) {
    const twin = kept.find(other => titleSimilarity(other.title, candidate.title) >= 0.9);
    if (twin) {
      candidate.duplicate_of = twin.candidate_id;
      candidate.next_action = nextAction(candidate);
    } else {
      candidate.duplicate_of = null;
      kept.push(candidate);
    }
  }

  const unresolved = catalogueResolutions
    .filter(resolution => !resolution.matched)
    .map(({ catalogue_row, title, attempts, near_miss, error }) => ({
      catalogue_row,
      title,
      near_miss: near_miss ?? null,
      lookup_error: error ?? null,
      attempts,
      // Neither index knows this title. That is a finding, not a dead end: it
      // means the study is in a journal outside both, and has to be chased
      // through AJOL, the publisher, or the authors.
      next_action: error
        ? 'The lookup itself failed — re-run the catalogue pass before concluding anything about this title.'
        : near_miss
          ? `Near miss at ${near_miss.similarity} similarity (${near_miss.doi ?? near_miss.pmcid}) — check whether it is the same study.`
          : 'Not in Europe PMC or Crossref under this title — search AJOL and Google Scholar, or check the title as the review printed it.'
    }));

  const newCandidates = candidates.filter(candidate => !candidate.already_registered_as && !candidate.duplicate_of);
  const byZone = {};
  for (const candidate of newCandidates) {
    for (const zone of candidate.region.zones.length ? candidate.region.zones : ['unstated']) {
      byZone[zone] = (byZone[zone] ?? 0) + 1;
    }
  }

  return {
    source_id: SOURCE_ID,
    // Said once at the top as well as per row: this file is a shopping list, not data.
    runtime_export_eligible: false,
    generated_at: new Date().toISOString().slice(0, 10),
    index_language_counts: coverage.counts,
    queries: searchResponses.map(({ id, zone, query, hit_count, results, error }) => ({
      id, zone: zone ?? null, query, hit_count, returned: results.length, error: error ?? null
    })),
    summary: {
      records_seen: candidates.length,
      already_registered: candidates.filter(candidate => candidate.already_registered_as).length,
      duplicates: candidates.filter(candidate => candidate.duplicate_of).length,
      new_candidates: newCandidates.length,
      preprints: newCandidates.filter(candidate => candidate.is_preprint).length,
      primary_surveys: newCandidates.filter(candidate => candidate.study_shape === 'primary_survey').length,
      cc_by_with_full_text: newCandidates.filter(candidate => candidate.redistributable === 'cc_by' && candidate.full_text_xml).length,
      catalogue_titles: catalogueResolutions.length,
      catalogue_resolved: catalogueResolutions.length - unresolved.length,
      // Separated from the genuinely unfound: a lookup that errored says
      // nothing about whether the study exists.
      catalogue_lookup_errors: catalogueResolutions.filter(resolution => resolution.error).length,
      search_query_failures: searchResponses.filter(response => response.error).length,
      catalogue_resolved_via: {
        europepmc: catalogueResolutions.filter(resolution => resolution.resolved_via === 'europepmc').length,
        crossref: catalogueResolutions.filter(resolution => resolution.resolved_via === 'crossref').length
      },
      new_candidates_by_zone: byZone
    },
    catalogue_unresolved: unresolved,
    candidates
  };
}

function report(output, { limit = 15, written = null } = {}) {
  const { summary } = output;
  console.log(`\n${summary.new_candidates} new candidate(s), ${summary.already_registered} already registered, ${summary.duplicates} duplicate row(s).`);
  if (summary.catalogue_titles) {
    const via = summary.catalogue_resolved_via;
    console.log(`Catalogue: ${summary.catalogue_resolved}/${summary.catalogue_titles} titles resolved (${via.europepmc} Europe PMC, ${via.crossref} Crossref).`);
    if (summary.catalogue_lookup_errors) console.log(`  ${summary.catalogue_lookup_errors} title(s) could not be looked up at all — re-run the catalogue pass.`);
  }
  console.log(`Redistributable with machine-readable full text: ${summary.cc_by_with_full_text}`);
  if (summary.search_query_failures) console.log(`${summary.search_query_failures} search query/queries failed — the candidate list is incomplete.`);
  console.log('');
  console.log(`By zone: ${Object.entries(summary.new_candidates_by_zone).sort((a, b) => b[1] - a[1]).map(([zone, count]) => `${zone} ${count}`).join(', ') || 'none'}\n`);

  const top = output.candidates.filter(candidate => !candidate.already_registered_as && !candidate.duplicate_of).slice(0, limit);
  for (const candidate of top) {
    const zones = candidate.region.zones.join('/') || '??';
    const languages = candidate.languages_expected.join(',') || '—';
    console.log(`  ${String(candidate.priority_score).padStart(3)}  [${zones}] ${candidate.title.slice(0, 76)}`);
    console.log(`       ${candidate.pmcid ?? candidate.doi ?? 'no identifier'} · ${candidate.licence_as_published ?? 'licence unstated'} · expects ${languages}${candidate.full_text_xml ? ' · JATS' : ''}`);
  }
  const nearMisses = output.catalogue_unresolved.filter(row => row.near_miss);
  if (nearMisses.length) {
    console.log(`\n${nearMisses.length} unresolved catalogue title(s) have a near miss worth eyeballing:`);
    for (const row of nearMisses.slice(0, 5)) {
      console.log(`  row ${row.catalogue_row} @ ${row.near_miss.similarity}  ${row.near_miss.doi ?? row.near_miss.pmcid}  ${row.near_miss.title.slice(0, 66)}`);
    }
  }
  console.log(written ? `\nWritten to ${path.relative(process.cwd(), written)}` : '\nNothing written.');
  console.log('Nothing here is ingested. Register a source in sources.json and extract its table to change the index.\n');
}

// ─── entry point ──────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2)) {
  const replayFile = flag(argv, 'from');
  const rawFile = flag(argv, 'save-raw');
  const pageSize = Number(flag(argv, 'limit', 100));
  const searchOnly = argv.includes('--search-only');
  const catalogueOnly = argv.includes('--catalogue-only');
  const dryRun = argv.includes('--dry-run');

  const sources = readJson(plantsDirectory, 'sources.json');
  const vernacularNames = readJson(plantsDirectory, 'vernacular_names.json');
  const catalogue = readJson(cataloguePath).original_study_catalogue;

  let searchResponses = [];
  let catalogueResolutions = [];

  if (replayFile) {
    // Replay makes a rerun reproducible and a test offline: the ranking is the
    // part worth re-running, and it should not need the network to be checked.
    const raw = JSON.parse(fs.readFileSync(path.resolve(replayFile), 'utf8'));
    searchResponses = raw.search_responses ?? [];
    catalogueResolutions = raw.catalogue_resolutions ?? [];
    console.log(`Replaying ${searchResponses.length} search response(s) and ${catalogueResolutions.length} catalogue resolution(s) from ${replayFile}`);
  } else {
    if (!catalogueOnly) {
      console.log('Searching Europe PMC…');
      searchResponses = await runSearch(searchEuropePmc, { pageSize });
    }
    if (!searchOnly) {
      const crossref = argv.includes('--no-crossref') ? null : searchCrossref;
      console.log(`Resolving ${catalogue.length} catalogue titles…${crossref ? ' (Europe PMC, then Crossref)' : ''}`);
      catalogueResolutions = await runCatalogue(searchEuropePmc, catalogue, { crossref });
    }
    if (rawFile) {
      writeJson(path.resolve(rawFile), { search_responses: searchResponses, catalogue_resolutions: catalogueResolutions });
      console.log(`Raw responses saved to ${rawFile}`);
    }
  }

  const output = assemble({ searchResponses, catalogueResolutions, sources, vernacularNames, catalogue });
  if (dryRun) {
    report(output, { limit: 10 });
    return output;
  }
  writeJson(outputPath, output);
  report(output, { written: outputPath });
  return output;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  NIGERIAN_STATES,
  fromCrossrefWork,
  ZONE_LANGUAGES,
  LANGUAGE_HINTS,
  assemble,
  buildQueries,
  catalogueQueries,
  coverageWeights,
  inferRegion,
  redistributability,
  scanRegion,
  scoreCandidate,
  studyShape,
  titleSimilarity,
  toCandidate,
  main
};

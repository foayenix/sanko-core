#!/usr/bin/env node
// Candidate local names for taxa already in the index, from Wikidata.
//
//   node scripts/import-wikidata-vernaculars.js              # fetch and stage candidates
//   node scripts/import-wikidata-vernaculars.js --queue      # also seed the review queue
//   node scripts/import-wikidata-vernaculars.js --save-raw raw.json
//   node scripts/import-wikidata-vernaculars.js --from raw.json
//
// Wikidata carries Yoruba, Hausa, Igbo, Nigerian Pidgin and Fulfulde labels on
// taxon items, under CC0. For the languages this index is thinnest in — Igbo at
// single digits, Hausa in the dozens — it is the only machine-readable source
// of local names that can be redistributed at all.
//
// It is also crowd-sourced, unsourced, and noisy. Roughly half the labels
// returned in an African language are the Latin binomial or an English common
// name pasted into the wrong language field, and the rest have no locality, no
// collector, and no citation. So nothing here is a mapping. Everything this
// writes is a *candidate*: a name worth putting in front of a reviewer who
// speaks the language, whose confirmation — not Wikidata's label — becomes the
// evidence of record.
//
// ── how it reaches the index ──
// It does not, on its own. With --queue, new candidates are seeded into the
// gitignored review queue at data/plants/review_queue.json alongside the names
// Sanko heard in real conversations and could not place. A reviewer confirms or
// rejects them there, and `npm run plants:promote` writes the confirmed ones —
// attributed to the reviewer, marked with the candidate source they came from —
// into practitioner_confirmations.json. Candidates are seeded with an occurrence
// count of zero, so they sort below every name a practitioner actually used: a
// reviewer's time belongs to the queue that came from the field first.
//
// ── what it is also good for ──
// Two of the three statuses are not additions at all. `agrees_with_index` is
// independent corroboration of a mapping that may have none — 152 of the runtime
// rows are legacy rows with no recorded provenance. `conflicts_with_index` is
// the more valuable one: a name this index resolves one way and Wikidata
// resolves another is exactly the kind of error no amount of internal checking
// finds.

const fs = require('fs');
const path = require('path');

const { normalizeLocalName } = require('./build-plant-data');

const root = path.join(__dirname, '..');
const plantsDirectory = path.join(root, 'data', 'plants');
const runtimePath = path.join(root, 'data', 'plant_lookup_v1.json');
const queuePath = path.join(plantsDirectory, 'review_queue.json');
const outputPath = path.join(plantsDirectory, 'surveys', 'discovery', 'wikidata-vernacular-candidates.json');

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'sanko-plant-data/1.0 (+https://www.sanko.africa)';
const SOURCE_ID = 'wikidata-vernacular-candidates';

// Nigerian languages, plus English. English is fetched only so it can be used
// to throw labels away: an English common name filed under an Igbo label is the
// single most common kind of noise in this data.
const LANGUAGES = ['yo', 'ha', 'ig', 'pcm', 'ff', 'efi', 'ibb', 'tiv', 'kr', 'bin', 'nup', 'idu', 'igl', 'urh', 'ijc'];
const FILTER_LANGUAGE = 'en';

// WDQS is a shared public endpoint with a one-minute query timeout. Chunks are
// small enough to stay well inside it and spaced enough to stay welcome.
const CHUNK_SIZE = 120;
const CHUNK_PAUSE_MS = 1000;

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

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

// ─── the query ────────────────────────────────────────────────────────────────

// Matched on P225 (taxon name) rather than by label, because the accepted
// botanical names in plants.json are GBIF-checked strings and P225 is the same
// kind of string. A label match would happily return the disambiguation page.
function sparqlFor(taxonNames) {
  const values = taxonNames.map(name => `"${name.replace(/["\\]/g, '')}"`).join(' ');
  const languages = [...LANGUAGES, FILTER_LANGUAGE].map(language => `"${language}"`).join(', ');
  return `SELECT ?item ?taxonName ?label ?labelLang WHERE {
  VALUES ?taxonName { ${values} }
  ?item wdt:P225 ?taxonName .
  { ?item rdfs:label ?label } UNION { ?item skos:altLabel ?label }
  BIND(LANG(?label) AS ?labelLang)
  FILTER(?labelLang IN (${languages}))
}`;
}

async function runSparql(query) {
  const response = await fetch(SPARQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/sparql-results+json',
      'content-type': 'application/sparql-query'
    },
    body: query
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: Wikidata Query Service`);
  const body = await response.json();
  return (body.results?.bindings ?? []).map(binding => ({
    item: binding.item.value.replace('http://www.wikidata.org/entity/', ''),
    taxon_name: binding.taxonName.value,
    label: binding.label.value,
    language: binding.labelLang.value
  }));
}

// ─── the filter that makes this usable ────────────────────────────────────────

function stripAuthority(botanicalAsPublished) {
  return String(botanicalAsPublished ?? '')
    .split(/\s*\(Synonym:/i)[0]
    .match(/^([A-Z][A-Za-z-]+(?:\s+[a-z][A-Za-z-]+)?)/)?.[1] ?? '';
}

// Everything a label could be echoing instead of naming: the taxon, its genus,
// its epithet, any spelling the sources published, and every English label the
// item carries.
function echoesFor(plant, englishLabels) {
  const botanical = plant.accepted_botanical;
  const [genus, epithet] = botanical.split(/\s+/);
  return new Set(
    [
      botanical,
      genus,
      epithet,
      ...(plant.botanical_names_as_published ?? []).map(stripAuthority),
      ...(plant.common_english ?? []),
      ...englishLabels
    ]
      .filter(Boolean)
      .map(normalizeLocalName)
  );
}

function isUsableCandidate(label, plant, echoes) {
  const normalized = normalizeLocalName(label);
  if (normalized.length < 2) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (echoes.has(normalized)) return false;
  // "Cocos nucifera var. typica" under an Igbo label: still Latin, still not a
  // local name. Anything beginning with the genus is treated as the binomial.
  if (normalized.startsWith(`${normalizeLocalName(plant.accepted_botanical.split(/\s+/)[0])} `)) return false;
  return true;
}

// ─── candidates ───────────────────────────────────────────────────────────────

function indexStatus(normalizedName, acceptedBotanical, runtimeByName) {
  const row = runtimeByName.get(normalizedName);
  if (!row) return 'new';
  if (!row.botanical) return 'ambiguous_in_index';
  return row.botanical === acceptedBotanical ? 'agrees_with_index' : 'conflicts_with_index';
}

function buildCandidates(bindings, { plants, runtime, vernacularNames = [], retrievedAt }) {
  const plantByBotanical = new Map(plants.map(plant => [plant.accepted_botanical, plant]));
  const runtimeByName = new Map(runtime.map(row => [row.local_name, row]));

  // What the index already believes about a name it agrees on. A Wikidata label
  // agreeing with a taxonomy-checked survey row is a shrug; one agreeing with a
  // legacy row that has no citation at all is the first outside evidence that
  // row has ever had.
  const statusesByName = new Map();
  for (const name of vernacularNames) {
    const statuses = statusesByName.get(name.normalized_name) ?? new Set();
    statuses.add(name.verification_status);
    statusesByName.set(name.normalized_name, statuses);
  }

  // English labels are pooled per taxon, not per item: the same taxon name can
  // carry more than one item, and a label can only be recognised as an English
  // echo once every English label for that taxon is known.
  const englishByTaxon = new Map();
  for (const binding of bindings) {
    if (binding.language !== FILTER_LANGUAGE) continue;
    const labels = englishByTaxon.get(binding.taxon_name) ?? [];
    labels.push(binding.label);
    englishByTaxon.set(binding.taxon_name, labels);
  }

  const candidates = new Map();
  const rejected = { echo_of_botanical_or_english: 0, unknown_taxon: 0, duplicate: 0 };

  for (const binding of bindings) {
    if (binding.language === FILTER_LANGUAGE) continue;
    const plant = plantByBotanical.get(binding.taxon_name);
    if (!plant) {
      rejected.unknown_taxon += 1;
      continue;
    }

    const echoes = echoesFor(plant, englishByTaxon.get(binding.taxon_name) ?? []);
    if (!isUsableCandidate(binding.label, plant, echoes)) {
      rejected.echo_of_botanical_or_english += 1;
      continue;
    }

    const normalized = normalizeLocalName(binding.label);
    const key = `${normalized}|${binding.language}|${plant.accepted_botanical}`;
    if (candidates.has(key)) {
      rejected.duplicate += 1;
      continue;
    }

    const status = indexStatus(normalized, plant.accepted_botanical, runtimeByName);
    candidates.set(key, {
      local_name: binding.label,
      normalized_name: normalized,
      language: binding.language,
      accepted_botanical: plant.accepted_botanical,
      plant_id: plant.id,
      common_english: plant.common_english?.[0] ?? null,
      index_status: status,
      // The runtime lookup matches normalized names exactly, and normalisation
      // folds diacritics by decomposing them — which works for ẹ, ọ, ụ, ị and
      // does nothing for ɓ, ɗ, ƴ, ŋ, because those are distinct letters with no
      // decomposition. So a Fulfulde name like "Ɓowre" will only ever match a
      // practitioner who types the hook letter. Flagged rather than folded here:
      // changing the shared normaliser would rewrite the committed runtime index.
      ascii_after_normalisation: /^[a-z0-9 ]+$/.test(normalized),
      corroborates: status === 'agrees_with_index' ? [...(statusesByName.get(normalized) ?? [])].sort() : [],
      source: {
        source_id: SOURCE_ID,
        wikidata_item: binding.item,
        url: `https://www.wikidata.org/wiki/${binding.item}`,
        taxon_name_matched: binding.taxon_name,
        licence: 'CC0-1.0',
        retrieved_at: retrievedAt
      },
      // Said per row because it is the thing most likely to be assumed away:
      // a crowd-sourced label is not a mapping, whatever else this file says.
      verification_status: 'unverified_candidate',
      export_eligible: false
    });
  }

  return {
    candidates: [...candidates.values()].sort((a, b) =>
      a.language.localeCompare(b.language) ||
      a.normalized_name.localeCompare(b.normalized_name) ||
      a.accepted_botanical.localeCompare(b.accepted_botanical)
    ),
    rejected
  };
}

function summarise(candidates, rejected) {
  const byLanguage = {};
  const byStatus = {};
  for (const candidate of candidates) {
    byLanguage[candidate.language] = (byLanguage[candidate.language] ?? 0) + 1;
    byStatus[candidate.index_status] = (byStatus[candidate.index_status] ?? 0) + 1;
  }
  return {
    candidates: candidates.length,
    by_language: byLanguage,
    by_index_status: byStatus,
    // Counted separately because it is the only number here that improves a
    // mapping the index already has rather than proposing a new one.
    corroborates_legacy_unverified: candidates.filter(candidate => candidate.corroborates?.includes('legacy_unverified')).length,
    // Names that will not match an ASCII spelling of themselves. See
    // ascii_after_normalisation on the rows.
    non_ascii_after_normalisation: candidates.filter(candidate => candidate.ascii_after_normalisation === false).length,
    rejected_labels: rejected
  };
}

// ─── seeding the review queue ─────────────────────────────────────────────────

// Shaped exactly like an entry built from live unknown-plant events, with two
// differences a reviewer and the promote step can both see: occurrences is zero,
// and candidate_source records where the suggestion came from. The botanical
// name is pre-filled because a suggestion that makes the reviewer look it up
// again has saved nobody anything — it still has to be confirmed to count.
function toQueueEntry(candidate) {
  return {
    normalized_name: candidate.normalized_name,
    spellings: [candidate.local_name],
    languages: [candidate.language],
    occurrences: 0,
    first_seen: null,
    last_seen: null,
    contexts: [],
    decision: 'pending',
    botanical_as_published: candidate.accepted_botanical,
    common_english: candidate.common_english,
    notes: `Candidate from Wikidata ${candidate.source.wikidata_item} (${candidate.source.url}), CC0, unverified. Confirm only if you know this name in ${candidate.language}.`,
    candidate_source: {
      source_id: candidate.source.source_id,
      reference: candidate.source.wikidata_item,
      url: candidate.source.url,
      licence: candidate.source.licence,
      retrieved_at: candidate.source.retrieved_at
    }
  };
}

// Never overwrite: a name already in the queue has either been seen in a real
// conversation or already been judged, and both outrank a suggestion.
function seedQueue(existing, candidates) {
  const present = new Set(existing.map(entry => entry.normalized_name));
  const additions = candidates
    .filter(candidate => candidate.index_status === 'new' && !present.has(candidate.normalized_name))
    .filter(candidate => {
      if (present.has(candidate.normalized_name)) return false;
      present.add(candidate.normalized_name);
      return true;
    })
    .map(toQueueEntry);

  const queue = [...existing, ...additions];
  queue.sort((a, b) => b.occurrences - a.occurrences || a.normalized_name.localeCompare(b.normalized_name));
  return { queue, additions };
}

// ─── entry point ──────────────────────────────────────────────────────────────

async function fetchBindings(taxonNames, { sparql = runSparql, pause = CHUNK_PAUSE_MS } = {}) {
  const chunks = chunk(taxonNames, CHUNK_SIZE);
  const bindings = [];
  for (const [index, names] of chunks.entries()) {
    bindings.push(...await sparql(sparqlFor(names)));
    process.stdout.write(`\r  queried ${index + 1}/${chunks.length} chunk(s), ${bindings.length} label(s)`);
    if (index < chunks.length - 1 && pause) await new Promise(resolve => setTimeout(resolve, pause));
  }
  process.stdout.write('\n');
  return bindings;
}

async function main(argv = process.argv.slice(2)) {
  const replayFile = flag(argv, 'from');
  const rawFile = flag(argv, 'save-raw');
  const dryRun = argv.includes('--dry-run');
  const toQueue = argv.includes('--queue');

  const plants = readJson(plantsDirectory, 'plants.json');
  const runtime = readJson(runtimePath);
  const taxonNames = [...new Set(plants.map(plant => plant.accepted_botanical))].sort();

  let bindings;
  let retrievedAt;
  if (replayFile) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(replayFile), 'utf8'));
    bindings = raw.bindings ?? [];
    retrievedAt = raw.retrieved_at ?? new Date().toISOString().slice(0, 10);
    console.log(`Replaying ${bindings.length} label(s) from ${replayFile}`);
  } else {
    console.log(`Querying Wikidata for ${taxonNames.length} taxa in ${LANGUAGES.length} languages…`);
    retrievedAt = new Date().toISOString().slice(0, 10);
    bindings = await fetchBindings(taxonNames);
    if (rawFile) {
      writeJson(path.resolve(rawFile), { retrieved_at: retrievedAt, bindings });
      console.log(`Raw labels saved to ${rawFile}`);
    }
  }

  const vernacularNames = readJson(plantsDirectory, 'vernacular_names.json');
  const { candidates, rejected } = buildCandidates(bindings, { plants, runtime, vernacularNames, retrievedAt });
  const summary = summarise(candidates, rejected);

  const output = {
    source_id: SOURCE_ID,
    // Discovery tier, like the review catalogue: no vernacular rows, no runtime
    // mappings, no taxonomy. The build does not read this file.
    runtime_export_eligible: false,
    generated_at: retrievedAt,
    licence: 'CC0-1.0 (Wikidata)',
    taxa_queried: taxonNames.length,
    languages_queried: LANGUAGES,
    summary,
    candidates
  };

  console.log(`\n${summary.candidates} candidate name(s) from ${taxonNames.length} taxa.`);
  console.log(`  by language: ${Object.entries(summary.by_language).sort((a, b) => b[1] - a[1]).map(([language, count]) => `${language} ${count}`).join(', ') || 'none'}`);
  console.log(`  against the index: ${Object.entries(summary.by_index_status).map(([status, count]) => `${count} ${status}`).join(', ') || 'none'}`);
  console.log(`  discarded: ${rejected.echo_of_botanical_or_english} label(s) that were the botanical or English name in a local-language field`);
  console.log(`  of the agreements, ${summary.corroborates_legacy_unverified} corroborate a legacy row that had no provenance at all`);
  if (summary.non_ascii_after_normalisation) {
    console.log(`  ${summary.non_ascii_after_normalisation} name(s) keep a hook letter (ɓ ɗ ƴ ŋ) after normalisation — they will not match an ASCII spelling\n`);
  } else {
    console.log('');
  }

  const conflicts = candidates.filter(candidate => candidate.index_status === 'conflicts_with_index');
  if (conflicts.length) {
    console.log('Disagreements with the runtime index — worth a look before anything else:');
    for (const candidate of conflicts.slice(0, 10)) {
      const indexed = runtime.find(row => row.local_name === candidate.normalized_name);
      console.log(`  "${candidate.local_name}" [${candidate.language}]  index: ${indexed.botanical}  ·  Wikidata: ${candidate.accepted_botanical}`);
    }
    console.log('');
  }

  if (dryRun) {
    console.log('--dry-run: nothing written.\n');
    return output;
  }

  writeJson(outputPath, output);
  console.log(`Written to ${path.relative(process.cwd(), outputPath)}`);

  if (toQueue) {
    const existing = fs.existsSync(queuePath) ? readJson(queuePath) : [];
    const { queue, additions } = seedQueue(existing, candidates);
    writeJson(queuePath, queue);
    console.log(`Seeded ${additions.length} candidate(s) into ${path.relative(process.cwd(), queuePath)} (gitignored), below the ${existing.length} name(s) already queued.`);
    console.log('Review them there, then: node scripts/plant-review.js promote --reviewer PR-7F2A');
  } else {
    console.log('Nothing was queued. Re-run with --queue to put the new candidates in front of a reviewer.');
  }
  console.log('');
  return output;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  LANGUAGES,
  buildCandidates,
  echoesFor,
  indexStatus,
  isUsableCandidate,
  seedQueue,
  sparqlFor,
  stripAuthority,
  summarise,
  toQueueEntry,
  main
};

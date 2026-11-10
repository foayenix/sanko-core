#!/usr/bin/env node
// Curated corrections for published botanical names the automatic matcher
// cannot place.
//
//   node scripts/resolve-name-corrections.js            # propose, write, merge
//   node scripts/resolve-name-corrections.js --dry-run  # propose and print only
//
// scripts/fetch-gbif-taxonomy.js matches the botanical name exactly as the
// source printed it, and exports a mapping only on an exact species match at 90
// confidence or better. That is the right default — it is what stops the index
// inventing a species — and it leaves behind every row whose published name
// carries a typo, a gender disagreement, an authority string the matcher chokes
// on, or two names crammed into one cell. Sixty-one vernacular rows were
// withheld on those grounds, each of them a local name with a source, a locality
// and a language, held back by a spelling.
//
// ── the rule this script follows ──
// A correction is applied only when GBIF names a single accepted species for the
// corrected form. Every spelling change comes from GBIF's own suggestion, never
// from this script guessing at what an author meant, and every correction
// records the query that produced it.
//
// Where GBIF's alternatives disagree about the accepted name, nothing is
// applied. The name is written to the corrections file as deferred, with the
// competing candidates, and its rows stay withheld. Acacia albida is the example
// worth reading: GBIF offers Faidherbia albida, Vachellia tortuosa, and a
// doubtful Acacia albida at almost equal confidence. A script that picked one
// would be inventing a species; a botanist can decide.
//
// ── what this does not change ──
// The published spelling. Survey rows and vernacular records keep
// botanical_as_published exactly as printed; the correction only decides which
// taxon that published name refers to, and says so in the taxonomy cache. Nor
// does it change the export policy: a corrected name still has to reach an
// accepted species at 90 or better to be exported.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const plantsDirectory = path.join(root, 'data', 'plants');
const taxonomyPath = path.join(plantsDirectory, 'taxonomy', 'gbif-primary.json');
const correctionsPath = path.join(plantsDirectory, 'name_corrections.json');

const USER_AGENT = 'sanko-plant-data/1.0 (+https://www.sanko.africa)';
const MINIMUM_CONFIDENCE = 90;

// GBIF's own fuzzy matcher will suggest a spelling; this script will not. The
// floor is low because a one-letter genus fix such as Erythrophloem →
// Erythrophleum scores poorly, and it is safe only because a suggestion is
// accepted solely when it is the single species GBIF offers.
const MINIMUM_FUZZY_CONFIDENCE = 70;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function getJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url.split('?')[0]}`);
  return response.json();
}

// ─── GBIF ─────────────────────────────────────────────────────────────────────

// The v2 matcher, on the same terms fetch-gbif-taxonomy.js uses, so a correction
// is judged by the rule it has to satisfy to be exported.
async function matchSpecies(name) {
  const params = new URLSearchParams({ scientificName: name, rank: 'SPECIES' });
  const body = await getJson(`https://api.gbif.org/v2/species/match?${params}`);
  const usage = body.usage ?? {};
  const diagnostics = body.diagnostics ?? {};
  const accepted = body.acceptedUsage ?? usage;
  return {
    query: name,
    match_type: diagnostics.matchType ?? null,
    confidence: diagnostics.confidence ?? null,
    taxonomic_status: usage.status ?? null,
    matched_canonical: usage.canonicalName ?? null,
    accepted_botanical: accepted.canonicalName ?? null,
    usage_key: usage.key ?? null,
    accepted_usage_key: accepted.key ?? usage.key ?? null,
    issues: diagnostics.issues ?? [],
    eligible:
      diagnostics.matchType === 'EXACT' &&
      (diagnostics.confidence ?? 0) >= MINIMUM_CONFIDENCE &&
      usage.rank === 'SPECIES' &&
      ['ACCEPTED', 'SYNONYM'].includes(usage.status) &&
      Boolean(accepted.canonicalName)
  };
}

// v1 verbose, which is the only endpoint that returns the alternatives a name
// is ambiguous between. That list is the evidence for deferring.
async function alternativesFor(name) {
  const params = new URLSearchParams({ name, verbose: 'true' });
  const body = await getJson(`https://api.gbif.org/v1/species/match?${params}`);
  const rows = [
    ...(body.matchType && body.matchType !== 'NONE' ? [body] : []),
    ...(body.alternatives ?? [])
  ];
  return rows
    .filter(row => row.rank === 'SPECIES' && row.status !== 'DOUBTFUL')
    // Kingdom, because a backbone search on a plant name will cheerfully return
    // an animal: "Acacia albida" turns up the cockle Monodacna albida.
    .filter(row => row.kingdom === 'Plantae')
    .map(row => ({
      canonical: row.canonicalName ?? null,
      accepted: row.species ?? row.canonicalName ?? null,
      match_type: row.matchType,
      confidence: row.confidence ?? 0,
      status: row.status ?? null,
      family: row.family ?? null
    }))
    .filter(row => row.accepted && row.canonical);
}

// ─── candidate queries ────────────────────────────────────────────────────────

const words = value => value.split(/\s+/).filter(Boolean);
const genusOf = value => words(String(value ?? ''))[0] ?? '';
const epithetOf = value => (words(String(value ?? ''))[1] ?? '').toLowerCase();

// Mechanical rewrites of the published string, plus GBIF's variant suggestion.
// None of them changes a letter of a word on this script's own authority.
function candidateQueries(published, variantSuggestion) {
  const proposals = [];
  const add = (query, rule) => {
    const value = String(query ?? '').replace(/\s+/g, ' ').trim();
    if (value && !proposals.some(p => p.query === value)) proposals.push({ query: value, rule });
  };

  // A second binomial in the same cell is the authors naming the accepted name
  // themselves — "Ficus capensis Thunb. Ficus sur Forssk.)" — and their word on
  // their own row outranks a backbone guess.
  const withoutBrackets = published.replace(/\([^)]*\)?/g, ' ');
  const binomials = withoutBrackets.match(/\b[A-Z][a-z]+ [a-z][a-z-]{2,}\b/g) ?? [];
  if (binomials.length > 1) add(binomials[1], 'second_name_in_cell');

  if (variantSuggestion) add(variantSuggestion, 'gbif_variant_suggestion');

  // Keeping the first two words drops the authority, and with it any
  // infraspecific epithet: "Urena lobata L. var. glauca (Blume) Borss. Waalk."
  // becomes "Urena lobata", which is the species the runtime index maps to.
  const parts = words(withoutBrackets);
  if (parts.length >= 2) {
    add(`${parts[0]} ${parts[1]}`, 'authority_removed');
    if (/^[A-Z]/.test(parts[1])) add(`${parts[0]} ${parts[1].toLowerCase()}`, 'capitalised_epithet_lowercased');
  }
  return proposals;
}

// ─── the decision ─────────────────────────────────────────────────────────────

// How far a suggested spelling may sit from the published one. Two letters
// covers madagascariens → madagascariensis and occidentalis → occidentale;
// beyond that GBIF is offering a different plant, not a correction.
const MAXIMUM_SPELLING_DISTANCE = 3;

function editDistance(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function publishedBinomial(published) {
  const parts = words(published.replace(/\([^)]*\)?/g, ' '));
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0] ?? '';
}

// One accepted species, or nothing.
//
// The three rules below are ordered by how much they assume, and each is a
// statement about what GBIF returned rather than about what the plant is:
//
//   1. GBIF names exactly one accepted species. Nothing to choose.
//   2. Exactly one candidate keeps the epithet of the name that matched —
//      Acacia sieberiana → Vachellia sieberiana, a genus recombination, next to
//      three Australian Acacia species that share nothing but the genus.
//   3. Exactly one candidate keeps the published genus and no other candidate
//      keeps the genus or the epithet — Luffa cylindrica → Luffa aegyptiaca,
//      where the competing answer is a melon.
//
// Anything else is contested and is deferred. The first filter is what makes
// the rest safe: an alternative whose own name is nowhere near the published
// one is dropped before any of this, which is what separates Faidherbia albida
// from the mollusc and the orchid that also carry the epithet albida.
function disambiguate(published, alternatives) {
  const binomial = publishedBinomial(published);

  // An EXACT alternative means GBIF holds this very name string and the
  // ambiguity is homonymy — two authors, one name, two accepted species. A
  // FUZZY alternative is a different name that merely looks similar, so it is
  // considered only when the published spelling exists nowhere in the backbone,
  // and then only if it is close enough to be a misspelling rather than a
  // neighbour: Harungana madagascariens → madagascariensis, not montana.
  const exact = alternatives.filter(row => row.match_type === 'EXACT');
  const fuzzy = alternatives.filter(row => row.match_type !== 'EXACT' && editDistance(row.canonical, binomial) <= MAXIMUM_SPELLING_DISTANCE);
  const considered = exact.length ? exact : fuzzy;
  const accepted = [...new Set(considered.map(row => row.accepted))];

  if (accepted.length === 0) {
    return { chosen: null, candidates: [...new Set(alternatives.map(row => row.accepted))] };
  }
  if (accepted.length === 1) return { chosen: accepted[0], candidates: accepted, rule: 'gbif_single_species' };

  // The epithet of the name that matched, not of the published string: a
  // genus recombination keeps the epithet and is the commonest real answer
  // here — Acacia sieberiana → Vachellia sieberiana.
  const keepsEpithet = [...new Set(considered.filter(row => epithetOf(row.accepted) === epithetOf(row.canonical)).map(row => row.accepted))];
  if (keepsEpithet.length === 1) return { chosen: keepsEpithet[0], candidates: accepted, rule: 'gbif_alternative_keeping_the_epithet' };

  const genus = genusOf(binomial);
  const epithet = epithetOf(binomial);
  const keepsGenus = accepted.filter(name => genusOf(name) === genus);
  const keepsSomething = accepted.filter(name => genusOf(name) === genus || epithetOf(name) === epithet);
  if (keepsGenus.length === 1 && keepsSomething.length === 1) {
    return { chosen: keepsGenus[0], candidates: accepted, rule: 'gbif_alternative_keeping_the_genus' };
  }

  return { chosen: null, candidates: accepted };
}

async function resolve(entry) {
  const published = entry.botanical_as_published;
  const attempts = [];

  for (const { query, rule } of candidateQueries(published, entry.matched_canonical)) {
    const match = await matchSpecies(query);
    attempts.push({ query, rule, match_type: match.match_type, confidence: match.confidence, status: match.taxonomic_status, accepted: match.accepted_botanical, eligible: match.eligible });
    if (match.eligible) return { status: 'corrected', rule, corrected_query: query, match, attempts };
  }

  // Nothing mechanical worked, so ask what GBIF thinks the name could be.
  const alternatives = await alternativesFor(published);
  const { chosen, candidates, rule } = disambiguate(published, alternatives);
  if (!chosen) {
    return { status: 'deferred', attempts, alternatives, competing_accepted_names: candidates };
  }

  const match = await matchSpecies(chosen);
  attempts.push({ query: chosen, rule, match_type: match.match_type, confidence: match.confidence, status: match.taxonomic_status, accepted: match.accepted_botanical, eligible: match.eligible });
  if (match.eligible && (match.confidence ?? 0) >= MINIMUM_FUZZY_CONFIDENCE) {
    return { status: 'corrected', rule, corrected_query: chosen, match, attempts, alternatives };
  }
  return { status: 'deferred', attempts, alternatives, competing_accepted_names: candidates };
}

// ─── output ───────────────────────────────────────────────────────────────────

function correctionRecord(entry, outcome, decidedAt) {
  const base = {
    botanical_as_published: entry.botanical_as_published,
    published_genus: genusOf(entry.botanical_as_published),
    unmatched_as: {
      match_type: entry.match_type,
      confidence: entry.confidence,
      taxonomic_status: entry.taxonomic_status,
      matched_canonical: entry.matched_canonical
    },
    decided_at: decidedAt
  };

  if (outcome.status === 'deferred') {
    return {
      ...base,
      status: 'deferred',
      // The point of the record: what a reviewer has to choose between, and the
      // fact that nobody has chosen yet.
      competing_accepted_names: outcome.competing_accepted_names,
      attempts: outcome.attempts,
      reason: outcome.competing_accepted_names.length
        ? 'GBIF offers more than one accepted species for this name and none is distinguished by the published genus or epithet. A botanist has to choose; the rows stay withheld until one does.'
        : 'GBIF offers no accepted species for this name or any mechanical correction of it.'
    };
  }

  return {
    ...base,
    status: 'corrected',
    rule: outcome.rule,
    corrected_query: outcome.corrected_query,
    accepted_botanical: outcome.match.accepted_botanical,
    evidence: {
      queried: outcome.corrected_query,
      match_type: outcome.match.match_type,
      confidence: outcome.match.confidence,
      taxonomic_status: outcome.match.taxonomic_status,
      matched_canonical: outcome.match.matched_canonical,
      usage_key: outcome.match.usage_key,
      accepted_usage_key: outcome.match.accepted_usage_key,
      genus_changed: genusOf(outcome.match.accepted_botanical) !== genusOf(entry.botanical_as_published),
      epithet_changed: epithetOf(outcome.match.accepted_botanical) !== epithetOf(entry.botanical_as_published)
    },
    attempts: outcome.attempts
  };
}

// The corrected entry keeps the published name as its key, because that is what
// the survey rows say and what the build looks up. Everything about the
// correction travels with it, so the cache can be read without this script.
function taxonomyEntry(entry, correction, decidedAt) {
  return {
    ...entry,
    taxonomy_query_name: correction.corrected_query,
    taxonomy_query_strategy: 'curated_correction',
    correction_rule: correction.rule,
    corrected_from_as_published: entry.botanical_as_published,
    match_type: correction.evidence.match_type,
    confidence: correction.evidence.confidence,
    taxonomic_status: correction.evidence.taxonomic_status,
    matched_canonical: correction.evidence.matched_canonical,
    accepted_botanical: correction.accepted_botanical,
    usage_key: correction.evidence.usage_key,
    accepted_usage_key: correction.evidence.accepted_usage_key,
    export_eligible: true,
    checked_at: decidedAt
  };
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const decidedAt = new Date().toISOString().slice(0, 10);

  const taxonomy = readJson(taxonomyPath);
  const unresolved = taxonomy.filter(entry => !entry.export_eligible && entry.taxonomy_query_strategy !== 'curated_correction');
  console.log(`${unresolved.length} published name(s) the matcher could not place.\n`);

  const corrections = [];
  for (const [index, entry] of unresolved.entries()) {
    const outcome = await resolve(entry);
    corrections.push(correctionRecord(entry, outcome, decidedAt));
    process.stdout.write(`\r  resolved ${index + 1}/${unresolved.length}`);
  }
  process.stdout.write('\n\n');

  const corrected = corrections.filter(correction => correction.status === 'corrected');
  const deferred = corrections.filter(correction => correction.status === 'deferred');

  for (const correction of corrected) {
    const flags = [
      correction.evidence.genus_changed ? 'genus' : null,
      correction.evidence.epithet_changed ? 'epithet' : null
    ].filter(Boolean);
    console.log(`  ${correction.botanical_as_published}`);
    console.log(`     → ${correction.accepted_botanical}  [${correction.rule} · ${correction.evidence.taxonomic_status} · ${correction.evidence.confidence}]${flags.length ? `  (${flags.join(' and ')} differ from the published name)` : ''}`);
  }
  if (deferred.length) {
    console.log('\n  deferred — GBIF does not name one accepted species:');
    for (const correction of deferred) {
      console.log(`     ${correction.botanical_as_published} → ${correction.competing_accepted_names.join(' | ') || 'no species candidate'}`);
    }
  }

  console.log(`\n${corrected.length} corrected, ${deferred.length} deferred.`);
  if (dryRun) {
    console.log('\n--dry-run: nothing written.\n');
    return { corrections };
  }

  // Merge, never replace. A later run only sees the names still unresolved, so
  // writing this file from one run's results would quietly delete the record of
  // every correction an earlier run decided — the corrections themselves would
  // survive in the taxonomy cache, and the reasons for them would not.
  const existing = fs.existsSync(correctionsPath) ? readJson(correctionsPath) : [];
  const byName = new Map(existing.map(correction => [correction.botanical_as_published, correction]));
  for (const correction of corrections) byName.set(correction.botanical_as_published, correction);
  const all = [...byName.values()].sort((a, b) => a.botanical_as_published.localeCompare(b.botanical_as_published));
  writeJson(correctionsPath, all);

  const byPublished = new Map(taxonomy.map(entry => [entry.botanical_as_published, entry]));
  for (const correction of corrected) {
    byPublished.set(
      correction.botanical_as_published,
      taxonomyEntry(byPublished.get(correction.botanical_as_published), correction, decidedAt)
    );
  }
  const merged = [...byPublished.values()].sort((a, b) => a.botanical_as_published.localeCompare(b.botanical_as_published));
  writeJson(taxonomyPath, merged);

  console.log(`\nWritten to ${path.relative(process.cwd(), correctionsPath)} — ${all.length} decision(s) on record, ${corrections.length} from this run`);
  console.log(`Merged into ${path.relative(process.cwd(), taxonomyPath)} — rebuild with: npm run plants:build\n`);
  return { corrections };
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { candidateQueries, disambiguate, correctionRecord, taxonomyEntry, main };

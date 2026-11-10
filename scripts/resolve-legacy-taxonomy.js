#!/usr/bin/env node
// Taxonomic names for the legacy tier.
//
//   node scripts/resolve-legacy-taxonomy.js            # resolve and write the cache
//   node scripts/resolve-legacy-taxonomy.js --dry-run
//
// legacy_lookup_v1.json is the immutable snapshot of the original 152 runtime
// rows. Its mappings have no citation, no locality and no collector, which is
// why they are ingested as legacy_unverified — and, until now, why their
// botanical names never went near GBIF. Nothing checked them because nothing
// could vouch for them.
//
// That conflated two different things. Whether a local name really means a
// plant is a question about evidence, and the legacy tier has none. What the
// accepted name of that plant is today is a question about nomenclature, and
// GBIF answers it regardless of where the row came from.
//
// Leaving the second question unasked cost real mappings. A legacy row saying
// "Bryophyllum pinnatum" and a survey row saying "Kalanchoe pinnata" are the
// same plant under two names, and the build read them as two species
// disagreeing — so abamoda, agbalumo, awusa and ewuro were all withheld as
// contested when no source actually contests them.
//
// ── what this does and does not change ──
// It normalises the name. It does not promote the row: the vernacular record
// stays legacy_unverified, because a current name for a plant is not evidence
// that a practitioner ever called it that. The distinction the build now draws
// is that plants.json describes a taxon, which can be taxonomy_checked, while
// the vernacular row describes a claim about a name, which cannot be — not
// until a source or a practitioner supports it.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const plantsDirectory = path.join(root, 'data', 'plants');
const legacyPath = path.join(plantsDirectory, 'legacy_lookup_v1.json');
const outputPath = path.join(plantsDirectory, 'taxonomy', 'gbif-legacy.json');

const USER_AGENT = 'sanko-plant-data/1.0 (+https://www.sanko.africa)';
const MINIMUM_CONFIDENCE = 90;
const CONCURRENCY = 6;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function getJson(url, { attempts = 4 } = {}) {
  let failure = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (failure) await new Promise(resolve => setTimeout(resolve, Math.min(20000, 2000 * 2 ** (attempt - 2))));
    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
      if (response.ok) return response.json();
      const error = new Error(`${response.status} ${response.statusText}: ${url.split('?')[0]}`);
      if (response.status !== 429 && response.status < 500) throw error;
      failure = { error };
    } catch (error) {
      failure = { error };
    }
  }
  throw failure.error;
}

// The same bar the survey names have to clear, so a legacy name is not
// exported on weaker evidence than a published one.
async function matchTaxon(botanical) {
  const params = new URLSearchParams({ scientificName: botanical, rank: 'SPECIES' });
  const body = await getJson(`https://api.gbif.org/v2/species/match?${params}`);
  const usage = body.usage ?? {};
  const diagnostics = body.diagnostics ?? {};
  const accepted = body.acceptedUsage ?? usage;
  const eligible =
    diagnostics.matchType === 'EXACT' &&
    (diagnostics.confidence ?? 0) >= MINIMUM_CONFIDENCE &&
    usage.rank === 'SPECIES' &&
    ['ACCEPTED', 'SYNONYM'].includes(usage.status) &&
    Boolean(accepted.canonicalName);

  return {
    botanical_as_published: botanical,
    taxonomy_query_name: botanical,
    taxonomy_query_strategy: 'legacy_published_name',
    matcher_version: 2,
    match_type: diagnostics.matchType ?? null,
    confidence: diagnostics.confidence ?? null,
    taxonomic_status: usage.status ?? null,
    matched_canonical: usage.canonicalName ?? null,
    accepted_botanical: accepted.canonicalName ?? null,
    usage_key: usage.key ?? null,
    accepted_usage_key: accepted.key ?? usage.key ?? null,
    issues: diagnostics.issues ?? [],
    export_eligible: eligible,
    checked_at: new Date().toISOString().slice(0, 10),
    taxonomy_source_id: 'gbif-species-api'
  };
}

// A rename has to survive one more question: is the plant GBIF renamed this to
// actually recorded in Nigeria?
//
// "Loranthus micranthus" is why. Every legacy row here comes from Nigerian
// practice, and GBIF holds exactly one usage of that name — Hook.f.'s, a New
// Zealand mistletoe accepted as Ileostylus micranthus, with 3,707 occurrences
// worldwide and none in Nigeria. The African plant the legacy row means is
// Linn.f.'s, which the backbone does not carry under that name. No homonym
// check catches this, because GBIF offers only one answer; the occurrence
// record is what gives it away.
//
// The test is deliberately one-directional. A count of zero does not prove
// absence — GBIF's coverage of West African plants is thin — so it is not
// used to claim anything. It only withholds a rename, leaving the legacy name
// exactly as it has always been.
async function nigerianOccurrences(usageKey) {
  if (!usageKey) return null;
  try {
    const body = await getJson(`https://api.gbif.org/v1/occurrence/search?limit=0&country=NG&taxonKey=${usageKey}`);
    return typeof body.count === 'number' ? body.count : null;
  } catch {
    return null;
  }
}

async function checkedMatch(botanical) {
  const match = await matchTaxon(botanical);
  if (!match.export_eligible || match.accepted_botanical === match.botanical_as_published) return match;

  const occurrences = await nigerianOccurrences(match.accepted_usage_key);
  match.nigeria_occurrences = occurrences;
  if (occurrences === null) {
    return { ...match, export_eligible: false, withheld_reason: 'could not check whether the accepted name is recorded in Nigeria' };
  }
  if (occurrences === 0) {
    return { ...match, export_eligible: false, withheld_reason: 'the accepted name is not recorded in Nigeria, so the published name probably means a different plant' };
  }
  return match;
}

function legacyBotanicalNames() {
  const rows = readJson(legacyPath);
  return [...new Set(rows.map(row => row.botanical).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const names = legacyBotanicalNames();
  const cached = fs.existsSync(outputPath)
    ? new Map(readJson(outputPath).map(entry => [entry.botanical_as_published, entry]))
    : new Map();

  console.log(`${names.length} distinct botanical name(s) in the legacy tier.\n`);

  const results = new Array(names.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, async () => {
    while (cursor < names.length) {
      const index = cursor++;
      const botanical = names[index];
      const previous = cached.get(botanical);
      results[index] = previous?.export_eligible ? previous : await checkedMatch(botanical);
      done += 1;
      process.stdout.write(`\r  checked ${done}/${names.length}`);
    }
  }));
  process.stdout.write('\n\n');

  const renamed = results.filter(entry => entry.export_eligible && entry.accepted_botanical !== entry.botanical_as_published);
  const unresolved = results.filter(entry => !entry.export_eligible);

  console.log(`${results.length - unresolved.length} resolved, ${unresolved.length} unresolved.`);
  if (renamed.length) {
    console.log(`\n${renamed.length} legacy name(s) are not the accepted name of the plant they name:`);
    for (const entry of renamed) {
      console.log(`  ${entry.botanical_as_published}  →  ${entry.accepted_botanical}  [${entry.taxonomic_status}]`);
    }
  }
  const withheld = unresolved.filter(entry => entry.withheld_reason);
  if (withheld.length) {
    console.log(`\n${withheld.length} rename(s) withheld:`);
    for (const entry of withheld) {
      console.log(`  ${entry.botanical_as_published} → ${entry.accepted_botanical} — ${entry.withheld_reason} (${entry.nigeria_occurrences ?? 'no count'})`);
    }
  }
  const unmatched = unresolved.filter(entry => !entry.withheld_reason);
  if (unmatched.length) {
    console.log('\nLeft as published — GBIF places these no better than the legacy string:');
    for (const entry of unmatched) console.log(`  ${entry.botanical_as_published}  (${entry.match_type} → ${entry.matched_canonical ?? 'nothing'})`);
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written.\n');
    return results;
  }

  writeJson(outputPath, results);
  console.log(`\nWritten to ${path.relative(process.cwd(), outputPath)} — rebuild with: npm run plants:build\n`);
  return results;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { checkedMatch, legacyBotanicalNames, matchTaxon, nigerianOccurrences, main };

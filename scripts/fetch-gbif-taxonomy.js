const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const plantsDirectory = path.join(root, 'data', 'plants');
const surveysDirectory = path.join(plantsDirectory, 'surveys');
const outputPath = path.join(plantsDirectory, 'taxonomy', 'gbif-primary.json');
const legacyCachePath = path.join(plantsDirectory, 'taxonomy', 'gbif-plateau.json');

async function getJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'sanko-plant-data/1.0' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function taxonomyQueryName(botanicalAsPublished) {
  return botanicalAsPublished.split(/\s*\(Synonym:/i)[0].replace(/[.]$/, '').trim();
}

async function matchTaxon(botanicalAsPublished) {
  const publishedQuery = taxonomyQueryName(botanicalAsPublished);
  async function requestMatch(queryName) {
    const params = new URLSearchParams({ scientificName: queryName, rank: 'SPECIES' });
    return getJson(`https://api.gbif.org/v2/species/match?${params}`);
  }
  let queryName = publishedQuery;
  let match = await requestMatch(queryName);
  let usage = match.usage ?? {};
  let diagnostics = match.diagnostics ?? {};
  const binomial = publishedQuery.match(/^([A-Z][A-Za-z-]+\s+[a-z][A-Za-z-]+)/)?.[1] ?? null;
  if (
    binomial &&
    binomial !== publishedQuery &&
    diagnostics.matchType === 'EXACT' &&
    diagnostics.confidence < 90 &&
    usage.rank === 'SPECIES' &&
    usage.canonicalName === binomial
  ) {
    const fallback = await requestMatch(binomial);
    if ((fallback.diagnostics?.confidence ?? 0) > (diagnostics.confidence ?? 0)) {
      queryName = binomial;
      match = fallback;
      usage = match.usage ?? {};
      diagnostics = match.diagnostics ?? {};
    }
  }
  const accepted = match.acceptedUsage ?? usage;

  const eligible =
    diagnostics.matchType === 'EXACT' &&
    diagnostics.confidence >= 90 &&
    usage.rank === 'SPECIES' &&
    ['ACCEPTED', 'SYNONYM'].includes(usage.status) &&
    Boolean(accepted.canonicalName);

  return {
    botanical_as_published: botanicalAsPublished,
    taxonomy_query_name: queryName,
    taxonomy_query_strategy: queryName === publishedQuery ? 'published_name' : 'binomial_fallback',
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

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function includedBotanicalNames() {
  const sources = readJson(path.join(plantsDirectory, 'sources.json'));
  const included = new Set(
    sources
      .filter(source => source.publication_status === 'active' && source.ingestion_status === 'included')
      .map(source => source.id)
  );
  const botanicalNames = new Set();
  for (const filename of fs.readdirSync(surveysDirectory).filter(filename => filename.endsWith('.json'))) {
    for (const row of readJson(path.join(surveysDirectory, filename))) {
      if (included.has(row.source_id) && row.botanical_as_published) botanicalNames.add(row.botanical_as_published);
    }
  }
  return [...botanicalNames].sort((a, b) => a.localeCompare(b));
}

async function main() {
  const names = includedBotanicalNames();
  const cached = new Map();
  for (const filename of [legacyCachePath, outputPath]) {
    if (!fs.existsSync(filename)) continue;
    for (const row of readJson(filename)) cached.set(row.botanical_as_published, row);
  }

  const results = new Array(names.length);
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(6, names.length) }, async () => {
    while (cursor < names.length) {
      const index = cursor++;
      const botanical = names[index];
      const cachedMatch = cached.get(botanical);
      const reusable = cachedMatch && (
        cachedMatch.export_eligible ||
        cachedMatch.matcher_version === 2
      );
      results[index] = reusable ? cachedMatch : await matchTaxon(botanical);
      completed += 1;
      process.stdout.write(`\rChecked ${completed}/${names.length}`);
    }
  });
  await Promise.all(workers);

  fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`\nSaved taxonomy results to ${outputPath}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { includedBotanicalNames, matchTaxon, taxonomyQueryName };

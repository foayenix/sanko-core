#!/usr/bin/env node
// Per-taxon literature discovery for the open plant literature index
// (docs/SANKO_EVIDENCE_ATLAS_SPEC.md, sections 5.4 and 7).
//
//   node scripts/literature-discover.js --counts [--taxa all|pilot|id,id] [--concurrency 4]
//   node scripts/literature-discover.js --retrieve --taxa pilot|id,id
//
// --counts runs three hit-count queries per taxon (all mentions, safety-titled,
// human-study) and records them in searches.json. The pilot selection reads
// them. They are query hit counts, not verified study counts.
//
// --retrieve pages through every Europe PMC record mentioning the taxon in a
// title or abstract, keeps bibliographic metadata, drops the abstract, applies
// the automated first-pass classification and merges into studies.json and
// index_entries.json. Nothing here makes an entry public: that takes a human
// verification event (npm run literature:verify).
//
// Every executed query is logged with its date, hit count and any provider
// error, so a failed search is visible rather than read as "no evidence".

const fs = require('fs');
const path = require('path');
const store = require('../src/literature/store');
const { countQueries, hash, namesClause, searchNames, toEntry, toStudy } = require('../src/literature/records');

const ENDPOINT = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const USER_AGENT = 'sanko-literature-index/1.0 (+https://www.sanko.africa)';
const PROVIDER = 'europepmc';
const root = path.join(__dirname, '..');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function plants() {
  return JSON.parse(fs.readFileSync(path.join(root, 'data', 'plants', 'plants.json'), 'utf8'))
    .filter(plant => plant.verification_status === 'taxonomy_checked');
}

function selectTaxa(all, spec, directory) {
  if (!spec || spec === 'all') return all;
  if (spec === 'pilot') {
    const file = path.join(directory, 'pilot_selection.json');
    if (!fs.existsSync(file)) throw new Error('No pilot selection yet. Run npm run literature:select-pilot first.');
    const ids = new Set(JSON.parse(fs.readFileSync(file, 'utf8')).selected.map(pick => pick.taxon_id));
    return all.filter(plant => ids.has(plant.id));
  }
  const ids = new Set(spec.split(','));
  const chosen = all.filter(plant => ids.has(plant.id));
  if (chosen.length !== ids.size) throw new Error('Unknown taxon id in --taxa.');
  return chosen;
}

async function getJson(url, { attempts = 5 } = {}) {
  let failure = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (failure) await new Promise(resolve => setTimeout(resolve, Math.min(30000, 2000 * 2 ** (attempt - 2))));
    let response;
    try {
      response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    } catch (error) {
      failure = error;
      continue;
    }
    if (response.ok) return response.json();
    const error = new Error(`${response.status} ${response.statusText}`);
    if (response.status !== 429 && response.status < 500) throw error;
    failure = error;
  }
  throw failure;
}

async function search(query, { pageSize = 1, cursorMark = null, resultType = 'lite' } = {}) {
  const params = new URLSearchParams({ query, format: 'json', pageSize: String(pageSize), resultType });
  if (cursorMark) params.set('cursorMark', cursorMark);
  return getJson(`${ENDPOINT}?${params}`);
}

function searchRecord({ kind, taxonId, query, executedAt, hitCount, retrieved, error }) {
  return {
    search_id: `search-${hash(kind, taxonId, query, executedAt)}`,
    kind,
    taxon_id: taxonId,
    provider: PROVIDER,
    query,
    executed_at: executedAt,
    hit_count: hitCount,
    retrieved,
    error,
  };
}

function upsertSearch(data, record) {
  const index = data.searches.findIndex(existing => existing.search_id === record.search_id);
  if (index === -1) data.searches.push(record);
  else data.searches[index] = record;
}

async function pool(items, concurrency, work) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  });
  await Promise.all(workers);
}

async function runCounts(data, taxa, concurrency = 4) {
  const executedAt = today();
  let done = 0;
  await pool(taxa, concurrency, async plant => {
    for (const query of Object.values(countQueries(plant))) {
      let hitCount = null;
      let error = null;
      try {
        hitCount = (await search(query)).hitCount ?? 0;
      } catch (failure) {
        error = String(failure.message || failure);
      }
      upsertSearch(data, searchRecord({ kind: 'count', taxonId: plant.id, query, executedAt, hitCount, retrieved: 0, error }));
    }
    done += 1;
    if (done % 50 === 0) {
      // Checkpoint, so an interrupted run keeps what it has already paid for.
      store.save(data, ['searches']);
      console.log(`  counted ${done}/${taxa.length}`);
    }
  });
}

async function runRetrieve(data, taxa) {
  const executedAt = today();
  for (const plant of taxa) {
    const query = namesClause(searchNames(plant));
    let cursorMark = '*';
    let hitCount = null;
    let retrieved = 0;
    let error = null;
    try {
      for (;;) {
        const body = await search(query, { pageSize: 1000, cursorMark, resultType: 'core' });
        hitCount = body.hitCount ?? 0;
        const results = body.resultList?.result ?? [];
        for (const record of results) {
          // The abstract is in the response; it is never passed on.
          delete record.abstractText;
          const study = toStudy(record, { indexedAt: executedAt });
          const studyId = store.mergeStudy(data, study);
          store.mergeEntry(data, toEntry(record, { ...study, study_id: studyId }, plant, { indexedAt: executedAt }));
          retrieved += 1;
        }
        if (!results.length || !body.nextCursorMark || body.nextCursorMark === cursorMark) break;
        cursorMark = body.nextCursorMark;
      }
    } catch (failure) {
      error = String(failure.message || failure);
    }
    upsertSearch(data, searchRecord({ kind: 'retrieve', taxonId: plant.id, query, executedAt, hitCount, retrieved, error }));
    console.log(`  ${plant.accepted_botanical}: ${retrieved}/${hitCount ?? '?'}${error ? ` ERROR ${error}` : ''}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const flag = name => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1];
  };
  const directory = flag('--dir') || store.DEFAULT_DIRECTORY;
  const data = store.load(directory);
  const all = plants();

  if (argv.includes('--counts')) {
    const taxa = selectTaxa(all, flag('--taxa') || 'all', directory);
    console.log(`Counting literature for ${taxa.length} taxa…`);
    await runCounts(data, taxa, Math.min(16, Number(flag('--concurrency') || 4)));
    store.save(data, ['searches']);
  } else if (argv.includes('--retrieve')) {
    const spec = flag('--taxa');
    if (!spec || spec === 'all') throw new Error('--retrieve needs --taxa pilot or explicit ids; full coverage is Phase B.');
    const taxa = selectTaxa(all, spec, directory);
    console.log(`Retrieving literature for ${taxa.length} taxa…`);
    await runRetrieve(data, taxa);
    store.save(data, ['searches', 'studies', 'entries']);
  } else {
    console.log('Usage: literature-discover.js --counts [--taxa all|pilot|ids] | --retrieve --taxa pilot|ids');
    return;
  }

  const errors = store.validate(data, { taxonIds: new Set(all.map(plant => plant.id)) });
  if (errors.length) {
    console.error(errors.slice(0, 20).join('\n'));
    process.exitCode = 1;
  }
  const failed = data.searches.filter(record => record.error).length;
  console.log(`Done. ${data.studies.length} studies, ${data.entries.length} entries, ${failed} failed searches recorded.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main, searchRecord, selectTaxa };

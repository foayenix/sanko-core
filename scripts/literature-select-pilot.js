#!/usr/bin/env node
// Choose the 20 pilot taxa (docs/SANKO_EVIDENCE_ATLAS_SPEC.md, section 7.1).
//
//   node scripts/literature-select-pilot.js [--cap 500]
//
// Inputs are published data only: use breadth from data/plants/observations.json
// (distinct included sources reporting the taxon), identity ambiguity from
// data/plants/ambiguities.json, and the hit counts recorded by
// `npm run literature:discover -- --counts`. Nothing from the Vault, care
// records or practitioner activity is read, so the choice cannot leak private
// knowledge.
//
// Slots: 14 by combined score (Nigerian use weighted double, at least 3 sources),
// 3 safety-led, 3 identity-hard. A cap on total
// hits keeps the pilot's verification workload bounded; taxa it excludes are
// reported, not hidden, so the trade-off is visible to whoever approves it.
// Output is deterministic for the same inputs.

const fs = require('fs');
const path = require('path');
const store = require('../src/literature/store');
const { countQueries } = require('../src/literature/records');

const root = path.join(__dirname, '..');
const SLOTS = { score: 14, safety: 3, identity: 3 };
const MIN_TOTAL_HITS = 10;
// The 14 score slots are for plants with established Nigerian use. Without this
// floor, plants with large worldwide literatures but a single Nigerian source
// (dill, dog rose) outrank locally important ones. Safety slots keep no floor:
// a toxic plant matters even if few surveys record it.
const MIN_USE_BREADTH_FOR_SCORE = 3;

function readPlants(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'data', 'plants', name), 'utf8'));
}

function useBreadth(observations) {
  const sources = new Map();
  for (const observation of observations) {
    if (!observation.plant_id) continue;
    if (!sources.has(observation.plant_id)) sources.set(observation.plant_id, new Set());
    sources.get(observation.plant_id).add(observation.source_id);
  }
  return new Map([...sources].map(([id, set]) => [id, set.size]));
}

function ambiguousTaxa(ambiguities, plants) {
  const byName = new Map(plants.map(plant => [plant.accepted_botanical, plant.id]));
  const ids = new Set();
  for (const ambiguity of ambiguities) {
    const accepted = [...new Set((ambiguity.candidates || []).map(candidate => candidate.accepted_botanical).filter(Boolean))];
    if (accepted.length < 2) continue;
    for (const name of accepted) if (byName.has(name)) ids.add(byName.get(name));
  }
  return ids;
}

// Latest successful count per taxon and query type.
function latestCounts(searches, plants) {
  const counts = new Map();
  const dates = [];
  for (const plant of plants) {
    const queries = countQueries(plant);
    const row = {};
    for (const [type, query] of Object.entries(queries)) {
      const runs = searches
        .filter(search => search.kind === 'count' && search.taxon_id === plant.id && search.query === query && search.error === null)
        .sort((a, b) => (a.executed_at < b.executed_at ? 1 : -1));
      row[type] = runs.length ? runs[0].hit_count : null;
      if (runs.length) dates.push(runs[0].executed_at);
    }
    counts.set(plant.id, row);
  }
  return { counts, executedAt: dates.sort().at(-1) ?? null };
}

function select({ plants, observations, ambiguities, searches, cap = 500 }) {
  const eligible = plants.filter(plant => plant.verification_status === 'taxonomy_checked');
  const breadth = useBreadth(observations);
  const ambiguous = ambiguousTaxa(ambiguities, eligible);
  const { counts, executedAt } = latestCounts(searches, eligible);

  const rows = eligible.map(plant => {
    const count = counts.get(plant.id);
    return {
      taxon_id: plant.id,
      accepted_botanical: plant.accepted_botanical,
      use_breadth: breadth.get(plant.id) ?? 0,
      total_hits: count.total,
      human_hits: count.human,
      safety_hits: count.safety,
      ambiguous: ambiguous.has(plant.id),
    };
  }).filter(row => row.total_hits !== null && row.human_hits !== null && row.safety_hits !== null);

  if (!rows.length) throw new Error('No recorded counts. Run npm run literature:discover -- --counts first.');

  const max = key => Math.max(1, ...rows.map(row => row[key]));
  const maxUse = max('use_breadth');
  const maxHuman = Math.log1p(max('human_hits'));
  const maxTotal = Math.log1p(max('total_hits'));
  for (const row of rows) {
    row.score = Number((2 * row.use_breadth / maxUse + Math.log1p(row.human_hits) / maxHuman + 0.5 * Math.log1p(row.total_hits) / maxTotal).toFixed(4));
  }

  const byScore = (a, b) => b.score - a.score || (a.taxon_id < b.taxon_id ? -1 : 1);
  const withinCap = rows.filter(row => row.total_hits >= MIN_TOTAL_HITS && row.total_hits <= cap);
  const chosen = new Set();
  const selected = [];
  const take = (candidates, slot, limit, reason) => {
    for (const row of candidates) {
      if (selected.filter(pick => pick.slot === slot).length >= limit) break;
      if (chosen.has(row.taxon_id)) continue;
      chosen.add(row.taxon_id);
      selected.push({ slot, reason, ...row });
    }
  };

  take(withinCap.filter(row => !row.ambiguous && row.use_breadth >= MIN_USE_BREADTH_FOR_SCORE).sort(byScore), 'score', SLOTS.score, 'highest combined use breadth and literature volume');
  take([...withinCap].sort((a, b) => b.safety_hits - a.safety_hits || byScore(a, b)), 'safety', SLOTS.safety, 'most safety-titled studies among remaining taxa');
  take(withinCap.filter(row => row.ambiguous).sort((a, b) => b.use_breadth - a.use_breadth || byScore(a, b)), 'identity', SLOTS.identity, 'local names contested between taxa; tests the identity section');

  const excludedByCap = rows.filter(row => row.total_hits > cap).sort(byScore).slice(0, 15)
    .map(({ taxon_id, accepted_botanical, total_hits, score }) => ({ taxon_id, accepted_botanical, total_hits, score }));

  return {
    generated_from_counts_dated: executedAt,
    method: {
      slots: SLOTS,
      cap_total_hits: cap,
      min_total_hits: MIN_TOTAL_HITS,
      min_use_breadth_for_score_slots: MIN_USE_BREADTH_FOR_SCORE,
      score: '2*use_breadth/max + ln(1+human_hits)/ln(1+max) + 0.5*ln(1+total_hits)/ln(1+max)',
      inputs: ['data/plants/plants.json', 'data/plants/observations.json', 'data/plants/ambiguities.json', 'data/literature/searches.json (count queries)'],
      note: 'Hit counts are Europe PMC query results, not verified study counts.',
    },
    verification_workload_total_hits: selected.reduce((sum, pick) => sum + pick.total_hits, 0),
    selected,
    excluded_by_cap: excludedByCap,
  };
}

function main(argv = process.argv.slice(2)) {
  const capIndex = argv.indexOf('--cap');
  const cap = capIndex === -1 ? 500 : Number(argv[capIndex + 1]);
  if (!Number.isFinite(cap) || cap < MIN_TOTAL_HITS) throw new Error('--cap must be a number of at least 10.');
  const directory = store.DEFAULT_DIRECTORY;
  const result = select({
    plants: readPlants('plants.json'),
    observations: readPlants('observations.json'),
    ambiguities: readPlants('ambiguities.json'),
    searches: store.load(directory).searches,
    cap,
  });
  fs.writeFileSync(path.join(directory, 'pilot_selection.json'), `${JSON.stringify(result, null, 2)}\n`);
  for (const pick of result.selected) {
    console.log(`${pick.slot.padEnd(8)} ${pick.accepted_botanical.padEnd(32)} sources=${pick.use_breadth} hits=${pick.total_hits} human=${pick.human_hits} safety=${pick.safety_hits}`);
  }
  console.log(`Verification workload (raw hits): ${result.verification_workload_total_hits}`);
  if (result.excluded_by_cap.length) console.log(`Excluded by cap ${cap}: ${result.excluded_by_cap.map(row => `${row.accepted_botanical} (${row.total_hits})`).join(', ')}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { ambiguousTaxa, select, useBreadth };

#!/usr/bin/env node
// The contested-name review loop.
//
//   node scripts/adjudicate-names.js            # what is contested, and how
//   node scripts/adjudicate-names.js propose    # write a pending entry for each
//
// A name reported for more than one taxon is exported with a null botanical:
// the build will not choose between sources, which is the rule that keeps a
// guess out of the index. Until now that was the end of the matter. Forty-five
// names sit there, and nothing could move them — not even uziza, where three
// sources say Piper guineense and one row of a fourth says liquorice.
//
// This adds the missing half: a reviewer can strike a published row, and the
// name resolves if one candidate is left.
//
// ── what a reviewer is allowed to say ──
// Only two things, and the first is deliberately narrow:
//
//   source_row_error   this row of this source is wrong, and here is why.
//                      A claim about a publication, checkable by anyone who
//                      opens it. It removes that row from the candidates; it
//                      does not nominate a winner. If one candidate is left
//                      the name resolves on its own, and if two are left it
//                      stays contested.
//
//   contest_upheld     the disagreement is real. Nothing changes in the index
//                      and the name keeps its null, but the reasoning is on
//                      record and the name stops coming back to the queue.
//
// There is deliberately no "the answer is X". Picking a winner is unfalsifiable
// and would put a reviewer's opinion where the build's rule used to be. Saying
// "PNM 133 of this paper is a typo" can be checked against page 1136.
//
// Most of what is contested here is not error at all. A folk name covering
// several close species is ordinary and correct — ayunre is both Albizia
// ferruginea and Albizia lebbeck, eyin olobe is Phyllanthus amarus and
// Phyllanthus niruri — and the honest record of that is contest_upheld with a
// reason, not a species chosen to make the number go up.

const fs = require('fs');
const path = require('path');

const { REVIEWER_REF } = require('./reviewer-ref');

const root = path.join(__dirname, '..');
const plantsDirectory = path.join(root, 'data', 'plants');
const ambiguitiesPath = path.join(plantsDirectory, 'ambiguities.json');
const adjudicationsPath = path.join(plantsDirectory, 'name_adjudications.json');

const DECISIONS = ['pending', 'source_row_error', 'contest_upheld'];

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// How the disagreement is shaped, because it decides what kind of question it
// is. One source contradicting itself is usually a table error or a folk name
// covering a species pair; several sources disagreeing across regions usually
// is not.
function describe(entry) {
  const bySource = {};
  for (const candidate of entry.candidates) {
    bySource[candidate.source_id] = (bySource[candidate.source_id] ?? 0) + 1;
  }
  const taxa = [...new Set(entry.candidates.map(candidate => candidate.accepted_botanical ?? candidate.botanical_as_published))].sort();
  const genera = new Set(taxa.map(name => name.split(/\s+/)[0]));
  return {
    taxa,
    sources: Object.keys(bySource).sort(),
    within_one_source: Object.values(bySource).some(count => count > 1),
    same_genus: genera.size === 1 && taxa.length > 1,
    majority: majorityOf(entry.candidates)
  };
}

// Which taxon the most rows name, and by how much. Reported, never applied:
// counting rows is not evidence about a plant, but a three-to-one split is
// worth a reviewer's eye before a one-to-one is.
function majorityOf(candidates) {
  const counts = {};
  for (const candidate of candidates) {
    const taxon = candidate.accepted_botanical ?? candidate.botanical_as_published;
    counts[taxon] = (counts[taxon] ?? 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { counts, leader: ranked[0][0], lead: ranked[0][1] - (ranked[1]?.[1] ?? 0) };
}

function pendingEntry(entry) {
  const shape = describe(entry);
  return {
    normalized_name: entry.normalized_name,
    source_spellings: entry.source_spellings,
    candidates: entry.candidates.map(candidate => ({
      accepted_botanical: candidate.accepted_botanical ?? candidate.botanical_as_published,
      botanical_as_published: candidate.botanical_as_published,
      language: candidate.language,
      source_id: candidate.source_id,
      source_row: candidate.source_locator?.row ?? null,
      table: candidate.source_locator?.table ?? null
    })),
    shape: {
      taxa: shape.taxa,
      sources: shape.sources,
      within_one_source: shape.within_one_source,
      same_genus: shape.same_genus,
      rows_per_taxon: shape.majority.counts
    },
    // ── fill these in ──
    decision: 'pending',
    // For source_row_error: which row is wrong.
    strike: null,
    reason: null,
    reviewed_by: null,
    reviewed_at: null
  };
}

// ─── status ───────────────────────────────────────────────────────────────────

function status() {
  const ambiguities = readJson(ambiguitiesPath, []);
  const adjudications = readJson(adjudicationsPath, []);
  const byName = new Map(adjudications.map(item => [item.normalized_name, item]));

  const counts = {};
  for (const item of adjudications) counts[item.decision] = (counts[item.decision] ?? 0) + 1;
  console.log(`${ambiguities.length} contested name(s) in the index.`);
  console.log(`Adjudications on file: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}\n`);

  const undecided = ambiguities.filter(entry => (byName.get(entry.normalized_name)?.decision ?? 'pending') === 'pending');
  const oneSource = undecided.filter(entry => describe(entry).within_one_source);
  const sameGenus = undecided.filter(entry => describe(entry).same_genus);

  console.log(`Of ${undecided.length} undecided:`);
  console.log(`  ${oneSource.length} are one source contradicting itself — a table error, or a name covering a species pair`);
  console.log(`  ${sameGenus.length} are species of the same genus, which a folk name commonly covers\n`);

  for (const entry of undecided.slice(0, 12)) {
    const shape = describe(entry);
    const split = Object.entries(shape.majority.counts).map(([taxon, count]) => `${count}× ${taxon}`).join('  vs  ');
    console.log(`  ${entry.normalized_name}`);
    console.log(`     ${split}`);
    console.log(`     ${shape.sources.join(', ')}${shape.within_one_source ? '  · one source disagrees with itself' : ''}${shape.same_genus ? '  · same genus' : ''}`);
  }
  if (undecided.length > 12) console.log(`  … and ${undecided.length - 12} more in ${path.relative(process.cwd(), adjudicationsPath)}`);
  console.log(`\nEdit ${path.relative(process.cwd(), adjudicationsPath)}, then: npm run plants:build\n`);
}

// ─── propose ──────────────────────────────────────────────────────────────────

function propose() {
  const ambiguities = readJson(ambiguitiesPath, []);
  const existing = readJson(adjudicationsPath, []);
  const byName = new Map(existing.map(item => [item.normalized_name, item]));

  let added = 0;
  let refreshed = 0;
  for (const entry of ambiguities) {
    const prior = byName.get(entry.normalized_name);
    if (!prior) {
      byName.set(entry.normalized_name, pendingEntry(entry));
      added += 1;
      continue;
    }
    // A decided entry is never rewritten. An undecided one has its candidates
    // refreshed, because a new source can change what the disagreement is.
    if (prior.decision === 'pending') {
      byName.set(entry.normalized_name, { ...pendingEntry(entry), ...pickDecisionFields(prior) });
      refreshed += 1;
    }
  }

  // A name that is no longer contested keeps its decision on file: it is the
  // record of why it stopped being contested.
  const all = [...byName.values()].sort((a, b) => a.normalized_name.localeCompare(b.normalized_name));
  writeJson(adjudicationsPath, all);
  console.log(`${added} new, ${refreshed} refreshed, ${all.length} on file → ${path.relative(process.cwd(), adjudicationsPath)}`);
  console.log('\nFor each one you can settle, set:');
  console.log('  "decision": "source_row_error", "strike": { "source_id": "…", "source_row": 133 }, "reason": "…", "reviewed_by": "PR-7F2A"');
  console.log('  "decision": "contest_upheld", "reason": "the name covers both species", "reviewed_by": "PR-7F2A"');
  console.log('\nThen: npm run plants:build\n');
}

function pickDecisionFields(entry) {
  const { decision, strike, reason, reviewed_by, reviewed_at } = entry;
  return { decision, strike, reason, reviewed_by, reviewed_at };
}

// ─── validation, used by the build ────────────────────────────────────────────

// A decision only counts when it says who made it and why. Anything half
// filled-in is treated as still pending rather than quietly applied.
function validate(adjudications) {
  const applied = [];
  const problems = [];

  for (const entry of adjudications) {
    if (!entry.decision || entry.decision === 'pending') continue;
    if (!DECISIONS.includes(entry.decision)) {
      problems.push(`${entry.normalized_name}: unknown decision "${entry.decision}"`);
      continue;
    }
    if (!entry.reason?.trim()) {
      problems.push(`${entry.normalized_name}: ${entry.decision} with no reason`);
      continue;
    }
    if (!REVIEWER_REF.test(entry.reviewed_by ?? '')) {
      problems.push(`${entry.normalized_name}: reviewed_by must be a pseudonymous reference such as PR-7F2A`);
      continue;
    }
    if (entry.decision === 'source_row_error') {
      if (!entry.strike?.source_id) {
        problems.push(`${entry.normalized_name}: source_row_error must name the row it strikes`);
        continue;
      }
    }
    applied.push(entry);
  }
  return { applied, problems };
}

// Does this vernacular record is the row an adjudication strikes?
function strikes(entry, name) {
  if (entry.decision !== 'source_row_error') return false;
  if (entry.normalized_name !== name.normalized_name) return false;
  if (entry.strike.source_id !== name.source_id) return false;
  // Legacy rows have no locator; a source_id and a name identify them.
  if (entry.strike.source_row === null || entry.strike.source_row === undefined) return true;
  return entry.strike.source_row === (name.source_locator?.row ?? null);
}

async function main() {
  const [command = 'status'] = process.argv.slice(2);
  if (command === 'status') return status();
  if (command === 'propose') return propose();
  throw new Error(`Unknown command "${command}". Use: status | propose`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { DECISIONS, describe, majorityOf, pendingEntry, propose, status, strikes, validate };

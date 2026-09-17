#!/usr/bin/env node
// The unknown-plant review loop.
//
//   node scripts/plant-review.js pull      # build a review queue from live events
//   node scripts/plant-review.js status    # what is waiting, without touching anything
//   node scripts/plant-review.js promote   # fold confirmed names into the runtime index
//
// Sanko already flags every local name it cannot place botanically
// (`unknown_plant_flagged`, src/agent/tools.js). Until now that queue only
// accumulated. This closes it: a name confirmed here re-enters
// data/plant_lookup_v1.json, which is interpolated into the agent's system
// prompt, so the next conversation that mentions the plant gets it right — with
// no training run, no adapter, and no model change.
//
// The review itself is deliberately a file you edit, not a terminal prompt.
// Identifying a plant means looking things up; it is not a question you answer
// in one keystroke, and a queue you can put down and come back to survives that
// far better than an interactive session does.
//
// ── privacy ──
// The queue holds practitioner speech, because a reviewer cannot identify a name
// without seeing it used. data/plants/review_queue.json is therefore gitignored,
// and `promote` copies the mapping alone into the committed file — never the
// transcript it came from.

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { build, normalizeLocalName } = require('./build-plant-data');

const root = path.join(__dirname, '..');
const PLANTS_DIR = path.join(root, 'data', 'plants');
const QUEUE_PATH = path.join(PLANTS_DIR, 'review_queue.json');
const CONFIRMATIONS_PATH = path.join(PLANTS_DIR, 'practitioner_confirmations.json');
const RUNTIME_PATH = path.join(root, 'data', 'plant_lookup_v1.json');

const CONTEXT_EXCERPTS = 3;
const EXCERPT_CHARS = 320;
const DECISIONS = ['pending', 'confirmed', 'rejected', 'unclear', 'promoted'];

// A reviewer reference is a stable pseudonym — the same rule evals/README.md
// applies to case reviewers. Anything that looks like a name, phone number,
// email or database id is refused rather than quietly committed to a public file.
const REVIEWER_REF = /^[A-Z]{2,4}-[A-Z0-9]{4,8}$/;

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function flag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

function excerpt(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > EXCERPT_CHARS ? `${value.slice(0, EXCERPT_CHARS)}…` : value;
}

// ─── pull ─────────────────────────────────────────────────────────────────────

// Names already resolvable are dropped, not queued. Otherwise every pull would
// re-present work that a previous round, or a newly ingested survey, has fixed.
function resolvedNames() {
  const runtime = readJson(RUNTIME_PATH, []);
  return new Set(runtime.filter(row => row.botanical).map(row => normalizeLocalName(row.local_name)));
}

function confirmedNames() {
  return new Set(readJson(CONFIRMATIONS_PATH, []).map(row => normalizeLocalName(row.local_name)));
}

// Turns raw events into one queue entry per distinct name. Pure, so the whole
// pull can be exercised from a fixture with no database — see `--from`.
function buildQueue(events, existing = [], { resolved = new Set(), confirmed = new Set() } = {}) {
  const previous = new Map(existing.map(entry => [entry.normalized_name, entry]));
  const byName = new Map();

  for (const event of events) {
    const names = event.payload?.plants ?? (event.payload?.local_name ? [event.payload.local_name] : []);
    for (const name of names) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const normalized = normalizeLocalName(name);
      if (!normalized || resolved.has(normalized) || confirmed.has(normalized)) continue;

      const entry = byName.get(normalized) ?? {
        normalized_name: normalized,
        spellings: [],
        languages: [],
        occurrences: 0,
        first_seen: event.created_at,
        last_seen: event.created_at,
        contexts: [],
        // ── fill these in ──
        decision: 'pending',
        botanical_as_published: null,
        common_english: null,
        notes: null,
      };

      entry.occurrences += 1;
      if (!entry.spellings.includes(name)) entry.spellings.push(name);
      const language = event.formulation?.original_language;
      if (language && !entry.languages.includes(language)) entry.languages.push(language);
      if (event.created_at < entry.first_seen) entry.first_seen = event.created_at;
      if (event.created_at > entry.last_seen) entry.last_seen = event.created_at;

      const text = excerpt(event.formulation?.original_text);
      if (text && entry.contexts.length < CONTEXT_EXCERPTS && !entry.contexts.some(c => c.text === text)) {
        entry.contexts.push({
          short_code: event.payload?.short_code ?? null,
          language: language ?? null,
          seen_at: event.created_at,
          text,
        });
      }
      byName.set(normalized, entry);
    }
  }

  // A reviewer's half-finished judgement outranks a fresh count. Carry the
  // decision fields forward and let the counts and contexts refresh underneath.
  for (const entry of byName.values()) {
    const prior = previous.get(entry.normalized_name);
    if (!prior) continue;
    entry.decision = prior.decision ?? entry.decision;
    entry.botanical_as_published = prior.botanical_as_published ?? null;
    entry.common_english = prior.common_english ?? null;
    entry.notes = prior.notes ?? null;
    if (prior.confirmed_by) entry.confirmed_by = prior.confirmed_by;
    // A seeded candidate that later turns up in real speech keeps the note of
    // where the suggestion came from. The occurrences it just gained are the
    // better evidence, but they do not erase the weaker one.
    if (prior.candidate_source) entry.candidate_source = prior.candidate_source;
  }

  // Promoted entries are kept so a later pull does not re-queue a name whose
  // confirmation has not yet reached the runtime index. Seeded candidates are
  // kept for a different reason: nothing in the event stream will ever
  // re-create them, so dropping them here would silently undo every seeding
  // run the moment someone pulls — including the rejections, which would then
  // be seeded all over again.
  for (const prior of previous.values()) {
    const keep = prior.decision === 'promoted' || Boolean(prior.candidate_source);
    if (keep && !byName.has(prior.normalized_name)) byName.set(prior.normalized_name, prior);
  }

  return [...byName.values()].sort((a, b) => b.occurrences - a.occurrences || a.normalized_name.localeCompare(b.normalized_name));
}

async function pull(args) {
  const sinceDays = Number(flag(args, 'since', 180));
  const from = flag(args, 'from');

  let events;
  if (from) {
    events = readJson(path.resolve(from), []);
    console.log(`Read ${events.length} event(s) from ${from}`);
  } else {
    const db = require('../src/services/supabase');
    events = await db.listUnknownPlantEvents({ sinceDays });
    console.log(`Read ${events.length} unknown-plant event(s) from the last ${sinceDays} days.`);
  }

  const queue = buildQueue(events, readJson(QUEUE_PATH, []), { resolved: resolvedNames(), confirmed: confirmedNames() });
  writeJson(QUEUE_PATH, queue);

  const pending = queue.filter(entry => entry.decision === 'pending');
  console.log(`\nQueue: ${path.relative(process.cwd(), QUEUE_PATH)} (gitignored — it contains practitioner speech)`);
  console.log(`  ${queue.length} name(s), ${pending.length} awaiting a decision.\n`);
  printTop(pending);
  if (pending.length) {
    console.log('For each name you can identify, set:');
    console.log('  "decision": "confirmed", "botanical_as_published": "Genus species", "common_english": "…"');
    console.log('Use "rejected" for a name that is not a plant, "unclear" to leave it for someone else.');
    console.log('\nThen: node scripts/plant-review.js promote --reviewer PR-7F2A\n');
  }
}

function printTop(entries, limit = 10) {
  for (const entry of entries.slice(0, limit)) {
    const languages = entry.languages.length ? ` [${entry.languages.join(', ')}]` : '';
    console.log(`  ${String(entry.occurrences).padStart(3)}×  ${entry.normalized_name}${languages}`);
  }
  if (entries.length > limit) console.log(`  … and ${entries.length - limit} more in the queue file.`);
  if (entries.length) console.log('');
}

// ─── status ───────────────────────────────────────────────────────────────────

function status() {
  const queue = readJson(QUEUE_PATH, null);
  const confirmations = readJson(CONFIRMATIONS_PATH, []);
  const runtime = readJson(RUNTIME_PATH, []);

  console.log(`Runtime index: ${runtime.filter(row => row.botanical).length} resolved of ${runtime.length} names.`);
  console.log(`Confirmed by review: ${confirmations.length}`);
  if (!queue) {
    console.log('\nNo review queue yet. Build one with: node scripts/plant-review.js pull\n');
    return;
  }
  const counts = {};
  for (const entry of queue) counts[entry.decision] = (counts[entry.decision] ?? 0) + 1;
  console.log(`\nQueue (${queue.length}): ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'empty'}\n`);
  printTop(queue.filter(entry => entry.decision === 'pending'));
}

// ─── promote ──────────────────────────────────────────────────────────────────

function toConfirmation(entry, reviewer, now) {
  return {
    local_name: entry.spellings[0] ?? entry.normalized_name,
    language: entry.languages[0] ?? null,
    botanical_as_published: entry.botanical_as_published.trim(),
    common_english: entry.common_english?.trim() || null,
    confirmed_by: entry.confirmed_by ?? reviewer,
    confirmed_at: now,
    // Kept because it is the honest weight of the evidence: a name seen once is
    // a guess worth checking, a name seen twenty times is a gap in the index.
    occurrences: entry.occurrences,
    notes: entry.notes ?? null,
    // Null for a name Sanko actually heard; set for one a candidate source
    // suggested and a reviewer then confirmed. The reviewer is the evidence
    // either way, but the two are not the same kind of record and the file
    // should not pretend they are.
    candidate_source: entry.candidate_source ?? null,
  };
}

function promote(args) {
  // Falls back to SANKO_OPERATOR_REF so the reference is configured once, in
  // one place, rather than retyped per invocation — a reference that varies by
  // keystroke attributes nothing. A CLI cannot authenticate the way /admin can;
  // this is the closest equivalent.
  const reviewer = flag(args, 'reviewer') ?? process.env.SANKO_OPERATOR_REF ?? null;
  const dryRun = args.includes('--dry-run');
  const queue = readJson(QUEUE_PATH, null);

  if (!queue) throw new Error(`No queue at ${path.relative(process.cwd(), QUEUE_PATH)}. Run: node scripts/plant-review.js pull`);

  const confirmed = queue.filter(entry => entry.decision === 'confirmed');
  if (!confirmed.length) {
    console.log('Nothing marked "confirmed" in the queue. Nothing to promote.');
    return;
  }

  const missingBotanical = confirmed.filter(entry => !entry.botanical_as_published?.trim());
  if (missingBotanical.length) {
    throw new Error(
      `${missingBotanical.length} entr(y/ies) are marked confirmed with no botanical name: ` +
      `${missingBotanical.map(entry => entry.normalized_name).join(', ')}. ` +
      'Confirming a name without saying what it is would put a null mapping into the index.'
    );
  }

  const needsReviewer = confirmed.filter(entry => !entry.confirmed_by);
  if (needsReviewer.length && !reviewer) {
    throw new Error('Pass --reviewer <ref>, or set SANKO_OPERATOR_REF. A stable pseudonym such as PR-7F2A; every confirmation is attributed.');
  }
  if (reviewer && !REVIEWER_REF.test(reviewer)) {
    throw new Error(
      `--reviewer "${reviewer}" is not a pseudonymous reference (expected e.g. PR-7F2A). ` +
      'This value is committed to the repository, so it must never be a name, phone number, email or database id. ' +
      'Keep the pseudonym-to-identity mapping outside this repository.'
    );
  }

  const existing = readJson(CONFIRMATIONS_PATH, []);
  const seen = new Set(existing.map(row => `${normalizeLocalName(row.local_name)}|${row.botanical_as_published.toLowerCase()}`));
  const now = new Date().toISOString();

  const additions = [];
  for (const entry of confirmed) {
    const record = toConfirmation(entry, reviewer, now);
    const key = `${normalizeLocalName(record.local_name)}|${record.botanical_as_published.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push(record);
  }

  if (!additions.length) {
    console.log('Every confirmed name is already in practitioner_confirmations.json. Nothing to add.');
    return;
  }

  console.log(`Promoting ${additions.length} confirmed name(s):\n`);
  for (const record of additions) {
    console.log(`  ${record.local_name} → ${record.botanical_as_published}${record.common_english ? ` (${record.common_english})` : ''}  · ${record.occurrences}× · ${record.confirmed_by}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written.\n');
    return;
  }

  const before = readJson(RUNTIME_PATH, []).filter(row => row.botanical).length;

  existing.push(...additions);
  existing.sort((a, b) => a.local_name.localeCompare(b.local_name));
  writeJson(CONFIRMATIONS_PATH, existing);

  for (const entry of queue) {
    if (entry.decision === 'confirmed') {
      entry.decision = 'promoted';
      entry.confirmed_by = entry.confirmed_by ?? reviewer;
    }
  }
  writeJson(QUEUE_PATH, queue);

  const report = build();
  const after = readJson(RUNTIME_PATH, []).filter(row => row.botanical).length;

  console.log(`\nRuntime index: ${before} → ${after} resolved names.`);
  if (after <= before) {
    // Not a failure: a confirmation that contradicts a published source is sent
    // to ambiguities.json rather than overwriting it, and that is the safe
    // outcome. It does mean the name still will not resolve, so say so.
    console.log('No net gain — check data/plants/ambiguities.json: a confirmation that disagrees with a published source is held there rather than overriding it.');
  }
  console.log(`Practitioner-confirmed mappings in the index: ${report.practitioner_confirmed_runtime_mappings}`);
  console.log('\nCommit data/plants/practitioner_confirmations.json and the rebuilt data files. Never commit the queue.\n');
}

// ─── entry point ──────────────────────────────────────────────────────────────

async function main() {
  const [command = 'status', ...args] = process.argv.slice(2);
  if (command === 'pull') return pull(args);
  if (command === 'promote') return promote(args);
  if (command === 'status') return status();
  throw new Error(`Unknown command "${command}". Use: pull | status | promote`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { buildQueue, toConfirmation, DECISIONS, REVIEWER_REF, QUEUE_PATH, CONFIRMATIONS_PATH };

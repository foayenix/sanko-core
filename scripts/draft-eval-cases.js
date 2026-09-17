#!/usr/bin/env node
// Turn real failures into evaluation cases.
//
//   node scripts/draft-eval-cases.js draft    [--limit 50]
//   node scripts/draft-eval-cases.js status
//   node scripts/draft-eval-cases.js release  [--dry-run]
//
// This is what makes the eval set self-improving rather than frozen. Every
// correction is a recorded instance of the model getting something wrong on real
// Nigerian traditional-medicine input — which is exactly what an eval case is,
// with the practitioner's fix as the expected answer.
//
// ── two rules this script exists to enforce ──
//
// 1. A drafted case is NOT a reviewed case. It is written to evals/cases/drafts/,
//    which the runner does not read. Only a human who has de-identified the
//    wording and confirmed the expectation moves it up into evals/cases/ — the
//    same staging discipline data/plants/surveys/staged/ uses.
//
// 2. A correction that becomes a case is held out of training, immediately and
//    in the database (011). Training on an example you then grade against turns
//    the eval into a memory test. `release` gives the hold-out back when a draft
//    is discarded, so abandoning a draft does not silently retire a real training
//    example for good.
//
// Drafts contain unreviewed practitioner speech, so evals/cases/drafts/ is
// gitignored. Nothing here de-identifies anything; a person must.

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CASES_DIR = path.join(root, 'evals', 'cases');
const DRAFTS_DIR = path.join(CASES_DIR, 'drafts');

const FIELD_PATHS = {
  condition_local: 'condition_local',
  condition_std: 'condition_std',
  preparation: 'preparation',
  dosage: 'dosage',
  notes: 'notes',
};

function flag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

function slug(value, max = 34) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max) || 'case';
}

// One case per correction. The practitioner's corrected value becomes the
// expectation; the transcript that produced the mistake becomes the input.
function toDraftCase(correction) {
  const formulation = correction.formulations;
  if (!formulation?.original_text) return null;

  const caseId = `draft-${slug(formulation.short_code)}-${slug(correction.field, 18)}-${correction.id.slice(0, 8)}`;
  const expect = { tools: ['save_formulation'], forbidden_tools: [], plants_include: [], botanicals: {}, fields: {} };

  if (correction.field === 'plants' && Array.isArray(correction.after_value)) {
    expect.plants_include = correction.after_value.map(plant => plant?.local_name).filter(Boolean);
    for (const plant of correction.after_value) {
      if (plant?.local_name && plant?.botanical) expect.botanicals[plant.local_name] = plant.botanical;
    }
  } else if (FIELD_PATHS[correction.field]) {
    expect.fields[FIELD_PATHS[correction.field]] = correction.after_value;
  }

  return {
    id: caseId,
    description: `Drafted from a ${correction.source} correction to ${correction.field} on ${formulation.short_code}. NOT REVIEWED.`,
    practitioner: {
      display_name: 'Pseudonymous practitioner',
      preferred_language: formulation.original_language ?? 'en',
    },
    turns: [formulation.original_text],
    expect,
    // Deliberately not a `review` or `editorial_review` block: this case has had
    // neither. It records where it came from and what still has to happen.
    draft_origin: {
      status: 'unreviewed',
      source: correction.source,
      field: correction.field,
      correction_id: correction.id,
      model_at_fault: correction.model ?? null,
      drafted_at: new Date().toISOString(),
      rejected_value: correction.before_value ?? null,
      todo: [
        'De-identify the wording in `turns` — it is verbatim practitioner speech.',
        'Confirm with a practitioner that `expect` is what they meant.',
        'Replace this block with a `review` block, then move the file to evals/cases/.',
      ],
    },
  };
}

async function draft(args) {
  const limit = Number(flag(args, 'limit', 50));
  const db = require('../src/services/supabase');

  const corrections = await db.listCorrectionsForEvalDrafting({ limit });
  console.log(`Corrections eligible for drafting: ${corrections.length}`);

  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  const existing = new Set(fs.readdirSync(DRAFTS_DIR).filter(name => name.endsWith('.json')));
  const promoted = new Set(fs.readdirSync(CASES_DIR).filter(name => name.endsWith('.json')));

  const written = [];
  const heldOut = [];
  let skipped = 0;

  for (const correction of corrections) {
    const testCase = toDraftCase(correction);
    if (!testCase) { skipped++; continue; }
    const filename = `${testCase.id}.json`;
    if (existing.has(filename) || promoted.has(filename)) continue;
    fs.writeFileSync(path.join(DRAFTS_DIR, filename), `${JSON.stringify(testCase, null, 2)}\n`);
    written.push(filename);
    heldOut.push({ id: correction.id, case_id: testCase.id });
  }

  if (skipped) console.log(`Skipped ${skipped} correction(s) with no source transcript to use as input.`);
  if (!written.length) {
    console.log('\nNothing new to draft.\n');
    return;
  }

  // Held out only after the files exist, so a crash mid-run cannot retire a
  // correction from training without leaving the draft that justifies it.
  await db.markCorrectionsHeldOut(heldOut);

  console.log(`\nDrafted ${written.length} case(s) into ${path.relative(process.cwd(), DRAFTS_DIR)} (gitignored):\n`);
  for (const filename of written.slice(0, 10)) console.log(`  ${filename}`);
  if (written.length > 10) console.log(`  … and ${written.length - 10} more.`);
  console.log(`\n${heldOut.length} correction(s) are now held out of the training export.`);
  console.log('\nThese are NOT eval cases yet. Each one needs a practitioner to de-identify the');
  console.log('wording and confirm the expectation before it moves up into evals/cases/.\n');
}

async function status() {
  const drafts = fs.existsSync(DRAFTS_DIR) ? fs.readdirSync(DRAFTS_DIR).filter(name => name.endsWith('.json')) : [];
  const cases = fs.readdirSync(CASES_DIR).filter(name => name.endsWith('.json'));
  console.log(`Drafts awaiting review: ${drafts.length}`);
  console.log(`Cases in the suite:     ${cases.length}`);

  const db = require('../src/services/supabase');
  const held = await db.listHeldOutCorrections();
  console.log(`Corrections held out:   ${held.length}`);

  const live = new Set([...drafts, ...cases].map(name => name.replace(/\.json$/, '')));
  const orphaned = held.filter(row => row.held_out_case_id && !live.has(row.held_out_case_id));
  if (orphaned.length) {
    console.log(`\n${orphaned.length} hold-out(s) have no case file — their draft was discarded.`);
    console.log('Give them back to training with: node scripts/draft-eval-cases.js release\n');
  } else {
    console.log('\nEvery hold-out still has a case file.\n');
  }
}

// A discarded draft must not cost a training example permanently.
async function release(args) {
  const dryRun = args.includes('--dry-run');
  const db = require('../src/services/supabase');

  const drafts = fs.existsSync(DRAFTS_DIR) ? fs.readdirSync(DRAFTS_DIR).filter(name => name.endsWith('.json')) : [];
  const cases = fs.readdirSync(CASES_DIR).filter(name => name.endsWith('.json'));
  const live = new Set([...drafts, ...cases].map(name => name.replace(/\.json$/, '')));

  const held = await db.listHeldOutCorrections();
  const orphaned = held.filter(row => row.held_out_case_id && !live.has(row.held_out_case_id));

  if (!orphaned.length) {
    console.log('No orphaned hold-outs. Nothing to release.');
    return;
  }
  console.log(`Releasing ${orphaned.length} correction(s) whose case file no longer exists:\n`);
  for (const row of orphaned.slice(0, 10)) console.log(`  ${row.held_out_case_id}`);
  if (dryRun) return console.log('\n--dry-run: nothing changed.\n');

  await db.releaseHeldOutCorrections(orphaned.map(row => row.id));
  console.log('\nThey are eligible for the training export again.\n');
}

async function main() {
  const [command = 'status', ...args] = process.argv.slice(2);
  if (command === 'draft') return draft(args);
  if (command === 'release') return release(args);
  if (command === 'status') return status();
  throw new Error(`Unknown command "${command}". Use: draft | status | release`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { toDraftCase, DRAFTS_DIR };

#!/usr/bin/env node
// The promotion gate.
//
//   node scripts/promote-model.js --candidate sanko-extract-01
//   node scripts/promote-model.js --candidate sanko-extract-01 --record --operator OP-4C21
//
// training/README.md has always described this decision in prose: promote only
// if mean_score went up and hallucinated is still zero. Prose is not a gate. This
// reads the scorecards in evals/results/, applies the rules, and exits non-zero
// when any of them fails.
//
// What it deliberately does NOT do is change the running model. Weights that
// promote themselves would corrupt an archive nobody can reconstruct; the script
// tells you whether the evidence supports a promotion and prints the one line you
// then choose to apply.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const RESULTS_DIR = path.join(root, 'evals', 'results');
const REGISTRY_PATH = path.join(root, 'training', 'model_registry.json');

const MIN_REVIEWED_CASES = 100;
const OPERATOR_REF = /^[A-Z]{2,4}-[A-Z0-9]{4,8}$/;

function flag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Newest scorecard for a given model. Results are named
// <timestamp>__<model>.json, but the model is read from inside the file rather
// than parsed out of the filename, which is lossy for models containing ':'.
function latestResultFor(model) {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  return fs.readdirSync(RESULTS_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      try {
        return { file: name, result: JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, name), 'utf8')) };
      } catch {
        return null;
      }
    })
    .filter(entry => entry?.result?.model === model)
    .sort((a, b) => String(a.result.ran_at).localeCompare(String(b.result.ran_at)))
    .at(-1) ?? null;
}

function caseIds(result) {
  return (result?.results ?? []).map(row => row.id).sort();
}

// Pure, so the gate can be unit-tested without any scorecards on disk.
function evaluateGate({ candidate, incumbent, allowUnreviewed = false }) {
  const checks = [];
  const summary = candidate?.result?.summary;
  const previous = incumbent?.result?.summary;

  checks.push({
    name: 'Candidate has a scorecard',
    passed: Boolean(summary),
    detail: summary ? `${candidate.file}` : 'No eval result found for this model. Run npm run eval against it first.',
  });
  if (!summary) return { passed: false, checks, delta: null };

  checks.push({
    name: 'Run completed cleanly',
    passed: summary.errored === 0,
    detail: summary.errored === 0
      ? `All ${summary.cases} cases produced a score.`
      : `${summary.errored} case(s) errored. An errored run is not evidence.`,
  });

  // The check that outranks the score. A model that scores higher while inventing
  // one plant is a worse model: recall can be recovered, a corrupted archive
  // cannot.
  checks.push({
    name: 'No hallucinated plants',
    passed: summary.hallucinated === 0,
    detail: summary.hallucinated === 0
      ? 'Nothing was recorded that the practitioner did not say.'
      : `${summary.hallucinated} case(s) invented a plant. This is disqualifying regardless of score.`,
  });

  const delta = previous ? Number((summary.mean_score - previous.mean_score).toFixed(4)) : null;
  if (previous) {
    checks.push({
      name: 'Scored the same case set as the incumbent',
      passed: JSON.stringify(caseIds(candidate.result)) === JSON.stringify(caseIds(incumbent.result)),
      detail: `${caseIds(candidate.result).length} vs ${caseIds(incumbent.result).length} cases. A changed case set makes the two scores incomparable.`,
    });
    checks.push({
      name: 'No score regression against the incumbent',
      passed: delta >= 0,
      detail: `${(summary.mean_score * 100).toFixed(1)}% vs ${(previous.mean_score * 100).toFixed(1)}% (${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} points).`,
    });
  } else {
    checks.push({
      name: 'No score regression against the incumbent',
      passed: true,
      detail: 'No incumbent scorecard to compare against — this is the first recorded promotion.',
    });
  }

  const reviewed = candidate.result.case_set?.practitioner_reviewed ?? 0;
  checks.push({
    name: 'Scored on practitioner-reviewed cases',
    passed: reviewed >= MIN_REVIEWED_CASES || allowUnreviewed,
    detail: reviewed >= MIN_REVIEWED_CASES
      ? `${reviewed} approved cases.`
      : `${reviewed} of ${MIN_REVIEWED_CASES} approved cases. ` +
        (allowUnreviewed
          ? 'Overridden with --allow-unreviewed: this promotion rests on unreviewed evidence.'
          : 'Pass --allow-unreviewed to promote anyway, and know that you are doing it.'),
  });

  return { passed: checks.every(check => check.passed), checks, delta };
}

function main() {
  const args = process.argv.slice(2);
  const candidateModel = flag(args, 'candidate');
  if (!candidateModel) throw new Error('Pass --candidate <model>, the model id as it appears in its eval result.');

  const registry = readJson(REGISTRY_PATH, { promotions: [] });
  const incumbentModel = flag(args, 'incumbent')
    ?? registry.promotions.at(-1)?.candidate
    ?? process.env.OLLAMA_MODEL
    ?? null;

  const candidate = latestResultFor(candidateModel);
  const incumbent = incumbentModel && incumbentModel !== candidateModel ? latestResultFor(incumbentModel) : null;

  console.log(`\nCandidate: ${candidateModel}${candidate ? ` · ${candidate.file}` : ''}`);
  console.log(`Incumbent: ${incumbentModel ?? 'none'}${incumbent ? ` · ${incumbent.file}` : incumbentModel ? ' · no scorecard on disk' : ''}\n`);

  const gate = evaluateGate({ candidate, incumbent, allowUnreviewed: args.includes('--allow-unreviewed') });

  for (const check of gate.checks) {
    console.log(`  ${check.passed ? '✓' : '✗'} ${check.name}`);
    console.log(`      ${check.detail}`);
  }

  if (!gate.passed) {
    console.log('\nGATE FAILED — do not promote.\n');
    process.exit(1);
  }

  console.log('\nGATE PASSED.');
  console.log(`\nTo make ${candidateModel} live, set it yourself:\n\n  OLLAMA_MODEL=${candidateModel}\n`);
  console.log('Nothing about the running system has been changed by this command.\n');

  if (!args.includes('--record')) {
    console.log('Add --record --operator <ref> to write this decision to training/model_registry.json.\n');
    return;
  }

  // See scripts/plant-review.js — configured once, not retyped per promotion.
  const operator = flag(args, 'operator') ?? process.env.SANKO_OPERATOR_REF ?? null;
  if (!OPERATOR_REF.test(String(operator ?? ''))) {
    throw new Error('Pass --operator <ref>, or set SANKO_OPERATOR_REF. A pseudonymous reference such as OP-4C21 — the registry is committed.');
  }

  registry.promotions.push({
    candidate: candidateModel,
    incumbent: incumbentModel ?? null,
    decided_at: new Date().toISOString(),
    operator,
    candidate_result: candidate.file,
    incumbent_result: incumbent?.file ?? null,
    mean_score: candidate.result.summary.mean_score,
    mean_score_delta: gate.delta,
    hallucinated: candidate.result.summary.hallucinated,
    cases: candidate.result.summary.cases,
    practitioner_reviewed_cases: candidate.result.case_set?.practitioner_reviewed ?? 0,
    unreviewed_override: args.includes('--allow-unreviewed'),
  });
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`Recorded in ${path.relative(process.cwd(), REGISTRY_PATH)}.\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { evaluateGate, latestResultFor, MIN_REVIEWED_CASES };

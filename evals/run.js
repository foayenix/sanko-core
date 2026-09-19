#!/usr/bin/env node
// Sanko eval runner.
//
//   npm run eval                    # score the configured provider
//   npm run eval -- --case 02       # one case, verbose
//   npm run eval -- --compare       # ollama vs anthropic on the same cases
//   npm run eval -- --validate-only # check every case parses; no model calls
//   npm run eval:reviewed            # at least 100 practitioner-approved cases
//
// Runs each case through the real agent loop and the real tools, against an
// in-memory database. Nothing touches the live Vault, so it is safe to run as
// often as you like — the only cost is model time.
//
// Results land in evals/results/<timestamp>__<model>.json. Diff two of those to
// answer the only question that matters after a fine-tune: is it actually better?

const fs = require('fs');
const path = require('path');

require('dotenv').config({ quiet: true });

const CASES_DIR = path.join(__dirname, 'cases');
const RESULTS_DIR = path.join(__dirname, 'results');

function isPractitionerReviewed(testCase) {
  const review = testCase?.review;
  return review?.status === 'approved'
    && review?.reviewer_role === 'practitioner'
    && typeof review?.reviewer_ref === 'string'
    && review.reviewer_ref.trim().length > 0
    && typeof review?.reviewed_at === 'string'
    && !Number.isNaN(Date.parse(review.reviewed_at))
    && typeof review?.rubric_version === 'string'
    && review.rubric_version.trim().length > 0;
}

function isEditoriallyReviewed(testCase) {
  const review = testCase?.editorial_review;
  return review?.status === 'complete'
    && review?.reviewer_role === 'model_editorial'
    && typeof review?.reviewer_ref === 'string'
    && review.reviewer_ref.trim().length > 0
    && typeof review?.reviewed_at === 'string'
    && !Number.isNaN(Date.parse(review.reviewed_at))
    && typeof review?.rubric_version === 'string'
    && review.rubric_version.trim().length > 0
    && review?.practitioner_review === 'pending';
}

// A case turn is usually the practitioner's words. It can also be a photo:
//
//   { "photo": { "reads_as": "", "caption": "optional words sent with it" } }
//
// `reads_as` is what services/vision.js returns for the page — text for a
// photographed page, and "" for a photo with no writing on it at all: a leaf, a
// bark, a root, a grinding stone. That empty reading is what routes a photo to
// the specimen flow, so it is the only way to write a case about naming a plant.
//
// The blocks the agent receives are built by the real utils/inboundMedia.js. A
// case that restated that module's wording would stop being evidence about the
// agent the moment the wording changed, which is the same reason the simulator
// shares the module rather than copying it.
//
// The page reading itself is stubbed rather than run. This suite scores the
// agent; the vision model has its own harness (`npm run vision:compare`), and
// calling it here would make every eval depend on a second model being pulled
// and would score two things at once.
function isPhotoTurn(turn) {
  return Boolean(turn) && typeof turn === 'object' && !Array.isArray(turn) && 'photo' in turn;
}

function validateTurn(turn) {
  if (typeof turn === 'string') return turn.trim() ? null : 'a spoken turn cannot be blank';
  if (!isPhotoTurn(turn)) return 'a turn must be a string or a { photo: … } object';
  const photo = turn.photo;
  if (!photo || typeof photo !== 'object' || Array.isArray(photo)) return 'photo must be an object';
  for (const [key, value] of Object.entries(photo)) {
    if (!['reads_as', 'caption'].includes(key)) return `photo.${key} is not a recognised field`;
    if (value != null && typeof value !== 'string') return `photo.${key} must be a string`;
  }
  return null;
}

// What the practitioner contributed in this turn, for the grounding haystack.
//
// A page reading counts: the words on the page are the practitioner's own, so a
// plant named from them was heard rather than invented. A specimen photo
// contributes only its caption, because an empty reading contributes nothing —
// which is exactly what makes a name produced on that turn a fabrication.
function turnText(turn) {
  if (typeof turn === 'string') return turn;
  return [turn.photo?.reads_as, turn.photo?.caption].filter(Boolean).join('\n');
}

function validateCase(testCase, filename = '<case>') {
  const errors = [];
  if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
    return [`${filename}: case must be a JSON object`];
  }
  if (typeof testCase.id !== 'string' || !testCase.id.trim()) errors.push(`${filename}: id is required`);
  if (typeof testCase.description !== 'string' || !testCase.description.trim()) {
    errors.push(`${filename}: description is required`);
  }
  const turns = testCase.turns ?? (typeof testCase.input === 'string' ? [testCase.input] : null);
  if (!Array.isArray(turns) || !turns.length) {
    errors.push(`${filename}: input or at least one turn is required`);
  } else {
    turns.forEach((turn, index) => {
      const problem = validateTurn(turn);
      if (problem) errors.push(`${filename}: turn ${index + 1} — ${problem}`);
    });
  }
  if (!testCase.expect || typeof testCase.expect !== 'object' || Array.isArray(testCase.expect)) {
    errors.push(`${filename}: expect must be an object`);
  }
  // A typo here is silent otherwise: scoreChoices treats an unrecognised value
  // as "no expectation" and passes, so the case would look green while asserting
  // nothing at all.
  if (testCase.expect?.tools_may_refuse != null &&
      (!Array.isArray(testCase.expect.tools_may_refuse) ||
       testCase.expect.tools_may_refuse.some(t => typeof t !== 'string'))) {
    errors.push(`${filename}: expect.tools_may_refuse must be an array of tool names`);
  }
  if (testCase.expect?.choices != null && !['required', 'forbidden'].includes(testCase.expect.choices)) {
    errors.push(`${filename}: expect.choices must be 'required' or 'forbidden'`);
  }
  if (testCase.review && !isPractitionerReviewed(testCase)) {
    errors.push(
      `${filename}: review must include status=approved, reviewer_role=practitioner, ` +
      'a pseudonymous reviewer_ref, reviewed_at, and rubric_version'
    );
  }
  if (testCase.editorial_review && !isEditoriallyReviewed(testCase)) {
    errors.push(
      `${filename}: editorial_review must include status=complete, reviewer_role=model_editorial, ` +
      'a reviewer_ref, reviewed_at, rubric_version, and practitioner_review=pending'
    );
  }
  return errors;
}

function loadCases(filter, { reviewedOnly = false } = {}) {
  const loaded = fs.readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !filter || f.includes(filter))
    .sort()
    .map(filename => ({
      filename,
      testCase: JSON.parse(fs.readFileSync(path.join(CASES_DIR, filename), 'utf8')),
    }));

  const errors = loaded.flatMap(({ filename, testCase }) => validateCase(testCase, filename));
  const ids = new Set();
  for (const { filename, testCase } of loaded) {
    if (ids.has(testCase.id)) errors.push(`${filename}: duplicate id '${testCase.id}'`);
    ids.add(testCase.id);
  }
  if (errors.length) throw new Error(`Invalid eval cases:\n  - ${errors.join('\n  - ')}`);

  return loaded
    .map(({ testCase }) => testCase)
    .filter(testCase => !reviewedOnly || isPractitionerReviewed(testCase));
}

function parsePositiveInteger(args, flag) {
  if (!args.includes(flag)) return null;
  const raw = args[args.indexOf(flag) + 1];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} requires a positive integer`);
  return value;
}

// A real, decodable 1x1 JPEG. The photo has to be a genuine image rather than
// arbitrary bytes because `--compare` sends it to a hosted model, which rejects
// anything that is not one. What is in the frame does not matter: the reading is
// stubbed above, and the agent model on this stack is text-only.
const BLANK_PHOTO = fs.readFileSync(path.join(__dirname, 'fixtures', 'blank-1x1.jpg'));

async function photoContent(turn, practitioner) {
  const vision = require('../src/services/vision');
  const inboundMedia = require('../src/utils/inboundMedia');

  const text = turn.photo?.reads_as ?? '';
  const original = vision.transcribePage;
  vision.transcribePage = async (_buffer, _mimeType, options = {}) => ({
    text,
    confidence: text ? 1 : 0,
    unreadable: 0,
    diacritics: vision._diacritics(text, options.language ?? null),
    model: 'eval-stub',
    provider: 'eval',
    error: null,
  });

  try {
    const { blocks } = await inboundMedia.imageBlocks(
      BLANK_PHOTO, 'image/jpeg', practitioner, turn.photo?.caption ?? null
    );
    return blocks;
  } finally {
    vision.transcribePage = original;
  }
}

async function runCase(testCase, { installFakeDb, runAgent, llm, scoreCase }) {
  const fake = installFakeDb();
  try {
    const practitioner = fake.store.seedPractitioner(testCase.practitioner ?? {});

    // Some cases need existing records to refer to (e.g. "I gave FM-00001 to…").
    for (const formulation of testCase.seed?.formulations ?? []) {
      await fake.store.seedFormulation(practitioner.id, formulation);
    }

    // A case is a conversation, not a single message. The agent is instructed to
    // read a formulation back before saving it, so a one-shot case penalises the
    // models that follow that instruction and rewards the ones that ignore it.
    // `turns` lets a case include the practitioner's "yes, that's right".
    const turns = testCase.turns ?? [testCase.input];

    const started = Date.now();
    const calls = [];
    const replies = [];
    let stopped;

    for (const turn of turns) {
      const result = await runAgent({
        practitioner,
        content: isPhotoTurn(turn) ? await photoContent(turn, practitioner) : turn,
        send: () => {},
        sendPatientConsent: async () => true,
        client: llm.getClient(),
      });
      calls.push(...result.toolCalls);
      replies.push(...result.replies);
      stopped = result.stopped;
    }

    // Grounding is checked against everything the practitioner actually said.
    // Replies go in too: whether a question arrived as buttons or as a wall of
    // text is invisible in the tool calls, and it is most of the experience.
    const scored = scoreCase({ ...testCase, input: turns.map(turnText).join('\n') }, calls, { replies });

    return { ...scored, replies, turns: turns.length, ms: Date.now() - started, stopped };
  } catch (err) {
    return scoreCase(testCase, [], { error: err.message });
  } finally {
    fake.restore();
  }
}

function bar(value, width = 20) {
  const filled = Math.round(value * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function runSuite({ filter, verbose, reviewedOnly = false, requireCount = null }) {
  // Required lazily so LLM_PROVIDER overrides applied by --compare take effect.
  const { installFakeDb } = require('../tests/helpers/fakeDb');
  const { runAgent } = require('../src/agent');
  const llm = require('../src/services/llm');
  const { scoreCase, summarise } = require('./score');

  const cases = loadCases(filter, { reviewedOnly });
  if (requireCount && cases.length < requireCount) {
    throw new Error(
      `Reviewed-suite gate failed: found ${cases.length} eligible case(s), need at least ${requireCount}. ` +
      'Cases without complete practitioner approval metadata are excluded.'
    );
  }
  if (!cases.length) {
    const kind = reviewedOnly ? 'practitioner-reviewed cases' : 'cases';
    throw new Error(`No ${kind} matched${filter ? ` '${filter}'` : ''} in ${CASES_DIR}`);
  }

  console.log(`\nProvider: ${llm.providerName()}   Model: ${llm.modelName()}`);
  console.log(`Cases:    ${cases.length}${reviewedOnly ? ' practitioner-reviewed' : ''}\n`);

  const results = [];
  for (const testCase of cases) {
    process.stdout.write(`  ${testCase.id.padEnd(24)} `);
    const result = await runCase(testCase, { installFakeDb, runAgent, llm, scoreCase });
    results.push(result);

    if (result.error) {
      console.log(`ERROR  ${result.error}`);
    } else {
      const flags = [];
      if (result.checks.hallucination && !result.checks.hallucination.clean) {
        flags.push(`invented: ${result.checks.hallucination.invented.join(', ')}`);
      }
      if (result.checks.tools && !result.checks.tools.passed) {
        const t = result.checks.tools;
        if (t.missing.length) flags.push(`missing: ${t.missing.join(',')}`);
        if (t.refusedRequired.length) flags.push(`refused, nothing written: ${t.refusedRequired.join(',')}`);
        if (t.violations.length) flags.push(`forbidden: ${t.violations.join(',')}`);
      }
      const incidental = (result.checks.tools?.refused ?? [])
        .filter(t => !result.checks.tools.refusedRequired.includes(t));
      if (incidental.length) flags.push(`refused: ${incidental.join(',')}`);
      if (result.checks.choices && !result.checks.choices.passed) {
        const c = result.checks.choices;
        if (c.leaked.length) flags.push('sentinel leaked into a reply');
        else if (c.want === 'required') flags.push('no buttons offered');
        else if (c.want === 'forbidden') flags.push(`buttons offered: ${c.offered.join('/')}`);
        if (c.missing.length) flags.push(`button missing: ${c.missing.join(',')}`);
      }
      console.log(
        `${bar(result.score)} ${(result.score * 100).toFixed(0).padStart(3)}%  ` +
        `${String(result.ms / 1000).slice(0, 4)}s  ${flags.join(' · ')}`
      );
      if (verbose) console.log(JSON.stringify(result.checks, null, 2));
    }
  }

  const summary = summarise(results);
  console.log(`\n  mean ${(summary.mean_score * 100).toFixed(1)}%   ` +
              `passed ${summary.passed}/${summary.cases}   ` +
              `hallucinated ${summary.hallucinated}   ` +
              `wrong tool ${summary.wrong_tool}   ` +
              `wrong buttons ${summary.wrong_buttons}   ` +
              `errored ${summary.errored}\n`);

  const record = {
    ran_at: new Date().toISOString(),
    provider: llm.providerName(),
    model: llm.modelName(),
    agent_tools: process.env.AGENT_TOOLS ?? 'full',
    case_set: {
      reviewed_only: reviewedOnly,
      practitioner_reviewed: cases.filter(isPractitionerReviewed).length,
      minimum_required: requireCount,
      rubric_versions: [...new Set(cases.map(c => c.review?.rubric_version).filter(Boolean))].sort(),
    },
    summary,
    results,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const slug = `${record.ran_at.replace(/[:.]/g, '-')}__${record.model.replace(/[^\w.-]/g, '_')}.json`;
  const file = path.join(RESULTS_DIR, slug);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`  saved → evals/results/${slug}\n`);

  return record;
}

async function main() {
  const args = process.argv.slice(2);
  const filter = args.includes('--case') ? args[args.indexOf('--case') + 1] : null;
  const verbose = args.includes('--verbose');
  const reviewedOnly = args.includes('--reviewed-only');
  const requireCount = parsePositiveInteger(args, '--require-count');

  if (requireCount && !reviewedOnly) {
    throw new Error('--require-count is only valid with --reviewed-only');
  }

  // Loads and validates every case without calling a model, so CI can catch a
  // malformed case, a duplicate id or a broken review block on a runner with no
  // model, no keys and no budget. loadCases throws with the full list.
  if (args.includes('--validate-only')) {
    const cases = loadCases(filter);
    const reviewed = cases.filter(isPractitionerReviewed).length;
    const editorial = cases.filter(isEditoriallyReviewed).length;
    console.log(`${cases.length} case(s) valid — ${reviewed} practitioner-reviewed, ${editorial} editorial, ${cases.length - reviewed - editorial} unreviewed.`);
    return;
  }

  if (args.includes('--compare')) {
    const records = [];
    for (const provider of ['ollama', 'anthropic']) {
      process.env.LLM_PROVIDER = provider;
      // Drop cached module state so the new provider is picked up.
      for (const key of Object.keys(require.cache)) {
        if (key.includes('/src/') || key.includes('/tests/helpers/')) delete require.cache[key];
      }
      try {
        records.push(await runSuite({ filter, verbose, reviewedOnly, requireCount }));
      } catch (err) {
        console.error(`  ${provider} run failed: ${err.message}\n`);
      }
    }
    if (records.length === 2) {
      const [local, hosted] = records;
      const delta = (local.summary.mean_score - hosted.summary.mean_score) * 100;
      console.log('  ── comparison ──────────────────────────────');
      console.log(`  ${local.model.padEnd(34)} ${(local.summary.mean_score * 100).toFixed(1)}%`);
      console.log(`  ${hosted.model.padEnd(34)} ${(hosted.summary.mean_score * 100).toFixed(1)}%`);
      console.log(`  gap ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} points to local\n`);
    }
    return;
  }

  const record = await runSuite({ filter, verbose, reviewedOnly, requireCount });
  // Non-zero exit on a hallucination so CI or a promotion script can gate on it.
  if (record.summary.hallucinated > 0) process.exit(2);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}

module.exports = {
  isPractitionerReviewed,
  isEditoriallyReviewed,
  validateCase,
  validateTurn,
  isPhotoTurn,
  turnText,
  loadCases,
  parsePositiveInteger,
  runCase,
  runSuite,
};

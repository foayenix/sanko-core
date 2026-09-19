#!/usr/bin/env node
'use strict';

// Practitioner review of the evaluation set.
//
//   node scripts/eval-review.js status                    # coverage, and the gap to the gate
//   node scripts/eval-review.js packets                   # something a practitioner can actually read
//   node scripts/eval-review.js packets --language yo     # one language at a time
//   node scripts/eval-review.js apply --file decisions.json
//
// The eval harness refuses to certify a model on fewer than 100
// practitioner-approved cases, and today there are none. That is not a bug to
// route around — it is the one control standing between "the tests pass" and
// "this is safe for practitioners", and the only thing that clears it is
// practitioners reading cases. This script exists to make that a morning's work
// rather than a project.
//
// It does three things and deliberately not a fourth: it does not approve
// anything. Approval comes from a person, through a decisions file they or
// somebody sitting with them filled in.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const CASES_DIR = path.join(__dirname, '../evals/cases');
const PACKET_DIR = path.join(__dirname, '../evals/review/packets');
const REQUIRED_REVIEWED = 100;
const RUBRIC_VERSION = 'practitioner-v1';

// A stable pseudonym, never a name, a phone number, or a database id. The shape
// is the one governance already uses for operator references, and the checks
// below reject the three things most likely to be typed in by accident.
const REVIEWER_REF = /^[A-Z]{2,4}-[A-Z0-9]{4,8}$/;

const LANGUAGES = { en: 'English', yo: 'Yorùbá', ig: 'Igbo', ha: 'Hausa' };

function loadCases() {
  return fs.readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(filename => ({
      filename,
      file: path.join(CASES_DIR, filename),
      testCase: JSON.parse(fs.readFileSync(path.join(CASES_DIR, filename), 'utf8')),
    }));
}

const isApproved = c => c.review?.status === 'approved' && c.review?.reviewer_role === 'practitioner';
const isEditorial = c => Boolean(c.editorial_review);

// ─── what a case covers ───────────────────────────────────────────────────────

// The rubric asks for coverage across these, and warns against many superficial
// paraphrases of one interaction — so they are counted rather than assumed.
function dimensionsOf(testCase) {
  const expect = testCase.expect ?? {};
  const tools = expect.tools ?? [];
  const turns = (testCase.turns ?? []).map(t => (typeof t === 'string' ? t : JSON.stringify(t))).join('\n');
  const botanicals = expect.botanicals ?? {};

  return {
    language: testCase.practitioner?.preferred_language ?? 'unstated',
    photo: /\[photo|\[image|photo_/i.test(turns) || Boolean(testCase.turns?.some(t => typeof t === 'object')),
    voice: /\[voice note/i.test(turns),
    unknown_plant: Object.values(botanicals).some(v => v === null),
    correction: tools.includes('update_formulation'),
    browsing: tools.includes('list_formulations') || tools.includes('get_formulation'),
    specimen: tools.includes('save_specimen'),
    patient: tools.some(t => t.includes('patient') || t.includes('treatment')),
    refusal: (expect.forbidden_tools ?? []).length > 0 || tools.length === 0,
  };
}

// ─── status ───────────────────────────────────────────────────────────────────

function status() {
  const all = loadCases();
  const approved = all.filter(({ testCase }) => isApproved(testCase));
  const editorial = all.filter(({ testCase }) => isEditorial(testCase) && !isApproved(testCase));
  const neither = all.filter(({ testCase }) => !isApproved(testCase) && !isEditorial(testCase));

  console.log(`\n  Evaluation set: ${all.length} case(s)\n`);
  console.log(`    practitioner-approved   ${String(approved.length).padStart(4)}`);
  console.log(`    editorial only          ${String(editorial.length).padStart(4)}`);
  console.log(`    neither                 ${String(neither.length).padStart(4)}`);

  const shortfall = REQUIRED_REVIEWED - approved.length;
  console.log(`\n  The gate needs ${REQUIRED_REVIEWED}. Short by ${shortfall}.`);

  // The part that is easy to miss: reviewing everything currently written is not
  // enough, because there is not enough written.
  if (all.length < REQUIRED_REVIEWED) {
    console.log(`  Reviewing every existing case would still leave ${REQUIRED_REVIEWED - all.length} to write.`);
    console.log('  `npm run eval:draft` drafts cases from real corrections, which are the');
    console.log('  independent evidence the rubric asks for — not paraphrases of one interaction.');
  }

  const counts = {};
  const byLanguage = {};
  for (const { testCase } of all) {
    const dims = dimensionsOf(testCase);
    byLanguage[dims.language] = (byLanguage[dims.language] ?? 0) + 1;
    for (const [key, value] of Object.entries(dims)) {
      if (key !== 'language' && value) counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  console.log('\n  Coverage across the set (the rubric asks for breadth, not volume):\n');
  for (const [code, n] of Object.entries(byLanguage).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(LANGUAGES[code] ?? code).padEnd(22)} ${String(n).padStart(4)}`);
  }
  console.log('');
  for (const key of ['voice', 'photo', 'unknown_plant', 'correction', 'browsing', 'specimen', 'patient', 'refusal']) {
    const n = counts[key] ?? 0;
    console.log(`    ${key.replace(/_/g, ' ').padEnd(22)} ${String(n).padStart(4)}${n === 0 ? '   ← nothing covers this' : ''}`);
  }
  console.log('');
}

// ─── packets ──────────────────────────────────────────────────────────────────

function describeExpectation(testCase) {
  const expect = testCase.expect ?? {};
  const lines = [];

  if (expect.tools?.length) lines.push(`Sanko should: ${expect.tools.join(', ')}`);
  else lines.push('Sanko should: record nothing');
  if (expect.forbidden_tools?.length) lines.push(`Sanko must not: ${expect.forbidden_tools.join(', ')}`);

  if (expect.plants_include?.length) lines.push(`Plants recorded: ${expect.plants_include.join(', ')}`);
  for (const [local, botanical] of Object.entries(expect.botanicals ?? {})) {
    lines.push(`  ${local} → ${botanical ?? 'no botanical name (left unconfirmed)'}`);
  }
  for (const [field, value] of Object.entries(expect.fields ?? {})) {
    lines.push(`${field}: ${value}`);
  }
  if (expect.confidence_between) {
    lines.push(`Confidence between ${expect.confidence_between[0]} and ${expect.confidence_between[1]}`);
  }
  return lines;
}

// One case, written for somebody who has never seen the repository. No JSON, no
// field names they have to decode, and the four rubric questions at the end in
// the order they have to be answered.
function packetFor({ testCase }) {
  const lang = testCase.practitioner?.preferred_language;
  const out = [];
  out.push(`CASE ${testCase.id}`);
  out.push('='.repeat(60));
  out.push('');
  out.push(`Language: ${LANGUAGES[lang] ?? lang ?? 'not stated'}`);
  if (testCase.description) out.push(`About: ${testCase.description}`);
  out.push('');
  out.push('WHAT THE PRACTITIONER SAYS');
  out.push('-'.repeat(60));
  for (const [i, turn] of (testCase.turns ?? []).entries()) {
    const text = typeof turn === 'string' ? turn : (turn.text ?? JSON.stringify(turn));
    out.push(`  ${i + 1}. ${text.replace(/\n/g, '\n     ')}`);
  }
  out.push('');
  out.push('WHAT SANKO IS EXPECTED TO DO');
  out.push('-'.repeat(60));
  for (const line of describeExpectation(testCase)) out.push(`  ${line}`);
  out.push('');
  out.push('QUESTIONS');
  out.push('-'.repeat(60));
  out.push('  1. Does the wording above represent a real interaction, or a fair');
  out.push('     de-identified version of one?                          YES / NO');
  out.push('  2. Does everything Sanko is expected to record match what was meant —');
  out.push('     including what is deliberately left out?               YES / NO');
  out.push('  3. Is there anything here that could identify a patient?  YES / NO');
  out.push('  4. Do you approve this case for testing the model, knowing it will not');
  out.push('     be used to train it?                                   YES / NO');
  out.push('');
  out.push('  Approve only if 1, 2 and 4 are YES and 3 is NO.');
  out.push('  Anything wrong — say what, in your own words:');
  out.push('');
  out.push('  ' + '_'.repeat(56));
  out.push('  ' + '_'.repeat(56));
  out.push('');
  return out.join('\n');
}

function packets(args) {
  const language = flag(args, 'language');
  const all = loadCases()
    .filter(({ testCase }) => !isApproved(testCase))
    .filter(({ testCase }) => !language || testCase.practitioner?.preferred_language === language);

  if (!all.length) {
    console.log('\n  Nothing to review with that filter.\n');
    return;
  }

  fs.mkdirSync(PACKET_DIR, { recursive: true });
  for (const entry of all) {
    fs.writeFileSync(path.join(PACKET_DIR, `${entry.testCase.id}.txt`), packetFor(entry));
  }

  // One file per case for a reviewer working through them, and one combined file
  // for printing.
  const combined = all.map(packetFor).join('\n\n');
  fs.writeFileSync(path.join(PACKET_DIR, '_all.txt'), combined);

  // The decisions file, pre-filled with every case so nothing is silently
  // skipped: a reviewer edits status and signs it once.
  const template = {
    rubric_version: RUBRIC_VERSION,
    reviewer_ref: 'PR-XXXX',
    reviewed_at: new Date().toISOString(),
    decisions: all.map(({ testCase }) => ({ case_id: testCase.id, status: 'pending', note: '' })),
  };
  const decisionsFile = path.join(PACKET_DIR, '..', 'decisions.json');
  if (fs.existsSync(decisionsFile)) {
    console.log(`\n  Left ${path.relative(process.cwd(), decisionsFile)} alone — it already exists.`);
  } else {
    fs.writeFileSync(decisionsFile, `${JSON.stringify(template, null, 2)}\n`);
  }

  console.log(`\n  ${all.length} packet(s) → ${path.relative(process.cwd(), PACKET_DIR)}/`);
  console.log(`  Combined for printing → ${path.relative(process.cwd(), path.join(PACKET_DIR, '_all.txt'))}`);
  console.log(`  Decisions template    → ${path.relative(process.cwd(), decisionsFile)}`);
  console.log('\n  Set reviewer_ref to a stable pseudonym such as PR-7F2A. Never a name or');
  console.log('  a phone number — keep that mapping outside this repository.\n');
}

// ─── apply ────────────────────────────────────────────────────────────────────

function assertReviewerRef(ref) {
  if (!REVIEWER_REF.test(String(ref ?? ''))) {
    throw new Error(
      `reviewer_ref "${ref}" is not a pseudonym of the expected shape (e.g. PR-7F2A).\n` +
      'It must never be a name, a phone number, or a database id: the case files are in Git,\n' +
      'and the identity-to-pseudonym mapping belongs outside the repository.'
    );
  }
}

function apply(args) {
  const file = flag(args, 'file');
  if (!file) throw new Error('Pass the decisions file with --file, e.g. --file evals/review/decisions.json');

  const payload = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const reviewedAt = payload.reviewed_at ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(reviewedAt))) throw new Error(`reviewed_at "${reviewedAt}" is not a date.`);

  const byId = new Map(loadCases().map(entry => [entry.testCase.id, entry]));
  const approved = [];
  const rejected = [];
  const skipped = [];

  for (const decision of payload.decisions ?? []) {
    const entry = byId.get(decision.case_id);
    if (!entry) throw new Error(`No case with id "${decision.case_id}".`);

    const state = String(decision.status ?? 'pending').toLowerCase();
    if (state === 'pending' || state === '') { skipped.push(decision); continue; }
    if (state === 'rejected') { rejected.push(decision); continue; }
    if (state !== 'approved') throw new Error(`Unknown status "${decision.status}" for ${decision.case_id}.`);

    const ref = decision.reviewer_ref ?? payload.reviewer_ref;
    assertReviewerRef(ref);

    const { testCase, file: caseFile } = entry;
    testCase.review = {
      status: 'approved',
      reviewer_role: 'practitioner',
      reviewer_ref: ref,
      reviewed_at: decision.reviewed_at ?? reviewedAt,
      rubric_version: payload.rubric_version ?? RUBRIC_VERSION,
    };
    // Per evals/README.md: the editorial block is replaced by the real approval,
    // not kept alongside it. Two review blocks on one case is two claims about
    // who checked it.
    delete testCase.editorial_review;
    fs.writeFileSync(caseFile, `${JSON.stringify(testCase, null, 2)}\n`);
    approved.push(decision.case_id);
  }

  console.log(`\n  Approved ${approved.length} case(s).`);
  if (rejected.length) {
    // Never written into a case file. A rejected case is one to fix or drop, and
    // recording the rejection in the case would make it look reviewed.
    console.log(`\n  ${rejected.length} rejected — these need fixing or removing, and are not marked:`);
    for (const d of rejected) console.log(`    ${d.case_id}${d.note ? `: ${d.note}` : ''}`);
  }
  if (skipped.length) console.log(`\n  ${skipped.length} still pending.`);

  const total = loadCases().filter(({ testCase }) => isApproved(testCase)).length;
  console.log(`\n  ${total} of ${REQUIRED_REVIEWED} practitioner-approved.`);
  if (total < REQUIRED_REVIEWED) console.log(`  ${REQUIRED_REVIEWED - total} to go before npm run eval:reviewed will run.\n`);
  else console.log('  The gate is satisfied. `npm run eval:reviewed` will run.\n');
}

function flag(args, name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1] ?? null;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'status' || !command) return status();
  if (command === 'packets') return packets(args);
  if (command === 'apply') return apply(args);
  throw new Error(`Unknown command "${command}". Use status, packets, or apply.`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { dimensionsOf, packetFor, assertReviewerRef, REVIEWER_REF, REQUIRED_REVIEWED };

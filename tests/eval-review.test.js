// The bake-off harness and the practitioner review workflow.
//
// Two rules under test, both of which exist to stop a number being read as
// evidence it is not: a model is only comparable to another on the same frozen
// cases, and an approval only counts when a practitioner gave it.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { fingerprintCases, loadCases, isPractitionerReviewed } = require('../evals/run');
const { dimensionsOf, packetFor, assertReviewerRef, REQUIRED_REVIEWED } = require('../scripts/eval-review');

const caseOf = (overrides = {}) => ({
  id: 'x-1',
  practitioner: { display_name: 'Ade', preferred_language: 'yo' },
  turns: ['Fun iba, mo n lo ewe dongoyaro.', 'Yes, save it.'],
  expect: { tools: ['save_formulation'], plants_include: ['dongoyaro'], botanicals: { dongoyaro: 'Azadirachta indica' } },
  ...overrides,
});

describe('a bake-off is only a comparison if the cases are the same', () => {
  it('gives the same digest regardless of the order cases are loaded in', () => {
    const cases = loadCases();
    assert.equal(fingerprintCases(cases).digest, fingerprintCases([...cases].reverse()).digest);
  });

  it('changes the digest when a case is edited, not just added or removed', () => {
    // The failure this catches: a case quietly tweaked between two runs, leaving
    // two scorecards that look directly comparable and are not.
    const cases = loadCases();
    const edited = JSON.parse(JSON.stringify(cases));
    edited[0].expect.plants_include = [...(edited[0].expect.plants_include ?? []), 'something-new'];

    assert.notEqual(fingerprintCases(cases).digest, fingerprintCases(edited).digest);
  });

  it('changes the digest when a case is removed', () => {
    const cases = loadCases();
    assert.notEqual(fingerprintCases(cases).digest, fingerprintCases(cases.slice(1)).digest);
  });

  it('records the count and ids alongside the digest', () => {
    const print = fingerprintCases([caseOf(), caseOf({ id: 'x-2' })]);
    assert.equal(print.case_count, 2);
    assert.deepEqual(print.case_ids, ['x-1', 'x-2']);
    assert.match(print.digest, /^[0-9a-f]{16}$/);
  });
});

describe('practitioner approval cannot be forged by the tooling', () => {
  it('refuses a reviewer reference that identifies a person', () => {
    // The case files are in Git. A name, a phone number or a database id in one
    // is a practitioner identified in a public repository forever.
    for (const ref of ['Adewale Ogunleye', '+2348012345678', '550e8400-e29b-41d4-a716-446655440000', 'practitioner 1', '']) {
      assert.throws(() => assertReviewerRef(ref), /pseudonym/, `should refuse ${JSON.stringify(ref)}`);
    }
  });

  it('accepts a stable pseudonym of the documented shape', () => {
    for (const ref of ['PR-7F2A', 'OP-4C21', 'PRAC-9B12E']) {
      assert.doesNotThrow(() => assertReviewerRef(ref));
    }
  });

  it('does not count an editorial block as practitioner review', () => {
    // 42 cases carry one today. They are engineering regression fixtures, and
    // the gate must never read them as evidence about practitioners.
    const editorial = caseOf({
      editorial_review: {
        status: 'complete', reviewer_role: 'model_editorial', reviewer_ref: 'codex-2026-08-13',
        reviewed_at: '2026-08-13T00:00:00Z', rubric_version: 'editorial-v1', practitioner_review: 'pending',
      },
    });
    assert.equal(isPractitionerReviewed(editorial), false);
  });

  it('does not count an approval that is missing any part of its provenance', () => {
    const base = {
      status: 'approved', reviewer_role: 'practitioner', reviewer_ref: 'PR-7F2A',
      reviewed_at: '2026-09-20T09:15:00Z', rubric_version: 'practitioner-v1',
    };
    assert.equal(isPractitionerReviewed(caseOf({ review: base })), true);

    for (const key of Object.keys(base)) {
      const partial = { ...base };
      delete partial[key];
      assert.equal(isPractitionerReviewed(caseOf({ review: partial })), false, `missing ${key} must not count`);
    }
    assert.equal(isPractitionerReviewed(caseOf({ review: { ...base, reviewer_role: 'model_editorial' } })), false);
  });

  it('still needs 100, which is more cases than exist', () => {
    // Worth asserting rather than assuming: reviewing everything currently
    // written would not clear the gate, because there is not enough written.
    assert.equal(REQUIRED_REVIEWED, 100);
    assert.ok(loadCases().length < REQUIRED_REVIEWED);
  });
});

describe('a review packet is readable by someone who has never seen the repository', () => {
  it('shows what was said and what Sanko should record, without JSON', () => {
    const packet = packetFor({ testCase: caseOf() });

    assert.match(packet, /Fun iba, mo n lo ewe dongoyaro/);
    assert.match(packet, /dongoyaro → Azadirachta indica/);
    assert.match(packet, /Yorùbá/);
    assert.doesNotMatch(packet, /[{}]/, 'no raw JSON in front of a reviewer');
  });

  it('asks all four rubric questions and says what approval requires', () => {
    const packet = packetFor({ testCase: caseOf() });
    for (const n of ['1.', '2.', '3.', '4.']) assert.ok(packet.includes(n));
    assert.match(packet, /identify a patient/);
    assert.match(packet, /will not\n.*be used to train it/);
    assert.match(packet, /Approve only if 1, 2 and 4 are YES and 3 is NO/);
  });

  it('says plainly when a plant is expected to stay unconfirmed', () => {
    const packet = packetFor({ testCase: caseOf({ expect: { tools: ['save_formulation'], botanicals: { oganaero: null } } }) });
    assert.match(packet, /oganaero → no botanical name \(left unconfirmed\)/);
  });
});

describe('coverage is measured across what the rubric asks for', () => {
  it('reads the dimensions off a case', () => {
    const dims = dimensionsOf(caseOf({
      turns: ['[voice note transcript]\nMo fi ewe dongoyaro se agbo.'],
      expect: { tools: ['update_formulation'], botanicals: { unknown: null } },
    }));

    assert.equal(dims.language, 'yo');
    assert.equal(dims.voice, true);
    assert.equal(dims.correction, true);
    assert.equal(dims.unknown_plant, true);
    assert.equal(dims.patient, false);
  });

  it('counts a case that expects no tool call as a refusal case', () => {
    assert.equal(dimensionsOf(caseOf({ expect: { tools: [] } })).refusal, true);
  });
});

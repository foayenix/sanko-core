// The promotion gate (F) and the eval-case drafter (E), both pure.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { evaluateGate } = require('../scripts/promote-model');
const { toDraftCase } = require('../scripts/draft-eval-cases');

const scorecard = (model, summary, { cases = 50, reviewed = 100 } = {}) => ({
  file: `2026-09-01__${model}.json`,
  result: {
    model,
    case_set: { practitioner_reviewed: reviewed },
    summary: { cases, errored: 0, hallucinated: 0, passed: 45, ...summary },
    results: [...Array(cases)].map((_, i) => ({ id: `case-${i}` })),
  },
});

const check = (gate, name) => gate.checks.find(entry => entry.name === name);

describe('promotion gate', () => {
  it('passes a candidate that scores higher with no hallucinations', () => {
    const gate = evaluateGate({
      candidate: scorecard('candidate', { mean_score: 0.91 }),
      incumbent: scorecard('incumbent', { mean_score: 0.85 }),
    });

    assert.equal(gate.passed, true);
    assert.equal(gate.delta, 0.06);
  });

  it('refuses a candidate that invents a plant, however well it scores', () => {
    // The rule that outranks the score: recall can be recovered later, a
    // corrupted archive cannot.
    const gate = evaluateGate({
      candidate: scorecard('candidate', { mean_score: 0.99, hallucinated: 1 }),
      incumbent: scorecard('incumbent', { mean_score: 0.85 }),
    });

    assert.equal(gate.passed, false);
    assert.equal(check(gate, 'No hallucinated plants').passed, false);
  });

  it('refuses a score regression', () => {
    const gate = evaluateGate({
      candidate: scorecard('candidate', { mean_score: 0.84 }),
      incumbent: scorecard('incumbent', { mean_score: 0.85 }),
    });

    assert.equal(gate.passed, false);
    assert.equal(check(gate, 'No score regression against the incumbent').passed, false);
  });

  it('refuses two scores taken on different case sets', () => {
    const gate = evaluateGate({
      candidate: scorecard('candidate', { mean_score: 0.95 }, { cases: 8 }),
      incumbent: scorecard('incumbent', { mean_score: 0.85 }, { cases: 50 }),
    });

    assert.equal(gate.passed, false);
    assert.equal(check(gate, 'Scored the same case set as the incumbent').passed, false);
  });

  it('refuses a run that errored, even with a good mean score', () => {
    const gate = evaluateGate({
      candidate: scorecard('candidate', { mean_score: 0.95, errored: 3 }),
      incumbent: scorecard('incumbent', { mean_score: 0.85 }),
    });

    assert.equal(gate.passed, false);
    assert.equal(check(gate, 'Run completed cleanly').passed, false);
  });

  it('refuses a promotion on unreviewed evidence unless it is overridden explicitly', () => {
    const options = {
      candidate: scorecard('candidate', { mean_score: 0.95 }, { reviewed: 0 }),
      incumbent: scorecard('incumbent', { mean_score: 0.85 }, { reviewed: 0 }),
    };

    assert.equal(evaluateGate(options).passed, false);
    assert.equal(evaluateGate({ ...options, allowUnreviewed: true }).passed, true);
  });

  it('refuses a candidate with no scorecard at all', () => {
    const gate = evaluateGate({ candidate: null, incumbent: scorecard('incumbent', { mean_score: 0.85 }) });

    assert.equal(gate.passed, false);
    assert.equal(gate.checks.length, 1);
  });

  it('allows a first promotion with no incumbent to compare against', () => {
    const gate = evaluateGate({ candidate: scorecard('candidate', { mean_score: 0.7 }), incumbent: null });

    assert.equal(gate.passed, true);
    assert.equal(gate.delta, null);
  });
});

describe('eval case drafting', () => {
  const correction = overrides => ({
    id: '9f1c2f6e-1c2b-4a1e-9a3c-1f2b3c4d5e6f',
    field: 'condition_std',
    source: 'practitioner_edit',
    model: 'qwen2.5:32b',
    before_value: 'Fever',
    after_value: 'Malaria',
    formulations: { short_code: 'FM-00247', original_text: 'Mo fi ewe dongoyaro se agbo fun iba', original_language: 'yo' },
    ...overrides,
  });

  it('turns the practitioner fix into the expectation and the transcript into the input', () => {
    const drafted = toDraftCase(correction());

    assert.deepEqual(drafted.turns, ['Mo fi ewe dongoyaro se agbo fun iba']);
    assert.deepEqual(drafted.expect.fields, { condition_std: 'Malaria' });
    assert.equal(drafted.practitioner.preferred_language, 'yo');
  });

  it('expands a plants correction into recall and botanical expectations', () => {
    const drafted = toDraftCase(correction({
      field: 'plants',
      after_value: [{ local_name: 'dongoyaro', botanical: 'Azadirachta indica' }, { local_name: 'ewe ina' }],
    }));

    assert.deepEqual(drafted.expect.plants_include, ['dongoyaro', 'ewe ina']);
    assert.deepEqual(drafted.expect.botanicals, { dongoyaro: 'Azadirachta indica' });
  });

  it('never claims a review it has not had', () => {
    const drafted = toDraftCase(correction());

    // The runner counts only `review` blocks toward the reviewed threshold, and
    // `editorial_review` toward the editorial pass. A draft has had neither.
    assert.ok(!('review' in drafted));
    assert.ok(!('editorial_review' in drafted));
    assert.equal(drafted.draft_origin.status, 'unreviewed');
    assert.match(drafted.description, /NOT REVIEWED/);
    assert.equal(drafted.draft_origin.correction_id, correction().id);
  });

  it('skips a correction with no source transcript — there is no input to test with', () => {
    assert.equal(toDraftCase(correction({ formulations: { short_code: 'FM-1', original_text: null } })), null);
  });

  it('gives every draft a distinct id so two corrections cannot collide', () => {
    const a = toDraftCase(correction());
    const b = toDraftCase(correction({ id: 'aaaaaaaa-1111-2222-3333-444444444444', field: 'dosage' }));

    assert.notEqual(a.id, b.id);
  });
});

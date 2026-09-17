'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isPractitionerReviewed,
  isEditoriallyReviewed,
  validateCase,
  parsePositiveInteger,
} = require('../evals/run');

function validCase() {
  return {
    id: 'reviewed-001',
    description: 'A reviewed routing case.',
    input: 'Show me my saved remedies.',
    expect: { tools: ['list_formulations'] },
    review: {
      status: 'approved',
      reviewer_role: 'practitioner',
      reviewer_ref: 'PR-7F2A',
      reviewed_at: '2026-08-13T14:30:00Z',
      rubric_version: 'practitioner-v1',
    },
  };
}

describe('practitioner-reviewed eval gate', () => {
  it('accepts complete practitioner approval metadata', () => {
    const testCase = validCase();
    assert.equal(isPractitionerReviewed(testCase), true);
    assert.deepEqual(validateCase(testCase, 'case.json'), []);
  });

  it('does not treat admin review or partial metadata as practitioner approval', () => {
    const admin = validCase();
    admin.review.reviewer_role = 'admin';
    assert.equal(isPractitionerReviewed(admin), false);
    assert.match(validateCase(admin, 'admin.json')[0], /reviewer_role=practitioner/);

    const partial = validCase();
    delete partial.review.reviewer_ref;
    assert.equal(isPractitionerReviewed(partial), false);
  });

  it('accepts editorial review while keeping practitioner approval pending', () => {
    const testCase = validCase();
    delete testCase.review;
    testCase.editorial_review = {
      status: 'complete',
      reviewer_role: 'model_editorial',
      reviewer_ref: 'codex-2026-08-13',
      reviewed_at: '2026-08-13T00:00:00Z',
      rubric_version: 'editorial-v1',
      practitioner_review: 'pending',
    };
    assert.equal(isEditoriallyReviewed(testCase), true);
    assert.equal(isPractitionerReviewed(testCase), false);
    assert.deepEqual(validateCase(testCase, 'editorial.json'), []);
  });

  it('rejects cases without a conversation or expectations', () => {
    const testCase = validCase();
    delete testCase.input;
    delete testCase.expect;
    const errors = validateCase(testCase, 'broken.json');
    assert.ok(errors.some(error => error.includes('input')));
    assert.ok(errors.some(error => error.includes('expect')));
  });

  it('rejects a misspelled button expectation instead of quietly asserting nothing', () => {
    const testCase = { ...validCase(), expect: { tools: [], choices: 'require' } };
    assert.match(validateCase(testCase, 'typo.json')[0], /expect\.choices/);

    for (const choices of ['required', 'forbidden']) {
      assert.deepEqual(validateCase({ ...validCase(), expect: { tools: [], choices } }, 'ok.json'), []);
    }
  });

  it('parses only positive integer thresholds', () => {
    assert.equal(parsePositiveInteger(['--require-count', '100'], '--require-count'), 100);
    assert.throws(
      () => parsePositiveInteger(['--require-count', '0'], '--require-count'),
      /positive integer/
    );
  });
});

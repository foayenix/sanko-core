// Model quality attribution (010).
//
// summariseModelQuality is pure, so these run with no database at all.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { summariseModelQuality } = require('../src/services/supabase');

const save = (id, model, extra = {}) => ({ id, model, provider: model ? 'ollama' : null, prompt_version: model ? 'agent-aaaaaaaa' : null, ...extra });
const correction = (id, field, model) => ({ id, field, formulation_id: `f-${id}`, formulations: { model } });

describe('summariseModelQuality', () => {
  it('reports corrections per 100 saves, not a bare correction count', () => {
    const stats = summariseModelQuality(
      [save('f-1', 'old'), save('f-2', 'old'), save('f-3', 'old'), save('f-4', 'old')],
      [correction(1, 'plants', 'old')],
    );

    assert.equal(stats.totalSaves, 4);
    assert.equal(stats.totalCorrections, 1);
    assert.equal(stats.correctionsPer100, 25);
    assert.equal(stats.byModel.old.correctionsPer100, 25);
  });

  it('attributes a correction to the model that produced the record, not the one that recorded the fix', () => {
    // The whole point of 010: a correction landing today against a record the
    // previous adapter wrote must count against the previous adapter.
    const stats = summariseModelQuality(
      [save('f-1', 'incumbent'), save('f-2', 'candidate'), save('f-3', 'candidate')],
      [correction(1, 'plants', 'incumbent'), correction(2, 'dosage', 'incumbent')],
    );

    assert.equal(stats.byModel.incumbent.saves, 1);
    assert.equal(stats.byModel.incumbent.corrections, 2);
    assert.equal(stats.byModel.incumbent.correctionsPer100, 200);
    assert.equal(stats.byModel.candidate.corrections, 0);
    assert.equal(stats.byModel.candidate.correctionsPer100, 0);
  });

  it('separates a candidate that is genuinely better from one that is merely newer', () => {
    const stats = summariseModelQuality(
      [...Array(50)].map((_, i) => save(`a-${i}`, 'incumbent'))
        .concat([...Array(50)].map((_, i) => save(`b-${i}`, 'candidate'))),
      [...Array(15)].map((_, i) => correction(i, 'plants', 'incumbent'))
        .concat([...Array(4)].map((_, i) => correction(100 + i, 'plants', 'candidate'))),
    );

    assert.equal(stats.byModel.incumbent.correctionsPer100, 30);
    assert.equal(stats.byModel.candidate.correctionsPer100, 8);
  });

  it('buckets records saved before instrumentation as unattributed rather than as the current model', () => {
    const stats = summariseModelQuality([save('f-1', null), save('f-2', 'candidate')], []);

    assert.equal(stats.byModel.unattributed.saves, 1);
    assert.equal(stats.byModel.candidate.saves, 1);
    assert.equal(stats.attributedSaves, 1);
    assert.equal(stats.totalSaves, 2);
  });

  it('leaves the rate null when a model has corrections but no saves in the window', () => {
    const stats = summariseModelQuality([], [correction(1, 'plants', 'retired')]);

    assert.equal(stats.byModel.retired.corrections, 1);
    assert.equal(stats.byModel.retired.correctionsPer100, null);
    assert.equal(stats.correctionsPer100, null);
  });

  it('records which fields a model gets wrong most often', () => {
    const stats = summariseModelQuality(
      [save('f-1', 'candidate'), save('f-2', 'candidate')],
      [correction(1, 'plants', 'candidate'), correction(2, 'plants', 'candidate'), correction(3, 'dosage', 'candidate')],
    );

    assert.deepEqual(stats.byModel.candidate.fields, { plants: 2, dosage: 1 });
  });

  it('collects the providers and prompt versions a model ran under', () => {
    const stats = summariseModelQuality(
      [save('f-1', 'candidate'), { ...save('f-2', 'candidate'), prompt_version: 'agent-bbbbbbbb' }],
      [],
    );

    assert.deepEqual(stats.byModel.candidate.providers, ['ollama']);
    assert.deepEqual(stats.byModel.candidate.promptVersions, ['agent-aaaaaaaa', 'agent-bbbbbbbb']);
  });
});

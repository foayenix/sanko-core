// Suggested languages for names a survey printed without one.
//
// The rule is narrow on purpose: the same spelling for the same species is labelled
// in two languages by different surveys often enough (dongoyaro, tafarnuwa) that a
// spelling match alone would publish guesses as facts.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { inferLanguages } = require('../scripts/build-plant-data');

const record = (overrides) => ({
  normalized_name: 'orogbo',
  accepted_botanical: 'Garcinia kola',
  export_eligible: true,
  source_locator: { table: 'Table 1', row: 1 },
  ...overrides,
});

const sources = [
  { id: 'unlabelled', languages: ['yo', 'nup'] },
  { id: 'a', languages: ['yo'] },
  { id: 'b', languages: ['yo'] },
  { id: 'c', languages: ['ig'] },
  { id: 'no-languages', languages: [] },
];

const run = (...names) => {
  inferLanguages(names, sources);
  return names[0].language_inference;
};

describe('language inference', () => {
  it('suggests the one language other surveys give for the same name and species', () => {
    const inference = run(
      record({ source_id: 'unlabelled', language: null }),
      record({ source_id: 'a', language: 'yo' }),
      record({ source_id: 'b', language: 'yo' }),
    );
    assert.equal(inference.language, 'yo');
    assert.equal(inference.strength, 'multiple_sources');
    assert.deepEqual(inference.supporting.map((entry) => entry.source_id), ['a', 'b']);
  });

  it('never changes the language the survey printed', () => {
    const unlabelled = record({ source_id: 'unlabelled', language: null });
    run(unlabelled, record({ source_id: 'a', language: 'yo' }));
    assert.equal(unlabelled.language, null);
  });

  it('marks a single supporting survey as weaker', () => {
    assert.equal(run(record({ source_id: 'unlabelled', language: null }), record({ source_id: 'a', language: 'yo' })).strength, 'single_source');
  });

  it('refuses when other surveys disagree on the language', () => {
    const inference = run(
      record({ source_id: 'unlabelled', language: null }),
      record({ source_id: 'a', language: 'yo' }),
      record({ source_id: 'c', language: 'ig' }),
    );
    assert.equal(inference.language, null);
    assert.deepEqual(inference.candidates, ['ig', 'yo']);
  });

  it('refuses a language the survey does not say it recorded', () => {
    const inference = run(record({ source_id: 'unlabelled', language: null }), record({ source_id: 'c', language: 'ig' }));
    assert.equal(inference.language, null);
    assert.match(inference.reason, /not a language this survey says it recorded/);
  });

  it('suggests nothing for a survey that lists no languages', () => {
    assert.equal(run(record({ source_id: 'no-languages', language: null }), record({ source_id: 'a', language: 'yo' })).language, null);
  });

  it('ignores the same spelling recorded for a different species', () => {
    assert.equal(
      run(record({ source_id: 'unlabelled', language: null }), record({ source_id: 'a', language: 'yo', accepted_botanical: 'Cola nitida' })),
      undefined,
    );
  });

  it('does not count records from the same survey as support', () => {
    assert.equal(run(record({ source_id: 'unlabelled', language: null }), record({ source_id: 'unlabelled', language: 'yo' })), undefined);
  });
});

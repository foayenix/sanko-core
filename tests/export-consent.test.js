// The consent gate on training exports.
//
// The rule under test: a practitioner's corrections cannot be trained on unless
// that practitioner accepted the contributor terms as they stand now, and what
// was used is written into the knowledge-use ledger. Both export scripts went
// through neither check before this; the terms have never been in force, so the
// correct behaviour of an export today is to refuse.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeDb } = require('./helpers/fakeDb');
const governance = require('../src/services/governance');
const consent = require('../scripts/export-consent');
const { splitFor } = require('../scripts/export-training-data');

let fake;
beforeEach(() => { fake = installFakeDb(); });
afterEach(() => { fake.restore(); delete process.env.CONTRIBUTOR_TERMS_IN_FORCE; });

function accepted(overrides = {}) {
  const current = governance.currentTerms();
  return fake.store.seedPractitioner({
    contributor_terms_version: current.version,
    contributor_terms_accepted_at: '2026-09-01T00:00:00Z',
    contributor_terms_hash: current.hash,
    ...overrides,
  });
}

const rows = (practitioner_id, count) =>
  [...Array(count)].map((_, i) => ({ id: `c-${practitioner_id}-${i}`, practitioner_id }));

describe('training exports are gated on contributor consent', () => {
  it('excludes a practitioner who never accepted the terms', async () => {
    const consenting = accepted();
    const silent = fake.store.seedPractitioner();

    const screened = await consent.screen([...rows(consenting.id, 2), ...rows(silent.id, 3)]);

    assert.equal(screened.eligible.length, 2);
    assert.equal(screened.excluded.length, 3);
    assert.match(screened.reasons.get(silent.id), /has not accepted/);
    assert.deepEqual(screened.contributors, [
      { practitioner_id: consenting.id, record_count: 2, terms_version: governance.currentTerms().version },
    ]);
  });

  it('excludes a practitioner whose accepted text has since changed', async () => {
    // A hash that no longer matches is a re-consent, not a technicality: they
    // agreed to something that is not what the export would now be governed by.
    const stale = accepted({ contributor_terms_hash: '0000000000000000', contributor_terms_version: 'v0-old' });

    const screened = await consent.screen(rows(stale.id, 4));

    assert.equal(screened.eligible.length, 0);
    assert.match(screened.reasons.get(stale.id), /not the current text/);
  });

  it('excludes records that cannot be attributed to anyone', async () => {
    // "We could not tell whose this was" is not a permission.
    const screened = await consent.screen([{ id: 'c-orphan', practitioner_id: null }]);

    assert.equal(screened.eligible.length, 0);
    assert.equal(screened.excluded.length, 1);
    assert.match(screened.reasons.get(null), /no practitioner id/);
  });

  it('excludes a practitioner id with no practitioner behind it', async () => {
    const screened = await consent.screen(rows('missing-id', 1));
    assert.equal(screened.eligible.length, 0);
    assert.match(screened.reasons.get('missing-id'), /no such practitioner/);
  });

  it('names every excluded practitioner rather than counting them', async () => {
    const a = fake.store.seedPractitioner();
    const b = fake.store.seedPractitioner();

    const screened = await consent.screen([...rows(a.id, 1), ...rows(b.id, 1)]);
    const report = screened.report.join('\n');

    assert.match(report, new RegExp(a.id));
    assert.match(report, new RegExp(b.id));
  });

  it('says the terms are not in force when nothing may be exported', async () => {
    // The failure an operator actually hits today, and the one that must not
    // read like an empty database.
    assert.equal(governance.currentTerms().in_force, false);
    const text = consent.refusalText(12);

    assert.match(text, /Nothing may be exported/);
    assert.match(text, /NOT IN FORCE/);
    assert.match(text, /12 correction/);
  });
});

describe('an export records what it used', () => {
  it('refuses to run without the ledger fields', () => {
    assert.throws(
      () => consent.requireUseDetails([], { command: 'export-training-data.js' }),
      /--recorded-by.*--counterparty.*--purpose.*--benefit-terms/s,
    );
  });

  it('refuses a ledger entry with no stated benefit', () => {
    assert.throws(
      () => consent.requireUseDetails(
        ['--recorded-by', 'OP-4C21', '--counterparty', 'Sanko', '--purpose', 'LoRA', '--benefit-terms', '  '],
        { command: 'export-training-data.js' },
      ),
      /--benefit-terms/,
    );
  });

  it('writes a dataset_export into the ledger with each contributor', async () => {
    const one = accepted();
    const two = accepted();

    const use = await consent.recordExport({
      contributors: [
        { practitioner_id: one.id, record_count: 5 },
        { practitioner_id: two.id, record_count: 2 },
      ],
      details: {
        recorded_by: 'OP-4C21',
        counterparty: 'Sanko — internal fine-tune',
        purpose: 'LoRA adapter for formulation extraction',
        benefit_terms: 'Improved extraction in their own language; no redistribution',
      },
      scope: { dataset: 'text_extraction_lora', correction_count: 7 },
    });

    assert.equal(use.use_type, 'dataset_export');
    assert.equal(use.contributors.length, 2);
    assert.equal(fake.store.knowledgeUseContributors.length, 2);

    // The practitioner can then see it, which is the point of the ledger.
    const statement = await governance.contributorStatement(one.id);
    assert.equal(statement.uses.length, 1);
    assert.equal(statement.uses[0].use_type, 'dataset_export');
    assert.equal(statement.uses[0].records_included, 5);
  });

  it('refuses a ledger entry naming a practitioner who has not accepted', async () => {
    const silent = fake.store.seedPractitioner();
    await assert.rejects(
      consent.recordExport({
        contributors: [{ practitioner_id: silent.id, record_count: 1 }],
        details: {
          recorded_by: 'OP-4C21',
          counterparty: 'Sanko',
          purpose: 'LoRA',
          benefit_terms: 'Improved extraction',
        },
        scope: {},
      }),
      /cannot be included in a knowledge use/,
    );
    assert.equal(fake.store.knowledgeUse.length, 0);
  });
});

describe('the train/test split is grouped by practitioner', () => {
  it('puts every correction from one practitioner in the same split', () => {
    const id = 'practitioner-fixed';
    const splits = new Set([...Array(20)].map(() => splitFor(id)));
    assert.equal(splits.size, 1);
  });

  it('refuses to split a correction with no practitioner id', () => {
    // The fallback this replaces bucketed by correction id, which turned a
    // per-practitioner split into a per-row one — one person's phrasing in both
    // train and test, and nothing in the output to show it.
    assert.throws(() => splitFor(null), /grouped by practitioner/);
    assert.throws(() => splitFor(undefined), /grouped by practitioner/);
  });

  it('spreads practitioners across all three splits', () => {
    const seen = new Set([...Array(200)].map((_, i) => splitFor(`practitioner-${i}`)));
    assert.deepEqual([...seen].sort(), ['test', 'train', 'valid']);
  });
});

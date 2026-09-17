// Contributor terms and the knowledge-use ledger (013).
//
// The rule under test: knowledge cannot be used beyond a practitioner's own
// Vault unless that practitioner agreed to the terms currently in the tree, and
// the use has to record what they get in return.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeDb } = require('./helpers/fakeDb');
const governance = require('../src/services/governance');

let fake;
beforeEach(() => { fake = installFakeDb(); });
afterEach(() => { fake.restore(); delete process.env.CONTRIBUTOR_TERMS_IN_FORCE; });

const terms = () => governance.currentTerms();

function acceptedPractitioner(overrides = {}) {
  const current = terms();
  return fake.store.seedPractitioner({
    contributor_terms_version: current.version,
    contributor_terms_accepted_at: '2026-09-01T00:00:00Z',
    contributor_terms_hash: current.hash,
    ...overrides,
  });
}

const use = overrides => ({
  use_type: 'research_access',
  counterparty: 'University of Ibadan, Dept. of Pharmacognosy',
  purpose: 'Comparative study of antimalarial preparations',
  scope: { formulation_short_codes: ['FM-00012'] },
  benefit_terms: 'Named co-authorship; copy of findings in Yoruba',
  agreed_at: '2026-09-01T00:00:00Z',
  recorded_by: 'OP-4C21',
  ...overrides,
});

describe('contributor terms', () => {
  it('is marked not in force until a lawyer and the practitioners have seen it', () => {
    // The code should not be the place that forgets this.
    assert.equal(terms().in_force, false);
    assert.match(terms().version, /draft/);
  });

  it('refuses to record an acceptance while the terms are not in force', async () => {
    const practitioner = fake.store.seedPractitioner();
    await assert.rejects(
      governance.recordAcceptance({ practitioner_id: practitioner.id, method: 'in_person' }),
      /not in force/,
    );
    assert.equal(fake.store.eventsOfType('contributor_terms_accepted').length, 0);
  });

  it('records acceptance against the exact text, not just a version label', async () => {
    process.env.CONTRIBUTOR_TERMS_IN_FORCE = 'true';
    const practitioner = fake.store.seedPractitioner();
    await governance.recordAcceptance({ practitioner_id: practitioner.id, method: 'in_person' });

    const stored = fake.store.practitioners.find(row => row.id === practitioner.id);
    assert.equal(stored.contributor_terms_hash, terms().hash);
    assert.equal(stored.contributor_terms_method, 'in_person');
    assert.equal(fake.store.eventsOfType('contributor_terms_accepted').length, 1);
  });
});

describe('eligibility for a knowledge use', () => {
  it('excludes a practitioner who has never accepted', () => {
    assert.equal(governance.eligibility({}).eligible, false);
  });

  it('excludes a practitioner whose acceptance predates a change to the terms', () => {
    // Editing the terms cannot retroactively produce agreement to them.
    const verdict = governance.eligibility({
      contributor_terms_accepted_at: '2026-01-01T00:00:00Z',
      contributor_terms_version: 'v0',
      contributor_terms_hash: 'a-different-hash',
    });
    assert.equal(verdict.eligible, false);
    assert.match(verdict.reason, /asked again/);
  });

  it('admits a practitioner who accepted the current text', () => {
    assert.equal(governance.eligibility(acceptedPractitioner()).eligible, true);
  });
});

describe('recording a knowledge use', () => {
  it('records the use, its contributors, and the basis each of them agreed on', async () => {
    const practitioner = acceptedPractitioner();

    const recorded = await governance.recordKnowledgeUse(use({
      contributors: [{ practitioner_id: practitioner.id, record_count: 4 }],
    }));

    assert.equal(recorded.contributors.length, 1);
    assert.equal(recorded.contributors[0].terms_version, terms().version);
    assert.equal(fake.store.knowledgeUse.length, 1);
    assert.equal(fake.store.knowledgeUseContributors[0].record_count, 4);
  });

  it('refuses when any contributor has not accepted, and names all of them', async () => {
    // The refusal is the mechanism. Everything else is bookkeeping.
    const accepted = acceptedPractitioner();
    const never = fake.store.seedPractitioner();
    const stale = fake.store.seedPractitioner({
      contributor_terms_accepted_at: '2026-01-01T00:00:00Z',
      contributor_terms_version: 'v0',
      contributor_terms_hash: 'old-hash',
    });

    await assert.rejects(
      () => governance.recordKnowledgeUse(use({
        contributors: [accepted, never, stale].map(p => ({ practitioner_id: p.id, record_count: 1 })),
      })),
      err => {
        assert.match(err.message, /2 of 3 contributor/);
        assert.ok(err.message.includes(never.id));
        assert.ok(err.message.includes(stale.id));
        return true;
      },
    );

    // Nothing partial was written.
    assert.equal(fake.store.knowledgeUse.length, 0);
    assert.equal(fake.store.knowledgeUseContributors.length, 0);
  });

  it('refuses a use with no agreed benefit', async () => {
    const practitioner = acceptedPractitioner();
    await assert.rejects(
      () => governance.recordKnowledgeUse(use({
        benefit_terms: '',
        contributors: [{ practitioner_id: practitioner.id, record_count: 1 }],
      })),
      /benefit_terms is required/,
    );
  });

  it('refuses a use recorded by something that is not a pseudonymous operator', async () => {
    const practitioner = acceptedPractitioner();
    for (const recorded_by of ['felix', 'ade@example.com', '']) {
      await assert.rejects(
        () => governance.recordKnowledgeUse(use({
          recorded_by,
          contributors: [{ practitioner_id: practitioner.id, record_count: 1 }],
        })),
        /pseudonymous operator reference/,
        recorded_by,
      );
    }
  });

  it('refuses a use with no contributors and an unknown use type', async () => {
    await assert.rejects(() => governance.recordKnowledgeUse(use({ contributors: [] })), /no contributors/);
    const practitioner = acceptedPractitioner();
    await assert.rejects(
      () => governance.recordKnowledgeUse(use({
        use_type: 'sale',
        contributors: [{ practitioner_id: practitioner.id, record_count: 1 }],
      })),
      /use_type must be one of/,
    );
  });
});

describe('what a practitioner is entitled to know', () => {
  it('answers what has been done with their knowledge and what they were owed', async () => {
    const practitioner = acceptedPractitioner();
    await governance.recordKnowledgeUse(use({
      contributors: [{ practitioner_id: practitioner.id, record_count: 4 }],
    }));

    const statement = await governance.contributorStatement(practitioner.id);

    assert.equal(statement.uses.length, 1);
    assert.equal(statement.uses[0].counterparty, 'University of Ibadan, Dept. of Pharmacognosy');
    assert.equal(statement.uses[0].benefit_terms, 'Named co-authorship; copy of findings in Yoruba');
    assert.equal(statement.uses[0].records_included, 4);
  });

  it('reports nothing for a practitioner whose knowledge has never left their Vault', async () => {
    const practitioner = acceptedPractitioner();
    assert.deepEqual((await governance.contributorStatement(practitioner.id)).uses, []);
  });
});

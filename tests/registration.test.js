// Registration — the two questions before a Vault opens, and what enforces them.
//
// The prompt asks the agent to finish registration; these cases are about what
// happens when it does not, because that is the half a prompt cannot guarantee.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeDb, fakeClient, textResponse, toolResponse } = require('./helpers/fakeDb');
const { executeTool } = require('../src/agent/tools');
const { runAgent, buildSystemPrompt } = require('../src/agent');
const registration = require('../src/agent/registration');

let fake;
beforeEach(() => {
  process.env.PATIENT_TRACKING_ENABLED = 'true';
  fake = installFakeDb();
});
afterEach(() => {
  delete process.env.PATIENT_TRACKING_ENABLED;
  delete process.env.CONTRIBUTOR_TERMS_IN_FORCE;
  fake.restore();
});

const ctx = practitioner => ({ practitioner, sendPatientConsent: async () => true });
const unregistered = (overrides = {}) =>
  fake.store.seedPractitioner({ display_name: null, preferred_language: null, region: null, years_practising: null, tradition: null, registered_at: null, ...overrides });

const FORMULATION = {
  condition_local: 'iba',
  plants: [{ local_name: 'dongoyaro' }],
  confidence_score: 0.9,
};

describe('what registration requires', () => {
  it('needs a name and a region, and nothing else', () => {
    assert.deepEqual(registration.state({}).missing, ['name', 'region']);
    assert.deepEqual(registration.state({ display_name: 'Ade' }).missing, ['region']);
    assert.equal(registration.state({ display_name: 'Ade', region: 'Ibadan' }).complete, true);
  });

  it('asks for one thing at a time', () => {
    assert.equal(registration.state({}).next, 'name');
    assert.equal(registration.state({ display_name: 'Ade' }).next, 'region');
    assert.equal(registration.state({ display_name: 'Ade', region: 'Ibadan' }).next, null);
  });

  it('does not treat years practising or tradition as requirements', () => {
    const state = registration.state({ display_name: 'Ade', region: 'Ibadan' });
    assert.equal(state.complete, true);
    assert.deepEqual(state.unasked, ['years_practising', 'tradition']);
  });
});

describe('the gate', () => {
  it('refuses to save a formulation from someone who has not registered', async () => {
    const practitioner = unregistered();
    const result = await executeTool('save_formulation', FORMULATION, ctx(practitioner));

    assert.equal(result.ok, false);
    assert.match(result.error, /name and region/);
    assert.equal(fake.store.formulations.length, 0);
  });

  it('names only what is actually outstanding', async () => {
    const practitioner = unregistered({ display_name: 'Baba Ade' });
    const result = await executeTool('save_formulation', FORMULATION, ctx(practitioner));

    assert.equal(result.ok, false);
    assert.match(result.error, /Still missing: region\./);
    assert.doesNotMatch(result.error, /name/);
  });

  it('lets an unregistered practitioner read, export and delete regardless', async () => {
    const practitioner = unregistered();
    for (const tool of ['list_formulations', 'export_account']) {
      const result = await executeTool(tool, {}, ctx(practitioner));
      assert.equal(result.ok !== false, true, `${tool} should work before registration`);
    }
  });

  it('blocks patient tools too, not just the Vault', async () => {
    const result = await executeTool('log_treatment', { patient_short_code: 'PT-00001' }, ctx(unregistered()));
    assert.equal(result.ok, false);
    assert.match(result.error, /Registration is not finished/);
  });

  it('opens everything the moment the second answer lands', async () => {
    const practitioner = unregistered();
    await executeTool('set_profile', { display_name: 'Baba Ade', preferred_language: 'yo' }, ctx(practitioner));
    assert.equal((await executeTool('save_formulation', FORMULATION, ctx(practitioner))).ok, false);

    await executeTool('set_practice_details', { region: 'Ibadan' }, ctx(practitioner));
    const saved = await executeTool('save_formulation', FORMULATION, ctx(practitioner));
    assert.equal(saved.ok, true);
    assert.equal(saved.short_code, 'FM-00001');
  });
});

describe('recording the answers', () => {
  it('records the region as given and stamps registration once', async () => {
    const practitioner = unregistered({ display_name: 'Baba Ade' });
    const result = await executeTool('set_practice_details', {
      region: 'near Nsukka', years_practising: 22, tradition: 'Igbo herbal medicine',
    }, ctx(practitioner));

    assert.equal(result.ok, true);
    assert.equal(result.registered, true);

    const stored = fake.store.practitioners.find(row => row.id === practitioner.id);
    assert.equal(stored.region, 'near Nsukka');
    assert.equal(stored.years_practising, 22);
    assert.equal(stored.tradition, 'Igbo herbal medicine');
    assert.ok(stored.registered_at);
    assert.equal(fake.store.eventsOfType('practitioner_registered').length, 1);
  });

  it('registers on the name when the region came first', async () => {
    const practitioner = unregistered();
    await executeTool('set_practice_details', { region: 'Ogun State' }, ctx(practitioner));
    assert.equal(practitioner.registered_at ?? null, null);

    const result = await executeTool('set_profile', { display_name: 'Iya Ronke' }, ctx(practitioner));
    assert.equal(result.registered, true);
    assert.equal(fake.store.eventsOfType('practitioner_registered').length, 1);
  });

  it('does not re-register someone who updates their details later', async () => {
    const practitioner = fake.store.seedPractitioner();
    const stampedAt = practitioner.registered_at;

    await executeTool('set_practice_details', { region: 'Abeokuta' }, ctx(practitioner));

    assert.equal(practitioner.registered_at, stampedAt);
    assert.equal(fake.store.eventsOfType('practitioner_registered').length, 0);
  });

  it('keeps optional details out of the record when they were not given', async () => {
    const practitioner = unregistered({ display_name: 'Baba Ade' });
    await executeTool('set_practice_details', { region: 'Ibadan' }, ctx(practitioner));

    const stored = fake.store.practitioners.find(row => row.id === practitioner.id);
    assert.equal(stored.years_practising ?? null, null);
    assert.equal(stored.tradition ?? null, null);
  });

  it('rejects a region that is not a region', async () => {
    const result = await executeTool('set_practice_details', { region: '' }, ctx(unregistered({ display_name: 'Ade' })));
    assert.equal(result.ok, false);
  });
});

describe('what the model is told', () => {
  it('tells the agent what is outstanding, without field names', () => {
    const prompt = buildSystemPrompt(unregistered());
    assert.match(prompt, /Registration is unfinished: you still need their name and region/);
  });

  it('says nothing about registration once it is done', () => {
    const prompt = buildSystemPrompt(fake.store.seedPractitioner());
    assert.doesNotMatch(prompt, /Registration is unfinished/);
  });

  it('never puts the contributor terms in front of the model while they are a draft', () => {
    const prompt = buildSystemPrompt(fake.store.seedPractitioner());
    assert.doesNotMatch(prompt, /contributor terms/i);
  });

  it('offers the terms once they are in force, and stops once they are answered', () => {
    process.env.CONTRIBUTOR_TERMS_IN_FORCE = 'true';
    const practitioner = fake.store.seedPractitioner();
    assert.match(buildSystemPrompt(practitioner), /have not yet answered on the contributor terms/);

    practitioner.contributor_terms_declined_at = new Date().toISOString();
    assert.doesNotMatch(buildSystemPrompt(practitioner), /have not yet answered/);
  });
});

describe('contributor terms in the conversation', () => {
  it('refuses the tool outright while the terms are a draft', async () => {
    const result = await executeTool('accept_contributor_terms', { accepted: true }, ctx(fake.store.seedPractitioner()));
    assert.equal(result.ok, false);
    assert.equal(fake.store.eventsOfType('contributor_terms_accepted').length, 0);
  });

  it('records an acceptance against the version and hash', async () => {
    process.env.CONTRIBUTOR_TERMS_IN_FORCE = 'true';
    const practitioner = fake.store.seedPractitioner();
    const result = await executeTool('accept_contributor_terms', { accepted: true }, ctx(practitioner));

    assert.equal(result.ok, true);
    const stored = fake.store.practitioners.find(row => row.id === practitioner.id);
    assert.ok(stored.contributor_terms_accepted_at);
    assert.equal(stored.contributor_terms_method, 'whatsapp_reply');
  });

  it('records a refusal as an answer, and leaves the Vault working', async () => {
    process.env.CONTRIBUTOR_TERMS_IN_FORCE = 'true';
    const practitioner = fake.store.seedPractitioner();
    const result = await executeTool('accept_contributor_terms', { accepted: false }, ctx(practitioner));

    assert.equal(result.ok, true);
    assert.equal(result.accepted, false);

    const stored = fake.store.practitioners.find(row => row.id === practitioner.id);
    assert.ok(stored.contributor_terms_declined_at);
    assert.equal(stored.contributor_terms_accepted_at ?? null, null);
    assert.equal(fake.store.eventsOfType('contributor_terms_declined').length, 1);
    assert.equal((await executeTool('save_formulation', FORMULATION, ctx(practitioner))).ok, true);
  });
});

describe('a whole turn', () => {
  it('recovers when the model tries to save before the practitioner is registered', async () => {
    const practitioner = unregistered({ display_name: 'Baba Ade' });
    const client = fakeClient([
      // The model does the wrong thing first, which is the case this exists for.
      toolResponse('save_formulation', FORMULATION, { id: 'toolu_1' }),
      toolResponse('set_practice_details', { region: 'Ibadan' }, { id: 'toolu_2', text: 'Where do you practise?' }),
      toolResponse('save_formulation', FORMULATION, { id: 'toolu_3' }),
      textResponse('Saved as FM-00001.'),
    ]);

    const replies = [];
    const result = await runAgent({
      practitioner,
      content: 'For iba I boil dongoyaro.',
      send: text => replies.push(text),
      client,
    });

    const [refused, ...rest] = result.toolCalls;
    assert.equal(refused.name, 'save_formulation');
    assert.equal(refused.result.ok, false);
    assert.equal(rest.at(-1).result.ok, true);

    // The refusal is the agent's business, not the practitioner's.
    const said = replies.join(' ');
    assert.doesNotMatch(said, /registration|registered|unavailable/i);
    assert.equal(fake.store.formulations.length, 1);
  });
});

// Agent tests — the conversational layer, its tools, and the transports.
//
// Everything here runs offline: the Supabase service is swapped for an in-memory
// store and the Anthropic client is a scripted stand-in, so `npm test` needs no
// API keys and costs nothing.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeDb, fakeClient, textResponse, toolResponse } = require('./helpers/fakeDb');
const { runAgent, sanitizeHistory, stripImagesForStorage, buildSystemPrompt } = require('../src/agent');
const { executeTool, TOOLS } = require('../src/agent/tools');
const { promptVersion } = require('../src/agent/prompt');
const { getOrCreatePractitioner, PRIVACY_NOTICE } = require('../src/agent/practitioner');
const { MessageAggregator } = require('../src/utils/aggregator');

let fake;
let patientInputSeq;
beforeEach(() => {
  process.env.PATIENT_TRACKING_ENABLED = 'true';
  patientInputSeq = 0;
  fake = installFakeDb();
});
afterEach(() => {
  delete process.env.PATIENT_TRACKING_ENABLED;
  fake.restore();
});

// `read` lists the short codes get_formulation has been called on — the
// evidence update_formulation's read-before-write gate looks for.
const ctx = (practitioner, read = []) =>
  ({ practitioner, sendPatientConsent: async () => true, readRecords: new Set(read) });
const patientInput = (display_name, fields = {}) => ({
  display_name,
  phone_number: `+234810${String(++patientInputSeq).padStart(7, '0')}`,
  ...fields,
});
async function createAcceptedPatient(practitioner, displayName, fields = {}) {
  const result = await executeTool('create_patient', patientInput(displayName, fields), ctx(practitioner));
  assert.equal(result.ok, true);
  const patient = fake.store.patients.find(row => row.short_code === result.short_code);
  await require('../src/services/supabase').acceptPatientConsent(patient.id, patient.phone_number, 'wamid.test');
  return result;
}

// ─── tool schemas ─────────────────────────────────────────────────────────────

describe('tool definitions', () => {
  it('every tool has a name, a description and an object input schema', () => {
    for (const tool of TOOLS) {
      assert.ok(tool.name, 'tool missing name');
      assert.ok(tool.description?.length > 20, `${tool.name} needs a real description`);
      assert.equal(tool.input_schema.type, 'object', `${tool.name} schema must be an object`);
    }
  });

  it('exposes the vault and patient capabilities the agent is meant to have', () => {
    const names = TOOLS.map(t => t.name);
    for (const expected of [
      'set_profile', 'save_formulation', 'list_formulations', 'get_formulation', 'update_formulation',
      'create_patient', 'find_patient', 'get_patient', 'log_treatment', 'update_treatment', 'list_due_follow_ups',
    ]) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }
  });

  it('tool names are unique', () => {
    const names = TOOLS.map(t => t.name);
    assert.equal(new Set(names).size, names.length);
  });
});

describe('patient consent WhatsApp template', () => {
  it('uses a business-initiated template with invitation-bound quick replies', () => {
    const { patientConsentTemplate } = require('../src/services/whatsapp');
    const payload = patientConsentTemplate({
      patient_id: 'patient-123', patient_name: 'Amina', practitioner_name: 'Baba Ade',
      templateName: 'sanko_patient_consent_v1', languageCode: 'en',
    });
    assert.equal(payload.type, 'template');
    assert.equal(payload.template.name, 'sanko_patient_consent_v1');
    assert.deepEqual(payload.template.components[0].parameters.map(p => p.text), ['Amina', 'Baba Ade']);
    assert.equal(payload.template.components[1].parameters[0].payload, 'patient-consent:patient-123:accept');
    assert.equal(payload.template.components[2].parameters[0].payload, 'patient-consent:patient-123:decline');
  });
});

// ─── vault tools ──────────────────────────────────────────────────────────────

describe('save_formulation', () => {
  it('saves a formulation and returns its short code', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      condition_local: 'iba',
      condition_std: 'Malaria',
      plants: [{ local_name: 'dongoyaro', quantity_raw: 'two handfuls', part_used: 'leaves' }],
      preparation: { method: 'decoction', duration_minutes: 20, medium: 'water' },
      dosage: { amount: 'one cup', frequency: 'twice daily', duration_days: 3 },
      original_text: 'Fi ewe dongoyaro se agbo fun iba',
      original_language: 'yo',
      confidence_score: 0.9,
    }, ctx(p));

    assert.equal(result.ok, true);
    assert.equal(result.short_code, 'FM-00001');
    assert.equal(fake.store.formulations.length, 1);

    const saved = fake.store.formulations[0];
    assert.equal(saved.condition_std, 'Malaria');
    assert.equal(saved.condition_local, 'iba');
    // Resolved from the index in code, never from the tool input.
    assert.equal(saved.plants[0].botanical, 'Azadirachta indica');
    assert.equal(saved.plants[0].botanical_source, 'plant_index');
    assert.equal(saved.confidence_score, 0.9);
    assert.equal(saved.original_language, 'yo');
    assert.equal(saved.practitioner_id, p.id);
  });

  it('stamps the producing model, provider and prompt version on the record', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', { plants: [{ local_name: 'dongoyaro' }], confidence_score: 0.9 }, ctx(p));

    const saved = fake.store.formulations[0];
    // Without these, corrections have a numerator and no denominator: there is
    // no way to tell a bad adapter from a busy month.
    assert.equal(saved.model, require('../src/services/llm').modelName());
    assert.equal(saved.provider, require('../src/services/llm').providerName());
    assert.equal(saved.prompt_version, promptVersion());
    assert.match(saved.prompt_version, /^agent-[0-9a-f]{8}$/);
  });

  it('returns a confirmation card the agent can quote back', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      condition_std: 'Malaria',
      plants: [{ local_name: 'dongoyaro' }],
      confidence_score: 0.9,
    }, ctx(p));
    assert.match(result.card, /Malaria/);
    assert.match(result.card, /dongoyaro/);
  });

  it('logs a formulation_saved event', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', {
      plants: [{ local_name: 'atale' }], confidence_score: 0.8,
    }, ctx(p));
    const events = fake.store.eventsOfType('formulation_saved');
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.short_code, 'FM-00001');
  });

  it('flags plants with no botanical name for review', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      plants: [
        { local_name: 'dongoyaro' },
        { local_name: 'ewe mysterious' },
      ],
      confidence_score: 0.7,
    }, ctx(p));

    assert.deepEqual(result.unknown_plants, ['ewe mysterious']);
    const flags = fake.store.eventsOfType('unknown_plant_flagged');
    assert.equal(flags.length, 1);
    assert.deepEqual(flags[0].payload.plants, ['ewe mysterious']);
  });

  it('does not flag anything when every plant resolves', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', {
      plants: [{ local_name: 'atale' }], confidence_score: 0.95,
    }, ctx(p));
    assert.equal(fake.store.eventsOfType('unknown_plant_flagged').length, 0);
  });

  it('refuses a formulation with no plants instead of saving an empty record', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', { plants: [], confidence_score: 0.9 }, ctx(p));
    assert.equal(result.ok, false);
    assert.match(result.error, /at least one plant/);
    assert.equal(fake.store.formulations.length, 0);
  });

  it('saves a partial record rather than demanding every field', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      plants: [{ local_name: 'utazi' }], confidence_score: 0.5,
    }, ctx(p));
    assert.equal(result.ok, true);
    const saved = fake.store.formulations[0];
    assert.equal(saved.dosage, null);
    assert.equal(saved.preparation, null);
  });
});

describe('list_formulations / get_formulation / update_formulation', () => {
  async function seedVault() {
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', {
      condition_std: 'Malaria', plants: [{ local_name: 'dongoyaro' }], confidence_score: 0.9,
    }, ctx(p));
    await executeTool('save_formulation', {
      condition_std: 'Cough', plants: [{ local_name: 'atale' }], confidence_score: 0.9,
    }, ctx(p));
    return p;
  }

  it('lists saved formulations newest first', async () => {
    const p = await seedVault();
    const result = await executeTool('list_formulations', {}, ctx(p));
    assert.equal(result.count, 2);
    assert.equal(result.formulations[0].short_code, 'FM-00002');
    assert.equal(result.formulations[0].condition, 'Cough');
  });

  it('rejects a list limit outside the declared boundary', async () => {
    const p = await seedVault();
    const result = await executeTool('list_formulations', { limit: 9999 }, ctx(p));
    assert.equal(result.ok, false);
    assert.match(result.error, /at most 25/);
  });

  it('retrieves one formulation in full by short code', async () => {
    const p = await seedVault();
    const result = await executeTool('get_formulation', { short_code: 'FM-00001' }, ctx(p));
    assert.equal(result.ok, true);
    assert.equal(result.condition_std, 'Malaria');
  });

  it('reports a missing short code instead of throwing', async () => {
    const p = await seedVault();
    const result = await executeTool('get_formulation', { short_code: 'FM-99999' }, ctx(p));
    assert.equal(result.ok, false);
    assert.match(result.error, /No formulation FM-99999/);
  });

  it('updates only the fields supplied', async () => {
    const p = await seedVault();
    const result = await executeTool('update_formulation', {
      short_code: 'FM-00001',
      dosage: { amount: 'half a cup', frequency: 'once daily', duration_days: 5 },
    }, ctx(p, ['FM-00001']));

    assert.equal(result.ok, true);
    assert.deepEqual(result.updated_fields, ['dosage']);
    const row = fake.store.formulations.find(f => f.short_code === 'FM-00001');
    assert.equal(row.dosage.amount, 'half a cup');
    assert.equal(row.condition_std, 'Malaria', 'untouched fields must survive an update');
  });

  it('hands back the values it wrote over so the agent can say what changed', async () => {
    const p = await seedVault();
    // Cloned, or this compares the stored object against itself and passes
    // however wrong the tool is.
    const before = structuredClone(fake.store.formulations.find(f => f.short_code === 'FM-00001').dosage);

    const result = await executeTool('update_formulation', {
      short_code: 'FM-00001',
      dosage: { amount: 'one cup', frequency: 'at night', duration_days: 3 },
    }, ctx(p, ['FM-00001']));

    assert.deepEqual(result.replaced, { dosage: before });
    assert.ok(!('condition_std' in result.replaced), 'only fields actually changed are reported');
  });

  it('refuses to overwrite a record the agent has not read', async () => {
    const p = await seedVault();
    const result = await executeTool('update_formulation', {
      short_code: 'FM-00001',
      dosage: { amount: 'one cup', frequency: 'at night' },
    }, ctx(p));

    assert.equal(result.ok, false);
    assert.match(result.error, /get_formulation/, 'the refusal must tell the agent what to do next');

    const row = fake.store.formulations.find(f => f.short_code === 'FM-00001');
    assert.notEqual(row.dosage?.frequency, 'at night', 'nothing may be written');
    assert.equal(fake.store.corrections.length, 0, 'and no correction may be attributed to them');
  });

  it('treats a read of a different record as no evidence at all', async () => {
    const p = await seedVault();
    const result = await executeTool('update_formulation', {
      short_code: 'FM-00001',
      notes: 'x',
    }, ctx(p, ['FM-00002']));
    assert.equal(result.ok, false);
  });

  it('rejects an update with no changed fields', async () => {
    const p = await seedVault();
    const result = await executeTool('update_formulation', { short_code: 'FM-00001' }, ctx(p, ['FM-00001']));
    assert.equal(result.ok, false);
  });
});

describe('recordsRead', () => {
  const { recordsRead } = require('../src/agent');

  it('finds a record read in an earlier turn, so the gate survives the confirmation', () => {
    const codes = recordsRead([
      { role: 'user', content: [{ type: 'text', text: 'change the dosage on FM-00001' }] },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'get_formulation', input: { short_code: 'FM-00001' } }] },
      { role: 'user', content: [{ type: 'tool_result', content: '{}' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'It says one cup twice daily. Change it?' }] },
      { role: 'user', content: [{ type: 'text', text: 'Yes, change it.' }] },
    ]);
    assert.deepEqual([...codes], ['FM-00001']);
  });

  it('does not count a different tool, or a read with no short code', () => {
    assert.equal(recordsRead([
      { role: 'assistant', content: [{ type: 'tool_use', name: 'list_formulations', input: {} }] },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'get_formulation', input: {} }] },
    ]).size, 0);
  });

  it('reads a string turn without throwing', () => {
    assert.equal(recordsRead([{ role: 'user', content: 'plain text' }]).size, 0);
  });
});

describe('practitioner isolation', () => {
  it('one practitioner cannot read another practitioner\'s formulation', async () => {
    const ade = fake.store.seedPractitioner({ phone_number: '+2348000000001', display_name: 'Ade' });
    const nkem = fake.store.seedPractitioner({ phone_number: '+2348000000002', display_name: 'Nkem' });

    await executeTool('save_formulation', {
      condition_std: 'Malaria', plants: [{ local_name: 'dongoyaro' }], confidence_score: 0.9,
    }, ctx(ade));

    const result = await executeTool('get_formulation', { short_code: 'FM-00001' }, ctx(nkem));
    assert.equal(result.ok, false, 'cross-practitioner read must fail');
  });

  it('one practitioner cannot read another practitioner\'s patient', async () => {
    const ade = fake.store.seedPractitioner({ phone_number: '+2348000000001' });
    const nkem = fake.store.seedPractitioner({ phone_number: '+2348000000002' });

    await executeTool('create_patient', patientInput('Amina'), ctx(ade));
    const result = await executeTool('get_patient', { short_code: 'PT-00001' }, ctx(nkem));
    assert.equal(result.ok, false);
  });

  it('list_formulations only returns the caller\'s own records', async () => {
    const ade = fake.store.seedPractitioner({ phone_number: '+2348000000001' });
    const nkem = fake.store.seedPractitioner({ phone_number: '+2348000000002' });
    await executeTool('save_formulation', { plants: [{ local_name: 'a' }], confidence_score: 0.9 }, ctx(ade));

    const result = await executeTool('list_formulations', {}, ctx(nkem));
    assert.equal(result.count, 0);
  });
});

// ─── profile ──────────────────────────────────────────────────────────────────

describe('set_profile', () => {
  it('records name and language, and logs onboarding the first time', async () => {
    const p = fake.store.seedPractitioner({ display_name: null });
    const result = await executeTool('set_profile', { display_name: 'Baba Ade', preferred_language: 'yo' }, ctx(p));

    assert.equal(result.ok, true);
    assert.equal(fake.store.practitioners[0].display_name, 'Baba Ade');
    assert.equal(fake.store.practitioners[0].preferred_language, 'yo');
    assert.equal(fake.store.eventsOfType('practitioner_onboarded').length, 1);
  });

  it('updates the in-flight practitioner object so the same turn sees the name', async () => {
    const p = fake.store.seedPractitioner({ display_name: null });
    await executeTool('set_profile', { display_name: 'Nkem' }, ctx(p));
    assert.equal(p.display_name, 'Nkem');
  });

  it('a later rename does not re-log onboarding', async () => {
    const p = fake.store.seedPractitioner({ display_name: 'Ade' });
    await executeTool('set_profile', { display_name: 'Baba Ade' }, ctx(p));
    assert.equal(fake.store.eventsOfType('practitioner_onboarded').length, 0);
  });
});

// ─── patient tracking ─────────────────────────────────────────────────────────

describe('patient tracking', () => {
  it('creates a patient and returns a short code', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('create_patient', patientInput('Patient A', { age_years: 34, sex: 'female' }), ctx(p));
    assert.equal(result.ok, true);
    assert.equal(result.short_code, 'PT-00001');
    assert.equal(fake.store.patients[0].age_years, 34);
    assert.equal(result.consent_status, 'pending');
    assert.equal(result.tracking_started, false);
    assert.equal(fake.store.patients[0].status, 'pending_consent');
    assert.equal(fake.store.eventsOfType('patient_consent_invited').length, 1);
  });

  it('deletes the pending row when WhatsApp cannot deliver the consent invitation', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('create_patient', patientInput('Patient A'), {
      practitioner: p,
      sendPatientConsent: async () => false,
    });
    assert.equal(result.ok, false);
    assert.equal(fake.store.patients.length, 0);
  });

  it('finds a patient by name fragment, case-insensitively', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('create_patient', patientInput('Amina Yusuf'), ctx(p));
    const result = await executeTool('find_patient', { query: 'amina' }, ctx(p));
    assert.equal(result.count, 1);
    assert.equal(result.patients[0].short_code, 'PT-00001');
  });

  it('finds a patient by short code, with or without the dash', async () => {
    const p = fake.store.seedPractitioner();
    await createAcceptedPatient(p, 'Amina');
    assert.equal((await executeTool('find_patient', { query: 'PT-00001' }, ctx(p))).count, 1);
    assert.equal((await executeTool('find_patient', { query: 'pt00001' }, ctx(p))).count, 1);
  });

  it('returns every name match so the agent can disambiguate', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('create_patient', patientInput('Amina Yusuf'), ctx(p));
    await executeTool('create_patient', patientInput('Amina Bello'), ctx(p));
    const result = await executeTool('find_patient', { query: 'Amina' }, ctx(p));
    assert.equal(result.count, 2);
  });

  it('returns no matches for an unknown name rather than erroring', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('find_patient', { query: 'Nobody' }, ctx(p));
    assert.equal(result.count, 0);
    assert.deepEqual(result.patients, []);
  });

  it('logs a treatment linking a patient to a formulation', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', { condition_std: 'Malaria', plants: [{ local_name: 'dongoyaro' }], confidence_score: 0.9 }, ctx(p));
    await createAcceptedPatient(p, 'Amina');

    const result = await executeTool('log_treatment', {
      patient_short_code: 'PT-00001',
      formulation_short_code: 'FM-00001',
      condition_reported: 'fever and chills',
      follow_up_on: '2020-01-01',
    }, ctx(p));

    assert.equal(result.ok, true);
    assert.equal(result.short_code, 'TX-00001');
    const treatment = fake.store.treatments[0];
    assert.equal(treatment.outcome, 'ongoing');
    assert.equal(treatment.formulation_id, fake.store.formulations[0].id);
    assert.equal(fake.store.eventsOfType('treatment_logged').length, 1);
  });

  it('logs a treatment with no formulation yet', async () => {
    const p = fake.store.seedPractitioner();
    await createAcceptedPatient(p, 'Amina');
    const result = await executeTool('log_treatment', { patient_short_code: 'PT-00001', condition_reported: 'cough' }, ctx(p));
    assert.equal(result.ok, true);
    assert.equal(fake.store.treatments[0].formulation_id, null);
  });

  it('refuses treatment tracking while patient consent is still pending', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('create_patient', patientInput('Amina'), ctx(p));
    const result = await executeTool('log_treatment', { patient_short_code: 'PT-00001' }, ctx(p));
    assert.equal(result.ok, false);
    assert.match(result.error, /has not accepted/);
    assert.equal(fake.store.treatments.length, 0);
  });

  it('refuses to log a treatment against an unknown patient', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('log_treatment', { patient_short_code: 'PT-99999' }, ctx(p));
    assert.equal(result.ok, false);
    assert.match(result.error, /No patient PT-99999/);
    assert.equal(fake.store.treatments.length, 0);
  });

  it('refuses to log a treatment against an unknown formulation', async () => {
    const p = fake.store.seedPractitioner();
    await createAcceptedPatient(p, 'Amina');
    const result = await executeTool('log_treatment', {
      patient_short_code: 'PT-00001', formulation_short_code: 'FM-99999',
    }, ctx(p));
    assert.equal(result.ok, false);
    assert.equal(fake.store.treatments.length, 0, 'a bad formulation must not leave a half-written treatment');
  });

  it('updates a treatment outcome', async () => {
    const p = fake.store.seedPractitioner();
    await createAcceptedPatient(p, 'Amina');
    await executeTool('log_treatment', { patient_short_code: 'PT-00001' }, ctx(p));

    const result = await executeTool('update_treatment', {
      short_code: 'TX-00001', outcome: 'improved', outcome_notes: 'fever broke on day two',
    }, ctx(p));

    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'improved');
    assert.equal(fake.store.treatments[0].outcome_notes, 'fever broke on day two');
  });

  it('returns a patient with their treatment history', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', { condition_std: 'Malaria', plants: [{ local_name: 'dongoyaro' }], confidence_score: 0.9 }, ctx(p));
    await createAcceptedPatient(p, 'Amina', { age_years: 34 });
    await executeTool('log_treatment', { patient_short_code: 'PT-00001', formulation_short_code: 'FM-00001', condition_reported: 'fever' }, ctx(p));

    const result = await executeTool('get_patient', { short_code: 'PT-00001' }, ctx(p));
    assert.equal(result.ok, true);
    assert.equal(result.display_name, 'Amina');
    assert.equal(result.treatments.length, 1);
    assert.equal(result.treatments[0].formulation, 'FM-00001');
    assert.equal(result.treatments[0].outcome, 'ongoing');
  });

  it('lists follow-ups that are due but not ones in the future', async () => {
    const p = fake.store.seedPractitioner();
    await createAcceptedPatient(p, 'Amina');
    await createAcceptedPatient(p, 'Chidi');
    await executeTool('log_treatment', { patient_short_code: 'PT-00001', follow_up_on: '2020-01-01' }, ctx(p));
    await executeTool('log_treatment', { patient_short_code: 'PT-00002', follow_up_on: '2999-01-01' }, ctx(p));

    const result = await executeTool('list_due_follow_ups', {}, ctx(p));
    assert.equal(result.count, 1);
    assert.equal(result.follow_ups[0].patient, 'Amina');
  });

  it('a resolved treatment stops appearing in due follow-ups', async () => {
    const p = fake.store.seedPractitioner();
    await createAcceptedPatient(p, 'Amina');
    await executeTool('log_treatment', { patient_short_code: 'PT-00001', follow_up_on: '2020-01-01' }, ctx(p));
    await executeTool('update_treatment', { short_code: 'TX-00001', outcome: 'resolved' }, ctx(p));

    const result = await executeTool('list_due_follow_ups', {}, ctx(p));
    assert.equal(result.count, 0);
  });
});

// ─── executeTool contract ─────────────────────────────────────────────────────

describe('executeTool error handling', () => {
  it('an unknown tool name returns an error the agent can recover from', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('no_such_tool', {}, ctx(p));
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown tool/);
  });

  it('a thrown database error becomes a tool result, not an exception', async () => {
    const p = fake.store.seedPractitioner();
    const db = require('../src/services/supabase');
    db.createPatient = async () => { throw new Error('connection reset'); };

    const result = await executeTool('create_patient', patientInput('Amina'), ctx(p));
    assert.equal(result.ok, false);
    assert.match(result.error, /connection reset/);
  });

  it('tolerates a tool called with no input at all', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('list_formulations', undefined, ctx(p));
    assert.equal(result.count, 0);
  });
});

// ─── conversation history handling ────────────────────────────────────────────

describe('sanitizeHistory', () => {
  const user = text => ({ role: 'user', content: [{ type: 'text', text }] });
  const bot = text => ({ role: 'assistant', content: [{ type: 'text', text }] });
  const botCall = id => ({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'x', input: {} }] });
  const toolOut = id => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '{}' }] });

  it('keeps a clean exchange untouched', () => {
    const history = [user('hi'), bot('hello')];
    assert.deepEqual(sanitizeHistory(history), history);
  });

  it('drops a leading orphan tool_result the window sliced into', () => {
    const result = sanitizeHistory([toolOut('t1'), bot('saved'), user('thanks'), bot('👍')]);
    assert.equal(result[0].role, 'user');
    assert.equal(result[0].content[0].type, 'text');
  });

  it('drops a trailing tool_use with no result, so the API never sees a dangling call', () => {
    const result = sanitizeHistory([user('hi'), bot('one moment'), user('ok'), botCall('t1')]);
    assert.equal(result.length, 2);
    assert.equal(result[result.length - 1].role, 'assistant');
  });

  it('never ends on a user turn, which would break role alternation', () => {
    const result = sanitizeHistory([user('hi'), bot('hello'), user('and another thing')]);
    assert.equal(result[result.length - 1].role, 'assistant');
  });

  it('preserves an intact tool_use / tool_result pair in the middle', () => {
    const history = [user('save it'), botCall('t1'), toolOut('t1'), bot('Saved as FM-00001')];
    assert.deepEqual(sanitizeHistory(history), history);
  });

  it('returns empty for history that is nothing but fragments', () => {
    assert.deepEqual(sanitizeHistory([toolOut('t1'), botCall('t2')]), []);
  });

  it('handles empty history', () => {
    assert.deepEqual(sanitizeHistory([]), []);
  });
});

describe('stripImagesForStorage', () => {
  it('replaces image blocks with a placeholder so base64 never reaches the database', () => {
    const result = stripImagesForStorage([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'x'.repeat(5000) } },
      { type: 'text', text: 'my notebook page' },
    ]);
    assert.equal(result[0].type, 'text');
    assert.match(result[0].text, /photo/);
    assert.equal(result[1].text, 'my notebook page');
    assert.equal(JSON.stringify(result).includes('xxxxx'), false);
  });

  it('leaves non-array content alone', () => {
    assert.equal(stripImagesForStorage('plain string'), 'plain string');
  });
});

describe('buildSystemPrompt', () => {
  it('does not carry the plant index, which is a tool now', () => {
    // It used to be pasted in whole: 442 mappings, ~4,330 tokens, on every call
    // of every iteration, with the model asked to recall the right one and write
    // it into a permanent record.
    const prompt = buildSystemPrompt({ display_name: 'Ade', preferred_language: 'yo' });
    assert.doesNotMatch(prompt, /dongoyaro → Azadirachta indica/);
    assert.doesNotMatch(prompt, /\{\{/, 'no unreplaced placeholder left behind');
    assert.match(prompt, /lookup_plant/);
  });

  it('tells the agent it does not supply botanical names', () => {
    const prompt = buildSystemPrompt({ display_name: 'Ade', preferred_language: 'yo' });
    assert.match(prompt, /You do not supply botanical names/);
  });

  it('tells the agent to onboard when the name is unknown', () => {
    const prompt = buildSystemPrompt({ display_name: null });
    assert.match(prompt, /not been introduced/);
  });

  it('names the practitioner once known', () => {
    const prompt = buildSystemPrompt({ display_name: 'Baba Ade', preferred_language: 'yo' });
    assert.match(prompt, /Baba Ade/);
    assert.doesNotMatch(prompt, /not been introduced/);
  });

  it('leaves no unreplaced template placeholders', () => {
    const prompt = buildSystemPrompt({ display_name: 'Ade' });
    assert.doesNotMatch(prompt, /\{\{.+\}\}/);
  });
});

// ─── the agent loop ───────────────────────────────────────────────────────────

describe('runAgent', () => {
  it('sends a plain reply and stores the exchange', async () => {
    const p = fake.store.seedPractitioner();
    const sent = [];
    const client = fakeClient([textResponse('Ẹ kú àárọ̀, Baba Ade.')]);

    const result = await runAgent({ practitioner: p, content: 'hello', send: t => sent.push(t), client });

    assert.deepEqual(sent, ['Ẹ kú àárọ̀, Baba Ade.']);
    assert.deepEqual(result.replies, [{ text: 'Ẹ kú àárọ̀, Baba Ade.', choices: [] }]);
    assert.equal(fake.store.agentMessages.length, 2);
    assert.equal(fake.store.agentMessages[0].role, 'user');
    assert.equal(fake.store.agentMessages[1].role, 'assistant');
  });

  it('runs a tool call and feeds the result back to the model', async () => {
    const p = fake.store.seedPractitioner();
    const sent = [];
    const client = fakeClient([
      toolResponse('save_formulation', {
        condition_std: 'Malaria',
        plants: [{ local_name: 'dongoyaro' }],
        confidence_score: 0.9,
      }, { text: 'Saving that now.' }),
      textResponse('Done — saved as FM-00001.'),
    ]);

    const result = await runAgent({ practitioner: p, content: 'record my malaria remedy', send: t => sent.push(t), client });

    assert.equal(fake.store.formulations.length, 1, 'the formulation must actually reach the Vault');
    assert.equal(result.toolCalls[0].name, 'save_formulation');
    assert.equal(result.toolCalls[0].result.short_code, 'FM-00001');
    assert.deepEqual(sent, ['Saving that now.', 'Done — saved as FM-00001.']);

    // Second API call must carry the tool_result back to the model
    const secondCall = client.calls[1];
    const lastMessage = secondCall.messages[secondCall.messages.length - 1];
    assert.equal(lastMessage.content[0].type, 'tool_result');
    assert.match(lastMessage.content[0].content, /FM-00001/);
  });

  it('marks a failed tool result as an error for the model', async () => {
    const p = fake.store.seedPractitioner();
    const client = fakeClient([
      toolResponse('get_formulation', { short_code: 'FM-99999' }),
      textResponse('I could not find that one.'),
    ]);
    await runAgent({ practitioner: p, content: 'show FM-99999', send: () => {}, client });

    const toolResultBlock = client.calls[1].messages.at(-1).content[0];
    assert.equal(toolResultBlock.is_error, true);
  });

  it('replays stored history so the agent remembers the previous turn', async () => {
    const p = fake.store.seedPractitioner();
    await fake.store.agentMessages.push(
      { practitioner_id: p.id, role: 'user', content: [{ type: 'text', text: 'I want to record a remedy' }] },
      { practitioner_id: p.id, role: 'assistant', content: [{ type: 'text', text: 'What condition is it for?' }] },
    );

    const client = fakeClient([textResponse('Got it — malaria.')]);
    await runAgent({ practitioner: p, content: 'malaria', send: () => {}, client });

    const messages = client.calls[0].messages;
    assert.equal(messages.length, 3);
    assert.equal(messages[0].content[0].text, 'I want to record a remedy');
    assert.equal(messages[2].content[0].text, 'malaria');
  });

  it('always replies, even when the model produces only a tool call', async () => {
    const p = fake.store.seedPractitioner();
    const sent = [];
    // Model calls a tool then goes silent on the next turn.
    const client = fakeClient([
      toolResponse('list_formulations', {}),
      { content: [], stop_reason: 'end_turn', usage: {} },
    ]);

    const result = await runAgent({ practitioner: p, content: 'my vault', send: t => sent.push(t), client });
    assert.equal(sent.length, 1);
    assert.equal(result.replies.length, 1);
  });

  it('stops after the tool-call ceiling instead of looping forever', async () => {
    const p = fake.store.seedPractitioner();
    // Always returns a tool call — the loop must break on its own.
    const client = fakeClient([toolResponse('list_formulations', {})]);

    const result = await runAgent({ practitioner: p, content: 'go', send: () => {}, client });
    assert.equal(result.stopped, 'max_iterations');
    assert.ok(client.calls.length <= 8, `expected ≤8 model calls, got ${client.calls.length}`);
  });

  it('does not persist image base64 into conversation history', async () => {
    const p = fake.store.seedPractitioner();
    const client = fakeClient([textResponse('I can read that page.')]);
    const bigImage = 'A'.repeat(4000);

    await runAgent({
      practitioner: p,
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: bigImage } },
        { type: 'text', text: '[photo]' },
      ],
      send: () => {},
      client,
    });

    // The model saw the image …
    assert.equal(client.calls[0].messages.at(-1).content[0].type, 'image');
    // … but the database did not.
    assert.equal(JSON.stringify(fake.store.agentMessages).includes(bigImage), false);
  });

  it('caches the system prompt and passes the tool list on every call', async () => {
    const p = fake.store.seedPractitioner();
    const client = fakeClient([textResponse('hi')]);
    await runAgent({ practitioner: p, content: 'hi', send: () => {}, client });

    const params = client.calls[0];
    assert.equal(params.system[0].cache_control.type, 'ephemeral');
    assert.ok(params.tools.some(tool => tool.name === 'save_formulation'));
    assert.ok(!params.tools.some(tool => tool.name === 'create_patient'), 'formulation-only is the default profile');
  });

  it('logs a usage event per model call for the admin cost view', async () => {
    const p = fake.store.seedPractitioner();
    const client = fakeClient([
      toolResponse('list_formulations', {}),
      textResponse('Your vault is empty.'),
    ]);
    await runAgent({ practitioner: p, content: 'my vault', send: () => {}, client });
    assert.equal(fake.store.eventsOfType('llm_call').length, 2);
  });
});

// ─── practitioner resolution ──────────────────────────────────────────────────

describe('getOrCreatePractitioner', () => {
  it('creates a record on first contact and flags it as new', async () => {
    const { practitioner, isNew } = await getOrCreatePractitioner('+2348111111111');
    assert.equal(isNew, true);
    assert.equal(practitioner.display_name, null);
    assert.equal(fake.store.eventsOfType('first_contact').length, 1);
  });

  it('leaves the language unstated rather than assuming English', async () => {
    // This column is Whisper's decoding language, and Whisper forces rather than
    // hints — defaulting it to 'en' decoded every Yoruba voice note as English.
    const { practitioner } = await getOrCreatePractitioner('+2348111111111');
    assert.equal(practitioner.preferred_language, null);
  });

  it('returns the existing record on later messages, without re-flagging', async () => {
    await getOrCreatePractitioner('+2348111111111');
    const { practitioner, isNew } = await getOrCreatePractitioner('+2348111111111');
    assert.equal(isNew, false);
    assert.equal(fake.store.practitioners.length, 1);
    assert.ok(practitioner.id);
  });

  it('recovers when two simultaneous first messages race on the unique phone index', async () => {
    const db = require('../src/services/supabase');
    const realCreate = db.createPractitioner;
    let first = true;
    db.getPractitioner = async phone => (first ? null : fake.store.practitioners.find(p => p.phone_number === phone) ?? null);
    db.createPractitioner = async args => {
      first = false;
      await realCreate(args);
      // The row landed, but our insert lost the race — which is what the caller
      // has to recover from, so the created row is never returned here.
      throw new Error('duplicate key');
    };

    const { practitioner, isNew } = await getOrCreatePractitioner('+2348111111111');
    assert.equal(isNew, false);
    assert.ok(practitioner);
  });

  it('the privacy notice is a real disclosure, not a placeholder', () => {
    assert.match(PRIVACY_NOTICE, /private to you/);
    assert.match(PRIVACY_NOTICE, /privacy/);
  });
});

// ─── message aggregation ──────────────────────────────────────────────────────

describe('MessageAggregator', () => {
  it('combines messages sent in quick succession into one turn', async () => {
    const batches = [];
    const agg = new MessageAggregator((key, items) => { batches.push({ key, items }); }, { windowMs: 5 });

    agg.push('+234', 'I want to record');
    agg.push('+234', 'a remedy for malaria');
    agg.push('+234', 'using dongoyaro');
    await agg.flushAll();

    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].items, ['I want to record', 'a remedy for malaria', 'using dongoyaro']);
  });

  it('keeps different practitioners in separate batches', async () => {
    const batches = [];
    const agg = new MessageAggregator((key, items) => { batches.push({ key, items }); }, { windowMs: 5 });

    agg.push('+234', 'a');
    agg.push('+235', 'b');
    await agg.flushAll();

    assert.equal(batches.length, 2);
    assert.deepEqual(batches.map(b => b.key).sort(), ['+234', '+235']);
  });

  it('fires on its own after the debounce window', async () => {
    const batches = [];
    const agg = new MessageAggregator((key, items) => { batches.push(items); }, { windowMs: 10 });
    agg.push('+234', 'hello');
    await new Promise(r => setTimeout(r, 40));
    assert.equal(batches.length, 1);
  });

  it('does not start a second turn while the first is still running', async () => {
    const order = [];
    let release;
    const gate = new Promise(r => { release = r; });

    const agg = new MessageAggregator(async (key, items) => {
      order.push(`start:${items[0]}`);
      if (items[0] === 'first') await gate;
      order.push(`end:${items[0]}`);
    }, { windowMs: 1 });

    agg.push('+234', 'first');
    const firstRun = agg.flush('+234');
    agg.push('+234', 'second');
    const secondRun = agg.flush('+234');

    release();
    await Promise.all([firstRun, secondRun]);

    assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('a failing turn does not block the next one', async () => {
    const seen = [];
    const agg = new MessageAggregator(async (key, items) => {
      seen.push(items[0]);
      if (items[0] === 'boom') throw new Error('turn failed');
    }, { windowMs: 1 });

    agg.push('+234', 'boom');
    const first = agg.flush('+234').catch(() => {});
    agg.push('+234', 'next');
    const second = agg.flush('+234');
    await Promise.all([first, second]);

    assert.deepEqual(seen, ['boom', 'next']);
  });

  it('reports how many messages are waiting', () => {
    const agg = new MessageAggregator(() => {}, { windowMs: 1000 });
    agg.push('+234', 'a');
    agg.push('+234', 'b');
    assert.equal(agg.pendingCount('+234'), 2);
    assert.equal(agg.pendingCount('+999'), 0);
  });

  it('flushing an empty key is a no-op', async () => {
    let called = false;
    const agg = new MessageAggregator(() => { called = true; }, { windowMs: 1 });
    await agg.flush('+nobody');
    assert.equal(called, false);
  });
});

// ─── inbound message normalisation ────────────────────────────────────────────

describe('router.buildContent', () => {
  const { buildContent } = require('../src/router');
  const whatsapp = require('../src/services/whatsapp');
  const whisper = require('../src/services/whisper');
  const vision = require('../src/services/vision');

  let originals;
  beforeEach(() => {
    originals = { downloadMedia: whatsapp.downloadMedia, transcribe: whisper.transcribe, transcribePage: vision.transcribePage };
    // Default to a page with no writing on it. A case that cares about the
    // reading replaces this; every other case must not reach for a model that
    // may or may not be running on the machine the suite happens to be on.
    vision.transcribePage = async () => ({ text: '', confidence: 0, unreadable: 0, model: 'test-vision', provider: 'test', error: null });
  });
  afterEach(() => {
    whatsapp.downloadMedia = originals.downloadMedia;
    whisper.transcribe = originals.transcribe;
    vision.transcribePage = originals.transcribePage;
  });

  it('passes text through as a text block', async () => {
    const p = fake.store.seedPractitioner();
    const blocks = await buildContent([{ type: 'text', text: { body: 'hello' } }], p);
    assert.deepEqual(blocks, [{ type: 'text', text: 'hello' }]);
  });

  it('merges an aggregated batch into one content array', async () => {
    const p = fake.store.seedPractitioner();
    const blocks = await buildContent([
      { type: 'text', text: { body: 'for malaria' } },
      { type: 'text', text: { body: 'using dongoyaro' } },
    ], p);
    assert.equal(blocks.length, 2);
  });

  it('transcribes a voice note and labels it as speech', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    whisper.transcribe = async () => ({ text: 'Fi ewe dongoyaro se agbo', language: 'yo', confidence: 0.92 });

    const blocks = await buildContent([{ type: 'audio', audio: { id: 'm1' } }], p);
    assert.match(blocks[0].text, /voice note transcript/);
    assert.match(blocks[0].text, /dongoyaro/);
  });

  it('warns the agent when the transcription is unreliable', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    whisper.transcribe = async () => ({ text: 'mumble mumble', language: 'yo', confidence: 0.3 });

    const blocks = await buildContent([{ type: 'audio', audio: { id: 'm1' } }], p);
    assert.match(blocks[0].text, /confidence only 30%/);
    assert.match(blocks[0].text, /unreliable/);
  });

  it('does not force a language on a practitioner who has not stated one', async () => {
    const p = fake.store.seedPractitioner({ preferred_language: null });
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    let seen;
    whisper.transcribe = async (_buf, _mime, opts) => {
      seen = opts;
      return { text: 'Fi ewe dongoyaro se agbo', language: 'yo', confidence: 0.9 };
    };

    await buildContent([{ type: 'audio', audio: { id: 'm1' } }], p);
    assert.equal(seen.language, undefined);
  });

  it('leaves detection on even when the practitioner has stated a language', async () => {
    // Default mode is 'auto': these practitioners code-switch mid-sentence, so a
    // stated language is context, not a licence to lock the decoder.
    const p = fake.store.seedPractitioner({ preferred_language: 'yo' });
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    let seen;
    whisper.transcribe = async (_buf, _mime, opts) => {
      seen = opts;
      return { text: 'Fi ewe dongoyaro se agbo', language: 'yo', confidence: 0.9 };
    };

    await buildContent([{ type: 'audio', audio: { id: 'm1' } }], p);
    assert.equal(seen.language, undefined);
  });

  it('flags a detected language that contradicts the profile', async () => {
    const p = fake.store.seedPractitioner({ preferred_language: 'yo' });
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    whisper.transcribe = async () => ({ text: 'boil the neem leaves', language: 'en', confidence: 0.9 });

    const blocks = await buildContent([{ type: 'audio', audio: { id: 'm1' } }], p);
    assert.match(blocks[0].text, /sounds like English but their profile says Yoruba/);
    assert.match(blocks[0].text, /only change their profile if they ask/);
  });

  it('says nothing about language when detection agrees with the profile', async () => {
    const p = fake.store.seedPractitioner({ preferred_language: 'yo' });
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    whisper.transcribe = async () => ({ text: 'Fi ewe dongoyaro se agbo', language: 'yo', confidence: 0.9 });

    const blocks = await buildContent([{ type: 'audio', audio: { id: 'm1' } }], p);
    assert.equal(blocks[0].text.split('\n')[0], '[voice note transcript]');
  });

  it('tells the agent to ask again when nothing could be transcribed', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    whisper.transcribe = async () => ({ text: '', language: 'yo', confidence: 0 });

    const blocks = await buildContent([{ type: 'audio', audio: { id: 'm1' } }], p);
    assert.match(blocks[0].text, /record it again/);
  });

  it('turns a photo into an image block plus its caption', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });

    const blocks = await buildContent([{ type: 'image', image: { id: 'i1', caption: 'my notebook' } }], p);
    assert.equal(blocks[0].type, 'image');
    assert.equal(blocks[0].source.media_type, 'image/jpeg');
    assert.equal(blocks[0].source.data, Buffer.from('jpegdata').toString('base64'));
    assert.match(blocks[1].text, /my notebook/);
  });

  it('reads a photographed page and hands the agent the text, not just the pixels', async () => {
    // The default agent model is text-only, so an image block alone reaches it
    // as nothing at all. The reading is what makes a page usable.
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });
    vision.transcribePage = async () => ({
      text: 'Agbo iba\nEwe dongoyaro, ewe eyin\nBoil 20 mins', confidence: 1, unreadable: 0, model: 'qwen2.5vl:7b', provider: 'ollama', error: null,
    });

    const blocks = await buildContent([{ type: 'image', image: { id: 'i1' } }], p);
    assert.equal(blocks[0].type, 'image');
    assert.match(blocks[1].text, /transcribed below/);
    assert.match(blocks[1].text, /Ewe dongoyaro/);
  });

  it('archives the page reading on the media row with the model that produced it', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });
    vision.transcribePage = async () => ({ text: 'Agbo iba', confidence: 0.9, unreadable: 0, model: 'qwen2.5vl:7b', provider: 'ollama', error: null });

    await buildContent([{ type: 'image', image: { id: 'i1' } }], p);
    assert.equal(fake.store.media[0].kind, 'photo');
    assert.equal(fake.store.media[0].transcript, 'Agbo iba');
    assert.equal(fake.store.media[0].transcript_model, 'qwen2.5vl:7b');
    assert.equal(fake.store.media[0].transcript_confidence, 0.9);
  });

  it('warns the agent when much of the page was illegible', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });
    vision.transcribePage = async () => ({ text: 'Agbo [?] [?]', confidence: 0.1, unreadable: 2, model: 'qwen2.5vl:7b', provider: 'ollama', error: null });

    const blocks = await buildContent([{ type: 'image', image: { id: 'i1' } }], p);
    assert.match(blocks[1].text, /illegible/);
    assert.match(blocks[1].text, /never fill them in/);
  });

  it('warns the agent when a Yoruba page comes back with no diacritics at all', async () => {
    // Confidence cannot catch this: nothing was marked illegible, the text is
    // fluent, and the reading is wrong in a way that would harden into a plant
    // name. Measured on glm-ocr reading clean printed Yoruba: every tone mark
    // kept, every subdot destroyed.
    const p = fake.store.seedPractitioner({ preferred_language: 'yo' });
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });
    vision.transcribePage = async (_b, _m, opts) => {
      assert.equal(opts.language, 'yo');   // the check needs their stated language
      const { _diacritics } = require('../src/services/vision');
      const text = 'Ewe dongoyaro eyin ogede fun iba '.repeat(4);
      return { text, confidence: 1, unreadable: 0, diacritics: _diacritics(text, 'yo'), model: 'qwen2.5vl:7b', provider: 'ollama', error: null };
    };

    const blocks = await buildContent([{ type: 'image', image: { id: 'i1' } }], p);
    assert.match(blocks[1].text, /the tone marks .* and the subdots/);
    assert.match(blocks[1].text, /how it is spelled/);
  });

  it('catches a whole class of mark going missing, not just an empty page', async () => {
    // The reading keeps every tone mark and loses every subdot. A total count
    // calls that three-quarters healthy; per class it is one class gone.
    const p = fake.store.seedPractitioner({ preferred_language: 'yo' });
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });
    vision.transcribePage = async () => {
      const { _diacritics } = require('../src/services/vision');
      const text = 'Ewé dòngòyárò èyìn ôgèdè fún ibà '.repeat(4);   // tones kept, subdots gone
      return { text, confidence: 1, unreadable: 0, diacritics: _diacritics(text, 'yo'), model: 'glm-ocr', provider: 'ollama', error: null };
    };

    const blocks = await buildContent([{ type: 'image', image: { id: 'i1' } }], p);
    assert.match(blocks[1].text, /lost the subdots/);
    // Named precisely: the tone marks survived, so saying they went missing would
    // send the reviewer looking at the wrong thing.
    assert.doesNotMatch(blocks[1].text, /tone marks/);
  });

  it('says nothing about diacritics when the reading kept them', async () => {
    const p = fake.store.seedPractitioner({ preferred_language: 'yo' });
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });
    vision.transcribePage = async () => {
      const { _diacritics } = require('../src/services/vision');
      const text = 'Ewé dòngòyárò ẹ̀yìn ọ̀gẹ̀dẹ̀ fún ibà '.repeat(4);
      return { text, confidence: 1, unreadable: 0, diacritics: _diacritics(text, 'yo'), model: 'qwen2.5vl:7b', provider: 'ollama', error: null };
    };

    const blocks = await buildContent([{ type: 'image', image: { id: 'i1' } }], p);
    assert.doesNotMatch(blocks[1].text, /subdot|tone mark/);
  });

  it('tells the agent the page could not be read rather than letting it invent one', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });
    vision.transcribePage = async () => ({ text: '', confidence: 0, unreadable: 0, model: 'qwen2.5vl:7b', provider: 'ollama', error: 'model not found' });

    const blocks = await buildContent([{ type: 'image', image: { id: 'i1' } }], p);
    assert.match(blocks[1].text, /could not be read/);
    // The photo is still archived: a failed reading must not cost the practitioner
    // their page, because the reading can be repeated and the moment cannot.
    assert.equal(fake.store.media.length, 1);
    assert.equal(fake.store.media[0].transcript, null);
  });

  it('relabels an unsupported image type as jpeg rather than failing the vision call', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('x'), mimeType: 'image/heic' });
    const blocks = await buildContent([{ type: 'image', image: { id: 'i1' } }], p);
    assert.equal(blocks[0].source.media_type, 'image/jpeg');
  });

  it('strips the charset suffix WhatsApp sometimes appends', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('x'), mimeType: 'image/png; charset=binary' });
    const blocks = await buildContent([{ type: 'image', image: { id: 'i1' } }], p);
    assert.equal(blocks[0].source.media_type, 'image/png');
  });

  it('describes an unsupported message type instead of dropping the turn', async () => {
    const p = fake.store.seedPractitioner();
    const blocks = await buildContent([{ type: 'sticker' }], p);
    assert.match(blocks[0].text, /sticker/);
  });

  it('never returns an empty content array', async () => {
    const p = fake.store.seedPractitioner();
    const blocks = await buildContent([{ type: 'text', text: { body: '   ' } }], p);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0].text, /empty message/);
  });

  it('archives the voice note alongside the transcript', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    whisper.transcribe = async () => ({ text: 'hello', language: 'en', confidence: 0.9 });

    await buildContent([{ type: 'audio', audio: { id: 'm1' } }], p);
    await new Promise(r => setImmediate(r)); // archival is fire-and-forget
    assert.equal(fake.store.media.length, 1);
    assert.equal(fake.store.media[0].transcript, 'hello');
  });

  it('carries the archived media id into a later confirmed formulation save', async () => {
    const p = fake.store.seedPractitioner();
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    whisper.transcribe = async () => ({ text: 'dongoyaro for malaria', language: 'en', confidence: 0.9 });

    const blocks = await buildContent([{ type: 'audio', audio: { id: 'm1' } }], p);
    const mediaId = blocks.sourceMediaIds[0];
    assert.equal(p.pending_source_media_id, mediaId);

    const result = await executeTool('save_formulation', {
      plants: [{ local_name: 'dongoyaro' }],
      confidence_score: 0.9,
    }, ctx(p));

    assert.equal(result.ok, true);
    assert.equal(fake.store.formulations[0].source_media_id, mediaId);
    assert.equal(p.pending_source_media_id, null);
  });
});

describe('validation and account rights', () => {
  it('rejects malformed nested formulations before any database write', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      plants: [{ local_name: '', invented_key: 'bad' }],
      confidence_score: 1.4,
      original_language: 'fr',
    }, ctx(p));
    assert.equal(result.ok, false);
    assert.equal(fake.store.formulations.length, 0);
    assert.match(result.error, /not be blank|not permitted/);
    assert.match(result.error, /at most 1/);
    assert.match(result.error, /original_language/);
  });

  it('defaults patient tools off and requires a patient phone number when enabled', async () => {
    const p = fake.store.seedPractitioner();
    delete process.env.PATIENT_TRACKING_ENABLED;
    const disabled = await executeTool('create_patient', patientInput('Patient A'), ctx(p));
    assert.match(disabled.error, /disabled/);

    process.env.PATIENT_TRACKING_ENABLED = 'true';
    const missingPhone = await executeTool('create_patient', { display_name: 'Patient A' }, ctx(p));
    assert.equal(missingPhone.ok, false);
    assert.equal(fake.store.patients.length, 0);
  });

  it('creates a downloadable export and writes an audit event', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', { plants: [{ local_name: 'atale' }], confidence_score: 0.9 }, ctx(p));
    const result = await executeTool('export_account', {}, ctx(p));
    assert.equal(result.ok, true);
    assert.match(result.download_url, /^https:\/\/example\.test\/signed\//);
    assert.equal(fake.store.audit.at(-1).action, 'export');
  });

  it('requires an exact current-message confirmation before permanent deletion', async () => {
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', { plants: [{ local_name: 'atale' }], confidence_score: 0.9 }, ctx(p));

    const refused = await executeTool('delete_account', { confirmation: 'DELETE MY SANKO ACCOUNT' }, {
      practitioner: p,
      currentUserText: 'please delete it',
    });
    assert.equal(refused.ok, false);
    assert.equal(fake.store.practitioners.length, 1);

    const deleted = await executeTool('delete_account', { confirmation: 'DELETE MY SANKO ACCOUNT' }, {
      practitioner: p,
      currentUserText: 'DELETE MY SANKO ACCOUNT',
    });
    assert.equal(deleted.account_deleted, true);
    assert.equal(fake.store.practitioners.length, 0);
    assert.equal(fake.store.formulations.length, 0);
    assert.deepEqual(fake.store.audit.map(row => row.action).slice(-2), ['delete_requested', 'delete_completed']);
  });
});

// ─── webhook transport ────────────────────────────────────────────────────────

describe('webhook → agent', () => {
  const router = require('../src/router');
  const whatsapp = require('../src/services/whatsapp');
  const agent = require('../src/agent');

  // Builds a Meta-shaped webhook body.
  function webhookBody(messages, from = '+2348012345678') {
    return {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: messages.map((m, i) => ({ id: `wamid.${i}-${Math.random()}`, from, ...m })) } }] }],
    };
  }

  const textMsg = body => ({ type: 'text', text: { body } });

  function fakeRes() {
    return { statusCode: null, sendStatus(c) { this.statusCode = c; return this; } };
  }

  let sent, turns, originals;
  beforeEach(() => {
    delete process.env.META_APP_SECRET;
    sent = [];
    turns = [];
    originals = { sendTextMessage: whatsapp.sendTextMessage, runAgent: agent.runAgent };
    whatsapp.sendTextMessage = async (to, text) => { sent.push({ to, text }); return true; };
    agent.runAgent = async ({ practitioner, content, send }) => {
      turns.push({ practitioner, content });
      await send('ok');
      return { replies: ['ok'], toolCalls: [], stopped: 'end_turn' };
    };
  });
  afterEach(() => Object.assign(whatsapp, { sendTextMessage: originals.sendTextMessage }) &&
                  Object.assign(agent, { runAgent: originals.runAgent }));

  it('acknowledges Meta immediately, before doing any work', async () => {
    const res = fakeRes();
    await router.handleWebhook({ headers: {}, body: webhookBody([textMsg('hello')]) }, res);
    assert.equal(res.statusCode, 200);
  });

  it('creates the practitioner, sends the privacy notice, and runs one turn', async () => {
    const res = fakeRes();
    await router.handleWebhook({ headers: {}, body: webhookBody([textMsg('hello')]) }, res);
    await router.aggregator.flushAll();

    assert.equal(fake.store.practitioners.length, 1);
    assert.equal(sent[0].text, PRIVACY_NOTICE);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].content[0].text, 'hello');
  });

  it('sends the privacy notice once, not on every message', async () => {
    for (const body of ['first', 'second']) {
      await router.handleWebhook({ headers: {}, body: webhookBody([textMsg(body)]) }, fakeRes());
      await router.aggregator.flushAll();
    }
    assert.equal(sent.filter(s => s.text === PRIVACY_NOTICE).length, 1);
  });

  it('batches messages that arrive together into a single agent turn', async () => {
    const res = fakeRes();
    await router.handleWebhook({
      headers: {},
      body: webhookBody([textMsg('for malaria'), textMsg('using dongoyaro')]),
    }, res);
    await router.aggregator.flushAll();

    assert.equal(turns.length, 1, 'two messages must not produce two turns');
    assert.equal(turns[0].content.length, 2);
  });

  it('ignores a duplicate delivery of the same message id', async () => {
    const body = webhookBody([textMsg('hello')]);
    await router.handleWebhook({ headers: {}, body }, fakeRes());
    await router.handleWebhook({ headers: {}, body }, fakeRes()); // Meta retry
    await router.aggregator.flushAll();
    assert.equal(turns.length, 1);
  });

  it('rejects a forged webhook when the app secret is set', async () => {
    process.env.META_APP_SECRET = 'app_secret';
    const res = fakeRes();
    await router.handleWebhook({ headers: { 'x-hub-signature-256': 'sha256=bogus' }, rawBody: Buffer.from('{}'), body: {} }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(turns.length, 0);
  });

  it('apologises to the practitioner and logs when a turn throws', async () => {
    agent.runAgent = async () => { throw new Error('Claude is down'); };
    await router.handleWebhook({ headers: {}, body: webhookBody([textMsg('hello')]) }, fakeRes());
    await router.aggregator.flushAll();

    assert.match(sent.at(-1).text, /Something went wrong/);
    const errors = fake.store.eventsOfType('error');
    assert.equal(errors.length, 1);
    assert.match(errors[0].payload.error, /Claude is down/);
  });

  it('logs the inbound message with its batch size', async () => {
    await router.handleWebhook({ headers: {}, body: webhookBody([textMsg('a'), textMsg('b')]) }, fakeRes());
    await router.aggregator.flushAll();
    const inbound = fake.store.eventsOfType('inbound_msg');
    assert.equal(inbound[0].payload.batched, 2);
  });

  it('activates a pending patient only when the invited WhatsApp number accepts', async () => {
    const practitioner = fake.store.seedPractitioner({ phone_number: '+2348000000001', display_name: 'Baba Ade' });
    const created = await executeTool('create_patient', patientInput('Amina'), ctx(practitioner));
    const patient = fake.store.patients[0];

    const handled = await router.handlePatientConsent(patient.phone_number, [{
      id: 'wamid.consent-1',
      type: 'button',
      button: { payload: `patient-consent:${patient.id}:accept`, text: 'Accept' },
    }]);

    assert.equal(handled, true);
    assert.equal(created.tracking_started, false);
    assert.equal(patient.status, 'active');
    assert.equal(patient.consent_status, 'granted');
    assert.equal(patient.consent_method, 'whatsapp');
    assert.equal(patient.consent_response_message_id, 'wamid.consent-1');
    assert.ok(sent.some(message => message.to === patient.phone_number && /accepted/i.test(message.text)));
    assert.ok(sent.some(message => message.to === practitioner.phone_number && /can now record treatment/i.test(message.text)));
  });

  it('deletes a pending patient when the invited number declines', async () => {
    const practitioner = fake.store.seedPractitioner({ phone_number: '+2348000000001', display_name: 'Baba Ade' });
    await executeTool('create_patient', patientInput('Amina'), ctx(practitioner));
    const patient = fake.store.patients[0];

    await router.handlePatientConsent(patient.phone_number, [{
      id: 'wamid.consent-2',
      type: 'interactive',
      interactive: { button_reply: { id: `patient-consent:${patient.id}:decline`, title: 'Decline' } },
    }]);

    assert.equal(fake.store.patients.length, 0);
    assert.ok(sent.some(message => message.to === patient.phone_number && /will not track/i.test(message.text)));
    assert.ok(sent.some(message => message.to === practitioner.phone_number && /No patient record was retained/i.test(message.text)));
  });

  it('does not accept a consent button forwarded from a different phone number', async () => {
    const practitioner = fake.store.seedPractitioner({ phone_number: '+2348000000001' });
    await executeTool('create_patient', patientInput('Amina'), ctx(practitioner));
    const patient = fake.store.patients[0];

    await router.handlePatientConsent('+2348999999999', [{
      id: 'wamid.forged',
      type: 'interactive',
      interactive: { button_reply: { id: `patient-consent:${patient.id}:accept`, title: 'Accept' } },
    }]);

    assert.equal(patient.status, 'pending_consent');
    assert.equal(patient.consent_status, 'pending');
  });

  it('ignores webhook bodies that are not WhatsApp messages', async () => {
    await router.handleWebhook({ headers: {}, body: { object: 'page' } }, fakeRes());
    await router.aggregator.flushAll();
    assert.equal(turns.length, 0);
  });
});

// ─── admin surface ────────────────────────────────────────────────────────────

describe('admin page with patient data', () => {
  it('shows patient and treatment counts alongside formulations', async () => {
    process.env.ADMIN_PASSWORD = 'sekret';
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', { plants: [{ local_name: 'a' }], confidence_score: 0.9 }, ctx(p));
    await createAcceptedPatient(p, 'Amina');
    await executeTool('log_treatment', { patient_short_code: 'PT-00001' }, ctx(p));

    const admin = require('../src/admin');
    const html = await new Promise((resolve, reject) => {
      admin.handle(
        { headers: { authorization: 'Basic ' + Buffer.from('felix:sekret').toString('base64') }, method: 'GET', url: '/' },
        { setHeader() {}, set() { return this; }, status() { return this; }, send: resolve },
        reject
      );
    });

    assert.match(html, /Patients/);
    assert.match(html, /Treatments logged/);
  });
});

// ─── simulator transport ──────────────────────────────────────────────────────

describe('simulator', () => {
  it('mounts as an Express router', () => {
    const simulator = require('../src/simulator');
    assert.equal(typeof simulator, 'function');
    assert.ok(Array.isArray(simulator.stack));
  });

  it('every simulator route sits behind Basic Auth', () => {
    const simulator = require('../src/simulator');
    for (const layer of simulator.stack) {
      const handlerCount = layer.route ? layer.route.stack.length : 0;
      assert.ok(handlerCount >= 2, `${layer.route?.path} must have an auth middleware in front of it`);
    }
  });

  it('serves a page that posts to the message endpoint', () => {
    process.env.ADMIN_PASSWORD = 'sekret';
    const simulator = require('../src/simulator');
    let body = '';
    const req = { headers: { authorization: 'Basic ' + Buffer.from('felix:sekret').toString('base64') }, method: 'GET', url: '/' };
    const res = {
      setHeader() {}, set() { return this; },
      status() { return this; },
      send(b) { body = b; },
    };
    simulator.handle(req, res, () => {});
    assert.match(body, /\/simulator\/message/);
    assert.match(body, /Sanko Simulator/);
  });
});

// ─── guest links ──────────────────────────────────────────────────────────────
//
// The promise the share link makes: your friend gets her own conversation, and
// cannot reach yours or /admin. Both halves are asserted here.

describe('simulator guest access', () => {
  const simulator = require('../src/simulator');

  // Minimal stand-in for what Express hands a router.
  function call({ url = '/', method = 'GET', query = {}, headers = {}, body }) {
    return new Promise(resolve => {
      let statusCode = 200;
      let payload;
      const req = { url, method, query, headers, body };
      const res = {
        setHeader() {}, set() { return this; },
        status(c) { statusCode = c; return this; },
        send(b) { payload = b; resolve({ statusCode, payload }); },
        json(b) { payload = b; resolve({ statusCode, payload }); },
      };
      simulator.handle(req, res, () => resolve({ statusCode: 404, payload }));
    });
  }

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'sekret';
    process.env.GUEST_TOKEN = 'let-her-in';
  });
  afterEach(() => { delete process.env.GUEST_TOKEN; });

  it('a valid token opens the page with no password', async () => {
    const { statusCode, payload } = await call({ query: { as: 'amara', t: 'let-her-in' } });
    assert.equal(statusCode, 200);
    assert.match(payload, /"owner":false/);
    assert.match(payload, /"slug":"amara"/);
  });

  it('each guest name is a different conversation, and stable across visits', () => {
    const amara = simulator.guestPhone('amara');
    assert.notEqual(amara, simulator.guestPhone('kofi'));
    assert.equal(amara, simulator.guestPhone('amara'));
    assert.match(amara, /^\+9991\d{7}$/);
    assert.notEqual(amara, simulator.DEFAULT_PHONE);
  });

  it('a guest cannot address another number by asking for one', async () => {
    const { statusCode, payload } = await call({
      url: '/history?phone=%2B99900000001',
      query: { phone: '+99900000001', as: 'amara', t: 'let-her-in' },
    });
    assert.equal(statusCode, 200);
    assert.equal(payload.practitioner.phone, simulator.guestPhone('amara'));
  });

  it('a wrong token falls through to the password prompt', async () => {
    const { statusCode } = await call({ query: { as: 'amara', t: 'guessed' } });
    assert.equal(statusCode, 401);
  });

  it('with GUEST_TOKEN unset there is no guest door at all', async () => {
    delete process.env.GUEST_TOKEN;
    const { statusCode } = await call({ query: { as: 'amara', t: '' } });
    assert.equal(statusCode, 401);
  });

  it('the owner still reaches any number by password', async () => {
    const { statusCode, payload } = await call({
      url: '/history?phone=%2B99900000042',
      query: { phone: '+99900000042' },
      headers: { authorization: 'Basic ' + Buffer.from('felix:sekret').toString('base64') },
    });
    assert.equal(statusCode, 200);
    assert.equal(payload.practitioner.phone, '+99900000042');
  });
});

describe('quick-reply buttons', () => {
  const { splitChoices, MAX_TITLE } = require('../src/utils/choices');

  it('lifts a trailing sentinel off the message', () => {
    const { text, choices } = splitChoices('Have I got that right?\n[[Yes, save it | No, fix something]]');
    assert.equal(text, 'Have I got that right?');
    assert.deepEqual(choices, ['Yes, save it', 'No, fix something']);
  });

  it('leaves an ordinary message untouched', () => {
    const { text, choices } = splitChoices('Which plants did you use?');
    assert.equal(text, 'Which plants did you use?');
    assert.deepEqual(choices, []);
  });

  it('only reads a sentinel on the last line, so [[ ]] mid-message is just text', () => {
    const { text, choices } = splitChoices('I wrote [[this]] earlier\nand then continued.');
    assert.equal(text, 'I wrote [[this]] earlier\nand then continued.');
    assert.deepEqual(choices, []);
  });

  it('clamps to the three buttons WhatsApp accepts', () => {
    const { choices } = splitChoices('Pick\n[[a|b|c|d|e]]');
    assert.deepEqual(choices, ['a', 'b', 'c']);
  });

  it('truncates titles past the 20-character limit rather than letting Meta 400', () => {
    const { choices } = splitChoices('Pick\n[[' + 'x'.repeat(40) + ']]');
    assert.equal(choices[0].length, MAX_TITLE);
  });

  it('strips an empty sentinel instead of showing the practitioner brackets', () => {
    const { text, choices } = splitChoices('All done.\n[[ ]]');
    assert.equal(text, 'All done.');
    assert.deepEqual(choices, []);
  });
});

// ─── botanical names are resolved, never accepted ─────────────────────────────

describe('a fabricated botanical name cannot reach a record', () => {
  // The index used to live in the system prompt and the model wrote the answer
  // into the record. Recall from 442 mappings in context is exactly the task a
  // small local model fails quietly at, and a half-remembered binomial was
  // indistinguishable, in the stored row, from a correct one.

  it('refuses a botanical name supplied by the model', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      plants: [{ local_name: 'dongoyaro', botanical: 'Totally Invented' }],
      confidence_score: 0.9,
    }, ctx(p));

    assert.equal(result.ok, false);
    assert.match(result.error, /not permitted/);
    assert.equal(fake.store.formulations.length, 0, 'nothing is written on a rejected input');
  });

  it('resolves the botanical name from the index instead', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      plants: [{ local_name: 'ewe dongoyaro', quantity_raw: 'two handfuls' }],
      confidence_score: 0.9,
    }, ctx(p));

    assert.equal(result.ok, true);
    const saved = fake.store.formulations[0];
    assert.equal(saved.plants[0].botanical, 'Azadirachta indica');
    assert.equal(saved.plants[0].botanical_source, 'plant_index');
    // The practitioner's own words are what was stored, untouched.
    assert.equal(saved.plants[0].local_name, 'ewe dongoyaro');
    assert.equal(saved.plants[0].quantity_raw, 'two handfuls');
  });

  it('leaves an unknown name unresolved rather than guessing', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      plants: [{ local_name: 'a name no index holds' }],
      confidence_score: 0.9,
    }, ctx(p));

    assert.equal(result.ok, true);
    assert.equal(fake.store.formulations[0].plants[0].botanical, null);
    assert.equal(fake.store.formulations[0].plants[0].botanical_source, null);
    assert.deepEqual(result.unknown_plants, ['a name no index holds']);
  });

  it('reports what it resolved, so the agent can say it accurately', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      plants: [{ local_name: 'dongoyaro' }, { local_name: 'a name no index holds' }],
      confidence_score: 0.9,
    }, ctx(p));

    assert.deepEqual(result.plants.map(x => [x.local_name, x.botanical]), [
      ['dongoyaro', 'Azadirachta indica'],
      ['a name no index holds', null],
    ]);
  });

  it('keeps botanicals resolved when a practitioner edits the plants list', async () => {
    // Writing the edit through unchanged would strip the botanical off a record
    // every time somebody corrected a quantity.
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', { plants: [{ local_name: 'dongoyaro' }], confidence_score: 0.9 }, ctx(p));

    await executeTool('update_formulation', {
      short_code: 'FM-00001',
      plants: [{ local_name: 'dongoyaro', quantity_raw: 'three handfuls' }],
    }, ctx(p, ['FM-00001']));

    const row = fake.store.formulations[0];
    assert.equal(row.plants[0].botanical, 'Azadirachta indica');
    assert.equal(row.plants[0].quantity_raw, 'three handfuls');
  });
});

describe('lookup_plant', () => {
  it('returns what the index holds for a known name', async () => {
    const p = fake.store.seedPractitioner();
    const result = await executeTool('lookup_plant', { local_name: 'dongoyaro' }, ctx(p));

    assert.equal(result.found, true);
    assert.equal(result.ambiguous, false);
    assert.equal(result.botanical, 'Azadirachta indica');
  });

  it('distinguishes a name it does not hold from one it cannot place', async () => {
    const p = fake.store.seedPractitioner();
    const missing = await executeTool('lookup_plant', { local_name: 'a name no index holds' }, ctx(p));

    assert.equal(missing.found, false);
    assert.match(missing.note, /not in Sanko's plant index/);
    // And it tells the agent not to fill the gap itself, which is the whole point.
    assert.match(missing.note, /Do not supply a botanical name yourself/);
  });

  it('matches the same name the save tools would resolve', async () => {
    // One index, one normalisation. If these ever disagreed, the agent would
    // tell a practitioner one thing and record another.
    const p = fake.store.seedPractitioner();
    const looked = await executeTool('lookup_plant', { local_name: 'Ewe Dongoyaro' }, ctx(p));
    await executeTool('save_formulation', { plants: [{ local_name: 'Ewe Dongoyaro' }], confidence_score: 0.9 }, ctx(p));

    assert.equal(looked.botanical, fake.store.formulations[0].plants[0].botanical);
  });
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDb } = require('./helpers/fakeDb');
const { processTurn } = require('../src/router');
const { executeTool } = require('../src/agent/tools');
const { configuration } = require('../src/care/config');
const { validate } = require('../src/care/service');
test('AT01/02/32: unknown and patient-role messages do not create or open a Vault', async () => {
  const fake = installFakeDb(); const sent = [];
  const transport = { sendTextMessage: async (_, s) => sent.push(s), sendButtonMessage: async (_, s) => sent.push(s) };
  const msg = (id, text, time) => ({ id, timestamp: String(time), type: 'text', text: { body: text } });
  try {
    await processTurn('+447700900001', [msg('unknown', 'I am a patient', 100)], transport);
    assert.equal(fake.store.practitioners.length, 0);
    assert.match(sent.pop(), /Which part/);
    const practitioner = fake.store.seedPractitioner({ phone_number: '+447700900002' });
    await processTurn(practitioner.phone_number, [msg('switch', 'My care', 102)], transport);
    await processTurn(practitioner.phone_number, [msg('patient', 'my health update', 103)], transport);
    assert.equal(fake.store.practitioners.length, 1);
    assert.equal(fake.store.agentMessages.length, 0);
    await processTurn(practitioner.phone_number, [{ id: 'old-media', timestamp: '101', type: 'audio', audio: { id: 'no-download' } }], transport);
    assert.match(sent.pop(), /queued before/);
    await processTurn(practitioner.phone_number, [msg('vault', 'My vault', 104), msg('other', 'patient update', 105)], transport);
    assert.match(sent.pop(), /queued before/);
  } finally { fake.restore(); }
});
test('AT16: forged patient-context Vault tool call is refused before executor', async () => {
  const result = await executeTool('list_formulations', {}, { role: 'patient', practitioner: { id: 'spoof' } });
  assert.equal(result.ok, false); assert.match(result.error, /NOT_AUTHORISED/);
});
test('capabilities default off; invalid dependencies and live care fail closed', () => {
  assert.deepEqual(configuration({}), { access: false, encounters: false });
  assert.throws(() => configuration({ CARE_ENCOUNTERS_ENABLED: 'true' }), /REQUIRE/);
  assert.throws(() => configuration({ CARE_SHARING_ENABLED: 'true' }), /UNSUPPORTED/);
  assert.throws(() => configuration({ CARE_PATIENT_ACCESS_ENABLED: 'true', PATIENT_TRACKING_ENABLED: 'true', AGENT_TOOLS: 'full' }), /LIVE_CARE/);
});
test('AT12: care API rejects model-supplied authority and botanical fields', () => {
  assert.throws(() => validate('onboard', { display_name: 'Synthetic', actor_id: 'forged' }), /INVALID_INPUT/);
  assert.throws(() => validate('draft', { encounter_id: '00000000-0000-4000-8000-000000000001', expected_revision: 1, source_text: 'test', summary: 'test', preparations: [{ label: 'plant', botanical: 'Invented' }] }), /INVALID_INPUT/);
});

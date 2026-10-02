'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDb } = require('./helpers/fakeDb');
const { processTurn } = require('../src/router');
const { executeTool } = require('../src/agent/tools');
const { configuration } = require('../src/care/config');
const { validate } = require('../src/care/service');
const { portalOrigin } = require('../src/care/config');
const careChannel = require('../src/care/channel');
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
test('WhatsApp synthetic handoff is opt-in and rejects unsafe portal origins', () => {
  assert.throws(() => configuration({ CARE_WHATSAPP_HANDOFF_ENABLED: 'true' }), /REQUIRES_PATIENT_ACCESS/);
  for (const origin of ['https://care.example.invalid/path', 'https://care.example.invalid?token=secret', 'https://user:pass@care.example.invalid', 'javascript:alert(1)', 'http://care.example.invalid', 'https://care.example.invalid/#today']) {
    assert.throws(() => portalOrigin({ CARE_ORIGIN: origin }), /INVALID_CARE_ORIGIN/);
  }
  assert.equal(portalOrigin({ CARE_ORIGIN: 'https://care.example.invalid' }), 'https://care.example.invalid');
  assert.equal(portalOrigin({ CARE_ORIGIN: 'http://127.0.0.1:3041' }), 'http://127.0.0.1:3041');
  assert.throws(() => portalOrigin({ CARE_ORIGIN: 'http://localhost:3041', NODE_ENV: 'production' }), /INVALID_CARE_ORIGIN/);
});
test('WhatsApp navigation hands off without clinical writes, phone login, or model context', async () => {
  const env = { CARE_PATIENT_ACCESS_ENABLED: 'true', CARE_SYNTHETIC_ONLY: 'true', PATIENT_TRACKING_ENABLED: 'true', AGENT_TOOLS: 'full', CARE_WHATSAPP_HANDOFF_ENABLED: 'true', CARE_ORIGIN: 'https://care.example.invalid' };
  const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const fake = installFakeDb(); const sent = [];
  const transport = { sendTextMessage: async (_, text) => sent.push(text), sendButtonMessage: async (_, text) => sent.push(text) };
  const msg = (text, timestamp) => ({ id: `synthetic-${timestamp}`, timestamp: String(timestamp), type: 'text', text: { body: text } });
  try {
    await processTurn('+447700900099', [msg('My care', 100)], transport);
    assert.match(sent.pop(), /https:\/\/care.example.invalid\/care\//);
    await processTurn('+447700900099', [msg('Check-ins', 101)], transport);
    assert.match(sent.pop(), /\/care\/#check-ins/);
    await processTurn('+447700900099', [msg('Stop', 102)], transport);
    assert.match(sent.pop(), /No preferences have changed in this chat/);
    await processTurn('+447700900099', [msg('I feel worse', 103)], transport);
    const reply = sent.pop();
    assert.match(reply, /No care update was saved/);
    assert.match(reply, /not monitored/);
    assert.doesNotMatch(reply, /900099|I feel worse|token=|subject=/);
    await processTurn('+447700900099', [msg('My vault', 104), msg('Check-ins', 105)], transport);
    assert.match(sent.pop(), /queued before/);
    const practitioner = fake.store.seedPractitioner({ phone_number: '+447700900002' });
    await processTurn(practitioner.phone_number, [msg('Care inbox', 106)], transport);
    assert.match(sent.pop(), /\/care\/#today/);
    assert.equal(fake.store.practitioners.length, 1);
    assert.equal(fake.store.agentMessages.length, 0);
    assert.equal(careChannel.navigation([{ type: 'audio', audio: { id: 'no-download' } }]), null);
    assert.equal(careChannel.navigation([{ type: 'interactive', interactive: { button_reply: { id: 'sanko-care:choices' } } }]), 'choices');
    assert.equal(careChannel.navigation([msg('__proto__', 107)]), null);
    assert.equal(await careChannel.resolve(practitioner.phone_number, [{ id: 'old-care-button', timestamp: '108', type: 'interactive', interactive: { button_reply: { id: 'sanko-care:visits' } } }], practitioner), 'clarify');
  } finally {
    fake.restore();
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

'use strict';
const crypto = require('node:crypto');
const store = require('./store');
function selection(message) {
  const id = message.interactive?.button_reply?.id ?? message.button?.payload;
  const text = message.text?.body?.trim().toLowerCase();
  if (id === 'sanko-role:patient' || text === 'my care') return 'patient';
  if (id === 'sanko-role:practitioner' || text === 'my vault') return 'practitioner';
  return null;
}
async function resolve(from, messages, existing) {
  const choices = messages.map(selection).filter(Boolean);
  // A role command never rebinds other text/media in the same aggregated turn.
  if (choices.length && messages.length !== 1) return 'clarify';
  const message = messages[0] ?? {};
  const times = messages.map(m => Number(m.timestamp)).filter(n => Number.isFinite(n) && n > 0);
  return store.rpc('care_channel_route', {
    p_contact: crypto.createHash('sha256').update(from.replace(/^\+/, '')).digest('hex'),
    p_mode: choices[0] ?? null,
    p_message: message.id ?? crypto.randomUUID(),
    p_time: times.length === messages.length ? new Date(Math.min(...times) * 1000).toISOString() : null,
    p_existing: Boolean(existing),
  });
}
async function reply(mode, from, transport) {
  if (mode === 'patient') {
    await transport.sendTextMessage(from, 'My care is separate from a practitioner Vault. Patient access is not open for live use yet. No clinical record was created. Contact your practice for care or account-rights support.');
  } else if (mode === 'clarify') {
    await transport.sendTextMessage(from, 'Please select My care or My vault, then resend your message. Content queued before a role change cannot be used in the new role.');
  } else {
    await transport.sendButtonMessage(from, 'Which part of Sanko would you like to use? Reply My care or My vault.', [
      { id: 'sanko-role:patient', title: 'My care' }, { id: 'sanko-role:practitioner', title: 'My vault' },
    ]);
  }
}
module.exports = { resolve, reply, selection };

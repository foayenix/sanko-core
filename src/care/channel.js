'use strict';

// Routes an inbound WhatsApp turn to the right audience before the
// practitioner agent sees it.
//
// One phone number may belong to a practitioner, a patient or both, so the
// person chooses "My care" or "My vault". The choice is stored per contact by
// care_channel_route. Patient messages never reach the Vault agent or a model:
// this module replies with generic portal links, and anything clinical happens
// after an individual sign-in to /care.

const crypto = require('node:crypto');
const store = require('./store');
const { handoffEnabled, portalOrigin } = require('./config');
// The role a message selects, from a button tap or the typed label.
function selection(message) {
  const id = message.interactive?.button_reply?.id ?? message.button?.payload;
  const text = message.text?.body?.trim().toLowerCase();
  if (id === 'sanko-role:patient' || text === 'my care') return 'patient';
  if (id === 'sanko-role:practitioner' || text === 'my vault') return 'practitioner';
  return null;
}
// Returns 'patient', 'practitioner', 'clarify' or 'choose' for this turn.
// The phone number is hashed before it reaches the database.
async function resolve(from, messages, existing) {
  const choices = messages.map(selection).filter(Boolean);
  // A role command never rebinds other text/media in the same aggregated turn.
  if (choices.length && messages.length !== 1) return 'clarify';
  const message = messages[0] ?? {};
  const times = messages.map(m => Number(m.timestamp)).filter(n => Number.isFinite(n) && n > 0);
  const mode = await store.rpc('care_channel_route', {
    p_contact: crypto.createHash('sha256').update(from.replace(/^\+/, '')).digest('hex'),
    p_mode: choices[0] ?? null,
    p_message: message.id ?? crypto.randomUUID(),
    p_time:
      times.length === messages.length ? new Date(Math.min(...times) * 1000).toISOString() : null,
    p_existing: Boolean(existing),
  });
  // A patient-menu button issued before a later Vault switch must never enter
  // the practitioner agent, even if tapped with a new message timestamp.
  const patientButton = messages.some(m =>
    (m.interactive?.button_reply?.id ?? m.button?.payload ?? '').startsWith('sanko-care:'),
  );
  return patientButton && mode === 'practitioner' ? 'clarify' : mode;
}
// Maps a menu button or typed command to a portal destination (the URL
// fragment), or null. Only a single-message turn counts.
function navigation(messages) {
  if (messages.length !== 1) return null;
  const message = messages[0];
  const button = message.interactive?.button_reply?.id ?? message.button?.payload;
  const value = button ?? message.text?.body?.trim().toLowerCase();
  const routes = {
    'sanko-care:visits': 'visits',
    'my visits': 'visits',
    'sanko-care:check-ins': 'check-ins',
    'check-ins': 'check-ins',
    'add an update': 'check-ins',
    'sanko-care:choices': 'choices',
    privacy: 'choices',
    stop: 'choices',
    'my reference': 'visits',
    'care inbox': 'today',
  };
  return Object.hasOwn(routes, value) ? routes[value] : null;
}
// A practitioner asking for the "care inbox" gets a link to it instead of an
// agent turn. Returns true when it has replied.
async function practitionerReply(from, messages, transport) {
  if (!handoffEnabled() || navigation(messages) !== 'today') return false;
  await transport.sendTextMessage(
    from,
    `Open your synthetic care inbox and sign in with your individual practice account: ` +
      `${portalOrigin()}/care/#today\nOnly your authorised practice records are available ` +
      `after sign-in.`,
  );
  return true;
}
// The fixed reply for every non-practitioner mode. Links carry no patient
// identifiers, sessions or tokens, so forwarding one grants nothing.
async function reply(mode, from, transport, messages = []) {
  if (mode === 'patient') {
    if (!handoffEnabled()) {
      await transport.sendTextMessage(
        from,
        'My care is separate from a practitioner Vault. Patient access is not open for live ' +
          'use yet. No clinical record was created. Contact your practice for care or ' +
          'account-rights support.',
      );
      return;
    }
    const destination = navigation(messages);
    const url = `${portalOrigin()}/care/${destination ? '#' + destination : ''}`;
    const guidance =
      destination === 'choices'
        ? 'Sign in to stop check-ins, change tracking choices, export your record or request ' +
          'help. No preferences have changed in this chat.'
        : 'Sign in to read released visits, see your reference, or review and send an update ' +
          'to your practice. No care update was saved from this chat.';
    await transport.sendButtonMessage(
      from,
      `Synthetic care workspace — fictional records only.\n${guidance}\n${url}\nThis chat is ` +
        `not monitored for care or emergencies. For care, contact your practice directly.`,
      [
        { id: 'sanko-care:visits', title: 'My visits' },
        { id: 'sanko-care:check-ins', title: 'Check-ins' },
        { id: 'sanko-care:choices', title: 'Privacy and help' },
      ],
    );
  } else if (mode === 'clarify') {
    await transport.sendTextMessage(
      from,
      'Please select My care or My vault, then resend your message. Content queued before a ' +
        'role change cannot be used in the new role.',
    );
  } else {
    await transport.sendButtonMessage(
      from,
      'Which part of Sanko would you like to use? Reply My care or My vault.',
      [
        { id: 'sanko-role:patient', title: 'My care' },
        { id: 'sanko-role:practitioner', title: 'My vault' },
      ],
    );
  }
}
module.exports = { resolve, reply, selection, navigation, practitionerReply };

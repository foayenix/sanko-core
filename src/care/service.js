'use strict';

// Validates one care portal request and passes it to PostgreSQL.
//
// The database functions (care_action, care_review_queue) enforce sessions,
// CSRF, membership, consent and audit. This layer exists so malformed input
// never reaches them: every action has a fixed list of fields, unknown fields
// are refused, and each field has a type check.

const store = require('./store');
const { hash } = require('./auth');
const { configuration } = require('./config');
const link = require('../channel/link');

// Whether WhatsApp care actions are switched on. A misconfigured channel gate
// hides the link option; it never breaks the portal itself.
function channelEnabled() {
  try {
    return require('../channel/config').configuration().careActions;
  } catch {
    return false;
  }
}
// RFC 4122 UUID, versions 1–8.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// API operations, never an agent tool registry. No model receives a session or
// confirmation token. Unknown properties are refused rather than trusted.
const FIELDS = {
  me: [],
  logout: [],
  revoke_sessions: [],
  onboard: ['display_name'],
  invite: ['reference'],
  invitations: [],
  accept_invite: ['id'],
  decline_invite: ['id'],
  preferences: ['purpose', 'granted', 'expected_revision'],
  arrive: ['visit_key', 'occurred_at'],
  draft: [
    'encounter_id',
    'expected_revision',
    'source_text',
    'summary',
    'preparations',
    'note_id',
    'note_revision',
    'amends_id',
    'reason',
  ],
  draft_detail: ['encounter_id', 'note_id'],
  note_source: ['encounter_id', 'note_id'],
  sign: ['encounter_id', 'note_id', 'note_revision', 'expected_revision'],
  release: ['encounter_id', 'note_id', 'note_revision'],
  transition: ['encounter_id', 'expected_revision', 'status'],
  schedule: ['encounter_id', 'due_at'],
  respond: ['id', 'expected_revision', 'report', 'observed_at'],
  patient_report: ['kind', 'encounter_id', 'report', 'observed_at'],
  review: ['id', 'expected_revision', 'next_steps'],
  rights: ['kind'],
  timeline: ['before', 'cursor'],
  export: [],
  access_history: ['before'],
  today: [],
  formulations: [],
  review_queue: [],
  channel_link: [],
};
// Fields that may be null or absent for every action that takes them.
const OPTIONAL = new Set(['note_id', 'note_revision', 'amends_id', 'reason', 'before', 'cursor']);
// Actions that also need CARE_ENCOUNTERS_ENABLED, not just patient access.
const ENCOUNTER_ACTIONS = new Set([
  'arrive',
  'draft',
  'sign',
  'release',
  'transition',
  'schedule',
  'respond',
  'review',
  'patient_report',
  'review_queue',
]);
// Throws INVALID_ACTION for an unknown action and INVALID_INPUT for any field
// that is missing, unexpected or the wrong shape.
function validate(action, data) {
  const fields = FIELDS[action];
  if (!fields) throw new Error('INVALID_ACTION');
  if (
    !data ||
    Array.isArray(data) ||
    typeof data !== 'object' ||
    Object.keys(data).some(k => !fields.includes(k))
  )
    throw new Error('INVALID_INPUT');
  for (const field of fields) {
    const value = data[field];
    if (
      value == null &&
      (OPTIONAL.has(field) ||
        (action === 'patient_report' && field === 'encounter_id') ||
        (action === 'review' && field === 'expected_revision'))
    )
      continue;
    if (value == null) throw new Error('INVALID_INPUT');
    if (field === 'id' || field.endsWith('_id') || field === 'visit_key') {
      if (!UUID.test(value)) throw new Error('INVALID_INPUT');
    } else if (field === 'cursor') {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length !== 3
      )
        throw new Error('INVALID_INPUT');
      for (const name of ['encounters', 'observations', 'follow_ups']) {
        const point = value[name];
        if (
          !point ||
          Object.keys(point).length !== 2 ||
          !UUID.test(point.id) ||
          typeof point.at !== 'string' ||
          !Number.isFinite(Date.parse(point.at))
        )
          throw new Error('INVALID_INPUT');
      }
    } else if (field.endsWith('revision')) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_INPUT');
    } else if (field.endsWith('_at') || field === 'before') {
      if (
        typeof value !== 'string' ||
        !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw new Error('INVALID_INPUT');
    } else if (field === 'granted') {
      if (typeof value !== 'boolean') throw new Error('INVALID_INPUT');
    } else if (field === 'preparations') {
      if (!Array.isArray(value) || value.length > 10) throw new Error('INVALID_INPUT');
      for (const prep of value) {
        if (
          !prep ||
          typeof prep !== 'object' ||
          Array.isArray(prep) ||
          Object.keys(prep).some(
            k =>
              ![
                'label',
                'formulation_code',
                'formulation_updated_at',
                'reported_use',
                'disclose_composition',
              ].includes(k),
          )
        )
          throw new Error('INVALID_INPUT');
        if (typeof prep.label !== 'string' || !prep.label.trim() || prep.label.length > 150)
          throw new Error('INVALID_INPUT');
        if (
          prep.reported_use != null &&
          (typeof prep.reported_use !== 'string' || prep.reported_use.length > 1000)
        )
          throw new Error('INVALID_INPUT');
        if (
          prep.formulation_code != null &&
          (!/^FM-\d{5,}$/.test(prep.formulation_code) ||
            !Number.isFinite(Date.parse(prep.formulation_updated_at)))
        )
          throw new Error('INVALID_INPUT');
        if (prep.disclose_composition != null && typeof prep.disclose_composition !== 'boolean')
          throw new Error('INVALID_INPUT');
      }
    } else if (typeof value !== 'string' || !value.trim() || value.length > 10000)
      throw new Error('INVALID_INPUT');
  }
  if (
    action === 'patient_report' &&
    !['correction', 'past_visit', 'product_report'].includes(data.kind)
  )
    throw new Error('INVALID_INPUT');
}
// `body` is { action, role, subject, practice, data, key, confirmation }.
// `key` is the idempotency key. Consequential actions run in two steps:
// 'prepare' returns a confirmation id for the exact action and data, which the
// browser shows the person and then sends back with the real action.
async function act(token, csrf, body) {
  const flags = configuration();
  if (!flags.access) throw new Error('FEATURE_DISABLED');
  if (
    !body ||
    Object.keys(body).some(
      k => !['action', 'role', 'subject', 'practice', 'data', 'key', 'confirmation'].includes(k),
    )
  )
    throw new Error('INVALID_INPUT');
  const {
    action,
    role,
    subject = null,
    practice = null,
    key = null,
    confirmation = null,
    data = {},
  } = body;
  if (!['patient', 'practitioner'].includes(role)) throw new Error('NOT_FOUND');
  for (const id of [subject, practice, key, confirmation])
    if (id !== null && !UUID.test(id)) throw new Error('INVALID_INPUT');
  if (action === 'prepare') {
    if (!data || Object.keys(data).some(k => !['action', 'data'].includes(k)))
      throw new Error('INVALID_INPUT');
    validate(data.action, data.data);
  } else validate(action, data);
  if (ENCOUNTER_ACTIONS.has(action === 'prepare' ? data.action : action) && !flags.encounters)
    throw new Error('FEATURE_DISABLED');
  if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new Error('CSRF_REQUIRED');
  if (action === 'channel_link') {
    // Links one WhatsApp contact to this signed-in account for in-chat care.
    if (!channelEnabled()) throw new Error('FEATURE_DISABLED');
    return link.issue(store, 'care_channel_link_code', hash(token), hash(csrf));
  }
  if (action === 'review_queue') {
    if (role !== 'practitioner' || subject !== null || practice === null)
      throw new Error('NOT_FOUND');
    return store.rpc('care_review_queue', {
      p_token: hash(token),
      p_csrf: hash(csrf),
      p_practice: practice,
    });
  }
  const result = await store.rpc('care_action', {
    p_token: hash(token),
    p_csrf: hash(csrf),
    p_action: action,
    p_role: role,
    p_subject: subject,
    p_practice: practice,
    p_data: data,
    p_key: key,
    p_confirmation: confirmation,
  });
  return action === 'me'
    ? { ...result, capabilities: { encounters: flags.encounters, whatsapp: channelEnabled() } }
    : result;
}
module.exports = { act, validate, UUID };

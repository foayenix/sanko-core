'use strict';

// Building blocks shared by the guided WhatsApp workflows.
//
// A workflow is a set of steps. Each step has a render function (which sends
// a message and usually issues a prompt) and handlers for a chosen option or
// typed text. All state lives in channel_tasks: the step, the draft and a
// revision. Nothing is kept in process memory between messages, so a restart,
// a second instance or a long pause resumes from the database.

const crypto = require('node:crypto');
const store = require('./store');
const copy = require('./copy');
const careService = require('../care/service');
const evidenceService = require('../evidence/service');

// WhatsApp interactive limits applied here. Buttons: three, 20-character
// titles (already enforced in src/utils/choices.js). Lists: ten rows,
// 24-character titles, 72-character descriptions, 20-character button text.
// Re-verify against Meta's current reference before live use.
const MAX_BUTTONS = 3;
const MAX_BUTTON_TITLE = 20;
const MAX_ROWS = 10;
const MAX_ROW_TITLE = 24;
const MAX_ROW_DESCRIPTION = 72;
// Interactive bodies are kept well under Meta's 1024-character button body.
const MAX_INTERACTIVE_BODY = 900;
// Plain text messages are split below WhatsApp's 4096-character limit.
const MAX_TEXT = 3500;
// A care/evidence confirmation lives five minutes; a prompt that carries one
// must not outlive it.
const CONFIRM_MINUTES = 5;
const PROMPT_MINUTES = 24 * 60;
const BUTTON_ID =
  /^sk1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,2})$/;

const contactHash = from =>
  crypto.createHash('sha256').update(String(from).replace(/^\+/, '')).digest('hex');
const uuid = () => crypto.randomUUID();

class FlowError extends Error {}
const fail = code => {
  throw new FlowError(code);
};

function context({ from, transport, flags, status, messageId }) {
  const ctx = {
    from,
    contact: contactHash(from),
    address: String(from).startsWith('+') ? String(from) : `+${from}`,
    transport,
    flags,
    status,
    messageId,
    t: copy.text,
    L: copy.label,
    say: body => say(ctx, body),
  };
  return ctx;
}

async function say(ctx, body) {
  for (const part of split(String(body))) await ctx.transport.sendTextMessage(ctx.from, part);
}

// Splits long text on paragraph, then line, then word boundaries.
function split(body, max = MAX_TEXT) {
  const parts = [];
  let rest = body.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

const rpc = (name, args) => store.rpc(name, args);

async function start(
  ctx,
  { domain, role, workflow, step, practice_id = null, subject_id = null, draft = {} },
) {
  return rpc('channel_task_put', {
    p_contact: ctx.contact,
    p_task: {
      binding_id: domain === 'none' ? null : (ctx.status[domain]?.binding_id ?? null),
      domain,
      role,
      workflow,
      step,
      practice_id,
      subject_id,
      language: ctx.status[domain]?.language ?? 'en',
      copy_version: copy.VERSION,
      draft,
    },
    p_expected: null,
  });
}

// Persists a change to the task. The revision check means two turns racing on
// the same task cannot both win; the loser gets TASK_CONFLICT.
async function save(ctx, task, changes = {}) {
  const next = {
    ...task,
    ...changes,
    draft: changes.draft === undefined ? task.draft : changes.draft,
  };
  return rpc('channel_task_put', {
    p_contact: ctx.contact,
    p_task: next,
    p_expected: task.revision,
  });
}

async function finish(ctx, task, status = 'completed', receipt = null) {
  return save(ctx, task, { status, receipt });
}

// Labels for a prompt: fixed copy for known codes, or the caller's own.
function labelsFor(codes, labels = {}) {
  return codes.map(code => labels[code] ?? copy.label(code));
}

const shorten = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

// Issues a prompt for the task's current revision and sends it. Up to three
// short options become reply buttons; longer menus become a list. Transports
// without interactive support get a numbered text equivalent bound to the
// same prompt.
async function ask(ctx, task, body, codes, options = {}) {
  const labels = labelsFor(codes, options.labels);
  const promptId = await rpc('channel_prompt_issue', {
    p_contact: ctx.contact,
    p_task: task.id,
    p_task_revision: task.revision,
    p_step: task.step,
    p_options: codes,
    p_labels: labels,
    p_minutes: options.confirmation ? CONFIRM_MINUTES : (options.minutes ?? PROMPT_MINUTES),
    p_consequential: Boolean(options.bound || options.confirmation),
    p_action: options.action ?? null,
    p_confirmation: options.confirmation ?? null,
    p_operation_key: options.bound || options.confirmation ? uuid() : null,
  });
  let question = body;
  if (body.length > MAX_INTERACTIVE_BODY) {
    await say(ctx, body);
    question = options.question ?? 'Please choose:';
  }
  if (options.hint) question += `\n\n${copy.text('free_reply_hint')}`;
  const id = i => `sk1.${promptId}.${i}`;
  const buttons = codes.length <= MAX_BUTTONS && labels.every(l => l.length <= MAX_BUTTON_TITLE);
  if (buttons && ctx.transport.sendButtonMessage) {
    await ctx.transport.sendButtonMessage(
      ctx.from,
      question,
      labels.map((title, i) => ({ id: id(i), title })),
    );
  } else if (!buttons && ctx.transport.sendListMessage) {
    await ctx.transport.sendListMessage(
      ctx.from,
      question,
      'Choose',
      labels.map((title, i) => ({
        id: id(i),
        title: shorten(title, MAX_ROW_TITLE),
        description:
          title.length > MAX_ROW_TITLE
            ? shorten(title, MAX_ROW_DESCRIPTION)
            : options.descriptions?.[codes[i]]
              ? shorten(options.descriptions[codes[i]], MAX_ROW_DESCRIPTION)
              : undefined,
      })),
    );
  } else {
    await say(ctx, `${question}\n\n${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}`);
  }
  return promptId;
}

// Lists longer than a page get a "More" row that advances an offset kept in
// the draft.
function page(items, offset = 0, size = MAX_ROWS - 2) {
  const slice = items.slice(offset, offset + size);
  return { slice, more: offset + size < items.length };
}

// Records the outcome of a bound prompt so a repeated tap replays it.
async function receipt(ctx, prompt, message, extra = {}) {
  await rpc('channel_prompt_result', {
    p_contact: ctx.contact,
    p_prompt: prompt.id,
    p_result: { message, ...extra },
  });
  await say(ctx, message);
}

// Care operation through the contact's verified channel session. Input is
// validated with the same rules as the browser before it reaches SQL.
async function care(ctx, task, action, data = {}, envelope = {}) {
  if (action === 'prepare') careService.validate(data.action, data.data);
  else if (action !== 'review_queue') careService.validate(action, data);
  return rpc('channel_care_act', {
    p_contact: ctx.contact,
    p_action: action,
    p_role: envelope.role ?? task.role,
    p_subject: envelope.subject === undefined ? task.subject_id : envelope.subject,
    p_practice: envelope.practice === undefined ? task.practice_id : envelope.practice,
    p_data: data,
    p_key: envelope.key ?? null,
    p_confirmation: envelope.confirmation ?? null,
  });
}

async function evidence(
  ctx,
  action,
  { request = null, revision = null, data = {}, key = null, confirmation = null } = {},
) {
  if (action === 'prepare') evidenceService.validate(data.action, data.data);
  else evidenceService.validate(action, data);
  const result = await rpc('channel_evidence_act', {
    p_contact: ctx.contact,
    p_action: action,
    p_request: request,
    p_revision: revision,
    p_data: data,
    p_key: key,
    p_confirmation: confirmation,
  });
  // An owner-scope refusal comes back as data so its audit row is kept.
  if (result?.refused) fail(result.refused);
  return result;
}

// Shows the exact item to confirm and binds the confirmation to the tap.
// `body` may be a function of the prepare result (for example the signing
// preview the database returns). The pending operation is stored in the task,
// so the tap executes exactly what was shown; any later change to the task
// changes its revision and makes the old tap stale.
async function confirm(ctx, task, { domain, action, data, envelope = {}, body, codes, labels }) {
  const prepared =
    domain === 'care'
      ? await care(ctx, task, 'prepare', { action, data }, envelope)
      : await evidence(ctx, 'prepare', { ...envelope, data: { action, data } });
  const next = await save(ctx, task, {
    draft: { ...task.draft, pending: { domain, action, data, envelope } },
  });
  await ask(ctx, next, typeof body === 'function' ? body(prepared) : body, codes, {
    confirmation: prepared.confirmation,
    action,
    labels,
  });
  return prepared;
}

// The same review-then-tap contract for operations the domain does not
// require a confirmation token for (drafts, answers): the tap carries an
// operation key so a repeated tap replays the first receipt.
async function bind(ctx, task, { domain, action, data, envelope = {}, body, codes, labels }) {
  const next = await save(ctx, task, {
    draft: { ...task.draft, pending: { domain, action, data, envelope } },
  });
  await ask(ctx, next, body, codes, { bound: true, action, labels });
}

async function execute(ctx, task, prompt) {
  const pending = task.draft.pending;
  if (!pending || pending.action !== prompt.action || !prompt.operation_key) fail('TASK_CONFLICT');
  const extra = { key: prompt.operation_key, confirmation: prompt.confirmation ?? null };
  if (pending.domain === 'care')
    return care(ctx, task, pending.action, pending.data, { ...pending.envelope, ...extra });
  return evidence(ctx, pending.action, { ...pending.envelope, data: pending.data, ...extra });
}

const formatDate = value =>
  value
    ? new Date(value).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'unknown date';
const formatTime = value =>
  `${formatDate(value)} ${new Date(value).toISOString().slice(11, 16)} UTC`;
const shortRef = id => String(id).slice(0, 8).toUpperCase();

module.exports = {
  BUTTON_ID,
  MAX_BUTTONS,
  MAX_BUTTON_TITLE,
  MAX_ROWS,
  MAX_ROW_TITLE,
  MAX_TEXT,
  CONFIRM_MINUTES,
  FlowError,
  fail,
  contactHash,
  uuid,
  context,
  say,
  split,
  rpc,
  start,
  save,
  finish,
  ask,
  page,
  receipt,
  care,
  evidence,
  confirm,
  bind,
  execute,
  formatDate,
  formatTime,
  shortRef,
  shorten,
};

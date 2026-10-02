'use strict';

// Guided WhatsApp tasks: the entry point the router calls before the Vault
// agent or the portal handoff.
//
// Authority comes only from (a) the verified webhook's sender, hashed into a
// contact, (b) a channel binding created by an individually authenticated
// portal principal through a single-use link code, and (c) opaque prompt ids
// issued by the server for the contact's current task revision. Button
// labels, typed text and model output never authorise anything. Every care or
// evidence operation goes through channel_care_act / channel_evidence_act,
// which call the same database functions as the browser.

const kit = require('./kit');
const copy = require('./copy');
const config = require('./config');
const log = require('../utils/log');

const WORKFLOWS = {
  link: require('./flows/link'),
  vault: require('./flows/vault'),
  patient: require('./flows/patient'),
  practice: require('./flows/practice'),
  evidence: require('./flows/evidence'),
};
// Which side of the My care / My vault switch a workflow belongs to.
const MODE = {
  link: 'patient',
  patient: 'patient',
  vault: 'practitioner',
  practice: 'practitioner',
  evidence: 'practitioner',
};

const COMMANDS = {
  menu: 'menu',
  back: 'back',
  cancel: 'cancel',
  help: 'help',
  language: 'language',
  stop: 'stop',
  'stop messages': 'stop',
  unsubscribe: 'stop',
  resume: 'resume',
  'resume messages': 'resume',
  unlink: 'unlink',
};
const PRACTITIONER_ENTRY = new Set([
  'care inbox',
  'my patients',
  'record a visit',
  'evidence reports',
]);
// Role selection words and the earlier navigation commands just open the menu
// of the selected side; they are never saved as a care message.
const ROLE_WORDS = new Set([
  'my care',
  'my vault',
  'my visits',
  'check-ins',
  'add an update',
  'privacy',
  'my reference',
]);
const LINK = /^link\s+([a-z0-9]{4})-?([a-z0-9]{4})$/i;
const LINK_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

function parse(message) {
  const id =
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id ??
    message.button?.payload;
  if (id) {
    const match = kit.BUTTON_ID.exec(id);
    if (match) return { kind: 'tap', prompt: match[1], index: Number(match[2]) };
    // Role selection and the earlier portal-navigation buttons open the menu.
    if (id.startsWith('sanko-role:') || id.startsWith('sanko-care:')) return { kind: 'role' };
    return { kind: 'foreign_tap', id };
  }
  if (message.type === 'text') {
    const text = String(message.text?.body ?? '').trim();
    const normal = text
      .toLowerCase()
      .replace(/[.!]+$/, '')
      .replace(/\s+/g, ' ');
    if (ROLE_WORDS.has(normal)) return { kind: 'role' };
    const link = LINK.exec(text);
    if (link) return { kind: 'link', code: (link[1] + link[2]).toUpperCase() };
    if (Object.hasOwn(COMMANDS, normal))
      return { kind: 'command', command: COMMANDS[normal], raw: normal };
    return { kind: 'text', text, normal };
  }
  if (['audio', 'image', 'video', 'document', 'sticker'].includes(message.type))
    return { kind: 'media' };
  return { kind: 'other' };
}

const codeHash = code => require('node:crypto').createHash('sha256').update(code).digest('hex');

// The router asks this first. Returns true when the turn was handled here.
async function handle({ from, messages, mode, transport, existing = null }) {
  if (!config.enabled()) return false;
  const flags = config.configuration();
  if (!['patient', 'practitioner', 'choose', 'clarify'].includes(mode)) return false;
  const inputs = messages.map(parse);
  const ctx = kit.context({
    from,
    transport,
    flags,
    status: {},
    messageId: messages.map(m => m.id).join('|'),
  });

  // STOP is honoured in every context that is not the Vault conversation,
  // before anything else and without requiring verification.
  const stopAnywhere = inputs.some(
    i =>
      i.kind === 'command' && i.command === 'stop' && (mode !== 'practitioner' || i.raw !== 'stop'),
  );
  if (mode === 'choose' || mode === 'clarify') {
    if (!stopAnywhere) return false;
  }
  ctx.status = await kit.rpc('channel_status', { p_contact: ctx.contact });
  let task = await kit.rpc('channel_task_get', { p_contact: ctx.contact });
  if (task && (mode === 'patient' || mode === 'practitioner') && MODE[task.workflow] !== mode) {
    await kit.finish(ctx, task, 'superseded');
    await ctx.say(copy.text('task_closed_role'));
    task = null;
  }
  const prompt = task ? await kit.rpc('channel_current_prompt', { p_contact: ctx.contact }) : null;
  if (!claims({ mode, inputs, task, prompt, ctx, existing })) return false;

  for (let i = 0; i < inputs.length; i++) {
    // Before a role is chosen, only STOP is acted on here.
    if (
      (mode === 'choose' || mode === 'clarify') &&
      !(inputs[i].kind === 'command' && inputs[i].command === 'stop')
    )
      continue;
    try {
      await step(ctx, mode, inputs[i], messages[i]);
    } catch (err) {
      await recover(ctx, err);
    }
  }
  return true;
}

// Whether this turn belongs to a guided task. In My vault the default is the
// agent: only explicit guided input is claimed, and typed text only while the
// current step expects text or the text answers the current prompt.
function claims({ mode, inputs, task, prompt, ctx }) {
  const bound = Boolean(ctx.status.care || ctx.status.evidence);
  if (mode === 'choose' || mode === 'clarify') return true; // only STOP reaches here
  if (mode === 'patient')
    return ctx.flags.careActions || inputs.some(i => i.kind === 'command' && i.command === 'stop');
  const handler = task && WORKFLOWS[task.workflow]?.steps[task.step];
  const answersPrompt = i =>
    prompt &&
    (/^\d{1,2}$/.test(i.normal) ||
      (prompt.labels ?? []).some(label => label.toLowerCase() === i.normal));
  return inputs.some(i => {
    if (i.kind === 'tap' || i.kind === 'link') return true;
    if (i.kind === 'command') {
      if (i.command === 'stop' || i.command === 'resume') return i.raw !== 'stop' || Boolean(task);
      return bound || Boolean(task);
    }
    if (i.kind === 'text')
      return (
        Boolean(task && (handler?.text || answersPrompt(i))) ||
        (bound && PRACTITIONER_ENTRY.has(i.normal))
      );
    if (i.kind === 'media') return Boolean(task && handler?.text);
    return false;
  });
}

async function step(ctx, mode, input) {
  if (input.kind === 'link') return redeem(ctx, mode, input.code);
  if (input.kind === 'command') return command(ctx, mode, input.command);
  if (input.kind === 'tap') return answer(ctx, mode, input.prompt, input.index);
  if (input.kind === 'role') return menu(ctx, mode);
  if (input.kind === 'foreign_tap') {
    await ctx.say(copy.text('stale_choice'));
    return menu(ctx, mode);
  }
  const task = await kit.rpc('channel_task_get', { p_contact: ctx.contact });
  if (input.kind === 'text') {
    // Explicit navigation always works; it starts a new task (the open one is
    // superseded without saving anything).
    if (mode === 'practitioner' && PRACTITIONER_ENTRY.has(input.normal))
      return entry(ctx, input.normal);
    // A number or an exact label answers the current prompt, and only it.
    const prompt = await kit.rpc('channel_current_prompt', { p_contact: ctx.contact });
    if (prompt) {
      const index = /^\d{1,2}$/.test(input.normal)
        ? Number(input.normal) - 1
        : (prompt.labels ?? []).findIndex(label => label.toLowerCase() === input.normal);
      if (index >= 0 && index < prompt.options.length) return answer(ctx, mode, prompt.id, index);
    }
    if (!task) return freeText(ctx, mode, input.text);
    const handler = flow(task).steps[task.step];
    if (handler?.text) return handler.text(ctx, task, input.text, api);
    if (flow(task).freeText && !handler?.confirm)
      return flow(task).freeText(ctx, task, input.text, api);
    return ctx.say(copy.text('choose_hint'));
  }
  if (input.kind === 'media') {
    const handler = task && flow(task).steps[task.step];
    if (handler?.media) return handler.media(ctx, task, api);
    return ctx.say(
      copy.text(task?.role === 'practitioner' ? 'practitioner_media' : 'media_not_supported'),
    );
  }
  return ctx.say(copy.text('choose_hint'));
}

const flow = task => WORKFLOWS[task.workflow] ?? fail('UNKNOWN_WORKFLOW');
const fail = code => {
  throw new Error(code);
};

async function render(ctx, task) {
  const generic = GENERIC[task.step];
  if (generic) return generic.render(ctx, task);
  const handler = flow(task).steps[task.step];
  if (!handler) fail('UNKNOWN_STEP');
  return handler.render(ctx, task, api);
}

// Moves the task to a step, saving the draft change first, then shows it.
async function go(ctx, task, step, patch = {}, { back = true } = {}) {
  const draft = { ...task.draft, ...patch };
  if (back && task.step !== step && !task.step.startsWith('_'))
    draft._back = [...(task.draft._back ?? []), task.step].slice(-20);
  const next = await kit.save(ctx, task, { step, draft });
  await render(ctx, next);
  return next;
}

// Finishes the task and tells the person, recording the receipt on a bound
// prompt so a repeated tap replays the same answer.
async function done(ctx, task, message, prompt = null) {
  await kit.finish(ctx, task, 'completed', { message });
  if (prompt) await kit.receipt(ctx, prompt, message);
  else await ctx.say(message);
}

async function menu(ctx, mode) {
  if (mode === 'patient') {
    if (ctx.flags.careActions && ctx.status.care)
      return render(
        ctx,
        await kit.start(ctx, {
          domain: 'care',
          role: 'patient',
          workflow: 'patient',
          step: 'menu',
        }),
      );
    return render(
      ctx,
      await kit.start(ctx, { domain: 'none', role: 'none', workflow: 'link', step: 'menu' }),
    );
  }
  if (!ctx.status.care && !ctx.status.evidence) return ctx.say(copy.text('link_help'));
  return render(
    ctx,
    await kit.start(ctx, { domain: 'none', role: 'none', workflow: 'vault', step: 'menu' }),
  );
}

async function entry(ctx, normal) {
  const target = { 'care inbox': 'inbox', 'my patients': 'patients', 'record a visit': 'visit' }[
    normal
  ];
  if (target) return WORKFLOWS.vault.openPractice(ctx, target, api);
  return WORKFLOWS.vault.openEvidence(ctx, api);
}

async function freeText(ctx, mode, text) {
  if (mode === 'patient' && ctx.flags.careActions && ctx.status.care) {
    const task = await kit.start(ctx, {
      domain: 'care',
      role: 'patient',
      workflow: 'patient',
      step: 'menu',
    });
    return WORKFLOWS.patient.freeText(ctx, task, text, api);
  }
  if (mode === 'patient') {
    // Not linked: say plainly that nothing entered a care record.
    await ctx.say(copy.text('discarded'));
  }
  return menu(ctx, mode);
}

async function command(ctx, mode, name) {
  if (name === 'stop') return stop(ctx);
  let task = await kit.rpc('channel_task_get', { p_contact: ctx.contact });
  if (name === 'menu') return menu(ctx, mode);
  if (name === 'help') {
    await ctx.say(copy.text('help'));
    return task ? render(ctx, task) : undefined;
  }
  if (name === 'cancel') {
    if (task) await kit.finish(ctx, task, 'cancelled');
    return ctx.say(copy.text('cancelled'));
  }
  if (name === 'back') {
    const history = task?.draft?._back ?? [];
    if (!task || !history.length) {
      await ctx.say(copy.text('nothing_to_go_back'));
      return menu(ctx, mode);
    }
    const next = await kit.save(ctx, task, {
      step: history.at(-1),
      draft: { ...task.draft, _back: history.slice(0, -1) },
    });
    return render(ctx, next);
  }
  // Language, resume and unlink are steps inside the current task, so the
  // task and its draft survive them.
  if (!task) {
    if (mode === 'patient' && !(ctx.flags.careActions && ctx.status.care)) {
      if (name === 'language')
        task = await kit.start(ctx, {
          domain: 'none',
          role: 'none',
          workflow: 'link',
          step: 'menu',
        });
      else return ctx.say(copy.text(name === 'resume' ? 'resume_needs_link' : 'link_help'));
    } else if (mode === 'patient') {
      task = await kit.start(ctx, {
        domain: 'care',
        role: 'patient',
        workflow: 'patient',
        step: 'menu',
      });
    } else {
      if (!ctx.status.care && !ctx.status.evidence)
        return ctx.say(copy.text(name === 'resume' ? 'resume_needs_link' : 'link_help'));
      task = await kit.start(ctx, {
        domain: 'none',
        role: 'none',
        workflow: 'vault',
        step: 'menu',
      });
    }
  }
  return enterGeneric(ctx, task, `_${name}`);
}

async function enterGeneric(ctx, task, step) {
  const ret = task.step.startsWith('_') ? (task.draft._return ?? 'menu') : task.step;
  return go(ctx, task, step, { _return: ret }, { back: false });
}

async function stop(ctx) {
  let result;
  try {
    result = await kit.rpc('channel_stop', {
      p_contact: ctx.contact,
      p_message: ctx.messageId || null,
    });
  } catch (err) {
    log.error('channel.stop_failed', { error: err.message });
    return ctx.say(copy.text('stop_failed'));
  }
  return ctx.say(
    copy.text('stopped', { cancelled: result.cancelled, inFlight: result.in_flight > 0 }),
  );
}

async function redeem(ctx, mode, code) {
  if (!LINK_ALPHABET.test(code)) return ctx.say(copy.text('link_failed'));
  let result;
  try {
    result = await kit.rpc('channel_redeem_link', {
      p_contact: ctx.contact,
      p_address: ctx.address,
      p_code_hash: codeHash(code),
      p_session_minutes: ctx.flags.sessionMinutes,
    });
  } catch (err) {
    if (err.message === 'LINK_LOCKED') return ctx.say(copy.text('link_locked'));
    throw err;
  }
  if (!result?.linked) return ctx.say(copy.text('link_failed'));
  await ctx.say(copy.text('linked', { name: result.name, domain: result.domain }));
  ctx.status = await kit.rpc('channel_status', { p_contact: ctx.contact });
  const task = await kit.rpc('channel_task_get', { p_contact: ctx.contact });
  if (result.renewed && task && MODE[task.workflow] === mode) {
    // Confirmations were bound to the old session; showing the step again
    // prepares a fresh one for a fresh review.
    await ctx.say(copy.text('resume_task'));
    return render(ctx, task);
  }
  return menu(ctx, mode);
}

async function answer(ctx, mode, promptId, index) {
  const result = await kit.rpc('channel_prompt_answer', {
    p_contact: ctx.contact,
    p_prompt: promptId,
    p_index: index,
  });
  if (result.state === 'replay') {
    if (result.result?.message) return ctx.say(result.result.message);
    // Answered but the outcome was never recorded (a crash mid-step). Re-run
    // it: operation keys make the business action replay its receipt.
    const task = await kit.rpc('channel_task_get', { p_contact: ctx.contact });
    if (task && task.revision === result.prompt.task_revision && task.step === result.prompt.step)
      return choose(ctx, task, result.answer, result.prompt);
    return ctx.say(copy.text('stale_choice'));
  }
  if (result.state !== 'answered') {
    await ctx.say(copy.text('stale_choice'));
    const task = await kit.rpc('channel_task_get', { p_contact: ctx.contact });
    return task ? render(ctx, task) : menu(ctx, mode);
  }
  return choose(ctx, result.task, result.answer, result.prompt);
}

async function choose(ctx, task, code, prompt) {
  const generic = GENERIC[prompt.step];
  if (generic) return generic.choose(ctx, task, code, prompt);
  const handler = flow(task).steps[prompt.step];
  if (!handler?.choose) fail('UNKNOWN_STEP');
  if (code === 'back' && !handler.ownBack) return command(ctx, MODE[task.workflow], 'back');
  if (code === 'cancel' && !handler.ownCancel) {
    await kit.finish(ctx, task, 'cancelled');
    return ctx.say(copy.text('cancelled'));
  }
  if (code === 'menu') return menu(ctx, MODE[task.workflow]);
  if (code === 'help') {
    await ctx.say(copy.text('help'));
    return render(ctx, task);
  }
  if (code === 'language') return enterGeneric(ctx, task, '_language');
  return handler.choose(ctx, task, code, prompt, api);
}

const back = (ctx, task) => go(ctx, task, task.draft._return ?? 'menu', {}, { back: false });

// Steps every workflow shares.
const GENERIC = {
  _language: {
    render: (ctx, task) =>
      kit.ask(
        ctx,
        task,
        copy.text('language_prompt'),
        copy.LANGUAGES.map(l => `lang_${l.code}`),
        {
          labels: Object.fromEntries(copy.LANGUAGES.map(l => [`lang_${l.code}`, l.label])),
        },
      ),
    choose: async (ctx, task, code) => {
      const language = copy.LANGUAGES.find(l => `lang_${l.code}` === code);
      if (!language) return render(ctx, task);
      if (task.domain !== 'none')
        await kit.rpc('channel_set_language', {
          p_contact: ctx.contact,
          p_language: language.code,
        });
      await ctx.say(
        language.available
          ? copy.text('language_set')
          : copy.text('language_unavailable', { label: language.label }),
      );
      return back(ctx, task);
    },
  },
  _resume: {
    render: (ctx, task) =>
      kit.ask(ctx, task, copy.text('resume_confirm'), ['resume_messages', 'keep_stopped'], {
        bound: true,
      }),
    choose: async (ctx, task, code, prompt) => {
      if (code === 'resume_messages') {
        try {
          await kit.rpc('channel_resume', {
            p_contact: ctx.contact,
            p_message: ctx.messageId || null,
          });
        } catch (err) {
          if (err.message === 'CHANNEL_VERIFICATION_REQUIRED')
            return ctx.say(copy.text('resume_needs_link'));
          throw err;
        }
        await kit.receipt(ctx, prompt, copy.text('resumed'));
      } else await kit.receipt(ctx, prompt, copy.text('kept_stopped'));
      return back(ctx, task);
    },
  },
  _unlink: {
    render: (ctx, task) =>
      kit.ask(ctx, task, copy.text('unlink_confirm'), ['confirm_unlink', 'back'], { bound: true }),
    choose: async (ctx, task, code, prompt) => {
      if (code !== 'confirm_unlink') return back(ctx, task);
      await kit.rpc('channel_unlink', {
        p_contact: ctx.contact,
        p_domain: task.workflow === 'patient' ? 'care' : null,
      });
      await kit.receipt(ctx, prompt, copy.text('unlinked'));
      // Revocation ended this contact's tasks; nothing else to save.
    },
  },
};

// Maps failures to honest messages. Nothing here reports success.
async function recover(ctx, err) {
  const code = err.message;
  const task = await kit.rpc('channel_task_get', { p_contact: ctx.contact }).catch(() => null);
  if (code === 'CHANNEL_VERIFICATION_REQUIRED')
    return ctx.say(
      copy.text('verify_again', { domain: task?.domain === 'evidence' ? 'evidence' : 'care' }),
    );
  if (code === 'REAUTHENTICATE') return ctx.say(copy.text('verify_to_sign'));
  if (
    [
      'TASK_CONFLICT',
      'REVISION_CONFLICT',
      'CONFIRMATION_REQUIRED',
      'IDEMPOTENCY_CONFLICT',
      'INVALID_TRANSITION',
    ].includes(code)
  ) {
    await ctx.say(copy.text('conflict'));
    return task
      ? render(ctx, task).catch(e => log.warn('channel.rerender_failed', { error: e.message }))
      : undefined;
  }
  if (['NOT_FOUND', 'REPORT_WITHDRAWN', 'CONSENT_REQUIRED'].includes(code)) {
    if (task) await kit.finish(ctx, task, 'cancelled').catch(() => {});
    return ctx.say(copy.text(code === 'REPORT_WITHDRAWN' ? 'ev_withdrawn' : 'not_found'));
  }
  log.error('channel.step_failed', { error: code });
  return ctx.say(copy.text('error'));
}

const api = { go, done, render, menu, back, enterGeneric, recover };

module.exports = { handle, parse, claims, WORKFLOWS };

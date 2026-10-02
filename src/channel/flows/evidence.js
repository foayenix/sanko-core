'use strict';

// Evidence reports for a linked formulation owner: request a review, confirm
// the exact recipe and the service notice, answer an analyst's question, check
// progress, read the released brief, receive the full report as a PDF and ask
// for a correction. Owner powers only: channel_evidence_act fixes the role, so
// nothing here can reach analyst, reviewer or release actions.

const crypto = require('node:crypto');
const kit = require('../kit');
const copy = require('../copy');
const { recipe } = require('../format');
const reportText = require('../../evidence/reportText');
const pdf = require('../../evidence/pdf');
const outbound = require('../outbound');
const log = require('../../utils/log');

const T = copy.text;
// The explanation shown before the first document copy. Changing its wording
// needs a new version so people see the changed scope again.
const DOCUMENT_NOTICE_VERSION = 'document-copy-synthetic-v1';
const GENERAL_PURPOSE =
  'General overview of published evidence about the ingredients of this formulation.';

// A deterministic operation key for a typed message, so a redelivered message
// cannot create a second request.
const keyFrom = (ctx, purpose) => {
  const h = crypto
    .createHash('sha256')
    .update(`${ctx.contact}|${ctx.messageId}|${purpose}`)
    .digest('hex');
  const parts = [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `8${h.slice(17, 20)}`];
  return [...parts, h.slice(20, 32)].join('-');
};

async function list(ctx, task, { key, items, body, label }) {
  const offset = task.draft[`${key}_offset`] ?? 0;
  const { slice, more } = kit.page(items, offset);
  const codes = slice.map((_, i) => `item_${offset + i}`);
  const labels = Object.fromEntries(slice.map((item, i) => [`item_${offset + i}`, label(item)]));
  if (more) codes.push('more');
  codes.push('back');
  const next = await kit.save(ctx, task, { draft: { ...task.draft, [key]: items } });
  return kit.ask(ctx, next, body, codes, { labels });
}
const picked = (task, key, code) => task.draft[key]?.[Number(code.slice(5))];
const more = (f, ctx, task, key) =>
  f.go(
    ctx,
    task,
    task.step,
    { [`${key}_offset`]: (task.draft[`${key}_offset`] ?? 0) + kit.MAX_ROWS - 2 },
    { back: false },
  );
const get = (ctx, task) => kit.evidence(ctx, 'get', { request: task.draft.request.id });
const statusWords = status => copy.STATUS_WORDS[status] ?? status;

// The release to act on, resolved at the moment of use: the current release
// if there is one, otherwise the newest earlier one (labelled as such).
// Withdrawn releases are never offered.
function currentRelease(releases) {
  const usable = releases
    .filter(r => r.status !== 'withdrawn')
    .sort((a, b) => b.released_at.localeCompare(a.released_at));
  return usable.find(r => r.status === 'released') ?? usable[0] ?? null;
}

async function deliver(ctx, task, prompt, f) {
  if (!ctx.flags.evidenceDelivery) return f.done(ctx, task, T('ev_delivery_off'), prompt);
  const release = task.draft.release;
  const artifact = await kit.evidence(ctx, 'artifact', {
    request: task.draft.request.id,
    data: { release_id: release.id, kind: 'technical' },
  });
  const brief = await kit.evidence(ctx, 'artifact', {
    request: task.draft.request.id,
    data: { release_id: release.id, kind: 'brief' },
  });
  let rendered;
  try {
    rendered = pdf.renderDossier({
      brief: brief.html,
      technical: artifact.html,
      meta: {
        formulation_code: artifact.snapshot?.formulation_code,
        request_id: artifact.request_id,
        report_number: artifact.report_number,
        release_id: release.id,
        released_at: artifact.released_at,
        status: artifact.status,
        reviewer: artifact.reviewer,
        reviewed_at: artifact.reviewed_at,
        currency: artifact.currency,
        manifest_hash: artifact.manifest_hash,
      },
    });
  } catch (err) {
    // Never a fallback: no unreviewed or partial version is sent.
    log.error('channel.report_render_failed', {
      error: err.message,
      detail: err.detail ?? null,
      release: release.id,
    });
    return f.done(ctx, task, T('ev_render_failed'), prompt);
  }
  const stored = await kit.rpc('channel_evidence_store_artifact', {
    p_contact: ctx.contact,
    p_release: release.id,
    p_manifest_hash: artifact.manifest_hash,
    p_renderer: rendered.renderer,
    p_sha256: rendered.sha256,
    p_base64: rendered.buffer.toString('base64'),
  });
  const intent = await kit.rpc('channel_evidence_request_delivery', {
    p_contact: ctx.contact,
    p_release: release.id,
    p_artifact: stored.artifact_id,
    p_key: prompt.operation_key,
  });
  if (intent.status === 'pending') await ctx.say(T('ev_sending'));
  if (intent.status === 'pending')
    await outbound.dispatch({ transport: ctx.transport, only: intent.outbound_id });
  const state = await kit.rpc('channel_outbound_state', {
    p_contact: ctx.contact,
    p_outbound: intent.outbound_id,
  });
  const message = ['accepted', 'sent', 'delivered', 'read'].includes(state.status)
    ? T('ev_sent')
    : state.status === 'ambiguous'
      ? T('ev_send_uncertain')
      : state.status === 'cancelled'
        ? T('ev_send_refused')
        : T('ev_send_failed');
  return f.done(ctx, task, message, prompt);
}

const steps = {
  menu: {
    render: (ctx, task) =>
      kit.ask(ctx, task, T('evidence_menu'), ['request_review', 'check_progress', 'my_reports']),
    choose: (ctx, task, code, _prompt, f) =>
      f.go(
        ctx,
        task,
        { request_review: 'formulations', check_progress: 'requests', my_reports: 'reports' }[code],
        {
          formulations_offset: 0,
          requests_offset: 0,
          reports_offset: 0,
        },
      ),
  },

  // ── E01 select and confirm ──
  formulations: {
    render: async (ctx, task, f) => {
      const items = await kit.evidence(ctx, 'formulations');
      if (!items.length) return f.done(ctx, task, T('no_eligible_formulations'));
      return list(ctx, task, {
        key: 'formulations',
        items,
        body: T('pick_ev_formulation'),
        label: x => x.code,
      });
    },
    choose: (ctx, task, code, _prompt, f) =>
      code === 'more'
        ? more(f, ctx, task, 'formulations')
        : f.go(ctx, task, 'purpose', { formulation: picked(task, 'formulations', code) }),
  },
  purpose: {
    render: (ctx, task) =>
      kit.ask(ctx, task, T('ev_purpose'), ['general_overview', 'cancel'], {
        bound: true,
        hint: true,
      }),
    choose: (ctx, task, _code, prompt, f) =>
      create(ctx, task, GENERAL_PURPOSE, prompt.operation_key, f),
    text: (ctx, task, text, f) =>
      text.length > 2000 ? ctx.say(T('error')) : create(ctx, task, text, keyFrom(ctx, 'create'), f),
  },
  recipe: {
    confirm: true,
    render: async (ctx, task, f) => {
      const request = await get(ctx, task);
      if (request.status !== 'draft') {
        await ctx.say(
          T('ev_status', {
            reference: kit.shortRef(request.id),
            status: statusWords(request.status),
          }),
        );
        return f.go(ctx, task, 'request', {}, { back: false });
      }
      const next = await kit.save(ctx, task, {
        draft: {
          ...task.draft,
          request: { id: request.id, revision: request.revision },
          snapshot_hash: request.snapshot_hash,
        },
      });
      await ctx.say(
        [
          T('ev_recipe_intro', { code: request.recipe.formulation_code }),
          recipe(request.recipe),
        ].join('\n\n'),
      );
      return kit.ask(ctx, next, T('ev_recipe_confirm'), [
        'confirm_recipe',
        'change_something',
        'cancel',
      ]);
    },
    choose: (ctx, task, code, _prompt, f) =>
      code === 'change_something'
        ? f.done(ctx, task, T('ev_change_recipe'))
        : f.go(ctx, task, 'notice', { confirmed_hash: task.draft.snapshot_hash }),
  },
  notice: {
    confirm: true,
    render: async (ctx, task, f) => {
      const request = await get(ctx, task);
      // The recipe confirmed a moment ago must still be the one submitted.
      if (request.snapshot_hash !== task.draft.confirmed_hash) {
        await ctx.say(T('ev_recipe_changed'));
        return f.go(ctx, task, 'recipe', {}, { back: false });
      }
      const n = request.notice;
      await ctx.say(
        T('ev_notice', {
          status: n.status,
          purpose: n.purpose,
          scope: n.scope,
          excluded: n.excluded,
        }),
      );
      const current = await kit.save(ctx, task, {
        draft: { ...task.draft, request: { id: request.id, revision: request.revision } },
      });
      return kit.confirm(ctx, current, {
        domain: 'evidence',
        action: 'submit',
        data: { snapshot_hash: task.draft.confirmed_hash, notice_hash: request.notice_hash },
        envelope: { request: request.id, revision: request.revision },
        body: T('ev_notice_confirm'),
        codes: ['agree_submit', 'cancel'],
      });
    },
    choose: async (ctx, task, _code, prompt, f) => {
      try {
        await kit.execute(ctx, task, prompt);
      } catch (err) {
        if (err.message !== 'REVISION_CONFLICT') throw err;
        await ctx.say(T('ev_recipe_changed'));
        return f.go(ctx, task, 'recipe', { pending: null }, { back: false });
      }
      return f.done(
        ctx,
        task,
        T('ev_submitted', { reference: kit.shortRef(task.draft.request.id) }),
        prompt,
      );
    },
  },

  // ── E02 progress, questions and cancellation ──
  requests: {
    render: async (ctx, task, f) => {
      const items = await kit.evidence(ctx, 'list');
      if (!items.length) return f.done(ctx, task, T('no_requests'));
      return list(ctx, task, {
        key: 'requests',
        items,
        body: T('pick_request'),
        label: r => `${kit.shortRef(r.id)} · ${r.status.replaceAll('_', ' ')}`,
      });
    },
    choose: (ctx, task, code, _prompt, f) =>
      code === 'more'
        ? more(f, ctx, task, 'requests')
        : f.go(ctx, task, 'request', { request: { id: picked(task, 'requests', code).id } }),
  },
  request: {
    render: async (ctx, task) => {
      const r = await get(ctx, task);
      const next = await kit.save(ctx, task, {
        draft: {
          ...task.draft,
          request: { id: r.id, revision: r.revision },
          request_status: r.status,
        },
      });
      await ctx.say(
        T('ev_status', { reference: kit.shortRef(r.id), status: statusWords(r.status) }),
      );
      if (r.status === 'needs_information')
        await ctx.say(T('ev_question', { question: r.question }));
      const codes =
        r.status === 'draft'
          ? ['continue_request', 'cancel_request', 'back']
          : r.status === 'needs_information'
            ? ['answer_question', 'cancel_request', 'back']
            : r.status === 'released'
              ? ['my_reports', 'back']
              : ['cancelled', 'declined'].includes(r.status)
                ? ['back', 'menu']
                : ['cancel_request', 'back'];
      return kit.ask(ctx, next, T('menu_prompt'), codes);
    },
    choose: (ctx, task, code, _prompt, f) => {
      if (code === 'continue_request') return f.go(ctx, task, 'recipe');
      if (code === 'answer_question') return f.go(ctx, task, 'answer_text');
      if (code === 'cancel_request') return f.go(ctx, task, 'cancel_confirm');
      return f.go(ctx, task, 'report', {});
    },
  },
  answer_text: {
    render: ctx => ctx.say(T('ev_answer_prompt')),
    text: (ctx, task, text, f) =>
      text.length > 10000
        ? ctx.say(T('error'))
        : f.go(ctx, task, 'answer_confirm', { answer: text }),
  },
  answer_confirm: {
    confirm: true,
    render: async (ctx, task) => {
      const r = await get(ctx, task);
      return kit.bind(ctx, task, {
        domain: 'evidence',
        action: 'answer',
        data: { answer: task.draft.answer },
        envelope: { request: r.id, revision: r.revision },
        body: T('ev_confirm_answer', { answer: task.draft.answer }),
        codes: ['send_answer', 'change_it', 'cancel'],
      });
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'change_it') return f.go(ctx, task, 'answer_text');
      await kit.execute(ctx, task, prompt);
      return f.done(ctx, task, T('ev_answer_sent'), prompt);
    },
  },
  cancel_confirm: {
    confirm: true,
    render: async (ctx, task) => {
      const r = await get(ctx, task);
      return kit.confirm(ctx, task, {
        domain: 'evidence',
        action: 'cancel',
        data: {},
        envelope: { request: r.id, revision: r.revision },
        body: T('ev_confirm_cancel'),
        codes: ['confirm_cancel', 'keep_request'],
      });
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'keep_request') return f.go(ctx, task, 'request', {}, { back: false });
      await kit.execute(ctx, task, prompt);
      return f.done(ctx, task, T('ev_cancelled'), prompt);
    },
  },

  // ── E04/E05 released reports ──
  reports: {
    render: async (ctx, task, f) => {
      const items = (await kit.evidence(ctx, 'list')).filter(r => r.status === 'released');
      if (!items.length) return f.done(ctx, task, T('no_reports'));
      return list(ctx, task, {
        key: 'reports',
        items,
        body: T('pick_report'),
        label: r => `Request ${kit.shortRef(r.id)}`,
      });
    },
    choose: (ctx, task, code, _prompt, f) =>
      code === 'more'
        ? more(f, ctx, task, 'reports')
        : f.go(ctx, task, 'report', { request: { id: picked(task, 'reports', code).id } }),
  },
  report: {
    render: async (ctx, task, f) => {
      const r = await get(ctx, task);
      const release = currentRelease(r.releases ?? []);
      if (!release) return f.done(ctx, task, T(r.releases?.length ? 'ev_withdrawn' : 'no_reports'));
      const brief = await kit.evidence(ctx, 'artifact', {
        request: r.id,
        data: { release_id: release.id, kind: 'brief' },
      });
      const next = await kit.save(ctx, task, {
        draft: {
          ...task.draft,
          request: { id: r.id, revision: r.revision },
          release: { id: release.id, status: release.status },
        },
      });
      return kit.ask(
        ctx,
        next,
        T('ev_report', {
          reference: kit.shortRef(r.id),
          version: brief.report_number,
          released: kit.formatDate(brief.released_at),
          status:
            release.status === 'released'
              ? 'current release'
              : `${release.status} (an earlier version)`,
        }),
        ['read_summary', 'send_full_report', 'ask_or_correct', 'back'],
        { bound: true },
      );
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'read_summary') {
        const brief = await kit.evidence(ctx, 'artifact', {
          request: task.draft.request.id,
          data: { release_id: task.draft.release.id, kind: 'brief' },
        });
        await ctx.say(
          `${T('ev_summary_header', {
            version: brief.report_number,
            released: kit.formatDate(brief.released_at),
            reviewer: brief.reviewer,
            reviewed: kit.formatDate(brief.reviewed_at),
            currency: brief.currency,
          })}\n\n${reportText.toChat(brief.html)}`,
        );
        return f.render(ctx, task);
      }
      if (code === 'ask_or_correct') return f.go(ctx, task, 'ask_kind');
      if (!ctx.flags.evidenceDelivery) {
        await ctx.say(T('ev_delivery_off'));
        return f.render(ctx, task);
      }
      if (ctx.status.evidence?.document_notice_version !== DOCUMENT_NOTICE_VERSION)
        return f.go(ctx, task, 'copy_notice');
      return deliver(ctx, task, prompt, f);
    },
  },
  copy_notice: {
    confirm: true,
    render: (ctx, task) =>
      kit.ask(ctx, task, T('ev_copy_notice'), ['send_copy', 'not_now'], { bound: true }),
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'not_now') return f.go(ctx, task, 'report', {}, { back: false });
      await kit.rpc('channel_evidence_ack_notice', {
        p_contact: ctx.contact,
        p_version: DOCUMENT_NOTICE_VERSION,
      });
      return deliver(ctx, task, prompt, f);
    },
  },
  ask_kind: {
    render: (ctx, task) =>
      kit.ask(ctx, task, T('ev_ask_kind'), ['ask_question', 'request_correction', 'back']),
    choose: (ctx, task, code, _prompt, f) => f.go(ctx, task, 'ask_text', { ask_kind: code }),
  },
  ask_text: {
    render: ctx => ctx.say(T('ev_ask_prompt')),
    text: (ctx, task, text, f) =>
      text.length > 9000 ? ctx.say(T('error')) : f.go(ctx, task, 'ask_confirm', { ask_text: text }),
  },
  ask_confirm: {
    confirm: true,
    render: async (ctx, task) => {
      const r = await get(ctx, task);
      const prefix =
        task.draft.ask_kind === 'ask_question'
          ? 'Question from the owner (via WhatsApp): '
          : 'Correction request from the owner (via WhatsApp): ';
      return kit.bind(ctx, task, {
        domain: 'evidence',
        action: 'correction',
        data: { release_id: task.draft.release.id, reason: prefix + task.draft.ask_text },
        envelope: { request: r.id, revision: r.revision },
        body: T('ev_confirm_ask', { text: task.draft.ask_text }),
        codes: ['send', 'change_it', 'cancel'],
      });
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'change_it') return f.go(ctx, task, 'ask_text');
      await kit.execute(ctx, task, prompt);
      return f.done(ctx, task, T('ev_ask_sent'), prompt);
    },
  },
};

async function create(ctx, task, purpose, key, f) {
  const created = await kit.evidence(ctx, 'create', {
    data: { formulation_id: task.draft.formulation.id, purpose, updates_request_id: null },
    key,
  });
  return f.go(
    ctx,
    task,
    'recipe',
    { request: { id: created.id, revision: created.revision } },
    { back: false },
  );
}

module.exports = { steps, DOCUMENT_NOTICE_VERSION, currentRelease };

'use strict';

// My care, for a linked patient: create a record, answer invitations, answer
// check-ins, send other updates, read released visits, request corrections,
// and manage messages, tracking and rights. Every write is the existing care
// operation, reviewed by the person and confirmed by a bound tap.

const kit = require('../kit');
const copy = require('../copy');
const { describe } = require('../format');

const T = copy.text;
const OUTCOMES = ['better', 'same', 'worse', 'mixed', 'unwanted', 'unsure', 'something_else'];
const QUESTION_ID = 'care.check_in.compared_with_last_visit';
const KIND_WORDS = {
  correction: 'correction',
  past_visit: 'past-visit account',
  product_report: 'product or allergy note',
};

const self = { role: 'patient', subject: null, practice: null };
const timeline = (ctx, task) => kit.care(ctx, task, 'timeline', {}, { practice: null });

// Lists with "More" paging. Items are kept in the draft so the tapped row maps
// to exactly what was shown.
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

function composeReport(draft) {
  const answer = draft.outcome ? copy.label(draft.outcome) : '(answered in own words)';
  return (
    `Question: ${T('check_in_question_record')}\nAnswer: ${answer}\n` +
    `Patient's own words: ${draft.words ?? 'none given'}\n` +
    `Sent through verified WhatsApp; wording ${copy.VERSION}.`
  );
}

function visitText(encounter) {
  const notes = encounter.notes
    .map(note => {
      const preparations = note.preparations
        .map(p => {
          const composition =
            p.composition_status === 'recorded'
              ? `\n  Recipe: ${describe(p.composition)}`
              : p.composition_status === 'withheld'
                ? ' — recipe kept private by the practitioner'
                : ' — recipe not recorded';
          return `• ${p.label}${p.reported_use ? ` (${p.reported_use})` : ''}${composition}`;
        })
        .join('\n');
      return (
        `${note.amends_id ? `Amendment (${note.amendment_reason}): ` : ''}${note.summary}\n` +
        `Signed by ${note.author_name ?? 'your practitioner'} ` +
        `on ${kit.formatDate(note.signed_at)}.` +
        (preparations ? `\nPreparations:\n${preparations}` : '')
      );
    })
    .join('\n\n');
  const status = encounter.status.replaceAll('_', ' ');
  const when = kit.formatDate(encounter.occurred_at);
  return `${encounter.practice_name} — visit on ${when} (${status}).\n\n${notes}`;
}

// The person's own updates and each practice's attributed reply, as the
// released patient projection shows them. Nothing is summarised.
function replies(timeline) {
  const items = timeline.observations.slice(0, 5).map(o => {
    const sent = `${kit.formatDate(o.recorded_at)} — you wrote:\n${o.report}`;
    if (!o.review) return `${sent}\nNot reviewed yet.`;
    return (
      `${sent}\nReply from ${o.review.author_name ?? 'your practice'} ` +
      `(${kit.formatDate(o.review.created_at)}):\n${o.review.next_steps}`
    );
  });
  return items.length ? T('replies', { items: items.join('\n\n') }) : T('no_replies');
}

// A message that arrived outside a pending question. It is kept in the draft
// and nothing is saved until the person chooses where it goes and confirms.
async function freeText(ctx, task, text, f) {
  if (text.length > 10000) return ctx.say(T('error'));
  let current = task;
  if (!task.subject_id) {
    // The person's own record, resolved from the verified session only.
    const subject = (await kit.care(ctx, task, 'me', {}, self)).subjects[0];
    if (!subject) {
      await ctx.say(T('discarded'));
      return f.go(ctx, task, 'who_for', {}, { back: false });
    }
    current = await kit.save(ctx, task, { subject_id: subject.id });
  }
  return f.go(ctx, current, 'report_context', { text, kind: null }, { back: false });
}

const steps = {
  menu: {
    render: async (ctx, task, f) => {
      const me = await kit.care(ctx, task, 'me', {}, self);
      const subject = me.subjects[0];
      if (!subject) return f.go(ctx, task, 'who_for', {}, { back: false });
      let current = task;
      if (task.subject_id !== subject.id)
        current = await kit.save(ctx, task, {
          subject_id: subject.id,
          draft: { ...task.draft, reference: subject.reference },
        });
      return kit.ask(
        ctx,
        current,
        `${T('synthetic_banner')}\n${T('menu_prompt')}`,
        [
          'check_ins',
          'send_update',
          'replies',
          'visits',
          'invitations',
          'privacy',
          'reference',
          'language',
          'help',
        ],
        { hint: true },
      );
    },
    choose: async (ctx, task, code, _prompt, f) => {
      if (code === 'check_ins')
        return f.go(ctx, task, 'check_in_pick', { words: null, check_ins_offset: 0 });
      if (code === 'send_update') return f.go(ctx, task, 'report_text');
      if (code === 'visits') return f.go(ctx, task, 'visits', { visits_offset: 0, kind: null });
      if (code === 'invitations') return f.go(ctx, task, 'invites');
      if (code === 'privacy') return f.go(ctx, task, 'privacy');
      if (code === 'replies') {
        await ctx.say(replies(await timeline(ctx, task)));
        return f.render(ctx, task);
      }
      if (code === 'reference') {
        await ctx.say(T('reference', { reference: task.draft.reference }));
        return f.render(ctx, task);
      }
      return f.render(ctx, task);
    },
  },

  // ── C01 onboarding ──
  who_for: {
    render: (ctx, task) => kit.ask(ctx, task, T('who_for'), ['myself', 'someone_else', 'cancel']),
    choose: (ctx, task, code, _prompt, f) =>
      code === 'myself' ? f.go(ctx, task, 'name') : f.done(ctx, task, T('caregiver_unavailable')),
  },
  name: {
    render: ctx => ctx.say(T('ask_name')),
    text: (ctx, task, text, f) => {
      const name = text.trim();
      if (!name || name.length > 150) return ctx.say(T('ask_name'));
      return f.go(ctx, task, 'name_confirm', { name });
    },
  },
  name_confirm: {
    confirm: true,
    render: (ctx, task) =>
      kit.bind(ctx, task, {
        domain: 'care',
        action: 'onboard',
        data: { display_name: task.draft.name },
        envelope: self,
        body: T('confirm_name', { name: task.draft.name }),
        codes: ['create_record', 'change_name', 'cancel'],
      }),
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'change_name') return f.go(ctx, task, 'name');
      const subject = await kit.execute(ctx, task, prompt);
      await kit.receipt(ctx, prompt, T('created_record', { reference: subject.reference }));
      return f.go(ctx, task, 'menu', { pending: null, name: null }, { back: false });
    },
  },

  // ── invitations ──
  invites: {
    render: async (ctx, task, f) => {
      const invites = await kit.care(ctx, task, 'invitations', {}, { practice: null });
      if (!invites.length) {
        await ctx.say(T('no_invitations'));
        return f.go(ctx, task, 'menu', {}, { back: false });
      }
      if (invites.length === 1)
        return f.go(ctx, task, 'invite_view', { invite: invites[0] }, { back: false });
      return list(ctx, task, {
        key: 'invites',
        items: invites,
        body: T('pick_invitation'),
        label: i => i.practice_name,
      });
    },
    choose: (ctx, task, code, _prompt, f) =>
      code === 'more'
        ? more(f, ctx, task, 'invites')
        : f.go(ctx, task, 'invite_view', { invite: picked(task, 'invites', code) }),
  },
  invite_view: {
    render: (ctx, task) => {
      const i = task.draft.invite;
      return kit.ask(
        ctx,
        task,
        T('invitation', {
          practice: i.practice_name,
          scope: i.scope,
          expires: kit.formatDate(i.expires_at),
        }),
        ['accept', 'decline', 'back'],
      );
    },
    choose: (ctx, task, code, _prompt, f) => f.go(ctx, task, 'invite_confirm', { decision: code }),
  },
  invite_confirm: {
    confirm: true,
    render: (ctx, task) => {
      const { invite, decision } = task.draft;
      const accept = decision === 'accept';
      return kit.confirm(ctx, task, {
        domain: 'care',
        action: accept ? 'accept_invite' : 'decline_invite',
        data: { id: invite.id },
        envelope: { practice: invite.practice_id },
        body: T(accept ? 'confirm_accept' : 'confirm_decline', { practice: invite.practice_name }),
        codes: [accept ? 'accept_tracking' : 'decline_invite', 'back'],
      });
    },
    choose: async (ctx, task, _code, prompt, f) => {
      await kit.execute(ctx, task, prompt);
      const practice = task.draft.invite.practice_name;
      return f.done(
        ctx,
        task,
        T(task.draft.decision === 'accept' ? 'accepted' : 'declined', { practice }),
        prompt,
      );
    },
  },

  // ── C03 check-ins ──
  check_in_pick: {
    render: async (ctx, task, f) => {
      const waiting = (await timeline(ctx, task)).follow_ups.filter(x => x.status === 'submitted');
      if (!waiting.length) {
        await ctx.say(T('no_check_ins'));
        return task.draft.text
          ? f.go(ctx, task, 'report_context', {}, { back: false })
          : f.go(ctx, task, 'menu', {}, { back: false });
      }
      const items = waiting.map(x => ({
        id: x.id,
        revision: x.revision,
        practice_id: x.practice_id,
        practice_name: x.practice_name,
        submitted_at: x.submitted_at,
      }));
      if (items.length === 1)
        return f.go(ctx, task, 'check_in_answer', { check_in: items[0] }, { back: false });
      return list(ctx, task, {
        key: 'check_ins',
        items,
        body: T('pick_check_in'),
        label: i => `${i.practice_name} · ${kit.formatDate(i.submitted_at)}`,
      });
    },
    choose: (ctx, task, code, _prompt, f) =>
      code === 'more'
        ? more(f, ctx, task, 'check_ins')
        : f.go(ctx, task, 'check_in_answer', { check_in: picked(task, 'check_ins', code) }),
  },
  check_in_answer: {
    render: (ctx, task) =>
      kit.ask(
        ctx,
        task,
        T('check_in_question', { practice: task.draft.check_in.practice_name }),
        OUTCOMES,
        { hint: true },
      ),
    choose: (ctx, task, code, _prompt, f) => {
      const outcome = code === 'something_else' ? null : code;
      const patch = { outcome, observed_at: new Date().toISOString() };
      // Words already given (a message that arrived before the question) are
      // not asked for again.
      if (task.draft.words) return f.go(ctx, task, 'check_in_review', patch);
      return f.go(ctx, task, outcome ? 'check_in_words' : 'check_in_own_words', patch);
    },
    text: (ctx, task, text, f) =>
      f.go(ctx, task, 'check_in_review', {
        outcome: null,
        words: text,
        observed_at: new Date().toISOString(),
      }),
  },
  check_in_own_words: {
    render: ctx => ctx.say(T('type_report')),
    text: (ctx, task, text, f) => f.go(ctx, task, 'check_in_review', { words: text }),
  },
  check_in_words: {
    render: (ctx, task) => kit.ask(ctx, task, T('check_in_more'), ['nothing_more', 'cancel']),
    choose: (ctx, task, _code, _prompt, f) => f.go(ctx, task, 'check_in_review', { words: null }),
    text: (ctx, task, text, f) => f.go(ctx, task, 'check_in_review', { words: text }),
  },
  check_in_review: {
    confirm: true,
    render: (ctx, task) => {
      const { check_in: c, outcome, words } = task.draft;
      return kit.confirm(ctx, task, {
        domain: 'care',
        action: 'respond',
        data: {
          id: c.id,
          expected_revision: c.revision,
          report: composeReport(task.draft),
          observed_at: task.draft.observed_at,
        },
        envelope: { practice: c.practice_id },
        body: T('review_update', {
          practice: c.practice_name,
          answer: outcome ? copy.label(outcome) : 'In your own words',
          words,
        }),
        codes: ['send', 'change_it', 'cancel'],
      });
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'change_it') return f.go(ctx, task, 'check_in_answer', { words: null });
      const saved = await kit.execute(ctx, task, prompt);
      await kit.rpc('channel_record_answer', {
        p_contact: ctx.contact,
        p_task: task.id,
        p_prompt: prompt.id,
        p_question: QUESTION_ID,
        p_copy: copy.VERSION,
        p_language: task.language,
        p_option: task.draft.outcome ?? 'own_words',
        p_free_text: task.draft.words ?? null,
        p_record: saved.id,
      });
      return f.done(
        ctx,
        task,
        T('update_saved', { practice: task.draft.check_in.practice_name }),
        prompt,
      );
    },
  },

  // ── other patient reports ──
  report_text: {
    render: ctx => ctx.say(T('type_report')),
    text: (ctx, task, text, f) => freeText(ctx, task, text, f),
  },
  report_context: {
    render: async (ctx, task) => {
      const pending = (await timeline(ctx, task)).follow_ups.some(x => x.status === 'submitted');
      const codes = [
        ...(pending ? ['ctx_check_in'] : []),
        'ctx_correction',
        'ctx_past_visit',
        'ctx_product',
        'ctx_discard',
      ];
      return kit.ask(ctx, task, T('which_context'), codes);
    },
    choose: async (ctx, task, code, _prompt, f) => {
      if (code === 'ctx_discard') return f.done(ctx, task, T('discarded'));
      if (code === 'ctx_check_in')
        return f.go(ctx, task, 'check_in_pick', { words: task.draft.text, check_ins_offset: 0 });
      if (code === 'ctx_correction')
        return f.go(ctx, task, 'visits', { kind: 'correction', visits_offset: 0 });
      return f.go(ctx, task, 'report_practice', {
        kind: code === 'ctx_past_visit' ? 'past_visit' : 'product_report',
      });
    },
  },
  report_practice: {
    render: async (ctx, task, f) => {
      const practices = (await timeline(ctx, task)).relationships.filter(r => r.tracking);
      if (!practices.length) return f.done(ctx, task, T('no_practices'));
      const items = practices.map(r => ({
        practice_id: r.practice_id,
        practice_name: r.practice_name,
      }));
      if (items.length === 1)
        return f.go(
          ctx,
          task,
          'report_review',
          { practice: items[0], encounter_id: null },
          { back: false },
        );
      return list(ctx, task, {
        key: 'practices',
        items,
        body: T('pick_practice'),
        label: i => i.practice_name,
      });
    },
    choose: (ctx, task, code, _prompt, f) =>
      code === 'more'
        ? more(f, ctx, task, 'practices')
        : f.go(ctx, task, 'report_review', {
            practice: picked(task, 'practices', code),
            encounter_id: null,
          }),
  },
  report_review: {
    confirm: true,
    render: (ctx, task) => {
      const { practice, kind, text, encounter_id } = task.draft;
      return kit.confirm(ctx, task, {
        domain: 'care',
        action: 'patient_report',
        data: {
          kind,
          encounter_id: encounter_id ?? null,
          report: text,
          observed_at: new Date().toISOString(),
        },
        envelope: { practice: practice.practice_id },
        body: T('review_report', {
          practice: practice.practice_name,
          kind: KIND_WORDS[kind],
          text,
        }),
        codes: ['send', 'change_it', 'cancel'],
      });
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'change_it') return f.go(ctx, task, 'report_text');
      await kit.execute(ctx, task, prompt);
      return f.done(
        ctx,
        task,
        T('report_saved', { practice: task.draft.practice.practice_name }),
        prompt,
      );
    },
  },

  // ── C05 released history and corrections ──
  visits: {
    render: async (ctx, task, f) => {
      const encounters = (await timeline(ctx, task)).encounters.filter(e => e.notes.length);
      if (!encounters.length) {
        await ctx.say(T('no_visits'));
        return f.go(ctx, task, 'menu', {}, { back: false });
      }
      return list(ctx, task, {
        key: 'visits',
        items: encounters,
        body: T(task.draft.kind === 'correction' ? 'pick_visit' : 'pick_visits'),
        label: e => `${kit.formatDate(e.occurred_at)} · ${e.practice_name}`,
      });
    },
    choose: (ctx, task, code, _prompt, f) => {
      if (code === 'more') return more(f, ctx, task, 'visits');
      const visit = picked(task, 'visits', code);
      if (task.draft.kind === 'correction')
        return f.go(ctx, task, 'report_review', {
          encounter_id: visit.id,
          practice: { practice_id: visit.practice_id, practice_name: visit.practice_name },
        });
      return f.go(ctx, task, 'visit_view', { visit });
    },
  },
  visit_view: {
    render: (ctx, task) =>
      kit.ask(ctx, task, visitText(task.draft.visit), ['request_correction', 'back', 'menu'], {
        question: 'What next?',
      }),
    choose: (ctx, task, _code, _prompt, f) =>
      f.go(ctx, task, 'correction_text', {
        kind: 'correction',
        encounter_id: task.draft.visit.id,
        practice: {
          practice_id: task.draft.visit.practice_id,
          practice_name: task.draft.visit.practice_name,
        },
      }),
  },
  correction_text: {
    render: ctx => ctx.say(T('correction_prompt')),
    text: (ctx, task, text, f) => f.go(ctx, task, 'report_review', { text }),
  },

  // ── C06 messages, tracking and rights ──
  privacy: {
    render: (ctx, task) =>
      kit.ask(ctx, task, T('privacy_menu'), [
        'stop_messages',
        'resume_messages',
        'tracking_choices',
        'request_deletion',
        'account_recovery',
        'unlink_phone',
        'back',
      ]),
    choose: async (ctx, task, code, _prompt, f) => {
      if (code === 'stop_messages') {
        const result = await kit.rpc('channel_stop', {
          p_contact: ctx.contact,
          p_message: ctx.messageId || null,
        });
        await ctx.say(
          T('stopped', { cancelled: result.cancelled, inFlight: result.in_flight > 0 }),
        );
        return f.render(ctx, task);
      }
      if (code === 'resume_messages') return f.enterGeneric(ctx, task, '_resume');
      if (code === 'unlink_phone') return f.enterGeneric(ctx, task, '_unlink');
      if (code === 'tracking_choices') return f.go(ctx, task, 'pref_practice');
      return f.go(ctx, task, 'rights_confirm', {
        rights: code === 'request_deletion' ? 'deletion' : 'recovery',
      });
    },
  },
  pref_practice: {
    render: async (ctx, task, f) => {
      const items = (await timeline(ctx, task)).relationships;
      if (!items.length) return f.done(ctx, task, T('no_practices'));
      if (items.length === 1)
        return f.go(ctx, task, 'pref_view', { relationship: items[0] }, { back: false });
      return list(ctx, task, {
        key: 'relationships',
        items,
        body: T('pick_practice'),
        label: r => r.practice_name,
      });
    },
    choose: (ctx, task, code, _prompt, f) =>
      code === 'more'
        ? more(f, ctx, task, 'relationships')
        : f.go(ctx, task, 'pref_view', { relationship: picked(task, 'relationships', code) }),
  },
  pref_view: {
    render: (ctx, task) => {
      const r = task.draft.relationship;
      const codes = [r.tracking ? 'stop_tracking' : 'start_tracking'];
      if (r.tracking) codes.push(r.messaging ? 'messages_off' : 'messages_on');
      codes.push('back');
      return kit.ask(
        ctx,
        task,
        T('tracking_state', {
          practice: r.practice_name,
          tracking: r.tracking,
          messaging: r.messaging,
        }),
        codes,
      );
    },
    choose: (ctx, task, code, _prompt, f) => {
      const purpose = code.endsWith('tracking') ? 'tracking' : 'messaging';
      const granted = code === 'start_tracking' || code === 'messages_on';
      return f.go(ctx, task, 'pref_confirm', {
        preference: { purpose, granted, change: copy.label(code) },
      });
    },
  },
  pref_confirm: {
    confirm: true,
    render: (ctx, task) => {
      const { relationship: r, preference: p } = task.draft;
      return kit.confirm(ctx, task, {
        domain: 'care',
        action: 'preferences',
        data: { purpose: p.purpose, granted: p.granted, expected_revision: r.revision },
        envelope: { practice: r.practice_id },
        body: T('confirm_preference', { practice: r.practice_name, change: p.change }),
        codes: ['confirm_change', 'back'],
      });
    },
    choose: async (ctx, task, _code, prompt, f) => {
      await kit.execute(ctx, task, prompt);
      return f.done(ctx, task, T('preference_saved'), prompt);
    },
  },
  rights_confirm: {
    confirm: true,
    render: (ctx, task) =>
      kit.confirm(ctx, task, {
        domain: 'care',
        action: 'rights',
        data: { kind: task.draft.rights },
        envelope: { practice: null },
        body: T('confirm_rights', { kind: task.draft.rights }),
        codes: ['send_request', 'back'],
      }),
    choose: async (ctx, task, _code, prompt, f) => {
      await kit.execute(ctx, task, prompt);
      return f.done(ctx, task, T('rights_sent', { kind: task.draft.rights }), prompt);
    },
  },
};

module.exports = { steps, freeText, composeReport, QUESTION_ID };

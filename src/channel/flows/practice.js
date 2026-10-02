'use strict';

// Practitioner care work in My vault: review patient updates from the care
// inbox and record a visit. Saving a draft, signing an exact revision,
// releasing the patient summary and completing the visit stay four separate,
// individually confirmed operations, exactly as in the portal.
//
// Note text is what the practitioner types. Sanko does not extract, infer or
// add dosages, ingredients, decisions or attendance; the patient summary and
// preparation names must be literal passages of the note (checked here and
// again in SQL).

const kit = require('../kit');
const copy = require('../copy');

const T = copy.text;
const DAYS = { in_3_days: 3, in_7_days: 7, in_14_days: 14 };

async function list(ctx, task, { key, items, body, label, extra = [] }) {
  const offset = task.draft[`${key}_offset`] ?? 0;
  const { slice, more } = kit.page(items, offset, kit.MAX_ROWS - 2 - extra.length);
  const codes = slice.map((_, i) => `item_${offset + i}`);
  const labels = Object.fromEntries(slice.map((item, i) => [`item_${offset + i}`, label(item)]));
  codes.push(...extra);
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
    { [`${key}_offset`]: (task.draft[`${key}_offset`] ?? 0) + kit.MAX_ROWS - 3 },
    { back: false },
  );
const name = task => task.draft.patient?.display_name ?? 'this patient';

function preparationText(preparations = []) {
  if (!preparations.length) return 'none';
  return preparations
    .map(p => {
      const vault = p.formulation_code
        ? ` (Vault ${p.formulation_code}, recipe ` +
          `${p.disclose_composition ? 'shown to patient' : 'kept private'})`
        : ' (not from your Vault; recipe not recorded)';
      return `${p.label}${vault}`;
    })
    .join('; ');
}
// Only the fields the care operation accepts.
const clean = preparations =>
  preparations.map(p => ({
    label: p.label,
    formulation_code: p.formulation_code ?? null,
    formulation_updated_at: p.formulation_updated_at ?? null,
    reported_use: p.reported_use ?? null,
    disclose_composition: Boolean(p.disclose_composition),
  }));

async function stopHere(ctx, task, f, done, pending, prompt) {
  return f.done(ctx, task, T('visit_left', { done, pending }), prompt);
}

const steps = {
  practice_pick: {
    render: async (ctx, task, f) => {
      const me = await kit.care(ctx, task, 'me', {}, { subject: null, practice: null });
      const practices = me.practices.filter(p => p.role === 'practitioner');
      if (!practices.length) return f.done(ctx, task, T('no_practice_membership'));
      if (practices.length === 1) return enter(ctx, task, practices[0].id, f);
      return list(ctx, task, {
        key: 'practices',
        items: practices,
        body: T('pick_practice_member'),
        label: p => p.name,
      });
    },
    choose: (ctx, task, code, _prompt, f) =>
      code === 'more'
        ? more(f, ctx, task, 'practices')
        : enter(ctx, task, picked(task, 'practices', code).id, f),
  },

  // ── C04 care inbox ──
  inbox: {
    render: async (ctx, task, f) => {
      const items = await kit.care(ctx, task, 'review_queue', {}, { subject: null });
      if (!items.length) return f.done(ctx, task, T('inbox_empty'));
      return list(ctx, task, {
        key: 'queue',
        items,
        body: T('inbox_pick', { count: items.length }),
        label: i => `${i.display_name ?? i.reference} · ${i.kind.replaceAll('_', ' ')}`,
      });
    },
    choose: (ctx, task, code, _prompt, f) => {
      if (code === 'more') return more(f, ctx, task, 'queue');
      const item = picked(task, 'queue', code);
      return f.go(ctx, task, 'inbox_item', {
        item,
        patient: {
          id: item.subject_id,
          display_name: item.display_name,
          reference: item.reference,
        },
      });
    },
  },
  inbox_item: {
    render: (ctx, task) => {
      const i = task.draft.item;
      return kit.ask(
        ctx,
        task,
        T('inbox_item', {
          name: i.display_name ?? 'Patient',
          reference: i.reference,
          kind: i.kind.replaceAll('_', ' '),
          recorded: kit.formatTime(i.recorded_at),
          report: i.report,
        }),
        ['write_next_steps', 'back'],
        { question: 'What would you like to do?' },
      );
    },
    choose: (ctx, task, _code, _prompt, f) => f.go(ctx, task, 'next_steps'),
  },
  next_steps: {
    render: ctx => ctx.say(T('next_steps_prompt')),
    text: (ctx, task, text, f) =>
      text.length > 10000
        ? ctx.say(T('error'))
        : f.go(ctx, task, 'review_confirm', { steps: text }),
  },
  review_confirm: {
    render: (ctx, task) => {
      const i = task.draft.item;
      return kit.confirm(ctx, task, {
        domain: 'care',
        action: 'review',
        data: {
          id: i.id,
          expected_revision: i.follow_up_revision ?? null,
          next_steps: task.draft.steps,
        },
        envelope: { subject: i.subject_id },
        body: T('confirm_review', { name: i.display_name ?? i.reference, steps: task.draft.steps }),
        codes: ['send_next_steps', 'change_it', 'cancel'],
      });
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'change_it') return f.go(ctx, task, 'next_steps');
      await kit.execute(ctx, task, prompt);
      await kit.receipt(
        ctx,
        prompt,
        T('reviewed', { name: task.draft.item.display_name ?? task.draft.item.reference }),
      );
      return f.go(
        ctx,
        task,
        'inbox',
        { item: null, steps: null, pending: null, queue_offset: 0 },
        { back: false },
      );
    },
  },

  // ── patients ──
  patients: {
    render: async (ctx, task, f) => {
      const today = await kit.care(ctx, task, 'today', {}, { subject: null });
      const patients = today.patients.filter(p => p.tracking);
      if (!patients.length) return f.done(ctx, task, T('no_patients'));
      return list(ctx, task, {
        key: 'patients',
        items: patients,
        body: T('pick_patient'),
        label: p => `${p.display_name ?? 'Patient'} · ${p.reference.slice(0, 7)}`,
      });
    },
    choose: async (ctx, task, code, _prompt, f) => {
      if (code === 'more') return more(f, ctx, task, 'patients');
      const patient = picked(task, 'patients', code);
      const next = await kit.save(ctx, task, { subject_id: patient.id });
      return f.go(ctx, next, task.draft.target === 'visit' ? 'encounter_pick' : 'patient_menu', {
        patient,
      });
    },
  },
  patient_menu: {
    render: (ctx, task) =>
      kit.ask(
        ctx,
        task,
        T('patient_options', { name: name(task), reference: task.draft.patient.reference }),
        ['record_visit', 'patient_history', 'back'],
      ),
    choose: async (ctx, task, code, _prompt, f) => {
      if (code === 'record_visit') return f.go(ctx, task, 'encounter_pick');
      const timeline = await kit.care(ctx, task, 'timeline', {});
      const lines = timeline.encounters.slice(0, 5).map(e => {
        const notes = e.notes
          .map(
            n => `  ${n.status}${n.released ? ', released' : ''}: ${kit.shorten(n.summary, 200)}`,
          )
          .join('\n');
        const head = `• ${kit.formatDate(e.occurred_at)} — ${e.status.replaceAll('_', ' ')}`;
        return notes ? `${head}\n${notes}` : head;
      });
      const open = timeline.observations.filter(o => !o.review).length;
      await ctx.say(
        `${name(task)}: last ${lines.length} visit(s), newest first.\n` +
          `${lines.join('\n') || 'No visits recorded.'}\n` +
          `${open} patient update(s) waiting for review.`,
      );
      return f.render(ctx, task);
    },
  },

  // ── C02 record a visit ──
  encounter_pick: {
    render: async (ctx, task) => {
      const timeline = await kit.care(ctx, task, 'timeline', {});
      const open = timeline.encounters.filter(e => e.status === 'arrived');
      return list(ctx, task, {
        key: 'encounters',
        items: open,
        body: T('pick_encounter', { name: name(task) }),
        label: e => `Visit ${kit.formatTime(e.occurred_at)}`,
        extra: ['new_visit'],
      });
    },
    choose: async (ctx, task, code, _prompt, f) => {
      if (code === 'new_visit')
        return f.go(ctx, task, 'arrive_confirm', {
          visit_key: kit.uuid(),
          occurred_at: new Date().toISOString(),
        });
      if (code === 'more') return more(f, ctx, task, 'encounters');
      const e = picked(task, 'encounters', code);
      const encounter = { id: e.id, revision: e.revision };
      const note = e.notes.find(n => !n.amends_id);
      if (!note) return f.go(ctx, task, 'note_text', { encounter });
      if (note.status === 'draft') {
        const detail = await kit.care(ctx, task, 'draft_detail', {
          encounter_id: e.id,
          note_id: note.id,
        });
        return f.go(ctx, task, 'draft_review', {
          encounter,
          note_id: detail.id,
          note_revision: detail.revision,
          note: detail.source_text,
          summary: detail.patient_summary,
          preparations: detail.preparation_input,
        });
      }
      if (!note.released)
        return f.go(ctx, task, 'release_offer', {
          encounter,
          note_id: note.id,
          note_revision: note.revision,
          summary: note.summary,
        });
      return f.go(ctx, task, 'complete_offer', { encounter });
    },
  },
  arrive_confirm: {
    render: (ctx, task) =>
      kit.confirm(ctx, task, {
        domain: 'care',
        action: 'arrive',
        data: { visit_key: task.draft.visit_key, occurred_at: task.draft.occurred_at },
        body: T('confirm_arrive', {
          name: name(task),
          time: kit.formatTime(task.draft.occurred_at),
        }),
        codes: ['record_visit_now', 'cancel'],
      }),
    choose: async (ctx, task, _code, prompt, f) => {
      const encounter = await kit.execute(ctx, task, prompt);
      await kit.rpc('channel_prompt_result', {
        p_contact: ctx.contact,
        p_prompt: prompt.id,
        p_result: { message: T('note_prompt') },
      });
      return f.go(
        ctx,
        task,
        'note_text',
        { encounter: { id: encounter.id, revision: encounter.revision }, pending: null },
        { back: false },
      );
    },
  },
  note_text: {
    render: ctx => ctx.say(T('note_prompt')),
    text: (ctx, task, text, f) => {
      if (text.length > 10000) return ctx.say(T('error'));
      // A changed note invalidates the summary and preparation names, which
      // must be passages of it; they are asked for again.
      return f.go(ctx, task, 'summary_choice', { note: text, summary: null, preparations: [] });
    },
    media: ctx => ctx.say(T('practitioner_media')),
  },
  summary_choice: {
    render: (ctx, task) =>
      kit.ask(
        ctx,
        task,
        T('summary_choice', { name: name(task) }),
        task.draft.note.length <= 5000
          ? ['use_whole_note', 'type_part', 'cancel']
          : ['type_part', 'cancel'],
      ),
    choose: (ctx, task, code, _prompt, f) =>
      code === 'use_whole_note'
        ? f.go(ctx, task, 'prep_choice', { summary: task.draft.note })
        : f.go(ctx, task, 'summary_text'),
  },
  summary_text: {
    render: ctx => ctx.say(T('summary_prompt')),
    text: (ctx, task, text, f) => {
      if (!task.draft.note.includes(text) || text.length > 5000)
        return ctx.say(T('summary_not_in_note'));
      return f.go(ctx, task, 'prep_choice', { summary: text });
    },
    media: ctx => ctx.say(T('practitioner_media')),
  },
  prep_choice: {
    render: (ctx, task) =>
      kit.ask(ctx, task, T('prep_choice'), ['no_preparation', 'from_vault', 'other_preparation']),
    choose: (ctx, task, code, _prompt, f) => {
      if (code === 'no_preparation') return f.go(ctx, task, 'draft_review', { preparations: [] });
      if (code === 'from_vault') return f.go(ctx, task, 'prep_pick', { formulations_offset: 0 });
      return f.go(ctx, task, 'prep_label', { prep: {} });
    },
  },
  prep_pick: {
    render: async (ctx, task, f) => {
      const formulations = await kit.care(ctx, task, 'formulations', {}, { subject: null });
      if (!formulations.length) {
        await ctx.say(T('no_formulations'));
        return f.go(ctx, task, 'prep_choice', {}, { back: false });
      }
      return list(ctx, task, {
        key: 'formulations',
        items: formulations,
        body: T('pick_formulation'),
        label: x => `${x.short_code} · ${x.condition_local ?? 'no condition'}`,
      });
    },
    choose: (ctx, task, code, _prompt, f) => {
      if (code === 'more') return more(f, ctx, task, 'formulations');
      const x = picked(task, 'formulations', code);
      return f.go(ctx, task, 'prep_label', {
        prep: { formulation_code: x.short_code, formulation_updated_at: x.updated_at },
      });
    },
  },
  prep_label: {
    render: ctx => ctx.say(T('prep_label_prompt')),
    text: (ctx, task, text, f) => {
      const label = text.trim();
      if (!label || label.length > 150 || !task.draft.note.includes(label))
        return ctx.say(T('prep_label_missing'));
      const prep = { ...task.draft.prep, label };
      if (prep.formulation_code) return f.go(ctx, task, 'prep_disclose', { prep });
      return f.go(ctx, task, 'draft_review', {
        preparations: [{ ...prep, disclose_composition: false }],
      });
    },
  },
  prep_disclose: {
    render: (ctx, task) => kit.ask(ctx, task, T('prep_disclose'), ['show_recipe', 'keep_private']),
    choose: (ctx, task, code, _prompt, f) =>
      f.go(ctx, task, 'draft_review', {
        preparations: [{ ...task.draft.prep, disclose_composition: code === 'show_recipe' }],
      }),
  },
  draft_review: {
    confirm: true,
    render: (ctx, task) => {
      const d = task.draft;
      return kit.bind(ctx, task, {
        domain: 'care',
        action: 'draft',
        data: {
          encounter_id: d.encounter.id,
          expected_revision: d.encounter.revision,
          source_text: d.note,
          summary: d.summary,
          preparations: clean(d.preparations ?? []),
          note_id: d.note_id ?? null,
          note_revision: d.note_revision ?? null,
          amends_id: null,
          reason: null,
        },
        body: T('draft_review', {
          name: name(task),
          note: d.note,
          summary: d.summary,
          preparation: preparationText(d.preparations),
        }),
        codes: ['save_draft', 'change_something', 'cancel'],
      });
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'change_something') return f.go(ctx, task, 'change_pick');
      const saved = await kit.execute(ctx, task, prompt);
      await kit.receipt(ctx, prompt, T('draft_saved', { revision: saved.note.revision }));
      return f.go(
        ctx,
        task,
        'sign_offer',
        {
          note_id: saved.note.id,
          note_revision: saved.note.revision,
          encounter: { ...task.draft.encounter, revision: saved.encounter_revision },
          pending: null,
        },
        { back: false },
      );
    },
  },
  change_pick: {
    render: (ctx, task) =>
      kit.ask(ctx, task, T('what_to_change'), [
        'edit_note',
        'edit_summary',
        'edit_preparation',
        'back',
      ]),
    choose: (ctx, task, code, _prompt, f) =>
      f.go(
        ctx,
        task,
        { edit_note: 'note_text', edit_summary: 'summary_choice', edit_preparation: 'prep_choice' }[
          code
        ],
      ),
  },
  sign_offer: {
    confirm: true,
    render: (ctx, task) => {
      const d = task.draft;
      return kit.confirm(ctx, task, {
        domain: 'care',
        action: 'sign',
        data: {
          encounter_id: d.encounter.id,
          note_id: d.note_id,
          note_revision: d.note_revision,
          expected_revision: d.encounter.revision,
        },
        // The text shown is what the database returns for this exact revision.
        body: prepared =>
          T('confirm_sign', {
            note: prepared.record_to_confirm.source,
            summary: prepared.record_to_confirm.summary,
            preparation: preparationText(prepared.record_to_confirm.preparations),
            revision: prepared.record_to_confirm.revision,
          }),
        codes: ['sign_version', 'not_now'],
      });
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'not_now')
        return stopHere(ctx, task, f, 'draft saved', 'signing, release and completion');
      const signed = await kit.execute(ctx, task, prompt);
      await kit.receipt(ctx, prompt, T('signed'));
      return f.go(
        ctx,
        task,
        'release_offer',
        {
          note_revision: signed.note_revision,
          encounter: { ...task.draft.encounter, revision: signed.encounter_revision },
          pending: null,
        },
        { back: false },
      );
    },
  },
  release_offer: {
    confirm: true,
    render: (ctx, task) => {
      const d = task.draft;
      return kit.confirm(ctx, task, {
        domain: 'care',
        action: 'release',
        data: { encounter_id: d.encounter.id, note_id: d.note_id, note_revision: d.note_revision },
        body: T('confirm_release', { name: name(task), summary: d.summary }),
        codes: ['release', 'not_now'],
      });
    },
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'not_now') return stopHere(ctx, task, f, 'signed', 'release and completion');
      await kit.execute(ctx, task, prompt);
      await kit.receipt(ctx, prompt, T('released', { name: name(task) }));
      return f.go(ctx, task, 'complete_offer', { pending: null }, { back: false });
    },
  },
  complete_offer: {
    confirm: true,
    render: (ctx, task) =>
      kit.confirm(ctx, task, {
        domain: 'care',
        action: 'transition',
        data: {
          encounter_id: task.draft.encounter.id,
          expected_revision: task.draft.encounter.revision,
          status: 'completed',
        },
        body: T('confirm_complete'),
        codes: ['complete', 'not_now'],
      }),
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'not_now')
        return stopHere(ctx, task, f, 'note signed and released', 'marking the visit completed');
      const result = await kit.execute(ctx, task, prompt);
      await kit.receipt(ctx, prompt, T('completed'));
      return f.go(
        ctx,
        task,
        'schedule_offer',
        { encounter: { ...task.draft.encounter, revision: result.revision }, pending: null },
        { back: false },
      );
    },
  },
  schedule_offer: {
    confirm: true,
    render: (ctx, task) =>
      kit.ask(ctx, task, T('schedule_choice'), ['in_3_days', 'in_7_days', 'not_now'], {
        bound: true,
      }),
    choose: async (ctx, task, code, prompt, f) => {
      if (code === 'not_now')
        return f.done(
          ctx,
          task,
          T('visit_left', { done: 'visit completed', pending: 'no check-in scheduled' }),
          prompt,
        );
      const due = new Date(Date.now() + DAYS[code] * 86400000).toISOString();
      try {
        await kit.care(
          ctx,
          task,
          'schedule',
          { encounter_id: task.draft.encounter.id, due_at: due },
          { key: prompt.operation_key },
        );
      } catch (err) {
        if (err.message === 'CONSENT_REQUIRED')
          return f.done(ctx, task, T('schedule_consent'), prompt);
        if (err.message === 'CLINICAL_RESPONSIBILITY_REQUIRED')
          return f.done(ctx, task, T('schedule_responsibility'), prompt);
        throw err;
      }
      return f.done(ctx, task, T('scheduled', { when: kit.formatDate(due) }), prompt);
    },
  },
};

async function enter(ctx, task, practiceId, f) {
  const next = await kit.save(ctx, task, { practice_id: practiceId });
  const step =
    { inbox: 'inbox', patients: 'patients', visit: 'patients' }[task.draft.target] ?? 'inbox';
  return f.go(ctx, next, step, { queue_offset: 0, patients_offset: 0 }, { back: false });
}

module.exports = { steps, preparationText };

'use strict';

// The My vault menu for a linked practitioner. Formulation work stays with the
// Vault agent; this menu only routes to care and evidence tasks.

const kit = require('../kit');
const copy = require('../copy');

function options(ctx) {
  const codes = [];
  if (ctx.flags.careActions && ctx.status.care)
    codes.push('care_inbox', 'my_patients', 'record_visit');
  if (ctx.flags.evidenceActions && ctx.status.evidence) codes.push('evidence_reports');
  codes.push('my_formulations', 'privacy', 'language', 'help');
  return codes;
}

async function openPractice(ctx, target, f) {
  if (!(ctx.flags.careActions && ctx.status.care)) return ctx.say(copy.text('link_help'));
  const task = await kit.start(ctx, {
    domain: 'care',
    role: 'practitioner',
    workflow: 'practice',
    step: 'practice_pick',
    draft: { target },
  });
  return f.render(ctx, task);
}

async function openEvidence(ctx, f) {
  if (!(ctx.flags.evidenceActions && ctx.status.evidence))
    return ctx.say(copy.text('ev_unavailable'));
  const task = await kit.start(ctx, {
    domain: 'evidence',
    role: 'owner',
    workflow: 'evidence',
    step: 'menu',
  });
  return f.render(ctx, task);
}

module.exports = {
  openPractice,
  openEvidence,
  steps: {
    menu: {
      render: (ctx, task) => kit.ask(ctx, task, copy.text('menu_prompt'), options(ctx)),
      choose: async (ctx, task, code, _prompt, f) => {
        if (code === 'care_inbox') return openPractice(ctx, 'inbox', f);
        if (code === 'my_patients') return openPractice(ctx, 'patients', f);
        if (code === 'record_visit') return openPractice(ctx, 'visit', f);
        if (code === 'evidence_reports') return openEvidence(ctx, f);
        if (code === 'my_formulations') return f.done(ctx, task, copy.text('formulations_handoff'));
        if (code === 'privacy') return f.go(ctx, task, 'privacy');
        return f.render(ctx, task);
      },
    },
    privacy: {
      render: (ctx, task) =>
        kit.ask(ctx, task, copy.text('privacy_menu'), [
          'stop_messages',
          'resume_messages',
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
            copy.text('stopped', { cancelled: result.cancelled, inFlight: result.in_flight > 0 }),
          );
          return f.render(ctx, task);
        }
        if (code === 'resume_messages') return f.enterGeneric(ctx, task, '_resume');
        if (code === 'unlink_phone') return f.enterGeneric(ctx, task, '_unlink');
        return f.render(ctx, task);
      },
    },
  },
};

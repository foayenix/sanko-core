'use strict';

// My care before this chat is linked to an account. Reveals nothing: no
// candidate record, practice, recipe or patient identity.

const kit = require('../kit');
const copy = require('../copy');

module.exports = {
  steps: {
    menu: {
      render: (ctx, task) =>
        kit.ask(ctx, task, `${copy.text('synthetic_banner')}\n${copy.text('generic_menu')}`, [
          'link',
          'language',
          'help',
        ]),
      choose: async (ctx, task, code, _prompt, f) => {
        if (code === 'link') {
          await ctx.say(copy.text('link_help'));
          return f.render(ctx, task);
        }
        return f.render(ctx, task);
      },
    },
  },
  // Text before linking is never saved anywhere.
  freeText: async (ctx, task, _text, f) => {
    await ctx.say(copy.text('discarded'));
    return f.render(ctx, task);
  },
};

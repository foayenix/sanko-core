'use strict';
// One disposable database holding both the care and evidence fixtures, and a
// fake WhatsApp chat that drives the real routing and guided engine.
const crypto = require('node:crypto');
const { createPostgres } = require('./postgres');

const { sql, rpc } = createPostgres(process.env.CHANNEL_TEST_DB_URL, '(?:care|evidence|channel)_');

let clock = Math.floor(Date.now() / 1000);

// A person's phone. `send` and `tap` build Meta-shaped inbound messages and
// run them through the same entry points the webhook uses; everything the
// service sends back is recorded in `out`.
function phone(number, { route, engine }) {
  // `out` is what arrived since the last clear(); taps read the full history,
  // so clearing before a tap still taps the button the person can see.
  const out = [];
  const history = [];
  const record = message => {
    out.push(message);
    history.push(message);
  };
  const transport = {
    sendTextMessage: async (_to, body) => record({ type: 'text', body }),
    sendButtonMessage: async (_to, body, buttons) =>
      record({ type: 'buttons', body, options: buttons }),
    sendListMessage: async (_to, body, _label, rows) =>
      record({ type: 'list', body, options: rows }),
    sendDocument: async (_to, document) => {
      record({ type: 'document', ...document });
      return (
        transport.documentResult ?? {
          status: 'accepted',
          providerId: `wamid.${crypto.randomUUID()}`,
          mediaId: `media-${crypto.randomUUID()}`,
        }
      );
    },
    deleteMedia: async id => {
      record({ type: 'delete_media', id });
      return true;
    },
  };
  async function deliver(message) {
    const messages = [
      { id: `wamid.in.${crypto.randomUUID()}`, timestamp: String(++clock), ...message },
    ];
    const mode = await route(number, messages);
    const handled = await engine.handle({ from: number, messages, mode, transport });
    return { mode, handled };
  }
  const interactive = () =>
    [...history].reverse().find(m => m.type === 'buttons' || m.type === 'list');
  return {
    number,
    out,
    transport,
    send: body => deliver({ type: 'text', text: { body } }),
    media: () => deliver({ type: 'audio', audio: { id: 'media-in' } }),
    // Taps the option with this title on the newest interactive message, or
    // replays a captured option id.
    tap: async (title, option) => {
      const choice = option ?? interactive()?.options.find(o => o.title === title);
      if (!choice)
        throw new Error(
          `No option "${title}" in: ${JSON.stringify(interactive()?.options.map(o => o.title))}`,
        );
      await deliver({
        type: 'interactive',
        interactive: { button_reply: { id: choice.id, title: choice.title } },
      });
      return choice;
    },
    option: title => interactive()?.options.find(o => o.title === title),
    titles: () => interactive()?.options.map(o => o.title) ?? [],
    last: () => out.at(-1),
    texts: () => out.map(m => m.body ?? '').join('\n---\n'),
    since: n =>
      out
        .slice(n)
        .map(m => m.body ?? '')
        .join('\n---\n'),
    clear: () => out.splice(0),
  };
}

const contact = number =>
  crypto.createHash('sha256').update(number.replace(/^\+/, '')).digest('hex');

module.exports = { sql, rpc, phone, contact };

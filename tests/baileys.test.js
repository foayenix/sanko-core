const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDb } = require('./helpers/fakeDb');

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const {
  BaileysTransport,
  acquireAuthLock,
  adaptBaileysMessage,
  normalizePhoneNumber,
  parseAllowedNumbers,
} = require('../src/services/baileys');

const fakeBaileys = {
  isPnUser: jid => jid?.endsWith('@s.whatsapp.net'),
  isJidGroup: jid => jid?.endsWith('@g.us'),
  isJidBroadcast: jid => jid?.endsWith('@broadcast'),
  isJidNewsletter: jid => jid?.endsWith('@newsletter'),
  jidDecode: jid => ({ user: jid.split('@')[0] }),
  normalizeMessageContent: message => message,
  getContentType: content => Object.keys(content)[0],
  downloadMediaMessage: async () => Buffer.from('media'),
};

describe('Baileys WhatsApp test adapter', () => {
  it('normalizes E.164 allowlists and supports an explicit wildcard', () => {
    assert.equal(normalizePhoneNumber(' +44 7700 900123 '), '+447700900123');
    assert.deepEqual([...parseAllowedNumbers('+447700900123, +234 801 234 5678')], [
      '+447700900123', '+2348012345678',
    ]);
    assert.equal(parseAllowedNumbers('*'), null);
  });

  it('adapts a direct text message into the existing router shape', () => {
    const inbound = adaptBaileysMessage({
      key: { id: 'wam-1', remoteJid: '447700900123@s.whatsapp.net', fromMe: false },
      message: { conversation: 'hello Sanko' },
    }, fakeBaileys);

    assert.equal(inbound.from, '+447700900123');
    assert.equal(inbound.jid, '447700900123@s.whatsapp.net');
    assert.deepEqual(inbound.message, { id: 'wam-1', type: 'text', text: { body: 'hello Sanko' } });
  });

  it('uses the phone-number alternate JID while replying on the original LID chat', () => {
    const inbound = adaptBaileysMessage({
      key: {
        id: 'wam-2', remoteJid: '123456789@lid', remoteJidAlt: '2348012345678@s.whatsapp.net', fromMe: false,
      },
      message: { extendedTextMessage: { text: 'my formulation' } },
    }, fakeBaileys);

    assert.equal(inbound.from, '+2348012345678');
    assert.equal(inbound.jid, '123456789@lid');
  });

  it('ignores groups, broadcasts, and the linked account own messages', () => {
    const message = jid => ({ key: { id: 'x', remoteJid: jid, fromMe: false }, message: { conversation: 'hi' } });
    assert.equal(adaptBaileysMessage(message('123@g.us'), fakeBaileys), null);
    assert.equal(adaptBaileysMessage(message('status@broadcast'), fakeBaileys), null);
    assert.equal(adaptBaileysMessage({ ...message('123@s.whatsapp.net'), key: { ...message('123@s.whatsapp.net').key, fromMe: true } }, fakeBaileys), null);
  });

  it('sends replies only to allowlisted numbers and renders choices as text', async () => {
    const sent = [];
    const transport = new BaileysTransport({
      baileys: fakeBaileys,
      allowedNumbers: new Set(['+447700900123']),
    });
    transport.setSocket({ sendMessage: async (jid, content) => sent.push({ jid, content }) });
    transport.remember({ from: '+447700900123', jid: 'test-chat@lid', message: { id: 'x' } });

    await transport.sendButtonMessage('+447700900123', 'Choose a language', ['English', 'Yoruba']);
    assert.equal(sent[0].jid, 'test-chat@lid');
    assert.match(sent[0].content.text, /1\. English\n2\. Yoruba/);
    await assert.rejects(() => transport.sendTextMessage('+2348012345678', 'blocked'), /non-allowlisted/);
  });

  it('refuses to be a second adapter on one auth directory', () => {
    const authPath = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sanko-lock-'));
    const lockPath = nodePath.join(authPath, '.adapter.lock');
    const quiet = { log: () => {}, error: () => {}, warn: () => {} };

    const release = acquireAuthLock(authPath, quiet);
    assert.equal(fs.readFileSync(lockPath, 'utf8'), String(process.pid));

    // pid 1 always exists, so this stands in for a live sibling adapter.
    fs.writeFileSync(lockPath, '1');
    assert.throws(() => acquireAuthLock(authPath, quiet), /already using|kill 1/);

    // A pid that is not running is a leftover from a killed run, not a conflict.
    const warnings = [];
    fs.writeFileSync(lockPath, '999999');
    acquireAuthLock(authPath, { ...quiet, warn: m => warnings.push(m) });
    assert.match(warnings[0], /stale adapter lock/);
    assert.equal(fs.readFileSync(lockPath, 'utf8'), String(process.pid));

    release();
    assert.equal(fs.existsSync(lockPath), false);
    fs.rmSync(authPath, { recursive: true, force: true });
  });

  it('names the number it ignored, once, so a wrong allowlist is not silent', () => {
    const warnings = [];
    const transport = new BaileysTransport({
      baileys: fakeBaileys,
      allowedNumbers: new Set(['+447700900123']),
      output: { log: () => {}, error: () => {}, warn: msg => warnings.push(msg) },
    });

    transport.noteBlocked('+2348012345678');
    transport.noteBlocked('2348012345678');  // same number, unnormalised
    assert.equal(warnings.length, 1, 'repeat senders must not spam the log');
    assert.match(warnings[0], /BAILEYS_ALLOWED_NUMBERS=\+2348012345678/);

    transport.noteBlocked('+447700900999');
    assert.equal(warnings.length, 2, 'a different number is worth reporting');
  });

  it('downloads cached voice notes with their WhatsApp MIME type', async () => {
    const transport = new BaileysTransport({ baileys: fakeBaileys, allowedNumbers: null });
    const raw = { key: { id: 'audio-1' }, message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } } };
    transport.remember({ from: '+447700900123', jid: '447700900123@s.whatsapp.net', media: raw, message: { id: 'audio-1' } });

    const downloaded = await transport.downloadMedia('audio-1');
    assert.equal(downloaded.buffer.toString(), 'media');
    assert.equal(downloaded.mimeType, 'audio/ogg; codecs=opus');
  });

  it('runs an inbound message through the real agent transport boundary', async () => {
    const fake = installFakeDb();
    const agent = require('../src/agent');
    const { processTurn } = require('../src/router');
    const originalRunAgent = agent.runAgent;
    const sent = [];
    const transport = {
      sendTextMessage: async (to, text) => { sent.push({ to, text }); return true; },
      sendButtonMessage: async () => true,
      sendPatientConsentRequest: async () => true,
      downloadMedia: async () => { throw new Error('not used'); },
    };

    try {
      agent.runAgent = async ({ content, send }) => {
        assert.equal(content[0].text, 'hello from WhatsApp');
        await send('agent reply');
        return { replies: ['agent reply'], toolCalls: [], stopped: 'end_turn' };
      };

      await processTurn('+447700900123', [
        { id: 'wam-real-path', type: 'text', text: { body: 'hello from WhatsApp' } },
      ], transport);

      assert.equal(fake.store.practitioners[0].phone_number, '+447700900123');
      assert.equal(sent.at(-1).text, 'agent reply');
      assert.equal(sent.length, 2, 'new practitioners receive the privacy notice before the agent reply');
    } finally {
      agent.runAgent = originalRunAgent;
      fake.restore();
    }
  });
});

describe('Baileys messages survive the process that accepted them', () => {
  const {
    claimIdFor, completeClaims, recoverInbound, TRANSPORT,
  } = require('../src/services/baileys');
  const db = require('../src/services/supabase');

  // Enough of a transport to answer the two questions recovery asks it: is the
  // media still here, and can I reach this person.
  function fakeTransport({ media = [] } = {}) {
    const cached = new Set(media);
    const sent = [];
    return {
      sent,
      hasMedia: id => cached.has(id),
      sendTextMessage: async (to, text) => { sent.push({ to, text }); return true; },
    };
  }

  function fakeAggregator() {
    const pushed = [];
    return { pushed, push: (key, item) => pushed.push({ key, id: item.id, type: item.type }) };
  }

  // A claim as the inbound handler writes it, aged past the grace period.
  function claim(store, id, message, { ageSeconds = 3600, attempts = 1 } = {}) {
    store.processedMessages.set(claimIdFor(id), {
      message_id: claimIdFor(id),
      transport: TRANSPORT,
      payload: { from: '+447700900123', jid: '447700900123@s.whatsapp.net', message },
      attempts,
      completed_at: null,
      first_seen_at: new Date(Date.now() - ageSeconds * 1000).toISOString(),
    });
  }

  const text = id => ({ id, type: 'text', text: { body: 'for malaria, boil the leaves' } });
  const voiceNote = id => ({ id, type: 'audio', audio: { id } });

  it('re-enqueues a text message whose turn never ran, with what was said', async () => {
    const fake = installFakeDb();
    try {
      claim(fake.store, 'wam-text', text('wam-text'));
      const aggregator = fakeAggregator();

      const result = await recoverInbound({ transport: fakeTransport(), aggregator });

      assert.equal(result.recovered, 1);
      assert.deepEqual(aggregator.pushed, [{ key: '+447700900123', id: 'wam-text', type: 'text' }]);
    } finally { fake.restore(); }
  });

  it('closes a claim it cannot route rather than leaving it pending forever', async () => {
    const fake = installFakeDb();
    try {
      claim(fake.store, 'wam-broken', undefined);   // a payload with no message in it
      const aggregator = fakeAggregator();

      const result = await recoverInbound({ transport: fakeTransport(), aggregator });

      assert.equal(result.recovered, 0);
      assert.deepEqual(aggregator.pushed, []);
      assert.notEqual(fake.store.processedMessages.get(claimIdFor('wam-broken')).completed_at, null);
    } finally { fake.restore(); }
  });

  it('asks for a voice note again rather than answering one it cannot hear', async () => {
    // The media cache is in memory. A restart leaves the envelope without its
    // bytes, and running the turn anyway would reply to a formulation nobody
    // could listen to — omitting what the practitioner actually said.
    const fake = installFakeDb();
    try {
      claim(fake.store, 'wam-voice', voiceNote('wam-voice'));
      const aggregator = fakeAggregator();
      const transport = fakeTransport({ media: [] });   // cache emptied by the restart

      const result = await recoverInbound({ transport, aggregator });

      assert.equal(result.recovered, 0);
      assert.equal(result.unreadable, 1);
      assert.deepEqual(aggregator.pushed, []);
      assert.match(transport.sent[0].text, /Please send it again/);
      assert.equal(transport.sent[0].to, '+447700900123');
      // And it is closed, so they are not asked a second time.
      assert.notEqual(fake.store.processedMessages.get(claimIdFor('wam-voice')).completed_at, null);
    } finally { fake.restore(); }
  });

  it('replays a voice note whose media this process still holds', async () => {
    // A turn that died inside a still-running process: the cache is intact.
    const fake = installFakeDb();
    try {
      claim(fake.store, 'wam-voice', voiceNote('wam-voice'));
      const aggregator = fakeAggregator();
      const transport = fakeTransport({ media: ['wam-voice'] });

      const result = await recoverInbound({ transport, aggregator });

      assert.equal(result.recovered, 1);
      assert.equal(result.unreadable, 0);
      assert.deepEqual(transport.sent, []);
      assert.deepEqual(aggregator.pushed.map(p => p.id), ['wam-voice']);
    } finally { fake.restore(); }
  });

  it('closes claims when the turn is over', async () => {
    const fake = installFakeDb();
    try {
      claim(fake.store, 'wam-done', text('wam-done'));

      await completeClaims([text('wam-done')]);

      const row = fake.store.processedMessages.get(claimIdFor('wam-done'));
      assert.notEqual(row.completed_at, null);
      assert.equal(row.payload, null, 'the practitioner’s words are dropped once the work is done');
      assert.equal((await recoverInbound({ transport: fakeTransport(), aggregator: fakeAggregator() })).recovered, 0);
    } finally { fake.restore(); }
  });

  it('leaves the Meta webhook’s messages alone', async () => {
    // Two processes, one table. Each can only replay its own: this adapter has
    // no wamid it could answer, and the webhook has no socket to a linked phone.
    const fake = installFakeDb();
    try {
      claim(fake.store, 'wam-mine', text('wam-mine'));
      fake.store.processedMessages.set('wamid.theirs', {
        message_id: 'wamid.theirs', transport: 'meta',
        payload: { from: '+2348000000001', message: { id: 'wamid.theirs', type: 'text' } },
        attempts: 1, completed_at: null,
        first_seen_at: new Date(Date.now() - 3600_000).toISOString(),
      });

      const aggregator = fakeAggregator();
      const result = await recoverInbound({ transport: fakeTransport(), aggregator });

      assert.equal(result.recovered, 1);
      assert.deepEqual(aggregator.pushed.map(p => p.id), ['wam-mine']);
      // Untouched: not replayed, and its attempt not spent on this adapter's behalf.
      const theirs = fake.store.processedMessages.get('wamid.theirs');
      assert.equal(theirs.completed_at, null);
      assert.equal(theirs.attempts, 1);
    } finally { fake.restore(); }
  });

  it('namespaces its claim ids so a chat-scoped id cannot collide with a wamid', async () => {
    const fake = installFakeDb();
    try {
      // The same id from both transports. Baileys ids are unique per chat, not
      // globally, and this table is keyed on exactly that.
      assert.equal(await db.claimMessage('ABC123', 'meta', { payload: {} }), true);
      assert.equal(await db.claimMessage(claimIdFor('ABC123'), TRANSPORT, { payload: {} }), true);
      assert.equal(fake.store.processedMessages.size, 2);
    } finally { fake.restore(); }
  });
});

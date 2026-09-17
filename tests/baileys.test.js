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

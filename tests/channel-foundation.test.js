'use strict';
// Offline checks for the guided WhatsApp channel. The behaviour against real
// care and evidence SQL is in tests/channel/postgres.test.js (npm run test:channel).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const axios = require('axios');
const config = require('../src/channel/config');
const copy = require('../src/channel/copy');
const kit = require('../src/channel/kit');
const engine = require('../src/channel/engine');
const { describe } = require('../src/channel/format');
const reportText = require('../src/evidence/reportText');
const pdf = require('../src/evidence/pdf');
const { render } = require('../src/evidence/reports');
const whatsapp = require('../src/services/whatsapp');

const base = {
  CARE_PATIENT_ACCESS_ENABLED: 'true',
  CARE_ENCOUNTERS_ENABLED: 'true',
  CARE_SYNTHETIC_ONLY: 'true',
  PATIENT_TRACKING_ENABLED: 'true',
  AGENT_TOOLS: 'full',
  EVIDENCE_ENABLED: 'true',
  EVIDENCE_SYNTHETIC_ONLY: 'true',
  EVIDENCE_ORIGIN: 'https://evidence.example.invalid',
};

test('channel gates default off, depend on each other and refuse a live path', () => {
  assert.deepEqual(config.configuration({}), {
    guided: false,
    careActions: false,
    careNotices: false,
    evidenceActions: false,
    evidenceDelivery: false,
    sessionMinutes: 720,
    outboundTransport: 'meta',
  });
  assert.equal(
    config.configuration({ CHANNEL_OUTBOUND_TRANSPORT: 'baileys' }).outboundTransport,
    'baileys',
  );
  assert.throws(
    () => config.configuration({ CHANNEL_OUTBOUND_TRANSPORT: 'sms' }),
    /OUTBOUND_TRANSPORT/,
  );
  assert.equal(config.enabled({}), false);
  assert.throws(
    () => config.configuration({ CARE_CHANNEL_ACTIONS_ENABLED: 'true' }),
    /REQUIRES_GUIDED/,
  );
  assert.throws(
    () => config.configuration({ CHANNEL_GUIDED_ENABLED: 'true' }),
    /LIVE_CHANNEL_NOT_QUALIFIED/,
  );
  const guided = { CHANNEL_GUIDED_ENABLED: 'true', CHANNEL_SYNTHETIC_ONLY: 'true' };
  assert.equal(config.configuration(guided).guided, true);
  assert.throws(
    () => config.configuration({ ...guided, CARE_CHANNEL_ACTIONS_ENABLED: 'true' }),
    /CARE_CHANNEL_REQUIRES_CARE|CARE_REQUIRES/,
  );
  assert.throws(
    () => config.configuration({ ...guided, CARE_CHANNEL_NOTIFICATIONS_ENABLED: 'true' }),
    /CARE_NOTICES_REQUIRE/,
  );
  assert.throws(
    () => config.configuration({ ...guided, EVIDENCE_CHANNEL_ACTIONS_ENABLED: 'true' }),
    /EVIDENCE_CHANNEL_REQUIRES_EVIDENCE/,
  );
  assert.throws(
    () => config.configuration({ ...guided, ...base, EVIDENCE_CHANNEL_DELIVERY_ENABLED: 'true' }),
    /DELIVERY_REQUIRES_EVIDENCE_CHANNEL/,
  );
  const all = {
    ...guided,
    ...base,
    CARE_CHANNEL_ACTIONS_ENABLED: 'true',
    CARE_CHANNEL_NOTIFICATIONS_ENABLED: 'true',
    EVIDENCE_CHANNEL_ACTIONS_ENABLED: 'true',
    EVIDENCE_CHANNEL_DELIVERY_ENABLED: 'true',
  };
  assert.equal(config.configuration(all).evidenceDelivery, true);
  // A misconfiguration of the underlying care gate stops the channel too.
  assert.throws(
    () => config.configuration({ ...all, CARE_SYNTHETIC_ONLY: 'false' }),
    /LIVE_CARE_NOT_QUALIFIED/,
  );
  for (const minutes of ['4', '4321', 'soon'])
    assert.throws(
      () => config.configuration({ ...guided, CHANNEL_SESSION_MINUTES: minutes }),
      /SESSION_MINUTES/,
    );
  // The safe accessor never throws; misconfiguration means off.
  assert.equal(config.enabled({ CHANNEL_GUIDED_ENABLED: 'true' }), false);
});

test('wording is versioned, marked unreviewed, and fits WhatsApp without truncation', () => {
  assert.match(copy.VERSION, /^en-synthetic-/);
  assert.equal(copy.REVIEW_STATUS, 'unreviewed-synthetic');
  assert.deepEqual(
    copy.LANGUAGES.map(l => [l.code, l.available]),
    [
      ['en', true],
      ['pcm', false],
      ['yo', false],
      ['ha', false],
      ['ig', false],
    ],
  );
  for (const [code, label] of Object.entries(copy.LABELS))
    assert.ok(label.length <= kit.MAX_ROW_TITLE, `${code} is longer than a list row`);
  // Consequential confirmations are always shown as whole buttons.
  for (const code of [
    'accept_tracking',
    'decline_invite',
    'sign_version',
    'release',
    'complete',
    'send',
    'send_next_steps',
    'agree_submit',
    'confirm_cancel',
    'send_copy',
    'create_record',
    'send_request',
    'confirm_change',
    'resume_messages',
    'confirm_unlink',
    'save_draft',
    'record_visit_now',
    'send_answer',
  ])
    assert.ok(copy.label(code).length <= kit.MAX_BUTTON_TITLE, code);
  assert.throws(() => copy.label('nope'), /UNKNOWN_LABEL/);
  assert.throws(() => copy.text('nope'), /UNKNOWN_TEXT/);
  // Messages never claim more than happened.
  assert.match(copy.text('update_saved', { practice: 'P' }), /have not read it yet/);
  assert.match(copy.text('rights_sent', { kind: 'deletion' }), /not fulfilled/);
  assert.match(copy.text('ev_sent'), /handed to WhatsApp/);
  assert.doesNotMatch(copy.text('ev_sent'), /delivered/);
  assert.match(copy.text('stopped', { cancelled: 0, inFlight: true }), /may still arrive/);
});

test('inputs: only server-issued ids are taps; commands, link codes and role words are recognised', () => {
  const id = 'sk1.0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3.2';
  assert.deepEqual(
    engine.parse({ type: 'interactive', interactive: { button_reply: { id, title: 'Send' } } }),
    {
      kind: 'tap',
      prompt: '0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3',
      index: 2,
    },
  );
  assert.equal(
    engine.parse({ type: 'interactive', interactive: { list_reply: { id, title: 'x' } } }).kind,
    'tap',
  );
  // A label is never authority, and a forged id shape is not a tap.
  assert.equal(
    engine.parse({
      type: 'interactive',
      interactive: { button_reply: { id: 'Send', title: 'Send' } },
    }).kind,
    'foreign_tap',
  );
  assert.equal(
    engine.parse({
      type: 'interactive',
      interactive: { button_reply: { id: `${id}00`, title: '' } },
    }).kind,
    'foreign_tap',
  );
  assert.equal(
    engine.parse({
      type: 'interactive',
      interactive: { button_reply: { id: 'sk1.not-a-prompt.1', title: '' } },
    }).kind,
    'foreign_tap',
  );
  assert.deepEqual(engine.parse({ type: 'text', text: { body: 'link abcd-2345' } }), {
    kind: 'link',
    code: 'ABCD2345',
  });
  assert.equal(engine.parse({ type: 'text', text: { body: 'LINK abcd 2345' } }).kind, 'text');
  assert.deepEqual(engine.parse({ type: 'text', text: { body: 'Stop.' } }), {
    kind: 'command',
    command: 'stop',
    raw: 'stop',
  });
  assert.equal(
    engine.parse({ type: 'text', text: { body: 'stop messages' } }).raw,
    'stop messages',
  );
  assert.equal(engine.parse({ type: 'text', text: { body: 'My care' } }).kind, 'role');
  assert.equal(
    engine.parse({
      type: 'interactive',
      interactive: { button_reply: { id: 'sanko-care:visits' } },
    }).kind,
    'role',
  );
  assert.equal(engine.parse({ type: 'audio', audio: { id: 'm' } }).kind, 'media');
  assert.equal(engine.parse({ type: 'text', text: { body: 'I feel worse' } }).kind, 'text');
});

test('My vault stays with the agent unless the input is explicitly guided', () => {
  const ctx = { status: { care: { binding_id: 'b' } }, flags: { careActions: true } };
  const claims = (inputs, task = null, prompt = null) =>
    engine.claims({ mode: 'practitioner', inputs, task, prompt, ctx });
  const text = body => engine.parse({ type: 'text', text: { body } });
  assert.equal(claims([text('Recorded a new remedy for cough')]), false);
  assert.equal(claims([text('stop')]), false); // plain "stop" belongs to the Vault conversation
  assert.equal(claims([text('stop messages')]), true);
  assert.equal(claims([text('care inbox')]), true);
  assert.equal(claims([text('menu')]), true);
  const unbound = { status: {}, flags: {} };
  assert.equal(
    engine.claims({
      mode: 'practitioner',
      inputs: [text('menu')],
      task: null,
      prompt: null,
      ctx: unbound,
    }),
    false,
  );
  const menuTask = { workflow: 'vault', step: 'menu' };
  assert.equal(
    claims([text('Recorded a new remedy for cough')], menuTask, { labels: ['Care inbox'] }),
    false,
  );
  assert.equal(claims([text('2')], menuTask, { labels: ['Care inbox', 'My patients'] }), true);
  assert.equal(
    claims([text('my patients')], menuTask, { labels: ['Care inbox', 'My patients'] }),
    true,
  );
  assert.equal(
    claims([text('Patient is better')], { workflow: 'practice', step: 'note_text' }),
    true,
  );
  assert.equal(
    engine.claims({ mode: 'patient', inputs: [text('anything')], task: null, prompt: null, ctx }),
    true,
  );
});

test('router: guided tasks come before the handoff and the agent; statuses are durable', async () => {
  const { installFakeDb } = require('./helpers/fakeDb');
  const router = require('../src/router');
  const guided = require('../src/channel/engine');
  const channelOutbound = require('../src/channel/outbound');
  const fake = installFakeDb();
  const original = { handle: guided.handle, record: channelOutbound.recordStatuses };
  const calls = [];
  const sent = [];
  const transport = {
    sendTextMessage: async (_, s) => sent.push(s),
    sendButtonMessage: async (_, s) => sent.push(s),
  };
  try {
    guided.handle = async args => {
      calls.push(args.mode);
      return true;
    };
    await router.processTurn(
      '+447700900301',
      [{ id: 'g1', timestamp: '100', type: 'text', text: { body: 'My care' } }],
      transport,
    );
    assert.deepEqual(calls, ['patient']);
    assert.equal(sent.length, 0); // the portal handoff did not also reply
    assert.equal(fake.store.agentMessages.length, 0);

    const res = () => {
      const r = { code: null, sendStatus: c => ((r.code = c), r) };
      return r;
    };
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1700000000' }],
              },
            },
          ],
        },
      ],
    };
    const recorded = [];
    channelOutbound.recordStatuses = async b => recorded.push(b);
    let r = res();
    await router.handleWebhook({ body, headers: {} }, r);
    assert.equal(r.code, 200);
    assert.equal(recorded.length, 0); // channel off: nothing recorded
    Object.assign(process.env, { CHANNEL_GUIDED_ENABLED: 'true', CHANNEL_SYNTHETIC_ONLY: 'true' });
    channelOutbound.recordStatuses = async () => {
      throw new Error('db down');
    };
    r = res();
    await router.handleWebhook({ body, headers: {} }, r);
    assert.equal(r.code, 503); // not acknowledged, so Meta redelivers
  } finally {
    delete process.env.CHANNEL_GUIDED_ENABLED;
    delete process.env.CHANNEL_SYNTHETIC_ONLY;
    guided.handle = original.handle;
    channelOutbound.recordStatuses = original.record;
    fake.restore();
  }
});

test('Meta transport: lists, documents and honest acceptance states', async () => {
  const payload = whatsapp.listPayload('Pick', 'Choose', [
    { id: 'a', title: 'One', description: 'First' },
    { id: 'b', title: 'Two' },
  ]);
  assert.equal(payload.interactive.type, 'list');
  assert.deepEqual(payload.interactive.action.sections[0].rows[1], { id: 'b', title: 'Two' });
  const post = axios.post;
  const del = axios.delete;
  try {
    axios.post = async () => ({ data: { messages: [{ id: 'wamid.ok' }] } });
    assert.deepEqual(await whatsapp.deliverText('+1', 'x'), {
      status: 'accepted',
      providerId: 'wamid.ok',
    });
    axios.post = async () => ({ data: {} });
    assert.equal((await whatsapp.deliverText('+1', 'x')).status, 'ambiguous');
    axios.post = async () => {
      throw Object.assign(new Error('bad'), { response: { status: 400 } });
    };
    assert.equal((await whatsapp.deliverText('+1', 'x')).status, 'failed');
    axios.post = async () => {
      throw Object.assign(new Error('timeout'), { request: {} });
    };
    assert.equal((await whatsapp.deliverText('+1', 'x')).status, 'ambiguous');
    axios.post = async () => {
      throw Object.assign(new Error('bad gateway'), { response: { status: 502 } });
    };
    assert.equal((await whatsapp.deliverText('+1', 'x')).status, 'ambiguous');
    // A failed upload never sends a message.
    let posts = 0;
    axios.post = async () => {
      posts++;
      throw Object.assign(new Error('nope'), { response: { status: 413 } });
    };
    assert.deepEqual(
      await whatsapp.sendDocument('+1', { buffer: Buffer.from('%PDF-'), filename: 'a.pdf' }),
      {
        status: 'failed',
        error: 'media_upload_failed',
      },
    );
    assert.equal(posts, 1);
    const bodies = [];
    axios.post = async (url, body) => {
      bodies.push({ url, body });
      return url.endsWith('/media')
        ? { data: { id: 'media-1' } }
        : { data: { messages: [{ id: 'wamid.doc' }] } };
    };
    assert.deepEqual(
      await whatsapp.sendDocument('+1', {
        buffer: Buffer.from('%PDF-'),
        filename: 'a.pdf',
        caption: 'c',
      }),
      {
        status: 'accepted',
        providerId: 'wamid.doc',
        mediaId: 'media-1',
      },
    );
    assert.deepEqual(bodies[1].body.document, { id: 'media-1', filename: 'a.pdf', caption: 'c' });
    axios.delete = async () => ({});
    assert.equal(await whatsapp.deleteMedia('media-1'), true);
  } finally {
    axios.post = post;
    axios.delete = del;
  }
});

function fixtureReport() {
  return require('./helpers/evidencePostgres').report();
}

test('released report HTML is read back exactly, and anything unexpected fails closed', () => {
  const html = render(fixtureReport());
  const blocks = reportText.parse(html.technical);
  assert.equal(blocks[0].type, 'h1');
  assert.ok(
    blocks.some(b => b.type === 'table' && b.rows.length === 1 && b.headers.includes('Finding')),
  );
  const chat = reportText.toChat(html.brief);
  for (const heading of [
    'Scope',
    'Practitioner account',
    'Findings',
    'Risks unknowns',
    'Limitations',
    'Next steps',
  ])
    assert.match(chat, new RegExp(`\\*${heading}\\*`));
  assert.match(chat, /not certification or proof of efficacy/);
  for (const bad of [
    '<p>x<script>y</script></p>',
    '<p>a & b</p>',
    '<p>&nbsp;</p>',
    '<p>unclosed',
    'loose text',
    '<p>a <b</p>',
  ])
    assert.throws(() => reportText.parse(bad), /RENDER_UNSUPPORTED_MARKUP/, bad);
  assert.equal(reportText.parse('<p>&lt;5 &amp; &quot;x&quot;</p>')[0].runs[0].text, '<5 & "x"');
});

test('PDF: deterministic, complete control record, and fails closed on characters it cannot draw', () => {
  const html = render(fixtureReport());
  const meta = {
    formulation_code: 'FM-00001',
    request_id: 'r',
    report_number: 1,
    release_id: 'l',
    released_at: '2026-10-02T00:00:00Z',
    status: 'released',
    reviewer: 'Fictional reviewer',
    reviewed_at: '2026-10-02T00:00:00Z',
    currency: 'Matches the recorded source',
    manifest_hash: 'a'.repeat(64),
  };
  const a = pdf.renderDossier({ ...html, meta }, {});
  const b = pdf.renderDossier({ ...html, meta }, {});
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.renderer, 'sanko-pdf-1:helvetica');
  assert.ok(a.pages >= 2);
  assert.equal(a.buffer.subarray(0, 8).toString('latin1'), '%PDF-1.7');
  // Every content stream inflates, and the control record is present.
  const streams = [];
  const raw = a.buffer.toString('latin1');
  for (const match of raw.matchAll(/(?<!end)stream\n/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('\nendstream', start);
    streams.push(zlib.inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'));
  }
  const text = streams.join('\n');
  for (const phrase of [
    '(Signed manifest:)',
    '(Part 1 of 2 \\227 Practitioner brief \\(released\\))',
    '(Sanko Formulation Evidence Dossier)',
  ])
    assert.ok(text.includes(phrase), phrase);
  const yoruba = fixtureReport();
  yoruba.brief.findings = 'Ẹ̀wà (Yorùbá) — not drawable in WinAnsi Helvetica';
  assert.throws(
    () => pdf.renderDossier({ ...render(yoruba), meta }, {}),
    /RENDER_UNSUPPORTED_CHARACTER/,
  );
  assert.throws(
    () => pdf.renderDossier({ ...html, meta }, { EVIDENCE_PDF_FONT: '/nonexistent.ttf' }),
    /RENDER_FONT_UNAVAILABLE/,
  );
});

test('recipes are shown field by field with unknown and withheld values kept', () => {
  assert.equal(
    describe([
      { quantity_raw: 'withheld', botanical: null, local_name: 'Leaf', part_used: 'unknown' },
    ]).trim(),
    '• name: Leaf; part: unknown; quantity: withheld; botanical name: not recorded',
  );
  assert.equal(describe(null), 'not recorded');
  assert.equal(describe([]), 'none recorded');
});

test('long messages are split on boundaries below the WhatsApp limit', () => {
  const parts = kit.split(`${'word '.repeat(1000)}\n\n${'x'.repeat(5000)}`);
  assert.ok(parts.every(p => p.length <= kit.MAX_TEXT));
  assert.equal(parts.join('').replace(/\s/g, '').length, 'word'.length * 1000 + 5000);
});

#!/usr/bin/env node
'use strict';
// Local synthetic preview of completing care and evidence work in WhatsApp.
// Creates/drops its OWN database; never uses the production Auth adapter,
// Meta, a model, public demo data or an existing database. The chat page is a
// fictional phone: it builds Meta-shaped messages and runs them through the
// real role router, guided engine, care/evidence SQL and outbound worker.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const base = new URL(
  process.env.CHANNEL_TEST_DB_URL ||
    process.env.CARE_TEST_DB_URL ||
    'postgresql://postgres@127.0.0.1:5432/postgres',
);
if (process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost'].includes(base.hostname))
  throw new Error('Local synthetic preview only');
const name = `sanko_channel_preview_${crypto.randomBytes(6).toString('hex')}`;
const target = new URL(base);
target.pathname = '/' + name;
execFileSync('psql', [base.href, '-X', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${name}`], {
  stdio: 'pipe',
});
const port = Number(process.env.CHANNEL_PREVIEW_PORT || 3043);
const origin = `http://127.0.0.1:${port}`;
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
Object.assign(process.env, {
  CHANNEL_TEST_DB_URL: target.href,
  CARE_TEST_DB_URL: target.href,
  EVIDENCE_TEST_DB_URL: target.href,
  SUPABASE_DB_URL: target.href,
  CARE_PATIENT_ACCESS_ENABLED: 'true',
  CARE_ENCOUNTERS_ENABLED: 'true',
  CARE_SYNTHETIC_ONLY: 'true',
  PATIENT_TRACKING_ENABLED: 'true',
  AGENT_TOOLS: 'full',
  CARE_ORIGIN: origin,
  EVIDENCE_ENABLED: 'true',
  EVIDENCE_SYNTHETIC_ONLY: 'true',
  EVIDENCE_ORIGIN: origin,
  CHANNEL_GUIDED_ENABLED: 'true',
  CHANNEL_SYNTHETIC_ONLY: 'true',
  CARE_CHANNEL_ACTIONS_ENABLED: 'true',
  CARE_CHANNEL_NOTIFICATIONS_ENABLED: 'true',
  EVIDENCE_CHANNEL_ACTIONS_ENABLED: 'true',
  EVIDENCE_CHANNEL_DELIVERY_ENABLED: 'true',
  PORTAL_RATE_LIMIT_KEY: crypto.randomBytes(32).toString('hex'),
});
if (!process.env.EVIDENCE_PDF_FONT && fs.existsSync(FONT)) {
  process.env.EVIDENCE_PDF_FONT = FONT;
  const bold = FONT.replace('.ttf', '-Bold.ttf');
  if (fs.existsSync(bold)) process.env.EVIDENCE_PDF_FONT_BOLD = bold;
}

const { rpc } = require('../tests/helpers/channelPostgres');
const careFixtures = require('../tests/helpers/carePostgres');
const evidenceFixtures = require('../tests/helpers/evidencePostgres');
for (const store of ['care', 'evidence', 'channel']) require(`../src/${store}/store`).rpc = rpc;
const careAuth = require('../src/care/auth');
const evidenceAuth = require('../src/evidence/auth');
const careChannel = require('../src/care/channel');
const engine = require('../src/channel/engine');
const outbound = require('../src/channel/outbound');

// Fictional phones. The practitioner and the evidence owner already have a
// Vault account, so their chats start in My vault.
const PHONES = {
  '+447700900201': { label: 'Patient (fictional)', vault: false },
  '+447700900202': { label: 'Practitioner (fictional)', vault: true },
  '+447700900203': { label: 'Evidence owner (fictional)', vault: true },
};
const chats = Object.fromEntries(Object.keys(PHONES).map(p => [p, []]));
const documents = [];
let clock = Math.floor(Date.now() / 1000);

function transportFor(number) {
  const push = entry =>
    chats[number].push({ from: 'sanko', at: new Date().toISOString(), ...entry });
  return {
    sendTextMessage: async (_to, body) => push({ type: 'text', body }),
    sendButtonMessage: async (_to, body, options) => push({ type: 'buttons', body, options }),
    sendListMessage: async (_to, body, _label, options) => push({ type: 'list', body, options }),
    // Loopback-only stand-in for Meta's media upload and document message.
    sendDocument: async (to, { buffer, filename, caption }) => {
      documents.push({ buffer, filename });
      chats[to].push({
        from: 'sanko',
        type: 'document',
        filename,
        caption,
        href: `/whatsapp/document/${documents.length - 1}`,
        bytes: buffer.length,
      });
      return { status: 'accepted', providerId: `preview.${crypto.randomUUID()}`, mediaId: null };
    },
  };
}

async function deliver(number, message) {
  const messages = [
    { id: `preview.${crypto.randomUUID()}`, timestamp: String(++clock), ...message },
  ];
  const transport = transportFor(number);
  const mode = await careChannel.resolve(number, messages, PHONES[number].vault);
  if (await engine.handle({ from: number, messages, mode, transport })) return;
  if (mode !== 'practitioner') return careChannel.reply(mode, number, transport, messages);
  chats[number].push({
    from: 'preview',
    type: 'text',
    body: 'This message would go to the Vault agent, which this preview does not run.',
  });
}

let server;
let timer;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  execFileSync('psql', [base.href, '-X', '-c', `drop database ${name} with (force)`], {
    stdio: 'pipe',
  });
}

async function main() {
  execFileSync(process.execPath, ['scripts/migrate.js'], { stdio: 'pipe', env: process.env });
  const care = await careFixtures.seed();
  const ev = await evidenceFixtures.seed();
  const careLogin = async (email, password) => {
    const accounts = {
      'patient@example.invalid': care.ids.patient,
      'practitioner@example.invalid': care.ids.practitioner,
    };
    if (password !== 'synthetic-only' || !accounts[email]) throw new Error('UNAUTHENTICATED');
    const token = careAuth.randomToken();
    const csrf = careAuth.randomToken();
    await rpc('care_open_session', {
      p_auth_user: accounts[email],
      p_token: careAuth.hash(token),
      p_csrf: careAuth.hash(csrf),
    });
    return { token, csrf };
  };
  const evidenceLogin = async (email, password) => {
    const who = email.replace('@example.invalid', '');
    const known = ['owner', 'analyst', 'reviewer', 'admin', 'release'];
    if (password !== 'synthetic-only' || !known.includes(who) || email !== `${who}@example.invalid`)
      throw new Error('UNAUTHENTICATED');
    const token = evidenceAuth.randomToken();
    const csrf = evidenceAuth.randomToken();
    await rpc('evidence_open_session', {
      p_auth_user: ev.ids[who],
      p_token: evidenceAuth.hash(token),
      p_csrf: evidenceAuth.hash(csrf),
    });
    return { token, csrf };
  };

  const app = express();
  app.use('/care', require('../src/care/routes').createRouter({ login: careLogin }));
  app.use('/evidence', require('../src/evidence/routes').createRouter({ login: evidenceLogin }));
  app.use('/whatsapp', (_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; " +
        "frame-ancestors 'none'",
    });
    next();
  });
  app.get('/', (_req, res) => res.redirect('/whatsapp'));
  app.get('/whatsapp', (_req, res) => res.sendFile(path.join(__dirname, 'channel-preview.html')));
  app.get('/whatsapp/app.js', (_req, res) =>
    res.sendFile(path.join(__dirname, 'channel-preview-app.js')),
  );
  app.get('/whatsapp/style.css', (_req, res) =>
    res.sendFile(path.join(__dirname, 'channel-preview.css')),
  );
  app.get('/whatsapp/api/phones', (_req, res) => res.json(PHONES));
  app.get('/whatsapp/api/chat', (req, res) => {
    if (!Object.hasOwn(chats, req.query.phone)) return res.sendStatus(404);
    res.json(chats[req.query.phone]);
  });
  app.post('/whatsapp/api/send', express.json({ limit: '16kb' }), async (req, res) => {
    const { phone, text, tap } = req.body ?? {};
    if (req.headers.origin !== origin || !Object.hasOwn(chats, phone)) return res.sendStatus(400);
    try {
      if (tap && typeof tap.id === 'string' && typeof tap.title === 'string') {
        chats[phone].push({ from: 'person', type: 'text', body: tap.title });
        await deliver(phone, {
          type: 'interactive',
          interactive: { button_reply: { id: tap.id, title: tap.title } },
        });
      } else if (typeof text === 'string' && text.trim() && text.length <= 4000) {
        chats[phone].push({ from: 'person', type: 'text', body: text });
        await deliver(phone, { type: 'text', text: { body: text } });
      } else return res.sendStatus(400);
      res.json(chats[phone]);
    } catch (err) {
      console.error('Preview turn failed:', err.message);
      res.status(503).json({ error: 'TURN_FAILED' });
    }
  });
  // The synthetic care dispatcher (at a daytime clock) and the outbound worker.
  app.post('/whatsapp/api/worker', async (req, res) => {
    if (req.headers.origin !== origin) return res.sendStatus(400);
    try {
      await rpc('care_dispatch_synthetic', {
        p_now: process.env.CARE_PREVIEW_CLOCK ?? new Date(Date.now() + 15 * 86400000).toISOString(),
      });
      const results = [];
      for (const number of Object.keys(PHONES))
        results.push(...(await outbound.dispatch({ transport: transportFor(number) })));
      res.json(results);
    } catch (err) {
      console.error('Preview worker failed:', err.message);
      res.status(503).json({ error: 'WORKER_FAILED' });
    }
  });
  app.get('/whatsapp/document/:n', (req, res) => {
    const doc = documents[Number(req.params.n)];
    if (!doc) return res.sendStatus(404);
    res.set('Content-Disposition', `inline; filename="${doc.filename}"`);
    res.type('application/pdf').send(doc.buffer);
  });

  server = app.listen(port, '127.0.0.1', () => {
    console.log(`Fictional WhatsApp: ${origin}/whatsapp`);
    console.log(`Care portal: ${origin}/care/  (patient@ / practitioner@example.invalid)`);
    console.log(`Evidence portal: ${origin}/evidence/  (owner@, analyst@, reviewer@, admin@)`);
    console.log('Password for every fictional account: synthetic-only');
    console.log('No Supabase Auth, Meta or model qualification is claimed. SQL is real.');
  });
  timer = setInterval(
    () => outbound.maintenance().catch(() => console.error('Channel maintenance failed')),
    60000,
  );
  timer.unref();
}

process.on('SIGINT', () => close().then(() => process.exit(0)));
process.on('SIGTERM', () => close().then(() => process.exit(0)));
main().catch(async err => {
  console.error(err.message);
  await close();
  process.exitCode = 1;
});

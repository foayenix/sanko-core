#!/usr/bin/env node
'use strict';
// Local synthetic preview. Creates/drops its OWN database; never uses the
// production Auth adapter, WhatsApp, public demo data, or an existing database.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const express = require('express');
const path = require('node:path');
const base = new URL(
  process.env.CARE_TEST_DB_URL || 'postgresql://postgres@127.0.0.1:5432/postgres',
);
if (process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost'].includes(base.hostname))
  throw new Error('Local synthetic preview only');
const name = `sanko_preview_${crypto.randomBytes(6).toString('hex')}`;
const target = new URL(base);
target.pathname = '/' + name;
execFileSync('psql', [base.href, '-X', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${name}`], {
  stdio: 'pipe',
});
const port = Number(process.env.CARE_PREVIEW_PORT || 3041);
Object.assign(process.env, {
  CARE_TEST_DB_URL: target.href,
  SUPABASE_DB_URL: target.href,
  CARE_PATIENT_ACCESS_ENABLED: 'true',
  CARE_ENCOUNTERS_ENABLED: 'true',
  CARE_SYNTHETIC_ONLY: 'true',
  CARE_WHATSAPP_HANDOFF_ENABLED: 'true',
  PATIENT_TRACKING_ENABLED: 'true',
  AGENT_TOOLS: 'full',
  CARE_ORIGIN: `http://127.0.0.1:${port}`,
  PORTAL_RATE_LIMIT_KEY: crypto.randomBytes(32).toString('hex'),
});
const { rpc, seed } = require('../tests/helpers/carePostgres');
const auth = require('../src/care/auth');
require('../src/care/store').rpc = rpc;
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
  const { ids } = await seed();
  const login = async (email, password) => {
    if (password !== 'synthetic-only') throw new Error('UNAUTHENTICATED');
    const actor =
      email === 'patient@example.invalid'
        ? ids.patient
        : email === 'practitioner@example.invalid'
          ? ids.practitioner
          : null;
    if (!actor) throw new Error('UNAUTHENTICATED');
    const token = auth.randomToken();
    const csrf = auth.randomToken();
    await rpc('care_open_session', {
      p_auth_user: actor,
      p_token: auth.hash(token),
      p_csrf: auth.hash(csrf),
    });
    return { token, csrf };
  };
  const app = express();
  app.use('/care', require('../src/care/routes').createRouter({ login }));
  // A loopback-only channel exercise. Only fixed fictional envelopes enter the
  // real care router; no Meta call, patient identity binding, or model is used.
  const channel = require('../src/care/channel');
  const commands = ['My care', 'My visits', 'Check-ins', 'Privacy', 'Care inbox'];
  const escape = value =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const channelPage = (reply = '') =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" ` +
    `content="width=device-width,initial-scale=1"><title>Sanko · Synthetic WhatsApp</title>` +
    `<link rel="stylesheet" href="/care/style.css"><script src="/whatsapp/app.js" defer>` +
    `</script></head><body><header><img src="/care/brand.svg" width="150" alt="Sanko"><span>` +
    `WhatsApp channel exercise</span></header><main><h1>Start with My care.</h1><p>Fictional ` +
    `messages only. This exercises the WhatsApp care navigation without sending through ` +
    `Meta. Sign in separately to use the care record.</p><form method="post" ` +
    `action="/whatsapp"><label>Message<select name="command">` +
    `${commands.map(command => `<option>${command}</option>`).join('')}</select></label>` +
    `<button class="primary">Send fictional message</button></form><section ` +
    `id="channel-reply" class="panel" aria-live="polite" >` +
    `${escape(reply).replaceAll('\n', '<br>')}</section><p><a id="care-link" href="/care/">` +
    `Open authenticated care workspace</a></p><p><a href="/care/#today">Open practitioner ` +
    `review inbox</a></p></main></body></html>`;
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
  app.get('/whatsapp/app.js', (_req, res) =>
    res.sendFile(path.join(__dirname, 'care-preview-channel.js')),
  );
  app.get('/whatsapp', (_req, res) => res.type('html').send(channelPage()));
  let envelopeTime = Math.floor(Date.now() / 1000);
  app.post('/whatsapp', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    if (req.headers.origin !== process.env.CARE_ORIGIN || !commands.includes(req.body.command))
      return res.sendStatus(400);
    try {
      const message = {
        id: crypto.randomUUID(),
        timestamp: String(++envelopeTime),
        type: 'text',
        text: { body: req.body.command.toLowerCase() },
      };
      const from = '+447700900099';
      const messages = [message];
      const replies = [];
      const transport = {
        sendTextMessage: async (_to, body) => replies.push(body),
        sendButtonMessage: async (_to, body) => replies.push(body),
      };
      const mode = await channel.resolve(from, messages, false);
      await channel.reply(mode, from, transport, messages);
      const destination = channel.navigation(messages);
      if (req.headers.accept === 'application/json')
        return res.json({
          reply: replies.join('\n\n'),
          href: '/care/' + (destination ? '#' + destination : ''),
        });
      res.type('html').send(channelPage(replies.join('\n\n')));
    } catch {
      res
        .status(503)
        .type('html')
        .send(channelPage('Could not complete this fictional message. Please retry.'));
    }
  });
  server = app.listen(port, '127.0.0.1', () => {
    console.log(`Synthetic preview: http://127.0.0.1:${port}/care/`);
    console.log(`WhatsApp entry exercise: http://127.0.0.1:${port}/whatsapp`);
    console.log(
      'Fixture accounts: patient@example.invalid / practitioner@example.invalid; password: ' +
        'synthetic-only',
    );
    console.log(
      'No Supabase Auth, Meta or model qualification is claimed. The API/SQL operations are real.',
    );
  });
  timer = setInterval(
    () =>
      rpc(
        'care_dispatch_synthetic',
        process.env.CARE_PREVIEW_CLOCK ? { p_now: process.env.CARE_PREVIEW_CLOCK } : {},
      ).catch(() => console.error('Synthetic dispatch failed')),
    2000,
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

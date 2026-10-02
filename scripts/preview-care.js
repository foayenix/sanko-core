#!/usr/bin/env node
'use strict';
// Local synthetic preview. Creates/drops its OWN database; never uses the
// production Auth adapter, WhatsApp, public demo data, or an existing database.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const express = require('express');
const base = new URL(process.env.CARE_TEST_DB_URL || 'postgresql://postgres@127.0.0.1:5432/postgres');
if (process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Local synthetic preview only');
const name = `sanko_preview_${crypto.randomBytes(6).toString('hex')}`;
const target = new URL(base); target.pathname = '/' + name;
execFileSync('psql', [base.href, '-X', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${name}`], { stdio: 'pipe' });
const port = Number(process.env.CARE_PREVIEW_PORT || 3041);
Object.assign(process.env, { CARE_TEST_DB_URL: target.href, SUPABASE_DB_URL: target.href,
  CARE_PATIENT_ACCESS_ENABLED: 'true', CARE_ENCOUNTERS_ENABLED: 'true', CARE_SYNTHETIC_ONLY: 'true',
  PATIENT_TRACKING_ENABLED: 'true', AGENT_TOOLS: 'full', CARE_ORIGIN: `http://127.0.0.1:${port}` });
const { rpc, seed } = require('../tests/helpers/carePostgres');
const auth = require('../src/care/auth');
require('../src/care/store').rpc = rpc;
let server;
let timer;
let closing = false;
async function close() {
  if (closing) return; closing = true; clearInterval(timer);
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  execFileSync('psql', [base.href, '-X', '-c', `drop database ${name} with (force)`], { stdio: 'pipe' });
}
async function main() {
  execFileSync(process.execPath, ['scripts/migrate.js'], { stdio: 'pipe', env: process.env });
  const { ids } = await seed();
  const login = async (email, password) => {
    if (password !== 'synthetic-only') throw new Error('UNAUTHENTICATED');
    const actor = email === 'patient@example.invalid' ? ids.patient : email === 'practitioner@example.invalid' ? ids.practitioner : null;
    if (!actor) throw new Error('UNAUTHENTICATED');
    const token = auth.randomToken(); const csrf = auth.randomToken();
    await rpc('care_open_session', { p_auth_user: actor, p_token: auth.hash(token), p_csrf: auth.hash(csrf) });
    return { token, csrf };
  };
  const app = express(); app.use('/care', require('../src/care/routes').createRouter({ login }));
  server = app.listen(port, '127.0.0.1', () => {
    console.log(`Synthetic preview: http://127.0.0.1:${port}/care/`);
    console.log('Fixture accounts: patient@example.invalid / practitioner@example.invalid; password: synthetic-only');
    console.log('No Supabase Auth, Meta or model qualification is claimed. The API/SQL operations are real.');
  });
  timer = setInterval(() => rpc('care_dispatch_synthetic', process.env.CARE_PREVIEW_CLOCK ? { p_now: process.env.CARE_PREVIEW_CLOCK } : {}).catch(() => console.error('Synthetic dispatch failed')), 2000);
  timer.unref();
}
process.on('SIGINT', () => close().then(() => process.exit(0)));
process.on('SIGTERM', () => close().then(() => process.exit(0)));
main().catch(async err => { console.error(err.message); await close(); process.exitCode = 1; });

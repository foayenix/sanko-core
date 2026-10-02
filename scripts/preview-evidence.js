#!/usr/bin/env node
'use strict';
// Local synthetic preview. Creates/drops its OWN database; never uses the
// production Auth adapter, WhatsApp, public demo data, or an existing database.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const express = require('express');
const base = new URL(
  process.env.EVIDENCE_TEST_DB_URL || 'postgresql://postgres@127.0.0.1:5432/postgres',
);
if (process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost'].includes(base.hostname))
  throw new Error('Local synthetic preview only');
const name = `sanko_evidence_preview_${crypto.randomBytes(6).toString('hex')}`;
const target = new URL(base);
target.pathname = '/' + name;
execFileSync('psql', [base.href, '-X', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${name}`], {
  stdio: 'pipe',
});
const port = Number(process.env.EVIDENCE_PREVIEW_PORT || 3042);
Object.assign(process.env, {
  EVIDENCE_TEST_DB_URL: target.href,
  SUPABASE_DB_URL: target.href,
  EVIDENCE_ENABLED: 'true',
  EVIDENCE_SYNTHETIC_ONLY: 'true',
  EVIDENCE_ORIGIN: `http://127.0.0.1:${port}`,
  PORTAL_RATE_LIMIT_KEY: crypto.randomBytes(32).toString('hex'),
});
const { rpc, seed } = require('../tests/helpers/evidencePostgres');
const auth = require('../src/evidence/auth');
require('../src/evidence/store').rpc = rpc;
let server;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
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
    const name = email.replace('@example.invalid', '');
    const actor =
      ['owner', 'other', 'analyst', 'reviewer', 'admin', 'release'].includes(name) &&
      email === name + '@example.invalid'
        ? ids[name]
        : null;
    if (!actor) throw new Error('UNAUTHENTICATED');
    const token = auth.randomToken();
    const csrf = auth.randomToken();
    await rpc('evidence_open_session', {
      p_auth_user: actor,
      p_token: auth.hash(token),
      p_csrf: auth.hash(csrf),
    });
    return { token, csrf };
  };
  const app = express();
  app.use('/evidence', require('../src/evidence/routes').createRouter({ login }));
  server = app.listen(port, '127.0.0.1', () => {
    console.log(`Synthetic preview: http://127.0.0.1:${port}/evidence/`);
    console.log(
      'Fixture accounts: owner, analyst, reviewer, admin, release @example.invalid; password: ' +
        'synthetic-only',
    );
    console.log(
      'No Supabase Auth, Meta or model qualification is claimed. The API/SQL operations are real.',
    );
  });
}
process.on('SIGINT', () => close().then(() => process.exit(0)));
process.on('SIGTERM', () => close().then(() => process.exit(0)));
main().catch(async err => {
  console.error(err.message);
  await close();
  process.exitCode = 1;
});

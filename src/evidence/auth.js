'use strict';

// Evidence portal sign-in. The reviewed principal binding lives in
// evidence_principals; see src/portal/auth.js for what Supabase Auth does and
// does not establish.

const { hash, randomToken, createAuth } = require('../portal/auth');
const store = require('./store');

const { login, sessionCookie } = createAuth({
  store,
  openSession: 'evidence_open_session',
  cookieName: 'sanko_evidence',
});

module.exports = { hash, randomToken, login, sessionCookie };

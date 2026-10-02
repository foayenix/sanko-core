'use strict';

// Care portal sign-in. The reviewed principal binding lives in care_actors;
// see src/portal/auth.js for what Supabase Auth does and does not establish.

const { hash, randomToken, createAuth } = require('../portal/auth');
const store = require('./store');

const { login, sessionCookie } = createAuth({
  store,
  openSession: 'care_open_session',
  cookieName: 'sanko_care',
});

module.exports = { hash, randomToken, login, sessionCookie };

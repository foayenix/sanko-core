'use strict';

// Sign-in and session cookies shared by the /care and /evidence portals.
//
// Supabase Auth verifies the individual. It does not decide what they can see:
// each portal still requires an explicit, reviewed principal binding in its own
// tables, so a phone number, email, role or patient code alone cannot provision
// a membership or claim a historical record.
//
// The browser receives two random tokens: a session token in an HttpOnly
// cookie and a CSRF token it must echo in a header. Only their SHA-256 hashes
// reach the database, so a leaked table does not yield usable sessions.

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

// 32 random bytes encode to exactly 43 base64url characters.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// `store` is read at call time, not captured, so a test or preview script that
// replaces `store.rpc` after this module loads is still honoured.
function createAuth({ store, openSession, cookieName }) {
  async function login(email, password) {
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user?.id) throw new Error('UNAUTHENTICATED');
    const token = randomToken();
    const csrf = randomToken();
    try {
      await store.rpc(openSession, {
        p_auth_user: data.user.id,
        p_token: hash(token),
        p_csrf: hash(csrf),
      });
    } finally {
      // Provider tokens are not sent to the browser or persisted by this service.
      await client.auth.signOut({ scope: 'local' });
    }
    return { token, csrf };
  }

  function sessionCookie(req) {
    const prefix = `${cookieName}=`;
    const value = (req.headers.cookie ?? '')
      .split(';')
      .map(v => v.trim())
      .find(v => v.startsWith(prefix))
      ?.slice(prefix.length);
    if (!value || !TOKEN.test(value)) throw new Error('UNAUTHENTICATED');
    return value;
  }

  return { login, sessionCookie };
}

module.exports = { hash, randomToken, createAuth, TOKEN };

'use strict';
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const store = require('./store');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
// Supabase Auth verifies the individual. An explicit, reviewed principal binding
// is still required in evidence_principals; phone, email, role and patient codes cannot
// provision a practitioner membership or claim a historical patient record.
async function login(email, password) {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user?.id) throw new Error('UNAUTHENTICATED');
  const token = randomToken();
  const csrf = randomToken();
  try {
    await store.rpc('evidence_open_session', { p_auth_user: data.user.id, p_token: hash(token), p_csrf: hash(csrf) });
  } finally {
    // Provider tokens are not sent to the browser or persisted by this service.
    await client.auth.signOut({ scope: 'local' });
  }
  return { token, csrf };
}
function sessionCookie(req) {
  const value = (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith('sanko_evidence='))?.slice(15);
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('UNAUTHENTICATED');
  return value;
}
module.exports = { hash, randomToken, login, sessionCookie };

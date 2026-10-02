'use strict';

// Rate limiting for the /care and /evidence portals, shared by every server
// process. The counters live in PostgreSQL (supabase/025_portal_rate_limits.sql)
// so running several instances, or restarting one, does not multiply or reset
// anyone's allowance.
//
// Clients are identified by an HMAC-SHA256 of their IP address under
// PORTAL_RATE_LIMIT_KEY, a secret the database never sees. A plain hash would
// not do: there are only 2^32 IPv4 addresses, so anyone holding the table could
// reverse it by trying them all. No IP address is stored.

const crypto = require('node:crypto');

const WINDOW_SECONDS = 60;
const LIMITS = { login: 10, action: 120 };
// 32 bytes of hex or base64 is comfortably over this; anything shorter is
// probably a placeholder.
const MIN_KEY_LENGTH = 32;

function clientKey(ip, secret) {
  return crypto.createHmac('sha256', secret).update(String(ip ?? '')).digest('hex');
}

// `store` is read at call time so tests and previews can substitute its rpc.
function createRateLimiter({ store, portal }) {
  // Resolves true when this request is within the limit for `scope` ('login'
  // or 'action'). Throws when the key is missing or the database cannot be
  // reached; the router then refuses the request rather than leaving the portal
  // unlimited.
  return async function allow(ip, scope) {
    const secret = process.env.PORTAL_RATE_LIMIT_KEY;
    if (!secret || secret.length < MIN_KEY_LENGTH) throw new Error('RATE_LIMIT_KEY_REQUIRED');
    const result = await store.rpc('portal_rate_limit', {
      p_bucket: `${portal}:${scope}:${clientKey(ip, secret)}`,
      p_limit: LIMITS[scope],
      p_window_seconds: WINDOW_SECONDS,
    });
    return result?.allowed === true;
  };
}

module.exports = { createRateLimiter, clientKey, LIMITS, WINDOW_SECONDS, MIN_KEY_LENGTH };

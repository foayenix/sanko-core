// HTTP Basic Auth middleware, shared by /admin and /simulator.
//
// Credentials are checked against the allowlisted operator accounts in
// adminAccounts.js, which also supplies the pseudonymous reference every write
// from the control room is attributed to. On success the operator is attached to
// the request as `req.operator` — that, not the request body, is where a
// reviewer reference comes from.

const crypto = require('crypto');
const log = require('./log');
const adminAccounts = require('./adminAccounts');

// Constant-time string comparison so the password check doesn't leak length/prefix timing
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab); // burn comparable time before rejecting
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function challenge(res, realm) {
  res.set('WWW-Authenticate', `Basic realm="${realm}"`);
  return res.status(401).send('Unauthorised');
}

function requireAuth(realm = 'Sanko Vault') {
  return function (req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) return challenge(res, realm);

    // Split on the FIRST colon only — passwords may contain colons
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const sep = decoded.indexOf(':');
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? '' : decoded.slice(sep + 1);

    if (!adminAccounts.configured()) {
      log.error('auth.not_configured', { realm, effect: 'protected route returns 503' });
      return res.status(503).send('Not configured.');
    }

    const operator = adminAccounts.authenticate(user, pass);
    if (!operator) return challenge(res, realm);

    // Downstream handlers read the reviewer reference from here and never from
    // the request body: an attribution the caller can type is not an attribution.
    req.operator = operator;
    next();
  };
}

module.exports = { requireAuth, safeEqual };

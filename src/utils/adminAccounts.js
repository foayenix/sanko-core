'use strict';

// Allowlisted operator accounts, and the reason they exist.
//
// Until now /admin had one shared password and every reviewer reference was
// typed into a form. That is fine with exactly one operator and unfalsifiable
// with two: a correction, a plant confirmation and a promotion registry entry
// all claim to be attributed, and none of them could be traced to a person.
// Everything downstream — provenance, the Nagoya argument, "who confirmed this
// mapping" — rests on that attribution being real rather than typed.
//
// So the reviewer reference now comes from whoever authenticated, and is not
// accepted from the request body at all.
//
// ── configuration ──
// ADMIN_ACCOUNTS is a semicolon-separated list of:
//
//   username:REF:scrypt$<saltHex>$<hashHex>
//
// Generate an entry with:
//
//   npm run admin:account -- felix OP-4C21
//
// Passwords are stored as scrypt hashes, so the env file (and anything that
// reads it) never holds a usable password. scrypt is in Node's standard library:
// no dependency, and deliberately slow to brute-force.

const crypto = require('crypto');
const { env } = require('./env');
const log = require('./log');

// A pseudonymous reference, held to the same rule as an eval reviewer: never a
// name, phone number, email or account id.
const REF = /^[A-Z]{2,4}-[A-Z0-9]{4,8}$/;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, saltHex = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT.keylen, SCRYPT).toString('hex');
  return `scrypt$${saltHex}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, expected] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !expected) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT.keylen, SCRYPT).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Parsed on every call rather than cached at require time, so a test — or an
// operator editing .env — does not need a restart to take effect.
function accounts() {
  const raw = env('ADMIN_ACCOUNTS');
  if (!raw) return [];

  const parsed = [];
  for (const entry of raw.split(';').map(part => part.trim()).filter(Boolean)) {
    // Split from the left twice only: the hash itself contains '$', not ':'.
    const first = entry.indexOf(':');
    const second = entry.indexOf(':', first + 1);
    if (first === -1 || second === -1) {
      log.warn('auth.account_malformed', { reason: 'expected username:REF:hash' });
      continue;
    }
    const username = entry.slice(0, first);
    const ref = entry.slice(first + 1, second);
    const secret = entry.slice(second + 1);

    if (!REF.test(ref)) {
      log.warn('auth.account_rejected', { username, reason: 'reference is not a pseudonym like OP-4C21' });
      continue;
    }
    parsed.push({ username, ref, secret });
  }
  return parsed;
}

// Returns { username, ref, legacy } or null.
//
// The legacy single-password path is kept so applying this does not lock the one
// current operator out of their own control room, but it is reported on every
// use: an operator whose actions are attributed to "the password" is exactly the
// state this module exists to end.
function authenticate(username, password) {
  for (const account of accounts()) {
    if (account.username !== username) continue;
    if (!verifyPassword(password, account.secret)) return null;
    return { username, ref: account.ref, legacy: false };
  }

  const legacyPassword = env('ADMIN_PASSWORD');
  if (legacyPassword && username === 'felix') {
    const a = Buffer.from(password);
    const b = Buffer.from(legacyPassword);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      log.warn('auth.legacy_password_used', {
        effect: 'actions are attributed to a shared password, not to a person',
        fix: 'set ADMIN_ACCOUNTS — npm run admin:account -- <username> <REF>',
      });
      return { username, ref: env('ADMIN_LEGACY_REF', 'OP-LEGACY'), legacy: true };
    }
  }
  return null;
}

function configured() {
  return accounts().length > 0 || Boolean(env('ADMIN_PASSWORD'));
}

module.exports = { authenticate, accounts, hashPassword, verifyPassword, configured, REF };

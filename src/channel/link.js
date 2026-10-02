'use strict';

// Single-use link codes. A signed-in portal principal asks for one; the person
// sends it from WhatsApp as "LINK ABCD-2345"; only its SHA-256 reaches the
// database. Eight characters from a 32-symbol alphabet (no 0/O, 1/I) give 40
// bits; codes expire after ten minutes, and a contact is locked out for an
// hour after five failures. Whether this is sufficient assurance for real
// patients is an open security decision (docs/WHATSAPP_CHANNEL_IMPLEMENTATION.md).

const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return {
    code,
    display: `${code.slice(0, 4)}-${code.slice(4)}`,
    hash: crypto.createHash('sha256').update(code).digest('hex'),
  };
}

// Issues a code through the portal's own link-code function, which checks the
// browser session and CSRF value itself.
async function issue(store, fn, tokenHash, csrfHash) {
  const { display, hash } = newCode();
  const result = await store.rpc(fn, { p_token: tokenHash, p_csrf: csrfHash, p_code_hash: hash });
  return {
    code: display,
    expires_at: result.expires_at,
    instructions: `Send this from the WhatsApp number you want to use: LINK ${display}`,
  };
}

module.exports = { newCode, issue, ALPHABET };

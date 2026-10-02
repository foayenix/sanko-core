'use strict';

// Feature flags for the formulation evidence workspace (/evidence). Off by
// default. configuration() runs at startup from src/index.js and on every
// request, and throws on any combination this code cannot honour.

// Capabilities described in the plan but deliberately not built in this stage
// (see docs/EVIDENCE_IMPLEMENTATION.md). Enabling one is refused.
const LATER = [
  'LIVE_PILOT',
  'AI',
  'EXTERNAL_SEARCH',
  'NOTIFICATIONS',
  'EXTERNAL_SHARING',
  'PRODUCT_LEAFLETS',
  'REGULATORY_REPORTS',
  'OUTCOME_LINKING',
];
function configuration(env = process.env) {
  if (LATER.some(name => env[`EVIDENCE_${name}_ENABLED`] === 'true'))
    throw new Error('UNSUPPORTED_EVIDENCE_CAPABILITY');
  const enabled = env.EVIDENCE_ENABLED === 'true';
  if (enabled && env.EVIDENCE_SYNTHETIC_ONLY !== 'true')
    throw new Error('LIVE_EVIDENCE_NOT_QUALIFIED');
  // The portal needs one exact origin for its CSRF check: HTTPS, or a loopback
  // host outside production for local previews.
  if (enabled) {
    let origin;
    try {
      origin = new URL(env.EVIDENCE_ORIGIN);
    } catch {
      throw new Error('EVIDENCE_ORIGIN_REQUIRED');
    }
    if (
      origin.origin !== env.EVIDENCE_ORIGIN ||
      (origin.protocol !== 'https:' &&
        !(env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost'].includes(origin.hostname)))
    )
      throw new Error('EVIDENCE_ORIGIN_REQUIRED');
  }
  return { enabled };
}
module.exports = { configuration };

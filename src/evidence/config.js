'use strict';
const LATER = ['LIVE_PILOT', 'AI', 'EXTERNAL_SEARCH', 'NOTIFICATIONS', 'EXTERNAL_SHARING', 'PRODUCT_LEAFLETS', 'REGULATORY_REPORTS', 'OUTCOME_LINKING'];
function configuration(env = process.env) {
  if (LATER.some(name => env[`EVIDENCE_${name}_ENABLED`] === 'true')) throw new Error('UNSUPPORTED_EVIDENCE_CAPABILITY');
  const enabled = env.EVIDENCE_ENABLED === 'true';
  if (enabled && env.EVIDENCE_SYNTHETIC_ONLY !== 'true') throw new Error('LIVE_EVIDENCE_NOT_QUALIFIED');
  if (enabled) {
    let origin;
    try { origin = new URL(env.EVIDENCE_ORIGIN); } catch { throw new Error('EVIDENCE_ORIGIN_REQUIRED'); }
    if (origin.origin !== env.EVIDENCE_ORIGIN || (origin.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost'].includes(origin.hostname)))) throw new Error('EVIDENCE_ORIGIN_REQUIRED');
  }
  return { enabled };
}
module.exports = { configuration };

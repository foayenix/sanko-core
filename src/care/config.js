'use strict';
const FUTURE = ['CARE_BOOKING_ENABLED', 'CARE_CAREGIVERS_ENABLED', 'CARE_SHARING_ENABLED', 'CARE_REFERRALS_ENABLED', 'CARE_MEDICATION_REVIEW_ENABLED', 'CARE_INTERACTIONS_ENABLED'];
function configuration(env = process.env) {
  const access = env.CARE_PATIENT_ACCESS_ENABLED === 'true';
  const encounters = env.CARE_ENCOUNTERS_ENABLED === 'true';
  if (FUTURE.some(key => env[key] === 'true')) throw new Error('UNSUPPORTED_CARE_CAPABILITY');
  if (access && (env.PATIENT_TRACKING_ENABLED !== 'true' || env.AGENT_TOOLS !== 'full')) throw new Error('CARE_REQUIRES_PATIENT_TRACKING');
  if (encounters && !access) throw new Error('ENCOUNTERS_REQUIRE_PATIENT_ACCESS');
  // This implementation cannot activate real patients or outbound reminders.
  if (access && env.CARE_SYNTHETIC_ONLY !== 'true') throw new Error('LIVE_CARE_NOT_QUALIFIED');
  if (env.CARE_WHATSAPP_HANDOFF_ENABLED === 'true') {
    if (!access) throw new Error('CARE_HANDOFF_REQUIRES_PATIENT_ACCESS');
    portalOrigin(env);
  }
  return { access, encounters };
}
function portalOrigin(env = process.env) {
  let url;
  try { url = new URL(env.CARE_ORIGIN); } catch { throw new Error('INVALID_CARE_ORIGIN'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== env.CARE_ORIGIN || url.username || url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && env.NODE_ENV !== 'production'))) {
    throw new Error('INVALID_CARE_ORIGIN');
  }
  return url.origin;
}
function handoffEnabled(env = process.env) {
  return configuration(env).access && env.CARE_WHATSAPP_HANDOFF_ENABLED === 'true';
}
module.exports = { configuration, portalOrigin, handoffEnabled };

'use strict';
const FUTURE = ['CARE_BOOKING_ENABLED', 'CARE_CAREGIVERS_ENABLED', 'CARE_SHARING_ENABLED', 'CARE_REFERRALS_ENABLED', 'CARE_MEDICATION_REVIEW_ENABLED', 'CARE_INTERACTIONS_ENABLED'];
function configuration(env = process.env) {
  const access = env.CARE_PATIENT_ACCESS_ENABLED === 'true';
  const encounters = env.CARE_ENCOUNTERS_ENABLED === 'true';
  if (FUTURE.some(key => env[key] === 'true')) throw new Error('UNSUPPORTED_CARE_CAPABILITY');
  if (access && (env.PATIENT_TRACKING_ENABLED !== 'true' || env.AGENT_TOOLS !== 'full')) throw new Error('CARE_REQUIRES_PATIENT_TRACKING');
  if (encounters && !access) throw new Error('ENCOUNTERS_REQUIRE_PATIENT_ACCESS');
  // This implementation cannot activate real patients or an outbound transport.
  if (access && env.CARE_SYNTHETIC_ONLY !== 'true') throw new Error('LIVE_CARE_NOT_QUALIFIED');
  return { access, encounters };
}
module.exports = { configuration };

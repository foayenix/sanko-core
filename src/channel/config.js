'use strict';

// Feature gates for completing care and evidence work inside WhatsApp.
//
// Separate gates for the guided-flow foundation, care actions, care check-in
// notices, evidence owner actions and evidence document delivery. All default
// off. configuration() runs at startup and on every turn and throws on any
// combination this code cannot honour, so a misconfiguration stops the
// feature rather than half-enabling it.
//
// Every channel gate requires CHANNEL_SYNTHETIC_ONLY=true. The identity,
// session-assurance, language, retention and Meta qualification decisions a
// live release needs have not been made (docs/WHATSAPP_CHANNEL_IMPLEMENTATION.md),
// so there is deliberately no live path to switch on.

const care = require('../care/config');
const evidence = require('../evidence/config');

const DEFAULT_SESSION_MINUTES = 720;

function configuration(env = process.env) {
  const guided = env.CHANNEL_GUIDED_ENABLED === 'true';
  const careActions = env.CARE_CHANNEL_ACTIONS_ENABLED === 'true';
  const careNotices = env.CARE_CHANNEL_NOTIFICATIONS_ENABLED === 'true';
  const evidenceActions = env.EVIDENCE_CHANNEL_ACTIONS_ENABLED === 'true';
  const evidenceDelivery = env.EVIDENCE_CHANNEL_DELIVERY_ENABLED === 'true';
  if ((careActions || careNotices || evidenceActions || evidenceDelivery) && !guided)
    throw new Error('CHANNEL_REQUIRES_GUIDED_FLOWS');
  if (guided && env.CHANNEL_SYNTHETIC_ONLY !== 'true')
    throw new Error('LIVE_CHANNEL_NOT_QUALIFIED');
  if (careActions) {
    const flags = care.configuration(env);
    if (!flags.access || !flags.encounters) throw new Error('CARE_CHANNEL_REQUIRES_CARE');
  }
  if (careNotices && !careActions) throw new Error('CARE_NOTICES_REQUIRE_CARE_CHANNEL');
  if (evidenceActions && !evidence.configuration(env).enabled)
    throw new Error('EVIDENCE_CHANNEL_REQUIRES_EVIDENCE');
  if (evidenceDelivery && !evidenceActions)
    throw new Error('EVIDENCE_DELIVERY_REQUIRES_EVIDENCE_CHANNEL');
  const minutes = Number(env.CHANNEL_SESSION_MINUTES ?? DEFAULT_SESSION_MINUTES);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 4320)
    throw new Error('INVALID_CHANNEL_SESSION_MINUTES');
  return {
    guided,
    careActions,
    careNotices,
    evidenceActions,
    evidenceDelivery,
    sessionMinutes: minutes,
  };
}

// Safe for hot paths that must not fail closed on an unrelated misconfiguration
// (the Vault agent keeps working when only a channel flag is wrong).
function enabled(env = process.env) {
  try {
    return configuration(env).guided;
  } catch {
    return false;
  }
}

module.exports = { configuration, enabled, DEFAULT_SESSION_MINUTES };

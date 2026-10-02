'use strict';

// The evidence actions the WhatsApp Vault agent may take for a practitioner
// (start_evidence_request, get_evidence_request and list_evidence_reports in
// src/agent/tools.js). They can draft a request and read owner-safe status
// only; confirming a recipe and reading reports happen in the signed-in portal,
// whose address is returned with every result.
//
// Errors are returned, not thrown, so the agent can relay them. The inbound
// message key makes a retried WhatsApp turn idempotent.

const { configuration } = require('./config');
const store = require('./store');
async function act(action, data, { practitioner, inboundMessageKey }) {
  if (!configuration().enabled) return { ok: false, error: 'Evidence review is unavailable.' };
  if (!practitioner?.id) return { ok: false, error: 'Evidence review is unavailable.' };
  try {
    const result = await store.rpc('evidence_vault_action', {
      p_owner: practitioner.id,
      p_action: action,
      p_data: data,
      p_message: inboundMessageKey ?? null,
    });
    return { ok: true, result, portal: process.env.EVIDENCE_ORIGIN + '/evidence/' };
  } catch {
    return { ok: false, error: 'Evidence request unavailable. Use your verified private portal.' };
  }
}
module.exports = { act };

// Practitioner resolution, shared by every transport (WhatsApp webhook and the
// /simulator page).
//
// Under the old flow machine an unknown number stayed unknown until it picked a
// language. The agent needs a row to hang its conversation history on from the
// very first message, so the record is created immediately with just the phone
// number — the agent then fills in name and language via the set_profile tool.

const db = require('../services/supabase');

// Returns { practitioner, isNew }. isNew is true only on the message that
// created the row, which is what gates the one-time privacy disclosure.
async function getOrCreatePractitioner(phoneNumber) {
  const existing = await db.getPractitioner(phoneNumber);
  if (existing) return { practitioner: existing, isNew: false };

  try {
    const created = await db.createPractitioner({
      phone_number: phoneNumber,
      display_name: null,
      // Null, not 'en'. This column is Whisper's decoding language, and Whisper
      // forces rather than hints — defaulting it to English silently decoded every
      // Yoruba voice note as English. The agent sets it via set_profile once the
      // practitioner has actually said what they speak.
      preferred_language: null,
    });
    await db.logEvent({
      practitioner_id: created.id,
      event_type: 'first_contact',
      payload: { phone_number: phoneNumber },
    });
    return { practitioner: created, isNew: true };
  } catch (err) {
    // Two webhooks for the same new number can race on the unique phone index —
    // whichever loses re-reads the winner's row.
    const raced = await db.getPractitioner(phoneNumber);
    if (raced) return { practitioner: raced, isNew: false };
    throw new Error(`Could not create or retrieve practitioner for ${phoneNumber}`, { cause: err });
  }
}

// PRD §7 / G3 — shown once, on the message that creates the record.
const PRIVACY_NOTICE =
  'Your formulation Vault is private to you and scoped to your account. Patient tracking is off unless an independently reviewed deployment enables it.\n\n' +
  'The Sanko operator (Felix) may access records for technical support; access is audited. ' +
  'You can ask Sanko to export or permanently delete your account. ' +
  'Full details: sanko.africa/privacy';

module.exports = { getOrCreatePractitioner, PRIVACY_NOTICE };

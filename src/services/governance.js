'use strict';

// Contributor terms and the knowledge-use ledger (013).
//
// The rule this module exists to enforce, in one sentence: knowledge cannot be
// used beyond a practitioner's own Vault unless that practitioner agreed to
// terms, and the use has to be written down with what they were owed.
//
// It is enforced here rather than described in a policy because a policy is not
// a control. recordKnowledgeUse() refuses to include a practitioner who has not
// accepted, and says which — so the failure mode is a blocked export with a
// clear reason, not an export that quietly included someone who never agreed.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('./supabase');
const log = require('../utils/log');

const TERMS_DIR = path.join(__dirname, '../../governance');
const CURRENT_VERSION = 'v1-draft';

const USE_TYPES = ['research_access', 'licence', 'publication', 'dataset_export', 'demonstration'];
const OPERATOR_REF = /^[A-Z]{2,4}-[A-Z0-9]{4,8}$/;

let _terms;

// The text and its hash. A practitioner's acceptance is recorded against the
// hash, so editing the file cannot retroactively change what they agreed to —
// it produces an acceptance that no longer matches, which is the point.
function currentTerms() {
  if (!_terms) {
    const base = path.join(TERMS_DIR, `contributor-terms-${CURRENT_VERSION.replace('-draft', '')}`);
    const text = fs.readFileSync(`${base}.md`, 'utf8');
    // What a practitioner is actually shown in a chat window. It is hashed with
    // the full text rather than beside it, so a summary that stops matching the
    // terms it summarises produces a version nobody has accepted — which is the
    // same protection the full text already has.
    const summary = fs.readFileSync(`${base}.summary.txt`, 'utf8').split('\n---\n').pop().trim();
    _terms = {
      version: CURRENT_VERSION,
      hash: crypto.createHash('sha256').update(text).update(summary).digest('hex').slice(0, 16),
      text,
      summary,
    };
  }
  // Read live rather than cached: in_force is an operator decision, and a value
  // frozen at first call would report the state the process started in.
  //
  // False until a lawyer and the practitioners themselves have been through the
  // text. While it is false the registration conversation does not mention terms
  // at all — an unreviewed draft must not be put to someone as something to
  // agree to. The env var exists so that turning it on is a deliberate act with
  // a date on it, rather than an edit to this file.
  return { ..._terms, in_force: process.env.CONTRIBUTOR_TERMS_IN_FORCE === 'true' };
}

// Acceptance is refused outright while the terms are not in force. Without this
// the mechanism is one stray tool call away from recording an agreement to a
// draft that says, in its own first line, that it must not be presented as one.
function assertInForce() {
  const terms = currentTerms();
  if (!terms.in_force) {
    throw new Error(
      `Contributor terms ${terms.version} are not in force: they have had no legal review and no ` +
      'practitioner consultation, so an acceptance of them would not mean anything. ' +
      'Set CONTRIBUTOR_TERMS_IN_FORCE=true only once both have happened.'
    );
  }
  return terms;
}

async function recordAcceptance({ practitioner_id, method = 'whatsapp_reply' }) {
  const terms = assertInForce();
  await db.updatePractitioner(practitioner_id, {
    contributor_terms_version: terms.version,
    contributor_terms_accepted_at: new Date().toISOString(),
    contributor_terms_method: method,
    contributor_terms_hash: terms.hash,
  });
  await db.logEvent({
    practitioner_id,
    event_type: 'contributor_terms_accepted',
    payload: { version: terms.version, hash: terms.hash, method },
  });
  return terms;
}

// A practitioner is eligible for a knowledge use only if their acceptance is
// present AND matches the terms text as it stands now. A changed hash means the
// terms moved after they agreed — which is a re-consent, not a technicality.
function eligibility(practitioner) {
  const terms = currentTerms();
  if (!practitioner.contributor_terms_accepted_at) {
    return { eligible: false, reason: 'has not accepted any contributor terms' };
  }
  if (practitioner.contributor_terms_hash !== terms.hash) {
    return {
      eligible: false,
      reason: `accepted ${practitioner.contributor_terms_version ?? 'an unknown version'}, which is not the current text — they must be asked again`,
    };
  }
  return { eligible: true, reason: null, version: practitioner.contributor_terms_version };
}

// Splits a set of records into the ones that may leave the practitioner's Vault
// and the ones that may not.
//
// A training export is a use beyond the Vault — the same category as a research
// extract or a licence, and the reason USE_TYPES carries `dataset_export`. It
// was the one such use that went through no check at all, so a practitioner who
// never accepted the terms, or accepted a version that has since changed, had
// their corrections trained on anyway. The eligibility rule is the one already
// applied to knowledge uses; this only puts the export behind it.
//
// records: [{ practitioner_id, ... }] — anything with that field.
// Returns { eligible, excluded, contributors, reasons } where `reasons` maps a
// practitioner id to why they were left out, so a caller can say which and not
// merely how many.
async function partitionByConsent(records, { practitionerIdOf = row => row.practitioner_id } = {}) {
  const byPractitioner = new Map();
  const unattributed = [];

  for (const record of records) {
    const id = practitionerIdOf(record);
    // A record whose practitioner cannot be identified cannot be consented to
    // by anyone. It is excluded rather than waved through: "we could not tell
    // whose this was" is not a permission.
    if (!id) { unattributed.push(record); continue; }
    if (!byPractitioner.has(id)) byPractitioner.set(id, []);
    byPractitioner.get(id).push(record);
  }

  const eligible = [];
  const excluded = [...unattributed];
  const contributors = [];
  const reasons = new Map();

  for (const [practitioner_id, rows] of byPractitioner) {
    const practitioner = await db.getPractitionerById(practitioner_id);
    const verdict = practitioner
      ? eligibility(practitioner)
      : { eligible: false, reason: 'no such practitioner' };

    if (verdict.eligible) {
      eligible.push(...rows);
      contributors.push({ practitioner_id, record_count: rows.length, terms_version: verdict.version });
    } else {
      excluded.push(...rows);
      reasons.set(practitioner_id, verdict.reason);
    }
  }

  if (unattributed.length) {
    reasons.set(null, `${unattributed.length} record(s) carry no practitioner id and cannot be attributed to an agreement`);
  }

  return { eligible, excluded, contributors, reasons };
}

// Records a use of contributed knowledge, or refuses.
//
// contributors: [{ practitioner_id, record_count }]
async function recordKnowledgeUse({ use_type, counterparty, purpose, scope = {}, benefit_terms = null, agreed_at = null, recorded_by, contributors = [] }) {
  if (!USE_TYPES.includes(use_type)) {
    throw new Error(`use_type must be one of ${USE_TYPES.join(', ')}`);
  }
  if (!OPERATOR_REF.test(String(recorded_by ?? ''))) {
    throw new Error('recorded_by must be a pseudonymous operator reference such as OP-4C21.');
  }
  if (!counterparty?.trim() || !purpose?.trim()) {
    throw new Error('counterparty and purpose are required — a use nobody can identify later is not a record of anything.');
  }
  if (!contributors.length) {
    throw new Error('A knowledge use with no contributors is not a knowledge use.');
  }
  if (!benefit_terms?.trim()) {
    // The single most skippable field, and the one the whole argument rests on.
    throw new Error(
      'benefit_terms is required. If nothing has been agreed yet, this use is not ready to be recorded — ' +
      'say so explicitly ("none agreed; pending negotiation") only if that is genuinely the position.'
    );
  }

  // Check every contributor before writing anything, so a refusal names all of
  // them rather than stopping at the first.
  const checked = [];
  const ineligible = [];
  for (const entry of contributors) {
    const practitioner = await db.getPractitionerById(entry.practitioner_id);
    if (!practitioner) {
      ineligible.push({ practitioner_id: entry.practitioner_id, reason: 'no such practitioner' });
      continue;
    }
    const verdict = eligibility(practitioner);
    if (!verdict.eligible) {
      ineligible.push({ practitioner_id: entry.practitioner_id, reason: verdict.reason });
      continue;
    }
    checked.push({ ...entry, terms_version: verdict.version });
  }

  if (ineligible.length) {
    const detail = ineligible.map(row => `  ${row.practitioner_id}: ${row.reason}`).join('\n');
    throw new Error(
      `${ineligible.length} of ${contributors.length} contributor(s) cannot be included in a knowledge use:\n\n${detail}\n\n` +
      'Ask them, or exclude their records from the scope. Their knowledge cannot be used on the basis of an agreement they did not make.'
    );
  }

  const use = await db.createKnowledgeUse({ use_type, counterparty, purpose, scope, benefit_terms, agreed_at, recorded_by });
  await db.addKnowledgeUseContributors(use.id, checked);

  log.info('governance.knowledge_use_recorded', {
    use_id: use.id,
    use_type,
    contributors: checked.length,
    recorded_by,
  });
  return { ...use, contributors: checked };
}

// What has been done with one practitioner's knowledge. The answer a
// practitioner is entitled to, and the reason the ledger exists.
async function contributorStatement(practitioner_id) {
  const uses = await db.listKnowledgeUsesForPractitioner(practitioner_id);
  return {
    practitioner_id,
    uses: uses.map(row => ({
      use_type: row.knowledge_use?.use_type,
      counterparty: row.knowledge_use?.counterparty,
      purpose: row.knowledge_use?.purpose,
      benefit_terms: row.knowledge_use?.benefit_terms,
      agreed_at: row.knowledge_use?.agreed_at,
      recorded_at: row.knowledge_use?.created_at,
      records_included: row.record_count,
      terms_version: row.terms_version,
    })),
  };
}

module.exports = {
  currentTerms,
  assertInForce,
  recordAcceptance,
  eligibility,
  partitionByConsent,
  recordKnowledgeUse,
  contributorStatement,
  USE_TYPES,
  CURRENT_VERSION,
};

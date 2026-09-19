#!/usr/bin/env node
'use strict';

// The consent gate every training export runs through.
//
// Shared by export-training-data.js and export-vision-data.js so that the rule,
// the refusal text and the ledger entry are the same one thing in both. They
// used to have none of it: both read corrections straight out of the database
// and wrote them to a fine-tuning set, which meant a practitioner who never
// accepted the contributor terms — nobody has, the terms are still a draft —
// had their corrections trained on regardless. The governance module already
// refused that for research access and licensing; the export was simply not
// wired to it.
//
// Two things have to be true for a record to leave the Vault, and this enforces
// both:
//
//   1. its practitioner accepted the contributor terms as they stand now, and
//   2. the use is written into the knowledge-use ledger with what they are owed.
//
// While the terms are not in force nobody can satisfy (1), so an export refuses
// and says so. That is the correct outcome, not a bug to route around: material
// nobody agreed to contribute is material that cannot be used.

const governance = require('../src/services/governance');

// Ledger fields an export has to carry. They are the same fields any other
// knowledge use records, because a training set is not a lesser use of the
// material than a licence is.
const USE_FLAGS = ['recorded-by', 'counterparty', 'purpose', 'benefit-terms'];

function flag(args, name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1] ?? null;
}

// Screens records against the contributor terms. Returns what may be exported,
// what may not, and a printable account of why.
async function screen(records, options = {}) {
  const { eligible, excluded, contributors, reasons } = await governance.partitionByConsent(records, options);
  return { eligible, excluded, contributors, reasons, report: reportLines(reasons, excluded.length) };
}

function reportLines(reasons, excludedCount) {
  if (!excludedCount) return [];
  const lines = [`Excluded ${excludedCount} record(s) whose practitioners have not agreed to contribute:`];
  for (const [practitioner_id, reason] of reasons) {
    lines.push(practitioner_id ? `  ${practitioner_id}: ${reason}` : `  ${reason}`);
  }
  return lines;
}

// The message shown when a run has records but none of them may be used. It
// names the terms and their state, because "0 examples" on its own reads like an
// empty database rather than a refusal.
function refusalText(total) {
  const terms = governance.currentTerms();
  return [
    ``,
    `Nothing may be exported: none of the ${total} correction(s) belong to a practitioner who has`,
    `accepted contributor terms ${terms.version} (hash ${terms.hash}).`,
    ``,
    terms.in_force
      ? `  Ask them, or narrow the export. Their knowledge cannot be used on an agreement they did not make.`
      : `  These terms are NOT IN FORCE — no legal review, no practitioner consultation — so no acceptance\n` +
        `  exists or can be recorded yet. Training on this material is blocked until that changes.`,
    ``,
    `  npm run governance:terms   shows who has accepted what.`,
    ``,
  ].join('\n');
}

// Refuses an export that cannot say who it is for and what the practitioners
// get. Called only once there is something eligible to export, so a blocked run
// reports the consent problem rather than a missing flag.
function requireUseDetails(args, { command }) {
  const details = {
    recorded_by: flag(args, 'recorded-by'),
    counterparty: flag(args, 'counterparty'),
    purpose: flag(args, 'purpose'),
    benefit_terms: flag(args, 'benefit-terms'),
  };
  const missing = USE_FLAGS.filter(name => !details[name.replace(/-/g, '_')]?.trim());
  if (missing.length) {
    throw new Error(
      `This export uses contributed knowledge, so it goes in the ledger. Missing: ${missing.map(n => `--${n}`).join(', ')}\n\n` +
      `  node scripts/${command} \\\n` +
      `    --recorded-by OP-4C21 \\\n` +
      `    --counterparty "Sanko — internal fine-tune" \\\n` +
      `    --purpose "LoRA adapter for formulation extraction" \\\n` +
      `    --benefit-terms "Improved extraction in their own language; no redistribution of the dataset"\n\n` +
      `recorded-by is a pseudonymous operator reference such as OP-4C21. benefit-terms is what the\n` +
      `contributing practitioners get; if nothing has been agreed, this export is not ready to run.`
    );
  }
  return details;
}

// Writes the ledger entry. Runs after the files exist, so a crash mid-write does
// not leave a record of a use that did not happen.
async function recordExport({ contributors, details, scope }) {
  return governance.recordKnowledgeUse({
    use_type: 'dataset_export',
    scope,
    ...details,
    contributors: contributors.map(({ practitioner_id, record_count }) => ({ practitioner_id, record_count })),
  });
}

module.exports = { screen, refusalText, requireUseDetails, recordExport, reportLines, flag };

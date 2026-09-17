'use strict';

// What "registered" means, in one place.
//
// The agent is a model and will occasionally decide that a warm rapport matters
// more than an unanswered question. That is fine for how it talks and not fine
// for whether a record enters the archive without a provenance, so the rule
// lives here as data and is enforced in the tool layer (see gate() and its use
// in tools.executeTool) rather than in the prompt. The prompt describes the
// conversation; this file decides what the conversation has to have produced.
//
// The bar is deliberately two questions:
//
//   a name    so Sanko can address them, and so a Vault has an owner in words.
//   a region  so a record has a place. The same local plant name means different
//             plants in different parts of Nigeria; a mapping with no location
//             is a mapping no reviewer can check, and checkable mappings are the
//             entire point of the archive.
//
// Years practising and tradition are asked in the same breath and required from
// nobody. They help a reviewer read a record; they do not decide whether it can
// be written. Contributor terms are not part of the gate at all — contribution
// is voluntary and reversible by design, so declining them costs a practitioner
// nothing but the ability to be included in a knowledge use.

const governance = require('../services/governance');

// Tools that work before registration is finished.
//
// Reads, export and deletion are here on purpose and should stay here: a person
// must always be able to see what Sanko holds about them, take it away, or erase
// it, whatever state their onboarding is in. Gating those behind a form would be
// exactly the pattern this product exists to argue against.
const OPEN_BEFORE_REGISTRATION = new Set([
  'set_profile', 'set_practice_details', 'accept_contributor_terms',
  'list_formulations', 'get_formulation',
  'find_patient', 'list_patients', 'get_patient', 'list_due_follow_ups',
  'export_account', 'delete_account',
]);

// Registration state for one practitioner row. Pure — no database, no clock
// beyond what the row carries — so the prompt builder, the tool gate and the
// admin view all read the same answer.
function state(practitioner = {}) {
  const missing = [];
  if (!practitioner.display_name) missing.push('name');
  if (!practitioner.region) missing.push('region');

  const terms = governance.currentTerms();
  const termsAnswered = Boolean(
    practitioner.contributor_terms_accepted_at || practitioner.contributor_terms_declined_at
  );

  return {
    complete: missing.length === 0,
    missing,
    // What to ask for next, or null when there is nothing outstanding. One step
    // at a time: a practitioner asked for four things in one message answers
    // one of them.
    next: missing[0] ?? null,
    registered_at: practitioner.registered_at ?? null,
    // Optional context that was never given. Worth one unforced ask, never a
    // second one, so it is reported separately from `missing`.
    unasked: ['years_practising', 'tradition'].filter(field => practitioner[field] == null),
    terms: {
      // Only ever true once the terms have been through legal review and
      // practitioner consultation; see governance.currentTerms().
      due: terms.in_force && missing.length === 0 && !termsAnswered,
      answered: termsAnswered,
      accepted: Boolean(practitioner.contributor_terms_accepted_at),
      version: terms.version,
      summary: terms.summary,
    },
  };
}

// The gate itself. Returns null to allow, or the refusal the model gets back as
// a tool_result — written for the model to act on rather than to be read aloud.
function gate(toolName, practitioner) {
  if (OPEN_BEFORE_REGISTRATION.has(toolName)) return null;
  const registration = state(practitioner);
  if (registration.complete) return null;

  const asks = {
    name: 'ask what they would like to be called, then call set_profile',
    region: 'ask where they practise, then call set_practice_details',
  };
  return {
    ok: false,
    error:
      `Registration is not finished, so ${toolName} is unavailable. Still missing: ` +
      `${registration.missing.join(' and ')}. Do not tell the practitioner about registration ` +
      `or about this tool failing — ${asks[registration.next]}, and carry on with what they were ` +
      'saying once it is recorded. Nothing they have told you this turn is lost; save it after.',
  };
}

// The registration half of {{PRACTITIONER_CONTEXT}}. Plain sentences, because
// the model reproduces the register of what it is given — a field listing in the
// prompt comes back out as a field listing in the chat.
function describeForPrompt(practitioner) {
  const registration = state(practitioner);
  const lines = [];

  if (!practitioner.display_name) {
    lines.push('You have not been introduced yet — you do not know their name or preferred language.');
  } else {
    lines.push(`Name: ${practitioner.display_name}`);
    lines.push(`Preferred language: ${practitioner.preferred_language || 'not stated yet — reply in whatever language they write or speak in'}`);
    lines.push(`With Sanko since: ${(practitioner.created_at || '').slice(0, 10) || 'unknown'}`);
  }

  if (practitioner.region) lines.push(`Practises in: ${practitioner.region}`);
  if (practitioner.years_practising != null) lines.push(`Years practising: ${practitioner.years_practising}`);
  if (practitioner.tradition) lines.push(`Tradition: ${practitioner.tradition}`);

  if (!registration.complete) {
    lines.push('');
    lines.push(
      `Registration is unfinished: you still need their ${registration.missing.join(' and ')}. ` +
      'Ask for one of them now. Until both are recorded you cannot save a formulation, so if they ' +
      'have just described a remedy, take it in, ask the outstanding question, and save once you ' +
      'have the answer.'
    );
  } else if (registration.unasked.length === 2) {
    lines.push('');
    lines.push(
      'They are registered. You have never asked how long they have practised or what tradition ' +
      'they work in — worth one unforced question when the conversation allows, and never worth ' +
      'a second one.'
    );
  }

  if (registration.terms.due) {
    lines.push('');
    lines.push(
      'They have not yet answered on the contributor terms. When there is a natural pause, put the ' +
      `following to them in their own language, say it is about anything leaving Sanko rather than ` +
      'about using Sanko, and make clear that saying no changes nothing about what they can do here. ' +
      `Then call accept_contributor_terms with their answer.\n\n${registration.terms.summary}`
    );
  }

  return lines.join('\n');
}

module.exports = { state, gate, describeForPrompt, OPEN_BEFORE_REGISTRATION };

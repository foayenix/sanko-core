'use strict';

// Versioned wording for guided WhatsApp tasks.
//
// Only English exists, and it is UNREVIEWED synthetic wording: it has not been
// checked by clinicians, lawyers or intended users. That is acceptable only
// while every channel gate also requires synthetic-only operation. A live
// release needs reviewed wording per language (notices, consent, care outcome
// questions, evidence limitations and consequential confirmations).
//
// The other target languages are listed so a person can ask for them, but
// Sanko does not invent translations: selecting one keeps the task, answers
// and draft and says plainly that reviewed wording is not available yet.
//
// Labels are kept short enough for WhatsApp reply buttons (20 characters) and
// list rows (24). tests/channel-foundation.test.js enforces this, so a
// consequential label is never truncated on screen.

const VERSION = 'en-synthetic-2026-10-02';
const REVIEW_STATUS = 'unreviewed-synthetic';

const LANGUAGES = [
  { code: 'en', label: 'English', available: true },
  { code: 'pcm', label: 'Nigerian Pidgin', available: false },
  { code: 'yo', label: 'Yorùbá', available: false },
  { code: 'ha', label: 'Hausa', available: false },
  { code: 'ig', label: 'Igbo', available: false },
];

// Button and row labels. Keys are the semantic codes stored in prompts.
const LABELS = {
  menu: 'Menu',
  back: 'Back',
  cancel: 'Cancel',
  help: 'Help',
  more: 'More',
  not_now: 'Not now',
  link: 'Link my account',
  something_else: 'Something else',
  // patient menu
  check_ins: 'Check-ins',
  send_update: 'Send an update',
  visits: 'My visits',
  replies: 'Practice replies',
  invitations: 'Invitations',
  privacy: 'Messages and privacy',
  reference: 'My reference',
  language: 'Language',
  // onboarding
  myself: 'Myself',
  someone_else: 'Someone else',
  create_record: 'Create record',
  change_name: 'Change name',
  // invitations
  accept: 'Accept',
  decline: 'Decline',
  accept_tracking: 'Accept tracking',
  decline_invite: 'Decline invitation',
  // check-in outcomes (semantic codes are stable; wording may change by version)
  better: 'Better',
  same: 'About the same',
  worse: 'Worse',
  mixed: 'Mixed or changing',
  unwanted: 'Unwanted effects',
  unsure: 'Not sure',
  nothing_more: 'Nothing more to add',
  send: 'Send',
  change_it: 'Change it',
  // context of a free message
  ctx_check_in: 'Reply to a check-in',
  ctx_correction: 'Correct a visit',
  ctx_past_visit: 'Tell about a past visit',
  ctx_product: 'Product or allergy note',
  ctx_discard: "Don't save it",
  // visits
  request_correction: 'Request a correction',
  // privacy
  stop_messages: 'Stop messages',
  resume_messages: 'Resume messages',
  keep_stopped: 'Keep stopped',
  tracking_choices: 'Tracking choices',
  request_deletion: 'Request deletion',
  account_recovery: 'Account recovery',
  unlink_phone: 'Unlink this phone',
  confirm_unlink: 'Unlink',
  stop_tracking: 'Stop tracking',
  start_tracking: 'Allow tracking',
  messages_off: 'Turn messages off',
  messages_on: 'Turn messages on',
  confirm_change: 'Confirm change',
  send_request: 'Send request',
  done: 'Done',
  // practitioner
  care_inbox: 'Care inbox',
  my_patients: 'My patients',
  record_visit: 'Record a visit',
  evidence_reports: 'Evidence reports',
  my_formulations: 'My formulations',
  new_visit: 'New visit now',
  record_visit_now: 'Record visit',
  patient_history: 'Recent history',
  use_whole_note: 'Use whole note',
  type_part: 'Type part of it',
  no_preparation: 'No preparation',
  from_vault: 'From my Vault',
  other_preparation: 'Other preparation',
  show_recipe: 'Show recipe',
  keep_private: 'Keep recipe private',
  save_draft: 'Save draft',
  change_something: 'Change something',
  edit_note: 'Visit note',
  edit_summary: 'Patient summary',
  edit_preparation: 'Preparation',
  sign_version: 'Sign this version',
  release: 'Release to patient',
  complete: 'Mark completed',
  in_3_days: 'In 3 days',
  in_7_days: 'In 7 days',
  in_14_days: 'In 14 days',
  write_next_steps: 'Write next steps',
  send_next_steps: 'Send next steps',
  // evidence
  request_review: 'Request a review',
  check_progress: 'Check progress',
  my_reports: 'My reports',
  general_overview: 'General overview',
  confirm_recipe: 'Confirm recipe',
  agree_submit: 'Agree and submit',
  answer_question: 'Answer the question',
  send_answer: 'Send answer',
  continue_request: 'Continue request',
  cancel_request: 'Cancel request',
  confirm_cancel: 'Yes, cancel it',
  keep_request: 'Keep request',
  read_summary: 'Read summary',
  send_full_report: 'Send full report',
  ask_or_correct: 'Ask or correct',
  send_copy: 'Send me a copy',
  ask_question: 'Ask a question',
};

// Messages. Functions take named values; every other entry is fixed text.
const TEXT = {
  synthetic_banner: 'Synthetic exercise — fictional records only.',
  generic_menu:
    'Sanko keeps care and evidence work private. To use your own records here, link this ' +
    'chat to your Sanko account once.',
  link_help:
    'To link: sign in to your Sanko portal, choose "Link WhatsApp", then send the code here ' +
    'as LINK followed by the code (for example LINK ABCD-2345). Codes work once and expire ' +
    'after 10 minutes. Never send your password here.',
  care_unavailable:
    'My care in WhatsApp is not open yet. No clinical record was created. Contact your ' +
    'practice for care or account-rights support.',
  linked: ({ name, domain }) =>
    `Linked to ${name ?? 'your account'} for ${domain === 'care' ? 'care' : 'evidence reports'}. ` +
    'Anyone using this phone can act for this account until the session ends or you send UNLINK.',
  link_failed:
    'That code did not work. It may be mistyped, used already or expired. Nothing was linked. ' +
    'Get a new code from your portal.',
  link_locked:
    'Too many codes were tried from this chat. Linking is paused for an hour. Nothing was linked.',
  verify_again: ({ domain }) =>
    `Please verify again before continuing: sign in to your ${domain === 'evidence' ? 'evidence' : 'care'} ` +
    'portal, choose "Link WhatsApp" and send the new code here. Your task is kept and ' +
    'will be shown again for a fresh review.',
  verify_to_sign:
    'Signing needs a verification from the last 10 minutes. Get a new code from your care ' +
    'portal and send LINK with the code. Your draft is kept.',
  resume_task: 'Welcome back. Here is where you were — please review it again.',
  stale_choice: 'That choice is no longer current, so nothing was changed.',
  choose_hint:
    'Please choose one of the options above, reply with its number, or send MENU, BACK or CANCEL.',
  free_reply_hint: 'You can also type your own words if none of the options fit.',
  cancelled: 'Cancelled. Nothing was saved from this step.',
  nothing_to_go_back: 'There is no earlier step. Here is the menu.',
  menu_prompt: 'What would you like to do?',
  help:
    'Tap a choice or reply with its number. You can always type your own words. Send MENU ' +
    'for the main menu, BACK for the previous step, CANCEL to stop without saving, LANGUAGE ' +
    'to choose a language, STOP to stop optional messages, and UNLINK to disconnect this phone. ' +
    'This chat is not monitored for emergencies; contact your practice or local emergency ' +
    'services directly.',
  language_prompt: 'Which language would you like?',
  language_unavailable: ({ label }) =>
    `Reviewed wording in ${label} is not available yet, so Sanko will continue in English. ` +
    'Your current task and answers are kept. You can still type in any language; your own ' +
    'words are saved as you wrote them.',
  language_set: 'Sanko will continue in English.',
  task_closed_role:
    'Your earlier step was closed because you switched between My care and My vault. Nothing from it was saved.',
  media_not_supported:
    'Voice notes and photos cannot be added to this step yet. Please type it instead, or ' +
    'send CANCEL. Nothing was saved.',
  // stop/resume
  stopped: ({ cancelled, inFlight }) =>
    'Optional Sanko messages to this WhatsApp number are stopped.' +
    (cancelled
      ? ` ${cancelled} waiting message${cancelled === 1 ? ' was' : 's were'} cancelled.`
      : '') +
    (inFlight ? ' One message was already being sent and may still arrive.' : '') +
    ' This does not delete records, change tracking at your practice or affect other numbers. ' +
    'Send RESUME to start them again.',
  stop_failed: 'Sanko could not record your stop request just now. Please send STOP again.',
  resume_confirm:
    'Resume optional Sanko messages, such as check-in notices, to this WhatsApp number?',
  resumed: 'Optional messages to this number are on again.',
  kept_stopped: 'Optional messages stay stopped.',
  resume_needs_link:
    'Resuming messages needs a linked, verified chat. Send LINK with a code from your portal.',
  unlink_confirm:
    'Unlink this phone from your Sanko account? Ongoing steps in this chat end and nothing ' +
    'private will be shown here until you link again. Your records are not deleted.',
  unlinked: 'This phone is unlinked. Your records are unchanged.',
  // patient onboarding
  who_for: 'Is this care record for you or for someone else?',
  caregiver_unavailable:
    'Acting for someone else is not available yet. No record was created. Their practice ' +
    'can help with assisted access.',
  ask_name: 'What name should your practice see? Type it as you would like it shown.',
  confirm_name: ({ name }) => `Create a care record with the name "${name}"?`,
  created_record: ({ reference }) =>
    `Your care record was created. Your reference is ${reference}. Share it only with a ` +
    'practice you want to invite you.',
  reference: ({ reference }) => `Your care reference is ${reference}.`,
  no_invitations: 'You have no practice invitations right now.',
  pick_invitation: 'Which invitation would you like to answer?',
  invitation: ({ practice, scope, expires }) =>
    `${practice} invites you to track your care with them.\nScope: ${scope}\nExpires: ${expires}`,
  confirm_accept: ({ practice }) =>
    `Accept care tracking with ${practice}? They will be able to record your visits and read ` +
    'updates you send them. Optional messages stay off until you turn them on. Nothing is ' +
    'shared with other practices or used for training.',
  confirm_decline: ({ practice }) =>
    `Decline the invitation from ${practice}? No relationship will be created.`,
  accepted: ({ practice }) => `Saved. Care tracking with ${practice} is on.`,
  declined: ({ practice }) => `Saved. You declined the invitation from ${practice}.`,
  // check-ins
  no_check_ins: 'You have no check-ins waiting.',
  pick_check_in: 'Which check-in would you like to answer?',
  check_in_question: ({ practice }) =>
    `Check-in from ${practice}.\nCompared with your last visit, how do you feel?`,
  check_in_question_record: 'Compared with your last visit, how do you feel?',
  check_in_more:
    'Is there anything you want to add in your own words? Type it, or tap "Nothing more to add".',
  review_update: ({ practice, answer, words }) =>
    `Send this update to ${practice}?\nAnswer: ${answer}\nYour words: ${words ?? '(none)'}`,
  update_saved: ({ practice }) =>
    `Saved. Your update is waiting for ${practice} to review it. They have not read it yet. ` +
    'For urgent care, contact your practice directly.',
  // free message context
  which_context: 'Where should this message go? It will not be saved until you choose and confirm.',
  discarded: 'Your message was not saved.',
  pick_practice: 'Which practice is this for?',
  no_practices:
    'You are not tracked by any practice yet, so this cannot be added to a care record. Nothing was saved.',
  pick_visit: 'Which visit is this about?',
  type_report: 'Please type what you would like to tell your practice.',
  review_report: ({ practice, kind, text }) => `Send this ${kind} to ${practice}?\n"${text}"`,
  report_saved: ({ practice }) =>
    `Saved as your own account. It is waiting for ${practice} to review it; the original visit record is unchanged.`,
  // visits
  no_visits: 'There are no released visits to show yet.',
  pick_visits: 'Which visit would you like to read?',
  correction_prompt: 'What should be corrected? Type it in your own words.',
  no_replies: 'There are no practice replies to your updates yet.',
  replies: ({ items }) => `Your recent updates and replies, newest first:\n\n${items}`,
  // privacy
  privacy_menu: 'Messages and privacy. What would you like to do?',
  tracking_state: ({ practice, tracking, messaging }) =>
    `${practice}: tracking is ${tracking ? 'on' : 'off'}, optional messages are ${messaging ? 'on' : 'off'}. What would you like to change?`,
  confirm_preference: ({ practice, change }) => `${change} with ${practice}?`,
  preference_saved: 'Saved. Your choice is recorded.',
  confirm_rights: ({ kind }) =>
    `Send a ${kind} request to Sanko? It will be reviewed; nothing is erased or changed by sending it.`,
  rights_sent: ({ kind }) =>
    `Your ${kind} request was received and is pending policy review. Nothing has been erased or ` +
    'changed yet; it is not fulfilled.',
  // practitioner
  pick_practice_member: 'Which practice are you working in?',
  no_practice_membership: 'This account has no active practice. Nothing to show.',
  inbox_empty: 'Your care inbox is empty.',
  inbox_pick: ({ count }) =>
    `${count} update${count === 1 ? '' : 's'} waiting for review. Which would you like to open?`,
  inbox_item: ({ name, reference, kind, recorded, report }) =>
    `${name} (${reference}) — ${kind}, received ${recorded}.\n\n${report}`,
  next_steps_prompt:
    'Type the next steps you want the patient to see, in your own words. Sanko does not ' +
    'write advice.',
  confirm_review: ({ name, steps }) =>
    `Send these next steps to ${name}? This marks the update reviewed.\n"${steps}"`,
  reviewed: ({ name }) => `Reviewed. ${name} can now see your next steps in their record.`,
  no_patients: 'No patients are tracked at this practice yet.',
  pick_patient: 'Which patient?',
  patient_options: ({ name, reference }) => `${name} (${reference}). What would you like to do?`,
  pick_encounter: ({ name }) => `Which visit for ${name}?`,
  confirm_arrive: ({ name, time }) => `Record a visit for ${name} now (${time})?`,
  note_prompt:
    'Type your visit note. Only what you write is saved; Sanko does not add dosages, ' +
    'ingredients or decisions.',
  summary_choice: ({ name }) => `What should ${name} see from this note?`,
  summary_prompt: 'Type the exact words from your note that the patient should see.',
  summary_not_in_note:
    'Those words are not in your note exactly as written. Please copy them from the note.',
  prep_choice: 'Was a preparation given at this visit?',
  pick_formulation: 'Which formulation from your Vault?',
  no_formulations: 'There are no active formulations in your Vault for this practice.',
  prep_label_prompt: 'Type the preparation name exactly as it appears in your note.',
  prep_label_missing:
    'That name does not appear in your note exactly as written. Please copy it from the note.',
  prep_disclose: 'Should the patient see the recipe for this preparation?',
  draft_review: ({ name, note, summary, preparation }) =>
    `Visit note for ${name} — please check it.\n\nNote: ${note}\n\nPatient sees: ${summary}\n\n` +
    `Preparation: ${preparation}`,
  what_to_change: 'What would you like to change?',
  draft_saved: ({ revision }) =>
    `Draft saved (version ${revision}). It is not signed or visible to the patient yet.`,
  confirm_sign: ({ note, summary, preparation, revision }) =>
    `Sign this exact version (${revision})? A signed note cannot be edited; later changes become amendments.\n\n` +
    `Note: ${note}\n\nPatient sees: ${summary}\n\nPreparation: ${preparation}`,
  signed: 'Signed. The patient cannot see it until you release it.',
  confirm_release: ({ name, summary }) => `Release this summary to ${name}?\n"${summary}"`,
  released: ({ name }) => `Released. ${name} can read this summary in their record.`,
  confirm_complete: 'Mark this visit as completed?',
  completed: 'Visit marked completed.',
  schedule_choice:
    'Send a check-in later? It goes only to patients who have turned optional messages on.',
  scheduled: ({ when }) =>
    `Check-in scheduled for ${when}. Nothing is sent outside 08:00–20:00 practice time.`,
  schedule_consent: 'No check-in was scheduled: this patient has not turned on optional messages.',
  schedule_responsibility:
    'No check-in was scheduled: the practice has no response hours or escalation wording recorded.',
  visit_left: ({ done, pending }) => `Stopped here. Done: ${done}. Not done: ${pending}.`,
  formulations_handoff:
    'Your Vault is ready. Tell me about a formulation, ask to see one, or send a voice note or photo.',
  practitioner_media:
    'Care notes from voice notes or photos are not supported in this step yet. Please type the note. Nothing was saved.',
  // evidence
  evidence_menu: 'Which report task would you like?',
  no_eligible_formulations: 'None of your formulations is enrolled for evidence review yet.',
  pick_ev_formulation: 'Which formulation should be reviewed?',
  ev_purpose: 'What should the review look at? Choose an option or type your own question.',
  ev_recipe_intro: ({ code }) =>
    `Here is the exact recipe that would be reviewed (${code}). Please check it.`,
  ev_recipe_confirm: 'Is this recipe correct?',
  ev_change_recipe:
    'Recipe changes are made in your Vault: tell the Vault what to change, then choose ' +
    '"Request a review" again. This request stays a draft and nothing has been submitted.',
  ev_notice: ({ status, purpose, scope, excluded }) =>
    `Service notice (${status})\nPurpose: ${purpose}\nWho may see it: ${scope}\nNot included: ${excluded}`,
  ev_notice_confirm:
    'Do you agree to a private review of the recipe above under this notice? This is separate from any Vault consent.',
  ev_submitted: ({ reference }) =>
    `Submitted. Request ${reference} is queued for an analyst. Nothing has been reviewed yet.`,
  ev_recipe_changed:
    'The recipe changed while you were confirming, so it was not submitted. Here is the current version — please review it again.',
  no_requests: 'You have no evidence requests yet.',
  pick_request: 'Which request?',
  ev_status: ({ reference, status }) => `Request ${reference}: ${status}.`,
  ev_question: ({ question }) => `The analyst asked:\n"${question}"`,
  ev_answer_prompt:
    'Type your answer. It is attributed to you and does not change the confirmed recipe.',
  ev_confirm_answer: ({ answer }) => `Send this answer?\n"${answer}"`,
  ev_answer_sent: 'Sent. Your answer is with the assigned analyst.',
  ev_confirm_cancel: 'Cancel this request? Any work stops, and it cannot be restarted.',
  ev_cancelled: 'The request is cancelled.',
  no_reports: 'You have no released reports yet.',
  pick_report: 'Which report?',
  ev_report: ({ reference, version, released, status }) =>
    `Report for request ${reference}, version ${version}, released ${released}. Status: ${status}.`,
  ev_withdrawn: 'This report was withdrawn and can no longer be sent.',
  ev_summary_header: ({ version, released, reviewer, reviewed, currency }) =>
    `Reviewed brief, version ${version}, released ${released}. Reviewed by ${reviewer} on ${reviewed}. ${currency}.`,
  ev_copy_notice:
    'The full report will arrive as a PDF in this chat. Whoever has this phone can keep or ' +
    'forward that copy, and Sanko cannot recall it later, even if the report is corrected or ' +
    'withdrawn. Send it?',
  ev_sending: 'Preparing your report…',
  ev_sent: 'Your report was handed to WhatsApp for delivery. It may take a moment to appear.',
  ev_send_failed:
    'The report could not be sent just now. Sanko will retry automatically; nothing else changed.',
  ev_send_uncertain:
    'Sanko could not confirm whether the report was sent. Check this chat; it will not be resent automatically.',
  ev_send_refused: 'The report was not sent because it is no longer available to you here.',
  ev_render_failed:
    'The report file could not be produced, so nothing was sent. An operator will be alerted; no unreviewed version will be sent instead.',
  ev_delivery_off:
    'Sending reports as files is not switched on here. You can read the summary in chat.',
  ev_ask_kind: 'Would you like to ask a question about this report or request a correction?',
  ev_ask_prompt:
    'Type your question or correction. It goes to the review team; it does not change the report.',
  ev_confirm_ask: ({ text }) => `Send this to the review team?\n"${text}"`,
  ev_ask_sent:
    'Sent to the review team. The released report is unchanged until a reviewed revision is released.',
  ev_unavailable: 'Evidence reports are not available in this chat.',
  error: 'Something went wrong and nothing was changed. Please try again.',
  conflict:
    'Something changed while you were reviewing it, so nothing was saved. Please review it again.',
  not_found: 'That item is not available to you here. Nothing was changed.',
};

const STATUS_WORDS = {
  draft: 'not submitted yet (draft)',
  submitted: 'queued for an analyst',
  waitlisted: 'waiting for review capacity',
  accepted: 'in progress with an analyst',
  needs_information: 'the analyst has a question for you',
  review: 'with an independent reviewer',
  changes_required: 'being revised after review',
  approved: 'approved and waiting for release',
  released: 'released',
  cancelled: 'cancelled',
  declined: 'declined',
};

function label(code) {
  if (!Object.hasOwn(LABELS, code)) throw new Error(`UNKNOWN_LABEL:${code}`);
  return LABELS[code];
}

function text(key, values = {}) {
  const entry = TEXT[key];
  if (entry === undefined) throw new Error(`UNKNOWN_TEXT:${key}`);
  return typeof entry === 'function' ? entry(values) : entry;
}

module.exports = { VERSION, REVIEW_STATUS, LANGUAGES, LABELS, TEXT, STATUS_WORDS, label, text };

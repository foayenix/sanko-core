# Sanko Vault — Privacy & Security Notice

**Version 1.2 · September 2026 · Applicable to MVP v1**

---

## What Sanko Vault collects

When you use Sanko Vault via WhatsApp, the following data is stored:

| Data | Why it is stored |
|---|---|
| Your WhatsApp phone number | Unique identifier — no passwords needed |
| Your display name | Shown in your Vault and on formulation records |
| Your preferred language | So the bot communicates in the right language |
| Formulation records you create | The core purpose of the product |
| Voice notes and photos you send | Source material for structuring formulations; stored so you can replay them |
| Transcripts of your voice notes | Used to structure your formulations via AI |
| Your conversation with Sanko | Kept for 24 hours so the assistant remembers the thread of what you are telling it |
| Activity timestamps | Used to detect idle sessions and for basic usage analytics |

### The website forms

The two forms on sanko.africa are the only data Sanko collects from people who are
not using the Vault. Submitting one does not create a Vault account.

| Data | Why it is stored |
|---|---|
| Your name | To address you, and to recognise you when the application is reviewed |
| The WhatsApp number you would test from (test access) | The number the agent would be opened to; there is no other way to grant access |
| How you intend to use Sanko (test access, optional) | Context for the review |
| Your work email, organisation and message (partnership) | To reply, and to understand what is being asked |

These rows are written directly by your browser using Supabase's public key, which
has permission to insert and no permission to read. The key that submits a form
cannot read any submission back, including the one it just wrote. Submissions are
readable only with the operator's service-role key.

The notification the operator receives when a form is submitted carries a name and
which form it was. The phone number is deliberately not copied into email.

### Patient records

Patient tracking is disabled by default. A deployment may enable it only after its
governance review. When enabled, a practitioner may supply a patient's name and
WhatsApp number to send a consent request. This creates a pending invitation, not an
active treatment record. Pending invitations expire and are deleted after seven days.

The patient receives an explanation directly from Sanko and can choose Accept or Decline.
Tracking begins only after acceptance from the invited WhatsApp number. Acceptance time,
method and the WhatsApp response message identifier are recorded as consent evidence.
Declining deletes the pending name and phone number and creates no active patient record.
The patient can later withdraw consent and request deletion.

After acceptance, Sanko may store the patient's name, phone number, optional age and sex,
the formulation used, treatment dates and outcomes needed for follow-up. The agent does
not collect free-form background notes when creating a patient.

Patient records are the most sensitive data Sanko holds. They are visible only to you
and to the operator named below, are covered by the same encryption and row-level
security as everything else, and are never shared with researchers or third parties.

Sanko and participating practitioners each have responsibilities appropriate to their
role. Deployments must establish a lawful basis, give patients an understandable notice,
honour their rights, and document the applicable controller/processor arrangements.
Consent capture in the product is a safeguard, not a substitute for legal or clinical-
governance review.

---

## Who can see your data

| Party | Access |
|---|---|
| You | Full access to your own formulations and patient records via WhatsApp |
| Felix Ayeni (Sanko operator, v1) | Read access to all records, for debugging and technical support only |
| Third parties | None. No formulation data is shared with any third party in v1. |
| Researchers | No access in v1. Research-partner data licensing is deferred to v2, with Nagoya-compliant data-sharing templates and practitioner consent. |

This will be disclosed to you again when you first message Sanko.

---

## Nagoya Protocol alignment

Every formulation record stores you — the practitioner — as the **source of knowledge**. Sanko does not claim ownership of your traditional knowledge. No formulation data is transferred to any research institution or commercial partner in v1. When research access is introduced in v2, it will require your explicit consent and will follow Nagoya Protocol requirements on access and benefit-sharing.

---

## How your data is stored and protected

- **In transit**: all connections use TLS 1.2+ (enforced by Railway and Supabase).
- **At rest**: Supabase encrypts all data using AES-256 at rest.
- **Voice notes and photos**: stored in Supabase Storage (private bucket) with signed-URL access only. Links expire after 1 hour.
- **Database region**: London (eu-west-2) or Frankfurt (EU). Your data does not leave EU jurisdiction.
- **Row-level security**: enabled on all tables. The WhatsApp bot accesses data using a service-role key; no practitioner can read another practitioner's records.

---

## Data retention

- Formulation records are retained as the practitioner's professional archive until deletion.
- Patient-record retention must be configured by an approved governance policy; indefinite
  retention is not the default policy.
- Conversation history is replayed to the assistant for 24 hours and then no longer used as context.
- Events (technical logs) are kept for debugging; phone numbers in shared analytics are hashed. Technical logs may include voice-note transcripts and edit instructions you send, in order to diagnose problems.
- Test-access applications are kept until the application is decided, and deleted within
  12 months of that decision. If an application is approved, the number then exists as a
  practitioner record and is governed by the retention terms above rather than this one.
  A declined or abandoned application is deleted on the same 12-month basis.
- Partnership enquiries are kept while the conversation is live and deleted within 24
  months of the last contact.
- Either can be deleted sooner on request, at felix@sanko.africa, without giving a reason.

---

## Your rights

You can ask Sanko to export all data associated with your account. To permanently erase
the account, send the exact confirmation phrase shown by the assistant. Deletion removes
database records, conversation history, event payloads, and archived Storage objects;
only the pseudonymous, append-only deletion audit tombstone is retained. You may also
contact the operator if you cannot access the account.

Access, exports, deletion requests, and completed deletions are recorded in an append-only
governance audit log.

Security incidents are handled under `SECURITY_INCIDENT_RESPONSE.md`. Do not put patient
or formulation content in an incident report unless it is strictly necessary.

---

## Contact

Felix Olajide Ayeni · felix@sanko.africa · Sanko Vault operator, v1

This notice is published at sanko.africa/privacy, generated from this file. Edit it here, not there.

## Contributor terms and knowledge use

Custody of a practitioner's records is covered above. Use of that knowledge
beyond their own Vault is governed separately, by
[`governance/contributor-terms-v1.md`](governance/contributor-terms-v1.md) and
enforced by migration 013:

- acceptance is recorded against the hash of the exact terms text, so amending
  the terms does not carry forward an earlier agreement;
- research access, licensing, publication and dataset export are each recorded in
  a ledger with the counterparty, purpose, scope, and the benefit agreed with the
  contributing practitioners;
- a practitioner who has not accepted the current terms cannot be included in any
  such use. This is a refusal in code, not an assurance in a document.

A practitioner can ask what has been done with their knowledge and what was
agreed for it at any time.

**Status:** the terms are a draft. They have had no legal review and no
practitioner consultation, and are marked as not in force until both have
happened.

## Logging

Operational logs record identifiers and the shape of events — never practitioner
speech, transcripts, patient names, or phone numbers. Those fields are redacted
by the logger itself rather than by the discipline of whoever wrote the log line.

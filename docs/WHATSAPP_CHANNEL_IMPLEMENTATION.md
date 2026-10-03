# WhatsApp-first care and evidence: implementation and release boundary

Specification: [SANKO_WHATSAPP_FIRST_IMPLEMENTATION_PLAN.md](SANKO_WHATSAPP_FIRST_IMPLEMENTATION_PLAN.md)
(version 1.0, 2 October 2026). The specification is the requirement, not
evidence of delivery. This file records what was built, how it was checked and
what remains open. Everything here is **synthetic-only**; no deployment,
production migration or real-patient messaging was performed.

## W0 baseline

On 2 October 2026 the checkout was `foayenix/sanko-core`, branch
`claude/determined-noether-fp9c4t`, clean, at `89ae62e` (main after PR #6).
The specification's inspected checkout (`ef534f0` plus uncommitted
`024_care_review_queue.sql`) is superseded: 024 and 025 are now committed, so
the new migration is **026**. Baseline before any change: lint passed; 563
backend tests, 28 care PostgreSQL tests and 5 + 21 evidence tests passed;
secret scan and repository checks passed.

Product decision recorded in `SANKO_SOURCE_OF_TRUTH.md` §3 (decision 13):
everyday care and evidence-owner tasks are completed inside WhatsApp; the web
portals remain for larger views, staff work and exceptional verification.

## Channel authority (§5)

- A WhatsApp contact (SHA-256 of the sender number, as in the existing role
  router) is never an identity. It becomes usable for private work only through
  a **binding** created when a single-use **link code** is sent from it. The
  code is issued to an individually signed-in portal principal ("Link WhatsApp"
  in `/care` or, for owners only, `/evidence`). Codes: 8 characters from a
  32-symbol alphabet, SHA-256 stored, 10-minute expiry, one use, five failures
  per contact per hour then a one-hour lock.
- A binding owns a **channel-purpose session** row in the existing
  `care_sessions` / `evidence_sessions` tables. Its token hash is generated in
  the database and never derived from a cookie, so it cannot be presented
  through the browser routes, and the channel wrappers only select
  `purpose='channel'` rows bound to the sending contact. No browser cookie is
  manufactured and portal CSRF is unchanged.
- `channel_care_act` and `channel_evidence_act` call the **same**
  `care_action`, `care_review_queue` and `evidence_action` functions as the
  browser. Membership, relationship, consent, revision, confirmation,
  idempotency, freshness (10-minute rule for signing) and audit are therefore
  identical. The evidence wrapper fixes the role to `owner`; analyst, reviewer,
  release and admin actions are refused and the refusal is audited.
- Relinking by the **same** person renews the session and keeps their task
  (shown again for a fresh review). Linking a **different** person on the same
  contact revokes the old binding, sessions, pending sends and tasks (no merge).
- Session length: `CHANNEL_SESSION_MINUTES` (default 720, allowed 5–4320). An
  expired session asks for a new code; the task is kept.

## Guided interaction (§4, §8.2)

- Durable state in `channel_tasks` (step, draft, revision, language, wording
  version, 24-hour expiry with draft purge) and `channel_prompts` (opaque id,
  options as semantic codes, labels, expiry, bound confirmation and operation
  key, recorded result). Button ids are `sk1.<prompt uuid>.<index>`; no
  clinical data appears in ids. A tap is accepted only for the contact, task
  and task revision it was issued for; a repeated tap replays the stored
  receipt; stale, forwarded or expired taps change nothing.
- Up to three short options are reply buttons, longer menus are lists (ten
  rows, 24-character titles with the full text in the description). Typing the
  option number or its exact label answers the **current** prompt only.
- `MENU`, `BACK`, `CANCEL`, `HELP`, `LANGUAGE`, `STOP`, `RESUME`, `UNLINK` and
  `LINK <code>` work everywhere they apply. Free text stays available; a
  patient's message outside a question is kept and the person chooses where it
  goes before anything is saved.
- Consequential steps show the exact item, call `prepare` and bind the
  returned confirmation (five minutes) to the tap. Nothing says Saved, Sent,
  Stopped or Submitted before the operation succeeds; document delivery says
  "handed to WhatsApp", never "delivered".
- Wording: `src/channel/copy.js`, version `en-synthetic-2026-10-02`,
  **unreviewed**. English only. Nigerian Pidgin, Yorùbá, Hausa and Igbo can be
  selected; Sanko then says reviewed wording is not available and continues in
  English, keeping the task and answers. No translations were invented.
- Check-in answers store a semantic code, question id, wording version,
  language, respondent and observation id in `channel_answers`; the patient's
  own words are kept verbatim.

## What finishes inside WhatsApp

| Workflow | In chat (synthetic) | Still needs the web |
| --- | --- | --- |
| Patient record (C01) | Create own record, read reference; caregiver requests refused honestly | One-time portal sign-in to get a link code |
| Invitation (C01) | View, accept or decline with exact confirmation | Practitioner sends the invitation from the portal |
| Visit (C02) | Choose patient, new or open visit, typed note, literal patient summary, Vault or other preparation, save draft, sign exact revision, release, complete, schedule check-in — each separately confirmed | Amendments and multiple preparations per note |
| Check-in (C03) | Opted-in notice (no health detail), outcome choice including worse/mixed/unwanted/not sure, own words, review, save; "awaiting review" | — |
| Review (C04) | Care inbox, read update, write next steps, confirm; patient reads attributed reply ("Practice replies") | — |
| History (C05) | Released visits, correction request (original kept) | Full timeline view |
| Messages and rights (C06) | STOP (contact-level, immediate, cancels queued optional sends), RESUME (verified, explicit), tracking/messaging per practice, deletion and recovery requests (pending review) | Care export download |
| Evidence (E01–E05) | Pick enrolled formulation, purpose, exact recipe, separate notice consent, submit (hash-bound), progress, answer analyst question, cancel, read released brief, receive full PDF, ask a question or request a correction | Analyst, reviewer and release work (deliberately) |

Voice notes and photos are **not** accepted for care notes or patient updates
in chat; the person is asked to type and nothing is saved. Vault formulation
capture (text, voice, photo) is unchanged and still runs through the Vault
agent, including its model-produced confirmation buttons; it was not moved to
the deterministic confirmation contract in this change.

## Outbound, delivery and documents (§8.3, E04)

- `channel_outbound` stores each intent before any provider call. The claim
  rechecks binding, suppression (optional sends), relationship consent, release
  state, ownership and session at send time. Results: `accepted` (Meta message
  id), `failed` (backoff, at most three attempts) or `ambiguous` (timeout,
  5xx, lease lost; never retried automatically; `channel_outbound_reconcile` is
  the operator decision). Status callbacks are recorded before the webhook is
  acknowledged, idempotently and without moving to a weaker state.
- PDF: `src/evidence/pdf.js` renders the released brief and technical dossier
  HTML (the signed artifacts) plus a control record and footers. It embeds the
  TrueType font in `EVIDENCE_PDF_FONT` (and `EVIDENCE_PDF_FONT_BOLD`) or uses
  WinAnsi Helvetica, and **fails closed** on any character or markup it cannot
  render — no fallback document is sent. Output is deterministic per content,
  renderer version and font; the artifact hash, renderer and manifest are
  stored in `evidence_report_artifacts`.
- Before the first copy, the owner is told the file can be kept or forwarded
  and cannot be recalled; the choice is recorded per binding and notice version.
- Provider media is deleted after delivery settles; failures are recorded for
  retry.

## Testing from real phones

To put the code on a server for testing, follow
[WHATSAPP_DEPLOYMENT_CHECKLIST.md](WHATSAPP_DEPLOYMENT_CHECKLIST.md).

[WHATSAPP_BAILEYS_TESTING.md](WHATSAPP_BAILEYS_TESTING.md) explains how to run
these flows against a test Supabase project through the Baileys adapter.
`scripts/setup-channel-test.js` creates individual Supabase Auth logins bound to
synthetic records. With `CHANNEL_OUTBOUND_TRANSPORT=baileys`, check-in notices
and report PDFs go out through the linked test account instead of Meta, and only
that process runs the outbound queue. Baileys shows choices as numbered lists and
has no delivery receipts, so sends stay "accepted".

## Configuration and rollback

All default off: `CHANNEL_GUIDED_ENABLED`, `CARE_CHANNEL_ACTIONS_ENABLED`,
`CARE_CHANNEL_NOTIFICATIONS_ENABLED`, `EVIDENCE_CHANNEL_ACTIONS_ENABLED`,
`EVIDENCE_CHANNEL_DELIVERY_ENABLED`. Each depends on the previous gates and on
the existing care/evidence gates; every one requires `CHANNEL_SYNTHETIC_ONLY=true`
(startup refuses otherwise). With the gates off, routing is unchanged.

Rollback: switch the gates off. The worker and outbound queue stop; bindings,
sessions, receipts, answers, suppressions and audit remain. Migration 026 is
additive; do not drop it to roll back. Suppression is checked at claim time
regardless of which workflow queued a message.

## Verification (2 October 2026, this container)

Commands, with PostgreSQL 16 on a disposable loopback cluster:

```sh
npm run lint
npm test                                   # 573 passed (563 existing + 10 new)
CARE_TEST_DB_URL=... npm run test:care     # 28 passed
EVIDENCE_TEST_DB_URL=... npm run test:evidence   # 5 + 21 passed
CHANNEL_TEST_DB_URL=... npm run test:channel     # 25 passed (24 scenarios)
npm run check-secrets && npm run check-repository
```

`test:channel` creates its own database, applies all migrations twice, and
drives Meta-shaped messages through the real role router, guided engine,
care/evidence SQL and outbound worker with a fake transport.

| ID | Status in this change |
| --- | --- |
| WA01, WA05, WA06, WA07, WA08, WA09, WA10, WA11, WA12, WA13, WA14, WA15, WA16, WA17, WA18, WA19, WA20, WA21, WA22, WA23, WA24, WA25, WA26, WA27, WA28, WA29, WA30 | Covered by named PostgreSQL scenarios (some combined) |
| WA02 | Language change mid-task keeps the task; honest limitation, since no reviewed translation exists |
| WA03 | Partial: care media is refused with a clear request to type; no transcription of care sources; Vault media unchanged |
| WA04 | Old button after a My care / My vault switch refused with no write |

Browser walkthrough (`npm run preview:channel`, Playwright/Chromium, desktop
and 390px): link from the care portal UI → onboarding → invitation → messages
on → practitioner visit in chat → scheduled work → patient check-in → inbox
review → patient reads the reply; owner request in chat → staff steps through
the evidence portal's HTTP API (not clicked through its UI) → released brief
read in chat → PDF received and opened (4 pages, inspected visually). No
horizontal overflow at 390px. One browser console message was a 404 for a
resource that could not be identified on reload (most likely the automatic
favicon request); not investigated further.

The walkthrough found and fixed: the care portal did not offer "Link WhatsApp"
before a patient's record existed. Tests found and fixed: free text without an
open task ran without the person's own record; typed navigation was ignored
while another task was open; the evidence denial audit was rolled back with its
error; the PDF control text contained a character Helvetica cannot encode.

## Open decisions before any real-user release

These block readiness claims, not synthetic work. Owners are not assigned in
the repository.

1. Identity, enrolment and recovery: whether a portal link code is sufficient
   assurance, session length, step-up for sensitive actions, shared-device
   handling, and the recovery runbook.
2. Reviewed wording per language for notices, consent, outcome questions,
   evidence limitations and confirmations; usability testing with intended
   users, including limited literacy and mixed-language use.
3. Meta qualification: current API version, interactive/list/document limits
   (the official documentation could not be fetched from this environment;
   the limits used are the commonly documented ones), templates and the 24-hour
   window for business-initiated check-in notices, opt-in rules, media terms.
4. Retention: interrupted drafts (24 hours here), prompts and labels, answers,
   provider media, PDF artifacts and the stored contact address.
5. Staffed care responsibility and response hours for chat-originated updates.
6. Document-copy permission and whether report PDFs may leave the service.
7. Practitioner invitation, care export and amendments in chat; analyst
   question notifications (owners currently see them when they check progress;
   `EVIDENCE_NOTIFICATIONS_ENABLED` remains refused).
8. Backup/restore and migration rehearsal including 026.

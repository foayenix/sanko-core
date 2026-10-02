# Sanko: complete everyday work in WhatsApp

**Implementation specification · Version 1.0 · 2 October 2026**

**Status:** Product direction requested by Felix; implementation requirements below are proposed, not evidence of delivery or live qualification.

**Intended repository location:** `docs/SANKO_WHATSAPP_FIRST_IMPLEMENTATION_PLAN.md` in `foayenix/sanko-core`.

## 1. Product decision and outcome

Practitioners and patients should be able to complete everyday Sanko tasks inside WhatsApp. They should not need the web app merely because a task involves a care record or a formulation evidence dossier.

Make tappable choices the default when the answer is a small, understandable set of options. Keep text, voice notes and photographs available. Users can switch input method during a task without starting again.

The web app remains useful for larger record views, complex practice work, optional account management, and the analyst/reviewer workspace. It must not be the mandatory destination for routine capture, follow-up replies, dossier requests or reading released reports.

**A button that only opens the portal does not satisfy an in-WhatsApp completion requirement.**

Required outcomes:

1. A practitioner records and confirms a formulation or visit through conversation.
2. A patient answers a check-in in WhatsApp; the confirmed reply reaches the correct practice and visit.
3. A practitioner reviews an authorised patient update and records next steps in WhatsApp.
4. A practitioner requests evidence review, confirms the recipe and service permission, answers reviewer questions, and receives the released brief and full dossier in WhatsApp.
5. A user can complete structured steps by tapping choices without being forced to compose English text.
6. Optional web access shows the same authorised records, revisions and permissions.

This changes the interface and delivery requirements. It does not authorise autonomous diagnosis, prescribing, automatic scientific approval, indiscriminate data sharing or production deployment.

## 2. Inspected baseline and limits of the evidence

[Certain] The local canonical checkout inspected for this specification was `/Users/felix/Documents/ChatGPT/sanko-retention 2`, branch `codex/formulation-evidence`, HEAD `ef534f04806465a3240875df80313cdbdc795dbc`. It also contained uncommitted care-handoff and review-queue changes, including `supabase/024_care_review_queue.sql`. HEAD alone does not reproduce that working tree. Refresh and inspect the actual checkout before implementation; preserve unrelated work.

[Certain] The following describes source code, not verified deployment:

| Area | Present in inspected source | Gap addressed here |
| --- | --- | --- |
| Vault | Formulation tools, text/voice/photo paths, basic model-produced reply buttons | Consistent guided tasks and robust action-bound choices |
| Care channel | Role routing and opt-in links to `/care/` sections | Actual authorised care actions in WhatsApp |
| Patient updates | Portal submission, confirmation and practitioner review | In-chat capture, confirmation and review |
| Care inbox | New practice review queue and portal UI | In-chat discovery and review of permitted items |
| Authentication | Separate care/evidence browser sessions with principal bindings | Verified channel access without treating a phone number as a person |
| Evidence | Owner intake, manual analysis, independent review, private release | Owner confirmations and delivery through WhatsApp |
| Evidence chat tools | Intake draft, status and released metadata | Confirmed submission, clarification replies, released content delivery |
| Report files | Printable HTML brief and technical dossier | Reviewed, faithful PDF output and document transport |
| Follow-up transport | Synthetic inbox dispatcher | Durable, opted-in WhatsApp notification and reply path |
| Languages | Agent language instructions | Reviewed question/choice catalogues and language-specific usability evidence |

[Certain] Existing care and evidence functionality is synthetic-only and independently gated. The legacy patient/treatment path remains distinct from new care. Do not silently reinterpret or migrate legacy records and consent.

Read before implementation: `AGENTS.md`, `SANKO_SOURCE_OF_TRUTH.md`, `PRODUCT.md`, `PRIVACY.md`, `docs/SANKO_PATIENT_CONTINUITY_IMPLEMENTATION_PLAN.md`, `docs/CARE_IMPLEMENTATION.md`, `docs/SANKO_FORMULATION_EVIDENCE_IMPLEMENTATION_PLAN.md`, and `docs/EVIDENCE_IMPLEMENTATION.md`.

Where those documents prescribe portal-only owner actions, document the deliberate change to verified channel actions. Preserve their ownership, clinical, review and authorisation boundaries.

## 3. Scope and interface allocation

| Workflow | Required WhatsApp completion | Web role |
| --- | --- | --- |
| Formulations | Capture, retrieve, correct and explicitly confirm | Optional detailed browsing/editing |
| Care enrolment | Guided minimum information, notices and choices; approved identity binding | Exceptional verification/recovery where required |
| Practice relationship | Recipient-bound invitation, accept/decline, separate permissions | Optional management |
| Visit documentation | Select patient/visit, capture source, review, sign, release and complete as separate actions | Optional longer review |
| Patient history | Read authorised released summaries and request corrections | Optional timeline |
| Follow-up | Opt-in check-in, response, review and acknowledged next steps | Optional practice dashboard |
| Evidence owner | Select recipe, confirm snapshot/service permission, submit, clarify, check status, receive and correct reports | Optional long-form view |
| Evidence staff | No requirement to move professional analysis or approval into chat | Retain analyst, independent reviewer and release workspace |
| Messaging controls | Stop/resume choices, with truthful confirmation of scope | Optional settings |
| Rights | Initiate requests in chat; fulfil supported exports through authorised delivery | Recovery or complex rights review where necessary |

Booking, caregiver/dependent representation, cross-provider sharing, referrals, medication review and automated interaction advice remain later scope unless separately requested. Do not expose non-working menu items as available actions.

## 4. Guided conversation and accessibility

### 4.1 Interaction rules

- Ask one question per structured step. Do not combine a confirmation with an unrelated question.
- Offer up to three short reply buttons for small choices; use a selectable list for longer menus. Verify current Meta limits before implementation. Design labels to fit fully in each supported language; do not silently truncate consequential meanings.
- Use specific action labels: `Save it`, `Change something`, `Cancel`, `Send full report`. Avoid an ambiguous `Yes` detached from the thing being confirmed.
- Support `Back`, `Cancel`, `Menu`, `Help`, and language changes without silently committing a draft.
- Keep a free-response route available. Explain it at onboarding and repeat the hint where none of the options may fit; do not append a long instruction to every message.
- Include `Not sure`, `Something else`, or an equivalent free-response route for questions where the displayed choices are not exhaustive. Use a list or another step instead of dropping uncertainty to fit three buttons.
- Do not require users to re-enter facts already supplied in a clear voice note or message. Ask only for missing or ambiguous information.
- A tap must perform the described action or explain the remaining step. Never say `Saved`, `Sent`, `Stopped` or `Submitted` before the corresponding operation succeeds.
- Preserve interrupted drafts under approved retention rules; resume with a short recap and fresh confirmation of consequential actions.
- Do not infer consent, successful delivery, attendance, improvement or understanding from silence.

### 4.2 Language and low-literacy support

Provide an explicit language selector. English, Nigerian Pidgin, Yorùbá, Hausa and Igbo are target languages from the existing product direction, not a claim that all are validated. Enable each consequential flow only with reviewed wording for that language.

Store a stable semantic answer code independently of its displayed translation. Record question/copy version, language, selected option, timestamp and actual respondent. Preserve original free text and uncertainty. Let users correct the interpretation before saving.

Offer brief spoken explanations where useful and technically qualified. Keep text alternatives; audio is not universally clearer. Test wording with intended users, including people with limited literacy and users who mix languages. Do not equate selecting a language with understanding a notice.

Navigation text can be flexible. Consent, care outcome questions, evidence limitations and consequential confirmations require reviewed wording. Do not let the language model invent leading answers or rewrite a notice at execution time.

### 4.3 Example screens expressed as messages

These are English design examples, not approved clinical translations or production notices.

| Context | Message | Choices |
| --- | --- | --- |
| Practitioner menu | What would you like to do? | My formulations / My patients / Evidence reports |
| Formulation review | Have I recorded this correctly? | Save it / Change something / Cancel |
| Patient follow-up | Compared with your last visit, how do you feel? | Better / About the same / Worse; free reply for uncertainty or another answer |
| Patient update review | Send this update to your practice? | Send / Change it / Cancel |
| Evidence entry | Which report task would you like? | Request a review / Check progress / My reports |
| Released report | Your reviewed report is ready. | Read summary / Send full report / Ask a question |

The follow-up wording measures a patient report, not proof that a preparation caused a change. Permit mixed outcomes, no change, worsening, unwanted effects and insufficient information.

## 5. Identity and authorisation inside a conversation

### 5.1 Required security model

A verified WhatsApp webhook establishes the incoming channel event; it does not establish which household member is using the phone. A role button, patient reference, name, phone number or forwarded link must never grant access to a record.

Introduce a channel authorisation layer with explicit actor/principal binding, permitted role, practice and subject scope, verification method, assurance level, expiry and revocation. Store credentials server-side. Recheck current membership, relationship, ownership, permissions and record state on every action, including reads and document delivery.

Keep care and evidence privileges distinct. Existing Vault access does not automatically confer patient-history access or dossier delivery rights. Multi-role users must select the intended context; switching invalidates outstanding private action confirmations.

### 5.2 Enrolment, returning access and recovery

Build and test the following lifecycle using synthetic principals first:

1. Show only a generic menu before verified binding; reveal no candidate record, private recipe name or patient identity.
2. Establish an actor binding through an approved enrolment process, such as verified practice-assisted enrolment or an existing individual authenticated account linking its channel through a short-lived challenge.
3. Use a revocable, risk-appropriate returning channel session. Require renewed verification for expired sessions, changed contacts or sensitive actions according to the approved assurance policy.
4. On shared or uncertain devices, require an independently meaningful verification step before private disclosure; if that cannot be achieved in chat, use focused secure verification or staffed assistance, then return to the original task.
5. Recovery must not rely solely on the same phone, a patient code or knowledge of a name. Revoke old sessions, bindings and pending actions as required by the recovery process.

Exact live verification methods, session durations and shared-device support need a recorded security/usability decision before real-user release. Do not solve this gap by silently declaring phone possession sufficient. Do not ask users to paste passwords, browser cookies, service credentials or reusable access tokens into chat.

A one-time or exceptional verification page is compatible with this specification. Requiring browser login for each routine care or evidence action is not. If the chosen assurance design cannot meet a workflow in WhatsApp, report that limitation explicitly instead of calling a portal redirect complete.

### 5.3 Consequential confirmations

Present the exact human-readable item being confirmed: patient/context, recipe snapshot, note changes, permission scope or delivery choice. Keep long review sequences resumable and provide correction before final confirmation.

Bind a single-use action challenge to actor, channel session, role, practice/subject, action, canonical payload, resource revision, notice version where applicable, and expiry. A tap confirms only that pending operation. Replayed taps return the original result; changed inputs, old revisions and expired challenges require a fresh review.

Do not use label text or model interpretation as authority. Free text or voice may express an intent, but irreversible or sensitive execution still needs the same deterministic confirmation contract. Provide an accessible numbered/text equivalent bound to the current prompt where buttons are unavailable.

## 6. Required care journeys

### C01 — Guided onboarding and invitation

Select `My care`, choose language and whether the person is acting for themselves, explain the immediate purpose, establish identity, collect minimum information, and issue the reference after successful creation/linking. A caregiver request must follow the existing unavailable/assisted boundary until representation is implemented.

Accept or decline an invitation only after verifying its intended recipient. Name the practice and distinguish account enrolment, care tracking and messaging choices. No cross-practice identity merge or consent upgrade by implication.

### C02 — Practitioner records a visit

Verify practitioner scope, choose an authorised patient, identify or create the appropriate encounter, and accept text/voice/photo source. Extract only supported statements. Preserve uncertain transcription and request clarification; never infer dosage, ingredients, treatment decisions or attendance.

Show the draft and preparation snapshot for review. Keep saving a draft, signing its exact revision, releasing the patient projection and marking a visit completed distinct. Reuse existing amendment and source-attribution rules. An edited Vault formulation must not rewrite a historical encounter snapshot.

### C03 — Patient replies to a check-in

An opted-in notification invites the patient to open a verified care interaction without displaying unnecessary health details on a lock screen. Once the intended person and encounter are resolved, collect a structured answer or free response, show the interpretation, and obtain confirmation.

Save one attributable observation linked to the correct encounter and practice. Reply that it was saved only after durable success. Mark review pending; do not imply a practitioner has read it. Preserve uncertainty and original wording. Missing replies remain missing data.

If a message arrives outside a pending check-in, ask which permitted context it concerns before attaching it to a record. Never lose the free response merely because a menu was expected. If enrolment/authorisation is unresolved, do not claim it has entered the care record.

### C04 — Practitioner reviews an update

`My patients` or `Care inbox` shows a paginated authorised review queue. Select an item, read its source and context, record the actual next steps, review the confirmation and acknowledge. Removal from the queue and the attributed patient-visible response must match existing care semantics.

Do not let the agent invent advice or treat an alert as proof that urgent care has been handled. Use the practice's approved staffed-hours, response and escalation wording. The workflow must expose unreviewed and failed-delivery states to responsible staff.

### C05 — Read history and request a correction

Offer a paginated list of authorised released visits after verification. Display only the patient projection, never private practitioner notes. Allow selection, reading, a correction request or a patient account of events. Preserve the original signed record and the attribution/status of corrections.

### C06 — Stop messages, permissions and rights

Recognise an unambiguous `Stop` in the relevant messaging context as a request to suppress optional proactive Sanko messages to that contact route. This narrow suppression must not require disclosure of patient records or browser login. Do not interpret it as deletion, tracking withdrawal, a person-wide consent change or suppression of every person on a shared phone.

Persist the suppression and fence queued optional sends before confirming it. If the scope is ambiguous, offer choices and apply the conservative contact-level suppression while resolving person-specific settings. Account-wide/practice-specific tracking changes require verified scope and explicit confirmation. Resume requires an explicit, appropriately verified choice; unrelated conversation must not silently restore reminders.

Provide an authorised route to request export, deletion or recovery in chat. Do not invent retention policy or mark a pending rights request fulfilled. Exports may be delivered as documents only where the recipient, contents, permission and copy-retention implications are appropriate; otherwise explain the exceptional secure fulfilment step.

## 7. Required evidence-dossier owner journey

### E01 — Select and confirm a formulation

List only owned, eligible formulations. Let the owner select one or capture missing information using existing Vault flows. Preserve unknown/withheld composition; the existing service scope and evidence eligibility rules still apply.

Present the exact snapshot for review in manageable messages. Offer `Confirm recipe`, `Change something`, and `Cancel`. Explain and separately confirm the private review purpose and service notice. Bind submission to the recipe and notice hashes. Do not infer authorisation from an earlier conversation or general Vault consent.

### E02 — Submit, check progress and answer questions

Submit once with a durable receipt. Show truthful states such as queued, clarification needed, in review, released or declined. Route an assigned analyst's question to the verified owner, capture their reply, and confirm it where consequential. Preserve attribution; a clarification must not silently modify the confirmed recipe. Composition changes require the established new-snapshot/update process.

### E03 — Review remains independent

Keep the analyst/reviewer/release-manager workspace and exact-revision separation of duties. The owner, agent and ordinary chat tools cannot approve scientific content, impersonate a reviewer or release a draft.

This plan does not add automated literature discovery, research-provider access, efficacy certification, product leaflets, regulatory reports or patient-outcome linking. Preserve existing evidence limitations and permission separation.

### E04 — Deliver the released brief and full dossier

After release, offer `Read summary`, `Send full report`, and `Ask a question` to the verified owner. Use the approved brief, including material uncertainty and limitations, for the chat summary. Do not generate a stronger promotional summary or silently omit negative findings.

Generate the PDF from the exact released report content and immutable source manifest. Include formulation/request reference, report version, release date, review attribution, citations, evidence limitations and a way to check current status. Any translated released report needs its own reviewed language/version; translation must not inherit approval automatically.

Send a document attachment through the authorised WhatsApp transport. Render and inspect representative PDFs for completeness, legibility, page breaks and citation integrity. Record artifact hash, release/manifest association and delivery evidence. Rendering failure must not fall back to an unreviewed model-generated report.

Before first private-document delivery, explain that the recipient will receive a copy they can retain or forward and that later withdrawal cannot recall downloaded copies. Record the explicit delivery choice; do not repeat a lengthy warning on every request unless its scope changes.

Use private server-controlled artifact generation/storage and an appropriate media upload path. Do not publish recipes at an unauthenticated URL to make delivery easier. Recheck ownership, session, current release state and recipient binding immediately before dispatch. Clean up temporary artifacts and provider media under approved retention rules; record cleanup failures for retry.

### E05 — Retrieve, correct and update

`My reports` lists authorised releases; `Send latest` resolves the current valid release at send time. Distinguish historical/superseded versions, and refuse new delivery of withdrawn content. Give corrections and revised releases explicit version labels. Preserve exact wording/version of previously delivered material in the delivery audit without unnecessary duplicate sensitive storage.

Provide a correction-request flow in WhatsApp. Questions about the dossier must be answered from approved content with attribution or routed to the responsible reviewer; do not turn them into personalised prescribing advice. Previously downloaded copies cannot be remotely revoked. Corrections/withdrawal notices require a durable process and appropriate messaging permission.

## 8. Architecture and implementation map

### 8.1 Shared services, separate transport credentials

Implement one set of domain rules, accessible through web and verified channel entry points. Preserve the current private browser routes and CSRF protections. Do not manufacture browser cookies or relax web CSRF to make WhatsApp work.

Refactor or extend care/evidence services and database authorisation to accept a separately validated server-derived channel context. Browser credentials and channel credentials must be purpose-bound and non-interchangeable. No caller or model may supply its own actor identity or capability.

Keep web and channel views on the same authoritative records. Business writes, authorisation checks, confirmation consumption, audit entries and outbound intent should have atomic boundaries appropriate to their shared database.

### 8.2 Durable interaction state

Introduce a persisted conversation/task state machine; an LLM transcript is insufficient. Record the active workflow/step, role and scope, language/copy version, draft revision, outstanding prompt/action challenge, expiry and completion receipt. Protect sensitive state and apply approved retention.

Proposed logical records, with final names chosen after inspecting current schemas:

- Channel bindings and sessions, with verification and revocation history.
- Conversation/task instances and issued prompts.
- Action challenges and operation receipts.
- Locale/versioned question catalogues and semantic answer codes.
- Outbound intents, attempts, provider IDs and delivery events.
- Report artifacts tied to exact release manifests.
- Contact-level optional-message suppression.

Use opaque prompt/button IDs, validate ownership and expiry server-side, and avoid clinical information in IDs. Reject stale replies from a different task, subject or role. Never interpret a translated/truncated label as the source of authorisation.

### 8.3 Transport and reliability

- Extend the Meta adapter for reply buttons, selectable lists, document uploads/sends and delivery status handling. Preserve plain-text equivalents for accessibility and adapter limitations.
- Keep the unofficial Baileys adapter and simulator useful for testing without claiming they qualify production Meta delivery.
- Verify webhook signatures and durable inbound claims; preserve current ordering, leases and replay protections. Add business-operation idempotency beyond message deduplication.
- Persist outbound intent before dispatch. Handle retries, cancellation, opt-out, ownership changes, withdrawal and expiry. Recheck applicable permissions immediately before sending.
- Do not promise exactly-once external delivery where provider acceptance is uncertain. Track ambiguous attempts and reconcile provider status before blind retries; duplicate messages must not duplicate care actions or report submissions.
- Distinguish database save, queued notification, provider acceptance, delivered and read states. Neither delivery nor read receipt establishes clinical review or understanding.
- Recheck the current Meta API version, account eligibility, template rules, messaging windows, opt-in requirements, media limits and relevant data-use terms in an authorised test environment before live delivery. Do not assume a document API alone authorises every care use case.

### 8.4 Expected touchpoints

| Existing area | Required change |
| --- | --- |
| `src/router.js` | Route verified channel tasks before generic model turns; preserve role isolation and inbound durability |
| `src/care/channel.js` | Replace portal-only completion for supported tasks with persisted guided journeys |
| `src/care/auth.js`, `src/care/service.js`, care SQL | Add separately verified channel authority with the same permission/confirmation semantics |
| `src/care/worker.js` | Add durable, permission-aware outbound intents alongside synthetic testing |
| `src/evidence/vault.js`, `src/evidence/service.js`, evidence SQL | Add narrow verified owner actions; keep reviewer powers inaccessible to chat tools |
| `src/evidence/reports.js` and new rendering module | Faithful released-content PDF rendering and artifact integrity |
| `src/services/whatsapp.js` | Lists, documents, provider status and explicit delivery errors |
| `src/utils/choices.js`, agent prompt/tools | Separate casual suggested replies from authoritative action prompts; add reviewed catalogues |
| Existing web interfaces | Keep parity and optional navigation; display state changed through WhatsApp |
| `supabase/` | Add migrations; preserve all applied migration names/checksums |
| Preview/test scripts | Exercise real shared services with fictional actors and a fake transport |

`024_care_review_queue.sql` is already present in the inspected working tree. Confirm migration allocation before adding files; do not overwrite it or invent a migration history. Proposed module and table names in this document are not existing APIs.

## 9. Delivery sequence

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| W0 — Reconcile baseline | Inspect latest working tree, record product decision, map current permissions and preserve existing changes | Baseline inventory and regression results; explicit channel authority design |
| W1 — Guided interaction foundation | Versioned prompts, lists/buttons, durable state, language selection, free-response handoff, bound confirmations and synthetic channel identity | Replay/stale-role/expiry/isolation tests and a usable fictional journey |
| W2 — Care completion | Onboarding/invites, visit capture, patient reply, practitioner review, history/corrections and messaging controls in chat | Patient reply → saved observation → practitioner review → patient retrieval without portal task completion |
| W3 — Evidence completion | In-chat owner confirmation/submission/clarification, released brief and PDF delivery | Request → independent web review → PDF received in fictional WhatsApp transport |
| W4 — Usability and transport qualification | Language/device/shared-phone testing, real provider sandbox delivery, operational and recovery decisions | Measured task completion and named release-gate evidence |
| W5 — Limited live release | Explicitly authorised cohort, environment, migrations and staffed workflow | Controlled rollout, failure monitoring and tested rollback |

W2 and W3 may proceed independently once their W1 dependencies are satisfied. Do not wait for speculative later features to finish the first useful care and evidence loops.

Keep live capabilities off during normal implementation. Use separate care, evidence-delivery and guided-flow gates, with dependencies validated at startup. Do not weaken the current synthetic-only checks in place; design and qualify the separate live-release path explicitly.

Existing user direction authorises writing/building the requested experience; unresolved live identity, retention and operational decisions do not block unrelated synthetic implementation. They do block claiming readiness for real users.

## 10. Acceptance criteria

Run against persistent disposable database state and the real domain services where relevant. A mocked chatbot that merely prints successful messages is insufficient.

| ID | Scenario | Required result |
| --- | --- | --- |
| WA01 | New user taps through a task | Guided progress; free text/voice remains available |
| WA02 | User changes language mid-task | Same task, semantic choices and draft; reviewed copy or honest language limitation |
| WA03 | Voice/photo is unclear | Clarification and editable draft; no invented facts or automatic confirmation |
| WA04 | Old button after role/subject switch | Rejected safely; no cross-context write or disclosure |
| WA05 | Duplicate webhook or repeated confirmation | One business action and stable receipt |
| WA06 | Expired session, forwarded prompt or guessed code | No private disclosure; appropriate fresh verification |
| WA07 | Shared/recycled phone | No automatic identity merge or access to earlier owner's history |
| WA08 | Invitation sent to wrong person | Cannot activate another patient's relationship |
| WA09 | Patient completes a check-in in chat | Confirmed observation saved against the correct encounter without a portal form |
| WA10 | Patient says worse, unchanged, unsure or gives mixed detail | Faithful attributable report; no implied benefit or invented clinical response |
| WA11 | Practitioner reviews from chat | Authorised queue → confirmed review → attributed patient-visible next steps |
| WA12 | Patient requests visit/correction | Released projection only; original signed record preserved |
| WA13 | Practitioner captures and signs visit in chat | Source-backed exact-revision record; sign/release/completion remain distinct |
| WA14 | Stop races with queued optional send | Suppression persisted and applicable pending send prevented; honest scope confirmation |
| WA15 | User later sends an unrelated message | Optional reminders stay suppressed until explicit resume |
| WA16 | Owner submits evidence through buttons | Exact recipe/notice binding; one request, no implicit consent |
| WA17 | Recipe changes during confirmation | Conflict and fresh review; old snapshot not silently replaced |
| WA18 | Owner answers analyst question in chat | Attributed reply reaches the assigned workflow; recipe remains immutable |
| WA19 | Agent or owner attempts reviewer approval | Denied, including forged role/action inputs |
| WA20 | Released dossier requested in chat | Authorised brief and faithful PDF delivered without portal retrieval |
| WA21 | Draft, withdrawn or other owner's dossier requested | No content disclosure or delivery |
| WA22 | Revocation/withdrawal occurs before queued delivery | Final authorisation/state check stops new dispatch; accepted-send boundary recorded |
| WA23 | PDF generation or upload fails | No false success; durable retry/error state; no public-data fallback |
| WA24 | Provider acceptance is ambiguous | Reconciliation/visible uncertainty; no duplicate business mutation |
| WA25 | Delivery callback arrives twice or out of order | Idempotent state handling; no regression from stronger delivery evidence |
| WA26 | Browser reads an item changed through chat | Same record/version/permissions; no duplicated separate history |
| WA27 | Membership revoked, tracking withdrawn or audit fails | Subsequent unauthorised reads/writes fail closed |
| WA28 | Recovery or deletion requested | Real status and approved process; pending request never labelled fulfilled |
| WA29 | User cancels or resumes after interruption | No unintended commit; correct draft recap and fresh confirmation |
| WA30 | New feature disabled | Working legacy Vault preserved; unavailable actions not advertised as functional |

Test presentation and actual device interaction as well as backend behaviour. Exercise all enabled languages for consequential copy, accessible text fallbacks, long names, pagination and realistic network interruption. Inspect PDFs visually, not only by checking that bytes exist.

Run repository-required checks: backend lint, regression tests, secret scan and repository checks; disposable PostgreSQL care/evidence suites; and relevant browser/channel walkthroughs. Run landing lint/build only if that code changes. Record exact command/environment/results; distinguish tests personally run from existing documentation claims.

## 11. Usability measures and release decisions

Measure completion per task, number of taps/messages, abandonment step, correction rate, authentication interruptions, web handoffs, time to complete, and need for assistance. Compare guided choices with free-response input using intended users; fewer taps alone is not evidence of comprehension.

Product acceptance targets, to validate rather than advertise as achieved:

- After approved verification, routine check-in submission and released-dossier retrieval require no portal task completion.
- Users can finish menu/confirmation steps without typing; genuinely new names, recipes and narratives still permit their own words.
- Uncertainty, corrections and unwanted outcomes remain as easy to report as positive outcomes.
- Users understand whether an update is saved, awaiting review or reviewed.
- Repeated authentication and shared-device failures are measured separately from ordinary task speed.

Before live use, record decisions and evidence for identity/recovery, session assurance, shared-device support, reviewed language/notice copy, contact suppression semantics, care responsibility/response hours, document-copy permission, provider data handling/retention, migration/backup recovery and actual Meta/Auth qualification. Assign owners to unresolved items. Do not turn these into repetitive user permission prompts for routine implementation work.

Roll back by disabling the affected channel capability and stopping its outbound queue while preserving records, permissions, receipts and audit history. Keep messaging suppression enforceable even when a workflow is disabled. If using a temporary portal fallback, state it clearly and do not label it in-chat completion.

## 12. Implementation handoff

Implement this specification in the current canonical `sanko-core` repository. First inspect and preserve the current working tree; do not overwrite concurrent work or rewrite applied migrations. Record the user's WhatsApp-first product decision in the source-of-truth and affected implementation documents.

Build the guided conversation and verified channel foundations, then complete the synthetic care and evidence owner journeys through real shared services. Preserve independent scientific review, source fidelity, free practitioner access, role isolation and permission boundaries. Do not deploy, migrate production or enable real-patient messaging as a side effect.

Report completion by workflow and evidence: what finishes inside WhatsApp, what still requires exceptional verification/web access, which tests passed, and which live-release decisions remain open. Do not declare this specification fulfilled by adding menus, portal links or prompt instructions alone.

## References

- Repository baseline and implementation files listed in sections 2 and 8; the baseline includes uncommitted changes.
- [Meta-maintained interactive-message reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/) — archived SDK documentation supporting the interaction concepts, not a current production qualification.
- [Meta-maintained document-message reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/document/) — document delivery capability.
- [Current Meta reply-button documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages) and [list-message documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages) — revalidate during implementation; direct retrieval returned HTTP 429 during this planning session.

This file specifies the work. It does not claim that the proposed channel workflows, PDF delivery or live authentication have been implemented or validated.

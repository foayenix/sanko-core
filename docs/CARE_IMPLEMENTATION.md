# Patient continuity implementation and release boundary

## P00 evidence

On 30 September 2026, refreshed `origin/main` and working HEAD both resolved to
`5dddddfe0ee74129c4bb907db4de28681f92645f`, exactly the specification baseline.
No archive merge is needed. The working tree was clean before implementation.
Read both supplied specifications, AGENTS.md, PRODUCT.md, PRIVACY.md, README.md
and docs/MIGRATION_BACKLOG.md; inspected routing, tools, rights, exports and SQL.

Baseline: `npm ci`, lint, secret scan and repository checks passed. All 541
backend tests passed outside the filesystem sandbox (local HTTP listeners are
blocked inside it). This is offline code evidence, not clinical validation.
Historical migrations 001–019 (018 follows 016) must retain their Git checksums.
Runtime is CommonJS / Express 5.2.1 / Supabase, despite README's old Express 4 line.
No production credentials/configuration, deployment commit, database migration
ledger, WhatsApp service, model server or incident-response process was inspected.
Production status remains unverified; no deployment or production migration is
part of this change.

## P01–P03 decisions

Unknown senders choose My care / My vault before practitioner creation. Existing
Vault accounts retain registration, consent, tools, media and private history.
My care never enters the Vault agent. Mixed switch/content batches and content
older than a role change ask for clarification. Role selection is navigation,
not authentication or access to patient data. Channels do not return clinical
content; the synthetic care portal uses separate sessions.

Migration 020 separates actor, auth principal, contacts, subject, representation,
practice, membership, relationship, legacy link, session and audit. Direct client
access is denied. The backend rechecks permissions on every operation. A phone
is never a global identity key. Caregiver representation is modelled but denied.

`care_backfill_identity()` is a resumable operator-invoked, 1,000-row batch.
It creates one provisional subject per legacy row and a sole-member practice per
practitioner; no cross-practice merges, consent upgrades or verified links. Run
only in an approved rehearsal/deployment, until `provisional_links_created` is 0.
The legacy PT/TX path remains authoritative for legacy records. New care has a
separate write path and never fabricates WhatsApp consent evidence.

Selected authentication implementation: individual Supabase Auth credentials,
server-side opaque hashed sessions, 30-minute expiry, CSRF binding, logout and
fresh membership/actor checks. Clinical signing and exports require a login in
the last 10 minutes. Explicit principal binding is required; login cannot infer
one from a phone, email or patient reference. Real identity enrolment/recovery
is not approved. Synthetic fixtures prebind principals; lost access routes to
review without revealing a candidate history. An approved live recovery runbook
must define independent evidence, reviewers, contact change, notifications and
session revocation. No phone-only recovery or automatic demographic merge.

## Release gates

All new capabilities default off and the care backend additionally requires
synthetic actors, subjects and practices. Real-patient activation is deliberately
unavailable. Keep contributor terms off. Public demonstration data stays separate.

Before a live release: approve identity/claim/recovery and retention policy;
review patient notices and legal roles; name staffed clinical responsibility,
response hours, escalation wording and local contacts; rehearse backup restore
and migration; qualify Supabase Auth and Meta on an authorised test environment;
review language/media usability with humans. PRIVACY.md still needs verified
data-residency statements, consistent logging language and an approved incident
procedure. These are operational decisions, not values inferred by this code.

## Implemented R1 slice

The private `/care/` interface uses the existing Express/CommonJS stack and
Supabase/PostgreSQL operations. It covers fictional adult self-onboarding,
recipient-bound invitation/acceptance, explicit tracking and message choices,
walk-in arrival, source-backed drafts (including no preparation or multiple
preparations), exact-revision signing, separate summary release, explicit visit
completion, synthetic inbox follow-up, patient response, practitioner review and
later retrieval. Original practitioner notes are available only to authorised
practice members; patients receive the released projection. Patient corrections,
past visits and product/allergy narratives retain patient-reported attribution.
Signed changes create amendments. They do not overwrite the original.

All clinical source in this slice is practitioner-entered text. Summaries and
reported uses must be literal passages from that source. No model writes clinical
facts, consent, identities or permissions. Preparation versions are checked when
signing and snapshots persist through later Vault edits/deletion. Unknown or
withheld composition is explicit; nothing calculates or implies safety.

The visual direction extends the repository's indigo/mineral/chartreuse identity
and D1 mark with a plain source-attributed timeline. It uses existing browser
APIs, no new frontend framework, no external assets/analytics and no browser
storage. Visible actions call authorised APIs; no static clinical examples ship
in the portal. Public landing/demo data is untouched. Login, logout, expiry and
page restoration clear private UI state; clinical responses are `no-store`.

## API and permission contract

`POST /care/api/login` accepts `{email, password}`. The server verifies an
individual Supabase Auth principal and an explicit actor binding, then returns a
CSRF value and sets an HttpOnly, SameSite=Strict cookie scoped to `/care` (Secure
in production). The browser never receives Supabase provider/service credentials.
`POST /care/api/action` requires the configured exact Origin, the cookie and
`X-Sanko-CSRF`. Unknown fields/actions are rejected by `src/care/service.js`.

The request envelope is `{action, role, subject?, practice?, data?, key?,
confirmation?}`. Actor identity comes exclusively from the session. UUIDs are
locators, never authority. Every call rechecks the subject representation or
active membership/relationship. Receptionist and caregiver access is denied in
this slice. Practice membership never grants access to the actor's own patient
history. Reads and writes append audit evidence in the same transaction; audit
failure prevents the response. Direct `anon`/`authenticated` table/RPC access is
denied. Only the trusted backend service role can invoke care functions.

| Operation group | Actions and required `data` |
| --- | --- |
| Account | `me`, `logout`, `revoke_sessions`: empty; `onboard`: `display_name` |
| Relationship | `invite`: exact `reference`; `invitations`: empty; `accept_invite`/`decline_invite`: `id`; `preferences`: `purpose`, `granted`, `expected_revision` |
| Encounter | `arrive`: `visit_key`, `occurred_at`; `transition`: `encounter_id`, `expected_revision`, `status` |
| Note | `draft`: `encounter_id`, `expected_revision`, `source_text`, `summary`, `preparations`; edits additionally `note_id`, `note_revision`; amendments additionally `amends_id`, `reason` |
| Confirmation/release | `sign`: `encounter_id`, `note_id`, `note_revision`, `expected_revision`; `release`: `encounter_id`, `note_id`, `note_revision` |
| Follow-up | `schedule`: `encounter_id`, `due_at`; `respond`: `id`, `expected_revision`, `report`, `observed_at`; `review`: `id`, `expected_revision` (nullable for a standalone report), `next_steps` |
| Patient assertion | `patient_report`: `kind` (`past_visit`, `correction`, `product_report`), `report`, `observed_at`, optional `encounter_id` |
| Read/rights | `timeline`: optional `cursor`/`before`; `access_history`: optional `before`; `draft_detail`/`note_source`: `encounter_id`, `note_id`; `formulations`, `today`, `export`: empty; `rights`: `kind` (`deletion` or `recovery`) |

A preparation accepts `label`, optional `reported_use`, optional
`formulation_code` plus `formulation_updated_at`, and explicit
`disclose_composition`. Unrecognised clinical/botanical fields are refused.
All times require ISO timestamps with an explicit offset. Mutations require a
client-generated UUID `key`; replay returns the same result and a changed payload
under the same key conflicts. Clinical/consent/release/export/rights operations
first call `prepare` with `{action, data}` and submit its single-use confirmation.
The five-minute token binds actor, session, role, subject, practice and exact
payload. Signing additionally compares note, encounter and preparation revisions.

A timeline page returns up to 50 encounters, observations and follow-ups each,
plus `next_cursor`. Pass that value unchanged as `data.cursor`; each collection
uses a timestamp/UUID pair, preserving equal-timestamp items. Each page is freshly
authorised. Patient exports contain all released history, reports, consent and
access history. Practice export is scoped to one selected patient at that
practice; there is no bulk practice export. Private unrelated Vault data and
undisclosed recipes are excluded. The access-history UI shows the latest 50;
the complete history is included in an export.

Errors use `{error: CODE}`: 400 invalid input/action, 401 expired/revoked session
or fresh login required, 403 CSRF/consent, 404 unavailable scope or feature,
409 stale revision/idempotency/confirmation/state, 422 unsupported source, 429
rate limit, 503 unavailable service/audit. Resource failures use neutral messages.
A 401 clears the UI; a conflict requires reload and a new review. Rate limits (10
sign-ins and 120 actions per client per minute) are counted in PostgreSQL by
migration `025_portal_rate_limits.sql`, so they hold across server processes. The
client is an HMAC of its IP under `PORTAL_RATE_LIMIT_KEY`; no IP is stored. Without
the key, or if the count cannot be read, requests are refused with 503. Behind a
proxy, `TRUST_PROXY` must name it or every visitor shares one limit. This is not yet
qualified against a real deployment's proxy chain or load.

## Migrations, configuration and rollback

Care uses `020_care_identity.sql`, `021_care_workflow.sql`, and the additive
`024_care_review_queue.sql`, plus `025_portal_rate_limits.sql`, which both portals
need. Historical SQL is unchanged. Apply through the existing checksum-ledger runner only in
an explicitly approved environment. **020 is a prerequisite for the new role
router even while care access is off.** Without it, message processing fails
closed; it must not silently fall back to automatic practitioner creation.
021 adds the care workflow and explicit training-source classification. Existing
corrections default to `unreviewed` and cannot enter training exports. Contributor
terms remain disabled even for a stored historical acceptance.

All `CARE_*_ENABLED` values in `.env.example` default false. Access also requires
`CARE_SYNTHETIC_ONLY=true`, `PATIENT_TRACKING_ENABLED=true`, `AGENT_TOOLS=full`, an
exact `CARE_ORIGIN`, individual test Auth principals and explicitly synthetic
actors/practices/subjects. Encounter operations require
`CARE_ENCOUNTERS_ENABLED=true`. `SUPABASE_ANON_KEY` is used by the server Auth
adapter; existing service credentials remain server-only. Later booking,
caregiving, sharing, referrals, medication review and interaction flags are
rejected at startup if enabled. No care outbound Meta transport exists.

Rollback: disable care flags and retain both additive schemas and records. Keep
the safe role router and legacy consent adapter. Reverting to the old application
would restore automatic unknown-sender provisioning and is not a safe routing
rollback. Never drop continuity tables or erase history to roll back a feature.
The provisional backfill is explicit and repeatable; it confers no live access.

## Reproducing synthetic verification

Use Node as declared in `package.json`, PostgreSQL 16 tools on PATH, and a
**dedicated local test cluster** whose owner may create/drop databases. Create
`anon`, `authenticated`, and `service_role BYPASSRLS` roles once in that cluster.
No production URL or key is needed. For example, with a cluster on port 55439:

```sh
npm ci
npm run lint
npm test
CARE_TEST_DB_URL=postgresql://localhost:55439/postgres npm run test:care
npm run check-secrets
npm run check-repository
CARE_TEST_DB_URL=postgresql://localhost:55439/postgres npm run preview:care
```

`test:care` creates its own random database, applies all migrations twice, runs
real SQL concurrency/permission/HTTP tests, restores a synthetic dump to another
owned database, then drops both. It does not reset the database in the URL.
The preview likewise owns a fresh random database and drops it on SIGINT/SIGTERM.
It listens on loopback port 3041 (override `CARE_PREVIEW_PORT`). Fixture accounts
are `patient@example.invalid` and `practitioner@example.invalid`, password
`synthetic-only`; their login verifier is injected only in this local script.
They are not production credentials or an application authentication bypass.
`CARE_PREVIEW_CLOCK` can advance only the synthetic dispatcher clock; it does not
change consent/session/confirmation expiry. Future-dated check-ins can therefore
be demonstrated without waiting or sending messages. The standalone preview must
never be served publicly or pointed at real records.

## Verification record and remaining dependencies

The baseline was re-fetched on 1 October 2026 and still matched the pinned SHA.
The final backend regression suite passed 547 tests; lint passed. PostgreSQL
acceptance passed 19 tests (18 scenarios plus their parent test) and covers role isolation (including stale/same-second envelopes), shared
contacts without identity merge, invitation binding/expiry/decline, concurrent
arrival and replay, competing editors, supported source, stale signing, immutable
snapshots/amendments, scoped reads/exports, suspension, audit failure, consent vs
worker races, missing responses, review/retrieval, legacy guards, SQL role denial,
real HTTP cookies/CSRF/logout, stable history pagination and synthetic dump/restore.
AT numbers in test names identify the exercised portion, not certification of
all scenarios in the roadmap. AT24 has separate training-export tests.

Browser verification exercised onboarding → invitation → walk-in → draft with a
preparation → confirmation/signing → release → completion → synthetic inbox →
patient response → practitioner review → sign-out/sign-in → retrieval. Follow-up
checks covered draft edit/save, human-readable confirmation and removal of private
DOM state on logout. Desktop and 390px mobile checks found no horizontal overflow,
console errors, or browser storage entries. These checks use real authorised
care API/SQL operations with an injected **fictional** identity provider.

During regression work, a missing transport stub caused unauthenticated Meta
requests that returned 401; no successful delivery was reported. The stub was
fixed and `npm test` now preloads a loopback-only network guard. The final run
contains no external-network attempts. Offline success is not deployment,
clinical validation, language accuracy, recruitment or real-world adoption.

P00–P03 code foundations and the synthetic R1 loop are reviewable. **P02's approved
identity/recovery design and P08 live qualification are still open.** There is no
live enrolment, reviewed duplicate merge/legacy claim, caregiver/staff delegation,
booking, cross-provider share/referral, interaction advice, multilingual/media
care entry, operational escalation or automatic clinical monitoring. Product and
allergy capture is narrative only; no medication reconciliation is implied.
Deletion/recovery requests enter `pending_policy_review`; no retention rule is
invented and no records are erased. The UI does not claim a request is fulfilled.

Next dependency: approve the identity/recovery, notice and retention decisions,
then qualify the chosen Auth provider and staffed clinical workflow in an
explicitly authorised environment. Complete the approved recovery and care-rights
operations before considering a real-patient R1 release. A local synthetic
restore test does not qualify production backups or a deployment rollback.

## WhatsApp-first completion — 2 October 2026

The product decision to complete everyday care work inside WhatsApp supersedes
the portal-only completion described in the handoff section below, for the
flows listed in [WHATSAPP_CHANNEL_IMPLEMENTATION.md](WHATSAPP_CHANNEL_IMPLEMENTATION.md).
Patient reports, consent changes, review, signing and release can now be
confirmed in a verified WhatsApp channel session that calls the same
`care_action` operations, with the same exact-action confirmations. The
portal remains the place to issue the one-time link code. The handoff below is
still what runs when `CHANNEL_GUIDED_ENABLED` is off.

## WhatsApp care handoff and review completion — 2 October 2026

The WhatsApp patient route now offers generic navigation to the authenticated
synthetic portal when `CARE_WHATSAPP_HANDOFF_ENABLED=true`. This defaults off
and requires the existing synthetic care flags. `CARE_ORIGIN` must be an exact
HTTPS origin; local HTTP is accepted only on loopback outside production.
`My visits`, `Check-ins`, `Privacy`, `My reference`, and `Care inbox` return public
navigation destinations, never patient identifiers, sessions or access tokens.
`Stop` directs the person to authenticated choices and explicitly says that no
preference changed in chat. Patient text/media does not become a clinical report
or enter the Vault model. A stale patient-menu button after switching to Vault
asks for a fresh role selection. Existing legacy invitation replies are unchanged.

This completes a **synthetic WhatsApp-to-portal loop**, not an in-chat clinical
workflow or an outbound Meta reminder service. Patient reports, consent changes,
and practitioner review still require individual portal sign-in and exact-action
confirmation. Forwarding a navigation link grants no access. Follow-ups remain
synthetic inbox deliveries, and live qualification gates above remain open.

The practitioner portal now displays an actionable review inbox before patient
selection. The `review_queue` action takes an empty `data` object, practitioner
role, selected practice and no subject. Migration 024 adds a service-role-only
RPC that checks the current session, CSRF, membership, synthetic scope, tracking
permission and audit storage before returning the oldest 50 unreviewed reports.
Each result includes its patient reference and current follow-up revision.
Review uses the existing confirmed operation; reviewing an item removes it from
the queue and makes the attributed next steps available to the patient. Older
reports remain actionable even when absent from the first timeline page. A full
batch explicitly asks the practitioner to review and refresh for more reports.
With encounters disabled, the queue is hidden and its API rejects access.

Patient check-ins precede the visit history and distinguish an unanswered report
from a report awaiting review. Refresh reloads account and practice scope. Public
URL fragments select a destination only after authentication; the same-tab
sign-in path and sign-out clearing were verified.

`preview:care` now includes `/whatsapp`, a loopback-only fictional message form
using the real role routing and handoff code. It accepts only fixed navigation
commands and never calls Meta or a model. Continue through the returned portal
link using the documented fixture accounts. The preview database is disposable.

Verification: 549 backend tests on the isolated care branch and 21 PostgreSQL
care tests passed, including
migration replay and dump/restore, generic WhatsApp entry, isolation from the
Vault model, old-report review, cross-practice denial, CSRF, withdrawn tracking,
revoked membership, audit failure and direct SQL-role denial. Lint, secret scan
and repository checks passed. Browser verification covered fictional channel
entry, individual sign-in, enrolment, invitation, tracking/message choices,
walk-in, source-backed signing/release/completion, synthetic dispatch, patient
response, inbox review, and patient retrieval after signing in again. Desktop
and 390px mobile inspection found no horizontal overflow; browser warnings and
errors were empty. No live Auth, Meta, clinical, language or production claim is
made from these checks.

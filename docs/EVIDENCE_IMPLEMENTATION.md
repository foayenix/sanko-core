# Formulation evidence implementation and release boundary

## Baseline and scope

On 1 October 2026, implementation started from a clean checkout at
`811fb3be7ce2789963a777ade4385f038dc92920`. Refreshed `origin/main` was
`5dddddfe0ee74129c4bb907db4de28681f92645f`; refreshed
`origin/codex/patient-continuity` was `3358998271540d869e86dde9c6d1f2be6a346069`.
The latter adds only care mobile-layout changes. This work uses local branch
`codex/formulation-evidence` based on 811fb3b and does not merge or deploy either
remote branch. Existing migrations 001–021 remain unchanged, including the
historical 017 gap. New migrations are 022 and 023. No production migration
ledger, deployed commit, credentials or live records were inspected.

The supplied [implementation plan](SANKO_FORMULATION_EVIDENCE_IMPLEMENTATION_PLAN.md)
is the specification, not verification evidence. This change implements an E0
manual, persisted, fictional workflow and prepares the service boundary for an
E1 pilot. It does not complete the plan's human scientific/practitioner evaluation,
operational approvals, or later releases.

## Implemented workflow

- Individually verified Supabase Auth login with explicit evidence principal
  bindings; hashed 30-minute sessions, exact Origin, CSRF, logout, and 10-minute
  fresh authentication for approval, release, withdrawal and rights actions.
- Separate owner, analyst, reviewer, release-manager and programme-admin contexts.
  Capability and resource assignment are checked on every call. Programme admins
  see operational metadata, not recipes. Existing admin/legacy Basic Auth confers
  no evidence rights.
- Only operator-enrolled fictional formulations and synthetic principals are
  eligible. No implicit intake of existing Vault recipes or care patients.
- Owner intake, limited ingredient-overview scope, immutable recipe snapshot,
  exact recipe/service-notice confirmation, submission and durable manual queue.
  Missing values and unresolved botanical identity remain visible. Source edits
  between preview and submission conflict.
- Capacity/triage, explicit analyst/reviewer assignments and revocation, waitlist,
  decline, focused questions and attributed owner replies. Replies do not edit
  the Vault or rewrite confirmed composition. Recipe changes require a new request.
- Manual search protocol, executed queries/dates, coverage failures, source
  metadata/access/licence/status/screening, extraction/locator/applicability,
  study quality, finding direction and claim provenance. No external fetching,
  document parsing, model call or private-data provider fallback exists here.
- Separate practitioner brief and technical dossier, including the evidence
  table, source decisions, uncertainty and research gaps. Outputs are escaped,
  deterministic, printable HTML. No PDF renderer or uploaded source PDFs.
- Every draft save creates an immutable revision, including both report bodies
  and the source/extraction manifest. An independent assigned reviewer signs the
  exact manifest, audience and English language after recording review checks,
  reason and competence snapshot. The author cannot approve or release their
  own report, even if they hold those capabilities.
- Atomic private release, authenticated downloads, current source-version warning,
  correction requests, new report revisions, linked update requests, supersession
  and immediate withdrawal from future downloads. Negative findings are valid.
- Owner export, cancellation, and deletion. Evidence-only deletion disables the
  evidence principal and erases owned evidence; it does not delete Vault recipes.
  Vault account deletion fences evidence before fallible media cleanup and erases
  private evidence via a database trigger. An unbound disabled signer tombstone
  preserves other owners' immutable attribution without retaining login/name.
- Narrow Vault tools prepare intake drafts and return status or released metadata.
  Intake replay is durable against the verified inbound message IDs. Neither the
  model nor its tools can confirm, consent, sign, release, or retrieve report text.
  Human confirmation takes place in the verified portal in E0; there is no live
  WhatsApp confirmation or notification path.

The UI follows Sanko's indigo/mineral/chartreuse palette and existing D1 mark.
A request ledger and visible recipe/review history are the distinguishing layout.
It uses CommonJS/Express plus plain responsive browser JavaScript, no new UI
framework, external assets, analytics or browser storage. No external component
inspiration was used. Logout, expiry and restored navigation clear private DOM.

## Persistence and integrity

022 contains identity, sessions, fictional enrolment, programmes, owner-scoped
requests, snapshots, authorisations, assignments, revisions, decisions, releases,
manual jobs, corrections, confirmations, idempotency and audit. 023 adds the
transactional dispatcher, narrow Vault adapter, account-erasure trigger and
content-free denied-action auditing.

RLS is enabled throughout. Anonymous/authenticated roles have no table/RPC access;
the backend service role also has no direct table writes or reads. Only scoped
security-definer functions are granted, with a fixed `public,pg_temp` search path.
The backend verifies every action before invoking these functions. Snapshots,
reports, decisions and audit history reject ordinary updates. Cross-owner
snapshot and update-request relationships use composite foreign keys.

Mutable requests carry numeric revisions. Request locking and actor-scoped
idempotency serialize competing editors and duplicate submissions/releases.
Confirmation tokens are five-minute, one-use, session/action/payload/revision
bound. The database constructs and checks the authoritative JSONB SHA-256 hashes.
Snapshot, report content, sources/extractions, both HTML bodies, audience and
language are covered by the immutable manifest. The download wrapper adds current
distribution/currency status and review metadata; it is not part of the signed
report body. A changed source blocks new release; prior history remains readable
with a warning unless withdrawn or erased.

Both artifacts are small database-held text objects. There is no upload/render
worker or object-store partial-success window in E0. Jobs represent durable manual
review work; they are not an AI/background-search queue. Cancellation checks and
row locks fence every manual write. External storage, worker leases/retries,
notifications/outbox, automated source discovery and full-text licensing need
separate implementation before they can be enabled.

Scientific validation is partly structural: metadata-only/retracted support,
missing locators, structured ingredient-to-mixture upgrades and preclinical-to-
clinical claims are rejected. This is not semantic verification of every sentence.
The independent reviewer must check the actual sources and all prose. Software
tests do not establish botanical identity, model accuracy, safety or efficacy.

## API and local exercise

`POST /evidence/api/login` accepts only individual credentials and returns a CSRF
value with an HttpOnly, SameSite=Strict session cookie scoped to `/evidence`;
production cookies are Secure. `POST /evidence/api/action` accepts:

```json
{"action":"get","role":"owner","request_id":"UUID","data":{}}
```

Mutations additionally require `expected_revision` for an existing request and a
UUID `key`. Protected actions first call `prepare` with the same envelope and
`data: {"action":"submit", "data": {...}}`, then submit its `confirmation` token.
Role is a context selector; it never supplies a capability or identity. Unknown
fields/actions are rejected. Private actions, including downloads, require CSRF.
Artifact responses are attachments with `no-store` and a script-blocking CSP.
There are no public artifact URLs. Owner exports exclude reviewer-only drafts and
withdrawn artifacts. Lists page by timestamp/UUID with a 50-item bound.

Provisioning is deliberately operator-only. An E0 fixture needs independent
fictional principals, a synthetic formulation enrolment, a programme with capacity,
a reviewer profile explicitly covering `ingredient_overview`, and assignments.
Do not use fixture strings to provision real people or demonstrate qualification.

Use PostgreSQL 16 tools on PATH and a dedicated loopback test cluster with `anon`,
`authenticated`, and `service_role BYPASSRLS` roles. No production credentials:

```sh
EVIDENCE_TEST_DB_URL=postgresql://postgres@127.0.0.1:55441/postgres npm run test:evidence
EVIDENCE_TEST_DB_URL=postgresql://postgres@127.0.0.1:55441/postgres npm run preview:evidence
```

Both commands create random databases they own. They never reset the supplied
database; the test runner applies migrations twice and removes its databases.
The preview serves `http://127.0.0.1:3042/evidence/` and removes its database on
SIGINT/SIGTERM. Fictional accounts: `owner`, `analyst`, `reviewer`, `admin`,
`release` at `@example.invalid`, password `synthetic-only`. The injected identity
verifier exists only in the loopback preview; deployed routes use Supabase Auth.

## WhatsApp owner actions — 2 October 2026

The statement above that owner confirmation happens only in the portal is
superseded for verified WhatsApp channel sessions (see
[WHATSAPP_CHANNEL_IMPLEMENTATION.md](WHATSAPP_CHANNEL_IMPLEMENTATION.md)).
Owners can confirm the exact recipe and service notice, answer questions,
cancel, read the released brief, receive the full report as a PDF and request
corrections in chat. The channel wrapper fixes the role to owner and calls the
same `evidence_action`; confirmations made there are recorded with channel
`verified_whatsapp`. Analyst, reviewer and release work stays in the portal.
The narrow Vault agent tools are unchanged and still cannot confirm or release.

## Release gates and deliberate exclusions

All evidence flags default off except the synthetic-only safeguard. Startup rejects
live pilot, AI, external search, notifications, sharing, leaflet, regulatory and
outcome-linking flags. Enabling evidence requires a valid exact origin and
`EVIDENCE_SYNTHETIC_ONLY=true`. No care or contributor-term setting is changed.

Before E1: approved service notice/retention/processor arrangements; verified owner
and reviewer enrolment/recovery; named analyst and independent competent reviewer;
conflicts process; live deployment/migration/backup/deletion rehearsal; report and
language review by qualified humans; practitioner usability evaluation; staffed
capacity, incident ownership, support, and qualifying the shared rate limiter
(migration 025, `PORTAL_RATE_LIMIT_KEY`, `TRUST_PROXY`) against the real proxy
chain and load. Real Supabase Auth and Storage,
WhatsApp delivery and scientific usefulness remain unqualified.

E0 does not implement delegated intake, botanical-specialist tasks, validated
formulation-assessment readiness, full-text ingestion, language-specific releases,
programme cost accounting, sponsor reporting, patient linking, recipient grants,
product leaflets or regulatory preparation. A linked update is newly confirmed and
reviewed; reuse/discovery automation is absent. The broader Vault account-export
Storage lifecycle still needs a live deletion-race rehearsal; evidence portal
exports/downloads themselves are database-backed and have no external objects.

Rollback disables `EVIDENCE_ENABLED` and retains schema/history. Keep account-rights
support active even when intake is disabled. Both new migrations are required for
this application version's account export/deletion paths, and migration 025 for its
rate limits; do not deploy the code without the additive schema. Do not modify already-applied migration checksums.

## Verification record

Validation results are recorded after the implementation, separately from the
specification. See the accompanying change summary for final command results.

Local verification on 1 October 2026:

- Backend regression: 552 tests passed, no skips (offline transport guard enabled).
- Evidence: 5 foundation checks plus 21 PostgreSQL tests passed, no skips.
  The SQL suite includes two migration passes, ownership, unknown/withheld facts,
  durable replay, competing edits/releases, source drift, expired confirmation,
  fresh auth, self-review refusal, suspension/revocation, required-audit rollback,
  direct SQL denial, private HTTP cookies/CSRF/logout, negative report release,
  withdrawal, corrections, linked updates, capacity, cancellation/deletion fencing,
  and dump/restore. AT labels cover exercised portions, not every later-stage
  acceptance criterion in the specification.
- Existing care SQL/HTTP/restore regressions: all 19 tests passed.
- Lint, secret scan, repository checks and whitespace checks passed. Historical
  migrations remain byte-for-byte unchanged. No landing sources were edited.
- Browser: fictional owner intake → exact recipe/service confirmation → admin
  assignment/acceptance → analyst question → owner reply → manual source and
  report entry → independent review/approval → private release → owner downloads
  of both outputs → correction request. Logout cleared private DOM; owner view
  contained no reviewer draft; no localStorage/sessionStorage entries. The 390px
  phone view had no horizontal overflow, and final browser error inspection was
  empty. Desktop/phone layouts were inspected. This exercised real HTTP and SQL
  with a fixture identity verifier, not real Supabase Auth or scientific review.

Browser testing found and fixed a null-report response/rendering bug before the
first draft existed. SQL testing found and fixed account-erasure foreign-key
ordering. Both have regression coverage. Live authentication qualification,
scientific/practitioner evaluation and the operational gates above remain open.

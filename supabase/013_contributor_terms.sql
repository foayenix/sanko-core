-- 013 — Make "Nagoya-aligned" a mechanism instead of a posture.
--
-- Everything before this establishes that a practitioner's knowledge is theirs:
-- deny-all RLS, per-practitioner scoping, provenance on every mapping, export
-- and delete on request. All of it is about custody.
--
-- None of it answers the question an institutional partner asks second:
-- if this knowledge is ever used beyond the practitioner's own Vault — a
-- research licence, a dataset, a publication — what did the practitioner agree
-- to, and what do they get? Until there is a record of both, "Nagoya-aligned"
-- describes an intention rather than something anyone can rely on.
--
-- Two things, deliberately small:
--
--   acceptance    which version of the contributor terms a practitioner agreed
--                 to, when, and how. Versioned and hashed, because terms change
--                 and consent to one version is not consent to the next.
--
--   a ledger      every use of contributed knowledge outside the Vault, what it
--                 covered, which practitioners contributed to it, and what was
--                 agreed in return. Append-only in practice: a benefit-sharing
--                 claim that can be edited afterwards is not evidence.
--
-- What this migration does NOT do is decide the terms. governance/ holds a draft
-- that has had no legal review and no practitioner consultation; both are
-- prerequisites, and neither is a schema problem.
--
-- Run with: npm run migrate

alter table practitioners
  add column if not exists contributor_terms_version    text,
  add column if not exists contributor_terms_accepted_at timestamptz,
  -- 'whatsapp_reply' | 'in_person' | 'written' — how the agreement was given.
  -- An in-person or written acceptance is stronger evidence than a chat reply
  -- and the record should be able to say which it was.
  add column if not exists contributor_terms_method     text,
  -- Content hash of the exact terms text they accepted. The file in governance/
  -- can be edited; this cannot be edited into agreement with it.
  add column if not exists contributor_terms_hash       text;

comment on column practitioners.contributor_terms_version is
  'Version of the contributor terms this practitioner accepted. Null means they have not accepted any — their records must not appear in a knowledge-use ledger entry.';

-- ─── knowledge use ledger ─────────────────────────────────────────────────────

create table if not exists knowledge_use (
  id            uuid primary key default gen_random_uuid(),
  -- research_access | licence | publication | dataset_export | demonstration
  use_type      text not null,
  counterparty  text not null,              -- who received it, in plain words
  purpose       text not null,
  -- What was actually covered. Short codes and counts, never the content: this
  -- table is about accountability for a use, not a second copy of the archive.
  scope         jsonb not null default '{}'::jsonb,
  -- What the contributing practitioners get. Free text on purpose — benefit
  -- sharing is a negotiated thing and encoding it as an enum now would be
  -- guessing at agreements nobody has made yet.
  benefit_terms text,
  agreed_at     timestamptz,
  recorded_by   text not null,              -- pseudonymous operator reference
  created_at    timestamptz not null default now()
);

-- One row per contributing practitioner per use. This is the join that answers
-- "what has been done with my knowledge, and what was I owed" — the question the
-- whole Nagoya argument rests on being answerable.
create table if not exists knowledge_use_contributors (
  knowledge_use_id uuid not null references knowledge_use(id) on delete cascade,
  practitioner_id  uuid not null references practitioners(id) on delete restrict,
  record_count     int not null default 0,
  -- Copied from the practitioner at the time of the use, not read live: a later
  -- change to their acceptance must not silently rewrite the basis on which a
  -- past use was made.
  terms_version    text,
  primary key (knowledge_use_id, practitioner_id)
);

-- ON DELETE RESTRICT above is deliberate and worth stating: a practitioner
-- exercising deletion must not silently erase the evidence that their knowledge
-- was used and what they were owed for it. Account deletion has to settle the
-- ledger explicitly rather than cascade through it.

create index if not exists knowledge_use_contributors_practitioner_idx
  on knowledge_use_contributors (practitioner_id);

alter table knowledge_use enable row level security;
alter table knowledge_use_contributors enable row level security;

grant select, insert, update, delete on knowledge_use, knowledge_use_contributors to service_role;

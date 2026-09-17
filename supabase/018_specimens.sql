-- 018 — Specimens: a photograph of a plant, and the practitioner who named it.
--
-- Every photograph that has reached Sanko so far has been treated as a page to
-- be read (services/vision.js). Practitioners also send the other kind: a leaf
-- held up to the camera, a strip of bark, a root, a tray of dried material.
-- Those came back from the reading as NO_TEXT, the agent was told "no writing
-- was found on this photo", and the image was archived with nothing attached to
-- it. The knowledge in the practitioner's head — what that plant is called, what
-- part it is, whether they use it every week — was never asked for.
--
-- This is the table that asks.
--
-- The design rule that shapes every column below: **the name comes from the
-- practitioner, and the binomial comes from the index.** A model never supplies
-- either. That is not a stylistic preference:
--
--   * The vision model on this stack is a page transcriber. Asked to identify
--     African medicinal flora — and especially dried bark or powder — it returns
--     a fluent, confident, wrong binomial, which is the same failure vision.js
--     describes for stripped diacritics and is worse here, because the wrong
--     answer arrives wearing a percentage.
--   * A proposal shown before the practitioner answers anchors the answer. Yes
--     is one tap and No is work, so a plausible wrong proposal harvests
--     agreement — and agreement is the exact thing this table exists to collect
--     honestly. A dataset built from anchored labels cannot be un-anchored later.
--
-- So `local_name` is what they said, `botanical` is only ever filled by looking
-- that name up in the runtime plant index, and there is no column anywhere that
-- a model could write a species into. When the index does not know the name, the
-- row keeps a null binomial and becomes a question for a reviewer. A specimen
-- with no botanical name is a working record; a specimen with a guessed one is a
-- corrupted archive.
--
-- Run with: npm run migrate

-- ─────────────────────────────────────────────────────────────────────────────
-- SPECIMENS
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists specimens (
  id                    uuid primary key default gen_random_uuid(),
  practitioner_id       uuid not null references practitioners(id) on delete cascade,
  short_code            text unique,                     -- e.g. 'SP-00042'
  media_id              uuid not null,

  -- What the practitioner called it, in their own words and spelling. This is
  -- the primary evidence; everything else in the row is derived from it or
  -- describes the circumstances it was given in.
  local_name            text not null check (btrim(local_name) <> ''),
  -- The same name under utils/plantLookup.normalizeLocalName, stored rather
  -- than recomputed so that the uniqueness rule below means the same thing in
  -- the database as it does in the application.
  local_name_normalised text not null check (btrim(local_name_normalised) <> ''),
  language              text check (language is null or language in ('en','yo','ig','ha')),
  part_used             text,

  -- How well they know this plant. The honest version of "practitioner
  -- expertise": self-reported, about one plant, collected at the moment of
  -- naming. It is recorded now because it is free to ask and impossible to
  -- reconstruct later. It must not be used to weight a consensus until there is
  -- an external gold set to calibrate it against — grading practitioners
  -- against a consensus that is itself made of practitioner answers amplifies
  -- whoever answered first and most confidently.
  familiarity           text check (familiarity is null or familiarity in ('frequently','occasionally','never')),
  notes                 text,

  -- Resolved from data/plant_lookup_v1.json in the tool layer, never supplied
  -- by a model. Null has two distinct meanings and both are correct outcomes:
  -- the index does not know this name, or the index knows it maps to more than
  -- one taxon. The second is why an ambiguous name in the runtime index carries
  -- botanical: null — so nothing downstream can silently pick a species.
  botanical             text,
  botanical_source      text check (botanical_source is null or botanical_source in ('plant_index')),
  -- Which build of the index produced that mapping. Without it a specimen
  -- cannot be re-checked against a later build that changed its mind.
  plant_data_version    text,

  -- The practitioner's stated region, copied at capture time. Deliberately
  -- coarse and deliberately not from the photograph: EXIF is never read here.
  -- A precise fix on a wild population of a commercially valuable species is a
  -- bioprospecting disclosure, not a metadata nicety, and the same Nagoya
  -- argument that keeps this database on the practitioner's own hardware
  -- applies to where their plants grow.
  region                text,

  -- The ladder. Only the first rung is reachable from the agent today; the rest
  -- exist so that adding cross-practitioner review does not have to rewrite the
  -- column that everything else already reads.
  --
  --   practitioner_named   the practitioner who photographed it named it.
  --   community_verified   independent practitioners agreed, under a rule.
  --   expert_verified      a botanist or reviewer confirmed it.
  --   reference_verified   tied to a herbarium sheet or a barcode.
  --   disputed             identifications disagree. A terminal state to be
  --                        read, not a stage to be passed through: a disputed
  --                        specimen must never resolve itself by majority.
  --   withdrawn            the practitioner took it back.
  --
  -- Advancement is a rule over recorded signals, never a score. The scoring
  -- version of this ("AI + consensus + expertise + image quality + geography")
  -- adds correlated, uncalibrated quantities into a number that reads as
  -- meaningful and is not, and it is the kind of number that ends up in a
  -- regulatory submission.
  status                text not null default 'practitioner_named'
                        check (status in ('practitioner_named','community_verified',
                                          'expert_verified','reference_verified',
                                          'disputed','withdrawn')),
  created_at            timestamptz not null default now()
);

-- The photograph must belong to the practitioner the specimen belongs to. Same
-- composite-key device 007 uses for formulations.source_media_id: a specimen
-- pointing at someone else's photo is the one provenance failure that would
-- make every downstream claim about "who saw this plant" unfalsifiable.
do $$ begin
  alter table specimens add constraint specimens_media_owner_fk
    foreign key (media_id, practitioner_id)
    references media(id, practitioner_id);
exception when duplicate_object then null; end $$;

-- One photograph can legitimately show more than one plant — a practitioner
-- laying out three leaves side by side is ordinary — so this is not unique on
-- media_id alone. It is unique on the pair, which makes a repeated save of the
-- same name against the same photo a no-op instead of a second vote.
create unique index if not exists specimens_media_name_unique
  on specimens (media_id, local_name_normalised);

create index if not exists specimens_practitioner_idx on specimens (practitioner_id, created_at desc);
create index if not exists specimens_normalised_idx   on specimens (local_name_normalised);
-- The active-learning queue: named specimens the index could not place. These
-- are the rows a reviewer can act on, and they are sparse.
create index if not exists specimens_unresolved_idx
  on specimens (created_at desc) where botanical is null and status <> 'withdrawn';

-- A binomial with no stated origin is indistinguishable from a guess.
do $$ begin
  alter table specimens add constraint specimens_botanical_has_provenance
    check (botanical is null or (botanical_source is not null and plant_data_version is not null));
exception when duplicate_object then null; end $$;

create sequence if not exists specimen_short_code_seq start 1;

drop trigger if exists set_specimen_short_code on specimens;
create trigger set_specimen_short_code
  before insert on specimens
  for each row when (new.short_code is null)
  execute function generate_prefixed_short_code('SP-', 'specimen_short_code_seq');

-- Same posture as every other table: RLS on, no policies. The service-role key
-- bypasses it; anon and authenticated get nothing.
alter table specimens enable row level security;

create unique index if not exists specimens_id_practitioner_unique
  on specimens (id, practitioner_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- IDENTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- Somebody other than the owner saying yes, no, or not sure to a specimen.
--
-- Nothing writes to this table yet. It is created now, with its integrity rules
-- already in place, because those rules are what make a count of agreements mean
-- anything — and retrofitting them onto rows that were collected without them
-- means auditing the rows instead of trusting the constraint.
create table if not exists specimen_identifications (
  id                  uuid primary key default gen_random_uuid(),
  specimen_id         uuid not null references specimens(id) on delete cascade,

  -- Exactly one of these two, enforced below. A practitioner answering in
  -- WhatsApp, or an internal reviewer working the queue under a pseudonymous
  -- reference — the same shape corrections.reviewer_ref uses, and held to the
  -- same rule: never a name, a phone number, or an account id.
  practitioner_id     uuid references practitioners(id) on delete cascade,
  reviewer_ref        text,

  verdict             text not null check (verdict in ('yes','no','unsure')),

  -- What they think it is instead. Deliberately NOT required for a 'no':
  -- "that is definitely not bitter leaf" from someone who does not know what it
  -- is, is real evidence, and forcing a name would turn it into a fabricated one.
  proposed_local_name text,
  proposed_botanical  text,

  familiarity         text check (familiarity is null or familiarity in ('frequently','occasionally','never')),
  note                text,
  created_at          timestamptz not null default now()
);

do $$ begin
  alter table specimen_identifications add constraint specimen_identifications_one_author
    check ((practitioner_id is not null) <> (reviewer_ref is not null));
exception when duplicate_object then null; end $$;

-- One answer per practitioner per specimen. Without this, consensus is a count
-- of taps rather than a count of people.
create unique index if not exists specimen_identifications_one_per_practitioner
  on specimen_identifications (specimen_id, practitioner_id)
  where practitioner_id is not null;

create index if not exists specimen_identifications_specimen_idx
  on specimen_identifications (specimen_id, created_at desc);

-- The owner's own naming is the specimens row; it must not also be counted as
-- independent agreement with itself. This is a trigger rather than a check
-- because the rule spans two tables, and it is enforced in the database rather
-- than in the application because a self-confirming specimen is exactly the
-- record that would later be cited as having been "confirmed by practitioners".
create or replace function reject_self_identification()
returns trigger language plpgsql as $$
begin
  if new.practitioner_id is not null and exists (
    select 1 from specimens
     where id = new.specimen_id
       and practitioner_id = new.practitioner_id
  ) then
    raise exception 'a practitioner cannot confirm their own specimen';
  end if;
  return new;
end;
$$;

drop trigger if exists specimen_identifications_not_self on specimen_identifications;
create trigger specimen_identifications_not_self
  before insert or update of practitioner_id, specimen_id on specimen_identifications
  for each row execute function reject_self_identification();

alter table specimen_identifications enable row level security;

comment on table specimens is
  'A photographed plant named by the practitioner who sent it. local_name is evidence; botanical is resolved from the runtime index and is null when the index cannot place the name unambiguously.';
comment on column specimens.botanical is
  'Resolved in the tool layer from data/plant_lookup_v1.json. Never model-supplied. Null means unknown or ambiguous, both of which are correct outcomes.';
comment on table specimen_identifications is
  'Independent yes/no/unsure answers about a specimen. One per practitioner, never from the specimen owner.';

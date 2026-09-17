-- 014 — Registration: make "who is this practitioner" a record instead of a name.
--
-- Until now the only thing onboarding produced was a display name. That is
-- enough to address someone politely and not enough for anything else: a
-- formulation in the archive carries no indication of where it was documented
-- or who documents that way, and W11 pilots with a named cohort that the system
-- cannot distinguish from a stranger who found the number.
--
-- Registration adds the minimum that makes a Vault attributable in the way the
-- research and governance claims already assume:
--
--   region            where they practise. The one field the archive genuinely
--                     needs: the same local plant name means different plants in
--                     different places, and a mapping with no location is a
--                     mapping nobody can check.
--   years_practising  and
--   tradition         asked, not required. They are context for a reviewer
--                     reading a record, not a gate on writing one.
--   registered_at     set once, when name and region are both present. This
--                     column is the gate: null means the Vault's write tools
--                     refuse and the agent finishes registration first.
--
-- Deliberately NOT here: verification. Everything a practitioner says about
-- themselves is self-declared, and the schema should not imply otherwise by
-- storing it in a column that sounds checked. If association membership is
-- verified later it needs its own table with who verified it and when.
--
-- No backfill. Existing rows with a name but no region stay unregistered and are
-- asked for the missing piece on their next message — one question, once. The
-- alternative, granting registration to rows that never answered it, would put
-- records in the archive under a provenance claim nobody made.
--
-- Run with: npm run migrate

alter table practitioners
  add column if not exists region           text,
  add column if not exists years_practising int,
  add column if not exists tradition        text,
  add column if not exists registered_at    timestamptz,
  -- Declining the contributor terms is an answer, and 013 has nowhere to put it.
  -- Without this column a practitioner who said no is indistinguishable from one
  -- who was never asked, and gets asked again every time they message.
  add column if not exists contributor_terms_declined_at timestamptz;

do $$ begin
  alter table practitioners add constraint practitioners_years_practising_sane
    check (years_practising is null or (years_practising >= 0 and years_practising <= 100));
exception when duplicate_object then null; end $$;

comment on column practitioners.region is
  'Where the practitioner practises, in their own words. Self-declared, never verified.';
comment on column practitioners.registered_at is
  'Set when registration completed (name and region present). Null means the Vault write tools refuse.';

-- Answers "who is in the pilot and who stalled part-way through onboarding"
-- without a scan of the table.
create index if not exists practitioners_registered_at_idx
  on practitioners (registered_at);

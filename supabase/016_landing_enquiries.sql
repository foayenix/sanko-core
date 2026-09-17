-- 016 — Landing enquiries: the two forms on sanko.africa get somewhere to land.
--
-- Until now both forms on the landing page told the truth about themselves —
-- "form delivery is not connected in this preview" — which is honest and also
-- means every application for test access has been lost. This migration gives
-- them storage.
--
-- The awkward part is who writes. 003 removed every anon policy deliberately:
-- anon holding the project's public key must not be able to read practitioner
-- phone numbers, patients or transcripts, and deny-all is the only posture that
-- guarantees it. That stays true. What follows is the narrowest possible
-- exception:
--
--   * Two new tables, holding nothing but what a stranger typed about
--     themselves. No practitioner, patient or formulation data is reachable
--     from here, and neither table references anything that is.
--   * INSERT only. There is no SELECT policy, so the key that can write a row
--     cannot read one back — not its own, not anyone else's. A scraper with the
--     anon key learns nothing about who else has applied.
--   * Service role still bypasses RLS, so review happens with the same key the
--     agent already uses, from the dashboard or a migration-era query.
--
-- That combination is why the landing page can stay a static deploy: the
-- browser posts directly to PostgREST with the public anon key, and no
-- service-role key is needed on the marketing project at all.
--
-- Note for anything calling these tables: a caller that asks for the new row
-- back gets 42501 rather than the row. PostgREST already returns nothing from a
-- plain POST, so an insert does not have to opt into that — but send
-- `Prefer: return=minimal` to state the intent, and never `return=representation`,
-- which a write-only grant cannot satisfy. Verified against both.
--
-- approved_at follows the registered_at pattern from 014 — null means pending,
-- and the column is the gate rather than a status string that drifts.
--
-- Run with: npm run migrate

create table if not exists test_applications (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null,
  phone_number  text not null,
  intended_use  text,
  -- Set by hand when the number is allow-listed for the agent. Null = pending.
  approved_at   timestamptz,
  -- Set instead of approved_at when an application is turned down, so a
  -- declined applicant is distinguishable from one nobody has looked at yet.
  declined_at   timestamptz
);

comment on table test_applications is
  'Requests for private-test access from the landing page. Self-declared; nothing here is verified.';
comment on column test_applications.phone_number is
  'As typed by the applicant, not normalised to E.164. Personal data: see PRIVACY.md for retention.';
comment on column test_applications.approved_at is
  'Set when the number is allow-listed for the agent. Null means the application is still pending.';

create table if not exists partnership_enquiries (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null,
  email         text not null,
  organisation  text,
  message       text
);

comment on table partnership_enquiries is
  'Partnership enquiries from the landing page. Self-declared; nothing here is verified.';

-- Length ceilings, not validation. A form post is unauthenticated, so the point
-- is to bound what a single row can cost, not to guess at what a real name or a
-- real phone number looks like — both vary more than any check would allow for.
do $$ begin
  alter table test_applications add constraint test_applications_sane_lengths
    check (
      length(name) between 1 and 200
      and length(phone_number) between 5 and 40
      and (intended_use is null or length(intended_use) <= 500)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table partnership_enquiries add constraint partnership_enquiries_sane_lengths
    check (
      length(name) between 1 and 200
      and length(email) between 3 and 320
      and (organisation is null or length(organisation) <= 200)
      and (message is null or length(message) <= 5000)
    );
exception when duplicate_object then null; end $$;

alter table test_applications      enable row level security;
alter table partnership_enquiries  enable row level security;

-- Write-only for anon. Deliberately no SELECT, UPDATE or DELETE policy: the
-- public key can add a row and can never read, change or remove one.
drop policy if exists "anon may submit an application" on test_applications;
create policy "anon may submit an application"
  on test_applications for insert to anon with check (true);

drop policy if exists "anon may submit an enquiry" on partnership_enquiries;
create policy "anon may submit an enquiry"
  on partnership_enquiries for insert to anon with check (true);

grant insert on test_applications     to anon;
grant insert on partnership_enquiries to anon;

-- Answers "what is waiting for me" without scanning the table.
create index if not exists test_applications_pending_idx
  on test_applications (created_at desc)
  where approved_at is null and declined_at is null;

create index if not exists partnership_enquiries_created_at_idx
  on partnership_enquiries (created_at desc);

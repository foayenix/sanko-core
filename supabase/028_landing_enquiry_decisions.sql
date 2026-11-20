-- 028 — Decisions on landing-page sign-ups, attributed to an operator.
--
-- 016 gave the two landing forms somewhere to land and left review to "the
-- dashboard or a migration-era query". The control room now has a Sign-ups view,
-- and a decision made there has to say who made it, the same way a correction
-- or a transcript review does (011, 015). This adds that, and closes a gap 016
-- left open.
--
-- The gap: 016 granted anon INSERT on the whole table. A table-wide insert
-- grant covers every column, so anyone holding the public key could submit an
-- application with approved_at already set, and it would never appear as
-- pending. Nothing was harmed — approval does not reach the agent's allowlist —
-- but a column whose meaning is "a person on the team decided this" must not be
-- writable by a stranger. The grant is narrowed to the columns the form sends.
-- Columns the caller omits still take their defaults, so the landing form keeps
-- working unchanged.
--
-- 027 is left free for the evidence triage-reason fix in review.
--
-- Run with: npm run migrate

alter table test_applications
  add column if not exists decided_by    text,
  add column if not exists decision_note text;

comment on column test_applications.decided_by is
  'Pseudonymous operator reference (e.g. OP-4C21) that approved or declined. Never a name, phone number or email.';
comment on column test_applications.decision_note is
  'Optional operator note on the decision. Internal; never shown to the applicant.';

alter table partnership_enquiries
  add column if not exists responded_at timestamptz,
  add column if not exists responded_by text;

comment on column partnership_enquiries.responded_at is
  'Set when an operator marks the enquiry as answered. Null means nobody has replied yet.';
comment on column partnership_enquiries.responded_by is
  'Pseudonymous operator reference that marked the enquiry answered.';

-- An application is pending, approved or declined — never both decisions.
do $$ begin
  alter table test_applications add constraint test_applications_one_decision
    check (approved_at is null or declined_at is null);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table test_applications add constraint test_applications_decision_shape
    check (
      (decided_by is null or decided_by ~ '^[A-Z]{2,4}-[A-Z0-9]{4,8}$')
      and (decision_note is null or length(decision_note) <= 1000)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table partnership_enquiries add constraint partnership_enquiries_responder_shape
    check (responded_by is null or responded_by ~ '^[A-Z]{2,4}-[A-Z0-9]{4,8}$');
exception when duplicate_object then null; end $$;

-- Narrow anon to the columns the public forms send.
revoke insert on test_applications     from anon;
revoke insert on partnership_enquiries from anon;
grant insert (name, phone_number, intended_use)          on test_applications     to anon;
grant insert (name, email, organisation, message)        on partnership_enquiries to anon;

-- "Which enquiries has nobody answered" without scanning the table.
create index if not exists partnership_enquiries_unanswered_idx
  on partnership_enquiries (created_at desc)
  where responded_at is null;

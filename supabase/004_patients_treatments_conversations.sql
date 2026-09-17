-- 004 — Patient tracking + agent conversation memory.
--
-- Adds three tables:
--   patients        — people a practitioner treats (PT-00001, …)
--   treatments      — a formulation given to a patient, plus its outcome (TX-00001, …)
--   agent_messages  — durable transcript of the WhatsApp conversation, so the
--                     agent has memory across messages and across restarts.
--
-- The `sessions` table from 001 is no longer written to: the rigid step machine
-- it backed was replaced by the tool-calling agent, which keeps its state in
-- agent_messages instead. It is left in place so the migration is non-destructive.
--
-- Run once in the Supabase SQL editor, after 001–003.

-- ─────────────────────────────────────────────────────────────────────────────
-- SHORT CODES
-- 001 defined generate_short_code() with the 'FM-' prefix hardcoded. This is the
-- parametrised version — the prefix comes from the trigger's CREATE argument, so
-- one function serves every table.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function generate_prefixed_short_code()
returns trigger language plpgsql as $$
declare
  prefix   text := tg_argv[0];
  seq_name text := tg_argv[1];
begin
  new.short_code := prefix || lpad(nextval(seq_name)::text, 5, '0');
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATIENTS
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists patients (
  id              uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  short_code      text unique,                    -- e.g. 'PT-00007'
  display_name    text not null,
  age_years       int check (age_years is null or (age_years >= 0 and age_years <= 130)),
  sex             text check (sex is null or sex in ('male', 'female', 'other')),
  phone_number    text,
  notes           text,
  status          text default 'active' check (status in ('active', 'archived', 'deleted')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create sequence if not exists patient_short_code_seq start 1;

drop trigger if exists set_patient_short_code on patients;
create trigger set_patient_short_code
  before insert on patients
  for each row when (new.short_code is null)
  execute function generate_prefixed_short_code('PT-', 'patient_short_code_seq');

drop trigger if exists patients_updated_at on patients;
create trigger patients_updated_at
  before update on patients
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- TREATMENTS
-- One row per "I gave this formulation to this patient". formulation_id is
-- nullable so a visit can be logged before the formulation is documented.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists treatments (
  id                 uuid primary key default gen_random_uuid(),
  practitioner_id    uuid not null references practitioners(id) on delete cascade,
  patient_id         uuid not null references patients(id) on delete cascade,
  formulation_id     uuid references formulations(id) on delete set null,
  short_code         text unique,                 -- e.g. 'TX-00012'
  condition_reported text,
  started_on         date default current_date,
  outcome            text default 'ongoing'
                     check (outcome in ('ongoing', 'improved', 'resolved', 'no_change', 'worse', 'unknown')),
  outcome_notes      text,
  follow_up_on       date,
  status             text default 'active' check (status in ('active', 'deleted')),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create sequence if not exists treatment_short_code_seq start 1;

drop trigger if exists set_treatment_short_code on treatments;
create trigger set_treatment_short_code
  before insert on treatments
  for each row when (new.short_code is null)
  execute function generate_prefixed_short_code('TX-', 'treatment_short_code_seq');

drop trigger if exists treatments_updated_at on treatments;
create trigger treatments_updated_at
  before update on treatments
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- AGENT MESSAGES
-- The conversation transcript the agent replays as context. `content` holds an
-- Anthropic-shaped content array (text / image / tool_use / tool_result blocks)
-- rather than a plain string, so tool calls survive a restart mid-conversation.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists agent_messages (
  id              uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         jsonb not null,
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists patients_prac_idx        on patients   (practitioner_id);
create index if not exists patients_status_idx      on patients   (status);
create index if not exists treatments_prac_idx      on treatments (practitioner_id);
create index if not exists treatments_patient_idx   on treatments (patient_id);
create index if not exists treatments_formul_idx    on treatments (formulation_id);
create index if not exists treatments_followup_idx  on treatments (follow_up_on) where follow_up_on is not null;

-- Loading conversation history is always "latest N for this practitioner"
create index if not exists agent_messages_prac_time_idx
  on agent_messages (practitioner_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- Same posture as 001/003: RLS on, no policies — deny-all for anon and
-- authenticated. The bot uses the service-role key, which bypasses RLS.
-- Patient rows are the most sensitive data in the system; do NOT add a
-- `using (true)` policy here.
-- ─────────────────────────────────────────────────────────────────────────────

alter table patients       enable row level security;
alter table treatments     enable row level security;
alter table agent_messages enable row level security;

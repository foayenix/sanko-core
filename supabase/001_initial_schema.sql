-- Sanko Vault — initial schema (PRD §4.1)
-- Run this once in the Supabase SQL editor for your project.
-- Region: London (eu-west-2) or Frankfurt per PRD §7

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists practitioners (
  id                uuid primary key default gen_random_uuid(),
  phone_number      text unique not null,           -- E.164, e.g. +2348012345678
  display_name      text,
  preferred_language text default 'en',             -- 'en' | 'yo' | 'ig' | 'ha'
  created_at        timestamptz default now(),
  last_active_at    timestamptz default now()
);

create table if not exists media (
  id                uuid primary key default gen_random_uuid(),
  practitioner_id   uuid not null references practitioners(id) on delete cascade,
  kind              text not null check (kind in ('voice', 'photo', 'text')),
  storage_path      text,                           -- supabase storage bucket path
  duration_seconds  int,                            -- for voice
  transcript        text,                           -- for voice
  created_at        timestamptz default now()
);

create table if not exists formulations (
  id                uuid primary key default gen_random_uuid(),
  practitioner_id   uuid not null references practitioners(id) on delete cascade,
  short_code        text unique,                    -- e.g. 'FM-00034'
  condition_local   text,
  condition_std     text,
  icd_11_code       text,
  plants            jsonb,
  preparation       jsonb,
  dosage            jsonb,
  notes             text,
  source_media_id   uuid references media(id),
  original_text     text,
  original_language text,
  confidence_score  numeric(3,2),
  status            text default 'active' check (status in ('active', 'draft', 'deleted')),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- short_code sequence: FM-00001, FM-00002, …
create sequence if not exists formulation_short_code_seq start 1;

create or replace function generate_short_code()
returns trigger language plpgsql as $$
begin
  new.short_code := 'FM-' || lpad(nextval('formulation_short_code_seq')::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists set_short_code on formulations;
create trigger set_short_code
  before insert on formulations
  for each row when (new.short_code is null)
  execute function generate_short_code();

-- updated_at auto-update
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists formulations_updated_at on formulations;
create trigger formulations_updated_at
  before update on formulations
  for each row execute function set_updated_at();

create table if not exists sessions (
  -- One active session per practitioner at most (PRD §4.1)
  practitioner_id   uuid primary key references practitioners(id) on delete cascade,
  flow              text not null,
  step              text not null,
  context           jsonb default '{}',
  expires_at        timestamptz,
  updated_at        timestamptz default now()
);

create table if not exists events (
  id                uuid primary key default gen_random_uuid(),
  practitioner_id   uuid references practitioners(id) on delete set null,
  event_type        text not null,
  payload           jsonb,
  created_at        timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists practitioners_phone_idx   on practitioners (phone_number);
create index if not exists formulations_prac_idx     on formulations  (practitioner_id);
create index if not exists formulations_status_idx   on formulations  (status);
create index if not exists events_prac_idx           on events        (practitioner_id);
create index if not exists events_type_idx           on events        (event_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY (PRD §4.2)
-- RLS is enabled with NO policies, which means deny-all for the anon and
-- authenticated roles. The bot uses the service-role key, which bypasses RLS
-- entirely, so it needs no policy. Do NOT add `using (true)` policies — a
-- policy without a TO clause applies to every role, including anon, which
-- would expose phone numbers and transcripts to anyone holding the anon key.
-- Scoped policies will be added when the practitioner web dashboard ships (v2).
-- ─────────────────────────────────────────────────────────────────────────────

alter table practitioners  enable row level security;
alter table media          enable row level security;
alter table formulations   enable row level security;
alter table sessions       enable row level security;
alter table events         enable row level security;

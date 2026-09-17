-- 007 — provenance integrity, deterministic-record constraints, and patient governance.
-- Apply after 006. Constraints are NOT VALID so legacy rows can be audited and
-- remediated without weakening enforcement for new/changed rows.

-- ── Durable media provenance across multi-turn formulation capture ───────────

alter table practitioners
  add column if not exists pending_source_media_id uuid,
  add column if not exists pending_source_media_at timestamptz;

create unique index if not exists media_id_practitioner_unique
  on media (id, practitioner_id);

do $$ begin
  alter table practitioners add constraint practitioners_pending_media_owner_fk
    foreign key (pending_source_media_id, id)
    references media(id, practitioner_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table formulations add constraint formulations_source_media_owner_fk
    foreign key (source_media_id, practitioner_id)
    references media(id, practitioner_id);
exception when duplicate_object then null; end $$;

create or replace function consume_formulation_source_media()
returns trigger language plpgsql as $$
begin
  update practitioners
     set pending_source_media_id = null,
         pending_source_media_at = null
   where id = new.practitioner_id
     and pending_source_media_id = new.source_media_id;
  return new;
end;
$$;

drop trigger if exists formulations_consume_source_media on formulations;
create trigger formulations_consume_source_media
  after insert on formulations
  for each row when (new.source_media_id is not null)
  execute function consume_formulation_source_media();

-- ── High-value archive invariants ────────────────────────────────────────────

create or replace function sanko_valid_plants(value jsonb)
returns boolean language plpgsql immutable as $$
declare item jsonb;
declare key text;
begin
  if value is null or jsonb_typeof(value) <> 'array' or jsonb_array_length(value) < 1 then
    return false;
  end if;
  for item in select value_item from jsonb_array_elements(value) as t(value_item) loop
    if jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'local_name') <> 'string'
       or btrim(item->>'local_name') = ''
       or item - array['local_name','botanical','common_english','quantity_raw','quantity_normalised','part_used'] <> '{}'::jsonb then
      return false;
    end if;
    foreach key in array array['botanical','common_english','quantity_raw','quantity_normalised','part_used'] loop
      if item ? key and jsonb_typeof(item->key) not in ('string', 'null') then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

create or replace function sanko_valid_preparation(value jsonb)
returns boolean language plpgsql immutable as $$
begin
  if value is null then return true; end if;
  if jsonb_typeof(value) <> 'object'
     or value - array['method','duration_minutes','medium'] <> '{}'::jsonb then return false; end if;
  if value ? 'method' and jsonb_typeof(value->'method') not in ('string','null') then return false; end if;
  if value ? 'medium' and jsonb_typeof(value->'medium') not in ('string','null') then return false; end if;
  if value ? 'duration_minutes' and jsonb_typeof(value->'duration_minutes') not in ('number','null') then return false; end if;
  if jsonb_typeof(value->'duration_minutes') = 'number' and (value->>'duration_minutes')::numeric < 0 then return false; end if;
  return true;
end;
$$;

create or replace function sanko_valid_dosage(value jsonb)
returns boolean language plpgsql immutable as $$
begin
  if value is null then return true; end if;
  if jsonb_typeof(value) <> 'object'
     or value - array['amount','frequency','duration_days'] <> '{}'::jsonb then return false; end if;
  if value ? 'amount' and jsonb_typeof(value->'amount') not in ('string','null') then return false; end if;
  if value ? 'frequency' and jsonb_typeof(value->'frequency') not in ('string','null') then return false; end if;
  if value ? 'duration_days' and jsonb_typeof(value->'duration_days') not in ('number','null') then return false; end if;
  if jsonb_typeof(value->'duration_days') = 'number' and (value->>'duration_days')::numeric < 0 then return false; end if;
  return true;
end;
$$;

do $$ begin
  alter table formulations add constraint formulations_confidence_valid
    check (confidence_score is not null and confidence_score between 0 and 1) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table formulations add constraint formulations_language_valid
    check (original_language is null or original_language in ('en','yo','ig','ha')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table formulations add constraint formulations_plants_valid
    check (sanko_valid_plants(plants)) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table formulations add constraint formulations_preparation_valid
    check (sanko_valid_preparation(preparation)) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table formulations add constraint formulations_dosage_valid
    check (sanko_valid_dosage(dosage)) not valid;
exception when duplicate_object then null; end $$;

-- ── Patient consent and referential governance ───────────────────────────────

alter table patients
  add column if not exists consent_status text not null default 'not_recorded',
  add column if not exists consent_method text,
  add column if not exists consent_invited_at timestamptz,
  add column if not exists consent_expires_at timestamptz,
  add column if not exists consent_recorded_at timestamptz,
  add column if not exists consent_response_message_id text;

alter table patients drop constraint if exists patients_status_check;
alter table patients add constraint patients_status_check
  check (status in ('pending_consent', 'active', 'archived', 'deleted')) not valid;

alter table patients drop constraint if exists patients_consent_status_valid;
alter table patients add constraint patients_consent_status_valid
  check (consent_status in ('not_recorded','pending','granted','withdrawn')) not valid;

alter table patients drop constraint if exists patients_active_consent_required;
alter table patients add constraint patients_active_consent_required
  check (status <> 'active' or (
    consent_status = 'granted'
    and consent_method = 'whatsapp'
    and consent_recorded_at is not null
  )) not valid;

alter table patients drop constraint if exists patients_pending_consent_valid;
alter table patients add constraint patients_pending_consent_valid
  check (status <> 'pending_consent' or (
    consent_status = 'pending'
    and phone_number is not null
    and consent_expires_at is not null
    and consent_recorded_at is null
  )) not valid;

create unique index if not exists patients_live_phone_unique
  on patients (practitioner_id, phone_number)
  where status in ('pending_consent', 'active') and phone_number is not null;

create unique index if not exists patients_id_practitioner_unique
  on patients (id, practitioner_id);
create unique index if not exists formulations_id_practitioner_unique
  on formulations (id, practitioner_id);

do $$ begin
  alter table treatments add constraint treatments_patient_owner_fk
    foreign key (patient_id, practitioner_id)
    references patients(id, practitioner_id);
exception when duplicate_object then null; end $$;

create or replace function enforce_patient_consent_for_treatment()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from patients
     where id = new.patient_id
       and practitioner_id = new.practitioner_id
       and status = 'active'
       and consent_status = 'granted'
  ) then
    raise exception 'treatment requires an active patient with recorded consent';
  end if;
  return new;
end;
$$;

drop trigger if exists treatments_require_patient_consent on treatments;
create trigger treatments_require_patient_consent
  before insert or update of patient_id, practitioner_id on treatments
  for each row execute function enforce_patient_consent_for_treatment();

do $$ begin
  alter table treatments add constraint treatments_formulation_owner_fk
    foreign key (formulation_id, practitioner_id)
    references formulations(id, practitioner_id);
exception when duplicate_object then null; end $$;

-- ── Append-only data access / export / deletion audit ────────────────────────

create table if not exists data_access_audit (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null, -- intentionally retained as a deletion tombstone
  actor_id      uuid, -- no FK: deletion must not mutate or block the audit trail
  action        text not null check (action in ('read','export','delete_requested','delete_completed')),
  resource_type text not null,
  resource_id   uuid,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

alter table data_access_audit drop constraint if exists data_access_audit_actor_id_fkey;

create index if not exists data_access_audit_subject_time_idx
  on data_access_audit (subject_id, created_at desc);

alter table data_access_audit enable row level security;

create or replace function prevent_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'data_access_audit is append-only';
end;
$$;

drop trigger if exists data_access_audit_no_update on data_access_audit;
create trigger data_access_audit_no_update
  before update or delete on data_access_audit
  for each row execute function prevent_audit_mutation();

-- Migration operators should inspect legacy violations, remediate them, then
-- run ALTER TABLE ... VALIDATE CONSTRAINT for each NOT VALID constraint above.

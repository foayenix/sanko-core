-- P01–P03: additive identity foundation. No demographic joins, no new permissions
-- for legacy records, no changes to 001–019 or their consent/code constraints.
create table care_actors (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  display_name text,
  legacy_practitioner_id uuid unique references practitioners(id) on delete set null,
  status text not null default 'active' check (status in ('active','suspended')),
  synthetic boolean not null default false,
  created_at timestamptz not null default now()
);
create table care_contacts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references care_actors(id),
  channel text not null check (channel in ('email','whatsapp')),
  address text not null,
  verified_at timestamptz,
  retired_at timestamptz
  -- Deliberately not globally unique. A contact is not a patient or authority.
);
create table care_practices (
  id uuid primary key default gen_random_uuid(),
  legacy_practitioner_id uuid unique references practitioners(id) on delete set null,
  name text not null,
  timezone text not null default 'Africa/Lagos',
  synthetic boolean not null default false,
  enabled boolean not null default false,
  response_hours text,
  escalation_text text,
  created_at timestamptz not null default now()
);
create table care_memberships (
  practice_id uuid not null references care_practices(id),
  actor_id uuid not null references care_actors(id),
  role text not null check (role in ('practitioner','receptionist')),
  status text not null default 'active' check (status in ('active','suspended')),
  primary key(practice_id, actor_id)
);
create table care_subjects (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null unique default ('SK-' || upper(replace(gen_random_uuid()::text, '-', ''))),
  display_name text,
  identity_status text not null default 'provisional' check (identity_status in ('provisional','self_registered','verified','disputed')),
  synthetic boolean not null default false,
  created_at timestamptz not null default now()
);
create table care_representatives (
  actor_id uuid not null references care_actors(id),
  subject_id uuid not null references care_subjects(id),
  relationship text not null check (relationship in ('self','caregiver')),
  evidence_ref text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  primary key(actor_id, subject_id)
);
create unique index care_one_self_subject on care_representatives(actor_id) where relationship = 'self';
create table care_identity_links (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references care_subjects(id),
  practice_id uuid not null references care_practices(id),
  legacy_patient_id uuid unique references patients(id) on delete set null,
  legacy_code text not null,
  state text not null default 'unlinked' check (state in ('unlinked','proposed','verified','disputed','unlinked_after_review')),
  reviewer_id uuid references care_actors(id),
  evidence_ref text,
  reviewed_at timestamptz,
  check (state <> 'verified' or (reviewer_id is not null and evidence_ref is not null and reviewed_at is not null))
);
create table care_relationships (
  practice_id uuid not null references care_practices(id),
  subject_id uuid not null references care_subjects(id),
  tracking boolean not null default false,
  messaging boolean not null default false,
  revision int not null default 1,
  primary key(practice_id,subject_id)
);
create table care_consents (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references care_actors(id),
  subject_id uuid not null references care_subjects(id),
  practice_id uuid not null references care_practices(id),
  purpose text not null check (purpose in ('tracking','messaging')),
  granted boolean not null,
  notice_version text not null,
  notice_hash text not null,
  method text not null check (method = 'authenticated_confirmation'),
  evidence_ref uuid not null,
  created_at timestamptz not null default now()
);
create table care_sessions (
  token_hash text primary key,
  actor_id uuid not null references care_actors(id),
  csrf_hash text not null,
  authenticated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  revoked_at timestamptz
);
create table care_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  subject_id uuid,
  practice_id uuid,
  action text not null,
  resource_id uuid,
  revision int,
  created_at timestamptz not null default now()
);
create trigger care_audit_immutable before update or delete on care_audit
for each row execute function prevent_audit_mutation();
create trigger care_consents_immutable before update or delete on care_consents
for each row execute function prevent_audit_mutation();
create table care_channel_contexts (
  contact_hash text primary key,
  mode text not null check (mode in ('patient','practitioner')),
  changed_at timestamptz not null,
  message_id text not null
);
create function care_create_subject(p_name text,p_status text,p_synthetic boolean) returns uuid language plpgsql as $$
declare subject uuid; attempt int;
begin
  for attempt in 1..5 loop
    begin
      insert into care_subjects(display_name,identity_status,synthetic) values(p_name,p_status,p_synthetic) returning id into subject;
      return subject;
    exception when unique_violation then
      if attempt=5 then raise; end if;
    end;
  end loop;
  raise exception 'REFERENCE_GENERATION_FAILED';
end $$;
-- Backfill is resumable and isolated by the legacy PK, never by name/phone.
create function care_backfill_identity() returns jsonb language plpgsql as $$
#variable_conflict use_column
declare p record; s uuid; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('care_backfill', 0));
  insert into care_actors(legacy_practitioner_id,display_name)
    select id,display_name from practitioners on conflict(legacy_practitioner_id) do nothing;
  insert into care_practices(legacy_practitioner_id,name)
    select id, coalesce(display_name,'Practice') from practitioners on conflict(legacy_practitioner_id) do nothing;
  insert into care_memberships(practice_id,actor_id,role)
    select p.id,a.id,'practitioner' from care_practices p join care_actors a using(legacy_practitioner_id)
    on conflict do nothing;
  for p in select pt.id,pt.short_code,cp.id as practice_id from patients pt
    join care_practices cp on cp.legacy_practitioner_id=pt.practitioner_id
    where not exists(select 1 from care_identity_links l where l.legacy_patient_id=pt.id)
    order by pt.id limit 1000
  loop
    s := care_create_subject(null,'provisional',false);
    insert into care_identity_links(subject_id,practice_id,legacy_patient_id,legacy_code)
      values(s,p.practice_id,p.id,p.short_code);
    n := n+1;
  end loop;
  return jsonb_build_object('provisional_links_created',n);
end $$;
-- Intentionally invoked by a reviewed rehearsal/backfill command, not a schema
-- side effect. New patient care never reads these links without verified proof.

create function care_session_actor(p_token text) returns uuid language plpgsql stable as $$
#variable_conflict use_column
declare a uuid;
begin
  select s.actor_id into a from care_sessions s join care_actors a on a.id=s.actor_id
    where s.token_hash=p_token and s.revoked_at is null and s.expires_at>now()
    and a.status='active' and a.synthetic;
  if a is null then raise exception 'UNAUTHENTICATED'; end if;
  return a;
end $$;

create function care_authorize(p_actor uuid,p_role text,p_subject uuid,p_practice uuid,p_write boolean default false)
returns void language plpgsql as $$
#variable_conflict use_column
begin
  if not exists(select 1 from care_actors where id=p_actor and status='active' and synthetic) then
    raise exception 'NOT_FOUND';
  end if;
  if p_role='patient' then
    if not exists(select 1 from care_representatives r join care_subjects s on s.id=r.subject_id
      where r.actor_id=p_actor and r.subject_id=p_subject and r.relationship='self'
        and r.revoked_at is null and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now()) and s.synthetic)
      then raise exception 'NOT_FOUND'; end if;
  elsif p_role='practitioner' then
    if not exists(select 1 from care_memberships m join care_practices p on p.id=m.practice_id
      where m.actor_id=p_actor and m.practice_id=p_practice and m.role='practitioner'
        and m.status='active' and p.enabled and p.synthetic)
      then raise exception 'NOT_FOUND'; end if;
    if p_subject is not null and not exists(select 1 from care_relationships r join care_subjects s on s.id=r.subject_id
      where r.subject_id=p_subject and r.practice_id=p_practice and s.synthetic
        and (not p_write or r.tracking)) then raise exception 'NOT_FOUND'; end if;
  else raise exception 'NOT_FOUND';
  end if;
end $$;

create function care_channel_route(p_contact text,p_mode text,p_message text,p_time timestamptz,p_existing boolean)
returns text language plpgsql as $$
#variable_conflict use_column
declare c care_channel_contexts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_contact, 0));
  select * into c from care_channel_contexts where contact_hash=p_contact;
  if p_time is null and c.contact_hash is not null then return 'clarify'; end if;
  if c.contact_hash is not null and (p_time < c.changed_at or (p_time = c.changed_at and p_message is distinct from c.message_id)) then return 'clarify'; end if;
  if p_mode is not null then
    if p_mode not in ('patient','practitioner') then return 'clarify'; end if;
    insert into care_channel_contexts values(p_contact,p_mode,coalesce(p_time,now()),p_message)
      on conflict(contact_hash) do update set mode=excluded.mode,changed_at=excluded.changed_at,message_id=excluded.message_id;
    return p_mode;
  end if;
  return coalesce(c.mode,case when p_existing then 'practitioner' else 'choose' end);
end $$;

-- Deny direct browser table/RPC access, including functions (PUBLIC EXECUTE is
-- PostgreSQL's default). Only the trusted backend may invoke these operations.
do $$ declare t text; f record;
begin
  foreach t in array array['care_actors','care_contacts','care_practices','care_memberships','care_subjects',
    'care_representatives','care_identity_links','care_relationships','care_consents','care_sessions','care_audit','care_channel_contexts'] loop
    execute format('alter table %I enable row level security',t);
    execute format('revoke all on %I from anon, authenticated',t);
    execute format('grant select, insert, update, delete on %I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'care_%' loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

create function care_open_session(p_auth_user uuid,p_token text,p_csrf text) returns jsonb language plpgsql as $$
#variable_conflict use_column
declare a uuid;
begin
  select id into a from care_actors where auth_user_id=p_auth_user and status='active' and synthetic;
  if a is null then raise exception 'UNAUTHENTICATED'; end if;
  insert into care_sessions(token_hash,actor_id,csrf_hash) values(p_token,a,p_csrf);
  insert into care_audit(actor_id,action) values(a,'session.opened');
  return jsonb_build_object('actor_id',a);
end $$;
revoke all on function care_open_session(uuid,text,text) from public,anon,authenticated;
grant execute on function care_open_session(uuid,text,text) to service_role;

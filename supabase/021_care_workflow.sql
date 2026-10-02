-- R1 synthetic end-to-end loop. All clinical snapshots survive legacy account
-- erasure. No feature activation, outbound messaging or retention policy here.
create table care_invites (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references care_practices(id),
  subject_id uuid not null references care_subjects(id),
  recipient_actor_id uuid not null references care_actors(id),
  created_by uuid not null references care_actors(id),
  expires_at timestamptz not null default(now()+interval '7 days'),
  status text not null default 'pending' check(status in ('pending','accepted')),
  unique(practice_id,subject_id)
);
create table care_encounters (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references care_subjects(id),
  practice_id uuid not null references care_practices(id),
  created_by uuid not null references care_actors(id),
  visit_key uuid not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  status text not null default 'arrived' check(status in ('arrived','completed','left_before_consultation','entered_in_error')),
  revision int not null default 1,
  unique(practice_id,subject_id,visit_key),
  unique(id,subject_id,practice_id)
);
create table care_notes (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references care_encounters(id),
  author_id uuid not null references care_actors(id),
  revision int not null default 1,
  status text not null default 'draft' check(status in ('draft','signed')),
  source_text text not null check(length(source_text) between 1 and 10000),
  source_type text not null default 'practitioner_entered' check(source_type='practitioner_entered'),
  source_ref uuid not null,
  preparation_input jsonb not null default '[]',
  patient_summary text not null,
  amends_id uuid references care_notes(id),
  amendment_reason text,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  check(amends_id is null or nullif(btrim(amendment_reason),'') is not null)
);
create unique index care_one_initial_note on care_notes(encounter_id) where amends_id is null;
create table care_preparations (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references care_notes(id),
  formulation_id uuid references formulations(id) on delete set null,
  formulation_code text,
  snapshot jsonb not null,
  snapshot_hash text not null,
  reported_use text,
  composition_status text not null check(composition_status in ('recorded','unknown','withheld')),
  disclosed jsonb not null,
  created_at timestamptz not null default now()
);
create table care_releases (
  note_id uuid primary key references care_notes(id),
  released_by uuid not null references care_actors(id),
  released_at timestamptz not null default now()
);
create table care_follow_ups (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references care_encounters(id),
  owner_id uuid not null references care_actors(id),
  due_at timestamptz not null,
  status text not null default 'scheduled' check(status in ('scheduled','submitted','responded','reviewed','cancelled')),
  revision int not null default 1,
  submitted_at timestamptz,
  provider_message_id text,
  -- No live transport. An authenticated inbox item is the synthetic delivery.
  channel text not null default 'synthetic_inbox' check(channel='synthetic_inbox'),
  unique(encounter_id,due_at)
);
create table care_observations (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references care_subjects(id),
  practice_id uuid not null references care_practices(id),
  encounter_id uuid,
  follow_up_id uuid unique references care_follow_ups(id),
  actor_id uuid not null references care_actors(id),
  kind text not null check(kind in ('follow_up','correction','past_visit','product_report')),
  source_type text not null default 'patient_reported' check(source_type='patient_reported'),
  source_ref uuid not null,
  report text not null check(length(report) between 1 and 10000),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  foreign key(encounter_id,subject_id,practice_id) references care_encounters(id,subject_id,practice_id)
);
create table care_reviews (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid unique not null references care_observations(id),
  author_id uuid not null references care_actors(id),
  next_steps text not null,
  created_at timestamptz not null default now()
);
create table care_rights_requests (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references care_actors(id),
  subject_id uuid not null references care_subjects(id),
  kind text not null check(kind in ('deletion','recovery')),
  status text not null default 'pending_policy_review' check(status='pending_policy_review'),
  created_at timestamptz not null default now()
);
create table care_confirmations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references care_actors(id),
  session_hash text not null references care_sessions(token_hash),
  role text not null,
  subject_id uuid,
  practice_id uuid,
  action text not null,
  payload_hash text not null,
  expires_at timestamptz not null default(now()+interval '5 minutes'),
  consumed_at timestamptz
);
create table care_receipts (
  actor_id uuid not null references care_actors(id),
  operation_key uuid not null,
  request_hash text not null,
  result jsonb not null,
  primary key(actor_id,operation_key)
);
-- Export eligibility is independently reviewed. Unknown/mixed/clinical material
-- is never made trainable by a practitioner's contributor agreement.
alter table corrections add column training_classification text not null default 'unreviewed'
  check(training_classification in ('unreviewed','vault_only','patient','mixed'));
alter table corrections add column training_reviewed_by text;
alter table corrections add constraint corrections_training_review_required
  check(training_classification<>'vault_only' or nullif(btrim(training_reviewed_by),'') is not null);

create function care_note_guard() returns trigger language plpgsql as $$
#variable_conflict use_column
begin
  if old.status='signed' then raise exception 'SIGNED_NOTE_IMMUTABLE'; end if;
  return new;
end $$;
create trigger care_note_immutable before update or delete on care_notes for each row execute function care_note_guard();
-- Immutable snapshots may lose only their legacy locator during Vault deletion.
create function care_snapshot_guard() returns trigger language plpgsql as $$
#variable_conflict use_column
begin
  if tg_op='UPDATE' and new.formulation_id is null and
    (to_jsonb(new)-'formulation_id')=(to_jsonb(old)-'formulation_id') then return new; end if;
  raise exception 'SNAPSHOT_IMMUTABLE';
end $$;
create trigger care_snapshot_immutable before update or delete on care_preparations for each row execute function care_snapshot_guard();
create trigger care_observation_immutable before update or delete on care_observations for each row execute function prevent_audit_mutation();
create trigger care_review_immutable before update or delete on care_reviews for each row execute function prevent_audit_mutation();
create trigger care_release_immutable before update or delete on care_releases for each row execute function prevent_audit_mutation();

create function care_hash(value jsonb) returns text language sql immutable as $$
  select encode(sha256(convert_to(value::text,'UTF8')),'hex');
$$;

-- Deliberately distinct patient/practice projections. Private Vault text, source
-- media paths and undisclosed recipe snapshots never enter the patient result.
create function care_timeline(p_subject uuid,p_practice uuid,p_patient boolean,p_before timestamptz,p_limit int default 50,p_cursor jsonb default '{}')
returns jsonb language sql stable as $$
with page as (select jsonb_build_object(
 'encounters',coalesce((select jsonb_agg(row) from (
   select e.id,e.occurred_at,e.recorded_at,e.status,e.revision,e.practice_id,
     (select p.name from care_practices p where p.id=e.practice_id) as practice_name,
     coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'revision',n.revision,'author_id',n.author_id,
       'author_name',(select display_name from care_actors where id=n.author_id),'source_type',n.source_type,'source_ref',n.source_ref,'signed_at',n.signed_at,'status',n.status,
       'summary',n.patient_summary,'amends_id',n.amends_id,'amendment_reason',n.amendment_reason,
       'released',exists(select 1 from care_releases r where r.note_id=n.id),
       'preparations',coalesce((select jsonb_agg(p.disclosed) from care_preparations p where p.note_id=n.id),'[]'::jsonb)))
       from care_notes n where n.encounter_id=e.id and (not p_patient or exists(select 1 from care_releases r where r.note_id=n.id))), '[]'::jsonb) as notes
   from care_encounters e where e.subject_id=p_subject and (p_practice is null or e.practice_id=p_practice)
     and (e.recorded_at,e.id)<(coalesce((p_cursor#>>'{encounters,at}')::timestamptz,p_before),coalesce((p_cursor#>>'{encounters,id}')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) and (not p_patient or exists(select 1 from care_notes n join care_releases r on r.note_id=n.id where n.encounter_id=e.id))
   order by e.recorded_at desc,e.id desc limit p_limit) row),'[]'::jsonb),
 'observations',coalesce((select jsonb_agg(row) from (
   select o.*, (select to_jsonb(r) || jsonb_build_object('author_name',(select display_name from care_actors where id=r.author_id)) from care_reviews r where r.observation_id=o.id) as review
   from care_observations o where o.subject_id=p_subject and (p_practice is null or o.practice_id=p_practice)
     and (o.recorded_at,o.id)<(coalesce((p_cursor#>>'{observations,at}')::timestamptz,p_before),coalesce((p_cursor#>>'{observations,id}')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) order by o.recorded_at desc,o.id desc limit p_limit) row),'[]'::jsonb),
 'follow_ups',coalesce((select jsonb_agg(row) from (
   select f.*,e.practice_id,p.name as practice_name,p.response_hours,p.escalation_text
     from care_follow_ups f join care_encounters e on e.id=f.encounter_id join care_practices p on p.id=e.practice_id
     where e.subject_id=p_subject and (p_practice is null or e.practice_id=p_practice)
       and (not p_patient or f.status in ('submitted','responded','reviewed'))
     and (f.due_at,f.id)<(coalesce((p_cursor#>>'{follow_ups,at}')::timestamptz,'infinity'::timestamptz),coalesce((p_cursor#>>'{follow_ups,id}')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
     order by f.due_at desc,f.id desc limit p_limit) row),'[]'::jsonb)) as data)
select data || jsonb_build_object('next_cursor',case when p_limit is not null and
  (jsonb_array_length(data->'encounters')=p_limit or jsonb_array_length(data->'observations')=p_limit or jsonb_array_length(data->'follow_ups')=p_limit)
  then (select jsonb_object_agg(k,jsonb_build_object('at',coalesce(data->k->-1->>case when k='follow_ups' then 'due_at' else 'recorded_at' end,p_cursor->k->>'at', '0001-01-01T00:00:00Z'),
    'id',coalesce(data->k->-1->>'id',p_cursor->k->>'id','00000000-0000-4000-8000-000000000000'))) from unnest(array['encounters','observations','follow_ups']) k)
  else null end) from page;
$$;

create function care_full_export(p_subject uuid,p_practice uuid default null,p_patient boolean default true) returns jsonb language plpgsql as $$
#variable_conflict use_column
declare output jsonb;
begin
  output := care_timeline(p_subject,p_practice,p_patient,now()+interval '1 second',null);
  return output || jsonb_build_object(
    'patient',(select jsonb_build_object('reference',public_reference,'display_name',display_name,'identity_status',identity_status) from care_subjects where id=p_subject),
    'observations',coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object('review',(select to_jsonb(r) || jsonb_build_object('author_name',(select display_name from care_actors where id=r.author_id)) from care_reviews r where r.observation_id=o.id))) from care_observations o where subject_id=p_subject and (p_practice is null or o.practice_id=p_practice)),'[]'::jsonb),
    'follow_ups',coalesce((select jsonb_agg(to_jsonb(f)) from care_follow_ups f join care_encounters e on e.id=f.encounter_id where e.subject_id=p_subject and (p_practice is null or e.practice_id=p_practice) and f.status in ('submitted','responded','reviewed')),'[]'::jsonb),
    'consents',coalesce((select jsonb_agg(to_jsonb(c)) from care_consents c where subject_id=p_subject and (p_practice is null or c.practice_id=p_practice)),'[]'::jsonb),
    'access_history',coalesce((select jsonb_agg(to_jsonb(a)) from care_audit a where subject_id=p_subject and (p_practice is null or a.practice_id=p_practice)),'[]'::jsonb));
end $$;

create function care_action(p_token text,p_csrf text,p_role text,p_subject uuid,p_practice uuid,
  p_action text,p_data jsonb,p_key uuid default null,p_confirmation uuid default null)
returns jsonb language plpgsql as $$
#variable_conflict use_column
declare
  a uuid; s care_sessions%rowtype; result jsonb; h text; old_receipt care_receipts%rowtype;
  c care_confirmations%rowtype; e care_encounters%rowtype; n care_notes%rowtype;
  i care_invites%rowtype; f care_follow_ups%rowtype; o care_observations%rowtype;
  rel care_relationships%rowtype; prep jsonb; form formulations%rowtype; snap jsonb;
  sid uuid; rid uuid; target text; payload jsonb; patient boolean; mutating boolean;
  sensitive boolean; now_at timestamptz := now();
begin
  a := care_session_actor(p_token);
  select * into s from care_sessions where token_hash=p_token;
  if s.csrf_hash is distinct from p_csrf then raise exception 'CSRF_REQUIRED'; end if;
  patient := p_role='patient';
  if p_action='logout' then
    update care_sessions set revoked_at=now() where token_hash=p_token;
    return '{"signed_out":true}';
  end if;
  if p_action='revoke_sessions' then
    update care_sessions set revoked_at=now() where actor_id=a;
    insert into care_audit(actor_id,action) values(a,'sessions.revoked');
    return '{"signed_out":true}';
  end if;
  if p_action='me' then
    insert into care_audit(actor_id,action) values(a,'account.read');
    return jsonb_build_object('actor_id',a,'synthetic',true,
      'subjects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'reference',p.public_reference,'display_name',p.display_name))
        from care_subjects p join care_representatives r on r.subject_id=p.id where r.actor_id=a and p.synthetic and r.relationship='self'
        and r.revoked_at is null and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now())),'[]'::jsonb),
      'practices',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',m.role)) from care_practices p
        join care_memberships m on m.practice_id=p.id where m.actor_id=a and m.status='active' and p.synthetic and p.enabled),'[]'::jsonb));
  end if;
  if p_action='onboard' then
    if not patient or p_subject is not null or p_practice is not null then raise exception 'NOT_FOUND'; end if;
  else
    perform care_authorize(a,p_role,p_subject,p_practice,false);
  end if;
  -- Serialise subject changes, including consent, worker submission and signing.
  -- It also makes receipt replay and competing exact-revision writes deterministic.
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_subject::text,a::text),0));
  if p_action='prepare' then
    target := p_data->>'action'; payload := p_data->'data';
    if target not in ('accept_invite','decline_invite','preferences','arrive','sign','release','transition','respond','review','rights','patient_report','export')
      then raise exception 'INVALID_ACTION'; end if;
    insert into care_confirmations(actor_id,session_hash,role,subject_id,practice_id,action,payload_hash)
      values(a,p_token,p_role,p_subject,p_practice,target,care_hash(payload)) returning id into rid;
    result := jsonb_build_object('confirmation',rid,'action',target,'data',payload,'expires_in_seconds',300);
    if target='sign' then
      select cn.* into n from care_notes cn join care_encounters ce on ce.id=cn.encounter_id
        where cn.id=(payload->>'note_id')::uuid and cn.author_id=a and ce.subject_id=p_subject and ce.practice_id=p_practice;
      if not found or patient then raise exception 'NOT_FOUND'; end if;
      result := result || jsonb_build_object('record_to_confirm',jsonb_build_object('source',n.source_text,'summary',n.patient_summary,'preparations',n.preparation_input,'revision',n.revision));
    end if;
    insert into care_audit(actor_id,subject_id,practice_id,action,resource_id,revision) values(a,p_subject,p_practice,'confirmation.prepared',n.id,n.revision);
    return result;
  end if;
  sensitive := p_action in ('sign','export');
  if sensitive and s.authenticated_at<now()-interval '10 minutes' then raise exception 'REAUTHENTICATE'; end if;
  mutating := p_action not in ('timeline','today','invitations','access_history','export','formulations','draft_detail','note_source');
  h := care_hash(jsonb_build_object('action',p_action,'role',p_role,'subject',p_subject,'practice',p_practice,'data',p_data));
  if mutating then
    if p_key is null then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(a::text||p_key::text,0));
    select * into old_receipt from care_receipts where actor_id=a and operation_key=p_key;
    if found then
      if old_receipt.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      -- Do not release a cached clinical payload after tracking was withdrawn.
      if not patient and p_subject is not null then perform care_authorize(a,p_role,p_subject,p_practice,true); end if;
      return old_receipt.result;
    end if;
  end if;
  if p_action in ('accept_invite','decline_invite','preferences','arrive','sign','release','transition','respond','review','rights','patient_report','export') then
    select * into c from care_confirmations where id=p_confirmation for update;
    if not found or c.actor_id<>a or c.session_hash<>p_token or c.role<>p_role
      or c.subject_id is distinct from p_subject or c.practice_id is distinct from p_practice
      or c.action<>p_action or c.payload_hash<>care_hash(p_data) or c.expires_at<=now() or c.consumed_at is not null
      then raise exception 'CONFIRMATION_REQUIRED'; end if;
    update care_confirmations set consumed_at=now() where id=c.id;
  end if;

  if p_action='onboard' then
    if nullif(btrim(p_data->>'display_name'),'') is null or length(p_data->>'display_name')>150 then raise exception 'INVALID_INPUT'; end if;
    select subject_id into sid from care_representatives where actor_id=a and relationship='self';
    if sid is null then
      sid := care_create_subject(p_data->>'display_name','self_registered',true);
      insert into care_representatives(actor_id,subject_id,relationship,evidence_ref) values(a,sid,'self','authenticated:'||a::text);
    end if;
    select jsonb_build_object('id',id,'reference',public_reference,'display_name',display_name) into result from care_subjects where id=sid;
    p_subject := sid;
  elsif p_action='invite' then
    if patient or p_subject is not null then raise exception 'NOT_FOUND'; end if;
    -- Exact random reference only; never a global name/phone search. Success is
    -- deliberately neutral whether the reference exists or not.
    select id into sid from care_subjects where public_reference=p_data->>'reference' and synthetic;
    if sid is not null then
      insert into care_invites(practice_id,subject_id,recipient_actor_id,created_by)
        select p_practice,sid,r.actor_id,a from care_representatives r where r.subject_id=sid and r.relationship='self'
          and r.revoked_at is null and (r.expires_at is null or r.expires_at>now())
        on conflict(practice_id,subject_id) do nothing;
    end if;
    result := '{"status":"request_received"}';
  elsif p_action='invitations' then
    if not patient then raise exception 'NOT_FOUND'; end if;
    delete from care_invites where subject_id=p_subject and status='pending' and expires_at<=now();
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'practice_id',i.practice_id,'practice_name',p.name,'expires_at',i.expires_at,
      'scope','Tracking at this practice only. Optional messages are separate. No sharing or training.','notice_version','synthetic-care-v1')),'[]'::jsonb)
      into result from care_invites i join care_practices p on p.id=i.practice_id where i.subject_id=p_subject and i.recipient_actor_id=a and i.status='pending';
  elsif p_action in ('accept_invite','decline_invite') then
    if not patient then raise exception 'NOT_FOUND'; end if;
    select * into i from care_invites where id=(p_data->>'id')::uuid and subject_id=p_subject and recipient_actor_id=a
      and status='pending' and expires_at>now() for update;
    if not found or i.practice_id is distinct from p_practice then raise exception 'NOT_FOUND'; end if;
    if p_action='decline_invite' then
      delete from care_invites where id=i.id; result := '{"status":"declined"}';
    else
      perform care_authorize(i.created_by,'practitioner',null,i.practice_id,false);
      insert into care_relationships(practice_id,subject_id,tracking) values(p_practice,p_subject,true)
        on conflict(practice_id,subject_id) do update set tracking=true,revision=care_relationships.revision+1;
      insert into care_consents(actor_id,subject_id,practice_id,purpose,granted,notice_version,notice_hash,method,evidence_ref)
        values(a,p_subject,p_practice,'tracking',true,'synthetic-care-v1',care_hash('"Tracking at this practice only; no sharing or training"'::jsonb),'authenticated_confirmation',p_confirmation);
      update care_invites set status='accepted' where id=i.id;
      result := '{"status":"accepted"}';
    end if;
  elsif p_action='preferences' then
    if not patient then raise exception 'NOT_FOUND'; end if;
    select * into rel from care_relationships where practice_id=p_practice and subject_id=p_subject for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if rel.revision is distinct from (p_data->>'expected_revision')::int then raise exception 'REVISION_CONFLICT'; end if;
    if p_data->>'purpose' not in ('tracking','messaging') or jsonb_typeof(p_data->'granted')<>'boolean' then raise exception 'INVALID_INPUT'; end if;
    if p_data->>'purpose'='messaging' and (p_data->>'granted')::boolean and not rel.tracking then raise exception 'CONSENT_REQUIRED'; end if;
    update care_relationships set
      tracking=case when p_data->>'purpose'='tracking' then (p_data->>'granted')::boolean else tracking end,
      messaging=case when p_data->>'purpose'='tracking' and not (p_data->>'granted')::boolean then false
        when p_data->>'purpose'='messaging' then (p_data->>'granted')::boolean else messaging end,
      revision=revision+1 where practice_id=p_practice and subject_id=p_subject;
    insert into care_consents(actor_id,subject_id,practice_id,purpose,granted,notice_version,notice_hash,method,evidence_ref)
      values(a,p_subject,p_practice,p_data->>'purpose',(p_data->>'granted')::boolean,'synthetic-care-v1',
        care_hash('"Tracking and optional synthetic inbox messages; no sharing or training"'::jsonb),'authenticated_confirmation',p_confirmation);
    if not (p_data->>'granted')::boolean then
      update care_follow_ups f set status='cancelled',revision=f.revision+1 from care_encounters e
        where e.id=f.encounter_id and e.subject_id=p_subject and e.practice_id=p_practice and f.status in ('scheduled','submitted');
    end if;
    result := jsonb_build_object('revision',rel.revision+1);
  elsif p_action='arrive' then
    if patient then raise exception 'NOT_FOUND'; end if;
    perform care_authorize(a,p_role,p_subject,p_practice,true);
    insert into care_encounters(subject_id,practice_id,created_by,visit_key,occurred_at)
      values(p_subject,p_practice,a,(p_data->>'visit_key')::uuid,(p_data->>'occurred_at')::timestamptz)
      on conflict(practice_id,subject_id,visit_key) do nothing;
    select to_jsonb(e) into result from care_encounters e where subject_id=p_subject and practice_id=p_practice and visit_key=(p_data->>'visit_key')::uuid;
  elsif p_action in ('draft','sign','release','schedule','transition') then
    if patient then raise exception 'NOT_FOUND'; end if;
    perform care_authorize(a,p_role,p_subject,p_practice,true);
    select * into e from care_encounters where id=(p_data->>'encounter_id')::uuid and subject_id=p_subject and practice_id=p_practice for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if p_action='draft' then
      if e.revision is distinct from (p_data->>'expected_revision')::int then raise exception 'REVISION_CONFLICT'; end if;
      if e.status not in ('arrived','completed') then raise exception 'INVALID_TRANSITION'; end if;
      if length(p_data->>'source_text') not between 1 and 10000 or length(p_data->>'summary') not between 1 and 5000
        or position(p_data->>'summary' in p_data->>'source_text')=0 then raise exception 'UNSUPPORTED_SOURCE'; end if;
      if p_data->>'amends_id' is not null then
        if not exists(select 1 from care_notes where id=(p_data->>'amends_id')::uuid and encounter_id=e.id and status='signed') then raise exception 'NOT_FOUND'; end if;
      end if;
      if jsonb_typeof(p_data->'preparations')<>'array' or jsonb_array_length(p_data->'preparations')>10 then raise exception 'INVALID_INPUT'; end if;
      -- Model-extracted use must be a literal excerpt, not a generated dosage.
      for prep in select value from jsonb_array_elements(p_data->'preparations') loop
        if prep->>'reported_use' is not null and position(prep->>'reported_use' in p_data->>'source_text')=0 then raise exception 'UNSUPPORTED_SOURCE'; end if;
        if prep - array['formulation_code','formulation_updated_at','label','reported_use','disclose_composition'] <> '{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
        if nullif(btrim(prep->>'label'),'') is null or position(prep->>'label' in p_data->>'source_text')=0 then raise exception 'UNSUPPORTED_SOURCE'; end if;
      end loop;
      if p_data->>'note_id' is null then
        insert into care_notes(encounter_id,author_id,source_text,source_ref,patient_summary,preparation_input,amends_id,amendment_reason)
          values(e.id,a,p_data->>'source_text',p_key,p_data->>'summary',p_data->'preparations',(p_data->>'amends_id')::uuid,p_data->>'reason') returning * into n;
      else
        select * into n from care_notes where id=(p_data->>'note_id')::uuid and encounter_id=e.id and author_id=a for update;
        if not found then raise exception 'NOT_FOUND'; end if;
        if n.revision is distinct from (p_data->>'note_revision')::int then raise exception 'REVISION_CONFLICT'; end if;
        update care_notes set source_text=p_data->>'source_text',patient_summary=p_data->>'summary',preparation_input=p_data->'preparations',revision=revision+1,source_ref=p_key
          where id=n.id returning * into n;
      end if;
      update care_encounters set revision=revision+1 where id=e.id;
      result := jsonb_build_object('note',to_jsonb(n),'encounter_revision',e.revision+1);
    elsif p_action='sign' then
      select * into n from care_notes where id=(p_data->>'note_id')::uuid and encounter_id=e.id and author_id=a for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      if n.revision is distinct from (p_data->>'note_revision')::int or e.revision is distinct from (p_data->>'expected_revision')::int then raise exception 'REVISION_CONFLICT'; end if;
      if n.status<>'draft' then raise exception 'INVALID_TRANSITION'; end if;
      for prep in select value from jsonb_array_elements(n.preparation_input) loop
        form := null; snap := '{}';
        if prep->>'formulation_code' is not null then
          select f.* into form from formulations f join care_practices p on p.legacy_practitioner_id=f.practitioner_id
            where p.id=p_practice and f.short_code=prep->>'formulation_code' and f.status='active' for share of f;
          if not found then raise exception 'NOT_FOUND'; end if;
          if form.updated_at is distinct from (prep->>'formulation_updated_at')::timestamptz then raise exception 'REVISION_CONFLICT'; end if;
          snap := jsonb_build_object('plants',form.plants,'preparation',form.preparation,'dosage',form.dosage,'updated_at',form.updated_at,'source_practitioner',form.practitioner_id);
        end if;
        insert into care_preparations(note_id,formulation_id,formulation_code,snapshot,snapshot_hash,reported_use,composition_status,disclosed)
          values(n.id,form.id,form.short_code,snap,care_hash(snap),prep->>'reported_use',
            case when form.id is null then 'unknown' when coalesce((prep->>'disclose_composition')::boolean,false) then 'recorded' else 'withheld' end,
            jsonb_build_object('label',prep->>'label','reported_use',prep->>'reported_use','snapshot_hash',care_hash(snap),
              'composition_status',case when form.id is null then 'unknown' when coalesce((prep->>'disclose_composition')::boolean,false) then 'recorded' else 'withheld' end,
              'composition',case when coalesce((prep->>'disclose_composition')::boolean,false) then snap-'source_practitioner' else null end));
      end loop;
      update care_notes set status='signed',signed_at=now(),revision=revision+1 where id=n.id;
      update care_encounters set revision=revision+1 where id=e.id;
      result := jsonb_build_object('note_id',n.id,'note_revision',n.revision+1,'encounter_revision',e.revision+1);
    elsif p_action='transition' then
      if e.revision is distinct from (p_data->>'expected_revision')::int then raise exception 'REVISION_CONFLICT'; end if;
      if e.status<>'arrived' or p_data->>'status' not in ('completed','left_before_consultation','entered_in_error') then raise exception 'INVALID_TRANSITION'; end if;
      update care_encounters set status=p_data->>'status',revision=revision+1 where id=e.id;
      result := jsonb_build_object('revision',e.revision+1,'status',p_data->>'status');
    elsif p_action='release' then
      select * into n from care_notes where id=(p_data->>'note_id')::uuid and encounter_id=e.id and author_id=a;
      if not found then raise exception 'NOT_FOUND'; end if;
      if n.revision is distinct from (p_data->>'note_revision')::int then raise exception 'REVISION_CONFLICT'; end if;
      if n.status<>'signed' then raise exception 'CONFIRMATION_REQUIRED'; end if;
      insert into care_releases(note_id,released_by) values(n.id,a) on conflict do nothing;
      result := jsonb_build_object('released',true,'note_id',n.id);
    else
      if e.status<>'completed' or not exists(select 1 from care_notes n join care_releases r on r.note_id=n.id where n.encounter_id=e.id) then raise exception 'CONFIRMED_VISIT_REQUIRED'; end if;
      if not exists(select 1 from care_relationships where practice_id=p_practice and subject_id=p_subject and tracking and messaging) then raise exception 'CONSENT_REQUIRED'; end if;
      if not exists(select 1 from care_practices where id=p_practice and nullif(btrim(response_hours),'') is not null and nullif(btrim(escalation_text),'') is not null) then raise exception 'CLINICAL_RESPONSIBILITY_REQUIRED'; end if;
      insert into care_follow_ups(encounter_id,owner_id,due_at) values(e.id,a,(p_data->>'due_at')::timestamptz) on conflict(encounter_id,due_at) do nothing;
      select to_jsonb(f) into result from care_follow_ups f where encounter_id=e.id and due_at=(p_data->>'due_at')::timestamptz;
    end if;
  elsif p_action in ('respond','patient_report') then
    if not patient then raise exception 'NOT_FOUND'; end if;
    if not exists(select 1 from care_relationships where subject_id=p_subject and practice_id=p_practice and tracking) then raise exception 'CONSENT_REQUIRED'; end if;
    if p_action='respond' then
      select f.* into f from care_follow_ups f join care_encounters e on e.id=f.encounter_id
        where f.id=(p_data->>'id')::uuid and e.subject_id=p_subject and e.practice_id=p_practice for update of f;
      if not found then raise exception 'NOT_FOUND'; end if;
      if f.revision is distinct from (p_data->>'expected_revision')::int then raise exception 'REVISION_CONFLICT'; end if;
      if f.status<>'submitted' then raise exception 'INVALID_TRANSITION'; end if;
      insert into care_observations(subject_id,practice_id,encounter_id,follow_up_id,actor_id,kind,source_ref,report,observed_at)
        values(p_subject,p_practice,f.encounter_id,f.id,a,'follow_up',p_key,p_data->>'report',(p_data->>'observed_at')::timestamptz) returning id into rid;
      update care_follow_ups set status='responded',revision=revision+1 where id=f.id;
    else
      insert into care_observations(subject_id,practice_id,encounter_id,actor_id,kind,source_ref,report,observed_at)
        values(p_subject,p_practice,(p_data->>'encounter_id')::uuid,a,p_data->>'kind',p_key,p_data->>'report',(p_data->>'observed_at')::timestamptz) returning id into rid;
    end if;
    result := jsonb_build_object('id',rid,'source_type','patient_reported','status','awaiting_review');
  elsif p_action='review' then
    if patient then raise exception 'NOT_FOUND'; end if;
    perform care_authorize(a,p_role,p_subject,p_practice,true);
    select * into o from care_observations where id=(p_data->>'id')::uuid and subject_id=p_subject and practice_id=p_practice;
    if not found then raise exception 'NOT_FOUND'; end if;
    insert into care_reviews(observation_id,author_id,next_steps) values(o.id,a,p_data->>'next_steps') returning id into rid;
    if o.follow_up_id is not null then
      select * into f from care_follow_ups where id=o.follow_up_id for update;
      if f.revision is distinct from (p_data->>'expected_revision')::int then raise exception 'REVISION_CONFLICT'; end if;
      update care_follow_ups set status='reviewed',revision=revision+1 where id=f.id;
    end if;
    result := jsonb_build_object('id',rid,'status','reviewed');
  elsif p_action='rights' then
    if not patient then raise exception 'NOT_FOUND'; end if;
    insert into care_rights_requests(actor_id,subject_id,kind) values(a,p_subject,p_data->>'kind') returning id into rid;
    result := jsonb_build_object('id',rid,'status','pending_policy_review','message','No records erased. Retention and identity recovery require review.');
  elsif p_action in ('timeline','export') then
    if not patient and p_practice is null then raise exception 'NOT_FOUND'; end if;
    result := care_timeline(p_subject,case when patient then null else p_practice end,patient,coalesce((p_data->>'before')::timestamptz,now()+interval '1 second'),50,coalesce(p_data->'cursor','{}'));
    if p_action='export' then
      -- Complete export uses the same field-filtered projection without a page limit.
      result := care_full_export(p_subject,case when patient then null else p_practice end,patient);
    end if;
    result := result || jsonb_build_object('relationships',coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('practice_name',cp.name)) from care_relationships r join care_practices cp on cp.id=r.practice_id
      where r.subject_id=p_subject and (patient or r.practice_id=p_practice)),'[]'::jsonb),
      'rights_requests',case when patient then coalesce((select jsonb_agg(to_jsonb(r)) from care_rights_requests r where r.subject_id=p_subject),'[]'::jsonb) else '[]'::jsonb end,
      'scope',case when p_action='export' then 'Complete released care history and patient reports; private Vault excluded.' else 'Up to 50 items per collection, newest first. Pass next_cursor as cursor for earlier history. Released notes only for patients.' end);
  elsif p_action='access_history' then
    if not patient then raise exception 'NOT_FOUND'; end if;
    select coalesce(jsonb_agg(row),'[]'::jsonb) into result from (select action,actor_id,practice_id,resource_id,revision,created_at
      from care_audit where subject_id=p_subject and created_at<coalesce((p_data->>'before')::timestamptz,now()+interval '1 second') order by created_at desc limit 50) row;
  elsif p_action in ('draft_detail','note_source') then
    if patient then raise exception 'NOT_FOUND'; end if;
    select cn.* into n from care_notes cn join care_encounters ce on ce.id=cn.encounter_id
      where cn.id=(p_data->>'note_id')::uuid and cn.encounter_id=(p_data->>'encounter_id')::uuid and (p_action='note_source' or cn.author_id=a)
        and ce.subject_id=p_subject and ce.practice_id=p_practice and (p_action='note_source' or cn.status='draft');
    if not found then raise exception 'NOT_FOUND'; end if;
    result := to_jsonb(n);
  elsif p_action='formulations' then
    if patient or p_subject is not null then raise exception 'NOT_FOUND'; end if;
    select coalesce(jsonb_agg(row),'[]'::jsonb) into result from (select f.short_code,f.updated_at,f.condition_local
      from formulations f join care_practices p on p.legacy_practitioner_id=f.practitioner_id
      where p.id=p_practice and f.status='active' order by f.created_at desc limit 100) row;
  elsif p_action='today' then
    if patient or p_subject is not null then raise exception 'NOT_FOUND'; end if;
    result := jsonb_build_object('patients',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'reference',s.public_reference,'display_name',s.display_name,'tracking',r.tracking))
      from care_relationships r join care_subjects s on s.id=r.subject_id where r.practice_id=p_practice),'[]'::jsonb),
      'updates',coalesce((select jsonb_agg(row) from (select o.id,o.subject_id,o.kind,o.recorded_at from care_observations o
        where o.practice_id=p_practice and not exists(select 1 from care_reviews r where r.observation_id=o.id) order by o.recorded_at limit 50) row),'[]'::jsonb));
  else raise exception 'INVALID_ACTION';
  end if;
  -- Same transaction as every read/release and mutation: audit failure rolls
  -- back writes and no sensitive result leaves this function.
  insert into care_audit(actor_id,subject_id,practice_id,action,resource_id)
    values(a,p_subject,p_practice,p_action,coalesce(rid,e.id));
  if mutating then insert into care_receipts values(a,p_key,h,result); end if;
  return result;
end $$;

-- An isolated synthetic inbox worker. Claims with SKIP LOCKED, rechecks current
-- consent/membership and respects practice-local daytime. No Meta call exists.
create function care_dispatch_synthetic(p_now timestamptz default now()) returns int language plpgsql as $$
#variable_conflict use_column
declare row record; n int := 0;
begin
  for row in select f.id,e.subject_id,e.practice_id,f.owner_id from care_follow_ups f
    join care_encounters e on e.id=f.encounter_id where f.status='scheduled' and f.due_at<=p_now
    order by f.due_at limit 100
  loop
    perform pg_advisory_xact_lock(hashtextextended(row.subject_id::text,0));
    perform 1 from care_follow_ups where id=row.id and status='scheduled' for update skip locked;
    if not found then continue; end if;
    if not exists(select 1 from care_relationships r join care_practices p on p.id=r.practice_id
      join care_memberships m on m.practice_id=p.id and m.actor_id=row.owner_id
      join care_actors a on a.id=m.actor_id
      where r.subject_id=row.subject_id and r.practice_id=row.practice_id and r.tracking and r.messaging
      and p.enabled and p.synthetic and a.synthetic and a.status='active' and m.status='active' and m.role='practitioner') then
      update care_follow_ups set status='cancelled',revision=revision+1 where id=row.id;
    elsif exists(select 1 from care_practices p where p.id=row.practice_id and extract(hour from p_now at time zone p.timezone) between 8 and 19) then
      update care_follow_ups set status='submitted',submitted_at=p_now,provider_message_id='synthetic:'||id::text,revision=revision+1 where id=row.id;
      insert into care_audit(subject_id,practice_id,action,resource_id) values(row.subject_id,row.practice_id,'synthetic_inbox.submitted',row.id);
      n := n+1;
    end if;
  end loop;
  delete from care_invites where status='pending' and expires_at<=now();
  delete from care_confirmations where expires_at<=now();
  return n;
end $$;

do $$ declare t text; f record;
begin
  foreach t in array array['care_invites','care_encounters','care_notes','care_preparations','care_releases','care_follow_ups',
    'care_observations','care_reviews','care_rights_requests','care_confirmations','care_receipts'] loop
    execute format('alter table %I enable row level security',t);
    execute format('revoke all on %I from anon,authenticated',t);
    execute format('grant select,insert,update,delete on %I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'care_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

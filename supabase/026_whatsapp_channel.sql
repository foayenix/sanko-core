-- WhatsApp-first channel foundation (W1–W3, synthetic only).
--
-- A verified webhook proves which WhatsApp contact sent a message. It does not
-- prove which person is holding the phone, so nothing here treats a contact as
-- an identity. A contact becomes usable for private care or evidence work only
-- after an individually authenticated portal principal issues a short-lived,
-- single-use link code and that code is sent from the contact. The resulting
-- binding owns a channel-purpose session in the existing care/evidence session
-- tables, and every channel operation runs through the same care_action /
-- evidence_action functions as the browser, with the same membership,
-- relationship, consent, confirmation, idempotency and audit rules.
--
-- Channel session hashes are random values generated here and never derived
-- from a browser cookie, so a channel session cannot be presented through the
-- browser route (which always hashes a cookie) and a browser session cannot be
-- used by the channel wrappers (which select purpose='channel' rows bound to
-- the sending contact).
--
-- Historical migrations are unchanged. Nothing here enables a live capability.

alter table care_sessions add column purpose text not null default 'browser'
  check (purpose in ('browser','channel'));
alter table evidence_sessions add column purpose text not null default 'browser'
  check (purpose in ('browser','channel'));

-- Owner confirmations made in a verified WhatsApp session are recorded as such
-- rather than mislabelled as portal confirmations.
alter table evidence_service_authorisations drop constraint evidence_service_authorisations_channel_check;
alter table evidence_service_authorisations add constraint evidence_service_authorisations_channel_check
  check (channel in ('verified_portal','verified_whatsapp'));

create table channel_link_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  domain text not null check (domain in ('care','evidence')),
  care_actor_id uuid references care_actors(id),
  evidence_principal_id uuid references evidence_principals(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  check ((domain = 'care') = (care_actor_id is not null)),
  check ((domain = 'evidence') = (evidence_principal_id is not null))
);
create table channel_link_failures (
  id uuid primary key default gen_random_uuid(),
  contact_hash text not null,
  created_at timestamptz not null default now()
);
create index channel_link_failures_contact on channel_link_failures(contact_hash, created_at);

create table channel_bindings (
  id uuid primary key default gen_random_uuid(),
  contact_hash text not null check (contact_hash ~ '^[0-9a-f]{64}$'),
  -- Needed to address outbound messages; never used as an identity key.
  address text not null check (address ~ '^\+?[0-9]{6,20}$'),
  domain text not null check (domain in ('care','evidence')),
  care_actor_id uuid references care_actors(id),
  evidence_principal_id uuid references evidence_principals(id) on delete cascade,
  verification_method text not null check (verification_method = 'portal_link_code'),
  assurance text not null check (assurance = 'synthetic_individual_login'),
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  language text not null default 'en',
  document_notice_version text,
  document_notice_at timestamptz,
  created_at timestamptz not null default now(),
  check ((domain = 'care') = (care_actor_id is not null)),
  check ((domain = 'evidence') = (evidence_principal_id is not null))
);
create unique index channel_one_active_binding on channel_bindings(contact_hash, domain) where revoked_at is null;

alter table care_sessions add column binding_id uuid references channel_bindings(id);
alter table evidence_sessions add column binding_id uuid references channel_bindings(id) on delete cascade;
alter table care_sessions add constraint care_sessions_channel_binding check ((purpose = 'channel') = (binding_id is not null));
alter table evidence_sessions add constraint evidence_sessions_channel_binding check ((purpose = 'channel') = (binding_id is not null));

-- Durable guided conversation state. An LLM transcript is not used for this.
create table channel_tasks (
  id uuid primary key default gen_random_uuid(),
  contact_hash text not null,
  binding_id uuid references channel_bindings(id) on delete cascade,
  domain text not null check (domain in ('care','evidence','none')),
  role text not null check (role in ('patient','practitioner','owner','none')),
  practice_id uuid,
  subject_id uuid,
  workflow text not null check (workflow ~ '^[a-z_]{1,40}$'),
  step text not null check (step ~ '^[a-z_]{1,40}$'),
  language text not null default 'en',
  copy_version text not null,
  draft jsonb not null default '{}' check (length(draft::text) <= 60000),
  revision int not null default 1,
  status text not null default 'active' check (status in ('active','completed','cancelled','superseded','expired')),
  receipt jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create unique index channel_one_active_task on channel_tasks(contact_hash) where status = 'active';

-- An issued choice. The opaque id is the only authority a tap carries; labels
-- and translations are never interpreted as authorisation. A consequential
-- prompt also carries the exact care/evidence confirmation and the operation
-- key, so a repeated tap replays the original receipt.
create table channel_prompts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references channel_tasks(id) on delete cascade,
  contact_hash text not null,
  task_revision int not null,
  step text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 10),
  -- Displayed wording, kept only so a typed label can be matched to the
  -- current prompt; purged when the task ends.
  labels jsonb,
  consequential boolean not null default false,
  action text,
  confirmation uuid,
  operation_key uuid,
  expires_at timestamptz not null,
  answered_at timestamptz,
  answer text,
  result jsonb,
  created_at timestamptz not null default now()
);
create index channel_prompts_task on channel_prompts(task_id, created_at);

-- Semantic answer codes, independent of the displayed wording.
create table channel_answers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references channel_tasks(id) on delete set null,
  prompt_id uuid references channel_prompts(id) on delete set null,
  care_actor_id uuid references care_actors(id),
  evidence_principal_id uuid references evidence_principals(id) on delete cascade,
  question_id text not null,
  copy_version text not null,
  language text not null,
  option_code text,
  free_text text check (free_text is null or length(free_text) <= 10000),
  record_id uuid,
  created_at timestamptz not null default now()
);
create trigger channel_answers_immutable before update or delete on channel_answers
  for each row execute function prevent_audit_mutation();

-- Contact-route suppression of optional proactive messages. Deliberately not
-- a person-wide consent change, a deletion or a tracking withdrawal.
create table channel_suppressions (
  contact_hash text primary key,
  suppressed boolean not null,
  changed_at timestamptz not null default now(),
  revision int not null default 1
);
create table channel_suppression_events (
  id uuid primary key default gen_random_uuid(),
  contact_hash text not null,
  action text not null check (action in ('stop','resume')),
  message_id text,
  cancelled_sends int not null default 0,
  created_at timestamptz not null default now()
);
create trigger channel_suppression_events_immutable before update or delete on channel_suppression_events
  for each row execute function prevent_audit_mutation();

-- Rendered released reports, tied to the exact signed manifest.
create table evidence_report_artifacts (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references evidence_releases(id) on delete cascade,
  report_id uuid not null references evidence_report_revisions(id) on delete cascade,
  kind text not null check (kind in ('dossier_pdf')),
  manifest_hash text not null,
  renderer text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bytea not null,
  size int not null check (size between 1 and 8000000),
  created_at timestamptz not null default now(),
  unique (release_id, kind, renderer)
);
create trigger evidence_report_artifacts_immutable before update on evidence_report_artifacts
  for each row execute function evidence_immutable();

-- Outbound intent is persisted before any provider call.
create table channel_outbound (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references channel_bindings(id) on delete cascade,
  contact_hash text not null,
  purpose text not null check (purpose in ('care_check_in','evidence_document')),
  optional boolean not null,
  operation_key uuid unique,
  follow_up_id uuid references care_follow_ups(id),
  release_id uuid references evidence_releases(id) on delete cascade,
  artifact_id uuid references evidence_report_artifacts(id) on delete cascade,
  status text not null default 'pending' check (status in
    ('pending','sending','accepted','sent','delivered','read','failed','ambiguous','cancelled')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  provider_message_id text unique,
  provider_media_id text,
  media_cleanup text check (media_cleanup in ('pending','done','failed')),
  last_error text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((purpose = 'care_check_in') = (follow_up_id is not null)),
  check ((purpose = 'evidence_document') = (release_id is not null and artifact_id is not null))
);
create unique index channel_one_check_in_notice on channel_outbound(follow_up_id) where follow_up_id is not null;
create index channel_outbound_due on channel_outbound(status, next_attempt_at);
create table channel_delivery_events (
  id uuid primary key default gen_random_uuid(),
  outbound_id uuid references channel_outbound(id) on delete cascade,
  provider_message_id text not null,
  status text not null check (status in ('sent','delivered','read','failed')),
  provider_at timestamptz,
  received_at timestamptz not null default now(),
  unique (provider_message_id, status)
);

create table channel_audit (
  id uuid primary key default gen_random_uuid(),
  contact_hash text,
  binding_id uuid,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create trigger channel_audit_immutable before update or delete on channel_audit
  for each row execute function prevent_audit_mutation();

-- ─── helpers ──────────────────────────────────────────────────────────────────

create function channel_random_hash() returns text language sql volatile set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex')
$$;

-- Ends tasks and prompts for a contact (and optionally one domain). Draft
-- content is purged when a task ends; receipts are kept.
create function channel_end_tasks(p_contact text, p_domain text, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update channel_prompts set expires_at = least(expires_at, now()), labels = null
    where task_id in (select id from channel_tasks where contact_hash = p_contact and status = 'active'
      and (p_domain is null or domain = p_domain or domain = 'none'));
  update channel_tasks set status = p_status, draft = '{}', updated_at = now()
    where contact_hash = p_contact and status = 'active' and (p_domain is null or domain = p_domain or domain = 'none');
end $$;

create function channel_revoke_binding(p_binding uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b channel_bindings;
begin
  update channel_bindings set revoked_at = now(), revoke_reason = p_reason
    where id = p_binding and revoked_at is null returning * into b;
  if b.id is null then return; end if;
  update care_sessions set revoked_at = now() where binding_id = b.id and revoked_at is null;
  update evidence_sessions set revoked_at = now() where binding_id = b.id and revoked_at is null;
  update channel_outbound set status = 'cancelled', cancel_reason = 'binding_revoked', updated_at = now()
    where binding_id = b.id and status = 'pending';
  perform channel_end_tasks(b.contact_hash, b.domain, 'cancelled');
  insert into channel_audit(contact_hash, binding_id, action, detail)
    values (b.contact_hash, b.id, 'binding.revoked', jsonb_build_object('reason', p_reason));
end $$;

-- ─── link codes (issued from an authenticated portal session) ────────────────

create function care_channel_link_code(p_token text, p_csrf text, p_code_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a uuid; c channel_link_codes;
begin
  a := care_session_actor(p_token);
  if not exists (select 1 from care_sessions where token_hash = p_token and csrf_hash = p_csrf and purpose = 'browser') then
    raise exception 'CSRF_REQUIRED';
  end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
  -- One outstanding code per actor; issuing a new one retires the old.
  delete from channel_link_codes where care_actor_id = a and consumed_at is null;
  insert into channel_link_codes(code_hash, domain, care_actor_id) values (p_code_hash, 'care', a) returning * into c;
  insert into care_audit(actor_id, action) values (a, 'channel.link_code_issued');
  return jsonb_build_object('expires_at', c.expires_at);
end $$;

create function evidence_channel_link_code(p_token text, p_csrf text, p_code_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s evidence_sessions; a evidence_principals; c channel_link_codes;
begin
  select * into s from evidence_sessions where token_hash = p_token and revoked_at is null and expires_at > now() and purpose = 'browser';
  if not found then raise exception 'UNAUTHENTICATED'; end if;
  if s.csrf_hash is distinct from p_csrf then raise exception 'CSRF_REQUIRED'; end if;
  select * into a from evidence_principals where id = s.principal_id and active and synthetic and not deleting;
  -- Only owners act in chat; analyst, reviewer and release work stays in the portal.
  if not found or a.owner_id is null then raise exception 'NOT_FOUND'; end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
  delete from channel_link_codes where evidence_principal_id = a.id and consumed_at is null;
  insert into channel_link_codes(code_hash, domain, evidence_principal_id) values (p_code_hash, 'evidence', a.id) returning * into c;
  insert into evidence_audit(principal_id, owner_id, action) values (a.id, a.owner_id, 'channel_link_code_issued');
  return jsonb_build_object('expires_at', c.expires_at);
end $$;

-- Redeems a link code sent from a contact. A previous binding of the same
-- contact and domain is revoked rather than merged, so a recycled or shared
-- phone never inherits the earlier person's history or pending work.
create function channel_redeem_link(p_contact text, p_address text, p_code_hash text, p_session_minutes int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c channel_link_codes; b channel_bindings; old channel_bindings; expires timestamptz; name text; renewed boolean := false;
begin
  if p_contact !~ '^[0-9a-f]{64}$' or p_session_minutes is null or p_session_minutes not between 5 and 4320 then
    raise exception 'INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('channel:' || p_contact, 0));
  if (select count(*) from channel_link_failures where contact_hash = p_contact and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'LINK_LOCKED';
  end if;
  select * into c from channel_link_codes where code_hash = p_code_hash and consumed_at is null and expires_at > now() for update;
  if found and c.domain = 'care' then
    select display_name into name from care_actors where id = c.care_actor_id and status = 'active' and synthetic;
    if not found then c := null; end if;
  elsif found then
    select display_name into name from evidence_principals where id = c.evidence_principal_id and active and synthetic and not deleting and owner_id is not null;
    if not found then c := null; end if;
  end if;
  if c.code_hash is null then
    -- Recorded in its own row; the caller commits this before reporting failure.
    insert into channel_link_failures(contact_hash) values (p_contact);
    return jsonb_build_object('linked', false);
  end if;
  update channel_link_codes set consumed_at = now() where code_hash = c.code_hash;
  select * into old from channel_bindings where contact_hash = p_contact and domain = c.domain and revoked_at is null;
  if old.id is not null and old.care_actor_id is not distinct from c.care_actor_id
     and old.evidence_principal_id is not distinct from c.evidence_principal_id then
    -- The same person verifying again: renew the session on the existing
    -- binding and keep their in-progress task, which resumes with a fresh
    -- review (confirmations were bound to the old session and no longer apply).
    b := old;
    update channel_bindings set verified_at = now(), address = p_address where id = b.id;
    update care_sessions set revoked_at = now() where binding_id = b.id and revoked_at is null;
    update evidence_sessions set revoked_at = now() where binding_id = b.id and revoked_at is null;
    renewed := true;
  else
    if old.id is not null then perform channel_revoke_binding(old.id, 'replaced_by_new_link'); end if;
    -- Pending work started before verification (or by someone else) never carries over.
    perform channel_end_tasks(p_contact, c.domain, 'superseded');
    insert into channel_bindings(contact_hash, address, domain, care_actor_id, evidence_principal_id, verification_method, assurance)
      values (p_contact, p_address, c.domain, c.care_actor_id, c.evidence_principal_id, 'portal_link_code', 'synthetic_individual_login')
      returning * into b;
  end if;
  expires := now() + make_interval(mins => p_session_minutes);
  if c.domain = 'care' then
    insert into care_sessions(token_hash, actor_id, csrf_hash, expires_at, purpose, binding_id)
      values (channel_random_hash(), c.care_actor_id, channel_random_hash(), expires, 'channel', b.id);
    insert into care_audit(actor_id, action, resource_id) values (c.care_actor_id, 'channel.linked', b.id);
  else
    insert into evidence_sessions(token_hash, csrf_hash, principal_id, expires_at, purpose, binding_id)
      values (channel_random_hash(), channel_random_hash(), c.evidence_principal_id, expires, 'channel', b.id);
    insert into evidence_audit(principal_id, owner_id, action)
      select id, owner_id, 'channel_linked' from evidence_principals where id = c.evidence_principal_id;
  end if;
  insert into channel_audit(contact_hash, binding_id, action) values (p_contact, b.id, case when renewed then 'binding.renewed' else 'binding.created' end);
  return jsonb_build_object('linked', true, 'renewed', renewed, 'domain', c.domain, 'binding_id', b.id, 'name', name, 'session_expires_at', expires);
end $$;

create function channel_unlink(p_contact text, p_domain text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b channel_bindings; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('channel:' || p_contact, 0));
  for b in select * from channel_bindings where contact_hash = p_contact and revoked_at is null
    and (p_domain is null or domain = p_domain) loop
    perform channel_revoke_binding(b.id, 'unlinked_by_contact');
    n := n + 1;
  end loop;
  return jsonb_build_object('unlinked', n);
end $$;

-- What the router needs to decide how to treat a contact. No private data.
create function channel_status(p_contact text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb := '{}'; b channel_bindings; s timestamptz; auth timestamptz;
begin
  for b in select * from channel_bindings where contact_hash = p_contact and revoked_at is null loop
    s := null; auth := null;
    if b.domain = 'care' then
      select cs.expires_at, cs.authenticated_at into s, auth from care_sessions cs join care_actors a on a.id = cs.actor_id
        where cs.binding_id = b.id and cs.purpose = 'channel' and cs.revoked_at is null and cs.expires_at > now()
          and a.status = 'active' and a.synthetic order by cs.authenticated_at desc limit 1;
    else
      select es.expires_at, es.authenticated_at into s, auth from evidence_sessions es join evidence_principals p on p.id = es.principal_id
        where es.binding_id = b.id and es.purpose = 'channel' and es.revoked_at is null and es.expires_at > now()
          and p.active and not p.deleting order by es.authenticated_at desc limit 1;
    end if;
    result := result || jsonb_build_object(b.domain, jsonb_build_object('binding_id', b.id, 'session', s is not null,
      'session_expires_at', s, 'authenticated_at', auth, 'language', b.language,
      'document_notice_version', b.document_notice_version));
  end loop;
  return result || jsonb_build_object('suppressed',
    coalesce((select suppressed from channel_suppressions where contact_hash = p_contact), false));
end $$;

create function channel_set_language(p_contact text, p_language text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_language not in ('en','pcm','yo','ha','ig') then raise exception 'INVALID_INPUT'; end if;
  update channel_bindings set language = p_language where contact_hash = p_contact and revoked_at is null;
  update channel_tasks set language = p_language where contact_hash = p_contact and status = 'active';
end $$;

-- ─── domain wrappers ─────────────────────────────────────────────────────────

create function channel_care_session(p_contact text) returns care_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s care_sessions;
begin
  select cs.* into s from care_sessions cs join channel_bindings b on b.id = cs.binding_id
    where b.contact_hash = p_contact and b.domain = 'care' and b.revoked_at is null
      and cs.purpose = 'channel' and cs.revoked_at is null and cs.expires_at > now()
    order by cs.authenticated_at desc limit 1;
  if s.token_hash is null then raise exception 'CHANNEL_VERIFICATION_REQUIRED'; end if;
  return s;
end $$;

create function channel_care_act(p_contact text, p_action text, p_role text, p_subject uuid, p_practice uuid,
  p_data jsonb, p_key uuid default null, p_confirmation uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s care_sessions; result jsonb; target text := p_action;
begin
  s := channel_care_session(p_contact);
  if p_action = 'prepare' then target := p_data->>'action'; end if;
  -- Exports, browser logout and portal-only reads are not channel operations.
  if target is null or target not in ('me','onboard','invitations','accept_invite','decline_invite','preferences',
    'arrive','draft','sign','release','transition','schedule','respond','patient_report','review','rights',
    'timeline','today','formulations','draft_detail','review_queue') then
    raise exception 'INVALID_ACTION';
  end if;
  if p_action = 'review_queue' then
    result := care_review_queue(s.token_hash, s.csrf_hash, p_practice);
  else
    result := care_action(s.token_hash, s.csrf_hash, p_role, p_subject, p_practice, p_action, p_data, p_key, p_confirmation);
  end if;
  insert into care_audit(actor_id, subject_id, practice_id, action, resource_id)
    values (s.actor_id, p_subject, p_practice, 'channel.' || p_action, s.binding_id);
  return result;
end $$;

create function channel_evidence_session(p_contact text) returns evidence_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s evidence_sessions;
begin
  select es.* into s from evidence_sessions es join channel_bindings b on b.id = es.binding_id
    where b.contact_hash = p_contact and b.domain = 'evidence' and b.revoked_at is null
      and es.purpose = 'channel' and es.revoked_at is null and es.expires_at > now()
    order by es.authenticated_at desc limit 1;
  if s.token_hash is null then raise exception 'CHANNEL_VERIFICATION_REQUIRED'; end if;
  return s;
end $$;

-- Owner actions only. The role is fixed here, not supplied by the caller, so
-- no forged input can reach analyst, reviewer or release powers.
create function channel_evidence_act(p_contact text, p_action text, p_request uuid, p_revision int,
  p_data jsonb, p_key uuid default null, p_confirmation uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s evidence_sessions; result jsonb; target text := p_action; rel record;
begin
  s := channel_evidence_session(p_contact);
  if p_action = 'prepare' then target := p_data->>'action'; end if;
  if target is null or target not in ('me','formulations','list','get','create','submit','answer','cancel','correction','artifact')
    or (p_action = 'prepare' and target not in ('submit','cancel')) then
    -- Returned rather than raised so the denial audit row is committed.
    insert into evidence_audit(principal_id, action) values (s.principal_id, 'channel_denied_' || left(coalesce(target, 'unknown'), 40));
    return jsonb_build_object('refused', 'NOT_FOUND');
  end if;
  result := evidence_action(s.token_hash, s.csrf_hash, p_action, 'owner', p_request, p_revision, p_data, p_key, p_confirmation);
  if p_action = 'submit' then
    update evidence_service_authorisations set channel = 'verified_whatsapp'
      where request_id = p_request and principal_id = s.principal_id and revoked_at is null;
  elsif p_action = 'artifact' then
    -- Version and release facts a downloaded copy must carry.
    select l.released_at, l.status, v.number, v.created_at as report_created_at, q.id as request_id
      into rel from evidence_releases l join evidence_report_revisions v on v.id = l.report_id
      join evidence_requests q on q.id = l.request_id where l.id = (p_data->>'release_id')::uuid;
    result := result || jsonb_build_object('released_at', rel.released_at, 'report_number', rel.number,
      'request_id', rel.request_id, 'release_id', p_data->>'release_id');
  end if;
  insert into evidence_audit(principal_id, request_id, action) values (s.principal_id, p_request, 'channel_' || p_action);
  return result;
end $$;

-- ─── tasks and prompts ───────────────────────────────────────────────────────

create function channel_task_get(p_contact text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t channel_tasks;
begin
  update channel_prompts set expires_at = least(expires_at, now())
    where task_id in (select id from channel_tasks where contact_hash = p_contact and status = 'active' and expires_at <= now());
  update channel_tasks set status = 'expired', draft = '{}', updated_at = now()
    where contact_hash = p_contact and status = 'active' and expires_at <= now();
  select * into t from channel_tasks where contact_hash = p_contact and status = 'active';
  if not found then return null; end if;
  return to_jsonb(t);
end $$;

-- Saves a task. Without an id it starts a new task and supersedes any active
-- one. With an id it requires the expected revision (concurrent turns for the
-- same contact conflict instead of overwriting each other).
create function channel_task_put(p_contact text, p_task jsonb, p_expected int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t channel_tasks; terminal boolean := coalesce(p_task->>'status', 'active') <> 'active';
begin
  perform pg_advisory_xact_lock(hashtextextended('channel:' || p_contact, 0));
  if p_task->>'id' is null then
    perform channel_end_tasks(p_contact, null, 'superseded');
    insert into channel_tasks(contact_hash, binding_id, domain, role, practice_id, subject_id, workflow, step,
      language, copy_version, draft, status, receipt)
    values (p_contact, (p_task->>'binding_id')::uuid, p_task->>'domain', p_task->>'role',
      (p_task->>'practice_id')::uuid, (p_task->>'subject_id')::uuid, p_task->>'workflow', p_task->>'step',
      coalesce(p_task->>'language', 'en'), p_task->>'copy_version', case when terminal then '{}' else coalesce(p_task->'draft', '{}') end,
      coalesce(p_task->>'status', 'active'), p_task->'receipt')
    returning * into t;
  else
    update channel_tasks set step = p_task->>'step', practice_id = (p_task->>'practice_id')::uuid,
      subject_id = (p_task->>'subject_id')::uuid, workflow = p_task->>'workflow',
      draft = case when terminal then '{}' else coalesce(p_task->'draft', '{}') end,
      status = coalesce(p_task->>'status', 'active'), receipt = coalesce(p_task->'receipt', receipt),
      revision = revision + 1, updated_at = now(),
      expires_at = case when terminal then expires_at else now() + interval '24 hours' end
    where id = (p_task->>'id')::uuid and contact_hash = p_contact and status = 'active' and revision = p_expected
    returning * into t;
    if not found then raise exception 'TASK_CONFLICT'; end if;
    if terminal then
      update channel_prompts set expires_at = least(expires_at, now()), labels = null where task_id = t.id;
    end if;
  end if;
  return to_jsonb(t);
end $$;

create function channel_prompt_issue(p_contact text, p_task uuid, p_task_revision int, p_step text, p_options jsonb,
  p_labels jsonb, p_minutes int, p_consequential boolean, p_action text, p_confirmation uuid, p_operation_key uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare id uuid;
begin
  if not exists (select 1 from channel_tasks where channel_tasks.id = p_task and contact_hash = p_contact and status = 'active' and revision = p_task_revision) then
    raise exception 'TASK_CONFLICT';
  end if;
  if p_minutes not between 1 and 1440 then raise exception 'INVALID_INPUT'; end if;
  -- Only the newest prompt of a task is answerable.
  update channel_prompts set expires_at = least(expires_at, now()) where task_id = p_task and answered_at is null;
  if p_labels is not null and jsonb_array_length(p_labels) <> jsonb_array_length(p_options) then raise exception 'INVALID_INPUT'; end if;
  insert into channel_prompts(task_id, contact_hash, task_revision, step, options, labels, consequential, action, confirmation, operation_key, expires_at)
    values (p_task, p_contact, p_task_revision, p_step, p_options, p_labels, p_consequential, p_action, p_confirmation, p_operation_key,
      now() + make_interval(mins => p_minutes))
    returning channel_prompts.id into id;
  return id;
end $$;

-- Resolves a tap (or its numbered/text equivalent) against the prompt it was
-- issued for. A prompt from another contact, an ended task, an older task
-- revision or an expired prompt is refused. An answered prompt replays.
create function channel_prompt_answer(p_contact text, p_prompt uuid, p_index int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p channel_prompts; t channel_tasks;
begin
  perform pg_advisory_xact_lock(hashtextextended('channel:' || p_contact, 0));
  select * into p from channel_prompts where id = p_prompt and contact_hash = p_contact for update;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  if p.answered_at is not null then
    return jsonb_build_object('state', 'replay', 'answer', p.answer, 'result', p.result, 'prompt', to_jsonb(p));
  end if;
  select * into t from channel_tasks where id = p.task_id;
  if t.status <> 'active' or t.revision <> p.task_revision or p.expires_at <= now() then
    return jsonb_build_object('state', 'stale');
  end if;
  if p_index is null or p_index < 0 or p_index >= jsonb_array_length(p.options) then
    return jsonb_build_object('state', 'invalid');
  end if;
  update channel_prompts set answered_at = now(), answer = p.options->>p_index where id = p.id returning * into p;
  return jsonb_build_object('state', 'answered', 'answer', p.answer, 'prompt', to_jsonb(p), 'task', to_jsonb(t));
end $$;

create function channel_prompt_result(p_contact text, p_prompt uuid, p_result jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update channel_prompts set result = p_result where id = p_prompt and contact_hash = p_contact and answered_at is not null and result is null;
end $$;

create function channel_current_prompt(p_contact text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p channel_prompts;
begin
  select cp.* into p from channel_prompts cp join channel_tasks t on t.id = cp.task_id
    where cp.contact_hash = p_contact and t.status = 'active' and cp.task_revision = t.revision
      and cp.answered_at is null and cp.expires_at > now()
    order by cp.created_at desc limit 1;
  if not found then return null; end if;
  return to_jsonb(p);
end $$;

create function channel_record_answer(p_contact text, p_task uuid, p_prompt uuid, p_question text, p_copy text,
  p_language text, p_option text, p_free_text text, p_record uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b channel_bindings;
begin
  select cb.* into b from channel_bindings cb join channel_tasks t on t.binding_id = cb.id
    where t.id = p_task and t.contact_hash = p_contact and cb.revoked_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into channel_answers(task_id, prompt_id, care_actor_id, evidence_principal_id, question_id, copy_version, language, option_code, free_text, record_id)
    values (p_task, p_prompt, b.care_actor_id, b.evidence_principal_id, p_question, p_copy, p_language, p_option, p_free_text, p_record);
end $$;

-- ─── messaging suppression ───────────────────────────────────────────────────

-- Persists the stop and fences queued optional sends before the caller may
-- confirm it. Sends already handed to the provider are reported, not hidden.
create function channel_stop(p_contact text, p_message text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; flight int;
begin
  if p_contact !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('channel:' || p_contact, 0));
  insert into channel_suppressions(contact_hash, suppressed) values (p_contact, true)
    on conflict (contact_hash) do update set suppressed = true, changed_at = now(), revision = channel_suppressions.revision + 1;
  update channel_outbound set status = 'cancelled', cancel_reason = 'contact_suppressed', updated_at = now()
    where contact_hash = p_contact and optional and status in ('pending','failed');
  get diagnostics n = row_count;
  select count(*) into flight from channel_outbound where contact_hash = p_contact and optional and status = 'sending';
  insert into channel_suppression_events(contact_hash, action, message_id, cancelled_sends) values (p_contact, 'stop', p_message, n);
  return jsonb_build_object('suppressed', true, 'cancelled', n, 'in_flight', flight);
end $$;

-- Resuming needs an explicit choice from a verified channel session.
create function channel_resume(p_contact text, p_message text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('channel:' || p_contact, 0));
  if not exists (select 1 from channel_bindings b join care_sessions s on s.binding_id = b.id
      where b.contact_hash = p_contact and b.revoked_at is null and s.revoked_at is null and s.expires_at > now())
    and not exists (select 1 from channel_bindings b join evidence_sessions s on s.binding_id = b.id
      where b.contact_hash = p_contact and b.revoked_at is null and s.revoked_at is null and s.expires_at > now()) then
    raise exception 'CHANNEL_VERIFICATION_REQUIRED';
  end if;
  insert into channel_suppressions(contact_hash, suppressed) values (p_contact, false)
    on conflict (contact_hash) do update set suppressed = false, changed_at = now(), revision = channel_suppressions.revision + 1;
  insert into channel_suppression_events(contact_hash, action, message_id) values (p_contact, 'resume', p_message);
  return jsonb_build_object('suppressed', false);
end $$;

-- ─── evidence documents ──────────────────────────────────────────────────────

create function channel_evidence_release_owned(p_contact text, p_release uuid) returns evidence_releases
language plpgsql security definer set search_path = public, pg_temp as $$
declare s evidence_sessions; l evidence_releases;
begin
  s := channel_evidence_session(p_contact);
  select l2.* into l from evidence_releases l2 join evidence_requests q on q.id = l2.request_id
    join evidence_principals p on p.owner_id = q.owner_id
    where l2.id = p_release and p.id = s.principal_id and p.active and not p.deleting;
  if l.id is null then raise exception 'NOT_FOUND'; end if;
  if l.status = 'withdrawn' then raise exception 'REPORT_WITHDRAWN'; end if;
  return l;
end $$;

create function channel_evidence_store_artifact(p_contact text, p_release uuid, p_manifest_hash text,
  p_renderer text, p_sha256 text, p_base64 text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l evidence_releases; v evidence_report_revisions; bytes bytea; a evidence_report_artifacts;
begin
  l := channel_evidence_release_owned(p_contact, p_release);
  select * into v from evidence_report_revisions where id = l.report_id;
  if v.manifest_hash is distinct from p_manifest_hash then raise exception 'REVISION_CONFLICT'; end if;
  bytes := decode(p_base64, 'base64');
  if encode(sha256(bytes), 'hex') <> p_sha256 then raise exception 'INVALID_INPUT'; end if;
  insert into evidence_report_artifacts(release_id, report_id, kind, manifest_hash, renderer, sha256, bytes, size)
    values (l.id, v.id, 'dossier_pdf', v.manifest_hash, p_renderer, p_sha256, bytes, length(bytes))
    on conflict (release_id, kind, renderer) do nothing;
  select * into a from evidence_report_artifacts where release_id = l.id and kind = 'dossier_pdf' and renderer = p_renderer;
  -- Rendering is deterministic for a renderer version: a different hash means
  -- the renderer or content changed, which must not be silently mixed.
  if a.sha256 <> p_sha256 then raise exception 'ARTIFACT_MISMATCH'; end if;
  return jsonb_build_object('artifact_id', a.id, 'sha256', a.sha256, 'size', a.size);
end $$;

create function channel_evidence_ack_notice(p_contact text, p_version text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform channel_evidence_session(p_contact);
  update channel_bindings set document_notice_version = p_version, document_notice_at = now()
    where contact_hash = p_contact and domain = 'evidence' and revoked_at is null;
end $$;

create function channel_evidence_request_delivery(p_contact text, p_release uuid, p_artifact uuid, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l evidence_releases; b channel_bindings; o channel_outbound;
begin
  l := channel_evidence_release_owned(p_contact, p_release);
  select * into b from channel_bindings where contact_hash = p_contact and domain = 'evidence' and revoked_at is null;
  if b.document_notice_version is null then raise exception 'NOTICE_REQUIRED'; end if;
  if not exists (select 1 from evidence_report_artifacts where id = p_artifact and release_id = l.id) then raise exception 'NOT_FOUND'; end if;
  insert into channel_outbound(binding_id, contact_hash, purpose, optional, operation_key, release_id, artifact_id)
    values (b.id, p_contact, 'evidence_document', false, p_key, l.id, p_artifact)
    on conflict (operation_key) do nothing;
  select * into o from channel_outbound where operation_key = p_key and contact_hash = p_contact;
  if not found then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  insert into evidence_audit(principal_id, request_id, action)
    select evidence_principal_id, l.request_id, 'channel_delivery_requested' from channel_bindings where id = b.id;
  return jsonb_build_object('outbound_id', o.id, 'status', o.status);
end $$;

-- ─── outbound dispatch ───────────────────────────────────────────────────────

-- Opted-in check-in notices for follow-ups the care worker has delivered.
-- The message itself carries no health detail.
create function channel_enqueue_check_ins(p_limit int default 100) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into channel_outbound(binding_id, contact_hash, purpose, optional, follow_up_id)
  select distinct on (f.id) b.id, b.contact_hash, 'care_check_in', true, f.id
    from care_follow_ups f join care_encounters e on e.id = f.encounter_id
    join care_relationships r on r.subject_id = e.subject_id and r.practice_id = e.practice_id and r.tracking and r.messaging
    join care_representatives rep on rep.subject_id = e.subject_id and rep.relationship = 'self' and rep.revoked_at is null
    join channel_bindings b on b.care_actor_id = rep.actor_id and b.domain = 'care' and b.revoked_at is null
    where f.status = 'submitted'
      and not exists (select 1 from channel_outbound o where o.follow_up_id = f.id)
      and not coalesce((select suppressed from channel_suppressions s where s.contact_hash = b.contact_hash), false)
    order by f.id, b.verified_at desc
    limit p_limit
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Claims due intents and rechecks every permission immediately before the
-- provider call. A lease that ran out mid-send becomes 'ambiguous': the
-- provider may or may not have accepted it, so it is never blindly retried.
create function channel_outbound_claim(p_limit int default 20, p_lease_seconds int default 120, p_only uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o channel_outbound; b channel_bindings; claimed jsonb := '[]'; reason text; practice text;
begin
  update channel_outbound set status = 'ambiguous', last_error = 'lease_expired_during_send', updated_at = now()
    where status = 'sending' and lease_until < now();
  for o in select * from channel_outbound where status in ('pending','failed') and attempts < 3 and next_attempt_at <= now()
    and (p_only is null or id = p_only)
    order by created_at limit p_limit for update skip locked loop
    perform pg_advisory_xact_lock(hashtextextended('channel:' || o.contact_hash, 0));
    select * into b from channel_bindings where id = o.binding_id;
    reason := null; practice := null;
    if b.revoked_at is not null then reason := 'binding_revoked';
    elsif o.optional and coalesce((select suppressed from channel_suppressions where contact_hash = o.contact_hash), false) then
      reason := 'contact_suppressed';
    elsif o.purpose = 'care_check_in' then
      select p.name into practice from care_follow_ups f join care_encounters e on e.id = f.encounter_id
        join care_relationships r on r.subject_id = e.subject_id and r.practice_id = e.practice_id and r.tracking and r.messaging
        join care_practices p on p.id = e.practice_id and p.enabled and p.synthetic
        join care_representatives rep on rep.subject_id = e.subject_id and rep.actor_id = b.care_actor_id
          and rep.relationship = 'self' and rep.revoked_at is null
        join care_actors a on a.id = b.care_actor_id and a.status = 'active' and a.synthetic
        where f.id = o.follow_up_id and f.status = 'submitted';
      if practice is null then reason := 'check_in_no_longer_applicable'; end if;
    else
      if not exists (select 1 from evidence_releases l join evidence_requests q on q.id = l.request_id
          join evidence_principals p on p.owner_id = q.owner_id and p.id = b.evidence_principal_id
          join evidence_sessions s on s.binding_id = b.id and s.purpose = 'channel'
          where l.id = o.release_id and l.status <> 'withdrawn' and p.active and not p.deleting
            and s.revoked_at is null and s.expires_at > now()) then
        reason := 'release_or_recipient_no_longer_authorised';
      end if;
    end if;
    if reason is not null then
      update channel_outbound set status = 'cancelled', cancel_reason = reason, updated_at = now() where id = o.id;
      continue;
    end if;
    update channel_outbound set status = 'sending', attempts = attempts + 1, updated_at = now(),
      lease_until = now() + make_interval(secs => p_lease_seconds) where id = o.id returning * into o;
    claimed := claimed || jsonb_build_array(jsonb_build_object('id', o.id, 'purpose', o.purpose, 'address', b.address,
      'artifact_id', o.artifact_id, 'release_id', o.release_id, 'practice_name', practice, 'language', b.language));
  end loop;
  return claimed;
end $$;

create function channel_outbound_artifact(p_outbound uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a evidence_report_artifacts; code text; num int;
begin
  select ar.* into a from evidence_report_artifacts ar join channel_outbound o on o.artifact_id = ar.id
    where o.id = p_outbound and o.status = 'sending';
  if not found then raise exception 'NOT_FOUND'; end if;
  select s.content->>'formulation_code', v.number into code, num from evidence_releases l
    join formulation_evidence_snapshots s on s.request_id = l.request_id
    join evidence_report_revisions v on v.id = l.report_id where l.id = a.release_id;
  return jsonb_build_object('base64', encode(a.bytes, 'base64'), 'sha256', a.sha256,
    'filename', 'sanko-evidence-' || coalesce(code, 'report') || '-v' || num || '.pdf');
end $$;

create function channel_outbound_result(p_outbound uuid, p_status text, p_provider_id text, p_error text, p_media_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('accepted','failed','ambiguous') then raise exception 'INVALID_INPUT'; end if;
  update channel_outbound set status = p_status, provider_message_id = coalesce(p_provider_id, provider_message_id),
    provider_media_id = coalesce(p_media_id, provider_media_id),
    media_cleanup = case when p_media_id is not null then 'pending' else media_cleanup end,
    last_error = left(p_error, 500), lease_until = null, updated_at = now(),
    next_attempt_at = case when p_status = 'failed' then now() + make_interval(secs => 60 * power(2, attempts)::int) else next_attempt_at end
  where id = p_outbound and status = 'sending';
  if not found then raise exception 'INVALID_TRANSITION'; end if;
  insert into channel_audit(action, detail) values ('outbound.' || p_status, jsonb_build_object('id', p_outbound));
end $$;

create function channel_outbound_media_cleanup(p_outbound uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update channel_outbound set media_cleanup = case when p_ok then 'done' else 'failed' end, updated_at = now()
    where id = p_outbound and media_cleanup in ('pending','failed');
end $$;

create function channel_media_cleanup_due(p_limit int default 20) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'media_id', provider_media_id)), '[]') from (
    select id, provider_media_id from channel_outbound
    where media_cleanup in ('pending','failed') and provider_media_id is not null
      and status in ('delivered','read','failed','cancelled')
    order by updated_at limit p_limit) x
$$;

-- Provider status callbacks: idempotent and never regress stronger evidence.
create function channel_delivery_status(p_provider_id text, p_status text, p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o channel_outbound; rank_new int; rank_old int; changed boolean := false;
begin
  if p_status not in ('sent','delivered','read','failed') or p_provider_id is null then return '{"recorded":false}'; end if;
  select * into o from channel_outbound where provider_message_id = p_provider_id for update;
  insert into channel_delivery_events(outbound_id, provider_message_id, status, provider_at)
    values (o.id, p_provider_id, p_status, p_at) on conflict do nothing;
  if o.id is null then return '{"recorded":true,"matched":false}'; end if;
  rank_new := case p_status when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 else 0 end;
  rank_old := case o.status when 'accepted' then 1 when 'ambiguous' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 else 0 end;
  if p_status = 'failed' and o.status in ('accepted','sent','ambiguous') then
    update channel_outbound set status = 'failed', attempts = 3, last_error = 'provider_reported_failure', updated_at = now() where id = o.id;
    changed := true;
  elsif rank_new > rank_old and o.status <> 'failed' then
    update channel_outbound set status = p_status, updated_at = now() where id = o.id;
    changed := true;
  end if;
  return jsonb_build_object('recorded', true, 'matched', true, 'changed', changed);
end $$;

-- Operator reconciliation for an ambiguous attempt after checking the
-- provider's records. Never automatic.
create function channel_outbound_reconcile(p_outbound uuid, p_decision text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_decision not in ('retry','accepted','cancel') then raise exception 'INVALID_INPUT'; end if;
  update channel_outbound set status = case p_decision when 'retry' then 'pending' when 'accepted' then 'accepted' else 'cancelled' end,
    cancel_reason = case when p_decision = 'cancel' then 'operator_reconciled' end, updated_at = now()
    where id = p_outbound and status = 'ambiguous';
  if not found then raise exception 'INVALID_TRANSITION'; end if;
  insert into channel_audit(action, detail) values ('outbound.reconciled', jsonb_build_object('id', p_outbound, 'decision', p_decision));
end $$;

create function channel_outbound_state(p_contact text, p_outbound uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('status', status, 'cancel_reason', cancel_reason, 'attempts', attempts)
  from channel_outbound where id = p_outbound and contact_hash = p_contact
$$;

-- Retention housekeeping. Interrupted drafts are kept for 24 hours (the task
-- expiry) and then purged; this is a synthetic default, not an approved policy.
create function channel_maintenance() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare tasks int; codes int; failures int;
begin
  update channel_prompts set expires_at = least(expires_at, now())
    where task_id in (select id from channel_tasks where status = 'active' and expires_at <= now());
  update channel_tasks set status = 'expired', draft = '{}', updated_at = now() where status = 'active' and expires_at <= now();
  get diagnostics tasks = row_count;
  delete from channel_link_codes where expires_at <= now() - interval '1 day';
  get diagnostics codes = row_count;
  delete from channel_link_failures where created_at <= now() - interval '1 day';
  get diagnostics failures = row_count;
  return jsonb_build_object('expired_tasks', tasks, 'deleted_codes', codes, 'deleted_failures', failures);
end $$;

-- ─── access control ──────────────────────────────────────────────────────────

do $$ declare t text; f record;
begin
  foreach t in array array['channel_link_codes','channel_link_failures','channel_bindings','channel_tasks','channel_prompts',
    'channel_answers','channel_suppressions','channel_suppression_events','channel_outbound','channel_delivery_events',
    'channel_audit','evidence_report_artifacts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated, service_role', t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace = 'public'::regnamespace
    and (proname like 'channel_%' or proname in ('care_channel_link_code','evidence_channel_link_code')) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
  end loop;
end $$;

-- The backend calls only these entry points. Internal helpers stay private.
grant execute on function
  care_channel_link_code(text, text, text),
  evidence_channel_link_code(text, text, text),
  channel_redeem_link(text, text, text, int),
  channel_unlink(text, text),
  channel_status(text),
  channel_set_language(text, text),
  channel_care_act(text, text, text, uuid, uuid, jsonb, uuid, uuid),
  channel_evidence_act(text, text, uuid, int, jsonb, uuid, uuid),
  channel_task_get(text),
  channel_task_put(text, jsonb, int),
  channel_prompt_issue(text, uuid, int, text, jsonb, jsonb, int, boolean, text, uuid, uuid),
  channel_prompt_answer(text, uuid, int),
  channel_prompt_result(text, uuid, jsonb),
  channel_current_prompt(text),
  channel_record_answer(text, uuid, uuid, text, text, text, text, text, uuid),
  channel_stop(text, text),
  channel_resume(text, text),
  channel_evidence_store_artifact(text, uuid, text, text, text, text),
  channel_evidence_ack_notice(text, text),
  channel_evidence_request_delivery(text, uuid, uuid, uuid),
  channel_enqueue_check_ins(int),
  channel_outbound_claim(int, int, uuid),
  channel_outbound_artifact(uuid),
  channel_outbound_result(uuid, text, text, text, text),
  channel_outbound_media_cleanup(uuid, boolean),
  channel_media_cleanup_due(int),
  channel_delivery_status(text, text, timestamptz),
  channel_outbound_reconcile(uuid, text),
  channel_outbound_state(text, uuid),
  channel_maintenance()
to service_role;

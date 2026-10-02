-- Private formulation evidence. E0 only: explicitly enrolled fictional records.
-- No care, contributor terms, external grants or production activation.
create table evidence_principals (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid unique not null,
 owner_id uuid references practitioners(id) on delete set null,
 display_name text not null, active boolean not null default true,
 synthetic boolean not null default true check(synthetic),
 capabilities text[] not null default '{}' check(capabilities <@ array['admin','analyst','reviewer','release']),
 verification_record text not null, verified_at timestamptz not null default now(),
 deleting boolean not null default false
);
create table evidence_reviewer_profiles (
 principal_id uuid primary key references evidence_principals(id) on delete cascade,
 competence text[] not null check(cardinality(competence)>0), verifier text not null,
 verified_at timestamptz not null, conflicts text not null, active boolean not null default true
);
create table evidence_sessions (
 token_hash text primary key, csrf_hash text not null,
 principal_id uuid not null references evidence_principals(id) on delete cascade,
 authenticated_at timestamptz not null default now(), expires_at timestamptz not null default(now()+interval '30 minutes'),
 revoked_at timestamptz
);
create table evidence_formulation_enrolments (
 formulation_id uuid primary key references formulations(id) on delete cascade,
 synthetic boolean not null default true check(synthetic), verified_by text not null
);
create table evidence_programmes (
 id uuid primary key default gen_random_uuid(), name text not null, capacity int not null check(capacity>=0),
 active boolean not null default true, synthetic boolean not null default true check(synthetic)
);
create table evidence_requests (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references practitioners(id) on delete cascade,
 formulation_id uuid references formulations(id) on delete set null,
 programme_id uuid not null references evidence_programmes(id), purpose text not null,
 scope text not null default 'ingredient_overview' check(scope='ingredient_overview'),
 status text not null default 'draft' check(status in ('draft','submitted','waitlisted','accepted','needs_information','review','changes_required','approved','released','cancelled','declined')),
 revision int not null default 1, generation int not null default 1, question text, answer text,
 updates_request_id uuid,
 created_by uuid not null references evidence_principals(id), created_at timestamptz not null default now(),
 unique(id,owner_id),
 foreign key(updates_request_id,owner_id) references evidence_requests(id,owner_id) on delete cascade
);
create table formulation_evidence_snapshots (
 request_id uuid primary key references evidence_requests(id) on delete cascade,
 owner_id uuid not null, content jsonb not null, content_hash text not null,
 source_fingerprint text not null, confirmed_by uuid not null references evidence_principals(id),
 confirmed_at timestamptz not null default now(),
 foreign key(request_id,owner_id) references evidence_requests(id,owner_id) on delete cascade
);
create table evidence_service_authorisations (
 request_id uuid primary key references evidence_requests(id) on delete cascade,
 principal_id uuid not null references evidence_principals(id), notice jsonb not null,
 notice_hash text not null, granted_at timestamptz not null default now(), revoked_at timestamptz,
 channel text not null default 'verified_portal' check(channel='verified_portal'), language text not null default 'en' check(language='en')
);
create table evidence_assignments (
 request_id uuid not null references evidence_requests(id) on delete cascade,
 principal_id uuid not null references evidence_principals(id) on delete cascade,
 capability text not null check(capability in ('analyst','reviewer','release')),
 assigned_by uuid not null references evidence_principals(id), revoked_at timestamptz,
 primary key(request_id,principal_id,capability)
);
-- A saved report is a new immutable revision, including its source/extraction
-- manifest and both deterministic HTML artifacts. There are no remote files in E0.
create table evidence_report_revisions (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references evidence_requests(id) on delete cascade,
 number int not null, author_id uuid not null references evidence_principals(id),
 snapshot_hash text not null, content jsonb not null, artifacts jsonb not null,
 content_hash text not null, manifest_hash text not null,
 audience text not null default 'owner' check(audience='owner'), language text not null default 'en' check(language='en'),
 created_at timestamptz not null default now(), unique(request_id,number), unique(id,request_id)
);
create table evidence_review_decisions (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references evidence_requests(id) on delete cascade,
 report_id uuid not null, signer_id uuid not null references evidence_principals(id),
 manifest_hash text not null, decision text not null check(decision in ('approved','changes_required')),
 reason text not null, checks jsonb not null, competence jsonb not null, signed_at timestamptz not null default now(),
 foreign key(report_id,request_id) references evidence_report_revisions(id,request_id) on delete cascade
);
create table evidence_releases (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references evidence_requests(id) on delete cascade,
 report_id uuid unique not null, decision_id uuid not null references evidence_review_decisions(id),
 released_by uuid not null references evidence_principals(id), released_at timestamptz not null default now(),
 status text not null default 'released' check(status in ('released','superseded','withdrawn')),
 reason text, foreign key(report_id,request_id) references evidence_report_revisions(id,request_id) on delete cascade
);
create table evidence_jobs (
 id uuid primary key default gen_random_uuid(), request_id uuid unique not null references evidence_requests(id) on delete cascade,
 generation int not null, kind text not null default 'manual_review' check(kind='manual_review'),
 status text not null default 'queued' check(status in ('queued','working','completed','cancelled'))
);
create table evidence_corrections (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references evidence_requests(id) on delete cascade,
 release_id uuid not null references evidence_releases(id) on delete cascade,
 reason text not null, created_by uuid not null references evidence_principals(id), created_at timestamptz not null default now()
);
create table evidence_confirmations (
 id uuid primary key default gen_random_uuid(), session_hash text not null references evidence_sessions(token_hash) on delete cascade,
 payload_hash text not null, expires_at timestamptz not null default(now()+interval '5 minutes'), consumed_at timestamptz
);
create table evidence_idempotency (
 principal_id uuid not null references evidence_principals(id) on delete cascade,
 key uuid not null, payload_hash text not null, result jsonb not null,
 primary key(principal_id,key)
);
create table evidence_audit (
 id uuid primary key default gen_random_uuid(), principal_id uuid references evidence_principals(id) on delete set null,
 owner_id uuid references practitioners(id) on delete cascade, request_id uuid references evidence_requests(id) on delete cascade,
 action text not null, revision int, created_at timestamptz not null default now()
);
create index evidence_requests_owner on evidence_requests(owner_id,created_at,id);
create index evidence_assignments_principal on evidence_assignments(principal_id,request_id);
create index evidence_audit_owner on evidence_audit(owner_id,created_at);

create function evidence_hash(v jsonb) returns text language sql immutable set search_path=public,pg_temp as $$
 select encode(sha256(convert_to(v::text,'UTF8')),'hex')
$$;
create function evidence_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'IMMUTABLE_RECORD'; end $$;
create trigger evidence_snapshot_immutable before update on formulation_evidence_snapshots for each row execute function evidence_immutable();
create trigger evidence_report_immutable before update on evidence_report_revisions for each row execute function evidence_immutable();
create trigger evidence_decision_immutable before update on evidence_review_decisions for each row execute function evidence_immutable();
create trigger evidence_audit_immutable before update on evidence_audit for each row execute function evidence_immutable();

create function evidence_recipe(p_formulation uuid, p_owner uuid) returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('schema_version',1,'formulation_code',f.short_code,'source_updated_at',f.updated_at,
 'plants',coalesce(f.plants,'[]'::jsonb),'preparation',coalesce(f.preparation,'"unknown"'::jsonb),
 'dosage',coalesce(f.dosage,'"unknown"'::jsonb),'reported_use',coalesce(f.condition_local,f.condition_std,'unknown'),
 'provenance',jsonb_build_object('source','practitioner account','language',f.original_language),
 'identity_limit','Name mappings are not botanical authentication. Unknown or withheld values remain unresolved.')
 from formulations f join evidence_formulation_enrolments e on e.formulation_id=f.id
 where f.id=p_formulation and f.practitioner_id=p_owner and f.status<>'deleted'
$$;
create function evidence_notice() returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select '{"version":"synthetic-v1","status":"DRAFT — fictional exercise only","purpose":"private evidence review","scope":"Assigned analyst, independent scientific reviewer and release manager may review this confirmed recipe. Manual processing only; no external processors. Cancel to stop new work. Fictional records remain until account deletion. Live retention and service arrangements are not approved.","excluded":"No publication, third-party research, commercial use, model training or patient use is authorised."}'::jsonb
$$;
create function evidence_open_session(p_auth_user uuid,p_token text,p_csrf text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;
begin
 select id into actor from evidence_principals where auth_user_id=p_auth_user and active and synthetic and not deleting;
 if actor is null then raise exception 'UNAUTHENTICATED'; end if;
 insert into evidence_sessions(token_hash,csrf_hash,principal_id) values(p_token,p_csrf,actor);
 insert into evidence_audit(principal_id,action) values(actor,'login');
end $$;

-- Rights remain available while feature flags are off. No raw third-party texts.
create function evidence_owner_export(p_owner uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if exists(select 1 from evidence_principals where owner_id=p_owner and deleting) then raise exception 'NOT_FOUND'; end if;
 select jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(r)) from evidence_requests r where owner_id=p_owner),'[]'::jsonb),
 'snapshots',coalesce((select jsonb_agg(to_jsonb(s)) from formulation_evidence_snapshots s where owner_id=p_owner),'[]'::jsonb),
 'authorisations',coalesce((select jsonb_agg(to_jsonb(a)) from evidence_service_authorisations a join evidence_requests r on r.id=a.request_id where r.owner_id=p_owner),'[]'::jsonb),
 'releases',coalesce((select jsonb_agg(jsonb_build_object('release',to_jsonb(l),'artifacts',v.artifacts,'manifest_hash',v.manifest_hash)) from evidence_releases l join evidence_requests r on r.id=l.request_id join evidence_report_revisions v on v.id=l.report_id where r.owner_id=p_owner and l.status in ('released','superseded')),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(jsonb_build_object('action',x.action,'request_id',x.request_id,'created_at',x.created_at)) from evidence_audit x where x.owner_id=p_owner),'[]'::jsonb),
 'corrections',coalesce((select jsonb_agg(to_jsonb(c)) from evidence_corrections c join evidence_requests r on r.id=c.request_id where r.owner_id=p_owner),'[]'::jsonb)) into result;
 insert into evidence_audit(owner_id,action) values(p_owner,'export');
 return result;
end $$;
create function evidence_freeze_owner(p_owner uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Serialize all sessions/actions for this owner before fencing requests.
 perform 1 from evidence_principals where owner_id=p_owner order by id for update;
 update evidence_principals set deleting=true where owner_id=p_owner;
 perform 1 from evidence_requests where owner_id=p_owner order by id for update;
 update evidence_service_authorisations set revoked_at=coalesce(revoked_at,now()) where request_id in(select id from evidence_requests where owner_id=p_owner);
 update evidence_requests set generation=generation+1 where owner_id=p_owner;
 update evidence_jobs set status='cancelled' where request_id in(select id from evidence_requests where owner_id=p_owner);
 update evidence_sessions set revoked_at=now() where principal_id in(select id from evidence_principals where owner_id=p_owner);
 delete from evidence_idempotency where result->>'owner_id'=p_owner::text;
 insert into evidence_audit(owner_id,action) values(p_owner,'deletion_fenced');
end $$;
-- Revoke content writes from even the backend role: mutations go through RPCs.
do $$ declare t text; f record; begin
 for t in select tablename from pg_tables where schemaname='public' and (tablename like 'evidence_%' or tablename='formulation_evidence_snapshots') loop
  execute format('alter table %I enable row level security',t);
  execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'evidence_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function evidence_open_session(uuid,text,text),evidence_owner_export(uuid),evidence_freeze_owner(uuid) to service_role;

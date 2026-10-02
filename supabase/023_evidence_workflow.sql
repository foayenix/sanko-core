-- All workflow mutations, approvals, confirmations, and audit writes commit
-- together. The service cannot mutate the private tables directly.
create function evidence_action(p_token text,p_csrf text,p_action text,p_role text,
 p_request uuid default null,p_revision int default null,p_data jsonb default '{}',p_key uuid default null,p_confirmation uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 s evidence_sessions; a evidence_principals; r evidence_requests; v evidence_report_revisions;
 d evidence_review_decisions; l evidence_releases; profile evidence_reviewer_profiles;
 actual text:=p_action; payload jsonb:=p_data; fingerprint text; recipe jsonb; result jsonb;
 prior evidence_idempotency; confirmation evidence_confirmations; manifest text;
 allowed boolean:=false; must_confirm boolean; is_read boolean; programme evidence_programmes;
 report_number int; row_count int; notice jsonb:=evidence_notice();
begin
 select * into s from evidence_sessions where token_hash=p_token and revoked_at is null and expires_at>now();
 if not found then raise exception 'UNAUTHENTICATED'; end if;
 if s.csrf_hash is distinct from p_csrf then raise exception 'CSRF_REQUIRED'; end if;
 select * into a from evidence_principals where id=s.principal_id and active and synthetic and not deleting for update;
 if not found then raise exception 'UNAUTHENTICATED'; end if;
 -- Revocation can race the initial session lookup; recheck after identity lock.
 if not exists(select 1 from evidence_sessions where token_hash=p_token and revoked_at is null and expires_at>now()) then raise exception 'UNAUTHENTICATED'; end if;
 if p_role is null or p_role not in ('owner','admin','analyst','reviewer','release') then raise exception 'NOT_FOUND'; end if;
 if p_action='me' then null;
 elsif p_role='owner' then
  if a.owner_id is null then raise exception 'NOT_FOUND'; end if;
 elsif not p_role=any(a.capabilities) then raise exception 'NOT_FOUND'; end if;
 if p_action='prepare' then actual:=p_data->>'action'; payload:=p_data->'data'; end if;
 if actual is null or actual not in ('me','logout','formulations','list','queue','staff','get','create','submit','triage','assign','ask','answer','draft','submit_review','approve','changes','release','artifact','cancel','correction','withdraw','export','delete') then raise exception 'INVALID_ACTION'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'INVALID_INPUT'; end if;
 is_read:=actual in ('me','formulations','list','queue','staff','get','artifact');
 must_confirm:=actual in ('submit','approve','release','cancel','withdraw','export','delete');
 if actual in ('approve','release','withdraw','export','delete') and s.authenticated_at<now()-interval '10 minutes' then raise exception 'REAUTHENTICATE'; end if;
 if p_request is not null then
  select * into r from evidence_requests where id=p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists(select 1 from evidence_principals where owner_id=r.owner_id and active and not deleting) then raise exception 'NOT_FOUND'; end if;
  if p_role='owner' then allowed:=a.owner_id=r.owner_id;
  elsif p_role='admin' then allowed:=actual in ('triage','assign');
  else
   allowed:=exists(select 1 from evidence_assignments where request_id=r.id and principal_id=a.id and capability=p_role and revoked_at is null)
    and exists(select 1 from evidence_service_authorisations where request_id=r.id and revoked_at is null);
  end if;
  if not allowed then raise exception 'NOT_FOUND'; end if;
 end if;
 -- Role is a context selector, never an elevation. Every action has a narrow role.
 if actual in ('formulations','create','submit','answer','cancel','correction','export','delete') and p_role<>'owner'
 or actual in ('queue','staff','triage','assign') and p_role<>'admin'
 or actual in ('ask','draft','submit_review') and p_role<>'analyst'
 or actual in ('approve','changes') and p_role<>'reviewer'
 or actual in ('release','withdraw') and p_role not in ('release','reviewer')
 then raise exception 'NOT_FOUND'; end if;
 if actual in ('get','submit','triage','assign','ask','answer','draft','submit_review','approve','changes','release','artifact','cancel','correction','withdraw') and r.id is null then raise exception 'NOT_FOUND'; end if;
 if p_role='reviewer' and actual in ('approve','changes','release','withdraw') then
  select * into profile from evidence_reviewer_profiles where principal_id=a.id and active;
  if not found or not 'ingredient_overview'=any(profile.competence) then raise exception 'REVIEWER_INELIGIBLE'; end if;
 end if;
 fingerprint:=evidence_hash(jsonb_build_object('action',actual,'role',p_role,'request',p_request,'revision',p_revision,'data',payload));
 if not is_read and p_action<>'prepare' and actual<>'logout' then
  if p_key is null then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
  select * into prior from evidence_idempotency where principal_id=a.id and key=p_key;
  if found then
   if prior.payload_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return prior.result;
  end if;
 end if;
 if not is_read and r.id is not null and r.revision is distinct from p_revision then raise exception 'REVISION_CONFLICT'; end if;
 if actual in ('submit','get') then recipe:=evidence_recipe(r.formulation_id,r.owner_id); end if;
 if actual='submit' then
  if r.status<>'draft' then raise exception 'INVALID_TRANSITION'; end if;
  -- Lock the source row against edits through snapshot commit.
  perform 1 from formulations where id=r.formulation_id and practitioner_id=r.owner_id for share;
  recipe:=evidence_recipe(r.formulation_id,r.owner_id);
  if recipe is null then raise exception 'NOT_FOUND'; end if;
  if payload->>'snapshot_hash' is distinct from evidence_hash(recipe) then raise exception 'REVISION_CONFLICT'; end if;
  if payload->>'notice_hash' is distinct from evidence_hash(notice) then raise exception 'CONFIRMATION_REQUIRED'; end if;
 end if;
 if p_action='prepare' then
  if not must_confirm then raise exception 'INVALID_ACTION'; end if;
  insert into evidence_confirmations(session_hash,payload_hash) values(p_token,fingerprint) returning * into confirmation;
  insert into evidence_audit(principal_id,owner_id,request_id,action,revision) values(a.id,coalesce(r.owner_id,a.owner_id),r.id,'prepare_'||actual,r.revision);
  return jsonb_build_object('confirmation',confirmation.id,'expires_at',confirmation.expires_at,'action',actual,'data',payload,'recipe',recipe,'notice',case when actual='submit' then notice else null end);
 end if;
 if must_confirm then
  update evidence_confirmations set consumed_at=now() where id=p_confirmation and session_hash=p_token and payload_hash=fingerprint and consumed_at is null and expires_at>now();
  get diagnostics row_count=row_count;
  if row_count<>1 then raise exception 'CONFIRMATION_REQUIRED'; end if;
 end if;
 case actual
 when 'me' then result:=jsonb_build_object('name',a.display_name,'roles',to_jsonb(a.capabilities)||case when a.owner_id is not null then '["owner"]'::jsonb else '[]'::jsonb end,'synthetic',true);
 when 'logout' then
  update evidence_sessions set revoked_at=now() where token_hash=p_token; result:='{"signed_out":true}';
 when 'formulations' then
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'code',f.short_code)), '[]') into result from formulations f join evidence_formulation_enrolments e on e.formulation_id=f.id where f.practitioner_id=a.owner_id and f.status<>'deleted';
 when 'staff' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'capabilities',capabilities)), '[]') into result from evidence_principals where active and not deleting and cardinality(capabilities)>0;
 when 'list','queue' then
  select coalesce(jsonb_agg(x),'[]') into result from (
   select q.id,q.status,q.revision,q.scope,q.created_at from evidence_requests q
   where (p_role='owner' and q.owner_id=a.owner_id or p_role='admin' and actual='queue' or exists(select 1 from evidence_assignments e join evidence_service_authorisations au on au.request_id=e.request_id where e.request_id=q.id and e.principal_id=a.id and e.capability=p_role and e.revoked_at is null and au.revoked_at is null))
   and (payload->>'before' is null or (q.created_at,q.id)<((payload->>'before')::timestamptz,(payload->>'before_id')::uuid))
   order by q.created_at desc,q.id desc limit 50
  ) x;
 when 'create' then
  if not exists(select 1 from formulations f join evidence_formulation_enrolments e on e.formulation_id=f.id where f.id=(payload->>'formulation_id')::uuid and f.practitioner_id=a.owner_id and f.status<>'deleted') then raise exception 'NOT_FOUND'; end if;
  select * into programme from evidence_programmes where active order by id limit 1;
  if not found then raise exception 'CAPACITY_UNAVAILABLE'; end if;
  if payload->>'updates_request_id' is not null and not exists(select 1 from evidence_requests where id=(payload->>'updates_request_id')::uuid and owner_id=a.owner_id and status='released') then raise exception 'NOT_FOUND'; end if;
  insert into evidence_requests(owner_id,formulation_id,programme_id,purpose,created_by,updates_request_id)
   values(a.owner_id,(payload->>'formulation_id')::uuid,programme.id,payload->>'purpose',a.id,(payload->>'updates_request_id')::uuid) returning * into r;
  result:=jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'owner_id',r.owner_id);
 when 'get' then
  select * into v from evidence_report_revisions where request_id=r.id order by number desc limit 1;
  result:=jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'purpose',r.purpose,'formulation_id',r.formulation_id,'updates_request_id',r.updates_request_id,'scope',r.scope,'question',r.question,'answer',r.answer,
   'snapshot',(select to_jsonb(x) from formulation_evidence_snapshots x where request_id=r.id),
   'recipe',case when r.status='draft' and p_role='owner' then recipe else null end,
   'snapshot_hash',case when r.status='draft' then evidence_hash(recipe) else null end,
   'notice',notice,'notice_hash',evidence_hash(notice),
   'currency',case when recipe is null then 'Source unavailable' when exists(select 1 from formulation_evidence_snapshots where request_id=r.id and source_fingerprint<>evidence_hash(recipe)) then 'Based on an earlier formulation version' else 'Matches the recorded source' end,
   'report',case when p_role in ('analyst','reviewer','release') and v.id is not null then to_jsonb(v) else null end,
   'decisions',case when p_role in ('analyst','reviewer','release') then (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from evidence_review_decisions x where request_id=r.id) else null end,
   'corrections',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'reason',c.reason,'release_id',c.release_id,'created_at',c.created_at)),'[]') from evidence_corrections c where c.request_id=r.id),
   'releases',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'report_id',x.report_id,'status',x.status,'released_at',x.released_at,'reason',x.reason)),'[]') from evidence_releases x where request_id=r.id));
 when 'submit' then
  insert into formulation_evidence_snapshots(request_id,owner_id,content,content_hash,source_fingerprint,confirmed_by)
   values(r.id,r.owner_id,recipe,evidence_hash(recipe),evidence_hash(recipe),a.id);
  insert into evidence_service_authorisations(request_id,principal_id,notice,notice_hash) values(r.id,a.id,notice,evidence_hash(notice));
  update evidence_requests set status='submitted' where id=r.id;
  insert into evidence_jobs(request_id,generation) values(r.id,r.generation);
 when 'assign' then
  if r.status in ('draft','cancelled','declined') then raise exception 'INVALID_TRANSITION'; end if;
  if payload->>'capability' not in ('analyst','reviewer','release') then raise exception 'INVALID_INPUT'; end if;
  if not exists(select 1 from evidence_principals where id=(payload->>'principal_id')::uuid and active and not deleting and (payload->>'capability')=any(capabilities)) then raise exception 'NOT_FOUND'; end if;
  insert into evidence_assignments(request_id,principal_id,capability,assigned_by,revoked_at)
   values(r.id,(payload->>'principal_id')::uuid,payload->>'capability',a.id,case when (payload->>'revoke')::boolean then now() end)
   on conflict(request_id,principal_id,capability) do update set revoked_at=excluded.revoked_at,assigned_by=excluded.assigned_by;
 when 'triage' then
  if r.status not in ('submitted','waitlisted') or payload->>'status' not in ('accepted','waitlisted','declined') then raise exception 'INVALID_TRANSITION'; end if;
  if payload->>'status'='accepted' then
   select * into programme from evidence_programmes where id=r.programme_id and active for update;
   if not found or (select count(*) from evidence_requests where programme_id=r.programme_id and status in ('accepted','needs_information','review','changes_required','approved'))>=programme.capacity then raise exception 'CAPACITY_UNAVAILABLE'; end if;
   if not exists(select 1 from evidence_assignments x join evidence_assignments y on y.request_id=x.request_id join evidence_principals px on px.id=x.principal_id join evidence_principals py on py.id=y.principal_id join evidence_reviewer_profiles rp on rp.principal_id=y.principal_id where x.request_id=r.id and x.capability='analyst' and y.capability='reviewer' and x.principal_id<>y.principal_id and x.revoked_at is null and y.revoked_at is null and px.active and py.active and rp.active and 'ingredient_overview'=any(rp.competence)) then raise exception 'REVIEWER_INELIGIBLE'; end if;
  end if;
  update evidence_requests set status=payload->>'status',question=payload->>'reason' where id=r.id;
 when 'ask' then
  if r.status not in ('accepted','changes_required','needs_information') then raise exception 'INVALID_TRANSITION'; end if;
  update evidence_requests set status='needs_information',question=payload->>'question',answer=null where id=r.id;
 when 'answer' then
  if r.status<>'needs_information' then raise exception 'INVALID_TRANSITION'; end if;
  update evidence_requests set status='accepted',answer=payload->>'answer' where id=r.id;
 when 'draft' then
  if r.status not in ('accepted','changes_required','approved','released') then raise exception 'INVALID_TRANSITION'; end if;
  if not exists(select 1 from evidence_service_authorisations where request_id=r.id and revoked_at is null) then raise exception 'NOT_FOUND'; end if;
  if jsonb_typeof(payload->'content') is distinct from 'object' or jsonb_typeof(payload->'artifacts') is distinct from 'object' or not (payload->'artifacts' ?& array['brief','technical']) then raise exception 'INVALID_INPUT'; end if;
  if length(payload::text)>300000 then raise exception 'INVALID_INPUT'; end if;
  select coalesce(max(number),0)+1 into report_number from evidence_report_revisions where request_id=r.id;
  select content_hash into manifest from formulation_evidence_snapshots where request_id=r.id;
  insert into evidence_report_revisions(request_id,number,author_id,snapshot_hash,content,artifacts,content_hash,manifest_hash)
   values(r.id,report_number,a.id,manifest,payload->'content',payload->'artifacts',evidence_hash(payload->'content'),
   evidence_hash(jsonb_build_object('snapshot',manifest,'content',payload->'content','artifacts',payload->'artifacts','audience','owner','language','en'))) returning * into v;
  update evidence_requests set status='accepted' where id=r.id;
  update evidence_jobs set status='working' where request_id=r.id;
 when 'submit_review','approve','changes','release' then
  select * into v from evidence_report_revisions where request_id=r.id order by number desc limit 1;
  if v.id is null or v.id is distinct from (payload->>'report_id')::uuid or v.manifest_hash is distinct from payload->>'manifest_hash' then raise exception 'REVISION_CONFLICT'; end if;
  if actual='submit_review' then
   if r.status<>'accepted' or v.author_id<>a.id then raise exception 'INVALID_TRANSITION'; end if;
   update evidence_requests set status='review' where id=r.id;
  elsif actual in ('approve','changes') then
   if r.status<>'review' then raise exception 'INVALID_TRANSITION'; end if;
   if v.author_id=a.id then raise exception 'INDEPENDENT_REVIEW_REQUIRED'; end if;
   if actual='approve' and payload->'checks' is distinct from '{"sources":true,"applicability":true,"uncertainty":true,"conflicts":true,"language":true,"artifacts":true}'::jsonb then raise exception 'REVIEW_CHECKS_REQUIRED'; end if;
   insert into evidence_review_decisions(request_id,report_id,signer_id,manifest_hash,decision,reason,checks,competence)
    values(r.id,v.id,a.id,v.manifest_hash,case when actual='approve' then 'approved' else 'changes_required' end,payload->>'reason',coalesce(payload->'checks','{}'),to_jsonb(profile));
   update evidence_requests set status=case when actual='approve' then 'approved' else 'changes_required' end where id=r.id;
  else
   if r.status<>'approved' then raise exception 'INVALID_TRANSITION'; end if;
   select * into d from evidence_review_decisions where report_id=v.id order by signed_at desc,id desc limit 1;
   if d.decision is distinct from 'approved' or d.manifest_hash<>v.manifest_hash or d.signer_id=v.author_id then raise exception 'INDEPENDENT_REVIEW_REQUIRED'; end if;
   if not exists(select 1 from evidence_principals p join evidence_reviewer_profiles rp on rp.principal_id=p.id join evidence_assignments ea on ea.principal_id=p.id where p.id=d.signer_id and p.active and not p.deleting and 'reviewer'=any(p.capabilities) and rp.active and 'ingredient_overview'=any(rp.competence) and ea.request_id=r.id and ea.capability='reviewer' and ea.revoked_at is null) then raise exception 'REVIEWER_INELIGIBLE'; end if;
   if v.author_id=a.id then raise exception 'INDEPENDENT_REVIEW_REQUIRED'; end if;
   if not exists(select 1 from evidence_service_authorisations where request_id=r.id and revoked_at is null) then raise exception 'NOT_FOUND'; end if;
   perform 1 from formulations where id=r.formulation_id for share;
   if evidence_recipe(r.formulation_id,r.owner_id) is null or evidence_hash(evidence_recipe(r.formulation_id,r.owner_id))<>v.snapshot_hash then raise exception 'SOURCE_CHANGED'; end if;
   update evidence_releases set status='superseded' where request_id in (r.id,r.updates_request_id) and status='released';
   insert into evidence_releases(request_id,report_id,decision_id,released_by) values(r.id,v.id,d.id,a.id) returning * into l;
   update evidence_requests set status='released' where id=r.id;
   update evidence_jobs set status='completed' where request_id=r.id;
  end if;
 when 'artifact' then
  select * into l from evidence_releases where id=(payload->>'release_id')::uuid and request_id=r.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if l.status='withdrawn' then raise exception 'REPORT_WITHDRAWN'; end if;
  if payload->>'kind' not in ('brief','technical') then raise exception 'INVALID_INPUT'; end if;
  select * into v from evidence_report_revisions where id=l.report_id;
  select * into d from evidence_review_decisions where id=l.decision_id;
  result:=jsonb_build_object('html',v.artifacts->(payload->>'kind'),'snapshot',(select content from formulation_evidence_snapshots where request_id=r.id),'manifest_hash',v.manifest_hash,'status',l.status,'reviewed_at',d.signed_at,'reviewer',(select display_name from evidence_principals where id=d.signer_id),
   'currency',case when evidence_recipe(r.formulation_id,r.owner_id) is null or evidence_hash(evidence_recipe(r.formulation_id,r.owner_id))<>v.snapshot_hash then 'Based on an earlier or unavailable formulation version' else 'Matches the recorded source' end);
 when 'cancel' then
  if r.status in ('released','cancelled','declined') then raise exception 'INVALID_TRANSITION'; end if;
  update evidence_service_authorisations set revoked_at=now() where request_id=r.id;
  update evidence_requests set status='cancelled',generation=generation+1 where id=r.id;
  update evidence_jobs set status='cancelled' where request_id=r.id;
 when 'correction' then
  if not exists(select 1 from evidence_releases where id=(payload->>'release_id')::uuid and request_id=r.id) then raise exception 'NOT_FOUND'; end if;
  insert into evidence_corrections(request_id,release_id,reason,created_by) values(r.id,(payload->>'release_id')::uuid,payload->>'reason',a.id);
 when 'withdraw' then
  update evidence_releases set status='withdrawn',reason=payload->>'reason' where id=(payload->>'release_id')::uuid and request_id=r.id and status<>'withdrawn';
  if not found then raise exception 'NOT_FOUND'; end if;
 when 'export' then result:=evidence_owner_export(a.owner_id);
 when 'delete' then
  perform evidence_freeze_owner(a.owner_id);
  -- DB-only evidence artifacts are erased transactionally, with no object-store
  -- cleanup to race. Other Vault data is deliberately left to account deletion.
  delete from evidence_requests where owner_id=a.owner_id;
  delete from evidence_idempotency where principal_id=a.id;
  delete from evidence_audit where owner_id=a.owner_id;
  result:='{"deleted":true,"signed_out":true}';
 end case;
 if not is_read and r.id is not null then
  if actual<>'create' then update evidence_requests set revision=revision+1 where id=r.id; end if;
  select * into r from evidence_requests where id=r.id;
  result:=coalesce(result,jsonb_build_object('id',r.id,'status',r.status,'revision',r.revision,'owner_id',r.owner_id,'report_id',v.id,'manifest_hash',v.manifest_hash,'release_id',l.id));
 end if;
 insert into evidence_audit(principal_id,owner_id,request_id,action,revision)
  values(a.id,coalesce(r.owner_id,a.owner_id),r.id,actual,r.revision);
 if not is_read and actual not in ('logout','delete','export') then
  insert into evidence_idempotency(principal_id,key,payload_hash,result) values(a.id,p_key,fingerprint,result);
 end if;
 return result;
end $$;
revoke all on function evidence_action(text,text,text,text,uuid,int,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function evidence_action(text,text,text,text,uuid,int,jsonb,uuid,uuid) to service_role;

-- Narrow Vault adapter. It can prepare intake and read status, never create a
-- confirmation, authorise processing, see a draft/report body or sign/release.
create table evidence_vault_idempotency (
 owner_id uuid not null references practitioners(id) on delete cascade,
 message_key text not null, payload_hash text not null, result jsonb not null,
 primary key(owner_id,message_key)
);
alter table evidence_vault_idempotency enable row level security;
revoke all on evidence_vault_idempotency from public,anon,authenticated,service_role;
create function evidence_vault_action(p_owner uuid,p_action text,p_data jsonb,p_message text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a evidence_principals; f uuid; r evidence_requests; programme uuid; old evidence_vault_idempotency; result jsonb; fingerprint text;
begin
 select * into a from evidence_principals where owner_id=p_owner and active and not deleting and synthetic order by id limit 1 for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_action='start' then
  if p_message is null or length(p_message)>1000 then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
  fingerprint:=evidence_hash(p_data);
  select * into old from evidence_vault_idempotency where owner_id=p_owner and message_key=p_message;
  if found then
   if old.payload_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return old.result;
  end if;
  select q.id into f from formulations q join evidence_formulation_enrolments e on e.formulation_id=q.id where q.practitioner_id=p_owner and q.short_code=p_data->>'formulation_code' and q.status<>'deleted';
  if f is null then raise exception 'NOT_FOUND'; end if;
  select id into programme from evidence_programmes where active order by id limit 1;
  if programme is null then raise exception 'CAPACITY_UNAVAILABLE'; end if;
  if nullif(btrim(p_data->>'purpose'),'') is null or length(p_data->>'purpose')>2000 then raise exception 'INVALID_INPUT'; end if;
  insert into evidence_requests(owner_id,formulation_id,programme_id,purpose,created_by) values(p_owner,f,programme,p_data->>'purpose',a.id) returning * into r;
  result:=jsonb_build_object('request_id',r.id,'status',r.status,'next_step','Sign in to the private evidence portal to check the recipe and service notice. No research is queued until the owner confirms.');
  insert into evidence_vault_idempotency values(p_owner,p_message,fingerprint,result);
 elsif p_action='status' then
  select * into r from evidence_requests where id=(p_data->>'request_id')::uuid and owner_id=p_owner;
  if not found then raise exception 'NOT_FOUND'; end if;
  result:=jsonb_build_object('request_id',r.id,'status',r.status,'question',r.question);
 elsif p_action='reports' then
  select coalesce(jsonb_agg(jsonb_build_object('request_id',r.id,'release_id',l.id,'status',l.status,'released_at',l.released_at)),'[]') into result from evidence_requests r join evidence_releases l on l.request_id=r.id where r.owner_id=p_owner;
 else raise exception 'INVALID_ACTION'; end if;
 insert into evidence_audit(principal_id,owner_id,action) values(a.id,p_owner,'vault_'||p_action);
 return result;
end $$;
revoke all on function evidence_vault_action(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function evidence_vault_action(uuid,text,jsonb,text) to service_role;

-- Erase owned content before the Vault row cascades. Keep only a disabled,
-- unbound pseudonymous signer tombstone when other owners' immutable history
-- still refers to the same principal. No login/recovery can reclaim it.
create function evidence_erase_account() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform evidence_freeze_owner(old.id);
 delete from evidence_requests where owner_id=old.id;
 delete from evidence_sessions where principal_id in(select id from evidence_principals where owner_id=old.id);
 delete from evidence_idempotency where principal_id in(select id from evidence_principals where owner_id=old.id);
 delete from evidence_reviewer_profiles where principal_id in(select id from evidence_principals where owner_id=old.id);
 update evidence_principals set active=false,deleting=true,auth_user_id=gen_random_uuid(),display_name='Deleted principal',verification_record='Deleted',owner_id=null where owner_id=old.id;
 return old;
end $$;
create trigger evidence_erase_account before delete on practitioners for each row execute function evidence_erase_account();
revoke all on function evidence_erase_account() from public,anon,authenticated,service_role;

create function evidence_denied(p_token text,p_action text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_action not in ('approve','release','withdraw','submit','export','delete','get','artifact','draft') then return; end if;
 insert into evidence_audit(principal_id,action)
 select principal_id,'denied_'||p_action from evidence_sessions where token_hash=p_token and revoked_at is null and expires_at>now();
end $$;
revoke all on function evidence_denied(text,text) from public,anon,authenticated;
grant execute on function evidence_denied(text,text) to service_role;

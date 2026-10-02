'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');const fs=require('node:fs');
const {sql,rpc,seed,report}=require('../helpers/evidencePostgres');
const {hash}=require('../../src/evidence/auth');const service=require('../../src/evidence/service');
Object.assign(process.env,{EVIDENCE_ENABLED:'true',EVIDENCE_SYNTHETIC_ONLY:'true',EVIDENCE_ORIGIN:'http://127.0.0.1:3042'});
require('../../src/evidence/store').rpc=rpc;
const checks={sources:true,applicability:true,uncertainty:true,conflicts:true,language:true,artifacts:true};
let fixture;
async function act(who,action,data={},request=null,extra={}) {
 const s=fixture.sessions[who];return service.act(s.token,s.csrf,{action,role:who==='other'?'owner':who,data,...(request?{request_id:request.id,expected_revision:request.revision}:{}),...extra});
}
async function write(who,action,data={},request=null,extra={}) {
 const body={key:crypto.randomUUID(),...extra};
 if(['submit','approve','release','cancel','withdraw','export','delete'].includes(action))body.confirmation=(await act(who,'prepare',{action,data},request)).confirmation;
 return act(who,action,data,request,body);
}
async function created(){return write('owner','create',{formulation_id:fixture.ids.formulation,purpose:'Fictional research only'});}
async function submitted(){const r=await created();const detail=await act('owner','get',{},r);return write('owner','submit',{snapshot_hash:detail.snapshot_hash,notice_hash:detail.notice_hash},r);}
async function accepted(){let r=await submitted();for(const who of ['analyst','reviewer','release'])r=await write('admin','assign',{principal_id:fixture.ids[who],capability:who,revoke:false},r);return write('admin','triage',{status:'accepted',reason:'Fictional capacity and qualified test identities'},r);}
async function reviewed(){let r=await accepted();r=await write('analyst','draft',{content:report()},r);return write('analyst','submit_review',{report_id:r.report_id,manifest_hash:r.manifest_hash},r);}
async function approved(){const r=await reviewed();const d=await act('reviewer','get',{},r);return write('reviewer','approve',{report_id:d.report.id,manifest_hash:d.report.manifest_hash,reason:'Fictional independent review: limitations retained',checks},r);}
async function released(){const r=await approved();const d=await act('reviewer','get',{},r);return write('reviewer','release',{report_id:d.report.id,manifest_hash:d.report.manifest_hash},r);}
test('Evidence PostgreSQL acceptance — synthetic manual workflow',async t=>{
 fixture=await seed();
 await t.test('AT03/04/05 owners cannot use another formulation, while uncertainty survives the snapshot',async()=>{
  await assert.rejects(write('owner','create',{formulation_id:fixture.ids.otherFormulation,purpose:'Wrong owner'}),/NOT_FOUND/);
  const r=await submitted();await assert.rejects(act('other','get',{},r),/NOT_FOUND/);
  const d=await act('owner','get',{},r);assert.equal(d.snapshot.content.plants[0].quantity_raw,'withheld');assert.equal(d.snapshot.content.plants[0].botanical,null);assert.equal(d.report,null);
 });
 await t.test('AT02/14 replay across calls yields one request; changed payload conflicts; competing saves conflict',async()=>{
  const key=crypto.randomUUID(),data={formulation_id:fixture.ids.formulation,purpose:'Replay'};
  const [a,b]=await Promise.all([write('owner','create',data,null,{key}),write('owner','create',data,null,{key})]);assert.equal(a.id,b.id);
  await assert.rejects(write('owner','create',{...data,purpose:'Different'},null,{key}),/IDEMPOTENCY_CONFLICT/);
  const r=await accepted();assert.equal((await act('analyst','get',{},r)).report,null);const saves=await Promise.allSettled([write('analyst','draft',{content:report()},r),write('analyst','draft',{content:report()},r)]);assert.equal(saves.filter(x=>x.status==='fulfilled').length,1);assert.match(saves.find(x=>x.status==='rejected').reason.message,/REVISION_CONFLICT/);
 });
 await t.test('AT07/08 exact owner recipe + notice confirmation expires on source edits',async()=>{
  const r=await created(),detail=await act('owner','get',{},r),data={snapshot_hash:detail.snapshot_hash,notice_hash:detail.notice_hash};
  const confirmation=(await act('owner','prepare',{action:'submit',data},r)).confirmation;
  await sql(`update formulations set condition_local='Changed fictional purpose' where id='${fixture.ids.formulation}'`);
  await assert.rejects(act('owner','submit',data,r,{key:crypto.randomUUID(),confirmation}),/REVISION_CONFLICT/);
  await assert.rejects(act('owner','submit',{snapshot_hash:(await act('owner','get',{},r)).snapshot_hash,notice_hash:detail.notice_hash},r,{key:crypto.randomUUID()}),/CONFIRMATION_REQUIRED/);
 });
 await t.test('AT12 author cannot approve; administrator cannot read; suspended reviewer cannot sign',async()=>{
  let r=await reviewed();r=await write('admin','assign',{principal_id:fixture.ids.analyst,capability:'reviewer',revoke:false},r);
  const d=await act('reviewer','get',{},r);const data={report_id:d.report.id,manifest_hash:d.report.manifest_hash,reason:'Review',checks};
  const s=fixture.sessions.analyst;const body={role:'reviewer',request_id:r.id,expected_revision:r.revision,data};
  const c=await service.act(s.token,s.csrf,{...body,action:'prepare',data:{action:'approve',data}});
  await assert.rejects(service.act(s.token,s.csrf,{...body,action:'approve',confirmation:c.confirmation,key:crypto.randomUUID()}),/INDEPENDENT_REVIEW_REQUIRED/);
  await assert.rejects(act('admin','get',{},r),/NOT_FOUND/);
  await sql(`update evidence_reviewer_profiles set active=false where principal_id='${fixture.ids.reviewer}'`);
  await assert.rejects(write('reviewer','approve',data,r),/REVIEWER_INELIGIBLE/);
  await sql(`update evidence_reviewer_profiles set active=true where principal_id='${fixture.ids.reviewer}'`);
 });
 await t.test('AT13/15/18/19/22 exact reviewed negative report releases, exports, then withdrawal blocks download',async()=>{
  const r=await released();assert.equal(r.status,'released');
  const artifact=await act('owner','artifact',{release_id:r.release_id,kind:'technical'},r);assert.match(artifact.html,/No exact-mixture evidence/);assert.match(artifact.reviewer,/reviewer/);
  const exported=await write('owner','export');assert.ok(exported.releases.some(x=>x.release.id===r.release_id));
  await assert.rejects(sql(`update evidence_report_revisions set content='{}' where id=(select report_id from evidence_releases where id='${r.release_id}')`),/IMMUTABLE_RECORD/);
  await write('reviewer','withdraw',{release_id:r.release_id,reason:'Fictional integrity issue'},r);
  await assert.rejects(act('owner','artifact',{release_id:r.release_id,kind:'brief'},r),/REPORT_WITHDRAWN/);
 });
 await t.test('AT13 stale approval cannot release a newly edited report',async()=>{
  const r=await approved(),d=await act('reviewer','get',{},r);const data={report_id:d.report.id,manifest_hash:d.report.manifest_hash};
  const c=await act('reviewer','prepare',{action:'release',data},r);
  await write('analyst','draft',{content:{...report(),change_summary:'Amendment'}},r);
  await assert.rejects(act('reviewer','release',data,r,{confirmation:c.confirmation,key:crypto.randomUUID()}),/REVISION_CONFLICT/);
 });
 await t.test('AT17 source drift blocks release; historical reports retain snapshots and show a warning',async()=>{
  const historical=await released();const r=await approved();const d=await act('reviewer','get',{},r);
  await sql(`update formulations set preparation='{"method":"changed"}' where id='${fixture.ids.formulation}'`);
  await assert.rejects(write('reviewer','release',{report_id:d.report.id,manifest_hash:d.report.manifest_hash},r),/SOURCE_CHANGED/);
  const artifact=await act('owner','artifact',{release_id:historical.release_id,kind:'brief'},historical);assert.match(artifact.currency,/earlier/);
 });
 await t.test('AT20 cancellation fences all subsequent manual work and leaves one cancelled job',async()=>{
  const r=await accepted();await write('owner','cancel',{},r);await assert.rejects(write('analyst','draft',{content:report()},r),/NOT_FOUND/);
  assert.equal(await sql(`select status from evidence_jobs where request_id='${r.id}'`),'cancelled');
 });
 await t.test('AT25 audit failure rolls back approval and confirmation consumption',async()=>{
  const r=await reviewed(),d=await act('reviewer','get',{},r),data={report_id:d.report.id,manifest_hash:d.report.manifest_hash,reason:'Audit test',checks};const c=await act('reviewer','prepare',{action:'approve',data},r);
  await sql("create function evidence_test_audit_fail() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_UNAVAILABLE'; end $$; create trigger evidence_test_audit before insert on evidence_audit for each row execute function evidence_test_audit_fail();");
  try{await assert.rejects(act('reviewer','approve',data,r,{confirmation:c.confirmation,key:crypto.randomUUID()}),/AUDIT_UNAVAILABLE/);}finally{await sql('drop trigger evidence_test_audit on evidence_audit; drop function evidence_test_audit_fail();');}
  assert.equal(await sql(`select status from evidence_requests where id='${r.id}'`),'review');assert.equal(await sql(`select count(*) from evidence_review_decisions where request_id='${r.id}'`),'0');assert.equal(await sql(`select consumed_at is null from evidence_confirmations where id='${c.confirmation}'`),'t');
 });
 await t.test('AT24 direct SQL denies anonymous/authenticated access, and service role cannot overwrite signed rows',async()=>{
  for(const role of ['anon','authenticated','service_role'])await assert.rejects(sql(`set role ${role}; select * from evidence_report_revisions;`),/permission denied/);
  for(const role of ['anon','authenticated'])await assert.rejects(sql(`set role ${role}; select evidence_owner_export('${fixture.ids.legacy}');`),/permission denied/);
 });
 await t.test('AT02/07 Vault intake replays after restart without a job, consent or privileged path',async()=>{
  const code=await sql(`select short_code from formulations where id='${fixture.ids.formulation}'`);const args={p_owner:fixture.ids.legacy,p_action:'start',p_data:{formulation_code:code,purpose:'Vault draft only'},p_message:'synthetic-message-1'};
  const a=await rpc('evidence_vault_action',args),b=await rpc('evidence_vault_action',args);assert.equal(a.request_id,b.request_id);assert.equal(await sql(`select count(*) from evidence_jobs where request_id='${a.request_id}'`),'0');
  await assert.rejects(rpc('evidence_vault_action',{...args,p_action:'approve'}),/INVALID_ACTION/);
 });
 await t.test('AT23 HTTP uses private cookies, exact origin, CSRF and clears session access on logout',async()=>{
  const express=require('express'),auth=require('../../src/evidence/auth');const app=express();
  app.use('/evidence',require('../../src/evidence/routes').createRouter({login:async()=>{const token=auth.randomToken(),csrf=auth.randomToken();await rpc('evidence_open_session',{p_auth_user:fixture.ids.owner,p_token:hash(token),p_csrf:hash(csrf)});return {token,csrf};}}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const origin=`http://127.0.0.1:${server.address().port}`;process.env.EVIDENCE_ORIGIN=origin;
  try{
   const login=await fetch(origin+'/evidence/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.invalid',password:'synthetic-only'})});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/Path=\/evidence/);assert.match(login.headers.get('cache-control'),/no-store/);
   const session=await login.json(),headers={Origin:origin,'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-Sanko-CSRF':session.csrf};
   const send=(body,h=headers)=>fetch(origin+'/evidence/api/action',{method:'POST',headers:h,body:JSON.stringify(body)});
   assert.equal((await send({action:'me',role:'owner'})).status,200);
   assert.equal((await send({action:'me',role:'owner'},{...headers,Origin:'https://evil.invalid'})).status,403);
   assert.equal((await send({action:'me',role:'owner'},{...headers,'X-Sanko-CSRF':'bad'})).status,403);
   assert.equal((await send({action:'logout',role:'owner'})).status,200);assert.equal((await send({action:'me',role:'owner'})).status,401);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));process.env.EVIDENCE_ORIGIN='http://127.0.0.1:3042';}
 });
 await t.test('AT33 restore preserves immutable content hashes and permissions',async()=>{
  const target=new URL(process.env.EVIDENCE_TEST_DB_URL),base=new URL(target);base.pathname='/postgres';const name='evidence_restore_'+crypto.randomBytes(5).toString('hex');const restore=new URL(base);restore.pathname='/'+name;const path=require('node:path').join(require('node:os').tmpdir(),'evidence-'+name+'.sql');
  const before=await sql('select coalesce(string_agg(manifest_hash,\',\' order by id),\'\') from evidence_report_revisions');
  execFileSync('pg_dump',[target.href,'--no-owner','-f',path]);execFileSync('psql',[base.href,'-c',`create database ${name}`]);
  try{execFileSync('psql',[restore.href,'-X','-v','ON_ERROR_STOP=1','-f',path],{stdio:'pipe'});const after=execFileSync('psql',[restore.href,'-Atc',"select coalesce(string_agg(manifest_hash,',' order by id),'') from evidence_report_revisions"],{encoding:'utf8'}).trim();assert.equal(after,before);}finally{execFileSync('psql',[base.href,'-c',`drop database ${name} with (force)`]);fs.unlinkSync(path);}
 });
 await t.test('F03/F12/F14 clarification and correction preserve the original confirmed snapshot',async()=>{
  let r=await accepted();const original=(await act('owner','get',{},r)).snapshot.content_hash;
  r=await write('analyst','ask',{question:'Which plant part was reported?'},r);
  r=await write('owner','answer',{answer:'I do not know'},r);
  assert.equal((await act('analyst','get',{},r)).answer,'I do not know');
  assert.equal((await act('owner','get',{},r)).snapshot.content_hash,original);
  const releasedRequest=await released();await write('owner','correction',{release_id:releasedRequest.release_id,reason:'Please check the source locator'},releasedRequest);
  assert.equal((await act('reviewer','get',{},releasedRequest)).corrections.length,1);
 });
 await t.test('AT12/14 revoked assignment blocks stale release; concurrent release has one immutable artifact set',async()=>{
  let r=await approved();const d=await act('reviewer','get',{},r),data={report_id:d.report.id,manifest_hash:d.report.manifest_hash};
  const confirmation=(await act('reviewer','prepare',{action:'release',data},r)).confirmation;
  await write('admin','assign',{principal_id:fixture.ids.reviewer,capability:'reviewer',revoke:true},r);
  await assert.rejects(act('reviewer','release',data,r,{confirmation,key:crypto.randomUUID()}),/NOT_FOUND/);
  r=await approved();const detail=await act('reviewer','get',{},r),payload={report_id:detail.report.id,manifest_hash:detail.report.manifest_hash};
  const c=(await act('reviewer','prepare',{action:'release',data:payload},r)).confirmation,key=crypto.randomUUID();
  const results=await Promise.all([act('reviewer','release',payload,r,{confirmation:c,key}),act('reviewer','release',payload,r,{confirmation:c,key})]);
  assert.equal(results[0].release_id,results[1].release_id);assert.equal(await sql(`select count(*) from evidence_releases where request_id='${r.id}'`),'1');
 });
 await t.test('AT08/23 expired confirmation and fresh-auth limits cannot be bypassed',async()=>{
  const r=await created(),detail=await act('owner','get',{},r),data={snapshot_hash:detail.snapshot_hash,notice_hash:detail.notice_hash};
  const c=await act('owner','prepare',{action:'submit',data},r);
  await sql(`update evidence_confirmations set expires_at=now()-interval '1 second' where id='${c.confirmation}'`);
  await assert.rejects(act('owner','submit',data,r,{confirmation:c.confirmation,key:crypto.randomUUID()}),/CONFIRMATION_REQUIRED/);
  await sql(`update evidence_sessions set authenticated_at=now()-interval '11 minutes' where principal_id='${fixture.ids.owner}'`);
  await assert.rejects(write('owner','export'),/REAUTHENTICATE/);
  await sql(`update evidence_sessions set authenticated_at=now() where principal_id='${fixture.ids.owner}'`);
 });
 await t.test('F15 update requests link only owned released history and create a newly confirmed snapshot',async()=>{
  const previous=await released();const next=await write('owner','create',{formulation_id:fixture.ids.formulation,purpose:'New fictional evidence review',updates_request_id:previous.id});
  assert.equal((await act('owner','get',{},next)).updates_request_id,previous.id);
  await assert.rejects(write('other','create',{formulation_id:fixture.ids.otherFormulation,purpose:'Wrong update',updates_request_id:previous.id}),/NOT_FOUND/);
 });
 await t.test('F07 programme capacity prevents acceptance and permits a truthful waitlist',async()=>{
  let r=await submitted();await sql(`update evidence_programmes set capacity=0 where id='${fixture.ids.programme}'`);
  await assert.rejects(write('admin','triage',{status:'accepted',reason:'No capacity'},r),/CAPACITY_UNAVAILABLE/);
  r=await write('admin','triage',{status:'waitlisted',reason:'No reviewer capacity; no delivery estimate'},r);assert.equal(r.status,'waitlisted');
  await sql(`update evidence_programmes set capacity=100 where id='${fixture.ids.programme}'`);
 });
 await t.test('AT21 portal evidence erasure revokes sessions without deleting Vault formulations',async()=>{
  const previous=fixture;
  try {
   fixture=await seed();await submitted();
   const result=await write('owner','delete');assert.equal(result.deleted,true);assert.equal(result.signed_out,true);
   await assert.rejects(act('owner','list'),/UNAUTHENTICATED/);
   assert.equal(await sql(`select count(*) from evidence_requests where owner_id='${fixture.ids.legacy}'`),'0');
   assert.equal(await sql(`select count(*) from formulations where id='${fixture.ids.formulation}'`),'1');
  }finally{fixture=previous;}
 });
 await t.test('AT21 deletion fencing survives retry and prevents content resurrection or other-owner export',async()=>{
  const r=await accepted();await rpc('evidence_freeze_owner',{p_owner:fixture.ids.legacy});await rpc('evidence_freeze_owner',{p_owner:fixture.ids.legacy});
  await assert.rejects(write('analyst','draft',{content:report()},r),/NOT_FOUND/);await assert.rejects(act('owner','get',{},r),/UNAUTHENTICATED/);
  const other=await write('other','export');assert.equal(other.snapshots.length,0);
  await sql(`delete from practitioners where id='${fixture.ids.legacy}'`);
  assert.equal(await sql(`select count(*) from evidence_requests where owner_id='${fixture.ids.legacy}'`),'0');
 });
});

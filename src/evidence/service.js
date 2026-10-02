'use strict';
const store = require('./store');
const { hash } = require('./auth');
const { configuration } = require('./config');
const { render } = require('./reports');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = { me:[],logout:[],formulations:[],list:['before','before_id'],queue:['before','before_id'],staff:[],get:[],create:['formulation_id','purpose','updates_request_id'],submit:['snapshot_hash','notice_hash'],triage:['status','reason'],assign:['principal_id','capability','revoke'],ask:['question'],answer:['answer'],draft:['content'],submit_review:['report_id','manifest_hash'],approve:['report_id','manifest_hash','reason','checks'],changes:['report_id','manifest_hash','reason'],release:['report_id','manifest_hash'],artifact:['release_id','kind'],cancel:[],correction:['release_id','reason'],withdraw:['release_id','reason'],export:[],delete:[] };
function validate(action,data) {
 const fields=FIELDS[action]; if (!fields) throw new Error('INVALID_ACTION');
 if (!data || typeof data!=='object' || Array.isArray(data) || Object.keys(data).some(k=>!fields.includes(k))) throw new Error('INVALID_INPUT');
 for (const field of fields) {
  const value=data[field];
  if (['before','before_id','updates_request_id'].includes(field) && value==null) continue;
  if (field==='content') { render(value); continue; }
  if (field==='checks') {
   if (!value || Object.keys(value).sort().join(',')!=='applicability,artifacts,conflicts,language,sources,uncertainty' || Object.values(value).some(v=>v!==true)) throw new Error('REVIEW_CHECKS_REQUIRED');
  } else if (field==='revoke') { if (typeof value!=='boolean') throw new Error('INVALID_INPUT'); }
  else if (typeof value!=='string' || !value.trim() || value.length>10000 || (field.endsWith('_id') && !UUID.test(value)) || (field.endsWith('_hash') && !/^[a-f0-9]{64}$/.test(value))) throw new Error('INVALID_INPUT');
 }
 if ((data.before!=null)!==(data.before_id!=null) || (data.before && !Number.isFinite(Date.parse(data.before)))) throw new Error('INVALID_INPUT');
 if (action==='triage' && !['accepted','waitlisted','declined'].includes(data.status) || action==='assign' && !['analyst','reviewer','release'].includes(data.capability) || action==='artifact' && !['brief','technical'].includes(data.kind)) throw new Error('INVALID_INPUT');
}
async function act(token,csrf,body) {
 if (!configuration().enabled) throw new Error('FEATURE_DISABLED');
 if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['action','role','request_id','expected_revision','data','key','confirmation'].includes(k))) throw new Error('INVALID_INPUT');
 const { action,role,request_id=null,expected_revision=null,key=null,confirmation=null,data={} }=body;
 if (!['owner','admin','analyst','reviewer','release'].includes(role)) throw new Error('NOT_FOUND');
 for (const id of [request_id,key,confirmation]) if (id!==null && !UUID.test(id)) throw new Error('INVALID_INPUT');
 if (expected_revision!==null && (!Number.isSafeInteger(expected_revision)||expected_revision<1)) throw new Error('INVALID_INPUT');
 if (action==='prepare') {
  if (!data || Object.keys(data).some(k=>!['action','data'].includes(k))) throw new Error('INVALID_INPUT');
  validate(data.action,data.data);
 } else validate(action,data);
 if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf) || !/^[A-Za-z0-9_-]{43}$/.test(token ?? '')) throw new Error('CSRF_REQUIRED');
 const payload=action==='draft'?{...data,artifacts:render(data.content)}:data;
 try { return await store.rpc('evidence_action',{p_token:hash(token),p_csrf:hash(csrf),p_action:action,p_role:role,p_request:request_id,p_revision:expected_revision,p_data:payload,p_key:key,p_confirmation:confirmation});
 } catch (error) {
  await store.rpc('evidence_denied',{p_token:hash(token),p_action:action==='prepare'?data.action:action});
  throw error;
 }
}
module.exports={act,validate,UUID};

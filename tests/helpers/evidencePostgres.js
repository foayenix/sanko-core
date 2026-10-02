'use strict';
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const { hash } = require('../../src/evidence/auth');
const url = process.env.EVIDENCE_TEST_DB_URL;
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = execFile('psql', [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const match = /ERROR:\s+([^\n]+)/.exec(stderr);
        reject(new Error(match?.[1] ?? 'POSTGRES_TEST_FAILED'));
      } else resolve(stdout.trim());
    });
    child.stdin.end(query);
  });
}
const literal = value => value == null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
async function rpc(name, args) {
  if (!/^evidence_[a-z_]+$/.test(name)) throw new Error('INVALID_RPC');
  const params = Object.entries(args).map(([k, v]) => `${k} => ${literal(typeof v === 'object' && v !== null ? JSON.stringify(v) : v)}`).join(',');
  const result = await sql(`select ${name}(${params});`);
  if (!result) return null;
  try { return JSON.parse(result); } catch { return result; }
}
async function seed() {
 const ids=Object.fromEntries(['owner','other','analyst','reviewer','admin','release','legacy','otherLegacy','formulation','otherFormulation','programme'].map(k=>[k,crypto.randomUUID()]));
 const sessions={};
 for(const name of ['owner','other','analyst','reviewer','admin','release'])sessions[name]={token:crypto.randomBytes(32).toString('base64url'),csrf:crypto.randomBytes(32).toString('base64url'),id:ids[name]};
 await sql(`insert into practitioners(id,phone_number,display_name) values('${ids.legacy}','synthetic-${ids.legacy}','Fictional owner'),('${ids.otherLegacy}','synthetic-${ids.otherLegacy}','Fictional other owner');
 insert into formulations(id,practitioner_id,plants,preparation,condition_local,confidence_score) values('${ids.formulation}','${ids.legacy}','[{"local_name":"Fictional leaf A","part_used":"unknown","quantity_raw":"withheld","botanical":null}]','{"method":"unknown"}','Fictional research topic',0.2),('${ids.otherFormulation}','${ids.otherLegacy}','[{"local_name":"Other fictional leaf"}]',null,'Other private topic',0.2);
 insert into evidence_formulation_enrolments(formulation_id,verified_by) values('${ids.formulation}','synthetic test fixture'),('${ids.otherFormulation}','synthetic test fixture');
 insert into evidence_principals(id,auth_user_id,owner_id,display_name,capabilities,verification_record) values
 ${Object.keys(sessions).map(name=>`('${ids[name]}','${ids[name]}',${literal(name==='owner'?ids.legacy:name==='other'?ids.otherLegacy:null)},'Fictional ${name}',${name==='owner'||name==='other'?"'{}'":name==='analyst'?"'{analyst,reviewer,release}'":literal('{'+name+'}')},'Synthetic identity fixture; no professional verification')`).join(',')};
 insert into evidence_reviewer_profiles(principal_id,competence,verifier,verified_at,conflicts) values('${ids.reviewer}','{ingredient_overview}','Fictional verifier',now(),'No real competence claimed'),('${ids.analyst}','{ingredient_overview}','Fictional verifier',now(),'No real competence claimed');
 insert into evidence_programmes(id,name,capacity) values('${ids.programme}','Fictional programme',100);
 ${Object.values(sessions).map(v=>`insert into evidence_sessions(token_hash,csrf_hash,principal_id) values('${hash(v.token)}','${hash(v.csrf)}','${v.id}');`).join('\n')}`);
 return {ids,sessions};
}
function report() {
 const {SECTIONS,BRIEF}=require('../../src/evidence/reports');
 return {brief:Object.fromEntries(BRIEF.map(k=>[k,'Not assessed: fictional demonstration with no eligible clinical evidence.'])),technical:Object.fromEntries(SECTIONS.map(k=>[k,'Not assessed: unresolved identity and undisclosed ratios. No exact-mixture evidence was identified within this fictional search.'])),protocol:{question:'Fictional ingredient evidence question',databases:'Manual synthetic source catalogue',queries:'Fictional leaf A',criteria:'Fictional records only; include null and adverse findings',search_date:'2026-10-01',cutoff:'2026-10-01',coverage_limits:'Synthetic exercise, no real literature searched',outcomes:'One fictional laboratory record; no exact-mixture study'},sources:[{id:'S1',title:'Fictional laboratory source — not a real paper',authors:'Synthetic author',year:2026,identifier:'fixture:S1',source_access:'abstract_only',source_status:'active',checked_date:'2026-10-01',licence:'Original fictional fixture',screening:'included',reason:'Exercise extraction only'}],extractions:[{id:'E1',source_id:'S1',locator:'Fictional abstract, sentence 1',evidence_kind:'in_vitro',target_kind:'ingredient',species_part:'Unresolved fictional species; leaf',preparation_dose_route:'Different fictional preparation; dose not reported',population:'Laboratory model',comparator:'Fictional control',finding:'No difference in fictional assay',limitations:'Not human evidence; different preparation',applicability:'indirect',rationale:'Identity and preparation unresolved',study_quality:'Not assessed: synthetic exercise',finding_direction:'null',interpretation_allowed:'Cannot establish mixture efficacy',verification_status:'analyst_verified'}],claims:[{text:'The fictional assay does not establish efficacy of the mixture.',basis:'literature',extraction_id:'E1',target_kind:'ingredient',clinical_efficacy:false}],change_summary:'Initial fictional evidence-gap report'};
}
module.exports={sql,rpc,seed,literal,report};

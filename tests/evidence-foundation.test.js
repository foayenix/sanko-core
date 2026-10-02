'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {configuration}=require('../src/evidence/config');
const {validateReport,render}=require('../src/evidence/reports');
const {validate}=require('../src/evidence/service');
const {report}=require('./helpers/evidencePostgres');
test('AT01/26/27 feature defaults off and refuses unqualified capabilities independently of care',()=>{
 assert.equal(configuration({}).enabled,false);
 assert.throws(()=>configuration({EVIDENCE_ENABLED:'true'}),/LIVE_EVIDENCE/);
 assert.equal(configuration({EVIDENCE_ENABLED:'true',EVIDENCE_SYNTHETIC_ONLY:'true',EVIDENCE_ORIGIN:'http://127.0.0.1:3042'}).enabled,true);
 for(const key of ['LIVE_PILOT','AI','EXTERNAL_SEARCH','EXTERNAL_SHARING','NOTIFICATIONS','PRODUCT_LEAFLETS','REGULATORY_REPORTS','OUTCOME_LINKING'])assert.throws(()=>configuration({[`EVIDENCE_${key}_ENABLED`]:'true'}),/UNSUPPORTED/);
});
test('AT10/11/18 structured sources and claim boundaries allow negative findings but reject unsupported upgrades',()=>{
 assert.ok(validateReport(report()));
 let r=report();r.sources[0].source_access='metadata_only';assert.throws(()=>validateReport(r),/UNSUPPORTED_SOURCE/);
 r=report();r.sources[0].source_status='retracted';assert.throws(()=>validateReport(r),/UNSUPPORTED_SOURCE/);
 r=report();r.claims[0].target_kind='exact_formulation';assert.throws(()=>validateReport(r),/UNSUPPORTED_CLAIM/);
 r=report();r.claims[0].clinical_efficacy=true;assert.throws(()=>validateReport(r),/UNSUPPORTED_CLAIM/);
 r=report();r.technical.safety_uncertainty='Safe for everyone';assert.throws(()=>validateReport(r),/UNSUPPORTED_CLAIM/);
 r=report();r.extractions[0].locator='';assert.throws(()=>validateReport(r),/INVALID_REPORT/);
});
test('AT34 render treats source instructions and markup as inert text',()=>{
 const r=report();r.sources[0].title='<script>fetch("/admin")</script>';const html=render(r).technical;
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.deepEqual(render(r),render(r));
});
test('AT07 strict action fields cannot accept actor, approval or sharing instructions',()=>{
 assert.throws(()=>validate('submit',{snapshot_hash:'a'.repeat(64),notice_hash:'b'.repeat(64),owner_id:'other'}),/INVALID_INPUT/);
 assert.throws(()=>validate('grant_access',{}),/INVALID_ACTION/);
 assert.throws(()=>validate('approve',{report_id:'foo'}),/INVALID_INPUT/);
});

test('AT01/07/36 evidence tools are separately gated and never expose approval or report contents',async()=>{
 const {selectTools,executeTool}=require('../src/agent/tools');
 const before=process.env.EVIDENCE_ENABLED;
 try {
  delete process.env.EVIDENCE_ENABLED;
  assert.ok(!selectTools('vault').some(x=>x.name==='start_evidence_request'));
  assert.equal((await executeTool('start_evidence_request',{},{})).ok,false);
  process.env.EVIDENCE_ENABLED='true';
  const names=selectTools('vault').map(x=>x.name);
  assert.ok(names.includes('start_evidence_request'));
  assert.ok(!names.some(x=>/approve|release|grant/.test(x)));
  assert.equal((await executeTool('start_evidence_request',{}, {role:'patient'})).ok,false);
 } finally { if(before==null)delete process.env.EVIDENCE_ENABLED;else process.env.EVIDENCE_ENABLED=before; }
});

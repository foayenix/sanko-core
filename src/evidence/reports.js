'use strict';
const crypto = require('node:crypto');
const SECTIONS = ['executive_summary','formulation_specification','traditional_account','search_methods','ingredient_profiles','whole_formulation_evidence','applicability','safety_uncertainty','quality_gaps','conclusions','references'];
const BRIEF = ['scope','practitioner_account','findings','risks_unknowns','limitations','next_steps'];
const ENUMS = {
 evidence_kind: ['traditional_account','ethnobotanical_report','in_vitro','animal','human_observational','human_interventional','systematic_review','reference_monograph','analytical_quality'],
 target_kind: ['exact_formulation','comparable_formulation','ingredient','isolated_constituent'],
 applicability: ['direct','partial','indirect','unclear','not_applicable'],
 finding_direction: ['supportive','null','conflicting','adverse','descriptive','not_assessable'],
 source_access: ['full_text','abstract_only','metadata_only'], source_status: ['active','corrected','retracted','questioned','unknown'],
};
const fail = () => { throw new Error('INVALID_REPORT'); };
function object(value, fields) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) fail();
}
function text(value, max = 10000) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(); }
function date(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) fail(); }
function validateReport(report) {
 object(report, ['brief','technical','protocol','sources','extractions','claims','change_summary']);
 for (const [field, sections] of [['brief', BRIEF], ['technical', SECTIONS]]) {
  object(report[field], sections); for (const section of sections) text(report[field][section]);
 }
 text(report.change_summary);
 object(report.protocol, ['question','databases','queries','criteria','search_date','cutoff','coverage_limits','outcomes']);
 for (const key of ['question','databases','queries','criteria','coverage_limits','outcomes']) text(report.protocol[key]);
 date(report.protocol.search_date); date(report.protocol.cutoff);
 if (!Array.isArray(report.sources) || report.sources.length > 50 || !Array.isArray(report.extractions) || report.extractions.length > 100 || !Array.isArray(report.claims) || report.claims.length > 100) fail();
 const sources = new Map();
 for (const source of report.sources) {
  object(source, ['id','title','authors','year','identifier','source_access','source_status','checked_date','licence','screening','reason']);
  for (const key of ['id','title','authors','identifier','licence','reason']) text(source[key], 2000);
  if (sources.has(source.id)) fail();
  if (!Number.isInteger(source.year) || source.year < 1500 || source.year > 2200) fail();
  for (const key of ['source_access','source_status']) if (!ENUMS[key].includes(source[key])) fail();
  if (!['included','excluded'].includes(source.screening)) fail(); date(source.checked_date);
  sources.set(source.id, source);
 }
 const extractions = new Map();
 for (const row of report.extractions) {
  object(row, ['id','source_id','locator','evidence_kind','target_kind','species_part','preparation_dose_route','population','comparator','finding','limitations','applicability','rationale','study_quality','finding_direction','interpretation_allowed','verification_status']);
  for (const key of ['id','source_id','locator','species_part','preparation_dose_route','population','comparator','finding','limitations','rationale','study_quality','interpretation_allowed']) text(row[key], 4000);
  for (const key of ['evidence_kind','target_kind','applicability','finding_direction']) if (!ENUMS[key].includes(row[key])) fail();
  const source = sources.get(row.source_id);
  if (!source || source.screening !== 'included' || source.source_access === 'metadata_only' || source.source_status === 'retracted' || row.verification_status !== 'analyst_verified' || extractions.has(row.id)) throw new Error('UNSUPPORTED_SOURCE');
  extractions.set(row.id,row);
 }
 for (const claim of report.claims) {
  object(claim,['text','basis','extraction_id','target_kind','clinical_efficacy']); text(claim.text,4000);
  if (!['literature','practitioner_account','reviewer_inference'].includes(claim.basis) || typeof claim.clinical_efficacy !== 'boolean' || !ENUMS.target_kind.includes(claim.target_kind)) fail();
  if (claim.basis === 'literature') {
   const extraction = extractions.get(claim.extraction_id);
   if (!extraction || claim.target_kind !== extraction.target_kind || (claim.clinical_efficacy && !['human_interventional','systematic_review'].includes(extraction.evidence_kind))) throw new Error('UNSUPPORTED_CLAIM');
  } else if (claim.clinical_efficacy) throw new Error('UNSUPPORTED_CLAIM');
 }
 // Conservative flags supplement, never replace, human scientific review.
 const prose = JSON.stringify([report.brief,report.technical,report.claims]);
 if (/safe for everyone|proven synergy|certified effective|guaranteed cure/i.test(prose)) throw new Error('UNSUPPORTED_CLAIM');
 if (Buffer.byteLength(JSON.stringify(report)) > 100000) fail();
 return report;
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const label = key => key.replaceAll('_',' ').replace(/^./,x=>x.toUpperCase());
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function render(report) {
 validateReport(report);
 const article = (title, sections) => `<article><h1>${title}</h1><p>Private · Owner audience · English · Literature synthesis, not certification or proof of efficacy.</p><p>Search cutoff: ${escape(report.protocol.cutoff)}. Ingredient evidence does not establish efficacy or safety of the whole formulation.</p>${Object.entries(sections).map(([key,value])=>`<section><h2>${label(key)}</h2><p>${escape(value)}</p></section>`).join('')}`;
 const brief = article('Sanko Formulation Evidence — Practitioner brief',report.brief) + '</article>';
 const headers=['Source','Study type','Species / part','Preparation / dose / route','Model / population','Comparator','Finding','Limitations','Match to snapshot','Interpretation allowed','Reviewer status'];
 const table = `<table><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${report.extractions.map(x=>`<tr>${[x.source_id,x.evidence_kind,x.species_part,x.preparation_dose_route,x.population,x.comparator,x.finding,x.limitations,`${x.applicability}: ${x.rationale}`,x.interpretation_allowed,x.verification_status].map(y=>`<td>${escape(y)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 const technical = article('Sanko Formulation Evidence Dossier',report.technical) + '<h2>Reproducible search record</h2>' + Object.entries(report.protocol).map(([key,value])=>`<h3>${label(key)}</h3><p>${escape(value)}</p>`).join('') + '<h2>Evidence table</h2>' + table + '<h2>Evidence assessments</h2>' + report.extractions.map(x=>`<p><strong>${escape(x.id)}:</strong> ${escape(x.target_kind)} · ${escape(x.finding_direction)} · Study quality: ${escape(x.study_quality)} · Locator: ${escape(x.locator)}</p>`).join('') + '<h2>Sources and screening decisions</h2>' + report.sources.map(source=>`<section>${Object.entries(source).map(([key,value])=>`<p><strong>${label(key)}:</strong> ${escape(value)}</p>`).join('')}</section>`).join('') + '<h2>Claim provenance</h2>' + report.claims.map(x=>`<p>${escape(x.text)} — ${escape(x.basis)} / ${escape(x.extraction_id ?? 'attributed account or inference')} / ${escape(x.target_kind)}</p>`).join('') + `<h2>Revision note</h2><p>${escape(report.change_summary)}</p></article>`;
 return { brief, technical };
}
function document(html, control = {}) {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sanko private evidence report</title><style>body{font:17px/1.6 Georgia,serif;color:#17134f;max-width:1100px;margin:40px auto;padding:0 24px}p{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;font:13px/1.5 Arial,sans-serif;display:block;overflow:auto}td,th{padding:10px;border:1px solid #ccc;min-width:110px;text-align:left}h1{line-height:1.1}aside{border:2px solid #17134f;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{table{display:table;font-size:8px}td,th{min-width:0;padding:3px}body{margin:0;padding:0}}</style></head><body><aside>${Object.entries(control).map(([key,value])=>`<p><strong>${label(key)}:</strong> ${escape(typeof value==='object'?JSON.stringify(value,null,2):value)}</p>`).join('')}</aside>${html}</body></html>`;
}
module.exports = { SECTIONS, BRIEF, ENUMS, validateReport, render, document, escape, hash };

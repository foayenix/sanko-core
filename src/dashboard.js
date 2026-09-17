// Public, aggregate-only evidence page for funders and institutional partners.
// No practitioner identities, phone numbers, source-message contents or patient records are
// queried or rendered here.

const express = require('express');
const log = require('./utils/log');
const path = require('path');
const plants = require('../data/plant_lookup_v1.json');
const { dashboardGetStats } = require('./services/supabase');

const router = express.Router();
const mappingCount = plants.length;
const speciesCount = new Set(plants.map(plant => plant.botanical).filter(Boolean)).size;

router.use('/assets', express.static(path.join(__dirname, '..', 'sanko-landing page', 'public', 'fonts'), {
  immutable: true,
  maxAge: '7d',
}));

router.get('/', async (_req, res) => {
  try {
    const stats = await dashboardGetStats();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.send(_renderPage({ ...stats, mappingCount, speciesCount }));
  } catch (err) {
    log.error('dashboard.render_failed', { error: err.message });
    res.status(500).send('<main><h1>Evidence page temporarily unavailable</h1><p>The aggregate snapshot could not be loaded. Please try again shortly.</p></main>');
  }
});

function _renderPage({ practitioners = 0, formulations = 0, byDay = [], updated_at, mappingCount: mappings = mappingCount, speciesCount: species = speciesCount, preview = false }) {
  const updated = new Date(updated_at || Date.now());
  const updatedLabel = updated.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
  const updatedIso = updated.toISOString();
  const last30Total = byDay.reduce((sum, bucket) => sum + bucket.count, 0);
  const last7Total = byDay.slice(-7).reduce((sum, bucket) => sum + bucket.count, 0);
  const activeDays = byDay.filter(bucket => bucket.count > 0).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="index,follow">
  <meta name="description" content="Live, aggregate-only evidence of Sanko's practitioner adoption, formulation documentation and medicinal-plant name index.">
  <title>Sanko — Live evidence</title>
  <style>${_styles()}</style>
</head>
<body>
<!--
THESIS: Sanko earns institutional confidence through inspectable evidence, not promotional claims or a generic KPI wall.
OWN-WORLD: Signal-indigo fields, mineral evidence sheets, chartreuse live quantities, square registry rules and mono provenance labels.
STORY: A funder sees adoption, documentation activity, plant-index depth, the method behind each number, and the limits of what Sanko claims.
FIRST VIEWPORT: A declarative thesis and live aggregate ledger share the indigo field; the latest activity record begins immediately below.
FORM: Public proof register; grounded structure 6; seed 596843f8.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->
<a class="skip-link" href="#evidence">Skip to evidence</a>
<header class="site-header">
  <a class="brand" href="/dashboard" aria-label="Sanko live evidence"><span class="source-mark" aria-hidden="true"><i></i></span><strong>SANKO</strong></a>
  <nav aria-label="Page navigation"><a href="#evidence">Evidence</a><a href="#method">Method</a><a href="#governance">Governance</a></nav>
  <span class="live-state"><i></i>Aggregate snapshot</span>
  <details class="mobile-nav"><summary>Sections</summary><nav aria-label="Mobile page navigation"><a href="#evidence">Evidence</a><a href="#method">Method</a><a href="#governance">Governance</a></nav></details>
</header>

<main>
  ${preview ? '<div class="preview-note"><strong>Synthetic preview</strong><span>These figures demonstrate the layout and are not live Sanko metrics.</span></div>' : ''}
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-thesis">
      <h1 id="hero-title">Living knowledge.<br>Structured evidence.</h1>
      <p>Sanko helps traditional-medicine practitioners turn WhatsApp voice notes, text and photographs into private, structured records—without requiring a new app or transferring ownership of their knowledge.</p>
      <div class="hero-actions"><a class="button primary" href="#evidence">Inspect the evidence ${_icon('arrow')}</a><a class="button secondary" href="https://github.com/foayenix/sanko-mvpp">Review implementation</a></div>
    </div>
    <div class="headline-register" aria-label="Current aggregate evidence">
      <div class="register-head"><span>Live aggregate register</span><time datetime="${_esc(updatedIso)}">Updated ${_esc(updatedLabel)} UTC</time></div>
      <div class="headline-measure"><strong>${_number(practitioners)}</strong><div><span>Practitioners onboarded</span><small>Distinct practitioner accounts in the private datastore.</small></div></div>
      <div class="headline-measure signal"><strong>${_number(formulations)}</strong><div><span>Formulations documented</span><small>Active structured formulation records retained in practitioner-scoped vaults.</small></div></div>
      <p class="privacy-line">${_icon('lock')} This public page receives aggregate counts only.</p>
    </div>
  </section>

  <section id="evidence" class="evidence-section" aria-labelledby="evidence-title">
    <div class="section-intro"><h2 id="evidence-title">Evidence of use, not a forecast.</h2><p>Each figure is generated from Sanko’s current datastore or versioned plant dictionary. Zero is shown as zero; unavailable data is not estimated.</p></div>
    <div class="evidence-ledger">
      ${_measure('30-day documentation', last30Total, 'New formulation records saved during the rolling 30-day window.', 'database')}
      ${_measure('Last 7 days', last7Total, 'A near-term view of documentation activity, included within the 30-day total.', 'database')}
      ${_measure('Active days · 30d', activeDays, 'Calendar days with at least one new formulation record.', 'derived')}
      ${_measure('Plant-name mappings', mappings, 'Local-name entries in the versioned Sanko plant dictionary.', 'repository')}
      ${_measure('Distinct named species', species, 'Distinct non-empty botanical groupings currently represented.', 'derived')}
    </div>

    <div class="activity-record">
      <div class="activity-copy"><h3>Documentation activity</h3><p>${_number(last30Total)} new formulation record${last30Total === 1 ? '' : 's'} in the last 30 days. This records documentation activity—not treatment efficacy, patient outcomes or clinical validation.</p><dl><div><dt>Window</dt><dd>Rolling 30 calendar days</dd></div><div><dt>Unit</dt><dd>New active formulation record</dd></div><div><dt>Refresh</dt><dd>On page request</dd></div></dl></div>
      <div class="activity-chart"><div class="chart-head"><span>Daily records</span><strong>${_number(last30Total)}</strong></div>${_renderSparkline(byDay)}</div>
    </div>
  </section>

  <section id="method" class="method-section" aria-labelledby="method-title">
    <div class="method-statement"><h2 id="method-title">What sits behind the numbers.</h2><p>Public evidence is deliberately narrow. Sanko can demonstrate adoption and documentation infrastructure without exposing the knowledge that practitioners have entrusted to it.</p></div>
    <ol class="method-list">
      <li><span>Source</span><h3>Private operational data</h3><p>Practitioner and formulation totals come from count-only database queries. The page never requests names, phone numbers, source-message contents, formulations or patient records.</p></li>
      <li><span>Index</span><h3>Versioned plant dictionary</h3><p>Mapping depth is counted directly from <code>data/plant_lookup_v1.json</code>. Botanical grouping is a maintained reference state, not automatic verification presented as fact.</p></li>
      <li><span>Freshness</span><h3>Timestamped on every load</h3><p>The update time is generated with each successful aggregate query. If the query fails, the page returns an unavailable state rather than stale invented figures.</p></li>
    </ol>
  </section>

  <section id="governance" class="governance-section" aria-labelledby="governance-title">
    <div class="governance-title"><h2 id="governance-title">The evidence boundary is part of the product.</h2><p>Sanko is built to document knowledge while keeping ownership, provenance and limitations visible.</p></div>
    <div class="claim-grid">
      <div><span class="claim-mark yes">${_icon('check')}</span><h3>This page does show</h3><ul><li>Aggregate practitioner adoption</li><li>Aggregate formulation documentation</li><li>Recent documentation activity</li><li>Current plant-index depth</li><li>Data source and refresh method</li></ul></div>
      <div><span class="claim-mark no">${_icon('minus')}</span><h3>This page does not claim</h3><ul><li>Medicinal or dosage recommendations</li><li>Clinical efficacy or patient outcomes</li><li>Botanical certainty where unconfirmed</li><li>Regulatory approval or certification</li><li>Ownership of practitioner knowledge</li></ul></div>
    </div>
  </section>

  <section class="closing" aria-labelledby="closing-title">
    <h2 id="closing-title">Infrastructure worth examining closely.</h2>
    <p>The public numbers are intentionally modest in scope. The implementation, privacy posture and knowledge-governance model are available for institutional review.</p>
    <a class="button primary" href="https://github.com/foayenix/sanko-mvpp">Review the Sanko repository ${_icon('arrow')}</a>
  </section>
</main>

<footer><div class="footer-brand"><span class="source-mark" aria-hidden="true"><i></i></span><strong>SANKO</strong></div><p>Private documentation infrastructure for living traditional-medicine knowledge.</p><div><span>Last updated <time datetime="${_esc(updatedIso)}">${_esc(updatedLabel)} UTC</time></span><a href="https://github.com/foayenix/sanko-mvpp">Source</a></div></footer>
</body>
</html>`;
}

function _renderSparkline(byDay) {
  if (!byDay.length) return '<div class="chart-empty"><strong>No data yet</strong><span>Activity will appear after the first formulation is recorded.</span></div>';
  const max = Math.max(1, ...byDay.map(bucket => bucket.count));
  const bars = byDay.map(bucket => {
    const pct = Math.round((bucket.count / max) * 100);
    return `<div class="bar${bucket.count > 0 ? ' has' : ''}" style="height:${pct}%" title="${_esc(bucket.day)}: ${bucket.count}" aria-label="${_esc(bucket.day)}: ${bucket.count} records"><i></i></div>`;
  }).join('');
  const first = byDay[0]?.day ?? '';
  const last = byDay[byDay.length - 1]?.day ?? '';
  const rows = byDay.map(bucket => `<tr><th scope="row">${_esc(bucket.day)}</th><td>${_number(bucket.count)}</td></tr>`).join('');
  return `<div class="spark" role="img" aria-label="Daily formulation records for the last 30 days">${bars}</div><div class="bar-axis"><span>${_shortDate(first)}</span><span>${_shortDate(last)}</span></div><details class="daily-values"><summary>View daily values</summary><div class="daily-table-wrap"><table><caption>Daily formulation records</caption><thead><tr><th scope="col">Date</th><th scope="col">Records</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function _measure(label, value, description, source) {
  const sourceLabels = { database: 'Database count', repository: 'Repository count', derived: 'Derived aggregate' };
  return `<article class="evidence-measure"><div><span>${_esc(label)}</span><em>${_esc(sourceLabels[source] || source)}</em></div><strong>${_number(value)}</strong><p>${_esc(description)}</p></article>`;
}

function _shortDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function _number(value) {
  return Number(value || 0).toLocaleString('en-GB');
}

function _esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _icon(name) {
  const paths = {
    arrow: '<path d="M4 12h15M14 7l5 5-5 5"/>',
    lock: '<rect x="5" y="10" width="14" height="11"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    minus: '<path d="M5 12h14"/>',
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter">${paths[name] || paths.arrow}</svg>`;
}

function _styles() {
  return `
    @font-face{font-family:Archivo;src:url('/dashboard/assets/archivo-variable.woff2') format('woff2');font-weight:100 900;font-display:swap}
    @font-face{font-family:Plex;src:url('/dashboard/assets/ibm-plex-mono-regular.woff2') format('woff2');font-weight:400;font-display:swap}
    @font-face{font-family:Plex;src:url('/dashboard/assets/ibm-plex-mono-semibold.woff2') format('woff2');font-weight:600;font-display:swap}
    :root{--indigo:#17134f;--deep:#0b0930;--mineral:#f5f2e8;--paper:#fffdf6;--signal:#c8f35b;--copper:#d76545;--copper-ink:#9f3e29;--ink:#090a23;--muted:#565369;--line:#d4d0c5;--indigo-line:#3a3671;--light-on-dark:#c9c6d5;--max:1480px}
    *{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--deep)}body{margin:0;background:var(--mineral);color:var(--ink);font-family:Archivo,Arial,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}a{color:inherit}::selection{background:var(--signal);color:var(--indigo)}:focus-visible{outline:2px solid var(--copper);outline-offset:4px}.skip-link{position:fixed;left:10px;top:8px;z-index:100;background:var(--signal);color:var(--indigo);padding:10px 14px;transform:translateY(-160%)}.skip-link:focus{transform:none}.site-header{height:76px;background:var(--indigo);color:var(--mineral);border-bottom:1px solid var(--indigo-line);display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 max(24px,calc((100vw - var(--max))/2));gap:28px;position:sticky;top:0;z-index:20}.brand,.footer-brand{display:flex;align-items:center;gap:11px;text-decoration:none;letter-spacing:.12em}.source-mark{width:28px;height:28px;background:var(--mineral);display:block;position:relative;clip-path:polygon(0 0,75% 0,100% 25%,100% 67%,72% 67%,72% 100%,0 100%)}.source-mark i{position:absolute;width:7px;height:7px;background:var(--indigo);left:7px;top:7px}.site-header nav{display:flex;align-items:center;gap:26px}.site-header nav a{font-size:13px;text-decoration:none;color:var(--light-on-dark)}.site-header nav a:hover{color:var(--signal)}.live-state{justify-self:end;display:flex;align-items:center;gap:8px;color:var(--light-on-dark);font:10px Plex,monospace;text-transform:uppercase;letter-spacing:.06em}.live-state i{width:7px;height:7px;background:var(--signal)}.mobile-nav{display:none;position:relative}.preview-note{max-width:var(--max);margin:18px auto 0;border:1px solid var(--copper);padding:10px 14px;display:flex;gap:12px;background:#f4e6ce;color:var(--copper-ink)}.preview-note span{color:var(--ink)}
    .hero{min-height:660px;background:var(--indigo);color:var(--mineral);display:grid;grid-template-columns:minmax(0,1.08fr) minmax(420px,.92fr);gap:clamp(40px,7vw,112px);align-items:center;padding:clamp(70px,8vw,120px) max(24px,calc((100vw - var(--max))/2))}.hero-thesis h1{font-size:clamp(56px,6vw,92px);line-height:.94;letter-spacing:-.04em;margin:0 0 34px;font-weight:830;max-width:850px}.hero-thesis>p{font-size:clamp(17px,1.35vw,21px);line-height:1.55;color:var(--light-on-dark);max-width:65ch;margin:0}.hero-actions{display:flex;gap:10px;margin-top:34px}.button{min-height:50px;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:12px 22px;border:1px solid currentColor;text-decoration:none;font-weight:750;transition:transform 170ms ease-out,background 170ms ease-out}.button svg{width:17px}.button:hover{transform:translateY(-2px)}.button:active{transform:none}.button.primary{background:var(--signal);color:var(--indigo);border-color:var(--signal)}.button.secondary{color:var(--mineral);background:transparent}.headline-register{border:1px solid var(--signal);align-self:stretch;display:flex;flex-direction:column;justify-content:center;position:relative}.register-head{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--indigo-line);font:10px Plex,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--light-on-dark)}.headline-measure{display:grid;grid-template-columns:minmax(110px,.55fr) 1fr;gap:22px;align-items:center;padding:34px 26px;border-bottom:1px solid var(--indigo-line)}.headline-measure:first-of-type{margin-top:42px}.headline-measure strong{font:600 clamp(56px,6vw,96px)/.9 Plex,monospace;color:var(--mineral);letter-spacing:-.04em}.headline-measure.signal strong{color:var(--signal)}.headline-measure span{display:block;font-size:18px;font-weight:750}.headline-measure small{display:block;color:var(--light-on-dark);margin-top:6px;line-height:1.45}.privacy-line{margin:0;padding:15px 20px;display:flex;align-items:center;gap:8px;color:var(--light-on-dark);font-size:12px}.privacy-line svg{width:16px;color:var(--signal)}
    .evidence-section{max-width:var(--max);margin:0 auto;padding:110px 24px 120px}.section-intro{display:grid;grid-template-columns:1fr 1fr;gap:70px;align-items:end;margin-bottom:56px}.section-intro h2,.method-statement h2,.governance-title h2,.closing h2{font-size:clamp(40px,5vw,72px);line-height:1;letter-spacing:-.04em;margin:0;font-weight:820}.section-intro p,.method-statement p,.governance-title p{font-size:18px;color:var(--muted);max-width:64ch;margin:0}.evidence-ledger{border-top:1px solid var(--ink)}.evidence-measure{display:grid;grid-template-columns:240px 190px minmax(0,1fr);gap:30px;align-items:center;border-bottom:1px solid var(--ink);padding:20px 0}.evidence-measure>div span,.evidence-measure>div em{display:block}.evidence-measure>div span{font-weight:750}.evidence-measure>div em{font:9px Plex,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--copper-ink);font-style:normal;margin-top:5px}.evidence-measure>strong{font:600 42px/1 Plex,monospace;color:var(--indigo)}.evidence-measure>p{margin:0;color:var(--muted);max-width:72ch}.activity-record{margin-top:74px;display:grid;grid-template-columns:.78fr 1.22fr;border:1px solid var(--ink);background:var(--paper)}.activity-copy{padding:34px;border-right:1px solid var(--ink)}.activity-copy h3{font-size:28px;margin:0 0 10px}.activity-copy>p{color:var(--muted);margin:0;max-width:54ch}.activity-copy dl{margin:28px 0 0}.activity-copy dl div{display:flex;justify-content:space-between;gap:20px;border-top:1px solid var(--line);padding:9px 0}.activity-copy dt{font:9px Plex,monospace;text-transform:uppercase;color:var(--muted)}.activity-copy dd{margin:0;font-size:12px;font-weight:650;text-align:right}.activity-chart{padding:30px 34px 24px;min-width:0}.chart-head{display:flex;justify-content:space-between;align-items:baseline}.chart-head span{font:10px Plex,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.chart-head strong{font:600 28px Plex,monospace;color:var(--indigo)}.spark{height:230px;display:flex;align-items:flex-end;gap:5px;border-bottom:1px solid var(--ink);padding-top:24px}.bar{height:0;min-height:2px;flex:1;background:#dad6ca;position:relative;transition:background 160ms ease-out}.bar.has{background:var(--indigo)}.bar.has:hover{background:var(--copper)}.bar i{position:absolute;inset:0}.bar-axis{display:flex;justify-content:space-between;color:var(--muted);font:9px Plex,monospace;text-transform:uppercase;padding-top:8px}.daily-values{margin-top:15px;border-top:1px solid var(--line);padding-top:11px}.daily-values summary{cursor:pointer;font:10px Plex,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--copper-ink);width:max-content}.daily-table-wrap{max-height:250px;overflow:auto;margin-top:12px;border:1px solid var(--line)}.daily-values table{width:100%;border-collapse:collapse;font-size:12px}.daily-values caption{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.daily-values th,.daily-values td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}.daily-values thead th{position:sticky;top:0;background:var(--paper);font:9px Plex,monospace;text-transform:uppercase}.daily-values td{text-align:right;font:12px Plex,monospace}.chart-empty{height:230px;border-bottom:1px solid var(--ink);display:grid;place-content:center;text-align:center}.chart-empty strong,.chart-empty span{display:block}.chart-empty span{color:var(--muted);margin-top:5px}
    .method-section{background:var(--paper);border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);padding:110px max(24px,calc((100vw - var(--max))/2))}.method-statement{display:grid;grid-template-columns:1fr 1fr;gap:70px;align-items:end;margin-bottom:70px}.method-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--ink)}.method-list li{display:grid;grid-template-columns:100px 270px minmax(0,1fr);gap:30px;padding:24px 0;border-bottom:1px solid var(--ink)}.method-list li>span{font:10px Plex,monospace;text-transform:uppercase;color:var(--copper-ink)}.method-list h3{margin:0;font-size:20px}.method-list p{margin:0;color:var(--muted);max-width:75ch}.method-list code{font:11px Plex,monospace;background:var(--mineral);padding:2px 4px}
    .governance-section{background:var(--indigo);color:var(--mineral);padding:110px max(24px,calc((100vw - var(--max))/2))}.governance-title{display:grid;grid-template-columns:1fr 1fr;gap:70px;align-items:end;margin-bottom:70px}.governance-title p{color:var(--light-on-dark)}.claim-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--indigo-line)}.claim-grid>div{padding:32px}.claim-grid>div+div{border-left:1px solid var(--indigo-line)}.claim-mark{width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--indigo-line)}.claim-mark svg{width:19px}.claim-mark.yes{background:var(--signal);color:var(--indigo);border-color:var(--signal)}.claim-mark.no{color:var(--copper)}.claim-grid h3{font-size:24px;margin:18px 0}.claim-grid ul{list-style:none;margin:0;padding:0}.claim-grid li{border-top:1px solid var(--indigo-line);padding:10px 0;color:var(--light-on-dark)}.claim-grid li::before{content:'—';color:var(--signal);margin-right:9px}.claim-grid>div+div li::before{color:var(--copper)}
    .closing{background:var(--signal);color:var(--indigo);padding:100px max(24px,calc((100vw - var(--max))/2));display:grid;grid-template-columns:1fr .8fr;gap:60px;align-items:end}.closing p{font-size:20px;max-width:58ch;margin:0}.closing .button{grid-column:2;justify-self:start;background:var(--indigo);color:var(--mineral);border-color:var(--indigo)}footer{background:var(--deep);color:var(--mineral);padding:50px max(24px,calc((100vw - var(--max))/2));display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:30px;align-items:center}footer p{color:var(--light-on-dark);margin:0}footer>div:last-child{text-align:right;display:grid;gap:6px;color:var(--light-on-dark);font:10px Plex,monospace}footer a{color:var(--signal);text-underline-offset:4px}
    @media(max-width:1050px){.hero{grid-template-columns:1fr;min-height:0}.headline-register{min-height:480px}.section-intro,.method-statement,.governance-title{grid-template-columns:1fr;gap:24px}.activity-record{grid-template-columns:1fr}.activity-copy{border-right:0;border-bottom:1px solid var(--ink)}.method-list li{grid-template-columns:80px 220px 1fr}.closing{grid-template-columns:1fr}.closing .button{grid-column:1}footer{grid-template-columns:1fr 1fr}footer p{display:none}}
    @media(max-width:720px){.site-header{height:66px;padding:0 18px;grid-template-columns:1fr auto}.site-header>nav,.live-state{display:none}.mobile-nav{display:block}.mobile-nav summary{cursor:pointer;list-style:none;border:1px solid var(--indigo-line);padding:8px 10px;font:10px Plex,monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--mineral)}.mobile-nav summary::-webkit-details-marker{display:none}.mobile-nav[open] summary{background:var(--signal);border-color:var(--signal);color:var(--indigo)}.mobile-nav nav{position:absolute;right:0;top:calc(100% + 10px);width:190px;display:grid;background:var(--indigo);border:1px solid var(--signal);box-shadow:0 14px 30px rgba(11,9,48,.24)}.mobile-nav nav a{padding:13px 15px;border-bottom:1px solid var(--indigo-line);font-size:13px}.mobile-nav nav a:last-child{border-bottom:0}.hero{padding:72px 18px;gap:46px}.hero-thesis h1{font-size:clamp(48px,15vw,68px);margin-bottom:24px}.hero-actions{flex-direction:column}.button{width:100%}.headline-register{min-height:0}.register-head{position:static;display:grid}.headline-measure:first-of-type{margin-top:0}.headline-measure{grid-template-columns:1fr;padding:25px 20px;gap:10px}.headline-measure strong{font-size:64px}.evidence-section,.method-section,.governance-section{padding:78px 18px}.section-intro h2,.method-statement h2,.governance-title h2,.closing h2{font-size:42px}.section-intro p,.method-statement p,.governance-title p{font-size:16px}.evidence-measure{grid-template-columns:1fr auto;gap:10px 20px}.evidence-measure>strong{grid-column:2;grid-row:1}.evidence-measure>p{grid-column:1/-1}.activity-record{margin-top:50px}.activity-copy,.activity-chart{padding:24px 20px}.spark{height:180px;gap:3px}.method-list li{grid-template-columns:1fr;gap:7px}.claim-grid{grid-template-columns:1fr}.claim-grid>div+div{border-left:0;border-top:1px solid var(--indigo-line)}.closing{padding:72px 18px;gap:24px}.closing p{font-size:17px}footer{padding:42px 18px;grid-template-columns:1fr;text-align:left}footer>div:last-child{text-align:left}.preview-note{margin:12px 18px 0;display:grid;gap:2px}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.button,.bar{transition:none}}
  `;
}

module.exports = router;
module.exports._renderPage = _renderPage;
module.exports._renderSparkline = _renderSparkline;

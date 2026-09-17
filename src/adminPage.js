const fs = require('fs');
const path = require('path');
const plants = require('../data/plant_lookup_v1.json');

const LANDING_COUNT_PATH = path.join(__dirname, '..', 'sanko-landing page', 'public', 'landing', 'plant-count.js');

function renderAdminPage({ counts, practitioners, formulations, flagged, usage, corrections, quality, transcripts = [], evaluation = null, backup = null, governance = null, operator = null, runtime }) {
  const now = new Date();
  const queue = _reviewQueue(flagged);
  const recent = _recentActivity(formulations, flagged.events);
  const unknownCount = flagged.events.filter(event => event.event_type === 'unknown_plant_flagged').length;
  const failureCount = flagged.events.filter(event => event.event_type === 'error').length;
  const speciesCount = new Set(plants.map(plant => plant.botanical).filter(Boolean)).size;
  const landingCount = _landingCount();
  // The landing page publishes resolved mappings only — sync-plant-count.mjs counts
  // rows with a botanical. Comparing against plants.length instead would count the
  // unresolved names too and report "needs refresh" even straight after a sync.
  const resolvedCount = plants.filter(plant => plant.botanical).length;
  const landingSynced = landingCount === resolvedCount;
  const proxyRate = (numerator, denominator) => denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>Sanko Control Room</title>
  <style>${_styles()}</style>
</head>
<body>
<!--
THESIS: Attention is the primary unit; this control room refuses the metric-wall dashboard.
OWN-WORLD: Signal-indigo shell, mineral-white ledger surfaces, chartreuse actions, square registry controls, and one-pixel evidence rules.
STORY: The owner sees what needs review, inspects provenance, proposes a revision, confirms a diff, and leaves an attributable history.
FIRST VIEWPORT: Fixed left navigation, a broad review ledger in the centre, and a narrow service-status rail on the right; the review action is primary.
FORM: Attention ledger with inline evidence workbench; grounded structure 6; seed 6dda9e89.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->
<a class="skip-link" href="#main">Skip to main content</a>
<div class="app-shell">
  <aside class="sidebar" aria-label="Control room navigation">
    <div class="brand">
      <span class="source-mark" aria-hidden="true"><i></i></span>
      <span>SANKO</span>
    </div>
    <div class="private-label">Private control room</div>
    <nav class="nav-list">
      ${_navButton('today', 'Today', 'home', true, queue.length)}
      ${_navButton('review', 'Review', 'inbox', false, queue.length)}
      ${_navButton('plants', 'Plants', 'leaf')}
      ${_navButton('practitioners', 'Practitioners', 'people')}
      ${_navButton('vault', 'Vault', 'archive')}
      ${_navButton('transcripts', 'Readings', 'message', false, transcripts.filter(item => !item.reviewed_at).length)}
      ${_navButton('quality', 'Quality', 'quality')}
      ${_navButton('system', 'System', 'pulse', false, failureCount)}
      ${_navButton('security', 'Security', 'shield')}
    </nav>
    <div class="sidebar-foot">
      <div class="admin-avatar" aria-hidden="true">FA</div>
      <div><strong>${_esc(operator?.username || 'Felix')}</strong><span>${operator ? `${_esc(operator.ref)}${operator.legacy ? ' · shared password' : ''}` : 'Allowlisted owner'}</span></div>
      <button class="icon-button" type="button" aria-label="Account options">${_icon('more')}</button>
    </div>
  </aside>

  <div class="workspace">
    <header class="topbar">
      <button class="menu-button" type="button" aria-label="Open navigation" aria-expanded="false">${_icon('menu')}</button>
      <label class="global-search">
        ${_icon('search')}
        <span class="sr-only">Search control room</span>
        <input type="search" placeholder="Search records, people or plants" data-global-search>
        <kbd>⌘ K</kbd>
      </label>
      <div class="topbar-state"><span class="status-dot"></span> Status snapshot loaded</div>
      <button class="icon-button notification-button" type="button" aria-label="Notifications">${_icon('bell')}<span>${queue.length}</span></button>
    </header>

    <main id="main" class="main">
      ${runtime.preview ? `<div class="preview-banner">${_icon('info')}<strong>Synthetic preview data</strong><span>This local fixture does not contain live practitioner records.</span></div>` : ''}
      ${_todayView({ now, counts, queue, recent, runtime, usage, backup, mappingCount: plants.length, speciesCount, failureCount })}
      ${_reviewView(queue, operator)}
      ${_plantsView({ speciesCount, landingSynced })}
      ${_practitionersView(practitioners)}
      ${_vaultView({ counts, formulations })}
      ${_transcriptView(transcripts, operator)}
      ${_qualityView({ unknownCount, counts, corrections, quality, evaluation, runtime, proxyRate })}
      ${_systemView({ runtime, usage, failureCount, landingSynced, mappingCount: plants.length })}
      ${_securityView(runtime, governance, operator)}
    </main>
  </div>
</div>
<div class="toast" role="status" aria-live="polite"></div>
<script>${_script()}</script>
</body>
</html>`;
}

function _todayView({ now, counts, queue, recent, runtime, usage, backup, mappingCount, speciesCount, failureCount }) {
  const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
  return `<section class="view is-active" data-view="today" aria-labelledby="today-title">
    <div class="page-heading">
      <div><h1 id="today-title">Today</h1><p>${_esc(date)} · Work requiring your attention</p></div>
      <button class="button secondary" type="button" data-refresh>${_icon('refresh')} Refresh</button>
    </div>

    <div class="today-grid">
      <div class="attention-column">
        <div class="attention-header">
          <div><h2>Needs review</h2><p>One queue across knowledge quality and delivery failures.</p></div>
          <span class="count-block">${queue.length}<small>open</small></span>
        </div>
        <div class="queue-list compact">
          ${queue.length ? queue.slice(0, 6).map(_queueRow).join('') : _emptyQueue()}
        </div>
        <button class="text-action" type="button" data-open-view="review">Open full review inbox ${_icon('arrow')}</button>

        <div class="activity-section">
          <div class="section-line"><h2>Recent activity</h2><span>Latest recorded events</span></div>
          <ol class="activity-list">
            ${recent.length ? recent.slice(0, 5).map(item => `<li><span class="activity-mark ${item.tone}">${_icon(item.icon)}</span><div><strong>${_esc(item.title)}</strong><p>${_esc(item.detail)}</p></div><time>${_relative(item.date)}</time></li>`).join('') : '<li class="empty-row">No recent activity has been recorded.</li>'}
          </ol>
        </div>
      </div>

      <aside class="operations-rail" aria-label="System overview and quick actions">
        <div class="rail-section">
          <div class="section-line"><h2>Service health</h2><button type="button" data-open-view="system">Details</button></div>
          <ul class="health-list">
            ${_healthRow('Database', 'Query succeeded', 'good')}
            ${_healthRow('WhatsApp', runtime.configured.whatsapp ? 'Configured' : 'Needs setup', runtime.configured.whatsapp ? 'good' : 'warn')}
            ${_healthRow('Transcription', `${runtime.whisperBackend} · config only`, 'neutral')}
            ${_healthRow('Language model', `${runtime.llmProvider} · config only`, 'neutral')}
            ${_healthRow('Message failures', String(failureCount), failureCount ? 'bad' : 'good')}
          </ul>
        </div>
        ${_backupBlock(backup)}
        <div class="rail-section quick-actions">
          <h2>Quick actions</h2>
          <button type="button" data-open-view="plants" data-focus="plant-name">${_icon('plus')} Add a plant name</button>
          <button type="button" data-open-view="plants" data-focus="plant-import">${_icon('upload')} Import mappings</button>
          <a href="/simulator">${_icon('message')} Open simulator</a>
        </div>
      </aside>
    </div>

    <div class="metric-ledger" aria-label="Secondary statistics">
      ${_metric('Practitioners', counts.practitioners, _registeredNote(counts))}
      ${_metric('Formulations', counts.formulations, `${counts.patients} Patients · ${counts.treatments} Treatments logged`)}
      ${_metric('Plant mappings', mappingCount, `${speciesCount} distinct named species`)}
      ${_metric('API estimate · 30d', `$${usage.last30.estimatedUSD}`, `${usage.last30.localCalls || 0} local model calls`)}
    </div>
  </section>`;
}

function _reviewView(queue, operator) {
  return `<section class="view" data-view="review" aria-labelledby="review-title">
    <div class="page-heading">
      <div><h1 id="review-title">Review inbox</h1><p>Original evidence remains available through every correction.</p></div>
      <button class="button secondary" type="button" data-filter-toggle>${_icon('filter')} Filter queue</button>
    </div>
    <div class="filter-bar" hidden>
      <button class="filter-chip is-active" type="button" data-queue-filter="all" aria-pressed="true">All <span>${queue.length}</span></button>
      <button class="filter-chip" type="button" data-queue-filter="plant" aria-pressed="false">Plants</button>
      <button class="filter-chip" type="button" data-queue-filter="transcription" aria-pressed="false">Transcriptions</button>
      <button class="filter-chip" type="button" data-queue-filter="failure" aria-pressed="false">Failures</button>
    </div>
    <div class="review-workbench">
      <div class="review-index">
        <div class="index-head"><strong>${queue.length} open items</strong><span>Oldest first</span></div>
        <div class="queue-list">
          ${queue.length ? queue.map(_queueRow).join('') : _emptyQueue()}
        </div>
      </div>
      <div class="review-detail" data-review-detail>
        ${queue.length ? _reviewDetail(queue[0], operator) : `<div class="detail-empty">${_icon('check')}<h2>Review queue clear</h2><p>New plant ambiguities, low-confidence records and processing failures will appear here.</p></div>`}
      </div>
    </div>
    <div hidden data-review-templates>${queue.map(item => `<template data-review-template="${_esc(item.id)}">${_reviewDetail(item, operator)}</template>`).join('')}</div>
  </section>`;
}

// D — the reading review pass.
//
// Whatever read the primary source is the largest quality gap on this stack: a
// wrong reading makes every downstream field wrong, and the failure is silent
// because both models return fluent text at high confidence either way. Whisper
// handles Yorùbá, Igbo and Hausa badly; no vision model has seen much Nigerian
// traditional-medicine handwriting at all. Fixing them here does two jobs at
// once — it repairs the record, and it accumulates the paired sets those two
// fine-tunes need, which cannot be bought.
function _transcriptView(transcripts, operator) {
  const pending = transcripts.filter(item => !item.reviewed_at);
  const pages = transcripts.filter(item => item.kind === 'photo').length;
  return `<section class="view" data-view="transcripts" aria-labelledby="transcripts-title">
    <div class="page-heading">
      <div><h1 id="transcripts-title">Reading review</h1><p>Correcting what a machine read from a voice note or a notebook page repairs the record and builds the training set at the same time.</p></div>
      <span class="publish-state ${pending.length ? 'warn' : 'good'}"><span class="status-dot ${pending.length ? 'warn' : 'good'}"></span>${pending.length} awaiting review</span>
    </div>
    ${transcripts.length ? `<div class="registry-panel">
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Source</th><th>Practitioner</th><th>What the machine read</th><th>Read by</th><th>State</th><th></th></tr></thead><tbody>
        ${transcripts.map(item => `<tr data-transcript-row="${_esc(item.id)}">
          <td><strong>${item.kind === 'photo' ? 'Notebook page' : 'Voice note'}</strong><small>${_date(item.created_at)}${item.kind === 'voice' && item.duration_seconds ? ` · ${_esc(item.duration_seconds)}s` : ''}</small></td>
          <td>${_esc(item.practitioners?.display_name || 'Unattributed')}</td>
          <td class="transcript-cell">${_esc(item.transcript || (item.kind === 'photo' ? 'Nothing readable found on this photo' : 'No transcript recorded'))}</td>
          <td><small>${_esc(item.transcript_model || 'Unattributed')}</small>${_confidenceTag(item.transcript_confidence)}</td>
          <td>${item.reviewed_at ? `<span class="tag good">Reviewed</span>` : '<span class="tag warn">Machine only</span>'}</td>
          <td><button class="button secondary" type="button" data-transcript-open="${_esc(item.id)}">Review</button></td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>` : `<div class="empty-queue">${_icon('check')}<strong>Nothing recorded yet</strong><span>Voice notes and photographed pages appear here as practitioners send them.</span></div>`}

    <div class="editor-panel transcript-editor" data-transcript-editor hidden>
      <div class="section-line"><h2>Correct a reading</h2><span data-transcript-label></span></div>
      <p class="governance-foot">The original machine output is kept as the correction's before-value; nothing is lost. The practitioner's formulation is not changed by this edit — records that were built from this reading are listed after you save, for you to go and check.</p>
      <audio controls data-transcript-audio preload="none" hidden></audio>
      <div class="page-source" data-transcript-page hidden><img alt="The photographed page being reviewed" data-transcript-image></div>
      <label>Corrected reading
        <textarea rows="12" data-transcript-text></textarea>
      </label>
      <p class="governance-foot" data-transcript-guidance hidden>Type the page exactly as written — same language, same spelling, same order. Leave <code>[?]</code> where the page itself is illegible rather than filling it in from what it probably says: a guess and a reading are indistinguishable to everyone downstream.</p>
      <div class="form-pair">
        <label>Attributed to<input type="text" value="${_esc(operator?.ref || 'not signed in')}" disabled></label>
        <label>Note (optional)<input type="text" data-transcript-note placeholder="Why the machine got it wrong" autocomplete="off"></label>
      </div>
      <div class="detail-actions">
        <button class="button secondary" type="button" data-transcript-cancel>Cancel</button>
        <button class="button primary" type="button" data-transcript-save>Save correction</button>
      </div>
      <div class="proposal-preview" data-transcript-affected hidden></div>
    </div>
    ${transcripts.map(item => `<template data-transcript-data="${_esc(item.id)}">${_esc(JSON.stringify({
      id: item.id,
      kind: item.kind || 'voice',
      transcript: item.transcript || '',
      label: `${item.practitioners?.display_name || 'Unattributed'} · ${item.created_at}`,
    }))}</template>`).join('')}
  </section>`;
}

// The share of the page the model claims to have read. Shown next to the model
// that read it because the two are only meaningful together: 60% from a model
// nobody has evaluated on this handwriting is not the same claim as 60% from one
// that has been.
function _confidenceTag(confidence) {
  if (confidence === null || confidence === undefined) return '';
  const pct = Math.round(Number(confidence) * 100);
  const tone = pct >= 75 ? 'good' : 'warn';
  return `<span class="tag ${tone}">${pct}% read</span>`;
}

// A backup that has never been restored is a hypothesis. The block says which
// of the two this is, because the difference only matters on the day it matters.
function _backupBlock(backup) {
  if (!backup) {
    return `<div class="backup-block">${_icon('database')}
      <div><span>Last successful backup</span><strong>None</strong><small>Run npm run backup — the archive is stated to be unreconstructable, and nothing is holding a copy of it.</small></div>
    </div>`;
  }
  const stale = backup.age_hours > 48;
  const tone = !backup.verified_at || stale ? 'backup-block' : 'backup-block is-good';
  const detail = backup.verified_at
    ? `Restored and row-checked ${_date(backup.verified_at)}. ${backup.count} kept.`
    : 'Never restored. A backup nobody has restored is a hypothesis — run npm run backup:verify.';
  return `<div class="${tone}">${_icon('database')}
    <div><span>Last successful backup</span><strong>${_relative(backup.created_at)} · ${_esc(backup.rows)} rows</strong><small>${_esc(detail)}</small></div>
  </div>`;
}

function _plantsView({ speciesCount, landingSynced }) {
  const rows = plants.slice().sort((a, b) => a.local_name.localeCompare(b.local_name));
  return `<section class="view" data-view="plants" aria-labelledby="plants-title">
    <div class="page-heading">
      <div><h1 id="plants-title">Plant dictionary</h1><p>Names remain distinct from botanical identity until evidence confirms the relationship.</p></div>
      <span class="publish-state ${landingSynced ? 'good' : 'warn'}"><span class="status-dot ${landingSynced ? 'good' : 'warn'}"></span>${landingSynced ? 'Published index in sync' : 'Landing count needs refresh'}</span>
    </div>
    <div class="dictionary-summary">
      <div><strong>${plants.length}</strong><span>Local-name mappings</span></div>
      <div><strong>${speciesCount}</strong><span>Distinct named species</span></div>
      <div><strong>v1</strong><span>Published index</span></div>
      <p>These counts stay separate: several local names may refer to one species, and identities can remain unconfirmed.</p>
    </div>
    <div class="dictionary-layout">
      <div class="registry-panel">
        <label class="table-search">${_icon('search')}<input type="search" placeholder="Search local or botanical names" data-plant-search></label>
        <div class="table-wrap"><table class="data-table plant-table"><thead><tr><th>Local name</th><th>Botanical grouping</th><th>Source detail</th><th>Status</th></tr></thead><tbody>
          ${rows.map(plant => `<tr data-plant-row data-search="${_esc(`${plant.local_name} ${plant.botanical || ''} ${plant.common_english || ''}`.toLowerCase())}"><td><strong>${_esc(plant.local_name)}</strong><small>${_esc(plant.common_english || 'No English name recorded')}</small></td><td>${_esc(plant.botanical || 'Identity unconfirmed')}</td><td><span class="muted">Language and region not recorded</span></td><td><span class="tag neutral">Imported source</span></td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <aside class="editor-panel">
        <h2>Propose one mapping</h2>
        <p>Creates a reviewable revision. It does not replace the source file.</p>
        <form data-plant-form>
          <label>Local name<input id="plant-name" name="local_name" required placeholder="e.g. dongoyaro"></label>
          <label>Botanical grouping<input name="botanical" placeholder="Leave blank if unconfirmed"></label>
          <div class="form-pair"><label>Language<select name="language"><option>Not recorded</option><option>Yoruba</option><option>Hausa</option><option>Igbo</option><option>English</option></select></label><label>Region<input name="region" placeholder="Optional"></label></div>
          <label>Source or evidence<textarea name="source" rows="3" required placeholder="Who supplied this name, or what record supports it?"></textarea></label>
          <button class="button primary" type="submit">Preview proposed mapping</button>
        </form>
        <div class="proposal-preview" data-plant-preview hidden></div>
        <div class="import-block" id="plant-import">
          <h2>Import CSV</h2><p>Validation and conflict preview comes before any publish step.</p>
          <label class="file-drop">${_icon('upload')}<strong>Choose a CSV file</strong><span>local_name, botanical, language, region, source</span><input type="file" accept=".csv,text/csv" data-csv-input></label>
          <div class="import-preview" data-import-preview hidden></div>
        </div>
      </aside>
    </div>
  </section>`;
}

function _practitionersView(practitioners) {
  return `<section class="view" data-view="practitioners" aria-labelledby="practitioners-title">
    <div class="page-heading"><div><h1 id="practitioners-title">Practitioners</h1><p>Account support without editing practitioner-owned knowledge.</p></div><span class="privacy-note">${_icon('lock')} Knowledge is read-only here</span></div>
    <div class="registry-panel">
      <label class="table-search">${_icon('search')}<input type="search" placeholder="Search name, identifier or language" data-table-search="practitioners-table"></label>
      <div class="table-wrap"><table class="data-table" id="practitioners-table"><thead><tr><th>Practitioner</th><th>Language</th><th>Consent</th><th>Last active</th><th>Knowledge records</th><th>Status</th><th></th></tr></thead><tbody>
        ${practitioners.length ? practitioners.map(person => `<tr data-search="${_esc(`${person.display_name || ''} ${person.phone_number || ''} ${person.preferred_language || ''} ${person.region || ''} ${person.tradition || ''}`.toLowerCase())}"><td><strong>${_esc(person.display_name || 'Name not supplied')}</strong><small>${_maskPhone(person.phone_number)}${person.region ? ` · ${_esc(person.region)}` : ''}</small></td><td>${_language(person.preferred_language)}</td><td>${_termsTag(person)}</td><td>${_date(person.last_active_at)}</td><td><span class="muted">Open scoped record view</span></td><td>${_registrationTag(person)}</td><td><button class="row-action" type="button" data-toast="Account controls require step-up authentication.">${_icon('more')}<span class="sr-only">Account actions</span></button></td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">No practitioners yet.</td></tr>'}
      </tbody></table></div>
    </div>
  </section>`;
}

function _vaultView({ counts, formulations }) {
  return `<section class="view" data-view="vault" aria-labelledby="vault-title">
    <div class="page-heading"><div><h1 id="vault-title">Vault records</h1><p>Inspect, flag, propose a correction, archive with reason, or restore. Never silently overwrite.</p></div><button class="button secondary" type="button" disabled title="Step-up authentication is not implemented">${_icon('download')} Scoped export</button></div>
    <div class="record-tabs" aria-label="Available vault record views">
      <span class="is-active" aria-current="page">Formulations <b>${counts.formulations}</b></span><span>Patients <b>${counts.patients}</b><small>not connected</small></span><span>Treatments <b>${counts.treatments}</b><small>not connected</small></span><span>Corrections <small>not connected</small></span><span>Archived <small>not connected</small></span>
    </div>
    <div class="registry-panel">
      <label class="table-search">${_icon('search')}<input type="search" placeholder="Search code, condition or owner" data-table-search="vault-table"></label>
      <div class="table-wrap"><table class="data-table" id="vault-table"><thead><tr><th>Record</th><th>Condition</th><th>Owner</th><th>Confidence</th><th>Recorded</th><th>Permitted actions</th></tr></thead><tbody>
        ${formulations.length ? formulations.map(record => `<tr data-search="${_esc(`${record.short_code || ''} ${record.condition_std || ''} ${record.condition_local || ''} ${record.practitioners?.display_name || ''}`.toLowerCase())}"><td><strong>${_esc(record.short_code || 'Uncoded')}</strong><small>Formulation · original retained</small></td><td>${_esc(record.condition_std || record.condition_local || 'Not standardised')}</td><td>${_esc(record.practitioners?.display_name || 'Unattributed')}</td><td>${_confidence(record.confidence_score)}</td><td>${_date(record.created_at)}</td><td><div class="inline-actions"><button type="button" data-toast="Record detail is read-only in this prototype.">View</button><button type="button" data-toast="A correction proposal will preserve the original.">Propose</button><button type="button" data-toast="Archiving requires a reason and step-up authentication.">Archive</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">No active formulations yet.</td></tr>'}
      </tbody></table></div>
    </div>
    <p class="governance-foot">No ordinary Edit or Delete action is available. Archives are reversible and every administrative action belongs in the audit history.</p>
  </section>`;
}

function _qualityView({ unknownCount, counts, corrections, quality, evaluation, runtime, proxyRate }) {
  // 010 made this measurable. Before it there was no denominator, so a rising
  // correction count could not be told apart from rising usage.
  const rate = quality?.correctionsPer100;
  const rateTone = rate == null ? 'neutral' : rate >= 25 ? 'bad' : rate >= 10 ? 'warn' : 'good';
  const attributed = quality ? `${quality.attributedSaves} of ${quality.totalSaves} saves carry a model; records saved before instrumentation do not.` : 'Model attribution is not instrumented.';
  return `<section class="view" data-view="quality" aria-labelledby="quality-title">
    <div class="page-heading"><div><h1 id="quality-title">AI quality</h1><p>Evidence that Sanko is improving safely—not a scorecard for practitioners.</p></div><button class="button primary" type="button" disabled title="Requires passing tests and step-up confirmation">Promote model</button></div>
    <div class="quality-ledger">
      ${_qualityMeasure('Unknown-plant proxy', proxyRate(unknownCount, counts.formulations), 'Unknown-plant events ÷ active formulations. Instrumentation should replace this proxy.', unknownCount ? 'warn' : 'good')}
      ${_qualityMeasure('Low-confidence rate', proxyRate(counts.flagged, counts.formulations), `${counts.flagged} active formulations below 75% confidence.`, counts.flagged ? 'warn' : 'good')}
      ${_qualityMeasure('Correction rate · 30d', rate == null ? '—' : `${rate} per 100`, attributed, rateTone)}
      ${_qualityMeasure('Correction activity · 30d', corrections.total, 'Attributed practitioner and admin corrections recorded.', 'neutral')}
      ${_qualityMeasure(
        'Regression tests',
        evaluation?.summary ? `${(evaluation.summary.mean_score * 100).toFixed(1)}%` : 'Not run',
        evaluation?.summary
          ? `${evaluation.summary.passed}/${evaluation.summary.cases} passed · ${evaluation.summary.hallucinated} hallucinated · ${_esc(evaluation.model)}`
          : 'Run the evaluation suite and attach its result before promotion.',
        evaluation?.summary ? (evaluation.summary.hallucinated ? 'bad' : evaluation.summary.mean_score >= 0.85 ? 'good' : 'warn') : 'neutral',
      )}
    </div>
    <div class="quality-grid">
      <div class="registry-panel quality-record">
        <div class="section-line"><h2>Current model stack</h2><span>Production configuration</span></div>
        <dl class="definition-list"><div><dt>Language model provider</dt><dd>${_esc(runtime.llmProvider)}</dd></div><div><dt>Language model</dt><dd>${_esc(runtime.llmModel)}</dd></div><div><dt>Transcription backend</dt><dd>${_esc(runtime.whisperBackend)}</dd></div><div><dt>Whisper model</dt><dd>${_esc(runtime.whisperModel)}</dd></div><div><dt>Prompt version</dt><dd>${_esc(runtime.promptVersion || 'Not recorded')}</dd></div><div><dt>Evaluation score</dt><dd>${evaluation?.summary ? `${(evaluation.summary.mean_score * 100).toFixed(1)}% · ${_date(evaluation.ran_at)}` : 'Not attached'}</dd></div></dl>
      </div>
      <div class="registry-panel promotion-gate">
        <h2>Promotion gate</h2><ol>
          ${_gateStep('pass', 'Preserve correction provenance', 'Original, revision, model and source remain attributable.')}
          ${evaluation?.summary
            ? _gateStep(
                evaluation.summary.hallucinated === 0 && evaluation.summary.errored === 0 ? 'pass' : 'fail',
                'Pass regression suite',
                `${evaluation.summary.passed}/${evaluation.summary.cases} passed, ${evaluation.summary.hallucinated} hallucinated, ${evaluation.summary.errored} errored · ${evaluation.file}`)
            : _gateStep('pending', 'Pass regression suite', 'No evaluation run is attached. Run npm run eval.')}
          ${_gateStep(
            (evaluation?.practitioner_reviewed ?? 0) >= 100 ? 'pass' : 'pending',
            'Score on practitioner-reviewed cases',
            `${evaluation?.practitioner_reviewed ?? 0} of 100 approved cases. Below the threshold, a promotion rests on unreviewed evidence.`)}
          ${_gateStep('locked', 'Explicit owner confirmation', 'npm run promote-model checks every gate above and refuses on a regression. It never changes the running model for you.')}
        </ol>
      </div>
    </div>
    ${_modelQualityPanel(quality)}
  </section>`;
}

// Per-model correction rate. This is the read that answers "is the adapter we
// promoted actually better?" — the question training/README.md poses and that
// nothing in this room could previously answer.
function _gateStep(state, title, detail) {
  const icon = state === 'pass' ? 'check' : state === 'fail' ? 'warning' : state === 'locked' ? 'lock' : 'minus';
  const cls = state === 'pass' ? '' : state === 'fail' ? ' class="pending"' : ` class="${state}"`;
  return `<li${cls}><span>${_icon(icon)}</span><div><strong>${_esc(title)}</strong><p>${_esc(detail)}</p></div></li>`;
}

function _modelQualityPanel(quality) {
  const rows = Object.entries(quality?.byModel ?? {})
    .sort((a, b) => b[1].saves - a[1].saves);
  if (!rows.length) {
    return `<div class="registry-panel quality-record"><div class="section-line"><h2>Correction rate by model</h2><span>Last ${_esc(quality?.sinceDays ?? 30)} days</span></div><p>No formulations were saved in this window.</p></div>`;
  }
  return `<div class="registry-panel quality-record">
    <div class="section-line"><h2>Correction rate by model</h2><span>Last ${_esc(quality.sinceDays)} days</span></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Model</th><th>Saves</th><th>Corrections</th><th>Per 100 saves</th><th>Most corrected field</th></tr></thead><tbody>
      ${rows.map(([model, entry]) => {
        const topField = Object.entries(entry.fields).sort((a, b) => b[1] - a[1])[0];
        return `<tr><td><strong>${_esc(model)}</strong><small>${_esc(entry.providers.join(', ') || 'provider not recorded')}</small></td><td>${_esc(entry.saves)}</td><td>${_esc(entry.corrections)}</td><td>${entry.correctionsPer100 == null ? '<span class="tag neutral">Not enough saves</span>' : _esc(entry.correctionsPer100)}</td><td>${topField ? `${_esc(topField[0])} (${_esc(topField[1])})` : 'None'}</td></tr>`;
      }).join('')}
    </tbody></table></div>
  </div>`;
}

function _systemView({ runtime, usage, failureCount, landingSynced, mappingCount }) {
  return `<section class="view" data-view="system" aria-labelledby="system-title">
    <div class="page-heading"><div><h1 id="system-title">System and usage</h1><p>Configuration, failures and recoverability in one operational record.</p></div><span class="environment-label">${_esc(runtime.nodeEnv)}</span></div>
    <div class="system-layout">
      <div class="registry-panel"><div class="section-line"><h2>Connections</h2><span>Values are never displayed</span></div><ul class="connection-list">
        ${_connection('WhatsApp connection', runtime.configured.whatsapp, runtime.configured.whatsapp ? 'Credentials configured' : 'Access token or phone ID missing')}
        ${_connection('Webhook signature', runtime.configured.webhookSigning, runtime.configured.webhookSigning ? 'App secret configured' : 'Unsigned requests allowed in local mode')}
        ${_connection('Transcription service', true, `${runtime.whisperBackend} · ${runtime.whisperModel}`)}
        ${_connection('Language model', true, `${runtime.llmProvider} · ${runtime.llmModel}`)}
        ${_connection('Database', runtime.configured.database, runtime.configured.database ? 'Query responding' : 'Configuration not detected')}
      </ul></div>
      <div class="registry-panel"><div class="section-line"><h2>Usage · last 30 days</h2><span>Estimated third-party cost</span></div><div class="cost-figure"><strong>$${_esc(usage.last30.estimatedUSD)}</strong><span>estimated API cost</span></div><dl class="definition-list compact"><div><dt>Hosted Whisper calls</dt><dd>${usage.last30.whisper}</dd></div><div><dt>Hosted text calls</dt><dd>${usage.last30.claudeText}</dd></div><div><dt>Hosted vision calls</dt><dd>${usage.last30.claudeVision}</dd></div><div><dt>Local model calls</dt><dd>${usage.last30.localCalls || 0}</dd></div><div><dt>Processing errors</dt><dd class="${failureCount ? 'bad-text' : ''}">${failureCount}</dd></div></dl></div>
      <div class="registry-panel"><div class="section-line"><h2>Storage and release</h2><span>Operational identifiers</span></div><dl class="definition-list"><div><dt>Last successful backup</dt><dd>Not reported</dd></div><div><dt>Restore test</dt><dd>Not recorded</dd></div><div><dt>Plant index</dt><dd>v1 · ${mappingCount} mappings</dd></div><div><dt>Landing count</dt><dd>${landingSynced ? 'In sync' : 'Refresh required'}</dd></div><div><dt>Recent deployment</dt><dd>Not connected</dd></div></dl></div>
    </div>
    <div class="danger-zone"><div>${_icon('lock')}<div><strong>Protected operations</strong><p>Restart, restore and publish controls stay disabled until confirmation and fresh authentication are implemented.</p></div></div><div><button class="button secondary" disabled>Restart service</button><button class="button secondary" disabled>Restore backup</button><button class="button secondary" disabled>Publish plant index</button></div></div>
  </section>`;
}

function _securityView(runtime, governance, operator) {
  const configuredCount = Object.values(runtime.configured).filter(Boolean).length;
  return `<section class="view" data-view="security" aria-labelledby="security-title">
    <div class="page-heading"><div><h1 id="security-title">Security and audit</h1><p>One owner, a narrow authority boundary, and a complete administrative record.</p></div><span class="security-score warn">Interim authentication</span></div>
    ${operator?.legacy
      ? `<div class="auth-warning">${_icon('warning')}<div><strong>You are signed in with the shared password.</strong><p>Every correction, confirmation and promotion you record is attributed to <code>${_esc(operator.ref)}</code> rather than to a person. Create an account with <code>npm run admin:account</code> and remove ADMIN_PASSWORD.</p></div></div>`
      : `<div class="auth-warning">${_icon('warning')}<div><strong>Basic Authentication over an allowlisted account.</strong><p>Actions are attributed to <code>${_esc(operator?.ref || 'unknown')}</code>. Passkey or authenticator verification is still required before exports, publishing and archive controls are enabled.</p></div></div>`}
    <div class="security-grid">
      <div class="registry-panel"><h2>Owner access</h2><ul class="security-checks"><li class="done">${_icon('check')} No public registration</li><li class="done">${_icon('check')} Allowlisted operator accounts, scrypt-hashed</li><li class="done">${_icon('check')} Writes attributed to the session, not to a typed field</li><li>${_icon('minus')} Authenticator app or passkey</li><li>${_icon('minus')} Recovery codes</li><li>${_icon('minus')} Automatic session expiry</li><li>${_icon('minus')} Sign out everywhere</li><li>${_icon('minus')} Step-up authentication for sensitive actions</li></ul></div>
      <div class="registry-panel"><div class="section-line"><h2>Secret configuration</h2><span>${configuredCount}/${Object.keys(runtime.configured).length} detected</span></div><p class="panel-intro">Only configuration state is shown. Secret values never enter page markup.</p><ul class="secret-list">
        ${_secret('Database service role', runtime.configured.database)}${_secret('WhatsApp access', runtime.configured.whatsapp)}${_secret('Webhook signing', runtime.configured.webhookSigning)}${_secret('Admin password', runtime.configured.adminPassword)}${_secret('Hosted Whisper', runtime.configured.hostedWhisper)}${_secret('Anthropic baseline', runtime.configured.anthropic)}
      </ul></div>
    </div>
    ${_governancePanel(governance)}
    <div class="registry-panel audit-panel"><div class="section-line"><h2>Administrative audit log</h2><span>Required before mutations ship</span></div><div class="audit-empty">${_icon('history')}<div><strong>No administrative action ledger is connected.</strong><p>Every proposal, confirmation, archive, restore, export and publish event should appear here with actor, time, reason and source.</p></div></div></div>
  </section>`;
}

// Nagoya alignment as a state you can read, not a claim in a document (013).
function _governancePanel(governance) {
  if (!governance) {
    return `<div class="registry-panel audit-panel"><div class="section-line"><h2>Contributor terms and knowledge use</h2><span>Not available</span></div><p class="panel-intro">Apply supabase/013 to record contributor terms and knowledge use.</p></div>`;
  }
  const { terms, stats, uses } = governance;
  return `<div class="registry-panel audit-panel">
    <div class="section-line"><h2>Contributor terms and knowledge use</h2><span>${_esc(terms.version)} · ${_esc(terms.hash)}</span></div>
    ${terms.in_force ? '' : `<div class="auth-warning">${_icon('warning')}<div><strong>These terms are not in force.</strong><p>They have had no legal review and no practitioner consultation. Do not present them to a practitioner as binding or quote them to a partner as Sanko's position.</p></div></div>`}
    <div class="quality-ledger">
      ${_qualityMeasure('Accepted current terms', `${stats.current}/${stats.total}`, 'Only these practitioners may be included in a use of contributed knowledge.', stats.current ? 'good' : 'warn')}
      ${_qualityMeasure('Accepted an older version', stats.stale, stats.stale ? 'The terms changed after they agreed; they must be asked again.' : 'Nobody is on a superseded version.', stats.stale ? 'warn' : 'good')}
      ${_qualityMeasure('Recorded knowledge uses', uses.length, 'Uses of contributed knowledge outside a practitioner Vault.', 'neutral')}
    </div>
    ${uses.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Counterparty</th><th>Contributors</th><th>Agreed benefit</th></tr></thead><tbody>
      ${uses.map(use => `<tr><td>${_date(use.created_at)}</td><td>${_esc(use.use_type)}</td><td><strong>${_esc(use.counterparty)}</strong><small>${_esc(use.purpose)}</small></td><td>${_esc(use.knowledge_use_contributors?.length ?? 0)}</td><td>${_esc(use.benefit_terms || 'None recorded')}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="audit-empty">${_icon('history')}<div><strong>No contributed knowledge has been used outside a practitioner's Vault.</strong><p>Record any research access, licence, publication or dataset export with <code>npm run governance -- record</code>. A use involving a practitioner who has not accepted the terms is refused.</p></div></div>`}
  </div>`;
}

function _reviewQueue(flagged) {
  const lowConfidence = flagged.lowConf.map((item, index) => ({
    id: `low-${item.short_code || index}`,
    kind: 'transcription',
    label: 'Low confidence',
    title: item.short_code || 'Uncoded formulation',
    description: item.condition_std || item.condition_local || 'Condition needs review',
    owner: item.practitioners?.display_name || 'Unattributed practitioner',
    createdAt: item.created_at,
    severity: item.confidence_score < 0.6 ? 'high' : 'medium',
    confidence: item.confidence_score,
    original: item.condition_std || item.condition_local || 'No standardised value',
    proposed: 'No correction proposed',
    evidence: `Formulation ${item.short_code || 'without a short code'}`,
    reason: 'Model confidence is below the 75% review threshold.',
    shortCode: item.short_code || null,
  }));
  const events = flagged.events.map((event, index) => {
    const isPlant = event.event_type === 'unknown_plant_flagged';
    // save_formulation flags every unplaceable name from one record in a single
    // event, so the payload carries a `plants` array. The older single-name
    // shape is still read so historical events do not render as "Unnamed plant".
    const plantNames = isPlant
      ? (Array.isArray(event.payload?.plants) ? event.payload.plants.filter(Boolean) : [event.payload?.local_name].filter(Boolean))
      : [];
    const plantLabel = plantNames.join(', ');
    return {
      id: `event-${event.id || index}`,
      kind: isPlant ? 'plant' : 'failure',
      label: isPlant ? 'Unknown plant' : 'Processing failure',
      title: isPlant ? (plantLabel || 'Unnamed plant') : (event.payload?.step || 'System processing'),
      description: isPlant ? 'Local name needs identification or an explicit unconfirmed state.' : (event.payload?.error || 'Failure details not recorded'),
      owner: event.practitioners?.display_name || 'System',
      createdAt: event.created_at,
      severity: isPlant ? 'medium' : 'high',
      original: isPlant ? (plantLabel || 'No value recorded') : (event.payload?.error || 'No error detail'),
      proposed: 'No correction proposed',
      evidence: isPlant ? `Practitioner-submitted plant name${event.payload?.short_code ? ` · ${event.payload.short_code}` : ''}` : `Processing step: ${event.payload?.step || 'unknown'}`,
      reason: isPlant ? 'No accepted mapping exists for this local name. Queue it with `npm run plants:pull`.' : 'The message or media workflow did not complete.',
      // Only a Vault record can carry a proposal. An unknown-plant name is fixed
      // in the plant index instead, and a processing failure has no record yet.
      shortCode: null,
    };
  });
  return [...events, ...lowConfidence].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function _queueRow(item) {
  return `<button class="queue-row" type="button" data-review-id="${_esc(item.id)}" data-queue-kind="${_esc(item.kind)}" aria-pressed="false"><span class="severity ${item.severity}"></span><span class="queue-copy"><span><b>${_esc(item.label)}</b><time>${_relative(item.createdAt)}</time></span><strong>${_esc(item.title)}</strong><small>${_esc(item.description)}</small><em>${_esc(item.owner)}</em></span><span class="review-cta">Review ${_icon('arrow')}</span></button>`;
}

function _reviewDetail(item, operator) {
  return `<article class="detail-sheet">
    <header><div><span class="tag ${item.severity === 'high' ? 'bad' : 'warn'}">${_esc(item.label)}</span><h2>${_esc(item.title)}</h2><p>${_esc(item.description)}</p></div><button class="icon-button" type="button" data-toast="The source record remains available throughout review." aria-label="Review information">${_icon('info')}</button></header>
    <div class="evidence-line"><span>Source or evidence</span><strong>${_esc(item.evidence)}</strong><small>${_date(item.createdAt)}</small></div>
    <div class="diff-block"><div class="diff-side original"><span>Original value</span><p>${_esc(item.original)}</p></div><div class="diff-arrow">${_icon('arrow')}</div><div class="diff-side proposed"><span>Proposed correction</span><p>${_esc(item.proposed)}</p></div></div>
    <dl class="review-meta"><div><dt>Reason for review</dt><dd>${_esc(item.reason)}</dd></div><div><dt>Practitioner / source</dt><dd>${_esc(item.owner)}</dd></div><div><dt>Reviewer</dt><dd>${_esc(operator?.ref || 'Unassigned')}</dd></div><div><dt>Date</dt><dd>${_date(item.createdAt)}</dd></div></dl>
    <div class="workflow-strip"><span class="current"><i>1</i>Review</span><span><i>2</i>Propose</span><span><i>3</i>Compare</span><span><i>4</i>Confirm</span><span><i>5</i>History</span></div>
    ${item.shortCode ? `<form class="proposal-form" data-proposal-form data-short-code="${_esc(item.shortCode)}">
      <div class="form-pair">
        <label>Field<select data-proposal-field>${['condition_std', 'condition_local', 'plants', 'preparation', 'dosage', 'notes'].map(field => `<option value="${field}">${field}</option>`).join('')}</select></label>
        <label>Attributed to<input type="text" value="${_esc(operator?.ref || 'not signed in')}" disabled></label>
      </div>
      <label>Proposed value<textarea rows="3" data-proposal-value placeholder="What the record should say"></textarea></label>
      <label>Why (optional)<input type="text" data-proposal-note autocomplete="off"></label>
    </form>` : '<p class="governance-foot">This item is not a Vault record, so there is nothing to propose against. Unknown plant names are confirmed with <code>npm run plants:pull</code>.</p>'}
    <div class="detail-actions"><button class="button secondary" type="button" data-toast="The item remains in the queue with its original evidence.">Leave in queue</button>${item.shortCode ? '<button class="button primary" type="button" data-proposal-save>Record proposal</button>' : ''}</div>
    <p class="mutation-note">A proposal is recorded against the record; it does not overwrite it. The practitioner keeps their own words until they change them themselves.</p>
  </article>`;
}

function _recentActivity(formulations, events) {
  const items = [
    ...formulations.map(item => ({ date: item.created_at, title: `${item.short_code || 'Formulation'} recorded`, detail: `${item.practitioners?.display_name || 'Unattributed'} · ${item.condition_std || item.condition_local || 'Condition not standardised'}`, icon: 'file', tone: 'good' })),
    ...events.map(event => ({ date: event.created_at, title: event.event_type === 'error' ? 'Processing failure recorded' : 'Unknown plant sent to review', detail: event.practitioners?.display_name || 'System event', icon: event.event_type === 'error' ? 'warning' : 'leaf', tone: event.event_type === 'error' ? 'bad' : 'warn' })),
  ];
  return items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function _styles() {
  return `
    @font-face{font-family:Archivo;src:url('/admin/assets/archivo-variable.woff2') format('woff2');font-weight:100 900;font-display:swap}
    @font-face{font-family:PlexMono;src:url('/admin/assets/ibm-plex-mono-regular.woff2') format('woff2');font-weight:400;font-display:swap}
    @font-face{font-family:PlexMono;src:url('/admin/assets/ibm-plex-mono-semibold.woff2') format('woff2');font-weight:600;font-display:swap}
    :root{--indigo:#17134f;--deep:#0b0930;--mineral:#f5f2e8;--paper:#fffdf6;--signal:#c8f35b;--copper:#d76545;--copper-ink:#9f3e29;--ink:#090a23;--muted:#656273;--line:#d8d4c9;--line-dark:#3a3671;--good:#35734b;--good-bg:#e3efe3;--warn:#91641a;--warn-bg:#f5eacb;--bad:#a64032;--bad-bg:#f4ddd5;--sidebar:232px;--topbar:66px}
    *{box-sizing:border-box}[hidden]{display:none!important}html{background:var(--deep);scroll-behavior:smooth}body{margin:0;font-family:Archivo,Arial,sans-serif;background:var(--mineral);color:var(--ink);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}button,input,select,textarea{font:inherit}button,a{touch-action:manipulation}button{color:inherit}::selection{background:var(--signal);color:var(--indigo)}:focus-visible{outline:2px solid var(--copper);outline-offset:3px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.skip-link{position:fixed;z-index:100;top:8px;left:8px;background:var(--signal);color:var(--indigo);padding:10px 14px;transform:translateY(-150%)}.skip-link:focus{transform:none}
    .app-shell{min-height:100vh;display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;background:var(--indigo);color:var(--mineral);display:flex;flex-direction:column;border-right:1px solid var(--line-dark);z-index:20}.brand{height:74px;display:flex;align-items:center;gap:11px;padding:0 24px;font-weight:800;letter-spacing:.12em;font-size:17px;border-bottom:1px solid var(--line-dark)}.source-mark{width:27px;height:27px;background:var(--mineral);display:block;position:relative;clip-path:polygon(0 0,75% 0,100% 25%,100% 67%,72% 67%,72% 100%,0 100%)}.source-mark i{position:absolute;width:7px;height:7px;background:var(--indigo);left:7px;top:7px}.private-label{font-family:PlexMono,monospace;text-transform:uppercase;letter-spacing:.06em;color:#bcb8d4;font-size:10px;padding:18px 24px 8px}.nav-list{padding:0 12px;display:grid;gap:2px}.nav-button{width:100%;height:43px;border:0;background:transparent;color:#cfcbdf;display:flex;align-items:center;gap:12px;padding:0 12px;cursor:pointer;text-align:left;position:relative}.nav-button svg{width:18px;height:18px;stroke-width:1.7}.nav-button:hover{background:#211c62;color:#fff}.nav-button.is-active{background:var(--signal);color:var(--indigo);font-weight:700}.nav-count{margin-left:auto;font-family:PlexMono,monospace;font-size:10px;min-width:20px;text-align:center}.nav-button:not(.is-active) .nav-count{color:var(--signal)}.sidebar-foot{margin-top:auto;padding:16px 18px;border-top:1px solid var(--line-dark);display:grid;grid-template-columns:34px 1fr 30px;gap:10px;align-items:center}.sidebar-foot strong,.sidebar-foot span{display:block}.sidebar-foot strong{font-size:13px}.sidebar-foot span{color:#bcb8d4;font-size:11px}.admin-avatar{width:34px;height:34px;display:grid;place-items:center;background:var(--signal);color:var(--indigo);font-family:PlexMono,monospace;font-size:10px;font-weight:600}
    .workspace{min-width:0}.topbar{height:var(--topbar);position:sticky;top:0;z-index:15;background:rgba(245,242,232,.97);border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 30px;gap:18px}.global-search{height:38px;width:min(430px,45vw);display:flex;align-items:center;gap:9px;border-bottom:1px solid #9894a0;color:var(--muted)}.global-search svg{width:17px}.global-search input{width:100%;border:0;outline:0;background:transparent;color:var(--ink)}.global-search kbd{border:1px solid var(--line);padding:2px 5px;font:10px PlexMono,monospace;background:var(--paper)}.topbar-state{margin-left:auto;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:7px}.status-dot{display:inline-block;width:7px;height:7px;background:var(--muted)}.status-dot.good{background:var(--good)}.status-dot.warn{background:var(--warn)}.status-dot.bad{background:var(--bad)}.icon-button,.menu-button{border:0;background:transparent;padding:5px;display:grid;place-items:center;cursor:pointer}.icon-button svg,.menu-button svg{width:18px;height:18px}.notification-button{position:relative}.notification-button span{position:absolute;top:-2px;right:-4px;background:var(--copper);color:white;font:9px PlexMono,monospace;min-width:15px;height:15px;display:grid;place-items:center}.menu-button{display:none}
    .main{padding:30px clamp(22px,3vw,46px) 60px;max-width:1680px;margin:0 auto}.preview-banner{border:1px solid var(--copper);background:var(--warn-bg);display:flex;align-items:center;gap:9px;padding:9px 12px;margin-bottom:18px;color:var(--copper-ink);font-size:12px}.preview-banner svg{width:16px}.preview-banner span{color:var(--ink)}.view{display:none}.view.is-active{display:block}.page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:26px}.page-heading h1{font-size:30px;line-height:1.1;letter-spacing:-.03em;margin:0 0 6px;font-weight:780}.page-heading p{margin:0;color:var(--muted);max-width:68ch}.button{height:40px;padding:0 15px;border:1px solid var(--ink);background:transparent;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-weight:700;font-size:13px}.button svg{width:16px}.button.primary{background:var(--signal);color:var(--indigo);border-color:var(--indigo)}.button:hover:not(:disabled){transform:translateY(-1px)}.button:active:not(:disabled){transform:none}.button:disabled{opacity:.45;cursor:not-allowed}.secondary{background:var(--paper)}
    .today-grid{display:grid;grid-template-columns:minmax(0,1fr) 304px;border:1px solid var(--ink);background:var(--paper)}.attention-column{min-width:0;padding:24px 26px;border-right:1px solid var(--ink)}.attention-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}.attention-header h2,.section-line h2,.rail-section h2,.editor-panel h2,.registry-panel h2{font-size:16px;margin:0 0 3px}.attention-header p,.editor-panel>p,.import-block>p{margin:0;color:var(--muted)}.count-block{font:30px/1 PlexMono,monospace;color:var(--copper-ink);display:flex;flex-direction:column;align-items:flex-end}.count-block small{font:9px PlexMono,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-top:4px}.queue-list{display:grid}.queue-row{width:100%;border:0;border-top:1px solid var(--line);background:transparent;padding:13px 2px;display:grid;grid-template-columns:7px minmax(0,1fr) auto;gap:13px;text-align:left;cursor:pointer}.queue-row:last-child{border-bottom:1px solid var(--line)}.queue-row:hover,.queue-row.is-selected{background:#f0ecdc}.severity{width:7px;height:7px;margin-top:8px;background:var(--muted)}.severity.medium{background:var(--warn)}.severity.high{background:var(--bad)}.queue-copy{min-width:0;display:flex;flex-direction:column}.queue-copy>span{display:flex;gap:12px;align-items:center}.queue-copy b{font:600 10px PlexMono,monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--copper-ink)}.queue-copy time{font-size:11px;color:var(--muted)}.queue-copy strong{font-size:14px;margin:4px 0 1px}.queue-copy small{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.queue-copy em{font-style:normal;font-size:11px;color:#777383;margin-top:5px}.review-cta{align-self:center;font-weight:700;font-size:12px;display:flex;align-items:center;gap:5px}.review-cta svg{width:14px}.text-action{margin-top:16px;border:0;background:transparent;color:var(--copper-ink);font-weight:700;padding:0;cursor:pointer;display:flex;align-items:center;gap:7px}.text-action svg{width:15px}.activity-section{margin-top:38px}.section-line{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:11px}.section-line>span{font-size:11px;color:var(--muted)}.section-line button{border:0;background:transparent;color:var(--copper-ink);font-weight:700;font-size:12px;cursor:pointer}.activity-list{list-style:none;margin:0;padding:0}.activity-list li{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.activity-list li:last-child{border-bottom:1px solid var(--line)}.activity-mark{width:28px;height:28px;display:grid;place-items:center;background:#ebe7db}.activity-mark svg{width:14px}.activity-mark.good{color:var(--good);background:var(--good-bg)}.activity-mark.warn{color:var(--warn);background:var(--warn-bg)}.activity-mark.bad{color:var(--bad);background:var(--bad-bg)}.activity-list strong{display:block;font-size:13px}.activity-list p{margin:1px 0 0;color:var(--muted);font-size:12px}.activity-list time{font-size:11px;color:var(--muted)}
    .operations-rail{padding:24px 21px;background:#efecdf}.rail-section+.rail-section{margin-top:25px;padding-top:23px;border-top:1px solid var(--line)}.health-list{list-style:none;padding:0;margin:0}.health-list li{display:grid;grid-template-columns:8px 1fr auto;gap:8px;align-items:center;padding:7px 0;border-top:1px solid var(--line)}.health-list li span:last-child{font:10px PlexMono,monospace;color:var(--muted)}.backup-block{display:grid;grid-template-columns:26px 1fr;gap:10px;margin:24px -21px 0;padding:18px 21px;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);background:var(--warn-bg)}.backup-block>svg{width:20px;color:var(--warn)}.backup-block.is-good{background:var(--good-bg)}.backup-block.is-good>svg{color:var(--good)}.backup-block.is-good span{color:var(--good)}.backup-block span,.backup-block strong,.backup-block small{display:block}.backup-block span{font:10px PlexMono,monospace;text-transform:uppercase;color:var(--warn)}.backup-block strong{margin:4px 0}.backup-block small{color:#705f48}.quick-actions{display:grid;gap:8px}.quick-actions button,.quick-actions a{min-height:39px;border:1px solid var(--line);background:var(--paper);display:flex;align-items:center;gap:9px;padding:8px 10px;text-decoration:none;color:var(--ink);font-weight:700;font-size:12px;cursor:pointer}.quick-actions svg{width:15px}.quick-actions button:hover,.quick-actions a:hover{border-color:var(--ink)}.metric-ledger{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--ink);border-top:0;background:var(--indigo);color:var(--mineral)}.metric{padding:17px 20px;border-right:1px solid var(--line-dark)}.metric:last-child{border-right:0}.metric span,.metric strong,.metric small{display:block}.metric span{font:10px PlexMono,monospace;text-transform:uppercase;letter-spacing:.04em;color:#bcb8d4}.metric strong{font:24px PlexMono,monospace;color:var(--signal);margin:6px 0 3px}.metric small{color:#c9c6d5}
    .review-workbench{display:grid;grid-template-columns:minmax(320px,38%) minmax(0,1fr);min-height:610px;border:1px solid var(--ink);background:var(--paper)}.review-index{border-right:1px solid var(--ink);padding:16px;max-height:calc(100vh - 190px);overflow:auto}.index-head{display:flex;justify-content:space-between;align-items:center;padding:2px 2px 12px}.index-head span{font-size:11px;color:var(--muted)}.review-detail{padding:28px 32px;min-width:0}.detail-sheet header{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--ink);padding-bottom:19px}.detail-sheet h2{font-size:24px;margin:8px 0 3px}.detail-sheet header p{margin:0;color:var(--muted)}.tag{display:inline-flex;align-items:center;min-height:22px;padding:3px 7px;font:600 9px PlexMono,monospace;text-transform:uppercase;letter-spacing:.04em;background:#e9e6dc;color:var(--muted)}.tag.good{background:var(--good-bg);color:var(--good)}.tag.warn{background:var(--warn-bg);color:var(--warn)}.tag.bad{background:var(--bad-bg);color:var(--bad)}.tag.neutral{background:#e9e6dc;color:var(--muted)}.evidence-line{padding:14px 0;border-bottom:1px solid var(--line);display:grid;grid-template-columns:130px 1fr auto;gap:14px;align-items:center}.evidence-line span{font:9px PlexMono,monospace;text-transform:uppercase;color:var(--muted)}.evidence-line small{color:var(--muted)}.diff-block{display:grid;grid-template-columns:1fr 34px 1fr;margin:24px 0}.diff-side{border:1px solid var(--line);padding:15px;min-height:106px}.diff-side span{font:9px PlexMono,monospace;text-transform:uppercase;color:var(--muted)}.diff-side p{margin:11px 0 0;font-weight:650}.diff-side.original{background:#f0ede4}.diff-side.proposed{border-color:#a7a39a}.diff-arrow{display:grid;place-items:center}.diff-arrow svg{width:17px}.review-meta,.definition-list{margin:0}.review-meta{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line)}.review-meta>div{padding:12px 0;border-bottom:1px solid var(--line)}.review-meta>div:nth-child(odd){padding-right:18px;border-right:1px solid var(--line)}.review-meta>div:nth-child(even){padding-left:18px}.review-meta dt,.definition-list dt{font:9px PlexMono,monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}.review-meta dd,.definition-list dd{margin:4px 0 0;font-weight:600}.workflow-strip{display:grid;grid-template-columns:repeat(5,1fr);margin:25px 0 20px;border-top:1px solid var(--line)}.workflow-strip span{padding-top:9px;font-size:10px;color:var(--muted);border-top:2px solid transparent;margin-top:-1px}.workflow-strip span.current{border-color:var(--copper);color:var(--ink);font-weight:700}.workflow-strip i{font:9px PlexMono,monospace;font-style:normal;margin-right:4px}.detail-actions{display:flex;justify-content:flex-end;gap:8px}.mutation-note{text-align:right;color:var(--muted);font-size:11px;margin:8px 0 0}.detail-empty{min-height:500px;display:grid;place-content:center;text-align:center;justify-items:center}.detail-empty>svg{width:38px;color:var(--good)}.detail-empty h2{margin:14px 0 5px}.detail-empty p{margin:0;color:var(--muted);max-width:42ch}.filter-bar{display:flex;gap:6px;margin:-10px 0 18px}.filter-chip{border:1px solid var(--line);background:var(--paper);height:32px;padding:0 10px;cursor:pointer;font-size:12px}.filter-chip.is-active{border-color:var(--indigo);background:var(--indigo);color:white}.filter-chip span{font-family:PlexMono,monospace;margin-left:4px}
    .publish-state,.privacy-note,.environment-label,.security-score{display:flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--paper);padding:9px 11px;font-size:11px;font-weight:700}.dictionary-summary{display:grid;grid-template-columns:140px 140px 110px 1fr;background:var(--indigo);color:var(--mineral);border:1px solid var(--ink);margin-bottom:16px}.dictionary-summary>div{padding:18px;border-right:1px solid var(--line-dark)}.dictionary-summary strong,.dictionary-summary span{display:block}.dictionary-summary strong{font:23px PlexMono,monospace;color:var(--signal)}.dictionary-summary span{font-size:11px;color:#c9c6d5;margin-top:3px}.dictionary-summary p{padding:18px;margin:0;align-self:center;color:#c9c6d5}.dictionary-layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px}.registry-panel,.editor-panel{border:1px solid var(--ink);background:var(--paper)}.editor-panel{padding:20px}.table-search{height:48px;padding:0 15px;border-bottom:1px solid var(--ink);display:flex;align-items:center;gap:9px}.table-search svg{width:16px;color:var(--muted)}.table-search input{border:0;outline:0;width:100%;background:transparent}.table-wrap{overflow:auto;max-height:620px}.data-table{width:100%;border-collapse:collapse;min-width:720px}.data-table th{text-align:left;padding:10px 13px;background:#ebe8de;border-bottom:1px solid var(--ink);font:600 9px PlexMono,monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);position:sticky;top:0;z-index:1}.data-table td{padding:12px 13px;border-bottom:1px solid var(--line);vertical-align:middle}.data-table tr:hover td{background:#f7f3e8}.data-table td strong,.data-table td small{display:block}.data-table td small{color:var(--muted);margin-top:2px}.muted{color:var(--muted)}.editor-panel form{display:grid;gap:12px;margin-top:18px}.editor-panel label{display:grid;gap:5px;font-size:11px;font-weight:700}.editor-panel input,.editor-panel select,.editor-panel textarea{border:1px solid var(--line);border-radius:0;background:var(--mineral);padding:9px;color:var(--ink);width:100%}.editor-panel input:focus,.editor-panel select:focus,.editor-panel textarea:focus{border-color:var(--indigo);outline:2px solid var(--signal);outline-offset:0}.form-pair{display:grid;grid-template-columns:1fr 1fr;gap:9px}.proposal-preview,.import-preview{margin-top:14px;border:1px solid var(--good);background:var(--good-bg);padding:12px}.proposal-preview strong,.proposal-preview span,.import-preview strong,.import-preview span{display:block}.proposal-preview span,.import-preview span{font-size:11px;margin-top:4px}.import-block{margin:26px -20px -20px;padding:20px;border-top:1px solid var(--ink)}.file-drop{border:1px dashed #8a8790;padding:18px!important;display:grid!important;justify-items:center;text-align:center;cursor:pointer}.file-drop svg{width:20px}.file-drop span{font-weight:400;color:var(--muted)}.file-drop input{position:absolute;width:1px;height:1px;opacity:0}.empty-cell{text-align:center!important;color:var(--muted);padding:36px!important}.empty-queue{padding:30px;border:1px solid var(--line);text-align:center}.empty-queue svg{width:24px;color:var(--good)}.empty-queue strong,.empty-queue span{display:block}.empty-queue span{color:var(--muted);margin-top:4px}.row-action{border:0;background:transparent;cursor:pointer}.row-action svg{width:16px}.inline-actions{display:flex;gap:10px}.inline-actions button{border:0;background:transparent;padding:0;color:var(--copper-ink);font-weight:700;font-size:11px;cursor:pointer}.record-tabs{display:flex;border-bottom:1px solid var(--ink);margin-bottom:16px;overflow:auto}.record-tabs>span{padding:10px 14px;white-space:nowrap;color:var(--muted);display:flex;align-items:center;gap:4px}.record-tabs>span.is-active{color:var(--ink);font-weight:700;border-bottom:2px solid var(--copper);margin-bottom:-1px}.record-tabs b{font:600 10px PlexMono,monospace}.record-tabs small{font:9px PlexMono,monospace;color:#8a8790;margin-left:4px}.governance-foot{font-size:12px;color:var(--muted);margin:12px 0 0}.transcript-cell{max-width:520px;color:var(--muted);font-size:13px}.transcript-editor{margin-top:16px;display:grid;gap:12px}.transcript-editor audio{width:100%}.page-source{border:1px solid var(--line);background:#f7f3e8;padding:10px;max-height:520px;overflow:auto}.page-source img{display:block;max-width:100%;margin:0 auto}.transcript-editor code{font:11px PlexMono,monospace;background:#ebe8de;padding:1px 4px}.transcript-editor label{display:grid;gap:5px;font-size:11px;font-weight:700}.transcript-editor textarea,.transcript-editor input{border:1px solid var(--line);background:var(--mineral);padding:9px;width:100%}.proposal-form{display:grid;gap:11px;margin:0 0 18px}.proposal-form label{display:grid;gap:5px;font-size:11px;font-weight:700}.proposal-form input,.proposal-form select,.proposal-form textarea{border:1px solid var(--line);background:var(--mineral);padding:9px;width:100%}
    .quality-ledger{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--ink);margin-bottom:16px;background:var(--paper)}.quality-measure{padding:18px;border-right:1px solid var(--ink)}.quality-measure:last-child{border:0}.quality-measure span,.quality-measure strong,.quality-measure small{display:block}.quality-measure span{font:9px PlexMono,monospace;text-transform:uppercase;color:var(--muted)}.quality-measure strong{font:23px PlexMono,monospace;margin:9px 0 6px}.quality-measure strong.warn{color:var(--warn)}.quality-measure strong.good{color:var(--good)}.quality-measure small{color:var(--muted)}.quality-grid,.security-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.quality-record,.promotion-gate,.security-grid>.registry-panel,.audit-panel{padding:20px}.definition-list>div{display:flex;justify-content:space-between;gap:20px;padding:10px 0;border-top:1px solid var(--line)}.definition-list dd{text-align:right}.definition-list.compact>div{padding:7px 0}.promotion-gate ol{list-style:none;padding:0;margin:14px 0 0}.promotion-gate li{display:grid;grid-template-columns:26px 1fr;gap:9px;padding:12px 0;border-top:1px solid var(--line)}.promotion-gate li>span{width:24px;height:24px;display:grid;place-items:center;background:var(--good-bg);color:var(--good)}.promotion-gate li.pending>span{background:var(--warn-bg);color:var(--warn)}.promotion-gate li.locked>span{background:#e9e6dc;color:var(--muted)}.promotion-gate svg{width:13px}.promotion-gate strong{font-size:13px}.promotion-gate p{font-size:12px;color:var(--muted);margin:2px 0 0}
    .system-layout{display:grid;grid-template-columns:1.15fr .85fr .85fr;gap:16px}.system-layout>.registry-panel{padding:20px}.connection-list{list-style:none;padding:0;margin:0}.connection-list li{display:grid;grid-template-columns:8px 1fr auto;gap:9px;align-items:center;padding:11px 0;border-top:1px solid var(--line)}.connection-list strong,.connection-list small{display:block}.connection-list small{color:var(--muted);margin-top:2px}.connection-list em{font:9px PlexMono,monospace;font-style:normal;text-transform:uppercase;color:var(--muted)}.cost-figure{padding:18px 0 14px}.cost-figure strong,.cost-figure span{display:block}.cost-figure strong{font:34px PlexMono,monospace;color:var(--copper-ink)}.cost-figure span{color:var(--muted)}.bad-text{color:var(--bad)}.danger-zone{margin-top:16px;border:1px solid var(--ink);background:#ede9df;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:22px}.danger-zone>div{display:flex;align-items:center;gap:12px}.danger-zone svg{width:20px}.danger-zone strong{display:block}.danger-zone p{margin:2px 0 0;color:var(--muted)}
    .security-score.warn{color:var(--warn);background:var(--warn-bg)}.auth-warning{border:1px solid var(--bad);background:var(--bad-bg);padding:18px;display:grid;grid-template-columns:24px 1fr;gap:12px;margin-bottom:16px}.auth-warning>svg{width:21px;color:var(--bad)}.auth-warning p{margin:3px 0 0;color:#6f423d}.security-checks,.secret-list{list-style:none;margin:14px 0 0;padding:0}.security-checks li,.secret-list li{display:flex;align-items:center;gap:9px;padding:9px 0;border-top:1px solid var(--line);color:var(--muted)}.security-checks li.done{color:var(--good)}.security-checks svg{width:15px}.secret-list li{display:grid;grid-template-columns:8px 1fr auto;color:var(--ink)}.secret-list span:last-child{font:9px PlexMono,monospace;text-transform:uppercase;color:var(--muted)}.panel-intro{margin:4px 0 0;color:var(--muted)}.audit-panel{margin-top:16px}.audit-empty{min-height:150px;display:grid;grid-template-columns:28px 1fr;gap:12px;place-content:center;max-width:620px;margin:auto}.audit-empty svg{width:23px;color:var(--muted)}.audit-empty p{margin:3px 0 0;color:var(--muted)}.toast{position:fixed;right:22px;bottom:22px;z-index:100;background:var(--indigo);color:var(--mineral);border:1px solid var(--signal);padding:12px 15px;max-width:360px;transform:translateY(140%);transition:transform 180ms ease-out;font-size:12px}.toast.is-visible{transform:none}
    @media(max-width:1180px){:root{--sidebar:205px}.today-grid{grid-template-columns:minmax(0,1fr) 270px}.system-layout{grid-template-columns:1fr 1fr}.system-layout>.registry-panel:last-child{grid-column:1/-1}.dictionary-layout{grid-template-columns:1fr}.editor-panel{display:grid;grid-template-columns:1fr 1fr;gap:24px}.editor-panel>h2,.editor-panel>p{grid-column:1}.editor-panel form{grid-column:1;grid-row:3}.import-block{grid-column:2;grid-row:1/4;margin:0;padding:0 0 0 24px;border-top:0;border-left:1px solid var(--ink)}.proposal-preview{grid-column:1}.quality-ledger{grid-template-columns:1fr 1fr}.quality-measure:nth-child(2){border-right:0}.quality-measure:nth-child(-n+2){border-bottom:1px solid var(--ink)}}
    @media(max-width:900px){:root{--sidebar:232px}.app-shell{display:block}.sidebar{position:fixed;left:0;transform:translateX(-102%);transition:transform 180ms ease-out;box-shadow:10px 0 30px rgba(9,10,35,.15)}body.nav-open .sidebar{transform:none}.topbar{padding:0 18px}.menu-button{display:grid}.global-search{width:min(430px,60vw)}.topbar-state{display:none}.main{padding:25px 18px 50px}.today-grid{grid-template-columns:1fr}.attention-column{border-right:0}.operations-rail{border-top:1px solid var(--ink)}.metric-ledger{grid-template-columns:1fr 1fr}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid var(--line-dark)}.review-workbench{grid-template-columns:1fr}.review-index{border-right:0;border-bottom:1px solid var(--ink);max-height:360px}.review-detail{padding:24px}.quality-grid,.security-grid{grid-template-columns:1fr}.danger-zone{align-items:flex-start;flex-direction:column}.editor-panel{display:block}.editor-panel form{margin-bottom:20px}.import-block{margin:26px -20px -20px;padding:20px;border-left:0;border-top:1px solid var(--ink)}}
    @media(max-width:620px){.topbar{gap:8px}.global-search{width:auto;flex:1}.global-search kbd{display:none}.page-heading{align-items:flex-start}.page-heading>.button,.page-heading>.publish-state,.page-heading>.privacy-note,.page-heading>.security-score{max-width:42%}.page-heading h1{font-size:26px}.attention-column{padding:18px}.queue-row{grid-template-columns:7px minmax(0,1fr)}.review-cta{display:none}.metric-ledger,.quality-ledger{grid-template-columns:1fr}.metric,.quality-measure{border-right:0!important;border-bottom:1px solid var(--line-dark)}.quality-measure{border-bottom-color:var(--ink)}.dictionary-summary{grid-template-columns:1fr 1fr}.dictionary-summary>div:nth-child(3){border-top:1px solid var(--line-dark)}.dictionary-summary p{grid-column:1/-1;border-top:1px solid var(--line-dark)}.review-detail{padding:18px}.evidence-line{grid-template-columns:1fr}.diff-block{grid-template-columns:1fr}.diff-arrow{height:30px;transform:rotate(90deg)}.review-meta{grid-template-columns:1fr}.review-meta>div{padding:10px 0!important;border-right:0!important}.workflow-strip{overflow:auto}.workflow-strip span{min-width:75px}.detail-actions{flex-direction:column}.detail-actions .button{width:100%}.mutation-note{text-align:left}.system-layout{grid-template-columns:1fr}.system-layout>.registry-panel:last-child{grid-column:auto}.danger-zone>div:last-child{display:grid;width:100%}.danger-zone .button{width:100%}.quality-ledger .quality-measure:nth-child(-n+2){border-bottom-color:var(--ink)}.toast{left:14px;right:14px;bottom:14px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition-duration:.01ms!important}}
  `;
}

function _script() {
  return `
    (() => {
      const body = document.body;
      const views = [...document.querySelectorAll('[data-view]')];
      const navButtons = [...document.querySelectorAll('.nav-button')];
      const toast = document.querySelector('.toast');
      let toastTimer;

      function showToast(message) {
        toast.textContent = message;
        toast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
      }

      function openView(name, focusId) {
        views.forEach(view => view.classList.toggle('is-active', view.dataset.view === name));
        navButtons.forEach(button => {
          const active = button.dataset.openView === name;
          button.classList.toggle('is-active', active);
          if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
        });
        body.classList.remove('nav-open');
        history.replaceState(null, '', '#'+name);
        window.scrollTo({ top: 0, behavior: 'auto' });
        if (focusId) setTimeout(() => document.getElementById(focusId)?.focus(), 0);
      }

      // ── review + transcript writes (C, D) ──
      //
      // Every write carries X-Sanko-Admin. Basic Auth alone would not stop a
      // cross-site form post, because the browser attaches cached credentials to
      // it; a custom header forces a CORS preflight this server never answers.
      async function post(path, payload) {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Sanko-Admin': '1' },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || ('Request failed: ' + response.status));
        return body;
      }

      async function saveProposal(button) {
        const form = button.closest('.detail-sheet')?.querySelector('[data-proposal-form]');
        if (!form) return;
        const value = form.querySelector('[data-proposal-value]').value.trim();
        const field = form.querySelector('[data-proposal-field]').value;
        let after = value;
        // plants, preparation and dosage are jsonb columns; a reviewer may paste
        // JSON or prose. Prose is stored as-is rather than silently discarded.
        if (['plants', 'preparation', 'dosage'].includes(field)) {
          try { after = JSON.parse(value); } catch { /* keep the text */ }
        }
        button.disabled = true;
        try {
          await post('/admin/api/review/correction', {
            short_code: form.dataset.shortCode,
            field,
            after_value: after,
            note: form.querySelector('[data-proposal-note]').value.trim(),
          });
          showToast('Proposal recorded against ' + form.dataset.shortCode + '. The record itself is unchanged.');
          form.querySelector('[data-proposal-value]').value = '';
        } catch (err) {
          showToast(err.message);
        } finally {
          button.disabled = false;
        }
      }

      const transcriptEditor = document.querySelector('[data-transcript-editor]');

      async function openTranscript(id) {
        if (!transcriptEditor) return;
        const template = document.querySelector('[data-transcript-data="'+CSS.escape(id)+'"]');
        if (!template) return;
        const data = JSON.parse(template.innerHTML.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
        const isPage = data.kind === 'photo';
        transcriptEditor.hidden = false;
        transcriptEditor.dataset.mediaId = data.id;
        transcriptEditor.querySelector('[data-transcript-label]').textContent = data.label;
        transcriptEditor.querySelector('[data-transcript-text]').value = data.transcript;
        transcriptEditor.querySelector('[data-transcript-affected]').hidden = true;
        transcriptEditor.querySelector('[data-transcript-guidance]').hidden = !isPage;
        transcriptEditor.scrollIntoView({ block: 'center' });

        // Only the player the source actually has. An empty <audio> above a page
        // photo reads as a broken control room rather than as an absent one.
        const audio = transcriptEditor.querySelector('[data-transcript-audio]');
        const page = transcriptEditor.querySelector('[data-transcript-page]');
        const image = transcriptEditor.querySelector('[data-transcript-image]');
        audio.removeAttribute('src');
        image.removeAttribute('src');
        audio.hidden = isPage;
        page.hidden = !isPage;

        try {
          const response = await fetch('/admin/api/media/'+encodeURIComponent(data.id)+'/source', { headers: { 'X-Sanko-Admin': '1' } });
          const body = await response.json();
          if (!body.url) throw new Error(body.error || 'no source');
          if (isPage) image.src = body.url; else audio.src = body.url;
        } catch { showToast(isPage ? 'The page image could not be loaded.' : 'Audio could not be loaded for this voice note.'); }
      }

      async function saveTranscript(button) {
        button.disabled = true;
        try {
          const result = await post('/admin/api/review/transcript', {
            media_id: transcriptEditor.dataset.mediaId,
            transcript: transcriptEditor.querySelector('[data-transcript-text]').value,
            note: transcriptEditor.querySelector('[data-transcript-note]').value.trim(),
          });
          showToast(result.changed ? 'Reading corrected. The machine output is kept as the before-value.' : 'No change to save.');
          if (result.changed) {
            const row = document.querySelector('[data-transcript-row="'+CSS.escape(transcriptEditor.dataset.mediaId)+'"]');
            if (row) {
              row.querySelector('.transcript-cell').textContent = transcriptEditor.querySelector('[data-transcript-text]').value;
              row.children[4].innerHTML = '<span class="tag good">Reviewed</span>';
            }
            // Records extracted from the old reading are not rewritten — see
            // recordTranscriptReview. Naming them is the whole point: otherwise a
            // corrected page leaves formulations resting on words nobody read.
            const affected = transcriptEditor.querySelector('[data-transcript-affected]');
            if (result.affected && result.affected.length) {
              affected.innerHTML = '<strong>' + result.affected.length + ' record(s) were built from the old reading</strong><span>' +
                result.affected.map(function (f) { return f.short_code; }).join(', ') +
                ' — these were not changed. Check each against the corrected text.</span>';
              affected.hidden = false;
            } else {
              transcriptEditor.hidden = true;
            }
          }
        } catch (err) {
          showToast(err.message);
        } finally {
          button.disabled = false;
        }
      }

      document.addEventListener('click', event => {
        const proposalButton = event.target.closest('[data-proposal-save]');
        if (proposalButton) saveProposal(proposalButton);
        const transcriptOpen = event.target.closest('[data-transcript-open]');
        if (transcriptOpen) openTranscript(transcriptOpen.dataset.transcriptOpen);
        if (event.target.closest('[data-transcript-cancel]') && transcriptEditor) transcriptEditor.hidden = true;
        const transcriptSave = event.target.closest('[data-transcript-save]');
        if (transcriptSave) saveTranscript(transcriptSave);
        const viewButton = event.target.closest('[data-open-view]');
        if (viewButton) openView(viewButton.dataset.openView, viewButton.dataset.focus);
        const toastButton = event.target.closest('[data-toast]');
        if (toastButton) showToast(toastButton.dataset.toast);
        const reviewButton = event.target.closest('[data-review-id]');
        if (reviewButton) {
          if (!reviewButton.closest('[data-view="review"]')) openView('review');
          document.querySelectorAll('[data-review-id]').forEach(row => {
            const selected = row.dataset.reviewId === reviewButton.dataset.reviewId;
            row.classList.toggle('is-selected', selected);
            row.setAttribute('aria-pressed', String(selected));
          });
          const template = document.querySelector('[data-review-template="'+CSS.escape(reviewButton.dataset.reviewId)+'"]');
          const detail = document.querySelector('[data-review-detail]');
          if (template && detail) detail.replaceChildren(template.content.cloneNode(true));
        }
      });

      document.querySelector('.menu-button')?.addEventListener('click', event => {
        const open = body.classList.toggle('nav-open');
        event.currentTarget.setAttribute('aria-expanded', String(open));
      });
      document.querySelector('[data-filter-toggle]')?.addEventListener('click', () => {
        const bar = document.querySelector('.filter-bar');
        bar.hidden = !bar.hidden;
      });
      document.querySelectorAll('[data-queue-filter]').forEach(button => button.addEventListener('click', () => {
        document.querySelectorAll('[data-queue-filter]').forEach(item => { const active = item === button; item.classList.toggle('is-active', active); item.setAttribute('aria-pressed', String(active)); });
        const kind = button.dataset.queueFilter;
        document.querySelectorAll('.review-index [data-queue-kind]').forEach(row => row.hidden = kind !== 'all' && row.dataset.queueKind !== kind);
      }));
      document.querySelector('[data-refresh]')?.addEventListener('click', () => location.reload());

      function bindSearch(input, rows) {
        input?.addEventListener('input', () => {
          const query = input.value.trim().toLowerCase();
          rows.forEach(row => row.hidden = query && !row.dataset.search.includes(query));
        });
      }
      bindSearch(document.querySelector('[data-plant-search]'), [...document.querySelectorAll('[data-plant-row]')]);
      document.querySelectorAll('[data-table-search]').forEach(input => bindSearch(input, [...document.querySelectorAll('#'+input.dataset.tableSearch+' tbody tr[data-search]')]));
      document.querySelector('[data-global-search]')?.addEventListener('input', event => {
        const activeView = document.querySelector('.view.is-active');
        const query = event.currentTarget.value.trim().toLowerCase();
        const localSearch = activeView?.querySelector('[data-plant-search],[data-table-search]');
        if (localSearch) {
          localSearch.value = event.currentTarget.value;
          localSearch.dispatchEvent(new Event('input'));
          return;
        }
        activeView?.querySelectorAll('.queue-row').forEach(row => row.hidden = query && !row.textContent.toLowerCase().includes(query));
      });

      document.querySelector('[data-plant-form]')?.addEventListener('submit', event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const preview = document.querySelector('[data-plant-preview]');
        preview.hidden = false;
        preview.innerHTML = '<strong>Proposed mapping ready for review</strong><span>Original: no mapping · Proposed: '+escapeHtml(data.get('local_name'))+' → '+escapeHtml(data.get('botanical') || 'botanical identity unconfirmed')+'</span><span>Nothing has been written. A server-side revision endpoint and reviewer attribution are required to confirm.</span>';
      });
      document.querySelector('[data-csv-input]')?.addEventListener('change', event => {
        const file = event.target.files[0];
        if (!file) return;
        const preview = document.querySelector('[data-import-preview]');
        preview.hidden = false;
        preview.innerHTML = '<strong>'+escapeHtml(file.name)+'</strong><span>'+Math.round(file.size / 1024)+' KB selected · validation has not run.</span><span>Next required step: parse rows, detect duplicate aliases and show conflicting meanings before confirmation.</span>';
      });
      function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

      const initial = location.hash.slice(1);
      if (views.some(view => view.dataset.view === initial)) openView(initial);
      document.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector('[data-global-search]')?.focus(); }
        if (event.key === 'Escape') body.classList.remove('nav-open');
      });
    })();
  `;
}

function _navButton(view, label, icon, active = false, count = 0) {
  return `<button class="nav-button${active ? ' is-active' : ''}" type="button" data-open-view="${view}"${active ? ' aria-current="page"' : ''}>${_icon(icon)}<span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</button>`;
}
function _metric(label, value, note) { return `<div class="metric"><span>${_esc(label)}</span><strong>${_esc(value)}</strong><small>${_esc(note)}</small></div>`; }
function _qualityMeasure(label, value, note, tone) { return `<div class="quality-measure"><span>${_esc(label)}</span><strong class="${tone}">${_esc(value)}</strong><small>${_esc(note)}</small></div>`; }
function _healthRow(label, value, tone) { return `<li><span class="status-dot ${tone}"></span><strong>${_esc(label)}</strong><span>${_esc(value)}</span></li>`; }
function _connection(label, configured, note) { return `<li><span class="status-dot ${configured ? 'good' : 'warn'}"></span><div><strong>${_esc(label)}</strong><small>${_esc(note)}</small></div><em>${configured ? 'Ready' : 'Attention'}</em></li>`; }
function _secret(label, configured) { return `<li><span class="status-dot ${configured ? 'good' : 'warn'}"></span><strong>${_esc(label)}</strong><span>${configured ? 'Configured' : 'Not detected'}</span></li>`; }
function _emptyQueue() { return `<div class="empty-queue">${_icon('check')}<strong>No items need review</strong><span>New ambiguity and failure events will appear here.</span></div>`; }
function _confidence(score) { if (score == null) return '<span class="tag neutral">Not scored</span>'; const pct = Math.round(score * 100); const tone = score >= .75 ? 'good' : score >= .6 ? 'warn' : 'bad'; return `<span class="tag ${tone}">${pct}%</span>`; }
// Registration and contributor-terms state for the practitioner table.
//
// Each of these has a third case that is not a value: 014 unapplied, which
// arrives as an absent property rather than a null one. It reads as "unknown",
// never as "no" — the control room is evidence, and a missing migration must not
// be able to make it assert something about a person.
function _registrationTag(person) {
  if (!('registered_at' in person)) return '<span class="tag neutral">Unknown</span>';
  if (person.registered_at) return `<span class="tag good">Registered</span>`;
  return '<span class="tag warn">Onboarding</span>';
}

function _termsTag(person) {
  if (!('contributor_terms_accepted_at' in person)) return '<span class="tag neutral">Unknown</span>';
  // The version belongs on the row — a second version will exist one day and
  // "accepted" will not say which — but not as the tag's own text, where an
  // uppercased "V1-DRAFT" reads as a status rather than an answer.
  if (person.contributor_terms_accepted_at) {
    return `<span class="tag good" title="${_esc(`Accepted ${person.contributor_terms_version || 'an unrecorded version'}`)}">Accepted</span>`;
  }
  if (person.contributor_terms_declined_at) return '<span class="tag neutral">Declined</span>';
  return '<span class="tag warn">Not asked</span>';
}

function _registeredNote(counts) {
  if (counts.registered == null) return 'People in the private directory';
  const onboarding = Math.max(0, counts.practitioners - counts.registered);
  return `${counts.registered} registered · ${onboarding} still onboarding`;
}

function _language(code) { return _esc({ en: 'English', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa' }[code] || code || 'Not recorded'); }
function _maskPhone(phone) { const value = String(phone || 'Identifier unavailable'); return value.length > 6 ? `${_esc(value.slice(0, 4))}••••${_esc(value.slice(-3))}` : _esc(value); }
function _date(value) { if (!value) return 'Not recorded'; return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }); }
function _relative(value) { if (!value) return 'Unknown time'; const ms = Date.now() - new Date(value).getTime(); const minutes = Math.floor(ms / 60000); if (minutes < 1) return 'Just now'; if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; const days = Math.floor(hours / 24); return `${days}d ago`; }
function _landingCount() { try { const match = fs.readFileSync(LANDING_COUNT_PATH, 'utf8').match(/=\s*(\d+)/); return match ? Number(match[1]) : null; } catch { return null; } }
function _esc(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function _icon(name) {
  const paths = {
    home:'<path d="M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5z"/><path d="M9 21v-7h6v7"/>',
    inbox:'<path d="M4 4h16l2 10v6H2v-6z"/><path d="M2 14h5l2 3h6l2-3h5"/>',
    leaf:'<path d="M20 4c-7 0-13 3-15 8-1 3 1 7 5 7 6 0 9-7 10-15Z"/><path d="M4 21c2-5 6-8 12-11"/>',
    people:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    archive:'<path d="M3 6h18v15H3z"/><path d="M1 3h22v3H1zM9 11h6"/>',
    quality:'<path d="m12 3 2.4 4.9L20 9l-4 3.9.9 5.6-4.9-2.6-4.9 2.6.9-5.6L4 9l5.6-1.1z"/>',
    pulse:'<path d="M3 12h4l2.5-7 5 14 2.5-7h4"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9m2 6a7 7 0 0 0 12.5 2.5L20 15"/>',
    arrow:'<path d="M5 12h14M14 7l5 5-5 5"/>',
    database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
    message:'<path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.5-5A7 7 0 0 1 3 12V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
    filter:'<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    lock:'<rect x="5" y="10" width="14" height="11"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    file:'<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
    warning:'<path d="m12 3 10 18H2z"/><path d="M12 9v5M12 17h.01"/>',
    download:'<path d="M12 4v12m-5-5 5 5 5-5M4 20h16"/>',
    minus:'<path d="M5 12h14"/>',
    history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter">${paths[name] || paths.info}</svg>`;
}

module.exports = { renderAdminPage };

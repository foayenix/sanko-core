'use strict';
// Static public site for the open plant literature index
// (docs/SANKO_EVIDENCE_ATLAS_SPEC.md, sections 5.3 and 5.7).
//
// Input is committed public data only — plants, cited local names, sources and
// the literature files. There is no database, no runtime API and no analytics.
// Only human-verified, included entries are listed or counted by study type;
// everything else appears as a single "awaiting verification" number.

const vocab = require('./vocab');
const { effectiveEntries } = require('./store');
const { searchNames } = require('./records');

// Sanko's own wording must never frame the index as a list of benefits. Cited
// third-party text — study titles, survey titles, journal names — is the
// authors' words, is marked with class "cited" or "study-title", and is
// excluded from this check.
const PROHIBITED = [/\bbenefits?\b/i, /\bused for\b/i, /\bhelps? with\b/i, /\btreats?\b/i, /\bcures?\b/i, /\bheals?\b/i, /\bboosts?\b/i];

const NOTICE = 'This is an index of published research, not medical advice. The number of studies does not indicate that a plant is effective or safe.';
const PRECLINICAL_NOTICE = 'Most studies listed are laboratory or animal studies.';

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function slug(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function latestDate(data) {
  const dates = [
    ...data.entries.map(entry => entry.indexed_at),
    ...data.verifications.map(event => event.verified_at),
    ...data.studies.map(study => study.last_status_check_at),
  ].filter(Boolean).sort();
  return dates.at(-1) ?? null;
}

function buildModel({ plants, vernacularNames, sources, data }) {
  const studies = new Map(data.studies.map(study => [study.study_id, study]));
  const sourceTitles = new Map(sources.map(source => [source.id, source.title]));
  const byTaxon = new Map();
  for (const entry of effectiveEntries(data)) {
    if (!byTaxon.has(entry.taxon_id)) byTaxon.set(entry.taxon_id, []);
    byTaxon.get(entry.taxon_id).push(entry);
  }

  const taxa = plants
    .filter(plant => plant.verification_status === 'taxonomy_checked' && byTaxon.has(plant.id))
    .map(plant => {
      const entries = byTaxon.get(plant.id);
      const listed = entries
        .filter(entry => entry.verified && entry.decision === 'include')
        .map(entry => ({ ...entry, study: studies.get(entry.study_id) }))
        .sort((a, b) => (b.study.year ?? 0) - (a.study.year ?? 0) || (a.study.title < b.study.title ? -1 : 1));
      const counts = Object.fromEntries(vocab.EVIDENCE_KIND.map(kind => [kind, 0]));
      for (const entry of listed) counts[entry.evidence_kind] += 1;
      const preclinical = counts.in_vitro + counts.animal;
      const localNames = vernacularNames
        .filter(name => name.plant_id === plant.id && name.export_eligible)
        .map(name => ({
          name: name.local_name,
          language: name.language,
          state: name.region?.state ?? null,
          source: sourceTitles.get(name.source_id) ?? name.source_id,
        }))
        .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
      return {
        id: plant.id,
        slug: slug(plant.accepted_botanical),
        accepted: plant.accepted_botanical,
        publishedNames: plant.botanical_names_as_published || [],
        // Older names readers may know the plant by (Vernonia amygdalina for
        // Gymnanthemum amygdalinum), from the binomials sources actually printed.
        alsoKnownAs: searchNames(plant).slice(1),
        gbifKey: plant.taxonomy?.accepted_usage_key ?? null,
        localNames,
        counts,
        listed,
        safety: listed.filter(entry => entry.is_safety_study),
        awaiting: entries.filter(entry => !entry.verified && entry.screening !== 'exclude').length,
        mostlyPreclinical: listed.length > 0 && preclinical / listed.length > 0.5,
      };
    })
    .sort((a, b) => (a.accepted < b.accepted ? -1 : 1));

  return { taxa, asOf: latestDate(data) };
}

// ─── HTML ────────────────────────────────────────────────────────────────────

const CSS = `:root{--indigo:#17134f;--deep:#0b0930;--mineral:#f5f2e8;--chartreuse:#c8f35b;--copper-ink:#9f3e29;--ink:#090a23;--ink-muted:#565369;--line:#d9d5c7;--panel:#fffdf7}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--mineral:#0b0930;--panel:#17134f;--ink:#f5f2e8;--ink-muted:#c9c6d5;--line:#3a3671;--copper-ink:#e08a6e}}
*{box-sizing:border-box}body{margin:0;background:var(--mineral);color:var(--ink);font:16px/1.55 Archivo,system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:var(--indigo);color:#f5f2e8;padding:20px 16px}header a{color:#f5f2e8;text-decoration:none;font-weight:700;letter-spacing:.04em}
header p{margin:4px 0 0;color:#c9c6d5;font-size:14px}main{max-width:960px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:28px;margin:0 0 4px}h1 i{font-weight:700}h2{font-size:19px;margin:32px 0 10px;border-top:1px solid var(--line);padding-top:20px}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px}.muted{color:var(--ink-muted)}
.notice{background:var(--panel);border-left:4px solid var(--copper-ink);padding:12px 14px;margin:16px 0}
.preview{background:var(--chartreuse);color:#090a23;padding:8px 16px;font-weight:700;text-align:center}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}td.n{text-align:right;font-family:"IBM Plex Mono",ui-monospace,monospace}
tr.zero td{color:var(--ink-muted)}ul.studies{list-style:none;padding:0;margin:0}ul.studies li{background:var(--panel);border:1px solid var(--line);padding:12px 14px;margin:0 0 10px}
.tag{display:inline-block;font-size:12px;border:1px solid var(--line);padding:1px 6px;margin:4px 6px 0 0}.retracted .study-title{text-decoration:line-through}
.tag.warn{border-color:var(--copper-ink);color:var(--copper-ink)}a{color:inherit}label{margin-right:12px;font-size:14px}select,input{font:inherit;padding:4px 6px;max-width:100%}
ul.plants{list-style:none;padding:0;columns:2;column-gap:32px}ul.plants li{break-inside:avoid;padding:6px 0;border-bottom:1px solid var(--line)}
@media (max-width:640px){ul.plants{columns:1}h1{font-size:24px}}footer{max-width:960px;margin:0 auto;padding:16px;font-size:13px;color:var(--ink-muted)}`;

const FILTER_SCRIPT = `(function(){var k=document.getElementById('f-kind'),a=document.getElementById('f-area');if(!k)return;function run(){var kv=k.value,av=a.value;document.querySelectorAll('ul.all li').forEach(function(li){var ok=(!kv||li.dataset.kind===kv)&&(!av||(' '+li.dataset.areas+' ').indexOf(' '+av+' ')>-1);li.hidden=!ok;});}k.onchange=run;a.onchange=run;})();`;

const SEARCH_SCRIPT = `(function(){var q=document.getElementById('q');if(!q)return;q.oninput=function(){var v=q.value.toLowerCase();document.querySelectorAll('ul.plants li').forEach(function(li){li.hidden=v&&li.dataset.search.indexOf(v)===-1;});};})();`;

function page({ title, body, release, prefix, asOf, script = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="A bibliographic index of published research on African medicinal plants. Not medical advice.">
<link rel="stylesheet" href="${prefix}style.css">
</head>
<body>
${release ? '' : '<div class="preview">Preview build — not released</div>\n'}<header><a href="${prefix}index.html">SANKO · Plant Literature Index</a><p>Published research, organised by plant. Not medical advice.</p></header>
<main>
${body}
</main>
<footer>Bibliographic index only: Sanko links to studies and does not host them. Literature found through Europe PMC; names checked against GBIF. Data as of ${escape(asOf ?? 'unknown')}.</footer>
${script ? `<script>${script}</script>\n` : ''}</body>
</html>
`;
}

function authorsShort(authors) {
  const named = authors.filter(name => name !== 'et al.');
  if (named.length <= 3) return named.join(', ');
  return `${named.slice(0, 3).join(', ')} et al.`;
}

function studyItem(entry, { correctionsUrl }) {
  const { study } = entry;
  const tags = [
    `<span class="tag">${escape(vocab.EVIDENCE_KIND_LABEL[entry.evidence_kind])}</span>`,
    study.publication_type === 'preprint' ? '<span class="tag warn">Preprint — not peer reviewed</span>' : '',
    study.source_status === 'retracted' ? '<span class="tag warn">Retracted</span>' : '',
    study.source_status === 'questioned' ? '<span class="tag warn">Expression of concern</span>' : '',
    entry.is_safety_study ? '<span class="tag">Safety</span>' : '',
  ].join('');
  const studiedFor = entry.area_studied.filter(area => area !== 'other').map(area => vocab.AREA_LABEL[area]);
  const details = [
    studiedFor.length ? `Studied for: ${studiedFor.join('; ')}` : null,
    entry.plant_part.includes('not_reported') ? null : `Part: ${entry.plant_part.join(', ').replace(/_/g, ' ')}`,
    entry.model === 'not_reported' ? null : `Model: ${entry.model.replace(/_/g, ' ')}`,
    `Voucher specimen: ${entry.voucher_reported.replace(/_/g, ' ')}`,
    entry.botanical_name_as_published ? `Name as published: ${entry.botanical_name_as_published}` : null,
  ].filter(Boolean).map(escape).join(' · ');
  const correction = correctionsUrl
    ? ` · <a href="${escape(correctionLink(correctionsUrl, entry.entry_id))}">Report an error</a>`
    : '';
  return `<li class="${study.source_status === 'retracted' ? 'retracted' : ''}" data-kind="${entry.evidence_kind}" data-areas="${entry.area_studied.join(' ')}">
<span class="study-title">${escape(study.title)}</span><br>
<span class="muted">${escape(authorsShort(study.authors))}${study.journal ? `. <i class="cited">${escape(study.journal)}</i>` : ''}${study.year ? ` (${study.year})` : ''}</span><br>
${tags}<br><span class="muted">${details}</span><br>
<a href="${escape(study.full_text_link)}" rel="noopener noreferrer">Read at source</a>${correction} <span class="mono muted">${escape(entry.entry_id)}</span>
</li>`;
}

function correctionLink(base, entryId) {
  if (base.startsWith('mailto:')) return `${base}?subject=${encodeURIComponent(`Index correction ${entryId}`)}`;
  const url = new URL(base);
  url.searchParams.set('entry', entryId);
  return url.toString();
}

function renderPlant(taxon, { release, correctionsUrl, asOf }) {
  const countRows = vocab.EVIDENCE_KIND.map(kind => {
    const count = taxon.counts[kind];
    return `<tr class="${count ? '' : 'zero'}"><td>${escape(vocab.EVIDENCE_KIND_LABEL[kind])}</td><td class="n">${count}</td></tr>`;
  }).join('\n');

  const localNames = taxon.localNames.length
    ? `<table><tr><th>Local name</th><th>Language</th><th>Source</th></tr>${taxon.localNames.map(name => `<tr><td>${escape(name.name)}</td><td>${escape(name.language ?? 'language not recorded')}</td><td class="muted"><span class="cited">${escape(name.source)}</span>${name.state ? `, ${escape(name.state)}` : ''}</td></tr>`).join('')}</table>`
    : '<p class="muted">No cited local names yet.</p>';

  const areas = [...new Set(taxon.listed.flatMap(entry => entry.area_studied))].sort();
  const filters = taxon.listed.length
    ? `<p><label>Study type <select id="f-kind"><option value="">All</option>${vocab.EVIDENCE_KIND.filter(kind => taxon.counts[kind]).map(kind => `<option value="${kind}">${escape(vocab.EVIDENCE_KIND_LABEL[kind])}</option>`).join('')}</select></label>
<label>Area <select id="f-area"><option value="">All</option>${areas.map(area => `<option value="${area}">${escape(vocab.AREA_LABEL[area])}</option>`).join('')}</select></label></p>`
    : '';

  const body = `<h1><i>${escape(taxon.accepted)}</i></h1>
${taxon.alsoKnownAs.length ? `<p>Also published as ${taxon.alsoKnownAs.map(name => `<i>${escape(name)}</i>`).join(', ')}</p>\n` : ''}<p class="muted">Published studies${taxon.gbifKey ? ` · <a href="https://www.gbif.org/species/${escape(taxon.gbifKey)}" rel="noopener noreferrer">GBIF ${escape(taxon.gbifKey)}</a>` : ''}</p>
<div class="notice">${escape(NOTICE)}${taxon.mostlyPreclinical ? ` ${escape(PRECLINICAL_NOTICE)}` : ''}</div>

<h2>Studies by type</h2>
<table>${countRows}</table>
<p class="muted">Counts include only studies a reviewer has checked against the source. ${taxon.awaiting} further record${taxon.awaiting === 1 ? '' : 's'} found automatically ${taxon.awaiting === 1 ? 'is' : 'are'} awaiting verification and ${taxon.awaiting === 1 ? 'is' : 'are'} not counted.</p>

<h2>Safety studies</h2>
${taxon.safety.length ? `<ul class="studies">${taxon.safety.map(entry => studyItem(entry, { correctionsUrl })).join('\n')}</ul>` : '<p class="muted">No verified safety studies yet. This does not mean the plant is safe.</p>'}

<h2>Identity</h2>
<p>Names as published in sources: ${taxon.publishedNames.map(name => `<i>${escape(name)}</i>`).join('; ') || '—'}</p>
${localNames}

<h2>All verified studies</h2>
${filters}
${taxon.listed.length ? `<ul class="studies all">${taxon.listed.map(entry => studyItem(entry, { correctionsUrl })).join('\n')}</ul>` : '<p class="muted">No verified studies yet.</p>'}`;

  return page({ title: `${taxon.accepted} — published studies`, body, release, prefix: '../', asOf, script: FILTER_SCRIPT });
}

function renderIndex(model, { release, asOf }) {
  const items = model.taxa.map(taxon => {
    const verified = taxon.listed.length;
    return `<li data-search="${escape(`${taxon.accepted} ${taxon.alsoKnownAs.join(' ')} ${taxon.localNames.map(name => name.name).join(' ')}`.toLowerCase())}"><a href="plants/${taxon.slug}.html"><i>${escape(taxon.accepted)}</i></a>${taxon.alsoKnownAs.length ? ` <span class="muted">(${taxon.alsoKnownAs.map(name => `<i>${escape(name)}</i>`).join(', ')})</span>` : ''}<br><span class="muted">${verified} verified stud${verified === 1 ? 'y' : 'ies'} · ${taxon.awaiting} awaiting verification</span></li>`;
  }).join('\n');
  const body = `<h1>Plant literature index</h1>
<p>Published research on medicinal plants recorded in Nigerian ethnobotanical sources, organised by accepted botanical name. For each plant the index lists studies by type, with human studies first, and links to each study at its source.</p>
<div class="notice">${escape(NOTICE)}</div>
<p><label>Find a plant <input id="q" type="search" placeholder="Botanical or local name"></label></p>
<ul class="plants">
${items}
</ul>`;
  return page({ title: 'Plant Literature Index', body, release, prefix: '', asOf, script: SEARCH_SCRIPT });
}

function stripCited(html) {
  return html
    .replace(/<span class="(?:study-title|cited)">[\s\S]*?<\/span>/g, '')
    .replace(/<i class="cited">[\s\S]*?<\/i>/g, '');
}

function prohibitedPhrases(html) {
  const text = stripCited(html).replace(/<[^>]+>/g, ' ');
  return PROHIBITED.filter(pattern => pattern.test(text)).map(pattern => pattern.source);
}

// Public dataset: what the pages show, nothing more.
function publicDataset(model) {
  return {
    as_of: model.asOf,
    notice: NOTICE,
    taxa: model.taxa.map(taxon => ({
      taxon_id: taxon.id,
      accepted_botanical: taxon.accepted,
      gbif_accepted_usage_key: taxon.gbifKey,
      counts_by_evidence_kind: taxon.counts,
      awaiting_verification: taxon.awaiting,
      studies: taxon.listed.map(entry => ({
        entry_id: entry.entry_id,
        evidence_kind: entry.evidence_kind,
        is_safety_study: entry.is_safety_study,
        area_studied: entry.area_studied,
        plant_part: entry.plant_part,
        model: entry.model,
        voucher_reported: entry.voucher_reported,
        botanical_name_as_published: entry.botanical_name_as_published,
        title: entry.study.title,
        authors: entry.study.authors,
        journal: entry.study.journal,
        year: entry.study.year,
        doi: entry.study.doi,
        pmid: entry.study.pmid,
        pmcid: entry.study.pmcid,
        publication_type: entry.study.publication_type,
        source_status: entry.study.source_status,
        link: entry.study.full_text_link,
        verified_at: entry.verified_at,
      })),
    })),
  };
}

function renderSite(model, { release = false, correctionsUrl = null } = {}) {
  if (release && !correctionsUrl) throw new Error('A release build needs a corrections route (--corrections-url).');
  const options = { release, correctionsUrl, asOf: model.asOf };
  const files = { 'style.css': `${CSS}\n`, 'index.html': renderIndex(model, options) };
  for (const taxon of model.taxa) files[`plants/${taxon.slug}.html`] = renderPlant(taxon, options);
  files['data/atlas.json'] = `${JSON.stringify(publicDataset(model), null, 2)}\n`;
  const problems = Object.entries(files)
    .filter(([name]) => name.endsWith('.html'))
    .flatMap(([name, html]) => prohibitedPhrases(html).map(phrase => `${name}: ${phrase}`));
  if (problems.length) throw new Error(`Prohibited wording in generated pages:\n${problems.join('\n')}`);
  return files;
}

module.exports = { NOTICE, PROHIBITED, buildModel, prohibitedPhrases, renderSite, slug };

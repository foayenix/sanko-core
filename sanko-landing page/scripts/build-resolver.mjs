import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Builds the public plant-name resolver from data/plants/. Every page is a published
// vernacular-to-botanical mapping with its source named, so the export gate below is the
// whole point of this script rather than a precaution bolted onto it.
//
// Two lines this generator does not cross:
//
//   1. Therapeutic use. sources.json records that the runtime index uses "the published
//      name mappings and plant parts, not the reported therapeutic use". Observations do
//      carry traditional_use_reported, and it stays out of the HTML. A page that says a
//      plant treats something is health advice, which Sanko does not publish.
//   2. Practitioner-confirmed names. They are export_eligible for the agent's own lookup
//      because a confirmation that never reaches the practitioner has closed nothing, but
//      practitioner-owned knowledge is not website inventory. Only `included` literature
//      sources are published here.

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const repositoryDirectory = path.resolve(projectDirectory, '..');
const plantDataDirectory = path.resolve(repositoryDirectory, 'data', 'plants');
const outputDirectory = path.resolve(projectDirectory, 'public', 'plants');
const sitemapPath = path.resolve(projectDirectory, 'public', 'sitemap-plants.xml');
const reportPath = path.resolve(plantDataDirectory, 'resolver_build_report.json');

const SITE = 'https://www.sanko.africa';
// CI pins the recorded publication date so a later checkout reproduces the pages.
const BUILT_ON = process.env.RESOLVER_BUILD_DATE || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(BUILT_ON)) throw new Error('RESOLVER_BUILD_DATE must be YYYY-MM-DD');

const LANGUAGE_NAMES = {
  yo: 'Yoruba',
  ha: 'Hausa',
  ig: 'Igbo',
  ff: 'Fulfulde',
  en: 'English',
};

// ---------------------------------------------------------------- utilities

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const slugify = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const titleCase = (value) =>
  String(value ?? '').replace(/\b[a-z]/g, (character) => character.toUpperCase());

const languageName = (code) => LANGUAGE_NAMES[code] ?? code ?? 'unspecified language';

const unique = (values) => [...new Set(values.filter(Boolean))];

const sentenceList = (values) => {
  const items = unique(values);
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
};

const regionLabel = (region) => {
  if (!region) return '';
  const parts = [
    region.localities?.length ? sentenceList(region.localities) : '',
    region.state ? `${region.state} State` : '',
    region.country ?? '',
  ].filter(Boolean);
  return unique(parts).join(', ');
};

const readJson = async (name) =>
  JSON.parse(await readFile(path.resolve(plantDataDirectory, name), 'utf8'));

// ---------------------------------------------------------------- the gate

// A vernacular row reaches the public site only when its source is an active, included
// publication and the mapping itself resolved to an accepted taxon. Everything rejected
// here is counted and written to the build report, because "what we did not publish" is
// the more interesting half of a provenance claim.
function publicationVerdict(record, sourcesById) {
  const source = sourcesById.get(record.source_id);
  if (!source) return { published: false, reason: 'source not registered' };
  if (source.publication_status !== 'active') {
    return { published: false, reason: `source ${source.publication_status}` };
  }
  if (source.ingestion_status !== 'included') {
    return { published: false, reason: `source ${source.ingestion_status}` };
  }
  if (record.verification_status !== 'taxonomy_checked') {
    return { published: false, reason: record.verification_status ?? 'unverified' };
  }
  if (!record.accepted_botanical) return { published: false, reason: 'no accepted taxon' };
  if (!record.export_eligible) return { published: false, reason: 'not export eligible' };
  return { published: true, reason: '' };
}

// ---------------------------------------------------------------- templates

// Source titles name the condition a survey studied ("anti-asthmatic plants", "animal
// diarrhoea"). The citation has to stay verbatim, so every page that carries one also
// carries this, rather than leaving a reader or a model to draw the obvious inference.
const SOURCE_SCOPE =
  'Sanko uses this survey for its published name mapping and reported plant parts only. ' +
  'The subject the survey investigated is not a therapeutic claim about this plant.';

const DISCLAIMER =
  'Sanko publishes plant name mappings and the parts reported in the source literature. ' +
  'It does not publish therapeutic claims, and nothing here is medical guidance.';

function layout({ title, description, canonical, jsonLd, breadcrumb, body }) {
  const crumbs = breadcrumb
    .map((crumb, index) =>
      index === breadcrumb.length - 1
        ? `<span aria-current="page">${escapeHtml(crumb.label)}</span>`
        : `<a href="${escapeHtml(crumb.href)}">${escapeHtml(crumb.label)}</a>`,
    )
    .join('<span class="sep" aria-hidden="true">/</span>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#080840">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Sanko">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">
<link rel="stylesheet" href="/plants/resolver.css">
<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>
</head>
<body>
<header class="masthead">
  <a class="lockup" href="/">
    <svg viewBox="0 0 75 81" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M0 0H39L49 11V28H75V57H49V81H0Z M19 14H31V27H19Z"/></svg>
    <span>Sanko</span>
  </a>
  <nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>
</header>
<main>
${body}
</main>
<footer>
  <p>${escapeHtml(DISCLAIMER)}</p>
  <p><a href="/plants/">Plant name resolver</a> · <a href="/plants/sources/">Sources</a> · <a href="/">Sanko</a></p>
</footer>
</body>
</html>
`;
}

function definitionList(rows) {
  const items = rows
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${value}</dd>`)
    .join('\n');
  return `<dl class="record">\n${items}\n</dl>`;
}

function sourceCitation(source, locator) {
  const where = locator
    ? `${locator.table ?? ''}${locator.row ? `, row ${locator.row}` : ''}`.replace(/^, /, '')
    : '';
  const link = source.url
    ? `<a href="${escapeHtml(source.url)}" rel="nofollow">${escapeHtml(source.title)}</a>`
    : escapeHtml(source.title);
  return `${link}${where ? ` — ${escapeHtml(where)}` : ''}`;
}

// ---------------------------------------------------------------- page builders

function vernacularPage({ name, attestations, sourcesById, partsByTaxon }) {
  const taxa = unique(attestations.map((row) => row.accepted_botanical)).sort();
  const display = titleCase(attestations[0].local_name ?? name);
  const languages = unique(attestations.map((row) => row.language));
  const languageLabel = sentenceList(languages.map(languageName));
  const contested = taxa.length > 1;

  // The lead sentence names its own subject. Retrieval chunks a page into passages, and a
  // passage that opens with "It is..." arrives at the model with the subject already gone.
  const lead = contested
    ? `${display} is a ${languageLabel} plant name that published sources map to more than one species: ${sentenceList(taxa)}. Sanko does not resolve it to a single taxon.`
    : `${display} is a ${languageLabel} name for ${taxa[0]}, recorded in ${sentenceList(attestations.map((row) => regionLabel(row.region))) || 'Nigeria'}.`;

  const title = contested
    ? `${display} — a contested ${languageLabel} plant name`
    : `${display} — ${languageLabel} name for ${taxa[0]}`;

  const candidates = attestations
    .map((row) => {
      const source = sourcesById.get(row.source_id);
      const parts = partsByTaxon.get(row.botanical_as_published) ?? [];
      return `<li class="candidate">
  <p class="candidate-taxon"><a href="/plants/botanical/${slugify(row.accepted_botanical)}/"><em>${escapeHtml(row.accepted_botanical)}</em></a></p>
  ${definitionList([
    ['Name as published', escapeHtml(row.local_name)],
    ['Language', escapeHtml(languageName(row.language))],
    ['Botanical name as published', escapeHtml(row.botanical_as_published)],
    ['Parts reported', parts.length ? escapeHtml(sentenceList(parts)) : ''],
    ['Where recorded', escapeHtml(regionLabel(row.region))],
    ['Source', sourceCitation(source, row.source_locator)],
    ['Scope used', escapeHtml(SOURCE_SCOPE)],
    ['Verification', 'Taxonomy checked against GBIF. Not reviewed by a botanist, language reviewer or practitioner.'],
  ])}
</li>`;
    })
    .join('\n');

  const body = `<article>
<p class="eyebrow">${escapeHtml(languageLabel)} plant name</p>
<h1>${escapeHtml(display)}</h1>
<p class="lead">${escapeHtml(lead)}</p>
${
  contested
    ? `<div class="conflict"><p class="eyebrow">Sources disagree</p><p>Two or more published surveys record ${escapeHtml(display)} against different species. Both readings are shown below with their sources. Sanko keeps the name unresolved rather than choosing between them.</p></div>`
    : ''
}
<h2>${contested ? 'What the sources say' : 'The record'}</h2>
<ul class="candidates">
${candidates}
</ul>
<p class="backlink"><a href="/plants/">All ${escapeHtml(languageLabel)} and other local plant names →</a></p>
</article>`;

  return {
    url: `/plants/${slugify(name)}/`,
    html: layout({
      title: `${title} | Sanko`,
      description: lead,
      canonical: `${SITE}/plants/${slugify(name)}/`,
      breadcrumb: [
        { label: 'Sanko', href: '/' },
        { label: 'Plant names', href: '/plants/' },
        { label: display },
      ],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'DefinedTerm',
        name: display,
        description: lead,
        inDefinedTermSet: `${SITE}/plants/#termset`,
        url: `${SITE}/plants/${slugify(name)}/`,
        inLanguage: languages,
        ...(contested ? {} : { alternateName: taxa[0] }),
      },
      body,
    }),
  };
}

function taxonPage({ taxon, attestations, plant, sourcesById, partsByTaxon }) {
  const names = attestations
    .slice()
    .sort((a, b) => a.local_name.localeCompare(b.local_name));
  const languageLabel = sentenceList(unique(names.map((row) => languageName(row.language))));
  const lead = `${taxon} is recorded under ${names.length} local ${names.length === 1 ? 'name' : 'names'} in the published Nigerian ethnobotanical literature Sanko has mapped, across ${languageLabel}.`;
  const parts = unique(
    names.flatMap((row) => partsByTaxon.get(row.botanical_as_published) ?? []),
  );

  const rows = names
    .map((row) => {
      const source = sourcesById.get(row.source_id);
      return `<tr>
  <th scope="row"><a href="/plants/${slugify(row.normalized_name)}/">${escapeHtml(titleCase(row.local_name))}</a></th>
  <td>${escapeHtml(languageName(row.language))}</td>
  <td>${escapeHtml(regionLabel(row.region))}</td>
  <td>${sourceCitation(source, row.source_locator)}</td>
</tr>`;
    })
    .join('\n');

  const taxonomy = plant?.taxonomy;

  const body = `<article>
<p class="eyebrow">Botanical record</p>
<h1><em>${escapeHtml(taxon)}</em></h1>
<p class="lead">${escapeHtml(lead)}</p>
${definitionList([
  ['Accepted botanical name', `<em>${escapeHtml(taxon)}</em>`],
  [
    'Names as published',
    escapeHtml(sentenceList(plant?.botanical_names_as_published ?? [])),
  ],
  ['Common English', escapeHtml(sentenceList(plant?.common_english ?? []))],
  ['Parts reported', parts.length ? escapeHtml(sentenceList(parts)) : ''],
  [
    'GBIF taxonomy',
    taxonomy
      ? escapeHtml(
          `usage key ${taxonomy.accepted_usage_key ?? taxonomy.usage_key} · ${taxonomy.taxonomic_status} · ${taxonomy.match_type} match at ${taxonomy.confidence}% confidence · checked ${taxonomy.checked_at}`,
        )
      : '',
  ],
])}
<h2>Local names recorded for <em>${escapeHtml(taxon)}</em></h2>
<p class="scope">${escapeHtml(SOURCE_SCOPE)}</p>
<div class="table-scroll">
<table>
<thead><tr><th scope="col">Local name</th><th scope="col">Language</th><th scope="col">Where recorded</th><th scope="col">Source</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</article>`;

  return {
    url: `/plants/botanical/${slugify(taxon)}/`,
    html: layout({
      title: `${taxon} — local names and sources | Sanko`,
      description: lead,
      canonical: `${SITE}/plants/botanical/${slugify(taxon)}/`,
      breadcrumb: [
        { label: 'Sanko', href: '/' },
        { label: 'Plant names', href: '/plants/' },
        { label: taxon },
      ],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'DefinedTerm',
        name: taxon,
        description: lead,
        inDefinedTermSet: `${SITE}/plants/#termset`,
        url: `${SITE}/plants/botanical/${slugify(taxon)}/`,
        alternateName: names.map((row) => titleCase(row.local_name)),
      },
      body,
    }),
  };
}

function languagePage({ code, attestations }) {
  const label = languageName(code);
  const names = [...new Map(attestations.map((row) => [row.normalized_name, row])).values()].sort(
    (a, b) => a.local_name.localeCompare(b.local_name),
  );
  const lead = `Sanko has mapped ${names.length} ${label} plant ${names.length === 1 ? 'name' : 'names'} to accepted botanical names, each traceable to a published ethnobotanical survey.`;

  const items = names
    .map(
      (row) =>
        `<li><a href="/plants/${slugify(row.normalized_name)}/">${escapeHtml(titleCase(row.local_name))}</a> <em>${escapeHtml(row.accepted_botanical)}</em></li>`,
    )
    .join('\n');

  return {
    url: `/plants/language/${code}/`,
    html: layout({
      title: `${label} medicinal plant names and their botanical equivalents | Sanko`,
      description: lead,
      canonical: `${SITE}/plants/language/${code}/`,
      breadcrumb: [
        { label: 'Sanko', href: '/' },
        { label: 'Plant names', href: '/plants/' },
        { label: label },
      ],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${label} medicinal plant names`,
        description: lead,
        url: `${SITE}/plants/language/${code}/`,
        inLanguage: code,
      },
      body: `<article>
<p class="eyebrow">${escapeHtml(label)}</p>
<h1>${escapeHtml(label)} plant names</h1>
<p class="lead">${escapeHtml(lead)}</p>
<ul class="name-index">
${items}
</ul>
</article>`,
    }),
  };
}

function sourcePage({ source, attestations }) {
  const count = attestations.length;
  const lead = `Sanko draws ${count} published plant name ${count === 1 ? 'mapping' : 'mappings'} from ${source.title}.`;
  const rows = attestations
    .slice()
    .sort((a, b) => a.local_name.localeCompare(b.local_name))
    .map(
      (row) => `<tr>
  <th scope="row"><a href="/plants/${slugify(row.normalized_name)}/">${escapeHtml(titleCase(row.local_name))}</a></th>
  <td>${escapeHtml(languageName(row.language))}</td>
  <td><a href="/plants/botanical/${slugify(row.accepted_botanical)}/"><em>${escapeHtml(row.accepted_botanical)}</em></a></td>
  <td class="num">${escapeHtml(row.source_locator?.row ?? '')}</td>
</tr>`,
    )
    .join('\n');

  return {
    url: `/plants/sources/${source.id}/`,
    html: layout({
      title: `${source.title} — mappings used by Sanko | Sanko`,
      description: lead,
      canonical: `${SITE}/plants/sources/${source.id}/`,
      breadcrumb: [
        { label: 'Sanko', href: '/' },
        { label: 'Plant names', href: '/plants/' },
        { label: 'Sources', href: '/plants/sources/' },
        { label: source.id },
      ],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'ScholarlyArticle',
        headline: source.title,
        ...(source.doi ? { identifier: `https://doi.org/${source.doi}` } : {}),
        ...(source.url ? { url: source.url } : {}),
        license: source.licence,
      },
      body: `<article>
<p class="eyebrow">Source</p>
<h1>${escapeHtml(source.title)}</h1>
<p class="lead">${escapeHtml(lead)}</p>
${definitionList([
  ['DOI', source.doi ? `<a href="https://doi.org/${escapeHtml(source.doi)}" rel="nofollow">${escapeHtml(source.doi)}</a>` : ''],
  ['Table used', escapeHtml(source.table ?? '')],
  ['Licence', escapeHtml(source.licence ?? '')],
  ['Where the study was conducted', escapeHtml(regionLabel(source.location))],
  ['Languages labelled in the source', escapeHtml(sentenceList((source.languages ?? []).map(languageName)))],
  ['Scope Sanko uses', escapeHtml(source.notes ?? '')],
])}
<h2>Mappings drawn from this source</h2>
<div class="table-scroll">
<table>
<thead><tr><th scope="col">Local name</th><th scope="col">Language</th><th scope="col">Accepted botanical name</th><th scope="col">Row</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</article>`,
    }),
  };
}

function sourceIndexPage({ sources, publishedCounts, excludedSources }) {
  const lead = `Every plant name Sanko publishes comes from one of ${sources.length} peer-reviewed ethnobotanical ${sources.length === 1 ? 'survey' : 'surveys'} of Nigerian flora.`;

  const included = sources
    .map(
      (source) => `<li>
<h3><a href="/plants/sources/${source.id}/">${escapeHtml(source.title)}</a></h3>
<p>${escapeHtml(source.licence ?? '')} · ${escapeHtml(publishedCounts.get(source.id) ?? 0)} mappings published${source.doi ? ` · <a href="https://doi.org/${escapeHtml(source.doi)}" rel="nofollow">${escapeHtml(source.doi)}</a>` : ''}</p>
</li>`,
    )
    .join('\n');

  const excluded = excludedSources
    .map(
      (source) =>
        `<tr><th scope="row">${escapeHtml(source.title)}</th><td>${escapeHtml(source.ingestion_status)}</td><td>${escapeHtml(source.notes ?? '')}</td></tr>`,
    )
    .join('\n');

  return {
    url: '/plants/sources/',
    html: layout({
      title: 'Sources behind the Sanko plant name resolver | Sanko',
      description: lead,
      canonical: `${SITE}/plants/sources/`,
      breadcrumb: [
        { label: 'Sanko', href: '/' },
        { label: 'Plant names', href: '/plants/' },
        { label: 'Sources' },
      ],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Sources behind the Sanko plant name resolver',
        description: lead,
        url: `${SITE}/plants/sources/`,
      },
      body: `<article>
<p class="eyebrow">Provenance</p>
<h1>Where these mappings come from</h1>
<p class="lead">${escapeHtml(lead)}</p>
<ul class="source-list">
${included}
</ul>
<h2>Registered but not published</h2>
<p>Sanko holds further sources that do not meet its export conditions. They are listed here because an omission that nobody can see is not a provenance claim.</p>
<div class="table-scroll">
<table>
<thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Why it is excluded</th></tr></thead>
<tbody>
${excluded}
</tbody>
</table>
</div>
</article>`,
    }),
  };
}

function hubPage({ names, taxaCount, languageCounts, sources, contestedCount }) {
  const lead = `Sanko maps ${names.length} local plant names from Nigerian ethnobotanical surveys to ${taxaCount} accepted botanical names, each verified against the GBIF taxonomy backbone and traceable to a named published source.`;

  const languageLinks = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([code, count]) =>
        `<li><a href="/plants/language/${code}/">${escapeHtml(languageName(code))}</a> <span class="count num">${count}</span></li>`,
    )
    .join('\n');

  const letters = new Map();
  for (const row of names) {
    const letter = titleCase(row.local_name).charAt(0).toUpperCase();
    if (!letters.has(letter)) letters.set(letter, []);
    letters.get(letter).push(row);
  }

  const index = [...letters.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([letter, rows]) => `<section class="letter">
<h3 id="letter-${escapeHtml(letter)}">${escapeHtml(letter)}</h3>
<ul class="name-index">
${rows
  .sort((a, b) => a.local_name.localeCompare(b.local_name))
  .map(
    (row) =>
      `<li><a href="/plants/${slugify(row.normalized_name)}/">${escapeHtml(titleCase(row.local_name))}</a> <em>${escapeHtml(row.contested ? 'contested' : row.accepted_botanical)}</em></li>`,
  )
  .join('\n')}
</ul>
</section>`,
    )
    .join('\n');

  return {
    url: '/plants/',
    html: layout({
      title: 'Plant name resolver — local names to botanical names | Sanko',
      description: lead,
      canonical: `${SITE}/plants/`,
      breadcrumb: [{ label: 'Sanko', href: '/' }, { label: 'Plant names' }],
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'DefinedTermSet',
            '@id': `${SITE}/plants/#termset`,
            name: 'Sanko plant name resolver',
            description: lead,
            url: `${SITE}/plants/`,
          },
          {
            '@type': 'Dataset',
            name: 'Sanko vernacular-to-botanical plant name mappings',
            description: lead,
            url: `${SITE}/plants/`,
            dateModified: BUILT_ON,
            creator: { '@id': `${SITE}/#organization` },
            citation: sources.map((source) =>
              source.doi ? `https://doi.org/${source.doi}` : source.title,
            ),
          },
        ],
      },
      body: `<article>
<p class="eyebrow">Reference</p>
<h1>Plant name resolver</h1>
<p class="lead">${escapeHtml(lead)}</p>

<ul class="stats">
  <li><b class="num">${names.length}</b> local names</li>
  <li><b class="num">${taxaCount}</b> botanical names</li>
  <li><b class="num">${contestedCount}</b> contested names</li>
  <li><b class="num">${sources.length}</b> published sources</li>
</ul>

<p>Each entry names its source down to the table and row it was read from. Where published
surveys disagree about which species a local name refers to, Sanko shows the disagreement
rather than picking a winner. <a href="/plants/sources/">See the sources →</a></p>

<h2>By language</h2>
<ul class="language-list">
${languageLinks}
</ul>

<h2>All names</h2>
${index}
</article>`,
    }),
  };
}

// ---------------------------------------------------------------- stylesheet

const STYLESHEET = `/* Generated by scripts/build-resolver.mjs. Tokens follow BRAND_IDENTITY.md section 4. */
:root{--brand-indigo:#17134F;--field-indigo:#080840;--mineral:#F5F2E8;--chartreuse:#C8F35B;--copper-ink:#9F3E29;--ink:#090A23;--indigo-line:#34346B;--mineral-muted:#C9C6D5;--ink-muted:#565369;
--ground:var(--mineral);--surface:#EFEBDE;--text:var(--ink);--muted:var(--ink-muted);--heading:var(--brand-indigo);--rule:#CFC9B8;--accent:var(--copper-ink);--band:var(--brand-indigo);--band-text:var(--mineral);--band-muted:var(--mineral-muted)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:var(--field-indigo);--surface:#0E0E4A;--text:var(--mineral);--muted:var(--mineral-muted);--heading:var(--mineral);--rule:var(--indigo-line);--accent:var(--chartreuse);--band:#030326;--band-text:var(--mineral);--band-muted:var(--mineral-muted)}}
:root[data-theme="dark"]{--ground:var(--field-indigo);--surface:#0E0E4A;--text:var(--mineral);--muted:var(--mineral-muted);--heading:var(--mineral);--rule:var(--indigo-line);--accent:var(--chartreuse);--band:#030326;--band-text:var(--mineral);--band-muted:var(--mineral-muted)}
@font-face{font-family:"Archivo";src:url("/fonts/archivo-variable.woff2") format("woff2");font-weight:400 900;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url("/fonts/ibm-plex-mono-regular.woff2") format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url("/fonts/ibm-plex-mono-semibold.woff2") format("woff2");font-weight:600;font-display:swap}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--text);font-family:"Archivo",system-ui,sans-serif;line-height:1.65;font-size:16px}
a{color:inherit;text-underline-offset:.22em}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.masthead{display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:18px max(22px,calc((100vw - 860px)/2));background:var(--band);color:var(--band-text)}
.lockup{display:flex;align-items:center;gap:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;font-size:14px;text-decoration:none}
.lockup svg{width:18px;height:18px}
.crumbs{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.06em;color:var(--band-muted)}
.crumbs .sep{padding:0 8px}
main{width:min(860px,calc(100% - 44px));margin:0 auto;padding:44px 0 24px}
.eyebrow{margin:0;font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
h1{margin:10px 0 0;font-size:clamp(34px,5.5vw,54px);font-weight:900;line-height:1.02;letter-spacing:-.03em;color:var(--heading);text-wrap:balance}
h1 em{font-style:italic}
h2{margin:48px 0 0;font-size:23px;font-weight:800;letter-spacing:-.02em;color:var(--heading)}
h3{margin:30px 0 8px;font-size:17px;font-weight:800;color:var(--heading)}
p{max-width:68ch}
.lead{margin-top:18px;font-size:19px;color:var(--text)}
.conflict{margin-top:24px;padding:18px 20px;background:var(--surface);border-left:3px solid var(--accent)}
.conflict p{margin:0;font-size:15px}
.conflict .eyebrow{margin-bottom:6px;color:var(--accent)}
dl.record{display:grid;grid-template-columns:200px 1fr;gap:9px 22px;margin:20px 0 0;padding-top:18px;border-top:1px solid var(--rule);font-size:14.5px}
dl.record dt{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);padding-top:4px}
dl.record dd{margin:0}
ul.candidates{list-style:none;margin:20px 0 0;padding:0;display:grid;gap:26px}
.candidate{padding:20px 22px;background:var(--surface)}
.candidate-taxon{margin:0;font-size:20px;font-weight:800}
.candidate dl.record{border-top-color:var(--rule)}
ul.name-index{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:7px 26px;font-size:15px}
ul.name-index em{color:var(--muted);font-size:13px}
ul.language-list,ul.source-list{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:10px}
ul.language-list .count{color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:12px}
ul.source-list li{padding-bottom:12px;border-bottom:1px solid var(--rule)}
ul.source-list h3{margin:0 0 4px}
ul.source-list p{margin:0;font-size:14px;color:var(--muted)}
ul.stats{list-style:none;margin:26px 0 0;padding:22px 0;display:flex;flex-wrap:wrap;gap:14px 46px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
ul.stats li{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
ul.stats b{display:block;font-family:"Archivo",sans-serif;font-size:34px;font-weight:800;letter-spacing:-.02em;color:var(--accent)}
.letter h3{margin-top:26px;padding-bottom:5px;border-bottom:1px solid var(--rule);font-family:"IBM Plex Mono",monospace;font-size:12px;letter-spacing:.1em;color:var(--accent)}
.table-scroll{overflow-x:auto;margin-top:16px}
table{width:100%;border-collapse:collapse;font-size:14.5px;min-width:560px}
th,td{padding:10px 14px 10px 0;text-align:left;vertical-align:top;border-bottom:1px solid var(--rule)}
thead th{font-family:"IBM Plex Mono",monospace;font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
tbody th{font-weight:600}
.num{font-variant-numeric:tabular-nums}
.scope{margin-top:12px;font-size:13.5px;color:var(--muted)}
.backlink{margin-top:36px;font-size:15px}
footer{width:min(860px,calc(100% - 44px));margin:48px auto 0;padding:22px 0 44px;border-top:1px solid var(--rule)}
footer p{margin:0;font-size:13px;color:var(--muted)}
footer p+p{margin-top:8px}
@media(max-width:640px){dl.record{grid-template-columns:1fr;gap:2px}dl.record dd{margin-bottom:10px}}
`;

// ---------------------------------------------------------------- build

async function writePage(page) {
  const directory = path.resolve(projectDirectory, 'public', page.url.replace(/^\/+/, ''));
  await mkdir(directory, { recursive: true });
  await writeFile(path.resolve(directory, 'index.html'), page.html, 'utf8');
}

let sources;
let vernacularNames;
let plants;
let observations;

try {
  [sources, vernacularNames, plants, observations] = await Promise.all([
    readJson('sources.json'),
    readJson('vernacular_names.json'),
    readJson('plants.json'),
    readJson('observations.json'),
  ]);
} catch (error) {
  // Same posture as sync-plant-count.mjs: a build host pointed at the landing folder alone
  // has no data/ directory, and skipping is better than failing the whole deploy.
  const reason =
    error.code === 'ENOENT'
      ? `no plant data at ${path.relative(repositoryDirectory, plantDataDirectory)}`
      : `could not read plant data (${error.message})`;
  console.warn(`Skipped resolver build: ${reason}.`);
  console.warn('Any previously generated pages under public/plants/ are left in place.');
  process.exit(0);
}

const sourcesById = new Map(sources.map((source) => [source.id, source]));
const plantsByTaxon = new Map(plants.map((plant) => [plant.accepted_botanical, plant]));

// Observations join on the published botanical string rather than plant_id, which is null
// for every literature row in the current build.
const partsByTaxon = new Map();
for (const observation of observations) {
  if (!observation.botanical_as_published || !observation.parts_reported?.length) continue;
  const existing = partsByTaxon.get(observation.botanical_as_published) ?? [];
  partsByTaxon.set(
    observation.botanical_as_published,
    unique([...existing, ...observation.parts_reported]),
  );
}

const published = [];
const rejections = new Map();
for (const record of vernacularNames) {
  const verdict = publicationVerdict(record, sourcesById);
  if (verdict.published) {
    published.push(record);
  } else {
    rejections.set(verdict.reason, (rejections.get(verdict.reason) ?? 0) + 1);
  }
}

if (published.length === 0) {
  console.warn('Skipped resolver build: no vernacular names met the publication conditions.');
  process.exit(0);
}

const byName = new Map();
for (const record of published) {
  if (!byName.has(record.normalized_name)) byName.set(record.normalized_name, []);
  byName.get(record.normalized_name).push(record);
}

const byTaxon = new Map();
for (const record of published) {
  if (!byTaxon.has(record.accepted_botanical)) byTaxon.set(record.accepted_botanical, []);
  byTaxon.get(record.accepted_botanical).push(record);
}

const byLanguage = new Map();
for (const record of published) {
  const code = record.language ?? 'und';
  if (!byLanguage.has(code)) byLanguage.set(code, []);
  byLanguage.get(code).push(record);
}

const bySource = new Map();
for (const record of published) {
  if (!bySource.has(record.source_id)) bySource.set(record.source_id, []);
  bySource.get(record.source_id).push(record);
}

// A fresh build so a name withdrawn from the data cannot linger as an orphaned page.
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.resolve(outputDirectory, 'resolver.css'), STYLESHEET, 'utf8');

const pages = [];

for (const [name, attestations] of byName) {
  pages.push(vernacularPage({ name, attestations, sourcesById, partsByTaxon }));
}

for (const [taxon, attestations] of byTaxon) {
  pages.push(
    taxonPage({
      taxon,
      attestations,
      plant: plantsByTaxon.get(taxon),
      sourcesById,
      partsByTaxon,
    }),
  );
}

for (const [code, attestations] of byLanguage) {
  pages.push(languagePage({ code, attestations }));
}

const publishedSources = [...bySource.keys()].map((id) => sourcesById.get(id));
for (const source of publishedSources) {
  pages.push(sourcePage({ source, attestations: bySource.get(source.id) }));
}

const excludedSources = sources.filter(
  (source) =>
    !bySource.has(source.id) &&
    !['taxonomy_only', 'practitioner_confirmed'].includes(source.ingestion_status),
);

pages.push(
  sourceIndexPage({
    sources: publishedSources,
    publishedCounts: new Map([...bySource].map(([id, rows]) => [id, rows.length])),
    excludedSources,
  }),
);

const hubNames = [...byName.entries()].map(([name, attestations]) => ({
  normalized_name: name,
  local_name: attestations[0].local_name,
  accepted_botanical: attestations[0].accepted_botanical,
  contested: unique(attestations.map((row) => row.accepted_botanical)).length > 1,
}));

const contestedCount = hubNames.filter((row) => row.contested).length;

pages.push(
  hubPage({
    names: hubNames,
    taxaCount: byTaxon.size,
    languageCounts: new Map(
      [...byLanguage].map(([code, rows]) => [
        code,
        new Set(rows.map((row) => row.normalized_name)).size,
      ]),
    ),
    sources: publishedSources,
    contestedCount,
  }),
);

for (const page of pages) {
  await writePage(page);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (page) => `  <url>
    <loc>${SITE}${page.url}</loc>
    <lastmod>${BUILT_ON}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${page.url === '/plants/' ? '0.9' : '0.6'}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
await writeFile(sitemapPath, sitemap, 'utf8');

const report = {
  built_at: BUILT_ON,
  pages_written: pages.length,
  vernacular_rows_considered: vernacularNames.length,
  vernacular_rows_published: published.length,
  unique_names_published: byName.size,
  taxa_published: byTaxon.size,
  contested_names_published: contestedCount,
  languages_published: Object.fromEntries(
    [...byLanguage].map(([code, rows]) => [code, rows.length]),
  ),
  sources_published: [...bySource.keys()],
  rows_withheld: Object.fromEntries(rejections),
  sources_withheld: excludedSources.map((source) => ({
    id: source.id,
    ingestion_status: source.ingestion_status,
    publication_status: source.publication_status,
  })),
  policy: {
    therapeutic_use_published: false,
    practitioner_confirmations_published: false,
    copyrighted_reference_material_published: false,
  },
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  `Resolver built: ${pages.length} pages — ${byName.size} local names (${contestedCount} contested), ` +
    `${byTaxon.size} taxa, ${publishedSources.length} sources.`,
);
for (const [reason, count] of [...rejections].sort((a, b) => b[1] - a[1])) {
  console.log(`  withheld ${String(count).padStart(4)} rows — ${reason}`);
}
console.log(`Report written to ${path.relative(repositoryDirectory, reportPath)}.`);

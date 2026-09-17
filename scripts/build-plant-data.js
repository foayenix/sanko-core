const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const plantsDirectory = path.join(root, 'data', 'plants');

function readJson(...segments) {
  return JSON.parse(fs.readFileSync(path.join(...segments), 'utf8'));
}

// Review evidence staged from copyrighted books is held locally, not committed:
// Iwu 2014 and Oliver-Bever 1986 carry no redistribution permission. It feeds two
// counts in the build report and nothing in the runtime index, so a clone without
// it must still build — otherwise the reproducibility check can only ever pass on
// the one machine holding the extracts.
function readJsonIfPresent(...segments) {
  const file = path.join(...segments);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(directory, filename, value) {
  fs.writeFileSync(path.join(directory, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeLocalName(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function stableId(prefix, ...values) {
  const readable = normalizeLocalName(values[0] ?? '').replace(/\s+/g, '-').slice(0, 48) || 'unknown';
  const hash = crypto.createHash('sha1').update(values.join('|')).digest('hex').slice(0, 10);
  return `${prefix}-${readable}-${hash}`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function loadIncludedSurveys(sources, plantsDir) {
  const included = new Set(
    sources
      .filter(source => source.publication_status === 'active' && source.ingestion_status === 'included')
      .map(source => source.id)
  );
  const directory = path.join(plantsDir, 'surveys');
  return fs.readdirSync(directory)
    .filter(filename => filename.endsWith('.json'))
    .sort()
    .flatMap(filename => readJson(directory, filename))
    .filter(row => included.has(row.source_id));
}

// The data directory is a parameter so a test can build against a copy. Tests
// run in parallel processes; a build that wrote the real files would race every
// other suite that reads the runtime index.
function build({ plantsDir = plantsDirectory, runtimeFile = path.join(root, 'data', 'plant_lookup_v1.json') } = {}) {
  const legacy = readJson(plantsDir, 'legacy_lookup_v1.json');
  const sources = readJson(plantsDir, 'sources.json');
  const survey = loadIncludedSurveys(sources, plantsDir);
  const combinedTaxonomyPath = path.join(plantsDir, 'taxonomy', 'gbif-primary.json');
  const taxonomy = fs.existsSync(combinedTaxonomyPath)
    ? readJson(combinedTaxonomyPath)
    : readJson(plantsDir, 'taxonomy', 'gbif-plateau.json');
  const humanReviews = readJson(plantsDir, 'human_reviews.json');
  const confirmations = readJson(plantsDir, 'practitioner_confirmations.json');
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const taxonomyByPublished = new Map(taxonomy.map(match => [match.botanical_as_published, match]));

  const plantByBotanical = new Map();
  const vernacularNames = [];
  const observations = [];
  const reviews = [];

  function ensurePlant(acceptedBotanical, commonEnglish, publishedBotanical, taxonomyMatch = null) {
    const key = acceptedBotanical.toLocaleLowerCase('en');
    let plant = plantByBotanical.get(key);
    if (!plant) {
      plant = {
        id: stableId('plant', acceptedBotanical),
        accepted_botanical: acceptedBotanical,
        common_english: [],
        botanical_names_as_published: [],
        taxonomy: null,
        verification_status: 'legacy_unverified'
      };
      plantByBotanical.set(key, plant);
    }

    plant.common_english = uniqueSorted([...plant.common_english, commonEnglish]);
    plant.botanical_names_as_published = uniqueSorted([...plant.botanical_names_as_published, publishedBotanical]);
    if (taxonomyMatch?.export_eligible) {
      plant.taxonomy = {
        source_id: taxonomyMatch.taxonomy_source_id,
        usage_key: taxonomyMatch.usage_key,
        accepted_usage_key: taxonomyMatch.accepted_usage_key,
        match_type: taxonomyMatch.match_type,
        confidence: taxonomyMatch.confidence,
        taxonomic_status: taxonomyMatch.taxonomic_status,
        checked_at: taxonomyMatch.checked_at
      };
      plant.verification_status = 'taxonomy_checked';
    }
    return plant;
  }

  const legacyGroups = new Map();
  for (const row of legacy) {
    if (!row.botanical) {
      const normalizedName = normalizeLocalName(row.local_name);
      vernacularNames.push({
        id: stableId('name', row.local_name, 'legacy-lookup-v1', 'unresolved'),
        plant_id: null,
        local_name: row.local_name,
        normalized_name: normalizedName,
        language: null,
        region: { country: 'Nigeria', state: null, localities: [] },
        botanical_as_published: null,
        accepted_botanical: null,
        source_id: 'legacy-lookup-v1',
        source_locator: null,
        verification_status: 'legacy_unverified',
        reviewed_by: null,
        export_eligible: false
      });
      observations.push({
        id: stableId('observation', normalizedName, 'legacy-lookup-v1'),
        plant_id: null,
        normalized_name: normalizedName,
        botanical_as_published: null,
        source_id: 'legacy-lookup-v1',
        source_locator: null,
        parts_reported: row.parts_commonly_used ?? [],
        preparations_reported: row.typical_preparations ?? [],
        traditional_use_reported: null,
        evidence_scope: 'legacy unresolved name; original evidence not retained'
      });
      continue;
    }

    const plant = ensurePlant(row.botanical, row.common_english, row.botanical);
    const normalizedName = normalizeLocalName(row.local_name);
    vernacularNames.push({
      id: stableId('name', row.local_name, 'legacy-lookup-v1', row.botanical),
      plant_id: plant.id,
      local_name: row.local_name,
      normalized_name: normalizedName,
      language: null,
      region: { country: 'Nigeria', state: null, localities: [] },
      botanical_as_published: row.botanical,
      accepted_botanical: row.botanical,
      source_id: 'legacy-lookup-v1',
      source_locator: null,
      verification_status: 'legacy_unverified',
      reviewed_by: null,
      export_eligible: true
    });

    const group = legacyGroups.get(plant.id) ?? {
      id: stableId('observation', plant.id, 'legacy-lookup-v1'),
      plant_id: plant.id,
      botanical_as_published: row.botanical,
      source_id: 'legacy-lookup-v1',
      source_locator: null,
      parts_reported: [],
      preparations_reported: [],
      traditional_use_reported: null,
      evidence_scope: 'legacy mapping; original evidence not retained'
    };
    group.parts_reported = uniqueSorted([...group.parts_reported, ...(row.parts_commonly_used ?? [])]);
    group.preparations_reported = uniqueSorted([...group.preparations_reported, ...(row.typical_preparations ?? [])]);
    legacyGroups.set(plant.id, group);
  }
  observations.push(...legacyGroups.values());

  for (const row of survey) {
    const source = sourceById.get(row.source_id);
    if (!source || source.publication_status !== 'active' || source.ingestion_status !== 'included') continue;

    const match = taxonomyByPublished.get(row.botanical_as_published);
    const acceptedBotanical = match?.export_eligible ? match.accepted_botanical : null;
    const plant = acceptedBotanical
      ? ensurePlant(acceptedBotanical, row.common_english_as_published, row.botanical_as_published, match)
      : null;
    const status = plant ? 'taxonomy_checked' : 'taxonomy_unresolved';

    for (const name of row.vernacular_names) {
      vernacularNames.push({
        id: stableId('name', name.local_name, row.source_id, row.botanical_as_published, name.language),
        plant_id: plant?.id ?? null,
        local_name: name.local_name,
        normalized_name: normalizeLocalName(name.local_name),
        language: name.language,
        region: source.location,
        botanical_as_published: row.botanical_as_published,
        accepted_botanical: acceptedBotanical,
        source_id: row.source_id,
        source_locator: { table: source.table, row: row.source_row },
        verification_status: status,
        reviewed_by: null,
        export_eligible: Boolean(plant)
      });
    }

    observations.push({
      id: stableId('observation', row.source_id, String(row.source_row), row.botanical_as_published),
      plant_id: plant?.id ?? null,
      botanical_as_published: row.botanical_as_published,
      source_id: row.source_id,
      source_locator: { table: source.table, row: row.source_row },
      parts_reported: row.parts_reported,
      preparations_reported: row.preparations_reported ?? [],
      voucher_specimen: row.voucher_specimen ?? null,
      traditional_use_reported: row.use_context,
      evidence_scope: 'ethnobotanical report; not clinical evidence'
    });

    if (plant) {
      reviews.push({
        id: stableId('review', plant.id, match.checked_at, match.usage_key),
        subject_type: 'plant_taxonomy',
        subject_id: plant.id,
        review_type: 'automated_taxonomy_match',
        reviewer: { type: 'service', name: 'GBIF Species API' },
        reviewed_at: match.checked_at,
        status: 'passed',
        details: {
          match_type: match.match_type,
          confidence: match.confidence,
          usage_key: match.usage_key,
          accepted_usage_key: match.accepted_usage_key
        }
      });
    }
  }

  // Practitioner confirmations — the return path for names the agent could not
  // place. A name flagged as unknown in a real conversation, confirmed by a
  // reviewer, re-enters the runtime index here so the next conversation gets it
  // right. This is the only source whose evidence is a practitioner's statement
  // rather than a publication, so it keeps its own verification status and its
  // own review record; it is never silently folded into survey provenance.
  for (const row of confirmations) {
    const match = taxonomyByPublished.get(row.botanical_as_published);
    const taxonomyResolved = Boolean(match?.export_eligible);
    const acceptedBotanical = taxonomyResolved ? match.accepted_botanical : row.botanical_as_published;
    const plant = ensurePlant(acceptedBotanical, row.common_english ?? null, row.botanical_as_published, match);
    // ensurePlant seeds new plants as legacy_unverified. A practitioner saying
    // so is better evidence than that, and weaker than a GBIF match — so name
    // it, and never downgrade a plant a taxonomy check already verified.
    if (!taxonomyResolved && plant.verification_status === 'legacy_unverified') {
      plant.verification_status = 'practitioner_confirmed';
    }
    const status = taxonomyResolved ? 'taxonomy_checked' : 'practitioner_confirmed';

    vernacularNames.push({
      id: stableId('name', row.local_name, 'practitioner-confirmation', row.botanical_as_published, row.language ?? ''),
      plant_id: plant.id,
      local_name: row.local_name,
      normalized_name: normalizeLocalName(row.local_name),
      language: row.language ?? null,
      region: row.region ?? { country: 'Nigeria', state: null, localities: [] },
      botanical_as_published: row.botanical_as_published,
      accepted_botanical: acceptedBotanical,
      source_id: 'practitioner-confirmation',
      source_locator: { confirmed_by: row.confirmed_by, confirmed_at: row.confirmed_at },
      verification_status: status,
      reviewed_by: row.confirmed_by,
      // Eligible on purpose: a confirmation that never reaches the runtime index
      // has not closed the loop it exists to close. Where it disagrees with a
      // published source the ambiguity pass below still wins, and the name drops
      // back to unresolved rather than one source silently overwriting another.
      export_eligible: true
    });

    observations.push({
      id: stableId('observation', 'practitioner-confirmation', row.local_name, row.botanical_as_published),
      plant_id: plant.id,
      normalized_name: normalizeLocalName(row.local_name),
      botanical_as_published: row.botanical_as_published,
      source_id: 'practitioner-confirmation',
      source_locator: { confirmed_by: row.confirmed_by, confirmed_at: row.confirmed_at },
      parts_reported: row.parts_reported ?? [],
      preparations_reported: row.preparations_reported ?? [],
      traditional_use_reported: null,
      evidence_scope: 'practitioner-confirmed vernacular name; use context not recorded'
    });

    reviews.push({
      id: stableId('review', 'practitioner-confirmation', row.local_name, row.botanical_as_published),
      subject_type: 'vernacular_name',
      subject_id: stableId('name', row.local_name, 'practitioner-confirmation', row.botanical_as_published, row.language ?? ''),
      review_type: 'practitioner_confirmation',
      reviewer: { type: 'practitioner', name: row.confirmed_by },
      reviewed_at: row.confirmed_at,
      status: 'passed',
      details: {
        local_name: row.local_name,
        botanical_as_published: row.botanical_as_published,
        taxonomy_resolved: taxonomyResolved,
        // How often the name was actually seen before it was confirmed. One
        // sighting is a guess worth checking; twenty is a gap in the index.
        occurrences: row.occurrences ?? null,
        notes: row.notes ?? null
      }
    });
  }

  reviews.push(...humanReviews);

  const namesByNormalized = new Map();
  for (const name of vernacularNames) {
    const values = namesByNormalized.get(name.normalized_name) ?? [];
    values.push(name);
    namesByNormalized.set(name.normalized_name, values);
  }

  const ambiguities = [];
  const runtime = [];
  for (const [normalizedName, names] of namesByNormalized) {
    const publishedCandidates = uniqueSorted(names.map(name => name.accepted_botanical ?? name.botanical_as_published));
    const eligible = names.filter(name => name.export_eligible);
    const acceptedCandidates = uniqueSorted(eligible.map(name => name.accepted_botanical));
    const plantIds = new Set(names.map(name => name.plant_id).filter(Boolean));
    const relevantObservations = observations.filter(observation =>
      (observation.plant_id && plantIds.has(observation.plant_id)) || observation.normalized_name === normalizedName
    );
    const parts = uniqueSorted(relevantObservations.flatMap(observation => observation.parts_reported));
    const preparations = uniqueSorted(relevantObservations.flatMap(observation => observation.preparations_reported));

    if (publishedCandidates.length > 1 || acceptedCandidates.length > 1) {
      ambiguities.push({
        normalized_name: normalizedName,
        source_spellings: uniqueSorted(names.map(name => name.local_name)),
        candidates: names.map(name => ({
          botanical_as_published: name.botanical_as_published,
          accepted_botanical: name.accepted_botanical,
          language: name.language,
          region: name.region,
          source_id: name.source_id,
          source_locator: name.source_locator,
          verification_status: name.verification_status
        }))
      });
      runtime.push({
        local_name: normalizedName,
        botanical: null,
        common_english: null,
        parts_commonly_used: parts,
        typical_preparations: preparations
      });
      continue;
    }

    if (acceptedCandidates.length !== 1) {
      if (names.some(name => name.source_id === 'legacy-lookup-v1')) {
        runtime.push({
          local_name: normalizedName,
          botanical: null,
          common_english: null,
          parts_commonly_used: parts,
          typical_preparations: preparations
        });
      }
      continue;
    }
    const botanical = acceptedCandidates[0];
    const plant = plantByBotanical.get(botanical.toLocaleLowerCase('en'));
    runtime.push({
      local_name: normalizedName,
      botanical,
      common_english: plant.common_english[0] ?? null,
      parts_commonly_used: parts,
      typical_preparations: preparations
    });
  }

  const plants = [...plantByBotanical.values()].sort((a, b) => a.accepted_botanical.localeCompare(b.accepted_botanical));
  vernacularNames.sort((a, b) => a.normalized_name.localeCompare(b.normalized_name) || a.source_id.localeCompare(b.source_id));
  observations.sort((a, b) => a.source_id.localeCompare(b.source_id) || String(a.source_locator?.row ?? '').localeCompare(String(b.source_locator?.row ?? ''), undefined, { numeric: true }));
  const uniqueReviews = [...new Map(reviews.map(review => [review.id, review])).values()];
  uniqueReviews.sort((a, b) => a.subject_id.localeCompare(b.subject_id));
  ambiguities.sort((a, b) => a.normalized_name.localeCompare(b.normalized_name));
  runtime.sort((a, b) => a.local_name.localeCompare(b.local_name));

  writeJson(plantsDir, 'plants.json', plants);
  writeJson(plantsDir, 'vernacular_names.json', vernacularNames);
  writeJson(plantsDir, 'observations.json', observations);
  writeJson(plantsDir, 'reviews.json', uniqueReviews);
  writeJson(plantsDir, 'ambiguities.json', ambiguities);
  fs.writeFileSync(runtimeFile, `${JSON.stringify(runtime, null, 2)}\n`);

  // Identifies the runtime index the agent loads, not the inputs that produced
  // it: two builds from different sources that yield the same index are the same
  // version as far as any record stamped with it is concerned.
  const buildId = `plants-${crypto.createHash('sha256').update(JSON.stringify(runtime)).digest('hex').slice(0, 8)}`;

  const report = {
    build_id: buildId,
    generated_at: uniqueSorted(taxonomy.map(match => match.checked_at)).at(-1) ?? null,
    legacy_runtime_rows: legacy.length,
    source_rows_ingested: survey.length,
    source_rows_by_source: Object.fromEntries(
      sources
        .filter(source => source.ingestion_status === 'included')
        .map(source => [source.id, survey.filter(row => row.source_id === source.id).length])
    ),
    staged_source_rows: {
      'weli-2013-port-harcourt': readJson(plantsDir, 'surveys', 'staged', 'weli-2013-port-harcourt.json').length,
      'mukaila-2021-ile-ife': readJson(plantsDir, 'surveys', 'quarantine', 'mukaila-2021-ile-ife-retracted.json').inventory.length,
      'anumudu-2025-nigeria-review-original-studies': readJson(plantsDir, 'surveys', 'discovery', 'anumudu-2025-nigeria-review.json').original_study_catalogue.length,
      'iwu-2014-african-medicinal-plants': readJsonIfPresent(plantsDir, 'references', 'staged', 'iwu-2014-african-medicinal-plants.json')?.records.length ?? null,
      'oliver-bever-1986-tropical-west-africa': readJsonIfPresent(plantsDir, 'references', 'staged', 'oliver-bever-1986-tropical-west-africa.json')?.structured_vernacular_mappings_extracted ?? null
    },
    practitioner_confirmations: confirmations.length,
    practitioner_confirmed_runtime_mappings: vernacularNames.filter(name => name.verification_status === 'practitioner_confirmed').length,
    taxonomy_matches_export_eligible: taxonomy.filter(match => match.export_eligible).length,
    rich_vernacular_records: vernacularNames.length,
    runtime_mappings: runtime.length,
    resolved_runtime_mappings: runtime.filter(row => row.botanical).length,
    ambiguous_runtime_names: runtime.filter(row => !row.botanical).length,
    staged_unresolved_names: vernacularNames.filter(name => !name.export_eligible).length
  };
  writeJson(plantsDir, 'build_report.json', report);
  console.log(report);
  return report;
}

if (require.main === module) build();

module.exports = { build, normalizeLocalName };

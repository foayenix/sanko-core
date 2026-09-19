// Source discovery (scripts/discover-sources.js) and the Wikidata candidate
// importer (scripts/import-wikidata-vernaculars.js).
//
// Both scripts are network-facing and both keep their network layer at the
// edge, so everything that decides anything — what a title is, where a study
// is, what a label is worth, what reaches a reviewer — is exercised here with
// no network at all.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  assemble,
  coverageWeights,
  fromCrossrefWork,
  inferRegion,
  redistributability,
  scanRegion,
  studyShape,
  titleSimilarity,
  toCandidate
} = require('../scripts/discover-sources');

const {
  buildCandidates,
  isUsableCandidate,
  seedQueue,
  toQueueEntry
} = require('../scripts/import-wikidata-vernaculars');

const { buildQueue, toConfirmation } = require('../scripts/plant-review');

// A Europe PMC core record, trimmed to the fields either script reads.
const record = (overrides = {}) => ({
  id: '40000000',
  source: 'MED',
  pmid: '40000000',
  pmcid: 'PMC9000001',
  doi: '10.1000/example',
  title: 'Ethnobotanical survey of medicinal plants in Enugu State, Nigeria',
  authorString: 'Okeke A, Bello B.',
  journalInfo: { journal: { title: 'Journal of Ethnobiology and Ethnomedicine' } },
  pubYear: '2024',
  abstractText: 'A survey conducted in south-eastern Nigeria.',
  license: 'cc by',
  isOpenAccess: 'Y',
  inEPMC: 'Y',
  hasPDF: 'Y',
  fullTextIdList: { fullTextId: ['PMC9000001'] },
  ...overrides
});

// The index as it stands: Yoruba well covered, Igbo barely, Hausa in between.
const vernacularNames = [
  ...Array.from({ length: 326 }, (_, index) => ({ normalized_name: `yo-${index}`, language: 'yo', verification_status: 'taxonomy_checked' })),
  ...Array.from({ length: 64 }, (_, index) => ({ normalized_name: `ha-${index}`, language: 'ha', verification_status: 'taxonomy_checked' })),
  ...Array.from({ length: 5 }, (_, index) => ({ normalized_name: `ig-${index}`, language: 'ig', verification_status: 'taxonomy_checked' })),
  // Unlabelled legacy rows must not read as coverage of any language.
  ...Array.from({ length: 152 }, (_, index) => ({ normalized_name: `legacy-${index}`, language: null, verification_status: 'legacy_unverified' }))
];

describe('reading a study from its title', () => {
  it('separates field surveys from laboratory work and from health-services research', () => {
    assert.equal(studyShape('Ethnobotanical Survey of Local Flora Used for Medicinal Purposes in Lagos State'), 'primary_survey');
    assert.equal(studyShape('Indigenous medicinal plants used in folk medicine for malaria treatment in Kwara State'), 'primary_survey');
    assert.equal(studyShape('Pharmacological Evaluation of Selected Medicinal Plants Used in the Management of Diabetes'), 'laboratory_or_review');
    assert.equal(studyShape('Nigerian medicinal plants with potential anticancer activity - a review'), 'laboratory_or_review');
    // The class that fools a keyword search: it says survey, and traditional
    // medicine, and publishes no plant table at all.
    assert.equal(studyShape('Traditional medicine usage among adult women in Ibadan, Nigeria: a cross-sectional study'), 'health_services');
    assert.equal(studyShape('Knowledge, attitude and use of herbal medicine among pregnant women attending antenatal clinic'), 'health_services');
  });

  it('lets an explicitly ethnobotanical study keep its status', () => {
    // "Prevalence" would otherwise read as health-services research.
    assert.equal(studyShape('Ethnobotanical survey and prevalence of antimalarial plants in Osun State'), 'unclear');
    assert.notEqual(studyShape('Ethnobotanical survey and prevalence of antimalarial plants in Osun State'), 'health_services');
  });

  it('matches titles on shared tokens, so a transcribed title still resolves', () => {
    const published = 'Ethnobotanical survey of anti-asthmatic plants in South Western Nigeria';
    assert.ok(titleSimilarity(published, `${published}.`) >= 0.99);
    assert.ok(titleSimilarity(published, 'Ethnobotanical survey of anti-asthmatic plants in South Western Nigeria: a field study') >= 0.8);
    assert.ok(titleSimilarity(published, 'Antimicrobial activity of Vernonia amygdalina leaf extracts') < 0.3);
  });
});

describe('locating a study in Nigeria', () => {
  it('does not read Niger State out of "Nigeria", and reads the Niger Delta as South-South', () => {
    assert.deepEqual(scanRegion('Medicinal plants of Nigeria').zones, []);
    assert.deepEqual(scanRegion('Herbal practice in the Niger Delta').zones, ['SS']);
    assert.deepEqual(scanRegion('Ethnobotany of Niger State').zones, ['NC']);
  });

  it('reads ethnonyms as well as states', () => {
    const region = scanRegion('Ethnoveterinary practices among Fulani pastoralists');
    assert.deepEqual(region.languages_named, ['ff']);
    assert.ok(region.zones.includes('NE'));
  });

  it('prefers the title, and says when it fell back to the abstract', () => {
    assert.equal(inferRegion('Ethnobotanical survey in Enugu State', 'Fieldwork in Lagos and Kano').evidence, 'title');
    assert.deepEqual(inferRegion('Ethnobotanical survey in Enugu State', 'Fieldwork in Lagos and Kano').zones, ['SE']);
    assert.equal(inferRegion('Medicinal plants of Nigeria', 'Interviews in Rivers State').evidence, 'abstract');
    assert.equal(inferRegion('Medicinal plants of the tropics', 'No place named').evidence, null);
  });
});

describe('what a source would cost to use', () => {
  it('separates an unrestricted CC BY from one with NC or ND terms', () => {
    assert.equal(redistributability({ license: 'cc by', isOpenAccess: 'Y' }), 'cc_by');
    assert.equal(redistributability({ license: 'cc by 4.0', isOpenAccess: 'Y' }), 'cc_by');
    assert.equal(redistributability({ license: 'cc by-nc-nd', isOpenAccess: 'Y' }), 'cc_restricted');
    assert.equal(redistributability({ license: null, isOpenAccess: 'Y' }), 'open_access_terms_unstated');
    assert.equal(redistributability({ license: null, isOpenAccess: 'N' }), 'not_open_access');
  });

  it('reads a Creative Commons URL out of a Crossref work', () => {
    const work = fromCrossrefWork({
      DOI: '10.1000/crossref',
      title: ['Ethnobotanical survey of Akwa Ibom State'],
      'container-title': ['Journal of Ethnopharmacology'],
      author: [{ family: 'Ajibesin', given: 'Kola' }],
      issued: { 'date-parts': [[2008]] },
      license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }],
      type: 'journal-article'
    });

    assert.equal(work.source, 'CROSSREF');
    assert.equal(work.license, 'cc by');
    assert.equal(work.pubYear, '2008');
    assert.equal(redistributability(work), 'cc_by');
    // No full text to fetch: Crossref resolves a citation, not a table.
    assert.equal(work.inEPMC, 'N');
  });
});

describe('ranking candidates by the gap they would close', () => {
  const coverage = coverageWeights(vernacularNames);

  it('weighs a language by how thin the index is in it, reading the index at run time', () => {
    assert.equal(coverage.weight('yo'), 0);
    assert.equal(coverage.weight('efi'), 1);
    assert.ok(coverage.weight('ig') > coverage.weight('ha'));
    assert.ok(coverage.weight('ha') > coverage.weight('yo'));
  });

  it('puts a South-East survey above an otherwise identical South-West one', () => {
    const southEast = toCandidate(record(), { coverage, identifiers: new Map() });
    const southWest = toCandidate(
      record({ title: 'Ethnobotanical survey of medicinal plants in Oyo State, Nigeria', doi: '10.1000/sw' }),
      { coverage, identifiers: new Map() }
    );

    assert.deepEqual(southEast.region.zones, ['SE']);
    assert.deepEqual(southWest.region.zones, ['SW']);
    assert.ok(southEast.priority_score > southWest.priority_score);
  });

  it('discounts a region that is only mentioned in the abstract', () => {
    const titled = toCandidate(record(), { coverage, identifiers: new Map() });
    const mentioned = toCandidate(
      record({ title: 'Ethnobotanical survey of medicinal plants in Nigeria', abstractText: 'Fieldwork in Enugu State.' }),
      { coverage, identifiers: new Map() }
    );

    assert.equal(mentioned.region.evidence, 'abstract');
    assert.ok(mentioned.priority_score < titled.priority_score);
  });

  it('marks down work that will not carry a name table, and preprints', () => {
    const survey = toCandidate(record(), { coverage, identifiers: new Map() });
    const laboratory = toCandidate(
      record({ title: 'Antimicrobial activity of Enugu State medicinal plant extracts', doi: '10.1000/lab' }),
      { coverage, identifiers: new Map() }
    );
    const preprint = toCandidate(
      record({ source: 'PPR', pmcid: null, fullTextIdList: { fullTextId: [] }, doi: '10.1000/ppr' }),
      { coverage, identifiers: new Map() }
    );

    assert.ok(laboratory.priority_score < survey.priority_score);
    assert.equal(preprint.is_preprint, true);
    assert.ok(preprint.priority_reasons.some(reason => reason.includes('preprint')));
    assert.match(preprint.next_action, /version of record/);
  });

  it('explains every score it gives', () => {
    const candidate = toCandidate(record(), { coverage, identifiers: new Map() });
    assert.ok(candidate.priority_reasons.length >= 3);
    assert.ok(candidate.priority_reasons.every(reason => /^[+-]\d+ /.test(reason)));
  });
});

describe('assembling the discovery file', () => {
  const sources = [
    { id: 'olanipekun-2022-lagos', doi: '10.3390/plants11050633', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8912796/' }
  ];
  const catalogue = [{ source_row: 1, title: 'Ethnobotanical survey of medicinal plants in Enugu State, Nigeria', nigerian_region_as_published: 'SE', plant_count_as_published: '40' }];

  function assembleWith(results, catalogueResolutions = []) {
    return assemble({
      searchResponses: [{ id: 'nigeria-titled', query: 'q', hit_count: results.length, results }],
      catalogueResolutions,
      sources,
      vernacularNames,
      catalogue
    });
  }

  it('flags a record already registered in sources.json instead of proposing it again', () => {
    const output = assembleWith([record({ doi: '10.3390/plants11050633', pmcid: 'PMC8912796' })]);

    assert.equal(output.summary.already_registered, 1);
    assert.equal(output.summary.new_candidates, 0);
    assert.equal(output.candidates[0].already_registered_as, 'olanipekun-2022-lagos');
  });

  it('marks a preprint and its published version as one study, keeping both rows', () => {
    const output = assembleWith([
      record(),
      record({ source: 'PPR', doi: '10.1000/preprint', pmcid: null, fullTextIdList: { fullTextId: [] } })
    ]);

    assert.equal(output.summary.duplicates, 1);
    assert.equal(output.summary.new_candidates, 1);
    const duplicate = output.candidates.find(candidate => candidate.duplicate_of);
    assert.ok(duplicate);
    assert.equal(duplicate.duplicate_of, output.candidates.find(candidate => !candidate.duplicate_of).candidate_id);
  });

  it('records how a catalogue title was resolved, and what to do when it was not', () => {
    const output = assembleWith([], [
      { catalogue_row: 1, title: catalogue[0].title, matched: record(), resolved_via: 'crossref', near_miss: null, attempts: [] },
      { catalogue_row: 2, title: 'A study in a journal neither index carries', matched: null, resolved_via: null, near_miss: null, attempts: [] }
    ]);

    assert.equal(output.summary.catalogue_resolved, 1);
    assert.deepEqual(output.summary.catalogue_resolved_via, { europepmc: 0, crossref: 1 });
    assert.equal(output.catalogue_unresolved.length, 1);
    assert.match(output.catalogue_unresolved[0].next_action, /AJOL/);
    // The catalogue's own published region outranks anything inferred.
    assert.equal(output.candidates[0].region.evidence, 'review_catalogue');
    assert.equal(output.candidates[0].catalogue_row, 1);
  });

  it('cannot produce anything the build would export', () => {
    const output = assembleWith([record(), record({ doi: '10.1000/other', title: 'Ethnobotany of Kano State, Nigeria' })]);

    assert.equal(output.runtime_export_eligible, false);
    assert.ok(output.candidates.every(candidate => candidate.runtime_export_eligible === false));
    assert.ok(output.candidates.every(candidate => !('vernacular_names' in candidate)));
  });
});

// ─── Wikidata candidates ──────────────────────────────────────────────────────

const plants = [
  { id: 'plant-cocos-nucifera-0001', accepted_botanical: 'Cocos nucifera', common_english: ['Coconut'], botanical_names_as_published: ['Cocos nucifera L.'] },
  { id: 'plant-artocarpus-altilis-0002', accepted_botanical: 'Artocarpus altilis', common_english: [], botanical_names_as_published: ['Artocarpus altilis (Parkinson) Fosberg'] }
];

const runtime = [
  { local_name: 'agbon', botanical: 'Cocos nucifera' },
  { local_name: 'ukwa', botanical: 'Treculia africana' },
  { local_name: 'ewuro', botanical: null }
];

const binding = (overrides = {}) => ({
  item: 'Q13187',
  taxon_name: 'Cocos nucifera',
  label: 'agbon',
  language: 'yo',
  ...overrides
});

describe('filtering Wikidata labels', () => {
  const plant = plants[0];

  it('throws away the botanical name wearing a local-language label', () => {
    const echoes = require('../scripts/import-wikidata-vernaculars').echoesFor(plant, ['coconut palm']);
    assert.equal(isUsableCandidate('Cocos nucifera', plant, echoes), false);
    assert.equal(isUsableCandidate('Cocos', plant, echoes), false);
    assert.equal(isUsableCandidate('Cocos nucifera var. typica', plant, echoes), false);
    assert.equal(isUsableCandidate('coconut palm', plant, echoes), false);
    assert.equal(isUsableCandidate('Coconut', plant, echoes), false);
    assert.equal(isUsableCandidate('agbon', plant, echoes), true);
  });
});

describe('Wikidata candidates against the index', () => {
  function build(bindings) {
    return buildCandidates(bindings, {
      plants,
      runtime,
      vernacularNames: [
        { normalized_name: 'agbon', verification_status: 'legacy_unverified' },
        { normalized_name: 'ewuro', verification_status: 'taxonomy_checked' }
      ],
      retrievedAt: '2026-09-12'
    });
  }

  it('says whether a label is new, corroborating, conflicting, or already ambiguous', () => {
    const { candidates } = build([
      binding(),
      binding({ label: 'ukwa', language: 'ig', taxon_name: 'Artocarpus altilis', item: 'Q13181' }),
      binding({ label: 'Ewuro', language: 'yo', taxon_name: 'Artocarpus altilis', item: 'Q13181' }),
      binding({ label: 'yabasị osisi', language: 'ig', taxon_name: 'Cocos nucifera' })
    ]);

    const byName = Object.fromEntries(candidates.map(candidate => [candidate.normalized_name, candidate]));
    assert.equal(byName.agbon.index_status, 'agrees_with_index');
    // The valuable one: the index says Treculia africana, Wikidata says Artocarpus.
    assert.equal(byName.ukwa.index_status, 'conflicts_with_index');
    assert.equal(byName.ewuro.index_status, 'ambiguous_in_index');
    assert.equal(byName['yabasi osisi'].index_status, 'new');
  });

  it('names what an agreement is worth by what the index already had', () => {
    const { candidates } = build([binding()]);
    assert.deepEqual(candidates[0].corroborates, ['legacy_unverified']);
    assert.equal(candidates[0].export_eligible, false);
    assert.equal(candidates[0].verification_status, 'unverified_candidate');
    assert.equal(candidates[0].source.licence, 'CC0-1.0');
  });

  it('flags a name that normalisation cannot fold to ASCII', () => {
    // ẹ, ọ, ụ and ì decompose and fold; ɓ, ɗ, ƴ and ŋ are letters in their own
    // right and survive. A practitioner typing "bowre" will not match "ɓowre",
    // and the row says so rather than leaving it to be discovered later.
    const { candidates } = build([
      binding({ label: 'Ɓowre', language: 'ff', taxon_name: 'Artocarpus altilis', item: 'Q47488' }),
      binding({ label: 'Èso ìbẹ́pẹ', language: 'yo', taxon_name: 'Artocarpus altilis', item: 'Q47489' })
    ]);

    const byBotanicalOrder = Object.fromEntries(candidates.map(candidate => [candidate.language, candidate]));
    assert.equal(byBotanicalOrder.ff.normalized_name, 'ɓowre');
    assert.equal(byBotanicalOrder.ff.ascii_after_normalisation, false);
    assert.equal(byBotanicalOrder.yo.normalized_name, 'eso ibepe');
    assert.equal(byBotanicalOrder.yo.ascii_after_normalisation, true);
  });

  it('drops labels for taxa the index does not hold, and repeated labels', () => {
    const { candidates, rejected } = build([
      binding({ taxon_name: 'Zea mays', label: 'agbado' }),
      binding(),
      binding({ item: 'Q999' })
    ]);

    assert.equal(rejected.unknown_taxon, 1);
    assert.equal(rejected.duplicate, 1);
    assert.equal(candidates.length, 1);
  });
});

describe('seeding the review queue with candidates', () => {
  const candidate = (overrides = {}) => ({
    local_name: 'Ɓowre',
    normalized_name: 'ɓowre',
    language: 'ff',
    accepted_botanical: 'Adansonia digitata',
    plant_id: 'plant-adansonia-digitata-0003',
    common_english: 'Baobab',
    index_status: 'new',
    source: { source_id: 'wikidata-vernacular-candidates', wikidata_item: 'Q47488', url: 'https://www.wikidata.org/wiki/Q47488', licence: 'CC0-1.0', retrieved_at: '2026-09-12' },
    ...overrides
  });

  it('queues only what the index does not already answer', () => {
    const { additions } = seedQueue([], [
      candidate(),
      candidate({ normalized_name: 'agbon', index_status: 'agrees_with_index' }),
      candidate({ normalized_name: 'ukwa', index_status: 'conflicts_with_index' })
    ]);

    assert.deepEqual(additions.map(entry => entry.normalized_name), ['ɓowre']);
  });

  it('never overwrites a name already in the queue', () => {
    const existing = [{ normalized_name: 'ɓowre', decision: 'rejected', spellings: ['bowre'], languages: [], occurrences: 4, contexts: [] }];
    const { queue, additions } = seedQueue(existing, [candidate()]);

    assert.equal(additions.length, 0);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].decision, 'rejected');
  });

  it('sorts a suggestion below every name a practitioner actually used', () => {
    const heard = { normalized_name: 'ewe ina', decision: 'pending', spellings: ['ewe ina'], languages: ['yo'], occurrences: 1, contexts: [] };
    const { queue } = seedQueue([heard], [candidate()]);

    assert.deepEqual(queue.map(entry => entry.normalized_name), ['ewe ina', 'ɓowre']);
    assert.equal(queue[1].occurrences, 0);
  });

  it('gives the reviewer the suggestion and its provenance, and still asks for a decision', () => {
    const entry = toQueueEntry(candidate());

    assert.equal(entry.decision, 'pending');
    assert.equal(entry.botanical_as_published, 'Adansonia digitata');
    assert.equal(entry.candidate_source.reference, 'Q47488');
    assert.equal(entry.candidate_source.licence, 'CC0-1.0');
    assert.match(entry.notes, /unverified/);
    assert.deepEqual(entry.contexts, []);
  });
});

describe('candidates inside the existing review loop', () => {
  const seeded = toQueueEntry({
    local_name: 'Ɓowre',
    normalized_name: 'ɓowre',
    language: 'ff',
    accepted_botanical: 'Adansonia digitata',
    common_english: 'Baobab',
    source: { source_id: 'wikidata-vernacular-candidates', wikidata_item: 'Q47488', url: 'https://www.wikidata.org/wiki/Q47488', licence: 'CC0-1.0', retrieved_at: '2026-09-12' }
  });

  const event = (name) => ({
    id: 'e-1',
    created_at: '2026-09-01T09:00:00Z',
    payload: { short_code: 'FM-00001', plants: [name] },
    formulation: { original_language: 'yo', original_text: 'Practitioner speech' }
  });

  it('survives a pull that knows nothing about it', () => {
    // Nothing in the event stream will ever re-create a seeded candidate, so a
    // pull that dropped it would silently undo the seeding run.
    const queue = buildQueue([event('ewe ina')], [seeded]);

    const kept = queue.find(entry => entry.normalized_name === 'ɓowre');
    assert.ok(kept);
    assert.equal(kept.botanical_as_published, 'Adansonia digitata');
    assert.equal(kept.candidate_source.reference, 'Q47488');
  });

  it('keeps its provenance when the name later turns up in real speech', () => {
    const queue = buildQueue([event('Ɓowre')], [seeded]);
    const entry = queue.find(item => item.normalized_name === 'ɓowre');

    assert.equal(entry.occurrences, 1);
    assert.equal(entry.candidate_source.reference, 'Q47488');
  });

  it('records in the confirmation that the name was suggested, not heard', () => {
    const confirmed = { ...seeded, decision: 'confirmed', occurrences: 0 };
    const record = toConfirmation(confirmed, 'PR-7F2A', '2026-09-12T00:00:00Z');

    assert.equal(record.botanical_as_published, 'Adansonia digitata');
    assert.equal(record.confirmed_by, 'PR-7F2A');
    assert.equal(record.candidate_source.source_id, 'wikidata-vernacular-candidates');
  });

  it('leaves a name Sanko actually heard with no candidate source', () => {
    const queue = buildQueue([event('ewe ina')]);
    const record = toConfirmation({ ...queue[0], botanical_as_published: 'Laportea aestuans' }, 'PR-7F2A', '2026-09-12T00:00:00Z');

    assert.equal(record.candidate_source, null);
  });
});

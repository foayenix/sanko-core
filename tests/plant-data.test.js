const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..');
const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(root, ...segments), 'utf8'));

describe('provenance-rich plant mapping data', () => {
  const sources = readJson('data', 'plants', 'sources.json');
  const names = readJson('data', 'plants', 'vernacular_names.json');
  const ambiguities = readJson('data', 'plants', 'ambiguities.json');
  const runtime = readJson('data', 'plant_lookup_v1.json');
  const report = readJson('data', 'plants', 'build_report.json');
  const portHarcourt = readJson('data', 'plants', 'surveys', 'weli-2013-port-harcourt.json');
  const ileIfe = readJson('data', 'plants', 'surveys', 'quarantine', 'mukaila-2021-ile-ife-retracted.json');
  const review = readJson('data', 'plants', 'surveys', 'discovery', 'anumudu-2025-nigeria-review.json');

  it('increases the runtime index while retaining the immutable legacy baseline', () => {
    assert.equal(report.legacy_runtime_rows, 152);
    assert.equal(runtime.length, report.runtime_mappings);
    assert.ok(runtime.length > report.legacy_runtime_rows);
    assert.equal(report.resolved_runtime_mappings, 1078);
    assert.deepEqual(report.source_rows_by_source, {
      'offiah-2011-plateau': 57,
      'olanipekun-2022-lagos': 183,
      'sonibare-2008-anti-asthmatic': 46,
      'weli-2013-port-harcourt': 84,
      'lawal-2020-ede-south': 87,
      'olatokunbo-2022-bayelsa': 39,
      'ajibesin-2012-rivers': 188,
      'evbuomwan-2023-kwara': 62,
      'anyanwu-2025-north-central': 70,
      'alhaji-2015-niger-fulani': 34
    });
  });

  it('adds voucher-backed Lagos mappings with exact table provenance', () => {
    const name = names.find(item => item.normalized_name === 'ominsinmisin' && item.source_id === 'olanipekun-2022-lagos');
    assert.ok(name);
    assert.equal(name.language, 'yo');
    assert.equal(name.region.state, 'Lagos');
    assert.deepEqual(name.source_locator, { table: 'Supplementary Table S1', row: 1 });
    assert.equal(name.botanical_as_published, 'Abrus precatorius L.');
    assert.equal(name.accepted_botanical, 'Abrus precatorius');
    assert.equal(name.verification_status, 'taxonomy_checked');
  });

  it('adds the southwestern anti-asthmatic table without turning its use into a clinical claim', () => {
    const name = names.find(item => item.normalized_name === 'ataile' && item.source_id === 'sonibare-2008-anti-asthmatic');
    assert.ok(name);
    assert.equal(name.language, 'yo');
    assert.deepEqual(name.source_locator, { table: 'Table 1', row: 46 });
    assert.equal(name.accepted_botanical, 'Zingiber officinale');
    assert.equal(runtime.find(row => row.local_name === 'ataile').botanical, 'Zingiber officinale');
  });

  it('adds the Ede South table with its parts and preparations but not its cough indication', () => {
    const name = names.find(item => item.normalized_name === 'agbaarin' && item.source_id === 'lawal-2020-ede-south');
    assert.ok(name);
    assert.equal(name.language, 'yo');
    assert.equal(name.region.state, 'Osun');
    assert.deepEqual(name.source_locator, { table: 'Table 2', row: 36 });
    assert.equal(name.botanical_as_published, 'Dioclea reflexa Hook.f.');
    assert.equal(name.accepted_botanical, 'Macropsychanthus comosus');
    assert.deepEqual(runtime.find(row => row.local_name === 'agbaarin'), {
      local_name: 'agbaarin',
      botanical: 'Macropsychanthus comosus',
      common_english: null,
      parts_commonly_used: ['seed'],
      typical_preparations: ['pounded']
    });
  });

  it('keeps entries that are not Yoruba names out of a Yoruba-labelled column', () => {
    const edeSouth = readJson('data', 'plants', 'surveys', 'lawal-2020-ede-south.json');
    const telfairia = edeSouth.find(row => row.botanical_as_published.startsWith('Telfairia occidentalis'));
    assert.equal(telfairia.vernacular_as_published, 'Eweroko, Ugu');
    assert.deepEqual(telfairia.vernacular_names, [{ local_name: 'Eweroko', language: 'yo' }]);
    assert.equal(names.some(name => name.source_id === 'lawal-2020-ede-south' && ['ugu', 'bamboo'].includes(name.normalized_name)), false);
  });

  it('lets a new source make a name ambiguous rather than overrule an older one', () => {
    const awopa = ambiguities.find(item => item.normalized_name === 'awopa');
    assert.deepEqual(
      [...new Set(awopa.candidates.map(candidate => candidate.source_id))].sort(),
      ['evbuomwan-2023-kwara', 'lawal-2020-ede-south', 'legacy-lookup-v1']
    );
    assert.equal(runtime.find(row => row.local_name === 'awopa').botanical, null);
  });

  it('stages the Ogbomosho table without exporting a name from it', () => {
    const staged = readJson('data', 'plants', 'surveys', 'staged', 'odebunmi-2022-ogbomosho.json');
    assert.equal(sources.find(source => source.id === 'odebunmi-2022-ogbomosho').ingestion_status, 'staged_review');
    assert.equal(staged.length, 86);
    assert.ok(staged.every(row => row.runtime_export_eligible === false));
    assert.equal(names.some(name => name.source_id === 'odebunmi-2022-ogbomosho'), false);
    assert.equal(Object.hasOwn(report.source_rows_by_source, 'odebunmi-2022-ogbomosho'), false);
  });

  it('includes the Kwara table with unlabelled names left as language not recorded', () => {
    // Owner's decision of 2026-11-18: a name the survey does not label keeps a null
    // language rather than one inferred from the state or the spelling.
    const kwara = readJson('data', 'plants', 'surveys', 'evbuomwan-2023-kwara.json');
    assert.equal(sources.find(source => source.id === 'evbuomwan-2023-kwara').ingestion_status, 'included');
    assert.equal(kwara.length, 62);
    assert.equal(kwara.filter(row => row.data_quality_flags.includes('language_not_stated_for_row')).length, 56);
    assert.deepEqual(kwara.find(row => row.source_row === 39).vernacular_names, [{ local_name: 'Gbere', language: 'nup' }]);

    const karandafi = names.find(name => name.normalized_name === 'karandafi');
    assert.equal(karandafi.source_id, 'evbuomwan-2023-kwara');
    assert.equal(karandafi.language, null);
    assert.equal(karandafi.accepted_botanical, 'Sorghum bicolor');
  });

  it('suggests Yoruba for the Kwara Orogbo without changing what the survey printed', () => {
    const orogbo = names.find(name => name.normalized_name === 'orogbo' && name.source_id === 'evbuomwan-2023-kwara');
    assert.equal(orogbo.language, null);
    assert.equal(orogbo.language_inference.language, 'yo');
    assert.equal(orogbo.language_inference.strength, 'multiple_sources');
    assert.equal(names.filter(name => name.language_inference?.language).length, 27);
  });

  it('keeps the Kwara nickname as published text, not as a name', () => {
    const kwara = readJson('data', 'plants', 'surveys', 'evbuomwan-2023-kwara.json');
    const row = kwara.find(entry => entry.vernacular_as_published === 'June 12');
    assert.deepEqual(row.vernacular_names, []);
    assert.ok(row.data_quality_flags.includes('nickname_rather_than_vernacular_name'));
    assert.equal(names.some(name => name.normalized_name === 'june 12'), false);
  });

  it('reads each North Central name with the language label printed after it', () => {
    const rows = readJson('data', 'plants', 'surveys', 'anyanwu-2025-north-central.json');
    assert.equal(rows.length, 70);
    assert.deepEqual(rows.find(row => row.source_row === 67).vernacular_names, [
      { local_name: 'Tyuna', language: 'tiv' },
      { local_name: 'Shuwaka', language: 'ha' },
      { local_name: 'Ewuro', language: 'yo' },
      { local_name: 'Onugbu', language: 'ig' }
    ]);
    // No comma between the two names; the labels still separate them.
    assert.deepEqual(rows.find(row => row.source_row === 37).vernacular_names, [
      { local_name: 'Cida goro', language: 'ha' },
      { local_name: 'Orogbo', language: 'yo' }
    ]);
    // The botanical name printed as a Hausa name, and unlabelled English, are kept as text only.
    assert.deepEqual(rows.find(row => row.source_row === 5).vernacular_names, [{ local_name: 'Ahon erin', language: 'yo' }]);
    assert.deepEqual(rows.find(row => row.source_row === 46).vernacular_names, []);
    assert.deepEqual(rows.find(row => row.source_row === 5).parts_reported, ['leaf']);

    const onugbu = names.find(name => name.normalized_name === 'onugbu' && name.source_id === 'anyanwu-2025-north-central');
    assert.equal(onugbu.accepted_botanical, 'Gymnanthemum amygdalinum'); // GBIF's accepted name for Vernonia amygdalina
    assert.equal(onugbu.language, 'ig');
  });

  it('reads the Fulani survey superscripts as Hausa, Fulfulde and Nupe', () => {
    const rows = readJson('data', 'plants', 'surveys', 'alhaji-2015-niger-fulani.json');
    assert.equal(rows.length, 34);
    assert.deepEqual(rows.find(row => row.source_row === 1).vernacular_names, [
      { local_name: 'Bagaruwa', language: 'ha' },
      { local_name: 'Gabdi', language: 'ff' },
      { local_name: 'Gabaruwa', language: 'nup' }
    ]);
    // Italic runs either side of a hyphen stay one name.
    assert.deepEqual(rows.find(row => row.source_row === 12).vernacular_names, [{ local_name: 'Edingi-bata', language: 'nup' }]);
    // The publisher repeated the botanical name in the local-name column.
    assert.deepEqual(rows.find(row => row.source_row === 14).vernacular_names, []);
    assert.ok(rows.every(row => row.parts_reported.length === 0), 'parts are prose in this table and are not claimed');
  });

  it('preserves provenance, language, region, and verification state for new names', () => {
    const dogonYaro = names.find(name => name.normalized_name === 'dogon yaro' && name.source_id === 'offiah-2011-plateau');
    assert.ok(dogonYaro);
    assert.equal(dogonYaro.language, 'ha');
    assert.equal(dogonYaro.region.country, 'Nigeria');
    assert.equal(dogonYaro.region.state, 'Plateau');
    assert.deepEqual(dogonYaro.source_locator, { table: 'Table 1', row: 7 });
    assert.equal(dogonYaro.accepted_botanical, 'Azadirachta indica');
    assert.equal(dogonYaro.verification_status, 'taxonomy_checked');
  });

  it('keeps unresolved source mappings staged with no accepted botanical', () => {
    // "Geranium spp" names a genus, not a species, so no correction can place it.
    const garahunu = names.find(name => name.normalized_name === 'garahunu' && name.source_id === 'offiah-2011-plateau');
    assert.ok(garahunu);
    assert.equal(garahunu.accepted_botanical, null);
    assert.equal(garahunu.export_eligible, false);
    assert.equal(runtime.some(row => row.local_name === 'garahunu'), false);
  });

  it('exports a published name that was withheld only for its spelling, with the correction on record', () => {
    // Acacia albida matched nothing exactly; the curated correction places it.
    const gawo = names.find(name => name.normalized_name === 'gawo' && name.source_id === 'offiah-2011-plateau');
    assert.equal(gawo.botanical_as_published, 'Acacia albida');
    assert.equal(gawo.accepted_botanical, 'Faidherbia albida');
    const corrections = readJson('data', 'plants', 'name_corrections.json');
    assert.equal(corrections.find(item => item.botanical_as_published === 'Acacia albida').status, 'corrected');
    assert.equal(runtime.find(row => row.local_name === 'gawo').botanical, 'Faidherbia albida');
  });

  it('excludes retracted sources from every vernacular mapping', () => {
    const retracted = sources.find(source => source.id === 'mukaila-2021-ile-ife');
    assert.equal(retracted.publication_status, 'retracted');
    assert.equal(retracted.ingestion_status, 'quarantined');
    assert.equal(names.some(name => name.source_id === retracted.id), false);
    assert.equal(ileIfe.inventory.length, 87);
    assert.equal(ileIfe.runtime_export_eligible, false);
  });

  it('includes the Port Harcourt table with its two adjudicated defects recorded in the rows', () => {
    const portSource = sources.find(source => source.id === 'weli-2013-port-harcourt');
    assert.equal(portSource.ingestion_status, 'included');
    assert.equal(portHarcourt.length, 84);
    assert.deepEqual(
      portHarcourt.filter(row => row.data_quality_flags.includes('unnumbered_source_row')).map(row => row.serial_as_published),
      [null]
    );
    assert.deepEqual(
      portHarcourt.filter(row => row.data_quality_flags.includes('common_and_botanical_columns_swapped_in_source')).map(row => row.serial_as_published),
      ['47', '48', '49']
    );
    const dongoyaro = names.find(name => name.normalized_name === 'dongoyaro' && name.source_id === portSource.id);
    assert.equal(dongoyaro.accepted_botanical, 'Azadirachta indica');
    assert.deepEqual(dongoyaro.source_locator, { table: 'Table 1', row: 48 });
  });

  it('retains review-only data outside production mappings', () => {
    const reviewSource = sources.find(source => source.id === 'anumudu-2025-nigeria-review');
    assert.equal(reviewSource.ingestion_status, 'discovery_only');
    assert.equal(review.original_study_catalogue.length, 79);
    assert.equal(names.some(name => name.source_id === reviewSource.id), false);
  });

  it('keeps copyrighted reference sources out of production without private extracts', () => {
    const ids = ['iwu-2014-african-medicinal-plants', 'oliver-bever-1986-tropical-west-africa'];
    assert.equal(sources.find(source => source.id === ids[0]).ingestion_status, 'staged_review');
    assert.equal(sources.find(source => source.id === ids[1]).ingestion_status, 'reference_only');
    for (const id of ids) {
      assert.equal(names.some(name => name.source_id === id), false);
      assert.equal(Object.hasOwn(report.source_rows_by_source, id), false);
    }
  });

  it('exports ambiguous local names with a null botanical', () => {
    assert.ok(ambiguities.some(item => item.normalized_name === 'kauchi'));
    assert.equal(runtime.find(row => row.local_name === 'kauchi').botanical, null);
  });

  it('keeps ethnobotanical use claims out of the runtime index', () => {
    for (const row of runtime) {
      assert.equal(Object.hasOwn(row, 'traditional_use_reported'), false);
      assert.equal(Object.hasOwn(row, 'condition'), false);
      assert.equal(Object.hasOwn(row, 'clinical_claim'), false);
    }
  });
});

describe('runtime plant lookup', () => {
  const { lookup } = require('../src/utils/plantLookup');

  it('finds a new source-backed Hausa mapping across punctuation variants', () => {
    assert.equal(lookup('Dogon-Yaro').botanical, 'Azadirachta indica');
  });

  it('does not resolve an ambiguous name to a species', () => {
    assert.equal(lookup('Kauchi').botanical, null);
  });

  it('handles non-string input safely', () => {
    assert.equal(lookup(null), null);
  });
});

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
  const portHarcourt = readJson('data', 'plants', 'surveys', 'staged', 'weli-2013-port-harcourt.json');
  const ileIfe = readJson('data', 'plants', 'surveys', 'quarantine', 'mukaila-2021-ile-ife-retracted.json');
  const review = readJson('data', 'plants', 'surveys', 'discovery', 'anumudu-2025-nigeria-review.json');

  it('increases the runtime index while retaining the immutable legacy baseline', () => {
    assert.equal(report.legacy_runtime_rows, 152);
    assert.equal(runtime.length, report.runtime_mappings);
    assert.ok(runtime.length > report.legacy_runtime_rows);
    assert.equal(report.resolved_runtime_mappings, 442);
    assert.deepEqual(report.source_rows_by_source, {
      'offiah-2011-plateau': 57,
      'olanipekun-2022-lagos': 183,
      'sonibare-2008-anti-asthmatic': 46
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
    const gawo = names.find(name => name.normalized_name === 'gawo' && name.source_id === 'offiah-2011-plateau');
    assert.ok(gawo);
    assert.equal(gawo.accepted_botanical, null);
    assert.equal(gawo.export_eligible, false);
    assert.equal(runtime.some(row => row.local_name === 'gawo'), false);
  });

  it('excludes retracted sources from every vernacular mapping', () => {
    const retracted = sources.find(source => source.id === 'mukaila-2021-ile-ife');
    assert.equal(retracted.publication_status, 'retracted');
    assert.equal(retracted.ingestion_status, 'quarantined');
    assert.equal(names.some(name => name.source_id === retracted.id), false);
    assert.equal(ileIfe.inventory.length, 87);
    assert.equal(ileIfe.runtime_export_eligible, false);
  });

  it('retains review-only and malformed publisher data outside production mappings', () => {
    const portSource = sources.find(source => source.id === 'weli-2013-port-harcourt');
    const reviewSource = sources.find(source => source.id === 'anumudu-2025-nigeria-review');
    assert.equal(portSource.ingestion_status, 'staged_review');
    assert.equal(reviewSource.ingestion_status, 'discovery_only');
    assert.equal(portHarcourt.length, 84);
    assert.equal(review.original_study_catalogue.length, 79);
    assert.ok(portHarcourt.some(row => row.data_quality_flags.includes('unnumbered_source_row')));
    assert.ok(portHarcourt.some(row => row.data_quality_flags.includes('common_and_botanical_columns_appear_swapped')));
    assert.equal(names.some(name => name.source_id === portSource.id), false);
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

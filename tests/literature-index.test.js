'use strict';
// The open plant literature index (docs/SANKO_EVIDENCE_ATLAS_SPEC.md, section 5).
// Network-facing code keeps its network layer at the edge; everything that
// decides anything is exercised here offline, against fixtures.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { classify, titleCountry } = require('../src/literature/classify');
const records = require('../src/literature/records');
const store = require('../src/literature/store');
const site = require('../src/literature/site');
const csv = require('../src/literature/csv');
const review = require('../scripts/literature-review');
const { select } = require('../scripts/literature-select-pilot');

const PLANT = {
  id: 'plant-vernonia-amygdalina-test',
  accepted_botanical: 'Vernonia amygdalina',
  common_english: ['Bitter leaf'],
  botanical_names_as_published: ['Vernonia amygdalina Del.', 'Gymnanthemum amygdalinum (Delile) Sch.Bip.'],
  taxonomy: { accepted_usage_key: '3129663' },
  verification_status: 'taxonomy_checked',
};

function epmc(overrides = {}) {
  return {
    id: '1001',
    source: 'MED',
    pmid: '1001',
    pmcid: 'PMC2002',
    doi: '10.1000/Example.1',
    title: 'Hepatoprotective effect of <i>Vernonia amygdalina</i> leaf extract in Wistar rats.',
    authorList: { author: [{ fullName: 'Okafor A' }, { fullName: 'Bello B' }] },
    pubYear: '2021',
    journalInfo: { journal: { title: 'Journal of Test Pharmacology' } },
    pubTypeList: { pubType: ['research-article', 'Journal Article'] },
    abstractText: 'ABSTRACT TEXT THAT MUST NEVER BE STORED',
    affiliation: 'Somewhere, Nigeria',
    ...overrides,
  };
}

function emptyStore() {
  return { directory: fs.mkdtempSync(path.join(os.tmpdir(), 'lit-')), searches: [], studies: [], entries: [], verifications: [] };
}

function addRecord(data, record, plant = PLANT) {
  const study = records.toStudy(record, { indexedAt: '2026-11-18' });
  const studyId = store.mergeStudy(data, study);
  const entry = records.toEntry(record, { ...study, study_id: studyId }, plant, { indexedAt: '2026-11-18' });
  store.mergeEntry(data, entry);
  return entry;
}

function includeEvent(entry, fields = {}) {
  return {
    event_id: `verify-${entry.entry_id}`,
    entry_id: entry.entry_id,
    reviewer: 'reviewer-a',
    verified_at: '2026-11-19',
    decision: 'include',
    exclusion_reason: null,
    fields: { voucher_reported: 'yes', ...fields },
    notes: null,
  };
}

describe('automated classification', () => {
  it('reads study kinds from title and publication type', () => {
    assert.equal(classify({ title: 'A randomized placebo-controlled trial of X in adults', mentionLocation: 'title' }).evidence_kind, 'human_interventional');
    assert.equal(classify({ title: 'X', pubTypes: ['Randomized Controlled Trial'], mentionLocation: 'title' }).evidence_kind, 'human_interventional');
    assert.equal(classify({ title: 'Effect of X on blood glucose in Wistar rats', mentionLocation: 'title' }).evidence_kind, 'animal');
    assert.equal(classify({ title: 'Antibacterial activity of X leaf extracts', mentionLocation: 'title' }).evidence_kind, 'in_vitro');
    assert.equal(classify({ title: 'Ethnobotanical survey of medicinal plants in Kwara', mentionLocation: 'title' }).evidence_kind, 'ethnobotanical_report');
    assert.equal(classify({ title: 'GC-MS profile of X seed oil', mentionLocation: 'title' }).evidence_kind, 'analytical_quality');
    assert.equal(classify({ title: 'A systematic review and meta-analysis of X', mentionLocation: 'title' }).evidence_kind, 'systematic_review');
  });

  it('screens out narrative reviews and notices but keeps systematic reviews', () => {
    const review = classify({ title: 'X: a review of its pharmacology', pubTypes: ['Review'], mentionLocation: 'title' });
    assert.equal(review.screening, 'exclude');
    assert.equal(review.exclusion_reason, 'no_original_data');
    const erratum = classify({ title: 'Erratum', pubTypes: ['Published Erratum'], mentionLocation: 'title' });
    assert.equal(erratum.exclusion_reason, 'not_research_publication');
    const systematic = classify({ title: 'X: a systematic review', pubTypes: ['Review'], mentionLocation: 'title' });
    assert.equal(systematic.screening, 'include');
  });

  it('flags safety studies and leaves abstract-only mentions uncertain', () => {
    const result = classify({ title: 'Subacute toxicity of X in rats', mentionLocation: 'title' });
    assert.equal(result.is_safety_study, true);
    assert.ok(result.area_studied.includes('toxicology'));
    assert.equal(classify({ title: 'Antimalarial activity in mice', mentionLocation: 'abstract' }).screening, 'uncertain');
  });

  it('says not_reported or null instead of guessing', () => {
    const result = classify({ title: 'Notes on X', mentionLocation: 'title' });
    assert.equal(result.evidence_kind, null);
    assert.equal(result.screening, 'uncertain');
    assert.deepEqual(result.plant_part, ['not_reported']);
  });

  it('reads countries from titles without confusing Niger with Nigeria', () => {
    assert.equal(titleCountry('Plants used in Nigeria'), 'NG');
    assert.equal(titleCountry('A Nigerian survey'), 'NG');
    assert.equal(titleCountry('Plants of Niger Republic'), 'NE');
    assert.equal(titleCountry('Effects in Guinea Pigs'), null);
  });
});

describe('records from Europe PMC', () => {
  it('builds search names from accepted and published binomials', () => {
    assert.equal(records.binomial('Abelmoschus esculentus (L.) Moench'), 'Abelmoschus esculentus');
    assert.equal(records.binomial('Grewia sp'), null);
    assert.deepEqual(records.searchNames(PLANT), ['Vernonia amygdalina', 'Gymnanthemum amygdalinum']);
  });

  it('keeps bibliographic fact and drops abstracts and affiliations', () => {
    const study = records.toStudy(epmc(), { indexedAt: '2026-11-18' });
    const text = JSON.stringify(study);
    assert.doesNotMatch(text, /ABSTRACT TEXT|affiliation|Somewhere/);
    assert.equal(study.title, 'Hepatoprotective effect of Vernonia amygdalina leaf extract in Wistar rats');
    assert.equal(study.doi, '10.1000/example.1');
    assert.equal(study.full_text_link, 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2002/');
    assert.equal(study.publication_type, 'peer_reviewed');
  });

  it('marks preprints and retractions', () => {
    assert.equal(records.toStudy(epmc({ source: 'PPR' }), { indexedAt: '2026-11-18' }).publication_type, 'preprint');
    const retracted = records.toStudy(epmc({ pubTypeList: { pubType: ['Retracted Publication'] } }), { indexedAt: '2026-11-18' });
    assert.equal(retracted.source_status, 'retracted');
  });

  it('records where the name was found and which name it was', () => {
    const data = emptyStore();
    const titled = addRecord(data, epmc());
    assert.equal(titled.mention_location, 'title');
    assert.equal(titled.name_resolution, 'exact');
    const synonym = addRecord(data, epmc({ id: '3', pmid: '3', pmcid: null, doi: null, title: 'Gymnanthemum amygdalinum leaves in mice' }));
    assert.equal(synonym.name_resolution, 'synonym');
    const abstractOnly = addRecord(data, epmc({ id: '4', pmid: '4', pmcid: null, doi: null, title: 'Antimalarial plants of Ghana' }));
    assert.equal(abstractOnly.name_resolution, 'pending');
    assert.equal(abstractOnly.botanical_name_as_published, null);
  });
});

describe('store', () => {
  it('deduplicates a study found by DOI, PMID or title', () => {
    const data = emptyStore();
    addRecord(data, epmc());
    addRecord(data, epmc({ id: '9', pmid: '1001', doi: null, pmcid: null }));
    addRecord(data, epmc({ id: '10', pmid: null, doi: null, pmcid: null }));
    assert.equal(data.studies.length, 1);
    assert.equal(data.entries.length, 1);
  });

  it('rejects any field outside the schema, so an abstract cannot be committed', () => {
    const data = emptyStore();
    addRecord(data, epmc());
    data.studies[0].abstract = 'text';
    assert.ok(store.validate(data).some(error => /unexpected field "abstract"/.test(error)));
  });

  it('lets the latest human verification override the automated fields', () => {
    const data = emptyStore();
    const entry = addRecord(data, epmc());
    data.verifications.push(includeEvent(entry, { evidence_kind: 'in_vitro' }));
    assert.deepEqual(store.validate(data), []);
    const [effective] = store.effectiveEntries(data);
    assert.equal(effective.verified, true);
    assert.equal(effective.evidence_kind, 'in_vitro');
    assert.equal(effective.classified_by, 'human');
  });

  it('refuses an include without a voucher answer or a resolved name', () => {
    const data = emptyStore();
    const entry = addRecord(data, epmc({ title: 'Antimalarial plants of Ghana' }));
    data.verifications.push({ ...includeEvent(entry), fields: {} });
    const errors = store.validate(data);
    assert.ok(errors.some(error => /voucher_reported/.test(error)));
    assert.ok(errors.some(error => /resolved name/.test(error)));
  });

  it('writes files that round-trip with stable ordering', () => {
    const data = emptyStore();
    addRecord(data, epmc({ id: '2', pmid: '2', doi: '10.1/b', pmcid: null, title: 'Second title about Vernonia amygdalina' }));
    addRecord(data, epmc());
    store.save(data);
    const first = fs.readFileSync(path.join(data.directory, 'studies.json'), 'utf8');
    store.save(store.load(data.directory));
    assert.equal(fs.readFileSync(path.join(data.directory, 'studies.json'), 'utf8'), first);
  });
});

describe('review workflow', () => {
  it('round-trips CSV with quotes, commas and newlines', () => {
    const header = ['a', 'b'];
    const text = csv.stringify(header, [{ a: 'x, "y"', b: 'line\nbreak' }]);
    assert.deepEqual(csv.parse(text), [{ a: 'x, "y"', b: 'line\nbreak' }]);
  });

  it('imports decided rows as events and skips undecided ones', () => {
    const data = emptyStore();
    const entry = addRecord(data, epmc());
    const rows = [
      { entry_id: entry.entry_id, decision: 'include', voucher_reported: 'not_stated', area_studied: 'hepatic; toxicology', is_safety_study: 'no' },
      { entry_id: entry.entry_id, decision: '' },
    ];
    const result = review.verify(data, rows, { reviewer: 'reviewer-a', date: '2026-11-19' });
    assert.equal(result.added, 1);
    const [event] = result.data.verifications;
    assert.deepEqual(event.fields, { is_safety_study: false, area_studied: ['hepatic', 'toxicology'], voucher_reported: 'not_stated' });
  });

  it('imports nothing when any row is invalid', () => {
    const data = emptyStore();
    const entry = addRecord(data, epmc());
    assert.throws(() => review.verify(data, [
      { entry_id: entry.entry_id, decision: 'include', voucher_reported: 'yes' },
      { entry_id: entry.entry_id, decision: 'include' },
    ], { reviewer: 'reviewer-a', date: '2026-11-19' }), /Nothing imported/);
    assert.equal(data.verifications.length, 0);
  });

  it('requires a pseudonymous reviewer id', () => {
    const data = emptyStore();
    assert.throws(() => review.verify(data, [], { reviewer: 'Dr Jane Doe', date: '2026-11-19' }), /pseudonymous/);
  });

  it('queues unverified entries with safety studies first', () => {
    const data = emptyStore();
    addRecord(data, epmc({ id: '2', pmid: '2', doi: '10.1/b', pmcid: null, title: 'Antibacterial activity of Vernonia amygdalina' }));
    addRecord(data, epmc({ title: 'Subacute toxicity of Vernonia amygdalina in rats' }));
    const rows = review.queueRows(data, new Set([PLANT.id]), new Map([[PLANT.id, PLANT.accepted_botanical]]));
    assert.match(rows[0].title, /toxicity/);
    assert.ok(review.HEADER.includes('voucher_reported'));
  });
});

describe('public site', () => {
  function model(data) {
    return site.buildModel({
      plants: [PLANT],
      vernacularNames: [{ plant_id: PLANT.id, local_name: 'Ewuro', language: 'yo', region: { state: 'Lagos' }, source_id: 'src-1', export_eligible: true }],
      sources: [{ id: 'src-1', title: 'A Lagos survey' }],
      data,
    });
  }

  it('lists only verified includes and shows every study type, including zeros', () => {
    const data = emptyStore();
    const verified = addRecord(data, epmc());
    addRecord(data, epmc({ id: '2', pmid: '2', doi: '10.1/b', pmcid: null, title: 'Unverified Vernonia amygdalina study in mice' }));
    data.verifications.push(includeEvent(verified, { evidence_kind: 'animal' }));
    const files = site.renderSite(model(data));
    const html = files['plants/vernonia-amygdalina.html'];
    assert.match(html, /Human trials<\/td><td class="n">0</);
    assert.match(html, /Animal studies<\/td><td class="n">1</);
    assert.match(html, /Hepatoprotective effect/);
    assert.doesNotMatch(html, /Unverified Vernonia amygdalina study/);
    assert.match(html, /1 further record found automatically is awaiting verification/);
    assert.match(html, /Most studies listed are laboratory or animal studies/);
    assert.match(html, /Preview build/);
    assert.match(html, /Ewuro/);
  });

  it('labels retracted studies and preprints', () => {
    const data = emptyStore();
    const entry = addRecord(data, epmc({ source: 'PPR', pubTypeList: { pubType: ['Retracted Publication'] } }));
    data.verifications.push(includeEvent(entry));
    const html = site.renderSite(model(data))['plants/vernonia-amygdalina.html'];
    assert.match(html, /Retracted/);
    assert.match(html, /Preprint — not peer reviewed/);
  });

  it('refuses benefit framing in Sanko wording but not in study titles', () => {
    assert.deepEqual(site.prohibitedPhrases('<p>Plant X <b>benefits</b></p>'), ['\\bbenefits?\\b']);
    assert.deepEqual(site.prohibitedPhrases('<span class="study-title">Health benefits of X</span>'), []);
    assert.deepEqual(site.prohibitedPhrases('<td><span class="cited">Plants used for orthopaedic care</span></td><i class="cited">Benefits Journal</i>'), []);
  });

  it('requires a corrections route for a release build', () => {
    const data = emptyStore();
    addRecord(data, epmc());
    assert.throws(() => site.renderSite(model(data), { release: true }), /corrections route/);
    const files = site.renderSite(model(data), { release: true, correctionsUrl: 'mailto:corrections@example.org' });
    assert.doesNotMatch(files['index.html'], /Preview build/);
  });

  it('is deterministic and publishes no abstract or private fields', () => {
    const data = emptyStore();
    const entry = addRecord(data, epmc());
    data.verifications.push(includeEvent(entry));
    const first = site.renderSite(model(data));
    const second = site.renderSite(model(data));
    assert.deepEqual(first, second);
    assert.doesNotMatch(first['data/atlas.json'], /ABSTRACT|abstract|affiliation|reviewer-a/);
  });
});

describe('pilot selection', () => {
  function plant(id, name) {
    return { id, accepted_botanical: name, botanical_names_as_published: [name], verification_status: 'taxonomy_checked' };
  }

  function countSearches(plants, hits) {
    return plants.flatMap(item => Object.entries(records.countQueries(item)).map(([type, query]) => ({
      search_id: `${item.id}-${type}`, kind: 'count', taxon_id: item.id, provider: 'europepmc', query,
      executed_at: '2026-11-18', hit_count: hits[item.id][type], retrieved: 0, error: null,
    })));
  }

  it('applies the volume cap, reports what it excluded, and is deterministic', () => {
    const plants = Array.from({ length: 30 }, (_, index) => plant(`p${String(index).padStart(2, '0')}`, `Genus species${index}`));
    const hits = Object.fromEntries(plants.map((item, index) => [item.id, { total: 20 + index * 40, human: index % 5, safety: index % 7 }]));
    // Every plant has four Nigerian sources except p05, which has one.
    const observations = plants.flatMap((item, index) => (index === 5 ? [0] : [0, 1, 2, 3 + (index % 4)])
      .map(source => ({ plant_id: item.id, source_id: `s${source}` })));
    const ambiguities = [{ candidates: [{ accepted_botanical: plants[1].accepted_botanical }, { accepted_botanical: plants[2].accepted_botanical }] }];
    const input = { plants, observations, ambiguities, searches: countSearches(plants, hits), cap: 900 };
    const result = select(input);
    assert.deepEqual(select(input), result);
    assert.ok(result.selected.every(pick => pick.total_hits <= 900));
    assert.ok(result.excluded_by_cap.length > 0);
    assert.equal(result.selected.filter(pick => pick.slot === 'identity').length, 2);
    assert.equal(new Set(result.selected.map(pick => pick.taxon_id)).size, result.selected.length);
    assert.ok(!result.selected.some(pick => pick.slot === 'score' && pick.use_breadth < 3), 'score slots need three Nigerian sources');
  });
});

describe('reviewer calibration', () => {
  const calibration = require('../src/literature/calibration');

  function seeded() {
    const data = emptyStore();
    const titles = [
      'Subacute toxicity of Vernonia amygdalina in rats',
      'A randomized trial of Vernonia amygdalina in adults',
      'Antibacterial activity of Vernonia amygdalina leaves',
      'Vernonia amygdalina leaf extract in diabetic Wistar rats',
      'GC-MS profile of Vernonia amygdalina',
    ];
    titles.forEach((title, index) => addRecord(data, epmc({ id: `${index}`, pmid: `${index}`, doi: `10.1/${index}`, pmcid: null, title })));
    return data;
  }

  it('scopes the review queue to safety and human studies by default', () => {
    const data = seeded();
    const ids = new Set([PLANT.id]);
    const names = new Map([[PLANT.id, PLANT.accepted_botanical]]);
    const priority = review.queueRows(data, ids, names);
    assert.deepEqual(priority.map(row => row.title).sort(), [
      'A randomized trial of Vernonia amygdalina in adults',
      'Subacute toxicity of Vernonia amygdalina in rats',
    ]);
    assert.equal(review.queueRows(data, ids, names, { scope: 'all' }).length, 5);
    assert.throws(() => review.queueRows(data, ids, names, { scope: 'some' }), /--scope/);
  });

  it('draws a deterministic, stratified sample', () => {
    const entries = store.effectiveEntries(seeded());
    const first = calibration.drawSample(entries, { size: 4, seed: 'test-seed' });
    assert.deepEqual(calibration.drawSample(entries, { size: 4, seed: 'test-seed' }), first);
    assert.equal(first.filter(item => item.stratum === 'priority').length, 2);
    assert.equal(first.filter(item => item.stratum === 'other').length, 2);
    assert.ok(first.every(item => item.stratum === (calibration.isPriority(item.entry) ? 'priority' : 'other')));
  });

  it('computes agreement, kappa, automated accuracy and priority-scope misses', () => {
    assert.equal(calibration.kappa([['a', 'a'], ['b', 'b']]), 1);
    assert.equal(calibration.kappa([['a', 'a'], ['a', 'a']]), null);
    const entries = store.effectiveEntries(seeded());
    const sample = calibration.drawSample(entries, { size: 5, seed: 'test-seed' });
    const other = sample.find(item => item.stratum === 'other').entry;
    const row = (entry, overrides = {}) => ({
      entry_id: entry.entry_id, decision: 'include', evidence_kind: entry.evidence_kind ?? 'in_vitro',
      is_safety_study: entry.is_safety_study ? 'yes' : 'no', voucher_reported: 'yes', model: 'rat',
      plant_part: 'leaf', area_studied: 'other', name_resolution: 'exact', minutes_spent: '3', ...overrides,
    });
    const rowsA = sample.map(({ entry }) => row(entry));
    // Reviewer B finds that one non-priority study is really a safety study.
    const rowsB = sample.map(({ entry }) => row(entry, entry === other ? { is_safety_study: 'yes' } : { minutes_spent: '5' }));
    const report = calibration.compare({ rowsA, rowsB, sample, reviewerA: 'rev-a', reviewerB: 'rev-b' });
    assert.equal(report.decided_by_both, 5);
    assert.equal(report.inter_reviewer.decision.agreement, 1);
    assert.equal(report.inter_reviewer.is_safety_study.agreement, 0.8);
    assert.equal(report.priority_scope_misses.found_safety_or_human, 1);
    assert.deepEqual(report.priority_scope_misses.entry_ids, [other.entry_id]);
    assert.deepEqual(report.disagreements.map(item => item.field), ['is_safety_study']);
    assert.equal(report.median_minutes_per_entry['rev-a'], 3);
  });

  it('refuses incomplete blind sheets and rows outside the sample', () => {
    const data = seeded();
    const sample = calibration.drawSample(store.effectiveEntries(data), { size: 2, seed: 'test-seed' });
    const manifest = { seed: 'test-seed', entries: sample.map(({ entry, stratum }) => ({ entry_id: entry.entry_id, stratum })) };
    const incomplete = [{ entry_id: sample[0].entry.entry_id, decision: 'include', evidence_kind: 'animal' }];
    assert.throws(() => review.calibrationReport({ data, manifest, rowsA: incomplete, rowsB: [], reviewerA: 'a1', reviewerB: 'b1' }), /missing is_safety_study/);
    const stranger = [{ entry_id: 'entry-not-in-sample', decision: 'exclude', exclusion_reason: 'wrong_taxon' }];
    assert.throws(() => review.calibrationReport({ data, manifest, rowsA: stranger, rowsB: [], reviewerA: 'a1', reviewerB: 'b1' }), /not in sample/);
  });

  it('gives the blind calibration sheet no automated guesses', () => {
    assert.ok(!review.CALIBRATION_HEADER.some(column => column.startsWith('auto_')));
    assert.ok(review.CALIBRATION_HEADER.includes('minutes_spent'));
    assert.match(review.allowedValues(), /voucher_reported,yes; no; not_stated/);
  });
});

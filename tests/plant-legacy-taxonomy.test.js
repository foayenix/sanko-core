// Nomenclature for the legacy tier (scripts/resolve-legacy-taxonomy.js).
//
// The change this covers is a distinction, not a feature: what a plant is
// called today is a question GBIF answers whatever a row's provenance, and it
// is a different question from whether a practitioner ever called it that. The
// first is now answered for the legacy tier; the second is still unanswered,
// and the tests below are mostly there to make sure it stays unanswered.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { build } = require('../scripts/build-plant-data');

const root = path.join(__dirname, '..');
const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(root, ...segments), 'utf8'));

describe('the legacy taxonomy cache', () => {
  const legacy = readJson('data', 'plants', 'legacy_lookup_v1.json');
  const cache = readJson('data', 'plants', 'taxonomy', 'gbif-legacy.json');

  it('covers every botanical name the legacy tier uses', () => {
    const published = new Set(legacy.map(row => row.botanical).filter(Boolean));
    const checked = new Set(cache.map(entry => entry.botanical_as_published));
    assert.equal(checked.size, published.size);
    for (const name of published) assert.ok(checked.has(name), `${name} was never checked`);
  });

  it('holds an accepted name for everything it marks exportable', () => {
    for (const entry of cache.filter(item => item.export_eligible)) {
      assert.ok(entry.accepted_botanical, entry.botanical_as_published);
      assert.equal(entry.match_type, 'EXACT');
      assert.ok(entry.confidence >= 90);
      assert.ok(['ACCEPTED', 'SYNONYM'].includes(entry.taxonomic_status));
    }
  });

  it('withholds the rename that would move a Nigerian plant to New Zealand', () => {
    // GBIF holds one usage of "Loranthus micranthus" — Hook.f.'s, a New
    // Zealand mistletoe. The African plant the legacy row means is Linn.f.'s,
    // which the backbone does not carry under that name, so no homonym check
    // catches it. Zero Nigerian occurrences is what gives it away.
    const entry = cache.find(item => item.botanical_as_published === 'Loranthus micranthus');

    assert.equal(entry.accepted_botanical, 'Ileostylus micranthus');
    assert.equal(entry.export_eligible, false);
    assert.equal(entry.nigeria_occurrences, 0);
    assert.match(entry.withheld_reason, /not recorded in Nigeria/);
  });

  it('only ever checks occurrences to withhold a rename, never to make a claim', () => {
    // A count of zero does not prove absence: GBIF's coverage of West African
    // plants is thin. Every entry that survives the check has a real count.
    for (const entry of cache.filter(item => item.export_eligible && item.accepted_botanical !== item.botanical_as_published)) {
      assert.ok(entry.nigeria_occurrences > 0, `${entry.botanical_as_published} was renamed on no occurrence evidence`);
    }
  });
});

describe('what the build does with it', () => {
  // Against a copy, because these suites run in parallel and a build that
  // wrote the real files would race every other one that reads them.
  function buildWith({ legacyTaxonomy = true } = {}) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sanko-legacy-'));
    const plantsDir = path.join(workspace, 'plants');
    const runtimeFile = path.join(workspace, 'plant_lookup_v1.json');
    try {
      fs.cpSync(path.join(root, 'data', 'plants'), plantsDir, { recursive: true });
      if (!legacyTaxonomy) fs.rmSync(path.join(plantsDir, 'taxonomy', 'gbif-legacy.json'));
      build({ plantsDir, runtimeFile });
      return {
        runtime: JSON.parse(fs.readFileSync(runtimeFile, 'utf8')),
        names: JSON.parse(fs.readFileSync(path.join(plantsDir, 'vernacular_names.json'), 'utf8')),
        plants: JSON.parse(fs.readFileSync(path.join(plantsDir, 'plants.json'), 'utf8'))
      };
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  const withCache = buildWith();
  const withoutCache = buildWith({ legacyTaxonomy: false });

  it('stops a legacy name and a survey name for one plant reading as two', () => {
    // ewuro: the legacy row says Vernonia amygdalina, Lagos and Port Harcourt
    // say the same plant under its accepted name. Nobody disagrees.
    assert.equal(withoutCache.runtime.find(row => row.local_name === 'ewuro').botanical, null);
    assert.equal(withCache.runtime.find(row => row.local_name === 'ewuro').botanical, 'Gymnanthemum amygdalinum');
  });

  it('resolves more names than it did, and withholds none it used to answer', () => {
    const before = new Map(withoutCache.runtime.map(row => [row.local_name, row.botanical]));
    const after = new Map(withCache.runtime.map(row => [row.local_name, row.botanical]));
    const lost = [...before].filter(([name, botanical]) => botanical && after.get(name) === null);

    assert.deepEqual(lost, []);
    assert.ok([...after.values()].filter(Boolean).length > [...before.values()].filter(Boolean).length);
  });

  it('leaves the legacy mapping as unverified as it always was', () => {
    // The whole point: the name is resolved, the claim is not.
    const ewuro = withCache.names.find(name => name.normalized_name === 'ewuro' && name.source_id === 'legacy-lookup-v1');

    assert.equal(ewuro.accepted_botanical, 'Gymnanthemum amygdalinum');
    assert.equal(ewuro.botanical_as_published, 'Vernonia amygdalina');
    assert.equal(ewuro.verification_status, 'legacy_unverified');
    assert.equal(ewuro.reviewed_by, null);
  });

  it('lets the taxon be checked while the claim about it is not', () => {
    const ewuro = withCache.names.find(name => name.normalized_name === 'ewuro' && name.source_id === 'legacy-lookup-v1');
    const plant = withCache.plants.find(item => item.id === ewuro.plant_id);

    // plants.json describes a taxon, which GBIF can vouch for.
    assert.equal(plant.verification_status, 'taxonomy_checked');
    assert.ok(plant.taxonomy.usage_key);
    // The vernacular row describes a claim about a name, which it cannot.
    assert.equal(ewuro.verification_status, 'legacy_unverified');
  });

  it('keeps the published name where the rename was withheld', () => {
    const afomo = withCache.names.find(name => name.normalized_name === 'afomo' && name.source_id === 'legacy-lookup-v1');

    assert.equal(afomo.botanical_as_published, 'Loranthus micranthus');
    assert.equal(afomo.accepted_botanical, 'Loranthus micranthus');
  });

  it('is corroborated by the survey that names the same plant', () => {
    // afomo was contested before this change and still is: the Lagos survey
    // maps it to Tapinanthus globiferus, an African mistletoe. That is what
    // the legacy row meant, and it is the outside evidence that renaming it
    // to a New Zealand mistletoe would have been wrong.
    const candidates = withCache.names
      .filter(name => name.normalized_name === 'afomo')
      .map(name => name.accepted_botanical)
      .sort();

    // The Ede South survey adds a third reading, Crudia klainei, which keeps
    // the name contested and changes nothing about the point made here.
    assert.deepEqual(candidates, ['Crudia klainei', 'Loranthus micranthus', 'Tapinanthus globiferus']);
    assert.equal(withCache.runtime.find(row => row.local_name === 'afomo').botanical, null);
  });

  it('builds without the cache at all, exactly as it used to', () => {
    assert.ok(withoutCache.runtime.length > 0);
    const ewuro = withoutCache.names.find(name => name.normalized_name === 'ewuro' && name.source_id === 'legacy-lookup-v1');
    assert.equal(ewuro.accepted_botanical, 'Vernonia amygdalina');
  });
});

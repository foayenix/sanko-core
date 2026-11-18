// Evidence reference staging (scripts/stage-evidence-references.js): ANPDB and
// ANSES are reference_only sources. They point evidence analysts at chemistry
// and regulatory safety wording; they never produce a vernacular mapping.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ANPDB, ANSES, ansesNames, binomial, buildOverlap, main, parseCsv, statementPresent } = require('../scripts/stage-evidence-references');

const root = path.join(__dirname, '..');
const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(root, ...segments), 'utf8'));

describe('evidence reference staging', () => {
  it('reduces names to a binomial and refuses genus-only names', () => {
    assert.equal(binomial('Abelmoschus esculentus (L.)'), 'abelmoschus esculentus');
    assert.equal(binomial('Mentha × piperita L.'), 'mentha x piperita');
    assert.equal(binomial('Mentha x piperita'), 'mentha x piperita');
    assert.equal(binomial('Grewia sp'), null);
    assert.equal(binomial('Geranium spp.'), null);
    assert.equal(binomial('Allium'), null);
    assert.deepEqual(ansesNames('Actaea racemosa L. (syn. Cimicifuga racemosa (L.) Nutt.)'), ['actaea racemosa', 'cimicifuga racemosa']);
  });

  it('parses quoted CSV fields with commas, quotes and newlines', () => {
    const rows = parseCsv('\uFEFFspecies_id,source_species,species_known_use\n1,"Ruellia tuberosa","diuretic, ""antidote""\nline two"\r\n2,Bidens pilosa,\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].species_id, '1');
    assert.equal(rows[0].species_known_use, 'diuretic, "antidote"\nline two');
    assert.equal(rows[1].source_species, 'Bidens pilosa');
  });

  it('treats ANSES "-" as no statement reported, not as absence of risk', () => {
    assert.equal(statementPresent('-'), false);
    assert.equal(statementPresent(' '), false);
    assert.equal(statementPresent('Éviter chez la femme enceinte'), true);
  });

  it('matches through as-published names and synonyms, and drops uncited prose and statement text', () => {
    const plants = [
      { id: 'p1', accepted_botanical: 'Kalanchoe pinnata', botanical_names_as_published: ['Bryophyllum pinnatum (Lam.) Oken'] },
      { id: 'p2', accepted_botanical: 'Actaea racemosa', botanical_names_as_published: [] },
      { id: 'p3', accepted_botanical: 'Vernonia amygdalina', botanical_names_as_published: [] }
    ];
    const { taxa, summary } = buildOverlap({
      plants,
      runtime: [{ local_name: 'abamoda', botanical: 'Kalanchoe pinnata' }],
      anpdbRows: [{
        species_id: '7', source_species: 'Bryophyllum pinnatum', species_most_recent_name: 'Kalanchoe pinnata',
        species_known_use: 'uncited folklore', ncbi_taxonomy_id: '4316', molecule_ids: 'ANP_1 | ANP_2 | ANP_1', Reference_link: 'doi.org/a | doi.org/a | doi.org/b'
      }],
      ansesRows: [{
        id: 'anses_x', source_sheet: 'Recos EMA synthèse', source_row: 12, scientific_name: 'Actaea racemosa L. (syn. Cimicifuga racemosa (L.) Nutt.)', plant_part: 'Rhizome',
        source_data: { contraindications_text_fr: 'texte', interactions_text_fr: '-', pregnant_restriction_text_fr: 'texte', pediatric_restriction_text_fr: '' }
      }]
    });
    assert.deepEqual(taxa.map(taxon => taxon.plant_id), ['p2', 'p1']);
    const kalanchoe = taxa.find(taxon => taxon.plant_id === 'p1');
    assert.equal(kalanchoe.in_runtime_index, true);
    assert.equal(kalanchoe.anpdb[0].molecule_count, 2);
    assert.deepEqual(kalanchoe.anpdb[0].references, ['doi.org/a', 'doi.org/b']);
    assert.equal(JSON.stringify(taxa).includes('uncited folklore'), false);
    assert.equal(JSON.stringify(taxa).includes('texte'), false);
    assert.deepEqual(taxa.find(taxon => taxon.plant_id === 'p2').anses[0].statements_present,
      { contraindication: true, interaction: false, pregnancy_lactation: true, paediatric: false });
    assert.equal(summary.taxa_with_any_reference, 2);
    assert.equal(summary.runtime_taxa_in_anses, 0);
  });

  it('writes nothing on --dry-run and uses injected inputs without network', async () => {
    const before = fs.readFileSync(path.join(root, 'data', 'plants', 'surveys', 'discovery', 'evidence-reference-overlap.json'), 'utf8');
    const fetched = [];
    const fetcher = async url => {
      fetched.push(url);
      return url === ANPDB.url ? 'species_id,source_species,species_most_recent_name\n1,Allium sativum,Allium sativum\n' : '';
    };
    const output = await main(['--dry-run'], { fetcher, now: () => new Date('2026-11-18T00:00:00Z') });
    assert.deepEqual(fetched, [ANPDB.url, ANSES.extraction.url]);
    assert.equal(output.runtime_export_eligible, false);
    assert.equal(output.inputs.anses.primary_checksum_verified, false);
    assert.equal(fs.readFileSync(path.join(root, 'data', 'plants', 'surveys', 'discovery', 'evidence-reference-overlap.json'), 'utf8'), before);
  });
});

describe('committed evidence references', () => {
  const sources = readJson('data', 'plants', 'sources.json');
  const overlap = readJson('data', 'plants', 'surveys', 'discovery', 'evidence-reference-overlap.json');
  const names = readJson('data', 'plants', 'vernacular_names.json');

  it('registers both sources as reference_only with their licence terms', () => {
    for (const id of [ANPDB.source_id, ANSES.source_id]) {
      const source = sources.find(item => item.id === id);
      assert.ok(source, id);
      assert.equal(source.ingestion_status, 'reference_only');
      assert.equal(names.some(name => name.source_id === id), false);
    }
    assert.match(sources.find(item => item.id === ANPDB.source_id).licence, /CC BY-NC 4\.0/);
    assert.deepEqual(overlap.source_ids, [ANPDB.source_id, ANSES.source_id]);
  });

  it('keeps the overlap out of runtime export and records unverified provenance honestly', () => {
    assert.equal(overlap.runtime_export_eligible, false);
    assert.equal(overlap.inputs.anses.primary_checksum_verified, false);
    assert.equal(overlap.inputs.anses.extraction_via.commit, ANSES.extraction.commit);
    assert.match(overlap.inputs.anpdb.sha256, /^[0-9a-f]{64}$/);
    const plantIds = new Set(readJson('data', 'plants', 'plants.json').map(plant => plant.id));
    for (const taxon of overlap.taxa) {
      assert.ok(plantIds.has(taxon.plant_id), taxon.plant_id);
      assert.ok(taxon.anpdb.length || taxon.anses.length);
      for (const row of taxon.anpdb) assert.equal(Object.hasOwn(row, 'species_known_use'), false);
      for (const row of taxon.anses) assert.deepEqual(Object.keys(row.statements_present).sort(), ['contraindication', 'interaction', 'paediatric', 'pregnancy_lactation']);
    }
  });
});

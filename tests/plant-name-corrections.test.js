// Curated name corrections (scripts/resolve-name-corrections.js).
//
// The dangerous part of this script is not the network call, it is the choice
// it makes when GBIF offers more than one accepted species. Every case below is
// a real one from data/plants/name_corrections.json, kept as a fixture so the
// rule that decided it stays decided.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { candidateQueries, disambiguate, correctionRecord, taxonomyEntry } = require('../scripts/resolve-name-corrections');

const alternative = (canonical, accepted, overrides = {}) => ({
  canonical,
  accepted,
  match_type: 'EXACT',
  confidence: 97,
  status: 'SYNONYM',
  family: null,
  ...overrides
});

describe('rewriting a published name into something matchable', () => {
  it('reads a second binomial in the cell as the authors naming the accepted name', () => {
    const queries = candidateQueries('Ficus capensis Thunb. Ficus sur Forssk.)', null);
    assert.equal(queries[0].rule, 'second_name_in_cell');
    assert.equal(queries[0].query, 'Ficus sur');
  });

  it('strips an authority, lowercases a capitalised epithet, and drops to the species', () => {
    const rules = query => candidateQueries(query, null).map(candidate => `${candidate.rule}:${candidate.query}`);

    assert.ok(rules('Kigelia Africana (Lam.) Benth').includes('capitalised_epithet_lowercased:Kigelia africana'));
    assert.ok(rules('Bambusa vulgaris L.').includes('authority_removed:Bambusa vulgaris'));
    // Dropping the authority drops the infraspecific epithet with it, which is
    // what maps a variety onto the species the index holds.
    assert.ok(rules('Urena lobata L. var. glauca (Blume) Borss. Waalk.').includes('authority_removed:Urena lobata'));
  });

  it('puts GBIF own variant suggestion ahead of the mechanical rewrites', () => {
    const queries = candidateQueries('Colocasia esculentum (L.) Schott', 'Colocasia esculenta');
    assert.equal(queries[0].query, 'Colocasia esculenta');
    assert.equal(queries[0].rule, 'gbif_variant_suggestion');
  });

  it('never invents a spelling of its own', () => {
    // Without a GBIF suggestion there is nothing to correct a misspelling to,
    // and the only candidates are rearrangements of what was printed.
    const queries = candidateQueries('Telfaria occidentalis Hook. F.', null);
    assert.ok(queries.every(candidate => candidate.query.split(/\s+/).every(word => 'Telfaria occidentalis Hook. F.'.includes(word))));
  });
});

describe('choosing between the species GBIF offers', () => {
  it('takes the single accepted species when there is only one', () => {
    const result = disambiguate('Harungana madagascariens', [
      alternative('Harungana madagascariensis', 'Harungana madagascariensis', { match_type: 'FUZZY', status: 'ACCEPTED' })
    ]);

    assert.equal(result.chosen, 'Harungana madagascariensis');
    assert.equal(result.rule, 'gbif_single_species');
  });

  it('resolves a homonym to the candidate that keeps the epithet', () => {
    // "Acacia albida" is two names by two authors: Delile's African tree, now
    // Faidherbia albida, and Lindley's, now Vachellia tortuosa.
    const result = disambiguate('Acacia albida', [
      alternative('Acacia albida', 'Faidherbia albida'),
      alternative('Acacia albida', 'Vachellia tortuosa')
    ]);

    assert.equal(result.chosen, 'Faidherbia albida');
    assert.equal(result.rule, 'gbif_alternative_keeping_the_epithet');
  });

  it('resolves a genus recombination away from same-genus neighbours', () => {
    const result = disambiguate('Acacia sieberiana', [
      alternative('Acacia sieberiana', 'Acacia terminalis'),
      alternative('Acacia sieberiana', 'Acacia hamiltoniana'),
      alternative('Acacia sieberiana', 'Vachellia sieberiana', { status: 'ACCEPTED' })
    ]);

    assert.equal(result.chosen, 'Vachellia sieberiana');
  });

  it('keeps the genus only when nothing else is related at all', () => {
    // Luffa cylindrica: GBIF answers Luffa aegyptiaca, and also a melon.
    const result = disambiguate('Luffa cylindrica', [
      alternative('Luffa cylindrica', 'Cucumis melo'),
      alternative('Luffa cylindrica', 'Luffa aegyptiaca')
    ]);

    assert.equal(result.chosen, 'Luffa aegyptiaca');
    assert.equal(result.rule, 'gbif_alternative_keeping_the_genus');
  });

  it('prefers a fuzzy candidate that keeps the epithet over one that keeps the genus', () => {
    // The case that made this rule: "Lactuca taraxifolia" is the West African
    // wild lettuce, Launaea taraxacifolia. A rule that preferred the published
    // genus would have picked Lactuca alaica, which grows in Central Asia.
    const result = disambiguate('Lactuca taraxifolia', [
      alternative('Lactuca taraxacifolia', 'Lactuca alaica', { match_type: 'FUZZY' }),
      alternative('Lactuca taraxacifolia', 'Launaea taraxacifolia', { match_type: 'FUZZY' })
    ]);

    assert.equal(result.chosen, 'Launaea taraxacifolia');
    assert.equal(result.rule, 'gbif_alternative_keeping_the_epithet');
  });

  it('ignores a fuzzy neighbour that is simply a different species', () => {
    const result = disambiguate('Harungana madagascariens', [
      alternative('Harungana madagascariensis', 'Harungana madagascariensis', { match_type: 'FUZZY', status: 'ACCEPTED' }),
      alternative('Harungana montana', 'Harungana montana', { match_type: 'FUZZY', status: 'ACCEPTED' }),
      alternative('Psorospermum crenatum', 'Psorospermum crenatum', { match_type: 'FUZZY', status: 'ACCEPTED' })
    ]);

    assert.equal(result.chosen, 'Harungana madagascariensis');
  });

  it('looks at fuzzy candidates only when the published spelling matches nothing exactly', () => {
    const result = disambiguate('Acacia albida', [
      alternative('Acacia albida', 'Faidherbia albida'),
      alternative('Acacia albida', 'Vachellia tortuosa'),
      // A fuzzy neighbour that keeps neither genus nor epithet must not be able
      // to turn an exact homonym into a contested name.
      alternative('Acacia alpina', 'Acacia alpina', { match_type: 'FUZZY', status: 'ACCEPTED' })
    ]);

    assert.equal(result.chosen, 'Faidherbia albida');
  });

  it('defers when two candidates are equally close to the published name', () => {
    // Anacardium occidentalis: the backbone holds both "occidentale", the
    // cashew, and "occidentala", which differs from the published spelling by
    // exactly as much. A script should not pick.
    const result = disambiguate('Anacardium occidentalis', [
      alternative('Anacardium occidentala', 'Anacardium occidentala', { match_type: 'FUZZY', status: 'ACCEPTED' }),
      alternative('Anacardium occidentale', 'Anacardium occidentale', { match_type: 'FUZZY', status: 'ACCEPTED' })
    ]);

    assert.equal(result.chosen, null);
    assert.deepEqual(result.candidates, ['Anacardium occidentala', 'Anacardium occidentale']);
  });

  it('defers a genus-only name, which names no species to correct to', () => {
    const result = disambiguate('Grewia sp', [
      alternative('Grewia apetala', 'Grewia apetala', { match_type: 'FUZZY', status: 'ACCEPTED' }),
      alternative('Grewia bracteata', 'Grewia bracteata', { match_type: 'FUZZY', status: 'ACCEPTED' })
    ]);

    assert.equal(result.chosen, null);
  });
});

describe('the record a correction leaves', () => {
  const unmatched = {
    botanical_as_published: 'Telfaria occidentalis Hook. F.',
    match_type: 'NONE',
    confidence: 100,
    taxonomic_status: null,
    matched_canonical: null,
    export_eligible: false
  };

  const outcome = {
    status: 'corrected',
    rule: 'gbif_single_species',
    corrected_query: 'Telfairia occidentalis',
    match: {
      match_type: 'EXACT',
      confidence: 99,
      taxonomic_status: 'ACCEPTED',
      matched_canonical: 'Telfairia occidentalis',
      accepted_botanical: 'Telfairia occidentalis',
      usage_key: '1', 
      accepted_usage_key: '1'
    },
    attempts: [{ query: 'Telfairia occidentalis', rule: 'gbif_single_species', eligible: true }]
  };

  it('says what was queried and how far the answer moved from the published name', () => {
    const record = correctionRecord(unmatched, outcome, '2026-09-13');

    assert.equal(record.status, 'corrected');
    assert.equal(record.corrected_query, 'Telfairia occidentalis');
    assert.equal(record.accepted_botanical, 'Telfairia occidentalis');
    assert.equal(record.evidence.genus_changed, true);
    assert.equal(record.evidence.epithet_changed, false);
    assert.ok(record.attempts.length);
  });

  it('records a deferral as an open question, with what it is between', () => {
    const record = correctionRecord(unmatched, {
      status: 'deferred',
      attempts: [],
      competing_accepted_names: ['Anacardium occidentala', 'Anacardium occidentale']
    }, '2026-09-13');

    assert.equal(record.status, 'deferred');
    assert.equal(record.accepted_botanical, undefined);
    assert.deepEqual(record.competing_accepted_names, ['Anacardium occidentala', 'Anacardium occidentale']);
    assert.match(record.reason, /botanist/);
  });

  it('keeps the published name as the key the build looks up', () => {
    const record = correctionRecord(unmatched, outcome, '2026-09-13');
    const entry = taxonomyEntry(unmatched, record, '2026-09-13');

    // The survey row still says "Telfaria occidentalis Hook. F.", so that is
    // what the cache has to answer to.
    assert.equal(entry.botanical_as_published, 'Telfaria occidentalis Hook. F.');
    assert.equal(entry.corrected_from_as_published, 'Telfaria occidentalis Hook. F.');
    assert.equal(entry.taxonomy_query_name, 'Telfairia occidentalis');
    assert.equal(entry.taxonomy_query_strategy, 'curated_correction');
    assert.equal(entry.accepted_botanical, 'Telfairia occidentalis');
    assert.equal(entry.export_eligible, true);
  });
});

describe('the corrections that were actually applied', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const corrections = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'plants', 'name_corrections.json'), 'utf8'));
  const taxonomy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'plants', 'taxonomy', 'gbif-primary.json'), 'utf8'));
  const byPublished = new Map(taxonomy.map(entry => [entry.botanical_as_published, entry]));

  it('carries evidence for every correction and a reason for every deferral', () => {
    for (const correction of corrections) {
      if (correction.status === 'corrected') {
        assert.ok(correction.corrected_query, correction.botanical_as_published);
        assert.ok(correction.accepted_botanical, correction.botanical_as_published);
        assert.ok(correction.evidence.confidence >= 90, correction.botanical_as_published);
        assert.ok(['EXACT'].includes(correction.evidence.match_type), correction.botanical_as_published);
      } else {
        assert.equal(correction.status, 'deferred');
        assert.ok(correction.reason);
      }
    }
  });

  it('leaves a deferred name unresolved in the taxonomy cache', () => {
    for (const correction of corrections.filter(item => item.status === 'deferred')) {
      assert.equal(byPublished.get(correction.botanical_as_published).export_eligible, false, correction.botanical_as_published);
    }
  });

  it('resolves the names that were withheld only for a spelling', () => {
    const applied = corrections.filter(item => item.status === 'corrected');
    assert.ok(applied.length >= 30);
    for (const correction of applied) {
      const entry = byPublished.get(correction.botanical_as_published);
      assert.equal(entry.export_eligible, true, correction.botanical_as_published);
      assert.equal(entry.accepted_botanical, correction.accepted_botanical);
      assert.equal(entry.taxonomy_query_strategy, 'curated_correction');
    }
  });
});

// The contested-name review loop (scripts/adjudicate-names.js).
//
// The build will not choose between sources. This loop lets a reviewer remove
// a source instead — by saying which published row is wrong and why — and the
// tests below are as much about what a reviewer cannot do as what they can.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { describe: shapeOf, majorityOf, pendingEntry, strikes, validate } = require('../scripts/adjudicate-names');
const { build } = require('../scripts/build-plant-data');

const root = path.join(__dirname, '..');

const decision = (overrides = {}) => ({
  normalized_name: 'uziza',
  decision: 'source_row_error',
  strike: { source_id: 'ajibesin-2012-rivers', source_row: 133 },
  reason: 'Table 1 gives Uziza (Ikwerre) for Glycyrrhiza glabra at PNM 133 and for Piper guineense at PNM 139; liquorice is not the plant, and the same paper names the other row correctly.',
  reviewed_by: 'PR-7F2A',
  reviewed_at: '2026-09-14',
  ...overrides
});

describe('what counts as a decision', () => {
  it('takes a decision that says which row, why, and who', () => {
    const { applied, problems } = validate([decision()]);
    assert.equal(applied.length, 1);
    assert.deepEqual(problems, []);
  });

  it('ignores one with no reason, and says so rather than applying it', () => {
    const { applied, problems } = validate([decision({ reason: '  ' })]);
    assert.equal(applied.length, 0);
    assert.match(problems[0], /no reason/);
  });

  it('ignores one attributed to nobody, or to a real name', () => {
    for (const reviewer of [null, '', 'Baba Ade', 'ade@example.com', '+2348012345678']) {
      const { applied, problems } = validate([decision({ reviewed_by: reviewer })]);
      assert.equal(applied.length, 0, String(reviewer));
      assert.match(problems[0], /pseudonymous/);
    }
  });

  it('ignores a strike that does not name the row it strikes', () => {
    const { applied, problems } = validate([decision({ strike: null })]);
    assert.equal(applied.length, 0);
    assert.match(problems[0], /must name the row/);
  });

  it('leaves a pending entry pending, without complaint', () => {
    const { applied, problems } = validate([{ normalized_name: 'ose', decision: 'pending' }]);
    assert.deepEqual(applied, []);
    assert.deepEqual(problems, []);
  });

  it('has no way to nominate a winner', () => {
    // The decision vocabulary is deliberately small: a claim about a
    // publication, or a record that the disagreement is real. "The answer is
    // X" is not in it, because it cannot be checked against anything.
    const { applied, problems } = validate([decision({ decision: 'accepted_botanical', accepted_botanical: 'Piper guineense' })]);
    assert.equal(applied.length, 0);
    assert.match(problems[0], /unknown decision/);
  });
});

describe('which row a strike hits', () => {
  const name = (overrides = {}) => ({
    normalized_name: 'uziza',
    source_id: 'ajibesin-2012-rivers',
    source_locator: { table: 'Table 1', row: 133 },
    ...overrides
  });

  it('hits the row it names, and only that row', () => {
    assert.equal(strikes(decision(), name()), true);
    assert.equal(strikes(decision(), name({ source_locator: { row: 139 } })), false);
    assert.equal(strikes(decision(), name({ source_id: 'olatokunbo-2022-bayelsa' })), false);
    assert.equal(strikes(decision(), name({ normalized_name: 'utazi' })), false);
  });

  it('identifies a legacy row by its source alone, since it has no locator', () => {
    const strike = decision({ strike: { source_id: 'legacy-lookup-v1' } });
    assert.equal(strikes(strike, name({ source_id: 'legacy-lookup-v1', source_locator: null })), true);
  });

  it('never hits anything for an upheld contest', () => {
    assert.equal(strikes(decision({ decision: 'contest_upheld', strike: null }), name()), false);
  });
});

describe('how a contest is described to the reviewer', () => {
  const entry = {
    normalized_name: 'uziza',
    source_spellings: ['Uziza', 'uziza'],
    candidates: [
      { accepted_botanical: 'Piper guineense', source_id: 'legacy-lookup-v1', source_locator: null, language: null },
      { accepted_botanical: 'Piper guineense', source_id: 'ajibesin-2012-rivers', source_locator: { row: 139 }, language: 'ikw' },
      { accepted_botanical: 'Glycyrrhiza glabra', source_id: 'ajibesin-2012-rivers', source_locator: { row: 133 }, language: 'ikw' },
      { accepted_botanical: 'Piper guineense', source_id: 'olatokunbo-2022-bayelsa', source_locator: { row: 31 }, language: 'ijc' }
    ]
  };

  it('counts the rows per taxon without acting on the count', () => {
    // Three rows against one is worth looking at first. It is not evidence
    // about a plant, and nothing in the build reads it.
    const { counts, leader, lead } = majorityOf(entry.candidates);
    assert.deepEqual(counts, { 'Piper guineense': 3, 'Glycyrrhiza glabra': 1 });
    assert.equal(leader, 'Piper guineense');
    assert.equal(lead, 2);
  });

  it('says when one source is disagreeing with itself, and when a genus is shared', () => {
    assert.equal(shapeOf(entry).within_one_source, true);
    assert.equal(shapeOf(entry).same_genus, false);

    const albizia = { candidates: [
      { accepted_botanical: 'Albizia ferruginea', source_id: 'olanipekun-2022-lagos', source_locator: { row: 1 } },
      { accepted_botanical: 'Albizia lebbeck', source_id: 'olanipekun-2022-lagos', source_locator: { row: 2 } }
    ] };
    assert.equal(shapeOf(albizia).same_genus, true);
  });

  it('proposes an entry nobody has decided yet', () => {
    const proposal = pendingEntry(entry);
    assert.equal(proposal.decision, 'pending');
    assert.equal(proposal.reviewed_by, null);
    assert.equal(proposal.candidates.length, 4);
    assert.deepEqual(proposal.shape.rows_per_taxon, { 'Piper guineense': 3, 'Glycyrrhiza glabra': 1 });
  });
});

describe('a decision reaching the index', () => {
  function buildWith(adjudications) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sanko-adjudicate-'));
    const plantsDir = path.join(workspace, 'plants');
    const runtimeFile = path.join(workspace, 'plant_lookup_v1.json');
    try {
      fs.cpSync(path.join(root, 'data', 'plants'), plantsDir, { recursive: true });
      fs.writeFileSync(path.join(plantsDir, 'name_adjudications.json'), `${JSON.stringify(adjudications, null, 2)}\n`);
      const report = build({ plantsDir, runtimeFile });
      return {
        report,
        runtime: JSON.parse(fs.readFileSync(runtimeFile, 'utf8')),
        names: JSON.parse(fs.readFileSync(path.join(plantsDir, 'vernacular_names.json'), 'utf8')),
        reviews: JSON.parse(fs.readFileSync(path.join(plantsDir, 'reviews.json'), 'utf8')),
        ambiguities: JSON.parse(fs.readFileSync(path.join(plantsDir, 'ambiguities.json'), 'utf8'))
      };
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  it('resolves a name once the row a reviewer struck stops counting', () => {
    const before = buildWith([]);
    const after = buildWith([decision()]);

    assert.equal(before.runtime.find(row => row.local_name === 'uziza').botanical, null);
    assert.equal(after.runtime.find(row => row.local_name === 'uziza').botanical, 'Piper guineense');
  });

  it('keeps the struck row in the data, marked, rather than deleting it', () => {
    const { names } = buildWith([decision()]);
    const struck = names.find(name => name.normalized_name === 'uziza' && name.source_locator?.row === 133);

    assert.ok(struck, 'the row is still there');
    assert.equal(struck.accepted_botanical, 'Glycyrrhiza glabra');
    assert.equal(struck.export_eligible, false);
    assert.equal(struck.adjudicated_out, true);
    assert.equal(struck.adjudication.reviewed_by, 'PR-7F2A');
    assert.match(struck.adjudication.reason, /liquorice/);
  });

  it('records the decision as a review, attributed', () => {
    const { reviews } = buildWith([decision()]);
    const review = reviews.find(item => item.review_type === 'name_adjudication' && item.subject_id === 'uziza');

    assert.equal(review.status, 'struck');
    assert.equal(review.reviewer.name, 'PR-7F2A');
    assert.deepEqual(review.details.strike, { source_id: 'ajibesin-2012-rivers', source_row: 133 });
  });

  it('leaves an upheld contest contested, and says it was examined', () => {
    const { runtime, ambiguities } = buildWith([{
      normalized_name: 'ayunre',
      decision: 'contest_upheld',
      strike: null,
      reason: 'A Yoruba name covering both Albizia ferruginea and Albizia lebbeck. The disagreement is the language, not the sources.',
      reviewed_by: 'PR-7F2A',
      reviewed_at: '2026-09-14'
    }]);

    assert.equal(runtime.find(row => row.local_name === 'ayunre').botanical, null);
    assert.equal(ambiguities.find(item => item.normalized_name === 'ayunre').contest_upheld, true);
  });

  it('applies nothing from an entry that is half filled in', () => {
    const { runtime } = buildWith([decision({ reviewed_by: null })]);
    assert.equal(runtime.find(row => row.local_name === 'uziza').botanical, null);
  });

  it('does not let a strike disturb the other names on that row', () => {
    // PNM 133 of the Rivers survey maps one local name. Striking it must not
    // touch Glycyrrhiza glabra itself, or any other name reported for it.
    const { names } = buildWith([decision()]);
    const others = names.filter(name => name.accepted_botanical === 'Glycyrrhiza glabra' && name.normalized_name !== 'uziza');
    for (const name of others) assert.notEqual(name.adjudicated_out, true);
  });
});

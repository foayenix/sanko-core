// The Rivers State survey (scripts/build-rivers-survey.js).
//
// The article is a scan with no text layer, so its table was transcribed by
// reading the page images. That makes two things worth testing: the reading of
// each cell, and the checks that would catch a transcription going wrong.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { LANGUAGE_CODES, splitLocalName, localNames, toSurveyRow } = require('../scripts/build-rivers-survey');

const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8'));

describe('reading a local-name cell', () => {
  it('separates the name from the language the paper brackets after it', () => {
    assert.deepEqual(splitLocalName('Ekpegwo (Kalabari)'), { name: 'Ekpegwo', label: 'Kalabari' });
    assert.deepEqual(splitLocalName('Ogwu nje (Kalabari)'), { name: 'Ogwu nje', label: 'Kalabari' });
  });

  it('normalises how the label is spelled without changing which label it is', () => {
    // The paper prints "Ikwere" once and "kalabari" lowercase once.
    assert.equal(splitLocalName('Oranjila (Ikwere)').label, 'Ikwerre');
    assert.equal(splitLocalName('Ogbeagu (kalabari)').label, 'Kalabari');
  });

  it('records the absence of a label rather than guessing one', () => {
    assert.deepEqual(splitLocalName('Mgba-ala'), { name: 'Mgba-ala', label: null });
    assert.deepEqual(splitLocalName('Mkpuru ugu'), { name: 'Mkpuru ugu', label: null });
  });

  it('splits two names in one language, and drops the quotes on a borrowed word', () => {
    assert.deepEqual(localNames('Akilu, akama'), ['Akilu', 'akama']);
    assert.deepEqual(localNames('“Pawpaw”'), ['Pawpaw']);
  });
});

describe('the language codes', () => {
  it('codes the three labels that name one language', () => {
    assert.equal(LANGUAGE_CODES.Ikwerre, 'ikw');
    assert.equal(LANGUAGE_CODES.Kalabari, 'ijn');
    assert.equal(LANGUAGE_CODES.Ekpeye, 'ekp');
  });

  it('refuses to code Ogoni, which names a cluster rather than a language', () => {
    // Khana, Gokana, Eleme, Baan and Tee are all Ogoni. Picking one would be
    // inventing a fact the paper does not state.
    const row = toSurveyRow({ pnm: 5, family: 'Anacardiaceae', botanical: 'Spondias mombin L.', local: 'Aginiran (Ogoni)' });

    assert.equal(row.language_as_published, 'Ogoni');
    assert.deepEqual(row.vernacular_names, [{ local_name: 'Aginiran', language: null }]);
    assert.ok(row.data_quality_flags.includes('language_label_names_a_cluster'));
  });
});

describe('the rows it produces', () => {
  it('keeps the cell as read beside the reading of it', () => {
    const row = toSurveyRow({ pnm: 1, family: 'Acanthaceae', botanical: 'Justicia shimperi (Hochst) Danby', local: 'Ekpegwo (Kalabari)' });

    assert.equal(row.vernacular_as_published, 'Ekpegwo (Kalabari)');
    assert.equal(row.specimen_number, 'PNM 1');
    assert.deepEqual(row.vernacular_names, [{ local_name: 'Ekpegwo', language: 'ijn' }]);
    assert.deepEqual(row.parts_reported, []);
  });

  it('produces no mapping where the local-name column repeats the botanical name', () => {
    const row = toSurveyRow({ pnm: 104, family: 'Liliaceae', botanical: 'Aloe vera L.', local: '“Aloe vera”' });

    assert.deepEqual(row.vernacular_names, []);
    assert.ok(row.data_quality_flags.includes('local_name_column_repeats_the_botanical_name'));
  });

  it('flags a specimen that shares a merged cell with the one beside it', () => {
    const row = toSurveyRow({ pnm: 24, family: 'Asteraceae', botanical: 'Chromolaena odorata (L.) King & Robinson', local: 'Nshegbu awom (Ekpeye)', merged_cell: true });

    assert.ok(row.data_quality_flags.includes('specimen_shares_a_merged_cell'));
    assert.deepEqual(row.vernacular_names, [{ local_name: 'Nshegbu awom', language: 'ekp' }]);
  });
});

describe('reading the plant-part column', () => {
  const { parseParts } = require('../scripts/build-rivers-survey');

  it('drops the bracketed numbers, which are local-government codes', () => {
    assert.deepEqual(parseParts('Leaves (12,13, 16,18, 19,21)').parts, ['leaves']);
    assert.deepEqual(parseParts('Root ((1-23)').parts, ['root']);
    assert.deepEqual(parseParts('Leaves (12,15,16,18,19,21-23-W)').parts, ['leaves']);
  });

  it('separates words the print ran together when the column wrapped', () => {
    assert.deepEqual(parseParts('RootLeaves (1-23)').parts, ['root', 'leaves']);
    assert.deepEqual(parseParts('LeavesBran (1-23)').parts, ['leaves', 'bran']);
    assert.deepEqual(parseParts('Tuber and leavesTuber (2,6,10,11)').parts, ['tuber', 'leaves']);
  });

  it('reads "and" as a separator, not as part of a name', () => {
    // "Stem and bark" is two parts. Reading it as the single part "stem bark"
    // would invent one and lose one, which is why that term is not in the
    // vocabulary even though it is a real part elsewhere.
    assert.deepEqual(parseParts('Stem and bark (4-7)').parts, ['stem', 'bark']);
    assert.deepEqual(parseParts('Root Bark (11-23)').parts, ['root', 'bark']);
  });

  it('keeps a genuine multi-word part whole', () => {
    assert.deepEqual(parseParts('Whole plant (13-17, 19,21,23)').parts, ['whole plant']);
    assert.deepEqual(parseParts('Fruit pericarp (1-23)').parts, ['fruit pericarp']);
    // In the order the cell prints them.
    assert.deepEqual(parseParts('Leaves, flower bud and bark Fruit pericarp (1-23)').parts,
      ['leaves', 'flower bud', 'bark', 'fruit pericarp']);
  });

  it('reports anything it cannot place rather than dropping it', () => {
    const { parts, unrecognised } = parseParts('Leaves and gizzard (1-5)');
    assert.deepEqual(parts, ['leaves']);
    assert.deepEqual(unrecognised, ['gizzard']);
  });
});

describe('what the transcription has to satisfy', () => {
  const transcription = readJson('data', 'plants', 'surveys', 'transcriptions', 'ajibesin-2012-rivers-table1.json');
  const survey = readJson('data', 'plants', 'surveys', 'ajibesin-2012-rivers.json');

  it('holds every specimen number from 1 to 188, once', () => {
    // The one check available on a transcription of a scan: the paper reports
    // 188 species and numbers them, so a dropped or repeated row shows up here.
    const numbers = transcription.map(row => row.pnm).sort((a, b) => a - b);
    assert.equal(numbers.length, 188);
    assert.deepEqual(numbers, Array.from({ length: 188 }, (_, index) => index + 1));
  });

  it('gives every row a family and a botanical name', () => {
    for (const row of transcription) {
      assert.ok(row.family?.trim(), `PNM ${row.pnm} has no family`);
      assert.ok(row.botanical?.trim(), `PNM ${row.pnm} has no botanical name`);
    }
  });

  it('transcribes a part cell for every row, and places every word in them', () => {
    const { parseParts } = require('../scripts/build-rivers-survey');
    for (const row of transcription) {
      assert.ok(row.parts?.trim(), `PNM ${row.pnm} has no part cell`);
      assert.deepEqual(parseParts(row.parts).unrecognised, [], `PNM ${row.pnm}: ${row.parts}`);
    }
  });

  it('builds one survey row per transcribed row, in specimen order', () => {
    assert.equal(survey.length, transcription.length);
    assert.deepEqual(survey.map(row => row.source_row), Array.from({ length: 188 }, (_, index) => index + 1));
  });
});

describe('what reached the index', () => {
  const names = readJson('data', 'plants', 'vernacular_names.json');
  const sources = readJson('data', 'plants', 'sources.json');
  const rivers = names.filter(name => name.source_id === 'ajibesin-2012-rivers');

  it('adds three languages the index did not have', () => {
    const counts = {};
    for (const name of rivers) counts[name.language ?? 'uncoded'] = (counts[name.language ?? 'uncoded'] ?? 0) + 1;

    assert.equal(counts.ikw, 83);
    assert.equal(counts.ijn, 38);
    assert.equal(counts.ekp, 31);
    // The Ogoni rows and the four with no printed label.
    assert.equal(counts.uncoded, 36);
  });

  it('records how the source was read, because it was read off a scan', () => {
    const source = sources.find(item => item.id === 'ajibesin-2012-rivers');

    assert.equal(source.ingestion_status, 'included');
    assert.match(source.extraction_method, /no text layer/);
    assert.match(source.licence, /no reuse licence stated/);
    assert.deepEqual(source.languages, ['ikw', 'ijn', 'ekp']);
  });

  it('resolves all but the names GBIF could not place', () => {
    const unresolved = rivers.filter(name => !name.export_eligible);
    assert.ok(rivers.length >= 186);
    assert.ok(unresolved.length <= 2, `${unresolved.length} unresolved: ${unresolved.map(n => n.botanical_as_published).join(', ')}`);
  });
});

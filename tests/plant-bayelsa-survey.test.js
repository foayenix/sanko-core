// The Bayelsa trado-orthopedic survey (scripts/extract-bayelsa-survey.js).
//
// Table 2 prints the English common name and the Ijaw name in one cell, in
// either order, and the split between them is a reading of that cell rather
// than something the source marks. These are the cases that reading has to get
// right, kept as fixtures so it stays right.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTable, splitNames, toSurveyRow } = require('../scripts/extract-bayelsa-survey');

const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8'));

describe('reading the vernacular column', () => {
  it('takes the Ijaw name whichever side of the slash it is printed on', () => {
    assert.deepEqual(splitNames('Okro/ Kiyabu'), { english: ['Okro'], ijaw: ['Kiyabu'] });
    // Printed the other way round, and nothing in the cell says so.
    assert.deepEqual(splitNames('Eka/Bitter kola'), { english: ['Bitter kola'], ijaw: ['Eka'] });
    assert.deepEqual(splitNames('Pokueduku/Sweet potato'), { english: ['Sweet potato'], ijaw: ['Pokueduku'] });
  });

  it('reads a cell with no English name as entirely Ijaw', () => {
    assert.deepEqual(splitNames('Adeginapumue'), { english: [], ijaw: ['Adeginapumue'] });
    assert.deepEqual(splitNames('Itolo'), { english: [], ijaw: ['Itolo'] });
  });

  it('claims no Ijaw name where the cell holds only English', () => {
    // The Nigerian English by-name for Jatropha tanjorensis.
    assert.deepEqual(splitNames('Hospital too far'), { english: ['Hospital too far'], ijaw: [] });
  });

  it('keeps every Ijaw name when a species has more than one', () => {
    assert.deepEqual(splitNames('Button weed/Iyaimo, Ikinrinrin').ijaw, ['Iyaimo', 'Ikinrinrin']);
    assert.deepEqual(splitNames('Oil palm/ Lobolou, Lugutin').ijaw, ['Lobolou', 'Lugutin']);
    assert.deepEqual(splitNames('Cleome/Kakagben/ Agbalala'), { english: ['Cleome'], ijaw: ['Kakagben', 'Agbalala'] });
  });

  it('does not mistake an English book name for Ijaw, or a localised spelling for English', () => {
    // "Haronga" is an English name taken from the genus; "Aguava" is the cell's
    // rendering of the local name. Neither is decidable by shape, which is why
    // the English names are listed rather than detected.
    assert.deepEqual(splitNames('Haronga/ Boopulo'), { english: ['Haronga'], ijaw: ['Boopulo'] });
    assert.deepEqual(splitNames('Guava/ Aguava'), { english: ['Guava'], ijaw: ['Aguava'] });
  });

  it('separates the two English names of Ficus lutea from its one Ijaw name', () => {
    assert.deepEqual(splitNames('Lagos rubber tree /Ula, Native pop'), {
      english: ['Lagos rubber tree', 'Native pop'],
      ijaw: ['Ula']
    });
  });
});

describe('parsing the table out of the layout text', () => {
  const fixture = [
    '              Botanical name                       Family name       Habit           Vernacular/Ijaw name           Abundant status',
    'Abelmoschus esculentus (L.)                      Malvaceae           Shrub     Okro/ Kiyabu                         Abundant',
    'Mimosa pudica (L.)                               Fabaceae            Herb      Sensitive plant/Igbanagbana,         Abundant',
    '                                                                               Dabomenetibigban',
    'Zingiber officinale (Roscoe.)                    Zingiberaceae       Herb      Ginger/Zinza                         Rare',
    '                                OLATOKUNBO et al. – Indigenous plants used for traditional orthopedic                                   135'
  ].join('\n');

  it('joins a vernacular cell that wrapped onto its own line', () => {
    const rows = parseTable(fixture);

    assert.equal(rows.length, 3);
    assert.equal(rows[1].botanical, 'Mimosa pudica (L.)');
    assert.equal(rows[1].vernacular, 'Sensitive plant/Igbanagbana, Dabomenetibigban');
    assert.deepEqual(splitNames(rows[1].vernacular).ijaw, ['Igbanagbana', 'Dabomenetibigban']);
  });

  it('stops at the running head rather than reading the next table', () => {
    assert.equal(parseTable(fixture).at(-1).botanical, 'Zingiber officinale (Roscoe.)');
  });
});

describe('the survey row it produces', () => {
  const row = toSurveyRow({ botanical: 'Costus afer (Ker. Gaw.l)', family: 'Costaceae', habit: 'Herb', vernacular: 'Ginger lily/Ogbodo', abundance: 'Abundant' }, 10);

  it('keeps the cell verbatim beside the reading of it', () => {
    assert.equal(row.vernacular_as_published, 'Ginger lily/Ogbodo');
    assert.deepEqual(row.vernacular_names, [{ local_name: 'Ogbodo', language: 'ijc' }]);
    assert.equal(row.common_english_as_published, 'Ginger lily');
  });

  it('claims no plant parts, because the paper publishes none', () => {
    // Table 3 describes preparation in prose. Parsing parts out of a sentence
    // would be inventing structure the source does not have.
    assert.deepEqual(row.parts_reported, []);
    assert.match(row.use_context, /Bayelsa/);
  });
});

describe('what reached the index', () => {
  const survey = readJson('data', 'plants', 'surveys', 'olatokunbo-2022-bayelsa.json');
  const sources = readJson('data', 'plants', 'sources.json');
  const names = readJson('data', 'plants', 'vernacular_names.json');
  const corrections = readJson('data', 'plants', 'name_corrections.json');

  it('ingests all thirty-nine species the paper reports', () => {
    assert.equal(survey.length, 39);
    const source = sources.find(item => item.id === 'olatokunbo-2022-bayelsa');
    assert.equal(source.ingestion_status, 'included');
    assert.deepEqual(source.languages, ['ijc']);
    assert.match(source.licence, /no reuse licence stated/);
  });

  it('is the first Ijaw in the index, and every name of it resolves', () => {
    const ijaw = names.filter(name => name.language === 'ijc');
    assert.equal(ijaw.length, 43);
    assert.ok(ijaw.every(name => name.source_id === 'olatokunbo-2022-bayelsa'));
    assert.ok(ijaw.every(name => name.export_eligible));
    assert.equal(names.filter(name => name.normalized_name === 'kiyabu')[0].accepted_botanical, 'Abelmoschus esculentus');
  });

  it('keeps the corrections of earlier runs when a new source adds its own', () => {
    // A regression: the corrections file is written by merging, not replacing.
    // Written from one run's results it would silently drop the record of every
    // name an earlier run decided — the corrections would survive in the
    // taxonomy cache and the reasons for them would not.
    const published = corrections.map(correction => correction.botanical_as_published);
    assert.ok(published.includes('Telfaria occidentalis Hook. F.'), 'an earlier run decision');
    assert.ok(published.includes('Spondias mombis (L.)'), 'a decision from the Bayelsa run');
    assert.ok(corrections.length >= 45);
  });
});

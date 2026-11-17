// How a published local name is printed ("sanko-landing page/scripts/display-name.mjs").
//
// The resolver used `\b[a-z]` to title-case these, and `\b` is ASCII-only: every
// Yoruba tone mark and dot below opened a word boundary, so the letter after it
// was capitalised mid-word and "Abo yúnyún" went to the site as "Abo YúNyúN".
// That shipped on every page showing a name for as long as the helper existed,
// which is the argument for testing it: the failure is silent, it is invisible
// to anyone who does not read the language, and the names are the product.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The module is ESM under the landing page; the test suite is CommonJS.
let titleCase;
before(async () => {
  ({ titleCase } = await import(
    '../sanko-landing page/scripts/display-name.mjs'
  ));
});

const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8'));

describe('capitalising a name that carries diacritics', () => {
  it('leaves the marked letters where the source put them', () => {
    // Each of these was mangled at the letter following the diacritic.
    assert.equal(titleCase('Abo yúnyún'), 'Abo Yúnyún');
    assert.equal(titleCase('Apa ọgbẹ́'), 'Apa Ọgbẹ́');
    assert.equal(titleCase('Ejaọmode'), 'Ejaọmode');
    assert.equal(titleCase('Òlógbọn gbũrú'), 'Òlógbọn Gbũrú');
    assert.equal(titleCase('Gboyín-Gboyín'), 'Gboyín-Gboyín');
  });

  it('capitalises a dotted letter that does begin a word', () => {
    // ọ is a letter, not a boundary: at the front of a word it is raised like
    // any other, and Ọ is the letter Yoruba uses for it.
    assert.equal(titleCase('ọdundun'), 'Ọdundun');
    assert.equal(titleCase('ẹfọ ọdundun'), 'Ẹfọ Ọdundun');
  });

  it('raises the base letter without disturbing the mark riding on it', () => {
    // NFD: the acute is a separate code point after the vowel it belongs to.
    assert.equal(titleCase('éfo'), 'Éfo');
  });
});

describe('what the display convention is for', () => {
  it('gives a leading capital to sources that print a name lowercase', () => {
    assert.equal(titleCase('akú malapa'), 'Akú Malapa');
    assert.equal(titleCase('sábárúmá'), 'Sábárúmá');
  });

  it('steps over punctuation in front of a word', () => {
    assert.equal(titleCase('bodilohi (munjiriya)'), 'Bodilohi (Munjiriya)');
    assert.equal(titleCase('ewe –laa'), 'Ewe –Laa');
  });
});

describe('what it refuses to restyle', () => {
  it('keeps a hyphen compound spelled the way its source spelled it', () => {
    // 80 of the 83 hyphenated names print a lowercase second element. The site
    // quotes published names; capitalising after the hyphen overrules the source.
    assert.equal(titleCase('olug-bu'), 'Olug-bu');
    assert.equal(titleCase('Ata-igbó'), 'Ata-igbó');
    assert.equal(titleCase('Ekusi-Oloko'), 'Ekusi-Oloko');
  });

  it('leaves a slash compound alone for the same reason', () => {
    assert.equal(titleCase('Ariraa/ulogburu'), 'Ariraa/ulogburu');
    assert.equal(titleCase('Abrika/Okirima'), 'Abrika/Okirima');
  });

  it('touches nothing inside a word', () => {
    assert.equal(titleCase('mkpuru ugu'), 'Mkpuru Ugu');
    assert.equal(titleCase('MgbaAla'), 'MgbaAla');
  });
});

describe('the invariant', () => {
  it('changes case and nothing else, across every name on file', () => {
    // The bug added capitals; a future one could as easily drop a tone mark.
    // Case-folding both sides catches any edit that is not a change of case,
    // and the length check catches a mark being dropped or a letter doubled.
    const names = [...new Set(readJson('data', 'plants', 'vernacular_names.json').map((row) => row.local_name))];
    assert.ok(names.length > 900, `expected the published names, got ${names.length}`);

    for (const name of names) {
      const printed = titleCase(name);
      assert.equal(printed.toLowerCase(), name.toLowerCase(), `changed more than case: ${name}`);
      assert.equal(printed.length, name.length, `changed length: ${name}`);
    }
  });

  it('moves only the first letter of a word, across every name on file', () => {
    // The positions the helper is allowed to touch: the first letter of each
    // whitespace-separated word. A capital anywhere else has to be one the
    // source printed, which is the guarantee `\b[a-z]` broke.
    const names = [...new Set(readJson('data', 'plants', 'vernacular_names.json').map((row) => row.local_name))];

    for (const name of names) {
      const allowed = new Set();
      for (const word of name.matchAll(/\S+/gu)) {
        const letter = word[0].search(/\p{L}/u);
        if (letter !== -1) allowed.add(word.index + letter);
      }

      const printed = titleCase(name);
      for (let index = 0; index < name.length; index += 1) {
        if (printed[index] === name[index]) continue;
        assert.ok(allowed.has(index), `raised a letter mid-word: ${name} -> ${printed} (at ${index})`);
      }
    }
  });

  it('capitalises every word that opens with a lowercase letter', () => {
    const names = [...new Set(readJson('data', 'plants', 'vernacular_names.json').map((row) => row.local_name))];

    for (const name of names) {
      for (const word of titleCase(name).matchAll(/\S+/gu)) {
        const letter = [...word[0]].find((character) => /\p{L}/u.test(character));
        if (!letter) continue;
        assert.ok(!/\p{Ll}/u.test(letter), `word left uncapitalised: ${word[0]} (in ${name})`);
      }
    }
  });

  it('handles a missing name rather than throwing on one', () => {
    assert.equal(titleCase(null), '');
    assert.equal(titleCase(undefined), '');
    assert.equal(titleCase(''), '');
    assert.equal(titleCase('   '), '   ');
  });
});

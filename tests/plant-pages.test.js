// The published plant pages, as committed.
//
// CI rebuilds these pages and fails if they differ from the builder's output, so a
// check on the committed files is a check on the builder too. Each case below shipped
// once: 33 pages read "Abayin is a  name for ..." because the Rivers survey labels no
// language, and 365 read "... of Rivers State, Rivers State, Nigeria" because the state
// was appended to a locality that already named it.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const plantsDirectory = path.join(__dirname, '..', 'sanko-landing page', 'public', 'plants');

const pages = () =>
  fs
    .readdirSync(plantsDirectory, { recursive: true })
    .filter((file) => file.endsWith('index.html'))
    .map((file) => ({ file, html: fs.readFileSync(path.join(plantsDirectory, file), 'utf8') }));

const offenders = (pattern) => pages().filter(({ html }) => pattern.test(html)).map(({ file }) => file);

describe('published plant pages', () => {
  it('were found', () => {
    assert.ok(pages().length > 1000, 'expected the full resolver to be committed');
  });

  it('never leave a gap where the language name belongs', () => {
    assert.deepEqual(offenders(/ an? {2}(plant )?name|— {2}name|"eyebrow"> plant name|across \./), []);
  });

  it('never use the undetermined-language label as if it were a language', () => {
    assert.deepEqual(offenders(/(is an?|across) Language not identified/), []);
  });

  it('never show a bare language code where a language name belongs', () => {
    // "Gbere — nup name for ..." shipped once, before Nupe had a display name.
    assert.deepEqual(offenders(/(?:<title>|class="eyebrow">)[^<]*\b(?:und|[a-z]{2,3}) (?:plant )?name\b/), []);
  });

  it('never print a state twice in a location', () => {
    assert.deepEqual(offenders(/\b(\w+) State, \1 State\b/), []);
  });

  it('say "local name" for a name whose source records no language', () => {
    const html = fs.readFileSync(path.join(plantsDirectory, 'abayin', 'index.html'), 'utf8');
    assert.match(html, /Abayin is a local name for /);
    assert.match(html, /all local government areas of Rivers State, Nigeria\./);
  });
});

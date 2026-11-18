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

  it('use one label for a missing language everywhere', () => {
    // Table cells once said "unspecified language" while the index said "Language not identified".
    assert.deepEqual(offenders(/unspecified language/i), []);
  });

  it('count distinct local names, not survey records, on a botanical page', () => {
    // Orogbo is recorded by four surveys; the page once said 8 names for 5.
    const html = fs.readFileSync(path.join(plantsDirectory, 'botanical', 'garcinia-kola', 'index.html'), 'utf8');
    assert.match(html, /Garcinia kola is recorded under 5 local names/);
  });

  it('mark a suggested language as inferred and explain it', () => {
    const html = fs.readFileSync(path.join(plantsDirectory, 'botanical', 'garcinia-kola', 'index.html'), 'utf8');
    assert.match(html, /<td>Yoruba <span class="inferred">\(inferred\)<\/span><\/td>/);
    assert.match(html, /Inferred: the survey did not record this name's language/);
  });

  it('ship a name web whose links all point at real names, species and languages', () => {
    const web = JSON.parse(fs.readFileSync(path.join(plantsDirectory, 'web.json'), 'utf8'));
    assert.ok(web.names.length > 1000 && web.species.length > 400);
    for (const [name, species, language, inferred, records] of web.edges) {
      assert.ok(web.names[name] && web.species[species], 'edge points outside the lists');
      for (const code of [language, inferred].filter(Boolean)) assert.ok(web.languages[code], `no label for ${code}`);
      assert.ok(records >= 1);
    }
    // Each page the web focuses on exists, so "Open the page" never leads nowhere.
    for (const [slug] of web.species) assert.ok(fs.existsSync(path.join(plantsDirectory, 'botanical', slug, 'index.html')), slug);
    for (const [slug] of web.names) assert.ok(fs.existsSync(path.join(plantsDirectory, slug, 'index.html')), slug);
  });

  it('put the name web on botanical and name pages, focused on the page itself', () => {
    const botanical = fs.readFileSync(path.join(plantsDirectory, 'botanical', 'garcinia-kola', 'index.html'), 'utf8');
    assert.match(botanical, /data-plant-web data-focus-kind="species" data-focus="garcinia-kola"/);
    assert.match(botanical, /<script src="\/plants\/web.js" defer><\/script>/);
    const name = fs.readFileSync(path.join(plantsDirectory, 'orogbo', 'index.html'), 'utf8');
    assert.match(name, /data-focus-kind="name" data-focus="orogbo"/);
    // Hidden until the script has drawn it: without JavaScript the tables carry the same facts.
    assert.match(botanical, /data-plant-web[^>]* hidden /);
  });

  it('serve the web script exactly as written in scripts/', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'sanko-landing page', 'scripts', 'plant-web.client.js'), 'utf8');
    assert.equal(fs.readFileSync(path.join(plantsDirectory, 'web.js'), 'utf8'), source);
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

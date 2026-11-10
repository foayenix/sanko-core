// The "Ask Sanko" deep link on a plant page.
//
// The property that matters most here is the negative one: with no number configured the
// generator must produce no link, because a wa.me link to a number Sanko does not own
// opens a chat with a stranger.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const modulePath = new URL('../sanko-landing page/scripts/whatsapp-link.mjs', `file://${__filename}`).href;
const load = () => import(modulePath);

const SITE = 'https://www.sanko.africa';
const ewuro = { display: 'Ewuro', languageLabel: 'Yoruba', slug: 'ewuro', contested: false, site: SITE };

describe('whatsapp deep link', () => {
  it('produces no link at all when no number is configured', async () => {
    const { whatsappHref } = await load();
    for (const number of [undefined, null, '', '   ', '+', 'not a number']) {
      assert.equal(whatsappHref({ ...ewuro, number }), '', `"${number}" must not yield a link`);
    }
  });

  it('reduces a written number to the digits wa.me expects', async () => {
    const { normaliseNumber } = await load();
    assert.equal(normaliseNumber('+234 801 234 5678'), '2348012345678');
    assert.equal(normaliseNumber('+234-801-234-5678'), '2348012345678');
  });

  it('asks what the plant is, and says where the question came from', async () => {
    const { whatsappPrefill } = await load();
    const text = whatsappPrefill(ewuro);
    assert.match(text, /what plant is "Ewuro" \(Yoruba\)\?/);
    assert.match(text, /Asked from https:\/\/www\.sanko\.africa\/plants\/ewuro\//);
  });

  it('asks a contested name a different question, which does not ask for a winner', async () => {
    const { whatsappPrefill } = await load();
    const text = whatsappPrefill({ ...ewuro, display: 'Akoko', slug: 'akoko', contested: true });
    assert.match(text, /sources disagree/);
    assert.match(text, /What does each of them say\?/);
    assert.doesNotMatch(text, /which is (it|correct)/i);
  });

  it('encodes the prefill, so a name with punctuation cannot break the URL', async () => {
    const { whatsappHref } = await load();
    const href = whatsappHref({ ...ewuro, display: 'Abrika/Okirima', slug: 'abrika-okirima', number: '+2348012345678' });
    assert.ok(href.startsWith('https://wa.me/2348012345678?text='));
    assert.equal(href.includes('/Okirima'), false, 'the slash must be percent-encoded');
    assert.equal(decodeURIComponent(href.split('?text=')[1]).includes('Abrika/Okirima'), true);
  });
});

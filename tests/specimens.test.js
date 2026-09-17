// Specimens — a photographed plant, and the practitioner who named it (018).
//
// The cases below are mostly about what the system refuses to do. That is the
// point of the feature: the easy version of practitioner plant identification is
// one where a model proposes a species and a practitioner taps Yes, and the
// reason this one does not work that way is that the resulting dataset would be
// the model's guesses wearing practitioner attribution, with nothing in the rows
// to mark which was which.
//
// Everything here runs offline against the in-memory store.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeDb, fakeClient, textResponse, toolResponse } = require('./helpers/fakeDb');
const { runAgent } = require('../src/agent');
const { executeTool, TOOLS, _saidByPractitioner } = require('../src/agent/tools');
const plantLookup = require('../src/utils/plantLookup');

let fake;
beforeEach(() => { fake = installFakeDb(); });
afterEach(() => { fake.restore(); });

// A practitioner who has just sent a photo. save_specimen attaches to whatever
// photo is pending, exactly as save_formulation attaches its source media.
function withPhoto(overrides = {}) {
  const practitioner = fake.store.seedPractitioner(overrides);
  const media = { id: `media-${practitioner.id}`, practitioner_id: practitioner.id, kind: 'photo', transcript: null };
  fake.store.media.push(media);
  practitioner.pending_source_media_id = media.id;
  practitioner.pending_source_media_at = new Date().toISOString();
  return { practitioner, media };
}

// `currentUserText` is what the practitioner said this turn. It is the evidence
// the naming gate reads, so every context here has to carry it deliberately.
const ctx = (practitioner, currentUserText = '') => ({ practitioner, currentUserText });

// Fixtures drawn from the real runtime index, so a rebuild that changes what is
// resolvable fails these tests rather than letting them quietly test nothing.
const RESOLVED = 'abeere';        // → Hunteria umbellata
const AMBIGUOUS = 'abamoda';      // in the index, mapped to more than one taxon
const UNKNOWN = 'ewe ajidewe tuntun';

describe('specimen fixtures still describe the shipped index', () => {
  it('the resolved, ambiguous and unknown fixtures are what they claim', () => {
    assert.equal(plantLookup.lookup(RESOLVED)?.botanical, 'Hunteria umbellata');
    const ambiguous = plantLookup.lookup(AMBIGUOUS);
    assert.ok(ambiguous, `${AMBIGUOUS} should be in the index`);
    assert.equal(ambiguous.botanical, null, 'an ambiguous name carries a null botanical');
    assert.equal(plantLookup.lookup(UNKNOWN), null);
  });
});

// ─── the schema is the first line of defence ─────────────────────────────────

describe('save_specimen schema', () => {
  const tool = TOOLS.find(t => t.name === 'save_specimen');

  it('has no field a model could put a species name in', () => {
    // Structural, not advisory. A prompt asking the model not to guess a
    // binomial is a rule about abstention, and abstention is the class of rule
    // this stack's local model does not hold to. A missing field it cannot
    // argue with.
    const properties = Object.keys(tool.input_schema.properties);
    for (const forbidden of ['botanical', 'species', 'scientific_name', 'confidence', 'botanical_name']) {
      assert.ok(!properties.includes(forbidden), `save_specimen must not accept ${forbidden}`);
    }
    assert.deepEqual(tool.input_schema.required, ['local_name']);
  });

  it('rejects a botanical name offered anyway', async () => {
    const { practitioner } = withPhoto();
    const result = await executeTool(
      'save_specimen',
      { local_name: RESOLVED, botanical: 'Hunteria umbellata' },
      ctx(practitioner, `this one is ${RESOLVED}`)
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /not permitted/);
  });
});

// ─── the naming gate ─────────────────────────────────────────────────────────

describe('save_specimen only records a name the practitioner gave', () => {
  it('refuses a name that is not in what they said', async () => {
    const { practitioner } = withPhoto();
    const result = await executeTool(
      'save_specimen',
      { local_name: 'bitter leaf' },
      ctx(practitioner, 'here is a photo of one of my plants')
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /have not been told/);
    // And it tells the model the thing that actually matters, rather than only
    // that the call failed: offering a name to be agreed to is the failure mode.
    assert.match(result.error, /Do not offer them a name to agree to/);
    assert.equal(fake.store.specimens.length, 0);
  });

  it('records it when they did say it', async () => {
    const { practitioner } = withPhoto();
    const result = await executeTool(
      'save_specimen',
      { local_name: RESOLVED, part_used: 'bark' },
      ctx(practitioner, `this is ${RESOLVED}, I use the bark`)
    );
    assert.equal(result.ok, true);
    assert.match(result.short_code, /^SP-\d{5}$/);
    assert.equal(fake.store.specimens.length, 1);
    assert.equal(fake.store.specimens[0].local_name, RESOLVED);
    assert.equal(fake.store.specimens[0].part_used, 'bark');
  });

  it('matches the name through diacritics and case, as the index does', async () => {
    // A practitioner writing "Ewé Àbámodá" and a model echoing "ewe abamoda"
    // are the same name. Failing that comparison would refuse a perfectly good
    // record and teach whoever debugged it to loosen the gate instead.
    const { practitioner } = withPhoto();
    const result = await executeTool(
      'save_specimen',
      { local_name: 'ewe abamoda' },
      ctx(practitioner, 'Ewé Àbámodá ni eleyi')
    );
    assert.equal(result.ok, true);
  });

  it('is not fooled by a name that merely shares a word', () => {
    assert.equal(_saidByPractitioner('bitter leaf', 'this is a bitter root'), false);
    assert.equal(_saidByPractitioner('ewe abamoda', 'ewe abamoda ni'), true);
    assert.equal(_saidByPractitioner('', 'anything'), false);
    assert.equal(_saidByPractitioner('abeere', ''), false);
  });
});

// ─── resolution comes from the index, and says which of three things happened ─

describe('save_specimen resolves the binomial from the index, never from the photo', () => {
  it('attaches the mapping and stamps which build it came from', async () => {
    const { practitioner } = withPhoto();
    const result = await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `it is ${RESOLVED}`));

    assert.equal(result.identification, 'matched');
    assert.equal(result.botanical, 'Hunteria umbellata');
    const row = fake.store.specimens[0];
    assert.equal(row.botanical, 'Hunteria umbellata');
    assert.equal(row.botanical_source, 'plant_index');
    assert.equal(row.plant_data_version, plantLookup.dataVersion());
    // The mapping is about the name, not about the plant in the picture, and
    // the model is told so in the words it will paraphrase to the practitioner.
    assert.match(result.note, /not from the photo/);
  });

  it('records an ambiguous name with no species at all', async () => {
    const { practitioner } = withPhoto();
    const result = await executeTool('save_specimen', { local_name: AMBIGUOUS }, ctx(practitioner, `we call it ${AMBIGUOUS}`));

    assert.equal(result.ok, true);
    assert.equal(result.identification, 'ambiguous');
    assert.equal(result.botanical, null);
    assert.equal(fake.store.specimens[0].botanical, null);
    assert.equal(fake.store.specimens[0].botanical_source, null);
    assert.match(result.note, /more than one plant/);
    assert.match(result.note, /do not pick a species/i);
  });

  it('keeps an unknown name and sends it to the review queue', async () => {
    const { practitioner } = withPhoto();
    const result = await executeTool('save_specimen', { local_name: UNKNOWN }, ctx(practitioner, `this one we call ${UNKNOWN}`));

    assert.equal(result.ok, true);
    assert.equal(result.identification, 'unknown');
    assert.equal(result.botanical, null);

    // It reaches reviewers by the queue that already exists rather than a second
    // one nobody is watching.
    const flagged = fake.store.events.filter(e => e.event_type === 'unknown_plant_flagged');
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].payload.source, 'specimen');
    assert.deepEqual(flagged[0].payload.plants, [UNKNOWN]);
    assert.equal(flagged[0].payload.short_code, result.short_code);
  });

  it('raises nothing for a name the index could place', async () => {
    const { practitioner } = withPhoto();
    await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `it is ${RESOLVED}`));
    assert.equal(fake.store.events.filter(e => e.event_type === 'unknown_plant_flagged').length, 0);
  });
});

// ─── provenance ──────────────────────────────────────────────────────────────

describe('a specimen is a photograph plus a name', () => {
  it('refuses when no photo is pending', async () => {
    const practitioner = fake.store.seedPractitioner();
    const result = await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `it is ${RESOLVED}`));
    assert.equal(result.ok, false);
    assert.match(result.error, /no recent photo/);
    assert.equal(fake.store.specimens.length, 0);
  });

  it('will not attach a name to a photo sent more than a day ago', async () => {
    // The same 24-hour window save_formulation uses. A name arriving a week
    // after a photo is about some other plant, and silently pairing them would
    // produce a confident, wrong, permanently unfalsifiable record.
    const { practitioner } = withPhoto();
    practitioner.pending_source_media_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const result = await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `it is ${RESOLVED}`));
    assert.equal(result.ok, false);
    assert.match(result.error, /no recent photo/);
  });

  it('stores the practitioner region and never a photo location', async () => {
    const { practitioner } = withPhoto({ region: 'Plateau State' });
    await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `it is ${RESOLVED}`));

    const row = fake.store.specimens[0];
    assert.equal(row.region, 'Plateau State');
    for (const field of ['latitude', 'longitude', 'gps', 'exif', 'coordinates']) {
      assert.ok(!(field in row), `a specimen must not carry ${field}`);
    }
  });

  it('does not count the same photo named the same way twice', async () => {
    const { practitioner } = withPhoto();
    const first = await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `it is ${RESOLVED}`));
    const again = await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `it is ${RESOLVED}`));

    assert.equal(again.ok, true);
    assert.equal(again.already_recorded, true);
    assert.equal(again.short_code, first.short_code);
    assert.equal(fake.store.specimens.length, 1);
  });

  it('does not flag an unknown name twice for the same photo', async () => {
    // The review queue ranks by how often a name comes up, so a model repeating
    // itself must not read as a second practitioner using the name.
    const { practitioner } = withPhoto();
    await executeTool('save_specimen', { local_name: UNKNOWN }, ctx(practitioner, `it is ${UNKNOWN}`));
    await executeTool('save_specimen', { local_name: UNKNOWN }, ctx(practitioner, `it is ${UNKNOWN}`));
    assert.equal(fake.store.events.filter(e => e.event_type === 'unknown_plant_flagged').length, 1);
  });

  it('allows two plants laid out in one photograph', async () => {
    const { practitioner } = withPhoto();
    await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `${RESOLVED} and ${AMBIGUOUS}`));
    await executeTool('save_specimen', { local_name: AMBIGUOUS }, ctx(practitioner, `${RESOLVED} and ${AMBIGUOUS}`));
    assert.equal(fake.store.specimens.length, 2);
  });

  it('refuses a binomial with no provenance at the storage layer too', async () => {
    const db = require('../src/services/supabase');
    await assert.rejects(
      () => db.saveSpecimen({
        practitioner_id: 'p1', media_id: 'm1', local_name: 'x', local_name_normalised: 'x',
        botanical: 'Hunteria umbellata',
      }),
      /without its source and index version/
    );
  });
});

// ─── routing: which photos start this conversation at all ────────────────────

describe('a photo with no writing starts a specimen conversation', () => {
  const { buildContent } = require('../src/router');
  const whatsapp = require('../src/services/whatsapp');
  const vision = require('../src/services/vision');

  let originals;
  beforeEach(() => {
    originals = { downloadMedia: whatsapp.downloadMedia, transcribePage: vision.transcribePage };
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });
  });
  afterEach(() => {
    whatsapp.downloadMedia = originals.downloadMedia;
    vision.transcribePage = originals.transcribePage;
  });

  const photo = async practitioner => buildContent([{ type: 'image', image: { id: 'i1' } }], practitioner);

  it('asks what the plant is instead of reporting an absence', async () => {
    const p = fake.store.seedPractitioner();
    vision.transcribePage = async () => ({ text: '', confidence: 0, unreadable: 0, model: 'qwen2.5vl:7b', provider: 'ollama', error: null });

    const blocks = await photo(p);
    const text = blocks.at(-1).text;
    assert.match(text, /no writing on it/);
    assert.match(text, /what THEY call it/);
    assert.match(text, /save_specimen/);
    // The instruction that carries the whole design.
    assert.match(text, /Never name the plant yourself/);
    assert.match(text, /never offer them a name to agree to/);
    // And it does not assert that the photo IS a plant — the same empty reading
    // comes back from a photo of a bottle.
    assert.match(text, /may be a plant/);
  });

  it('leaves a photographed page alone', async () => {
    const p = fake.store.seedPractitioner();
    vision.transcribePage = async () => ({
      text: 'Agbo iba\nEwe dongoyaro', confidence: 1, unreadable: 0, model: 'qwen2.5vl:7b', provider: 'ollama', error: null,
    });

    const text = (await photo(p)).at(-1).text;
    assert.match(text, /notebook page/);
    assert.doesNotMatch(text, /save_specimen/);
  });

  it('does not invite a naming when the reading simply failed', async () => {
    // A model that is not installed is not evidence that the photo has no
    // writing on it. Treating the two the same would ask a practitioner to name
    // a plant in a picture of their own notebook.
    const p = fake.store.seedPractitioner();
    vision.transcribePage = async () => ({ text: '', confidence: 0, unreadable: 0, model: 'qwen2.5vl:7b', provider: 'ollama', error: 'model not found' });

    const text = (await photo(p)).at(-1).text;
    assert.match(text, /could not be read/);
    assert.doesNotMatch(text, /save_specimen/);
  });

  it('does not invite a naming when page reading is switched off', async () => {
    // Same reason: VISION_BACKEND=off tells you nothing about the photo.
    const p = fake.store.seedPractitioner();
    vision.transcribePage = async () => ({ text: '', confidence: 0, unreadable: 0, model: null, provider: null, error: null, skipped: true });

    const text = (await photo(p)).at(-1).text;
    assert.match(text, /switched off/);
    assert.doesNotMatch(text, /save_specimen/);
  });

  it('archives the photo either way, so a name can be attached to it later', async () => {
    const p = fake.store.seedPractitioner();
    vision.transcribePage = async () => ({ text: '', confidence: 0, unreadable: 0, model: 'qwen2.5vl:7b', provider: 'ollama', error: null });

    await photo(p);
    assert.equal(fake.store.media.length, 1);
    assert.equal(fake.store.media[0].kind, 'photo');
    assert.equal(p.pending_source_media_id, fake.store.media[0].id);
  });
});

// ─── the whole flow, through the real agent loop ─────────────────────────────

describe('end to end: a photographed plant becomes a record', () => {
  const { buildContent } = require('../src/router');
  const whatsapp = require('../src/services/whatsapp');
  const vision = require('../src/services/vision');

  let originals;
  beforeEach(() => {
    originals = { downloadMedia: whatsapp.downloadMedia, transcribePage: vision.transcribePage };
    whatsapp.downloadMedia = async () => ({ buffer: Buffer.from('jpegdata'), mimeType: 'image/jpeg' });
    vision.transcribePage = async () => ({ text: '', confidence: 0, unreadable: 0, model: 'qwen2.5vl:7b', provider: 'ollama', error: null });
  });
  afterEach(() => {
    whatsapp.downloadMedia = originals.downloadMedia;
    vision.transcribePage = originals.transcribePage;
  });

  it('asks on the photo turn, records on the answer turn, and never names the plant itself', async () => {
    const practitioner = fake.store.seedPractitioner();
    const sent = [];
    const send = async text => { sent.push(text); };

    // Turn one: the photo arrives. A well-behaved agent asks rather than names.
    const content = await buildContent([{ type: 'image', image: { id: 'i1' } }], practitioner);
    await runAgent({
      practitioner,
      content,
      send,
      client: fakeClient([textResponse('What is this one? What do you call it?')]),
    });
    assert.equal(fake.store.specimens.length, 0, 'nothing is recorded until they have said what it is');
    assert.equal(fake.store.media.length, 1, 'but the photo is already archived');

    // Turn two: they answer, and the agent records what they said.
    await runAgent({
      practitioner,
      content: `We call it ${RESOLVED}. I use the bark.`,
      send,
      client: fakeClient([
        toolResponse('save_specimen', { local_name: RESOLVED, part_used: 'bark' }),
        textResponse(`Written down — ${RESOLVED}, the bark.`),
      ]),
    });

    assert.equal(fake.store.specimens.length, 1);
    const specimen = fake.store.specimens[0];
    assert.equal(specimen.local_name, RESOLVED);
    assert.equal(specimen.part_used, 'bark');
    assert.equal(specimen.botanical, 'Hunteria umbellata');
    // Attached to the photo from the previous turn, which is the whole point of
    // the pending-media window.
    assert.equal(specimen.media_id, fake.store.media[0].id);
  });

  it('refuses the save when the agent names the plant on the photo turn', async () => {
    // The failure this feature is built to prevent: the model looks at a green
    // leaf and records "bitter leaf" as though it had been told. The gate is
    // what stands between that and the archive, and it runs inside the real
    // loop rather than only in a direct tool call.
    const practitioner = fake.store.seedPractitioner();
    const sent = [];

    const content = await buildContent([{ type: 'image', image: { id: 'i1' } }], practitioner);
    const { toolCalls } = await runAgent({
      practitioner,
      content,
      send: async text => { sent.push(text); },
      client: fakeClient([
        toolResponse('save_specimen', { local_name: 'bitter leaf' }),
        textResponse('What do you call this one?'),
      ]),
    });

    assert.equal(fake.store.specimens.length, 0);
    assert.equal(toolCalls[0].result.ok, false);
    assert.match(toolCalls[0].result.error, /have not been told/);
    // The practitioner is asked, not told the machinery failed.
    assert.ok(sent.length > 0);
    assert.doesNotMatch(sent.join(' '), /error|failed|tool/i);
  });
});

// ─── the queue a specimen name lands in ──────────────────────────────────────

describe('an unresolved specimen name reaches the existing review queue', () => {
  const { buildQueue } = require('../scripts/plant-review');

  it('queues a specimen-sourced name that has no formulation behind it', () => {
    // listUnknownPlantEvents looks a formulation up by short_code to attach the
    // speech that motivated the flag. A specimen has no formulation, so it
    // arrives with `formulation: null` and must queue anyway — the name is the
    // reviewable thing, and the context is a bonus rather than a requirement.
    const queue = buildQueue([
      { id: 'e1', created_at: '2026-09-12T10:00:00Z', formulation: null,
        payload: { short_code: 'SP-00005', plants: [UNKNOWN], source: 'specimen' } },
    ]);

    assert.equal(queue.length, 1);
    assert.equal(queue[0].normalized_name, plantLookup.normalizeLocalName(UNKNOWN));
    assert.equal(queue[0].decision, 'pending');
    assert.deepEqual(queue[0].contexts, []);
  });

  it('still drops a specimen name the index can already place', () => {
    const resolved = new Set([plantLookup.normalizeLocalName(RESOLVED)]);
    const queue = buildQueue(
      [{ id: 'e1', created_at: '2026-09-12T10:00:00Z', formulation: null,
         payload: { short_code: 'SP-00001', plants: [RESOLVED], source: 'specimen' } }],
      [],
      { resolved }
    );
    assert.equal(queue.length, 0);
  });
});

// ─── the rest of the surface ─────────────────────────────────────────────────

describe('specimens and the wider system', () => {
  it('is unavailable until registration is finished', async () => {
    // Same reason a formulation is: a specimen with no named owner and no region
    // is a mapping no reviewer can check.
    const practitioner = fake.store.seedPractitioner({ display_name: null, region: null });
    const result = await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `it is ${RESOLVED}`));
    assert.equal(result.ok, false);
    assert.match(result.error, /Registration is not finished/);
  });

  it('lists what the practitioner has recorded, newest first', async () => {
    const { practitioner } = withPhoto();
    await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `${RESOLVED} and ${AMBIGUOUS}`));
    await executeTool('save_specimen', { local_name: AMBIGUOUS }, ctx(practitioner, `${RESOLVED} and ${AMBIGUOUS}`));

    const result = await executeTool('list_specimens', {}, ctx(practitioner));
    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    assert.equal(result.specimens[0].local_name, AMBIGUOUS);
    assert.equal(result.specimens[0].botanical, null);
    assert.equal(result.specimens[1].botanical, 'Hunteria umbellata');
  });

  it('shows only this practitioner their own specimens', async () => {
    const a = withPhoto();
    const b = withPhoto();
    await executeTool('save_specimen', { local_name: RESOLVED }, ctx(a.practitioner, `it is ${RESOLVED}`));

    const result = await executeTool('list_specimens', {}, ctx(b.practitioner));
    assert.equal(result.count, 0);
  });

  it('includes specimens in the account export', async () => {
    // Whatever Sanko holds about someone has to come back to them on request.
    const { practitioner } = withPhoto();
    await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `it is ${RESOLVED}`));

    const account = await require('../src/services/supabase').exportAccount(practitioner.id);
    assert.equal(account.specimens.length, 1);
    assert.equal(account.specimens[0].local_name, RESOLVED);
  });

  it('offers the specimen tools in the default vault profile', () => {
    // A tool the model cannot see is a question it cannot ask, and photographing
    // plants is core documentation rather than patient tracking.
    const { selectTools } = require('../src/agent/tools');
    const names = selectTools('vault').map(t => t.name);
    assert.ok(names.includes('save_specimen'));
    assert.ok(names.includes('list_specimens'));
  });

  it('queues unresolved specimens for review and leaves resolved ones alone', async () => {
    const { practitioner } = withPhoto();
    await executeTool('save_specimen', { local_name: RESOLVED }, ctx(practitioner, `${RESOLVED} and ${UNKNOWN}`));
    await executeTool('save_specimen', { local_name: UNKNOWN }, ctx(practitioner, `${RESOLVED} and ${UNKNOWN}`));

    const queue = await require('../src/services/supabase').listUnresolvedSpecimens();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].local_name, UNKNOWN);
  });
});

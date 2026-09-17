// The three feedback sources 011 opened up (C, D) and the eval hold-out (E).
//
// Everything runs against the in-memory database — no keys, no network.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeDb } = require('./helpers/fakeDb');
const db = require('../src/services/supabase');

let fake;
beforeEach(() => { fake = installFakeDb(); });
afterEach(() => { fake.restore(); });

function seedFormulation(overrides = {}) {
  const practitioner = fake.store.seedPractitioner();
  return fake.store.seedFormulation(practitioner.id, {
    condition_std: 'Fever',
    original_text: 'Mo fi ewe dongoyaro se agbo fun iba',
    original_language: 'yo',
    model: 'qwen2.5:32b',
    ...overrides,
  });
}

describe('admin review (C)', () => {
  it('records a proposal without changing the practitioner record', async () => {
    const formulation = seedFormulation();

    const result = await db.recordAdminReview({
      short_code: formulation.short_code,
      field: 'condition_std',
      after: 'Malaria',
      reviewer_ref: 'RT-A1B2',
      note: 'iba is malaria, not fever generally',
    });

    assert.equal(result.before, 'Fever');
    assert.equal(result.after, 'Malaria');
    // The Vault is the practitioner's. A reviewer proposes; they decide.
    assert.equal(fake.store.formulations[0].condition_std, 'Fever');

    const correction = fake.store.corrections[0];
    assert.equal(correction.source, 'admin_review');
    assert.equal(correction.reviewer_ref, 'RT-A1B2');
    assert.equal(correction.before_value, 'Fever');
    assert.equal(correction.after_value, 'Malaria');
  });

  it('attributes the proposal to the model that produced the record, not the configured one', async () => {
    const formulation = seedFormulation({ model: 'retired-adapter-v1' });
    await db.recordAdminReview({ short_code: formulation.short_code, field: 'condition_std', after: 'Malaria', reviewer_ref: 'RT-A1B2' });

    assert.equal(fake.store.corrections[0].model, 'retired-adapter-v1');
  });

  it('leaves an attributable event', async () => {
    const formulation = seedFormulation();
    await db.recordAdminReview({ short_code: formulation.short_code, field: 'notes', after: 'Checked', reviewer_ref: 'RT-A1B2' });

    assert.equal(fake.store.eventsOfType('admin_review_proposed').length, 1);
  });

  it('refuses a short code that is not in the Vault', async () => {
    await assert.rejects(
      () => db.recordAdminReview({ short_code: 'FM-99999', field: 'notes', after: 'x', reviewer_ref: 'RT-A1B2' }),
      /FM-99999/,
    );
  });
});

describe('transcript review (D)', () => {
  async function seedVoiceNote(transcript) {
    const practitioner = fake.store.seedPractitioner();
    return db.saveMedia({ practitioner_id: practitioner.id, kind: 'voice', storage_path: 'voice/x.ogg', transcript });
  }

  it('keeps the machine output as the before-value while replacing the stored transcript', async () => {
    const media = await seedVoiceNote('I am working on a fever remedy');

    const result = await db.recordTranscriptReview({
      media_id: media.id,
      transcript: 'Mo n sise lori agbo iba',
      reviewer_ref: 'RT-A1B2',
    });

    assert.equal(result.changed, true);
    // The corrected text is what downstream reads…
    assert.equal(fake.store.media[0].transcript, 'Mo n sise lori agbo iba');
    // …and the pair a Whisper fine-tune needs is preserved.
    const correction = fake.store.corrections[0];
    assert.equal(correction.field, 'transcript');
    assert.equal(correction.media_id, media.id);
    assert.equal(correction.before_value, 'I am working on a fever remedy');
    assert.equal(correction.formulation_id, null);
  });

  it('records nothing when the transcript is unchanged', async () => {
    const media = await seedVoiceNote('same text');
    const result = await db.recordTranscriptReview({ media_id: media.id, transcript: 'same text', reviewer_ref: 'RT-A1B2' });

    assert.equal(result.changed, false);
    assert.equal(fake.store.corrections.length, 0);
  });

  it('marks a voice note as reviewed in the queue once corrected', async () => {
    const media = await seedVoiceNote('wrong');
    let queue = await db.adminGetTranscriptQueue();
    assert.equal(queue[0].reviewed_at, null);

    await db.recordTranscriptReview({ media_id: media.id, transcript: 'right', reviewer_ref: 'RT-A1B2' });
    queue = await db.adminGetTranscriptQueue();

    assert.ok(queue[0].reviewed_at);
    assert.equal(queue[0].reviewed_by, 'RT-A1B2');
  });
});

describe('page review (D, 015)', () => {
  async function seedPage(transcript, overrides = {}) {
    const practitioner = fake.store.seedPractitioner();
    const media = await db.saveMedia({
      practitioner_id: practitioner.id,
      kind: 'photo',
      storage_path: 'photos/x.jpg',
      transcript,
      transcript_model: 'qwen2.5vl:7b',
      transcript_provider: 'ollama',
      transcript_confidence: 0.8,
      ...overrides,
    });
    return { practitioner, media };
  }

  it('files a page correction under its own field, never as a transcript', async () => {
    // A page correction trains the vision model and an audio correction trains
    // Whisper. Pooled, each would be trained on the other's failures.
    const { media } = await seedPage('Agbo iba: ewe dongoyoro');

    const result = await db.recordTranscriptReview({
      media_id: media.id,
      transcript: 'Agbo ibà: ewé dòngòyárò',
      reviewer_ref: 'RT-A1B2',
    });

    assert.equal(result.field, 'page_transcript');
    assert.equal(result.kind, 'photo');
    assert.equal(fake.store.corrections[0].field, 'page_transcript');
    assert.equal(fake.store.corrections[0].before_value, 'Agbo iba: ewe dongoyoro');
    assert.equal(fake.store.media[0].transcript, 'Agbo ibà: ewé dòngòyárò');
  });

  it('attributes the mistake to the model that actually read the page', async () => {
    const { media } = await seedPage('wrong reading');
    await db.recordTranscriptReview({ media_id: media.id, transcript: 'right reading', reviewer_ref: 'RT-A1B2' });

    // Not the currently configured model: which model made this mistake is a
    // fact about the row, and swapping VISION_MODEL must not rewrite history.
    assert.equal(fake.store.corrections[0].model, 'qwen2.5vl:7b');
    assert.equal(fake.store.corrections[0].provider, 'ollama');
  });

  it('names the records built on the old reading instead of rewriting them', async () => {
    const { practitioner, media } = await seedPage('ewe dongoyoro');
    const formulation = fake.store.seedFormulation(practitioner.id, { source_media_id: media.id, condition_std: 'Malaria' });

    const result = await db.recordTranscriptReview({ media_id: media.id, transcript: 'ewé dòngòyárò', reviewer_ref: 'RT-A1B2' });

    // The record is the practitioner's, so the control room reports it rather
    // than editing it — but it must not stay silently resting on a misreading.
    assert.deepEqual(result.affected.map(row => row.short_code), [formulation.short_code]);
    assert.equal(fake.store.formulations[0].condition_std, 'Malaria');
  });

  it('shows pages and voice notes in one queue, each with what read it', async () => {
    const { media: page } = await seedPage('a page');
    const practitioner = fake.store.seedPractitioner();
    await db.saveMedia({ practitioner_id: practitioner.id, kind: 'voice', storage_path: 'voice/x.ogg', transcript: 'a voice note' });

    const queue = await db.adminGetTranscriptQueue();
    assert.deepEqual(queue.map(row => row.kind).sort(), ['photo', 'voice']);

    await db.recordTranscriptReview({ media_id: page.id, transcript: 'a corrected page', reviewer_ref: 'RT-A1B2' });
    const after = await db.adminGetTranscriptQueue();
    assert.ok(after.find(row => row.kind === 'photo').reviewed_at);
    assert.equal(after.find(row => row.kind === 'voice').reviewed_at, null);
  });

  it('offers a corrected page to the vision export and only once', async () => {
    const { media } = await seedPage('machine reading');
    await db.recordTranscriptReview({ media_id: media.id, transcript: 'human reading', reviewer_ref: 'RT-A1B2' });

    const pending = await db.listPageCorrectionsForExport();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].after_value, 'human reading');
    assert.equal(pending[0].media.storage_path, 'photos/x.jpg');

    await db.markCorrectionsExported([pending[0].id]);
    assert.equal((await db.listPageCorrectionsForExport()).length, 0);
    assert.equal((await db.listPageCorrectionsForExport({ onlyUnexported: false })).length, 1);
  });

  it('refuses to correct a reading on something that has none', async () => {
    const practitioner = fake.store.seedPractitioner();
    const media = await db.saveMedia({ practitioner_id: practitioner.id, kind: 'text', storage_path: 'exports/x.json' });

    await assert.rejects(
      () => db.recordTranscriptReview({ media_id: media.id, transcript: 'anything', reviewer_ref: 'RT-A1B2' }),
      /only voice notes and photos/,
    );
  });
});

describe('eval hold-out (E)', () => {
  it('excludes a held-out correction from the training export', async () => {
    const formulation = seedFormulation();
    await db.recordCorrection({
      practitioner_id: formulation.practitioner_id,
      formulation_id: formulation.id,
      field: 'condition_std', before: 'Fever', after: 'Malaria',
    });

    assert.equal((await db.listCorrectionsForExport({})).length, 1);

    await db.markCorrectionsHeldOut([{ id: fake.store.corrections[0].id, case_id: 'draft-fm-00001-condition-std-abc12345' }]);

    // The separation that keeps the eval honest: a model must never be graded on
    // an example it was trained on.
    assert.equal((await db.listCorrectionsForExport({})).length, 0);
    assert.equal((await db.listCorrectionsForExport({ onlyUnexported: false })).length, 0);
  });

  it('gives a hold-out back when its draft is discarded', async () => {
    const formulation = seedFormulation();
    await db.recordCorrection({ practitioner_id: formulation.practitioner_id, formulation_id: formulation.id, field: 'dosage', before: null, after: 'one cup' });
    const id = fake.store.corrections[0].id;

    await db.markCorrectionsHeldOut([{ id, case_id: 'draft-x' }]);
    assert.equal((await db.listHeldOutCorrections()).length, 1);

    await db.releaseHeldOutCorrections([id]);

    assert.equal((await db.listHeldOutCorrections()).length, 0);
    assert.equal((await db.listCorrectionsForExport({})).length, 1);
  });

  it('offers a correction for drafting only once', async () => {
    const formulation = seedFormulation();
    await db.recordCorrection({ practitioner_id: formulation.practitioner_id, formulation_id: formulation.id, field: 'plants', before: [], after: [{ local_name: 'dongoyaro' }] });

    assert.equal((await db.listCorrectionsForEvalDrafting()).length, 1);
    await db.markCorrectionsHeldOut([{ id: fake.store.corrections[0].id, case_id: 'draft-x' }]);
    assert.equal((await db.listCorrectionsForEvalDrafting()).length, 0);
  });

  it('does not offer a transcript correction for drafting — there is no formulation to build a case from', async () => {
    const practitioner = fake.store.seedPractitioner();
    const media = await db.saveMedia({ practitioner_id: practitioner.id, kind: 'voice', storage_path: 'voice/x.ogg', transcript: 'wrong' });
    await db.recordTranscriptReview({ media_id: media.id, transcript: 'right', reviewer_ref: 'RT-A1B2' });

    assert.equal((await db.listCorrectionsForEvalDrafting()).length, 0);
  });
});

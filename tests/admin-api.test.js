// The control room's write endpoints, driven over real HTTP.
//
// The router is mounted on a throwaway Express app on an ephemeral port and the
// database is the in-memory fake, so this exercises auth, the CSRF header, JSON
// parsing, validation and the persistence path exactly as deployed — no keys.

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { installFakeDb } = require('./helpers/fakeDb');
const db = require('../src/services/supabase');

const PASSWORD = 'test-admin-password';
const OPERATOR_REF = 'OP-4C21';
const AUTH = 'Basic ' + Buffer.from(`felix:${PASSWORD}`).toString('base64');

let server;
let base;
let fake;

before(async () => {
  // An allowlisted account, not the legacy shared password: the reviewer
  // reference on every write below comes from here.
  const { hashPassword } = require('../src/utils/adminAccounts');
  process.env.ADMIN_ACCOUNTS = `felix:${OPERATOR_REF}:${hashPassword(PASSWORD)}`;
  delete process.env.ADMIN_PASSWORD;
  const app = express();
  app.use('/admin', require('../src/admin'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  delete process.env.ADMIN_ACCOUNTS;
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => { fake = installFakeDb(); });
afterEach(() => { fake.restore(); });

function post(path, body, { auth = AUTH, csrf = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  if (csrf) headers['X-Sanko-Admin'] = '1';
  return fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
}

function seedFormulation() {
  const practitioner = fake.store.seedPractitioner();
  return fake.store.seedFormulation(practitioner.id, { condition_std: 'Fever', model: 'qwen2.5:32b' });
}

describe('admin write endpoints', () => {
  it('records a proposed correction and leaves the record alone', async () => {
    const formulation = seedFormulation();

    const response = await post('/admin/api/review/correction', {
      short_code: formulation.short_code,
      field: 'condition_std',
      after_value: 'Malaria',
      note: 'iba is malaria',
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.after, 'Malaria');
    assert.equal(fake.store.corrections.length, 1);
    assert.equal(fake.store.formulations[0].condition_std, 'Fever');
    // Attribution comes from the authenticated account, not from the request.
    assert.equal(fake.store.corrections[0].reviewer_ref, OPERATOR_REF);
  });

  it('rejects an unauthenticated write', async () => {
    const formulation = seedFormulation();
    const response = await post('/admin/api/review/correction',
      { short_code: formulation.short_code, field: 'notes', after_value: 'x' },
      { auth: null });

    assert.equal(response.status, 401);
    assert.equal(fake.store.corrections.length, 0);
  });

  it('rejects a write without the custom header, which is what stops a cross-site post', async () => {
    // Basic Auth alone would not: the browser attaches cached credentials to a
    // cross-site form post. A custom header forces a preflight this server never
    // answers.
    const formulation = seedFormulation();
    const response = await post('/admin/api/review/correction',
      { short_code: formulation.short_code, field: 'notes', after_value: 'x' },
      { csrf: false });

    assert.equal(response.status, 400);
    assert.equal(fake.store.corrections.length, 0);
  });

  it('refuses a reviewer reference supplied by the caller', async () => {
    // The whole point of allowlisted accounts: an attribution you can type is
    // not an attribution. Anything but the operator's own reference is refused
    // rather than quietly ignored, so a caller cannot believe it took effect.
    const formulation = seedFormulation();
    for (const reviewer_ref of ['RT-A1B2', '+2348012345678', 'Baba Ade', '']) {
      const response = await post('/admin/api/review/correction', {
        short_code: formulation.short_code, field: 'notes', after_value: 'x', reviewer_ref,
      });
      assert.equal(response.status, 400, reviewer_ref);
    }
    assert.equal(fake.store.corrections.length, 0);
  });

  it('rejects a password that is not the account password', async () => {
    const formulation = seedFormulation();
    const response = await post('/admin/api/review/correction',
      { short_code: formulation.short_code, field: 'notes', after_value: 'x' },
      { auth: 'Basic ' + Buffer.from('felix:wrong-password').toString('base64') });

    assert.equal(response.status, 401);
    assert.equal(fake.store.corrections.length, 0);
  });

  it('refuses a field that is not part of a formulation', async () => {
    const formulation = seedFormulation();
    const response = await post('/admin/api/review/correction', {
      short_code: formulation.short_code, field: 'practitioner_id', after_value: 'someone-else',
    });

    assert.equal(response.status, 400);
    assert.equal(fake.store.corrections.length, 0);
  });

  it('refuses an empty proposed value', async () => {
    const formulation = seedFormulation();
    const response = await post('/admin/api/review/correction', {
      short_code: formulation.short_code, field: 'notes', after_value: '',
    });

    assert.equal(response.status, 400);
  });

  it('saves a corrected transcript and reports the change', async () => {
    const practitioner = fake.store.seedPractitioner();
    const media = await db.saveMedia({ practitioner_id: practitioner.id, kind: 'voice', storage_path: 'voice/a.ogg', transcript: 'wrong text' });

    const response = await post('/admin/api/review/transcript', {
      media_id: media.id, transcript: 'Mo n sise lori agbo iba',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, media_id: media.id, kind: 'voice', field: 'transcript', changed: true, affected: [] });
    assert.equal(fake.store.media[0].transcript, 'Mo n sise lori agbo iba');
    assert.equal(fake.store.corrections[0].before_value, 'wrong text');
    assert.equal(fake.store.corrections[0].reviewer_ref, OPERATOR_REF);
  });

  it('refuses a blank transcript rather than erasing one', async () => {
    const practitioner = fake.store.seedPractitioner();
    const media = await db.saveMedia({ practitioner_id: practitioner.id, kind: 'voice', storage_path: 'voice/a.ogg', transcript: 'real text' });

    const response = await post('/admin/api/review/transcript', { media_id: media.id, transcript: '   ' });

    assert.equal(response.status, 400);
    assert.equal(fake.store.media[0].transcript, 'real text');
  });

  it('rejects an unauthenticated read of a voice note', async () => {
    const response = await fetch(`${base}/admin/api/media/anything/audio`);
    assert.equal(response.status, 401);
  });
});

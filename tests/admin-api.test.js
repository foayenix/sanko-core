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

describe('landing sign-ups', () => {
  const decide = (id, body, options) => post(`/admin/api/signups/applications/${id}/decision`, body, options);

  it('approves a pending application and attributes it to the signed-in operator', async () => {
    const application = fake.store.seedApplication();

    const response = await decide(application.id, { decision: 'approve' });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.ok(body.approved_at);
    assert.equal(fake.store.testApplications[0].decided_by, OPERATOR_REF);
    assert.equal(fake.store.testApplications[0].declined_at, null);
  });

  it('declines with an internal note', async () => {
    const application = fake.store.seedApplication();

    const response = await decide(application.id, { decision: 'decline', note: '  Not a practitioner  ' });

    assert.equal(response.status, 200);
    assert.ok(fake.store.testApplications[0].declined_at);
    assert.equal(fake.store.testApplications[0].decision_note, 'Not a practitioner');
  });

  it('refuses to overturn a decision that has already been made', async () => {
    const application = fake.store.seedApplication();
    await decide(application.id, { decision: 'decline' });

    const response = await decide(application.id, { decision: 'approve' });

    assert.equal(response.status, 409);
    assert.equal(fake.store.testApplications[0].approved_at, null);
  });

  it('refuses an unknown decision, an oversized note, a missing header and no credentials', async () => {
    const application = fake.store.seedApplication();

    assert.equal((await decide(application.id, { decision: 'delete' })).status, 400);
    assert.equal((await decide(application.id, { decision: 'decline', note: 'x'.repeat(1001) })).status, 400);
    assert.equal((await decide(application.id, { decision: 'approve' }, { csrf: false })).status, 400);
    assert.equal((await decide(application.id, { decision: 'approve' }, { auth: null })).status, 401);
    assert.equal(fake.store.testApplications[0].approved_at, null);
  });

  it('refuses a reviewer reference typed into the request', async () => {
    const application = fake.store.seedApplication();
    const response = await decide(application.id, { decision: 'approve', reviewer_ref: 'OP-FAKE1' });
    assert.equal(response.status, 400);
    assert.equal(fake.store.testApplications[0].approved_at, null);
  });

  it('marks an enquiry answered once', async () => {
    const enquiry = fake.store.seedEnquiry();

    const first = await post(`/admin/api/signups/enquiries/${enquiry.id}/responded`, {});
    const second = await post(`/admin/api/signups/enquiries/${enquiry.id}/responded`, {});

    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(fake.store.partnershipEnquiries[0].responded_by, OPERATOR_REF);
  });

  it('lists sign-ups in the control room with what strangers typed escaped', async () => {
    fake.store.seedApplication({ name: '<script>alert(1)</script>', phone_number: '+2348099990000' });
    fake.store.seedEnquiry({ message: '<img src=x onerror=alert(1)>' });

    const response = await fetch(`${base}/admin`, { headers: { Authorization: AUTH } });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /data-view="signups"/);
    assert.match(html, /\+2348099990000/);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it('puts website page views next to applications, and says when they are not connected', async () => {
    const analytics = require('../src/services/siteAnalytics');
    const original = analytics.getSiteTraffic;
    fake.store.seedApplication();
    fake.store.seedApplication();
    try {
      const page = async () => (await fetch(`${base}/admin`, { headers: { Authorization: AUTH } })).text();

      analytics.getSiteTraffic = async () => ({ configured: false });
      assert.match(await page(), /Not connected\. Set <code>VERCEL_ANALYTICS_TOKEN<\/code>/);

      analytics.getSiteTraffic = async () => ({ configured: true, ok: true, last7: 50, last30: 200, topPaths: [{ path: '/<b>', views: 9 }], fetched_at: new Date().toISOString() });
      const html = await page();
      assert.match(html, /Page views · 30 days<\/span><strong>200</);
      // 2 applications in 30 days over 200 views.
      assert.match(html, /Applications per view<\/span><strong>1\.0%</);
      assert.match(html, /\/&lt;b&gt;/);
    } finally {
      analytics.getSiteTraffic = original;
    }
  });

  it('keeps the rest of the control room when the sign-up tables are missing', async () => {
    db.adminGetSignups = async () => { throw new Error('relation "test_applications" does not exist'); };

    const response = await fetch(`${base}/admin`, { headers: { Authorization: AUTH } });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Sign-ups could not be loaded/);
    assert.match(html, /data-view="practitioners"/);
  });
});

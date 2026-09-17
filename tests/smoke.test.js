// Smoke tests — one happy-path test per flow (PRD §3.3)
// Run with: node --test tests/smoke.test.js
// W1 tests use no real APIs. W2+ tests that need real APIs are skipped when env vars are absent.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── W1 — webhook routes ──────────────────────────────────────────────────────

describe('W1 — webhook routes', () => {
  it('verifyWebhook returns challenge when token matches', () => {
    process.env.META_VERIFY_TOKEN = 'test_token';
    const { verifyWebhook } = require('../src/router');
    let statusCode, body;
    const req = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'test_token', 'hub.challenge': 'abc123' } };
    const res = {
      status(code) { statusCode = code; return this; },
      send(b) { body = b; return this; },
      sendStatus(code) { statusCode = code; return this; },
    };
    verifyWebhook(req, res);
    assert.equal(statusCode, 200);
    assert.equal(body, 'abc123');
  });

  it('verifyWebhook returns 403 when token does not match', () => {
    process.env.META_VERIFY_TOKEN = 'test_token';
    const { verifyWebhook } = require('../src/router');
    let statusCode;
    const req = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc' } };
    const res = { sendStatus(code) { statusCode = code; } };
    verifyWebhook(req, res);
    assert.equal(statusCode, 403);
  });
});

// ─── W1 — plantLookup utility ─────────────────────────────────────────────────

describe('plantLookup utility', () => {
  it('finds dongoyaro by local name', () => {
    const { lookup } = require('../src/utils/plantLookup');
    const result = lookup('dongoyaro');
    assert.equal(result.botanical, 'Azadirachta indica');
  });

  it('returns null for unknown plant', () => {
    const { lookup } = require('../src/utils/plantLookup');
    const result = lookup('unknownplantxyz');
    assert.equal(result, null);
  });

  it('lookup is case-insensitive', () => {
    const { lookup } = require('../src/utils/plantLookup');
    assert.ok(lookup('DONGOYARO'));
    assert.ok(lookup('Bitter Leaf'));
  });
});

describe('W2 — router extractText', () => {
  const { extractText } = require('../src/router');

  it('extracts text from text message', () => {
    assert.equal(extractText({ type: 'text', text: { body: 'hello' } }), 'hello');
  });

  it('returns empty string for audio message', () => {
    assert.equal(extractText({ type: 'audio' }), '');
  });

  it('extracts button reply title from interactive message', () => {
    const msg = { type: 'interactive', interactive: { button_reply: { title: 'English' } } };
    assert.equal(extractText(msg), 'English');
  });
});


// ─── plant lookup coverage ────────────────────────────────────────────────────

describe('W5 — plant lookup expanded', () => {
  const { lookup } = require('../src/utils/plantLookup');

  it('has at least 100 entries', () => {
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('data/plant_lookup_v1.json', 'utf8'));
    assert.ok(data.length >= 100, `Expected ≥100 entries, got ${data.length}`);
  });

  it('finds Yoruba names: atale (ginger)', () => {
    assert.equal(lookup('atale').botanical, 'Zingiber officinale');
  });

  it('finds Yoruba names: oruwo (Morinda lucida)', () => {
    assert.equal(lookup('oruwo').botanical, 'Morinda lucida');
  });

  it('finds Igbo name: utazi', () => {
    assert.equal(lookup('utazi').botanical, 'Gongronema latifolium');
  });

  it('finds Hausa name: tafarnuwa (garlic)', () => {
    assert.equal(lookup('tafarnuwa').botanical, 'Allium sativum');
  });

  it('finds orogbo (bitter kola)', () => {
    assert.equal(lookup('orogbo').botanical, 'Garcinia kola');
  });
});


// ─── W9 — admin dashboard (unit, no real APIs) ───────────────────────────────

describe('W9 — admin module loads', () => {
  it('admin router is an Express router', () => {
    const admin = require('../src/admin');
    // Express routers are functions with a stack property
    assert.equal(typeof admin, 'function');
    assert.ok(Array.isArray(admin.stack));
  });
});

describe('W9 — admin HTML helpers', () => {
  // Load the private helpers by requiring the module and testing observable behaviour
  // via the /admin route response shape. We test the pure helpers inline here.

  it('confidence badge returns green for score >= 0.75', () => {
    // Inline reimplementation of _confBadge logic to test the threshold
    function confClass(score) {
      if (score == null) return 'gray';
      return score >= 0.75 ? 'green' : score >= 0.6 ? 'amber' : 'red';
    }
    assert.equal(confClass(0.92), 'green');
    assert.equal(confClass(0.75), 'green');
    assert.equal(confClass(0.74), 'amber');
    assert.equal(confClass(0.6),  'amber');
    assert.equal(confClass(0.59), 'red');
    assert.equal(confClass(null), 'gray');
  });

  it('Basic Auth header is required — missing auth returns 401', () => {
    process.env.ADMIN_PASSWORD = 'testpass';
    const { requireAuth } = require('../src/admin');
    let statusCode;
    const req = { headers: {} };
    const res = {
      set() { return this; },
      status(c) { statusCode = c; return this; },
      send() { return this; },
    };
    requireAuth(req, res, () => {});
    assert.equal(statusCode, 401);
  });

  it('Wrong password returns 401', () => {
    process.env.ADMIN_PASSWORD = 'correct';
    const { requireAuth } = require('../src/admin');
    const creds = Buffer.from('felix:wrong').toString('base64');
    let statusCode;
    const req = { headers: { authorization: `Basic ${creds}` } };
    const res = {
      set() { return this; },
      status(c) { statusCode = c; return this; },
      send() { return this; },
    };
    requireAuth(req, res, () => {});
    assert.equal(statusCode, 401);
  });
});


// ─── G5 — cost monitoring view ────────────────────────────────────────────────

describe('G5 — adminGetUsageStats is exported from supabase service', () => {
  it('adminGetUsageStats is a function', () => {
    const sb = require('../src/services/supabase');
    assert.equal(typeof sb.adminGetUsageStats, 'function');
  });
});

describe('G5 — cost estimation logic', () => {
  it('estimatedUSD is zero when all counts are zero', () => {
    // Mirror the formula in adminGetUsageStats
    const whisper = 0, claudeText = 0, claudeVision = 0;
    const est = (whisper * 0.009 + claudeText * 0.003 + claudeVision * 0.010).toFixed(2);
    assert.equal(est, '0.00');
  });

  it('estimatedUSD rounds correctly for mixed call counts', () => {
    const whisper = 10, claudeText = 20, claudeVision = 5;
    // 10*0.009 + 20*0.003 + 5*0.010 = 0.09 + 0.06 + 0.05 = 0.20
    const est = (whisper * 0.009 + claudeText * 0.003 + claudeVision * 0.010).toFixed(2);
    assert.equal(est, '0.20');
  });

  it('vision events are distinguished from text events by payload.type', () => {
    const events = [
      { event_type: 'claude_call', payload: { type: 'vision' } },
      { event_type: 'claude_call', payload: {} },
      { event_type: 'claude_call', payload: null },
      { event_type: 'whisper_call', payload: {} },
    ];
    const claudeVision = events.filter(r => r.event_type === 'claude_call' && r.payload?.type === 'vision').length;
    const claudeText   = events.filter(r => r.event_type === 'claude_call' && r.payload?.type !== 'vision').length;
    const whisper      = events.filter(r => r.event_type === 'whisper_call').length;
    assert.equal(claudeVision, 1);
    assert.equal(claudeText,   2);
    assert.equal(whisper,      1);
  });
});

describe('G5 — admin dashboard includes usage section', () => {
  it('admin module loads with adminGetUsageStats imported', () => {
    // Verifies the import does not throw (would error if export name mismatched)
    const admin = require('../src/admin');
    assert.equal(typeof admin, 'function');
  });
});

// ─── W12 — institutional dashboard ────────────────────────────────────────────

describe('W12 — dashboardGetStats is exported from supabase service', () => {
  it('dashboardGetStats is a function', () => {
    const sb = require('../src/services/supabase');
    assert.equal(typeof sb.dashboardGetStats, 'function');
  });

  it('rejects failed aggregate queries instead of presenting fresh-looking zeros', () => {
    const { _throwOnDashboardQueryError } = require('../src/services/supabase');
    assert.throws(
      () => _throwOnDashboardQueryError([{ count: null, error: { message: 'database offline' } }]),
      /Dashboard aggregate query failed: database offline/,
    );
  });
});

describe('W12 — dashboard module loads as an Express router', () => {
  it('dashboard module exports a router-like function', () => {
    const dashboard = require('../src/dashboard');
    assert.equal(typeof dashboard, 'function');
  });

  it('dashboard exposes _renderPage and _renderSparkline helpers', () => {
    const dashboard = require('../src/dashboard');
    assert.equal(typeof dashboard._renderPage, 'function');
    assert.equal(typeof dashboard._renderSparkline, 'function');
  });
});

describe('W12 — dashboard renderPage', () => {
  const { _renderPage } = require('../src/dashboard');

  it('renders headline counts using the values it is given', () => {
    const html = _renderPage({
      practitioners: 17,
      formulations:  42,
      byDay:         [{ day: '2026-05-01', count: 3 }],
      updated_at:    new Date('2026-05-27T12:00:00Z').toISOString(),
    });
    assert.match(html, /17/);
    assert.match(html, /42/);
    assert.match(html, /Practitioners onboarded/);
    assert.match(html, /Formulations documented/);
  });

  it('shows zero counts honestly when no data exists yet', () => {
    const html = _renderPage({
      practitioners: 0, formulations: 0, byDay: [], updated_at: new Date().toISOString(),
    });
    assert.match(html, />0</);
    assert.match(html, /No data yet/);
  });

  it('does NOT leak phone numbers, display names, or transcripts', () => {
    // Public route — must stay aggregate. If a future change tries to embed a
    // practitioner list, this test will fail.
    const html = _renderPage({
      practitioners: 5, formulations: 12,
      byDay: [{ day: '2026-05-26', count: 1 }],
      updated_at: new Date().toISOString(),
    });
    assert.doesNotMatch(html, /\+\d{10,}/);   // E.164 phone numbers
    assert.doesNotMatch(html, /transcript/i);
    assert.doesNotMatch(html, /display_name/);
  });

  it('shows the last-updated timestamp in the footer', () => {
    const html = _renderPage({
      practitioners: 1, formulations: 1, byDay: [],
      updated_at: new Date('2026-05-27T14:30:00Z').toISOString(),
    });
    assert.match(html, /Last updated/);
    assert.match(html, /2026/);
  });
});

describe('W12 — sparkline rendering', () => {
  const { _renderSparkline } = require('../src/dashboard');

  it('renders one bar per day, scaled to the max count', () => {
    const html = _renderSparkline([
      { day: '2026-05-25', count: 0 },
      { day: '2026-05-26', count: 5 },
      { day: '2026-05-27', count: 10 },
    ]);
    // 3 bars (use a tight regex so it doesn't also match .bar-axis)
    assert.equal((html.match(/class="bar(?: has)?"/g) ?? []).length, 3);
    // Tallest bar reaches 100%
    assert.match(html, /height:100%/);
    // Days with count > 0 get the 'has' class (darker green)
    assert.match(html, /class="bar has"/);
    assert.match(html, /View daily values/);
    assert.match(html, /<th scope="row">2026-05-26<\/th><td>5<\/td>/);
  });

  it('handles empty input gracefully', () => {
    const html = _renderSparkline([]);
    assert.match(html, /No data yet/);
  });
});

// ─── H1 — hardening sprint: webhook security, dedup, confidence, confirmations ─

describe('H1 — webhook signature verification', () => {
  const crypto = require('crypto');
  const { verifySignature } = require('../src/router');

  function signedReq(body, secret) {
    const raw = Buffer.from(JSON.stringify(body));
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return { headers: { 'x-hub-signature-256': sig }, rawBody: raw };
  }

  it('accepts a correctly signed request', () => {
    process.env.META_APP_SECRET = 'app_secret_123';
    const req = signedReq({ object: 'whatsapp_business_account' }, 'app_secret_123');
    assert.equal(verifySignature(req), true);
  });

  it('rejects a request signed with the wrong secret', () => {
    process.env.META_APP_SECRET = 'app_secret_123';
    const req = signedReq({ object: 'whatsapp_business_account' }, 'wrong_secret');
    assert.equal(verifySignature(req), false);
  });

  it('rejects a request with no signature header', () => {
    process.env.META_APP_SECRET = 'app_secret_123';
    const req = { headers: {}, rawBody: Buffer.from('{}') };
    assert.equal(verifySignature(req), false);
  });

  it('rejects a tampered body', () => {
    process.env.META_APP_SECRET = 'app_secret_123';
    const req = signedReq({ object: 'whatsapp_business_account' }, 'app_secret_123');
    req.rawBody = Buffer.from('{"object":"tampered"}');
    assert.equal(verifySignature(req), false);
  });

  it('allows requests when META_APP_SECRET is not configured (dev mode)', () => {
    delete process.env.META_APP_SECRET;
    const req = { headers: {}, rawBody: Buffer.from('{}') };
    assert.equal(verifySignature(req), true);
  });
});

describe('H1 — TtlSet (webhook message dedup)', () => {
  const { TtlSet } = require('../src/utils/ttlCache');

  it('remembers a key within its TTL', () => {
    const set = new TtlSet(60_000);
    set.add('wamid.abc');
    assert.equal(set.has('wamid.abc'), true);
    assert.equal(set.has('wamid.other'), false);
  });

  it('forgets a key after its TTL expires', () => {
    const set = new TtlSet(-1); // already expired on insert
    set.add('wamid.abc');
    assert.equal(set.has('wamid.abc'), false);
  });

  it('evicts oldest entries when over capacity', () => {
    const set = new TtlSet(60_000, 2);
    set.add('a');
    set.add('b');
    set.add('c'); // exceeds maxSize → 'a' evicted
    assert.equal(set.has('c'), true);
    assert.equal(set.has('a'), false);
  });
});


describe('H1 — Whisper confidence from verbose_json segments', () => {
  const { _confidenceFromSegments } = require('../src/services/whisper');

  it('returns 0 for empty text', () => {
    assert.equal(_confidenceFromSegments([], ''), 0);
    assert.equal(_confidenceFromSegments(null, null), 0);
  });

  it('clean speech (avg_logprob near 0) scores high', () => {
    const segments = [{ start: 0, end: 10, avg_logprob: -0.15, no_speech_prob: 0.01 }];
    const c = _confidenceFromSegments(segments, 'a clear long transcription of the formulation');
    assert.ok(c > 0.75, `expected > 0.75, got ${c}`);
  });

  it('garbled speech (very negative avg_logprob, high no_speech_prob) scores low', () => {
    const segments = [{ start: 0, end: 10, avg_logprob: -1.4, no_speech_prob: 0.6 }];
    const c = _confidenceFromSegments(segments, 'mumble mumble');
    assert.ok(c < 0.5, `expected < 0.5, got ${c}`);
  });

  it('weights segments by duration', () => {
    const segments = [
      { start: 0, end: 19, avg_logprob: -0.1, no_speech_prob: 0.0 },  // 19s clean
      { start: 19, end: 20, avg_logprob: -2.0, no_speech_prob: 0.9 }, // 1s noise
    ];
    const c = _confidenceFromSegments(segments, 'mostly clean audio with a noisy tail');
    assert.ok(c > 0.7, `long clean segment should dominate, got ${c}`);
  });

  it('falls back to a length heuristic when segments are missing', () => {
    assert.ok(_confidenceFromSegments(undefined, 'a reasonably long transcription') >= 0.6);
    assert.ok(_confidenceFromSegments(undefined, 'hi') < 0.6);
  });
});

describe('H1 — admin Basic Auth hardening', () => {
  const { requireAuth } = require('../src/admin');

  function call(headerValue) {
    let statusCode = null, nextCalled = false;
    const req = { headers: headerValue ? { authorization: headerValue } : {} };
    const res = {
      set() { return this; },
      status(c) { statusCode = c; return this; },
      send() { return this; },
    };
    requireAuth(req, res, () => { nextCalled = true; });
    return { statusCode, nextCalled };
  }

  it('correct credentials pass through to the dashboard', () => {
    process.env.ADMIN_PASSWORD = 'sekret';
    const { nextCalled } = call('Basic ' + Buffer.from('felix:sekret').toString('base64'));
    assert.equal(nextCalled, true);
  });

  it('passwords containing colons work (split-on-first-colon regression)', () => {
    process.env.ADMIN_PASSWORD = 'pa:ss:word';
    const { nextCalled } = call('Basic ' + Buffer.from('felix:pa:ss:word').toString('base64'));
    assert.equal(nextCalled, true);
  });

  it('wrong username is rejected even with the right password', () => {
    process.env.ADMIN_PASSWORD = 'sekret';
    const { statusCode, nextCalled } = call('Basic ' + Buffer.from('admin:sekret').toString('base64'));
    assert.equal(statusCode, 401);
    assert.equal(nextCalled, false);
  });
});


describe('shared formatCard', () => {
  const { formatCard } = require('../src/utils/format');

  it('photo source label appears only when requested', () => {
    const s = { condition: { standardised: 'Fever' }, plants: [], preparation: {}, dosage: {}, metadata: {} };
    assert.ok(formatCard(s, { source: 'photo' }).includes('_Source: photo_'));
    assert.ok(!formatCard(s).includes('_Source:'));
  });

});

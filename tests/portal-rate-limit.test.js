'use strict';
// Offline checks for the shared portal rate limiter, the router's use of it,
// and the TRUST_PROXY setting. The PostgreSQL behaviour (atomic counting across
// processes, window reset, role denial) is covered in tests/portal/postgres.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const { createRateLimiter, clientKey, LIMITS } = require('../src/portal/rateLimit');
const { createPortalRouter } = require('../src/portal/router');
const { trustProxy } = require('../src/utils/trustProxy');

const KEY = 'k'.repeat(64);

function withKey(value, fn) {
  const before = process.env.PORTAL_RATE_LIMIT_KEY;
  if (value === undefined) delete process.env.PORTAL_RATE_LIMIT_KEY;
  else process.env.PORTAL_RATE_LIMIT_KEY = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (before === undefined) delete process.env.PORTAL_RATE_LIMIT_KEY;
      else process.env.PORTAL_RATE_LIMIT_KEY = before;
    });
}

test('client keys are keyed hashes, never the address or its plain hash', () => {
  const key = clientKey('203.0.113.7', KEY);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, clientKey('203.0.113.7', KEY));
  assert.notEqual(key, clientKey('203.0.113.8', KEY));
  assert.notEqual(key, clientKey('203.0.113.7', 'x'.repeat(64)));
  assert.notEqual(key, crypto.createHash('sha256').update('203.0.113.7').digest('hex'));
  assert.ok(!key.includes('203'));
});

test('the limiter sends one bucket per portal, scope and client', async () => {
  const calls = [];
  const store = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { allowed: calls.length === 1 };
    },
  };
  await withKey(KEY, async () => {
    const allow = createRateLimiter({ store, portal: 'care' });
    assert.equal(await allow('203.0.113.7', 'login'), true);
    assert.equal(await allow('203.0.113.7', 'action'), false);
  });
  assert.deepEqual(calls[0], {
    name: 'portal_rate_limit',
    args: {
      p_bucket: `care:login:${clientKey('203.0.113.7', KEY)}`,
      p_limit: LIMITS.login,
      p_window_seconds: 60,
    },
  });
  assert.equal(calls[1].args.p_bucket, `care:action:${clientKey('203.0.113.7', KEY)}`);
  assert.equal(calls[1].args.p_limit, LIMITS.action);
});

test('a missing or short key refuses instead of running unlimited', async () => {
  let called = false;
  const store = { rpc: async () => ((called = true), { allowed: true }) };
  const allow = createRateLimiter({ store, portal: 'evidence' });
  for (const value of [undefined, '', 'short']) {
    await withKey(value, () => assert.rejects(allow('203.0.113.7', 'login'), /RATE_LIMIT_KEY/));
  }
  assert.equal(called, false);
});

test('anything but an explicit allowed: true counts as refused', async () => {
  for (const result of [{ allowed: false }, { allowed: 't' }, 't', null, undefined]) {
    const allow = createRateLimiter({ store: { rpc: async () => result }, portal: 'care' });
    await withKey(KEY, async () => assert.equal(await allow('203.0.113.7', 'action'), false));
  }
});

async function serve(rateLimit, setup = () => {}) {
  const app = express();
  setup(app);
  const origin = 'http://127.0.0.1:1';
  process.env.PORTAL_TEST_ORIGIN = origin;
  app.use(
    '/p',
    createPortalRouter({
      mountPath: '/p',
      webDir: __dirname,
      cookieName: 'p',
      originEnv: 'PORTAL_TEST_ORIGIN',
      isEnabled: () => true,
      configErrorCode: 'X',
      jsonLimit: '1kb',
      exportFilename: 'x.json',
      errorStatus: {},
      login: async () => ({ token: 't', csrf: 'c' }),
      sessionCookie: () => 'token',
      act: async () => ({ ok: true }),
      rateLimit,
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/p`;
  const post = (path, headers = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
      body: JSON.stringify({ email: 'a@example.invalid', password: 'x', action: 'me' }),
    }).then(async res => ({ status: res.status, body: await res.json() }));
  return { post, close: () => server.close() };
}

test('the router asks the limiter per endpoint and honours its answer', async () => {
  const seen = [];
  let answer = true;
  const portal = await serve(async (ip, scope) => (seen.push({ ip, scope }), answer));
  try {
    assert.equal((await portal.post('/api/login')).status, 200);
    assert.equal((await portal.post('/api/action')).status, 200);
    answer = false;
    assert.deepEqual(await portal.post('/api/login'), {
      status: 429,
      body: { error: 'RATE_LIMITED' },
    });
    assert.deepEqual(
      seen.map(s => s.scope),
      ['login', 'action', 'login'],
    );
    assert.equal(seen[0].ip, '127.0.0.1');
  } finally {
    portal.close();
  }
});

test('the router refuses with 503 when the limit cannot be checked', async () => {
  const portal = await serve(async () => {
    throw new Error('database unreachable');
  });
  try {
    assert.deepEqual(await portal.post('/api/action'), {
      status: 503,
      body: { error: 'TEMPORARILY_UNAVAILABLE' },
    });
  } finally {
    portal.close();
  }
});

test('the CSRF check still runs before the limiter is consulted', async () => {
  let consulted = false;
  const portal = await serve(async () => (consulted = true));
  try {
    const result = await portal.post('/api/login', { Origin: 'http://evil.example' });
    assert.equal(result.status, 403);
    assert.equal(consulted, false);
  } finally {
    portal.close();
  }
});

test('TRUST_PROXY is parsed strictly', () => {
  assert.equal(trustProxy(''), false);
  assert.equal(trustProxy('false'), false);
  assert.equal(trustProxy('1'), 1);
  assert.deepEqual(trustProxy('loopback'), ['loopback']);
  assert.deepEqual(trustProxy('10.0.0.0/8, ::1, 192.0.2.1'), ['10.0.0.0/8', '::1', '192.0.2.1']);
  assert.throws(() => trustProxy('true'), /any client/);
  for (const bad of ['10.0.0.0/33', '::1/129', 'proxy.example', '10.0.0.0/8/1', '1.2.3']) {
    assert.throws(() => trustProxy(bad), /invalid entries/, bad);
  }
});

test('with a trusted hop the limiter sees the forwarded client, otherwise the peer', async () => {
  const forwarded = { 'X-Forwarded-For': '198.51.100.23' };
  for (const [setting, expected] of [
    [trustProxy('loopback'), '198.51.100.23'],
    [trustProxy(''), '127.0.0.1'],
  ]) {
    let ip;
    const portal = await serve(
      async seen => ((ip = seen), true),
      app => app.set('trust proxy', setting),
    );
    try {
      await portal.post('/api/action', forwarded);
      assert.equal(ip, expected);
    } finally {
      portal.close();
    }
  }
});

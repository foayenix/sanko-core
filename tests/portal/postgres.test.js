'use strict';
// The shared portal rate limiter on disposable PostgreSQL. Run by
// scripts/test-care-postgres.js after the migrations have been applied.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const { createPostgres } = require('../helpers/postgres');

const { sql, rpc } = createPostgres(process.env.CARE_TEST_DB_URL, 'care_');
const bucket = (scope = 'login') => `care:${scope}:${crypto.randomBytes(32).toString('hex')}`;
const allowed = async (b, limit = 2, seconds = 60) =>
  (await rpc('portal_rate_limit', { p_bucket: b, p_limit: limit, p_window_seconds: seconds }))
    .allowed;

test('portal rate limits on PostgreSQL', async t => {
  await t.test('counts within a window and resets after it', async () => {
    const b = bucket();
    assert.deepEqual([await allowed(b), await allowed(b), await allowed(b)], [true, true, false]);
    await sql(`update portal_rate_limits set window_ends = now() - interval '1 second'
      where bucket = '${b}'`);
    assert.equal(await allowed(b), true);
    assert.equal(await sql(`select hits from portal_rate_limits where bucket = '${b}'`), '1');
  });

  await t.test('concurrent calls from separate connections are all counted', async () => {
    const b = bucket('action');
    const results = await Promise.all(Array.from({ length: 30 }, () => allowed(b, 10)));
    assert.equal(results.filter(Boolean).length, 10);
    assert.equal(await sql(`select hits from portal_rate_limits where bucket = '${b}'`), '30');
  });

  await t.test('two router instances share one allowance', async () => {
    Object.assign(process.env, {
      CARE_PATIENT_ACCESS_ENABLED: 'true',
      CARE_SYNTHETIC_ONLY: 'true',
      PATIENT_TRACKING_ENABLED: 'true',
      AGENT_TOOLS: 'full',
      PORTAL_RATE_LIMIT_KEY: crypto.randomBytes(32).toString('hex'),
    });
    require('../../src/care/store').rpc = rpc;
    const { createRouter } = require('../../src/care/routes');
    const login = async () => {
      throw new Error('UNAUTHENTICATED');
    };
    // Each app stands in for a separate server process: nothing is shared
    // between them except the database.
    const servers = [];
    for (let i = 0; i < 2; i++) {
      const app = express();
      app.use('/care', createRouter({ login }));
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      servers.push(server);
    }
    const origin = 'https://care.example.invalid';
    process.env.CARE_ORIGIN = origin;
    try {
      const statuses = [];
      for (let i = 0; i < 12; i++) {
        const { port } = servers[i % 2].address();
        const res = await fetch(`http://127.0.0.1:${port}/care/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: origin },
          body: JSON.stringify({ email: 'a@example.invalid', password: 'x' }),
        });
        statuses.push(res.status);
      }
      assert.deepEqual(statuses, [...Array(10).fill(401), 429, 429]);
      const stored = (await sql('select bucket from portal_rate_limits')).split('\n');
      assert.ok(stored.every(b => /^(care|evidence):(login|action):[0-9a-f]{64}$/.test(b)));
      assert.ok(stored.every(b => !b.includes('127.0.0.1')));
    } finally {
      for (const server of servers) server.close();
    }
  });

  await t.test('expired buckets are removed by later calls', async () => {
    const stale = [bucket(), bucket('action')];
    await sql(`insert into portal_rate_limits (bucket, hits, window_ends) values
      ('${stale[0]}', 3, now() - interval '5 minutes'),
      ('${stale[1]}', 3, now() - interval '5 minutes')`);
    await allowed(bucket());
    const left = await sql(`select count(*) from portal_rate_limits
      where bucket in ('${stale[0]}', '${stale[1]}')`);
    assert.equal(left, '0');
  });

  await t.test('raw addresses and bad limits are refused', async () => {
    await assert.rejects(allowed('care:login:203.0.113.7'), /INVALID_INPUT/);
    await assert.rejects(allowed('other:login:' + 'a'.repeat(64)), /INVALID_INPUT/);
    await assert.rejects(allowed(bucket(), 0), /INVALID_INPUT/);
    await assert.rejects(allowed(bucket(), 1, 0), /INVALID_INPUT/);
    await assert.rejects(
      sql(`insert into portal_rate_limits values ('care:login:203.0.113.7', 1, now())`),
      /check constraint/,
    );
  });

  await t.test('only the service role can use the limiter', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(
        sql(`set role ${role}; select portal_rate_limit('${bucket()}', 1, 60);`),
        /permission denied/,
      );
      await assert.rejects(
        sql(`set role ${role}; select count(*) from portal_rate_limits;`),
        /permission denied/,
      );
    }
    assert.equal(
      await sql(`set role service_role; select portal_rate_limit('${bucket()}', 1, 60);`),
      '{"allowed": true}',
    );
  });
});

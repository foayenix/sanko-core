// Vercel Web Analytics for the control room, with a fake fetch: no network.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const analytics = require('../src/services/siteAnalytics');

const NOW = Date.parse('2026-11-20T12:00:00Z');

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return handler(new URL(url));
  };
  fn.calls = calls;
  return fn;
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('site analytics', () => {
  beforeEach(() => {
    analytics._resetCache();
    process.env.VERCEL_ANALYTICS_TOKEN = 'test-token';
    process.env.VERCEL_ANALYTICS_PROJECT = 'sanko-landing';
    process.env.VERCEL_TEAM_ID = 'team_test';
  });
  afterEach(() => {
    delete process.env.VERCEL_ANALYTICS_TOKEN;
    delete process.env.VERCEL_ANALYTICS_PROJECT;
    delete process.env.VERCEL_TEAM_ID;
    analytics._resetCache();
  });

  it('stays off and makes no call when it is not configured', async () => {
    delete process.env.VERCEL_ANALYTICS_TOKEN;
    const fetchImpl = fakeFetch(() => { throw new Error('should not be called'); });
    assert.deepEqual(await analytics.getSiteTraffic({ fetchImpl, now: NOW }), { configured: false });
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('asks for 7 and 30 days of production page views with the token as a bearer', async () => {
    const fetchImpl = fakeFetch(url => {
      if (url.pathname.endsWith('/count')) {
        const days = (NOW - Date.parse(url.searchParams.get('since'))) / 86_400_000;
        return json({ data: { total: days === 7 ? 120 : 480 } });
      }
      return json({ data: [{ requestPath: '/', total: 300 }, { requestPath: '/plants/aayu/', total: 40 }] });
    });

    const traffic = await analytics.getSiteTraffic({ fetchImpl, now: NOW });

    assert.equal(traffic.ok, true);
    assert.equal(traffic.last7, 120);
    assert.equal(traffic.last30, 480);
    assert.deepEqual(traffic.topPaths, [{ path: '/', views: 300 }, { path: '/plants/aayu/', views: 40 }]);
    for (const call of fetchImpl.calls) {
      assert.equal(call.url.host, 'api.vercel.com');
      assert.equal(call.url.searchParams.get('projectId'), 'sanko-landing');
      assert.equal(call.url.searchParams.get('teamId'), 'team_test');
      assert.equal(call.init.headers.Authorization, 'Bearer test-token');
    }
  });

  it('serves a reload from memory instead of calling Vercel again', async () => {
    const fetchImpl = fakeFetch(() => json({ data: { total: 5 } }));
    await analytics.getSiteTraffic({ fetchImpl, now: NOW });
    const callsAfterFirst = fetchImpl.calls.length;
    await analytics.getSiteTraffic({ fetchImpl, now: NOW + 60_000 });
    assert.equal(fetchImpl.calls.length, callsAfterFirst);
  });

  it('reports a failed call rather than printing zero', async () => {
    const fetchImpl = fakeFetch(() => json({ error: 'forbidden' }, 403));
    const traffic = await analytics.getSiteTraffic({ fetchImpl, now: NOW });
    assert.equal(traffic.ok, false);
    assert.equal('last30' in traffic, false);
  });

  it('keeps the counts when only the busiest-paths call fails', async () => {
    const fetchImpl = fakeFetch(url => (url.pathname.endsWith('/count') ? json({ data: { total: 9 } }) : json({}, 500)));
    const traffic = await analytics.getSiteTraffic({ fetchImpl, now: NOW });
    assert.equal(traffic.ok, true);
    assert.equal(traffic.last30, 9);
    assert.equal(traffic.topPaths, null);
  });

  it('reads the count from the shapes it knows and refuses to guess otherwise', () => {
    assert.equal(analytics._parseCount({ data: { total: 3 } }), 3);
    assert.equal(analytics._parseCount({ data: { count: 4 } }), 4);
    assert.equal(analytics._parseCount({ data: 5 }), 5);
    assert.equal(analytics._parseCount({ total: 6 }), 6);
    assert.equal(analytics._parseCount({ data: { browserName: 'x' } }), null);
    assert.equal(analytics._parseCount(null), null);
  });
});

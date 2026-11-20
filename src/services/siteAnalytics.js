// Aggregate page views for sanko.africa from Vercel Web Analytics, so the
// control room can put visits next to sign-ups.
//
// Off unless configured. The token is a Vercel access token: Vercel has no
// read-only scope, so a leaked token can change the website, not just read its
// numbers. Scope it to the one team, give it an expiry, and keep it in the
// server environment only (see docs/LANDING_SIGNUPS.md).
//
// Only totals leave Vercel: page-view counts and the busiest paths. Nothing here
// can identify a visitor, and nothing is stored — results live in memory for
// ten minutes so a reload of /admin does not spend API calls.

const { env } = require('../utils/env');
const log = require('../utils/log');

const API = 'https://api.vercel.com';
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;

let cached = null;

function config() {
  const token = env('VERCEL_ANALYTICS_TOKEN');
  const projectId = env('VERCEL_ANALYTICS_PROJECT');
  if (!token || !projectId) return null;
  return { token, projectId, teamId: env('VERCEL_TEAM_ID') };
}

// The documented examples do not pin down where the number sits, so look in the
// places it can be and refuse to guess beyond them. A shape we do not recognise
// becomes "unavailable" on the page, never a made-up zero.
const COUNT_KEYS = ['total', 'count', 'pageViews', 'pageviews', 'views', 'visits'];

function pickCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const key of COUNT_KEYS) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) return value[key];
  }
  return null;
}

function parseCount(body) {
  return pickCount(body?.data) ?? pickCount(body);
}

function parseTopPaths(body) {
  if (!Array.isArray(body?.data)) return null;
  const rows = body.data
    .map(row => ({ path: typeof row?.requestPath === 'string' ? row.requestPath : null, views: pickCount(row) }))
    .filter(row => row.path && row.views != null);
  return rows.length ? rows.sort((a, b) => b.views - a.views).slice(0, 5) : null;
}

async function query(cfg, endpoint, params, fetchImpl) {
  const url = new URL(`${API}/v1/query/web-analytics/visits/${endpoint}`);
  url.searchParams.set('projectId', cfg.projectId);
  if (cfg.teamId) url.searchParams.set('teamId', cfg.teamId);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Vercel analytics ${endpoint} returned ${response.status}`);
  return response.json();
}

// Returns one of:
//   { configured: false }
//   { configured: true, ok: false, error }                       — call failed
//   { configured: true, ok: true, last7, last30, topPaths, fetched_at }
// last7/last30 are null when Vercel answered in a shape this code does not know.
async function getSiteTraffic({ fetchImpl = fetch, now = Date.now() } = {}) {
  const cfg = config();
  if (!cfg) return { configured: false };
  if (cached && cached.expires > now) return cached.value;

  const since = days => new Date(now - days * DAY_MS).toISOString();
  const until = new Date(now).toISOString();
  let value;
  try {
    const [week, month, paths] = await Promise.all([
      query(cfg, 'count', { since: since(7), until }, fetchImpl),
      query(cfg, 'count', { since: since(30), until }, fetchImpl),
      // The busiest paths are a nice-to-have; their failure costs only that list.
      query(cfg, 'aggregate', { since: since(30), until, by: 'requestPath', limit: '5' }, fetchImpl)
        .catch(err => { log.warn('analytics.top_paths_unavailable', { error: err.message }); return null; }),
    ]);
    value = {
      configured: true,
      ok: true,
      last7: parseCount(week),
      last30: parseCount(month),
      topPaths: parseTopPaths(paths),
      fetched_at: new Date(now).toISOString(),
    };
    if (value.last7 == null || value.last30 == null) {
      log.warn('analytics.unrecognised_response', { keys: Object.keys(week?.data ?? week ?? {}) });
    }
  } catch (err) {
    log.warn('analytics.unavailable', { error: err.message });
    value = { configured: true, ok: false, error: 'Vercel did not answer. The numbers will return on the next refresh.' };
  }
  // Failures are cached for a minute, not ten, so a blip does not hide the
  // panel for long and an outage does not turn every reload into a timeout.
  cached = { value, expires: now + (value.ok ? CACHE_MS : 60_000) };
  return value;
}

function _resetCache() { cached = null; }

module.exports = { getSiteTraffic, _parseCount: parseCount, _parseTopPaths: parseTopPaths, _resetCache };

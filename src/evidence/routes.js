'use strict';
const express = require('express');
const path = require('node:path');
const auth = require('./auth');
const service = require('./service');
const { configuration } = require('./config');
const ERROR_STATUS = {
  UNAUTHENTICATED: 401, REAUTHENTICATE: 401, CSRF_REQUIRED: 403, NOT_FOUND: 404,
  FEATURE_DISABLED: 404, INVALID_INPUT: 400, INVALID_ACTION: 400,
  REVISION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, IDEMPOTENCY_REQUIRED: 400,
  CONFIRMATION_REQUIRED: 409, INVALID_TRANSITION: 409, UNSUPPORTED_SOURCE: 422,
  INVALID_REPORT: 422, UNSUPPORTED_CLAIM: 422, INDEPENDENT_REVIEW_REQUIRED: 403, REVIEWER_INELIGIBLE: 403, REVIEW_CHECKS_REQUIRED: 422, SOURCE_CHANGED: 409, REPORT_WITHDRAWN: 410, CAPACITY_UNAVAILABLE: 409,
};
function createRouter({ login = auth.login, act = service.act } = {}) {
  const router = express.Router();
  const limits = new Map();
  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    try { if (!configuration().enabled) return res.status(404).json({ error: 'FEATURE_DISABLED' }); } catch { return res.status(503).json({ error: 'EVIDENCE_CONFIGURATION_INVALID' }); }
    next();
  });
  router.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'web/index.html')));
  router.get('/brand.svg', (_req, res) => res.sendFile(path.join(__dirname, 'web/brand.svg')));
  router.get('/app.js', (_req, res) => res.sendFile(path.join(__dirname, 'web/app.js')));
  router.get('/style.css', (_req, res) => res.sendFile(path.join(__dirname, 'web/style.css')));
  router.use(express.json({ limit: '160kb' }));
  router.use((req, res, next) => {
    // No credentialed cross-origin requests; session cookie alone is never an
    // authorisation for a POST. Origin + session-bound CSRF protect mutations.
    const origin = process.env.EVIDENCE_ORIGIN;
    if (!origin || req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'CSRF_REQUIRED' });
    const now = Date.now();
    for (const [key, item] of limits) if (item.until <= now) limits.delete(key);
    const key = `${req.ip}:${req.path === '/api/login' ? 'login' : 'action'}`;
    const item = limits.get(key) ?? { count: 0, until: now + 60_000 };
    item.count++;
    limits.set(key, item);
    if (item.count > (req.path === '/api/login' ? 10 : 120) || limits.size > 10000) return res.status(429).json({ error: 'RATE_LIMITED' });
    next();
  });
  const cookieOptions = () => ({ httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/evidence', maxAge: 30 * 60_000 });
  router.post('/api/login', async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 1024) throw new Error('UNAUTHENTICATED');
      const session = await login(email, password);
      res.cookie('sanko_evidence', session.token, cookieOptions());
      res.json({ csrf: session.csrf, synthetic: true });
    } catch { res.status(401).json({ error: 'UNAUTHENTICATED' }); }
  });
  router.post('/api/action', async (req, res) => {
    try {
      const result = await act(auth.sessionCookie(req), req.headers['x-sanko-csrf'], req.body);
      if (result?.signed_out) res.clearCookie('sanko_evidence', { ...cookieOptions(), maxAge: undefined });
      if (req.body.action === 'export') res.set('Content-Disposition', 'attachment; filename="sanko-evidence-export.json"');
      if (req.body.action === 'artifact') {
        res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        res.type('html').set('Content-Disposition', 'attachment; filename="sanko-evidence-report.html"');
        return res.send(require('./reports').document(result.html, {status: result.status, reviewer: result.reviewer, reviewed_at: result.reviewed_at, currency: result.currency, manifest_hash: result.manifest_hash, snapshot: result.snapshot}));
      }
      res.json(result);
    } catch (error) {
      const code = Object.keys(ERROR_STATUS).find(code => error.message === code) ?? 'TEMPORARILY_UNAVAILABLE';
      res.status(ERROR_STATUS[code] ?? 503).json({ error: code });
    }
  });
  router.use((err, _req, res, _next) => res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'INVALID_INPUT' }));
  return router;
}
module.exports = { createRouter };

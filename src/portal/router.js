'use strict';

// The Express router shared by the /care and /evidence portals.
//
// Both portals are a static single-page app plus two JSON endpoints:
// POST /api/login, which opens a session, and POST /api/action, which hands one
// validated action to the portal's service. Everything security-relevant that
// does not depend on the portal lives here, so a fix to one cannot miss the
// other: response headers, the feature gate, origin and CSRF checks, rate
// limiting, cookie settings and the mapping from error codes to HTTP status.

const express = require('express');
const path = require('node:path');

// Error codes both services raise. Each portal adds its own on top. Anything
// not listed becomes 503 TEMPORARILY_UNAVAILABLE so internal errors never reach
// the browser.
const COMMON_ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  REAUTHENTICATE: 401,
  CSRF_REQUIRED: 403,
  NOT_FOUND: 404,
  FEATURE_DISABLED: 404,
  INVALID_INPUT: 400,
  INVALID_ACTION: 400,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_REQUIRED: 400,
  CONFIRMATION_REQUIRED: 409,
  INVALID_TRANSITION: 409,
  UNSUPPORTED_SOURCE: 422,
};

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

// Per-process, fixed one-minute windows keyed by client IP. This is not shared
// between processes; docs/EVIDENCE_IMPLEMENTATION.md lists a deployment-wide
// limiter as a release gate.
const RATE_WINDOW_MS = 60_000;
const LOGIN_LIMIT = 10;
const ACTION_LIMIT = 120;
const MAX_TRACKED_KEYS = 10_000;

const SESSION_MAX_AGE_MS = 30 * 60_000;

/**
 * @param {object} options
 * @param {string} options.mountPath  e.g. '/care'; also the session cookie's path
 * @param {string} options.webDir  directory with the portal's index.html, app.js, style.css
 * @param {string} options.cookieName  session cookie name
 * @param {string} options.originEnv  environment variable holding the exact allowed origin
 * @param {() => boolean} options.isEnabled  false hides the portal; throws if misconfigured
 * @param {string} options.configErrorCode  returned with 503 when isEnabled throws
 * @param {string} options.jsonLimit  express.json body limit
 * @param {string} options.exportFilename  download name for the 'export' action
 * @param {object} options.errorStatus  portal-specific error code → HTTP status
 * @param {Function} options.login  (email, password) → { token, csrf }
 * @param {Function} options.sessionCookie  (req) → session token, or throws UNAUTHENTICATED
 * @param {Function} options.act  (token, csrf, body) → result
 * @param {Function} [options.respond]  (req, res, result) → true if it sent the response
 */
function createPortalRouter(options) {
  const { mountPath, webDir, cookieName, originEnv, login, sessionCookie, act } = options;
  const errorStatus = { ...COMMON_ERROR_STATUS, ...options.errorStatus };
  const router = express.Router();
  const limits = new Map();

  router.use((_req, res, next) => {
    res.set(SECURITY_HEADERS);
    try {
      if (!options.isEnabled()) return res.status(404).json({ error: 'FEATURE_DISABLED' });
    } catch {
      return res.status(503).json({ error: options.configErrorCode });
    }
    next();
  });

  router.get('/', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  router.get('/brand.svg', (_req, res) => res.sendFile(path.join(__dirname, 'web/brand.svg')));
  router.get('/app.js', (_req, res) => res.sendFile(path.join(webDir, 'app.js')));
  router.get('/style.css', (_req, res) => res.sendFile(path.join(webDir, 'style.css')));

  router.use(express.json({ limit: options.jsonLimit }));

  router.use((req, res, next) => {
    // No credentialed cross-origin requests; session cookie alone is never an
    // authorisation for a POST. Origin + session-bound CSRF protect mutations.
    const origin = process.env[originEnv];
    if (
      !origin ||
      req.headers.origin !== origin ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      return res.status(403).json({ error: 'CSRF_REQUIRED' });
    }

    const now = Date.now();
    for (const [key, item] of limits) if (item.until <= now) limits.delete(key);
    const isLogin = req.path === '/api/login';
    const key = `${req.ip}:${isLogin ? 'login' : 'action'}`;
    const item = limits.get(key) ?? { count: 0, until: now + RATE_WINDOW_MS };
    item.count++;
    limits.set(key, item);
    if (item.count > (isLogin ? LOGIN_LIMIT : ACTION_LIMIT) || limits.size > MAX_TRACKED_KEYS) {
      return res.status(429).json({ error: 'RATE_LIMITED' });
    }
    next();
  });

  const cookieOptions = () => ({
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: mountPath,
    maxAge: SESSION_MAX_AGE_MS,
  });

  router.post('/api/login', async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (
        typeof email !== 'string' ||
        email.length > 254 ||
        typeof password !== 'string' ||
        password.length > 1024
      ) {
        throw new Error('UNAUTHENTICATED');
      }
      const session = await login(email, password);
      res.cookie(cookieName, session.token, cookieOptions());
      res.json({ csrf: session.csrf, synthetic: true });
    } catch {
      // Every failure looks the same, so the response does not reveal whether
      // the account exists or which check refused it.
      res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
  });

  router.post('/api/action', async (req, res) => {
    try {
      const result = await act(sessionCookie(req), req.headers['x-sanko-csrf'], req.body);
      if (result?.signed_out) {
        res.clearCookie(cookieName, { ...cookieOptions(), maxAge: undefined });
      }
      if (req.body.action === 'export') {
        res.set('Content-Disposition', `attachment; filename="${options.exportFilename}"`);
      }
      if (options.respond?.(req, res, result)) return;
      res.json(result);
    } catch (error) {
      const code = Object.hasOwn(errorStatus, error.message)
        ? error.message
        : 'TEMPORARILY_UNAVAILABLE';
      res.status(errorStatus[code] ?? 503).json({ error: code });
    }
  });

  // Malformed or oversized JSON bodies.
  router.use((err, _req, res, _next) =>
    res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'INVALID_INPUT' }),
  );

  return router;
}

module.exports = { createPortalRouter, COMMON_ERROR_STATUS };

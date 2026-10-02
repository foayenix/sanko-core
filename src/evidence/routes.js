'use strict';

// HTTP surface of the evidence portal, mounted at /evidence. The shared
// behaviour (headers, origin/CSRF checks, rate limits, cookies) is in
// src/portal/router.js.

const path = require('node:path');
const auth = require('./auth');
const service = require('./service');
const { configuration } = require('./config');
const { createPortalRouter } = require('../portal/router');

const ERROR_STATUS = {
  INVALID_REPORT: 422,
  UNSUPPORTED_CLAIM: 422,
  INDEPENDENT_REVIEW_REQUIRED: 403,
  REVIEWER_INELIGIBLE: 403,
  REVIEW_CHECKS_REQUIRED: 422,
  SOURCE_CHANGED: 409,
  REPORT_WITHDRAWN: 410,
  CAPACITY_UNAVAILABLE: 409,
};

// A released brief or dossier is downloaded as a standalone HTML file. It gets
// a stricter policy than the portal: no scripts, no external loads, and only
// the inline styles that src/evidence/reports.js writes into the document.
const ARTIFACT_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function sendArtifact(req, res, result) {
  if (req.body.action !== 'artifact') return false;
  res.set('Content-Security-Policy', ARTIFACT_POLICY);
  res.type('html').set('Content-Disposition', 'attachment; filename="sanko-evidence-report.html"');
  res.send(
    require('./reports').document(result.html, {
      status: result.status,
      reviewer: result.reviewer,
      reviewed_at: result.reviewed_at,
      currency: result.currency,
      manifest_hash: result.manifest_hash,
      snapshot: result.snapshot,
    }),
  );
  return true;
}

function createRouter({ login = auth.login, act = service.act } = {}) {
  return createPortalRouter({
    mountPath: '/evidence',
    webDir: path.join(__dirname, 'web'),
    cookieName: 'sanko_evidence',
    originEnv: 'EVIDENCE_ORIGIN',
    isEnabled: () => configuration().enabled,
    configErrorCode: 'EVIDENCE_CONFIGURATION_INVALID',
    jsonLimit: '160kb',
    exportFilename: 'sanko-evidence-export.json',
    errorStatus: ERROR_STATUS,
    login,
    sessionCookie: auth.sessionCookie,
    act,
    respond: sendArtifact,
  });
}

module.exports = { createRouter };

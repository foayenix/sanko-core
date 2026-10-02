'use strict';

// HTTP surface of the care portal, mounted at /care. The shared behaviour
// (headers, origin/CSRF checks, rate limits, cookies) is in src/portal/router.js.

const path = require('node:path');
const auth = require('./auth');
const service = require('./service');
const { configuration } = require('./config');
const { createPortalRouter } = require('../portal/router');
const { createRateLimiter } = require('../portal/rateLimit');
const store = require('./store');

const ERROR_STATUS = {
  CONSENT_REQUIRED: 403,
  CONFIRMED_VISIT_REQUIRED: 409,
  CLINICAL_RESPONSIBILITY_REQUIRED: 409,
  SIGNED_NOTE_IMMUTABLE: 409,
  SNAPSHOT_IMMUTABLE: 409,
};

function createRouter({ login = auth.login, act = service.act } = {}) {
  return createPortalRouter({
    mountPath: '/care',
    webDir: path.join(__dirname, 'web'),
    cookieName: 'sanko_care',
    originEnv: 'CARE_ORIGIN',
    isEnabled: () => configuration().access,
    configErrorCode: 'CARE_CONFIGURATION_INVALID',
    jsonLimit: '48kb',
    exportFilename: 'sanko-care-export.json',
    errorStatus: ERROR_STATUS,
    login,
    sessionCookie: auth.sessionCookie,
    act,
    rateLimit: createRateLimiter({ store, portal: 'care' }),
  });
}

module.exports = { createRouter };

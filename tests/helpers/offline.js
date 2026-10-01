'use strict';
// Enforce the test suite's offline contract. New transport branches must add a
// fake; an unstubbed send must never escape to Meta/model/storage services.
function assertLocal(input) {
  const host = typeof input === 'string' || input instanceof URL
    ? new URL(input).hostname : input?.hostname ?? input?.host ?? 'localhost';
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error('OFFLINE_TEST_BLOCKED_EXTERNAL_NETWORK');
}
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  for (const method of ['request', 'get']) {
    const original = module[method];
    module[method] = function (input, ...args) { assertLocal(input); return original.call(this, input, ...args); };
  }
}
const originalFetch = global.fetch;
global.fetch = (input, ...args) => { assertLocal(typeof input === 'object' && !(input instanceof URL) ? input.url : input); return originalFetch(input, ...args); };

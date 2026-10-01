'use strict';
const store = require('./store');
const { configuration } = require('./config');
async function dispatch() {
  const flags = configuration();
  if (!flags.access || !flags.encounters) return 0;
  return store.rpc('care_dispatch_synthetic', {});
}
module.exports = { dispatch };

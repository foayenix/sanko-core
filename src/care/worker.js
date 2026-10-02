'use strict';

// Runs care_dispatch_synthetic, which marks due check-ins as delivered to the
// patient's portal inbox (only between 08:00 and 19:59 in the practice's time
// zone), cancels any whose tracking or messaging consent has lapsed, and clears
// expired invitations and confirmations. Nothing is sent over WhatsApp.
// Returns the number delivered, or 0 when care encounters are switched off.

const store = require('./store');
const { configuration } = require('./config');
async function dispatch() {
  const flags = configuration();
  if (!flags.access || !flags.encounters) return 0;
  return store.rpc('care_dispatch_synthetic', {});
}
module.exports = { dispatch };

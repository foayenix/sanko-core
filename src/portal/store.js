'use strict';

// Database access for the authenticated browser portals (/care and /evidence).
//
// Every portal operation is a single SECURITY DEFINER function in PostgreSQL
// that checks the session, CSRF hash, membership and audit storage itself, so
// this layer only forwards the call and turns a Supabase error into a thrown
// Error whose message is the function's error code.
//
// Each portal gets its own store object rather than sharing one. The tests and
// the local preview scripts replace `rpc` on that object with a disposable
// PostgreSQL connection, and doing that for care must not redirect evidence.

const db = require('../services/supabase');

function createStore() {
  return {
    async rpc(name, args) {
      const { data, error } = await db.getClient().rpc(name, args);
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

module.exports = { createStore };

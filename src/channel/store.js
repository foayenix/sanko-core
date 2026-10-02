'use strict';

// The channel's database handle. See src/portal/store.js. Tests and the local
// preview replace `rpc` with a disposable PostgreSQL connection.
module.exports = require('../portal/store').createStore();

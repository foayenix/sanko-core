'use strict';
const db = require('../services/supabase');
async function rpc(name, args) {
  const { data, error } = await db.getClient().rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
module.exports = { rpc };

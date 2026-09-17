require('dotenv').config();
const { startBaileys } = require('./services/baileys');

startBaileys().catch(error => {
  require('./utils/log').error('baileys.start_failed', { error: error.message });
  process.exitCode = 1;
});

#!/usr/bin/env node
'use strict';
// Creates its own database; never resets the database named in the environment.
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const base = new URL(
  process.env.CARE_TEST_DB_URL || 'postgresql://postgres@127.0.0.1:5432/postgres',
);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  throw new Error('Disposable tests require a loopback PostgreSQL server');
const name = `sanko_care_${crypto.randomBytes(6).toString('hex')}`;
const target = new URL(base);
target.pathname = `/${name}`;
const env = { ...process.env, CARE_TEST_DB_URL: target.href, SUPABASE_DB_URL: target.href };
execFileSync('psql', [base.href, '-X', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${name}`], {
  stdio: 'pipe',
});
try {
  for (let i = 0; i < 2; i++)
    execFileSync(process.execPath, ['scripts/migrate.js'], { env, stdio: 'inherit' });
  const result = spawnSync(process.execPath, ['--test', 'tests/care/postgres.test.js'], {
    env,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} finally {
  execFileSync(
    'psql',
    [base.href, '-X', '-v', 'ON_ERROR_STOP=1', '-c', `drop database ${name} with (force)`],
    { stdio: 'pipe' },
  );
}

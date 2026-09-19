#!/usr/bin/env node
// Apply database migrations, once each, in order.
//
//   npm run migrate            # apply everything pending
//   npm run migrate:status     # what is applied, what is not
//   npm run migrate -- --dry-run
//   npm run migrate -- --baseline 009_optional_language_hint.sql   # adopt an
//                                 existing database without re-running its history
//
// This replaces two things that were quietly unsafe: pasting SQL into a web
// editor, and the `for f in supabase/0*.sql` loop in the README. Both re-run
// every file every time and record nothing, so "is 010 applied?" could only be
// answered by querying for a column and seeing whether it errored — which is
// exactly how 010 and 011 sat pending without anyone noticing.
//
// Three properties worth the file:
//
//   · each migration runs at most once, tracked in schema_migrations;
//   · each runs inside a transaction, so a failure halfway leaves nothing behind;
//   · a migration edited after it was applied is refused, not silently ignored —
//     the tree and the database would otherwise disagree with no way to tell.
//
// psql rather than a Postgres client library: it is already required by the
// documented setup, it handles the dollar-quoting and \-commands these files use,
// and it means no new dependency sits between this project and its own schema.

require('dotenv').config({ quiet: true });
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase');

// The Supabase CLI's local stack publishes this; it is a default, not a secret.
const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function databaseUrl() {
  const explicit = process.env.SUPABASE_DB_URL;
  if (explicit) return explicit;

  // Only assume the local default when SUPABASE_URL actually points at this
  // machine. Guessing at a remote host would be a way to apply migrations to
  // the wrong database.
  try {
    const host = new URL(process.env.SUPABASE_URL ?? '').hostname;
    if (['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(host)) return LOCAL_DB_URL;
  } catch { /* fall through to the error below */ }

  throw new Error(
    'Set SUPABASE_DB_URL to the Postgres connection string.\n' +
    `  Local Supabase CLI stack: ${LOCAL_DB_URL}\n` +
    '  Hosted project: Settings → Database → Connection string (session pooler).'
  );
}

function psql(url, args, input) {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    input,
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
}

function query(url, sql) {
  return psql(url, ['-t', '-A', '-F', '\t', '-c', sql]).trim();
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d{3}_.*\.sql$/.test(name))
    .sort();
}

const checksum = contents => crypto.createHash('sha256').update(contents).digest('hex').slice(0, 16);

function ensureLedger(url) {
  psql(url, ['-c', `
    create table if not exists schema_migrations (
      version     text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `]);
}

function applied(url) {
  const rows = query(url, 'select version, checksum, applied_at from schema_migrations order by version');
  if (!rows) return new Map();
  return new Map(rows.split('\n').map(line => {
    const [version, sum, at] = line.split('\t');
    return [version, { checksum: sum, applied_at: at }];
  }));
}

function plan(url) {
  const done = applied(url);
  const pending = [];
  const drifted = [];

  for (const file of migrationFiles()) {
    const contents = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const sum = checksum(contents);
    const record = done.get(file);
    if (!record) pending.push({ file, sum, contents });
    else if (record.checksum !== sum) drifted.push({ file, was: record.checksum, now: sum, applied_at: record.applied_at });
  }
  return { done, pending, drifted };
}

function status(url) {
  const { done, pending, drifted } = plan(url);
  console.log(`\nDatabase: ${url.replace(/:\/\/[^@]*@/, '://***@')}\n`);

  for (const file of migrationFiles()) {
    const record = done.get(file);
    const mark = record ? '✓' : '·';
    const when = record ? new Date(record.applied_at).toISOString().slice(0, 16).replace('T', ' ') : 'pending';
    console.log(`  ${mark} ${file.padEnd(46)} ${when}`);
  }

  if (drifted.length) {
    console.log('\nEdited after being applied — the tree and the database disagree:');
    for (const row of drifted) console.log(`  ! ${row.file}  applied ${row.applied_at}`);
    console.log('\nWrite a new migration rather than editing an applied one. If the edit was');
    console.log('cosmetic and the schema is genuinely unchanged, re-stamp it with:');
    console.log('  node scripts/migrate.js --accept-drift <file>\n');
  }
  console.log(`\n${done.size} applied, ${pending.length} pending${drifted.length ? `, ${drifted.length} drifted` : ''}.\n`);
  return { pending, drifted };
}

function migrate(url, { dryRun }) {
  const { pending, drifted } = plan(url);

  if (drifted.length) {
    throw new Error(
      `${drifted.length} applied migration(s) have been edited: ${drifted.map(d => d.file).join(', ')}.\n` +
      'Refusing to continue — run npm run migrate:status for what to do.'
    );
  }
  if (!pending.length) {
    console.log('\nNothing pending. The database is up to date.\n');
    return;
  }

  console.log(`\n${pending.length} migration(s) to apply:\n`);
  for (const { file } of pending) console.log(`  ${file}`);
  if (dryRun) return console.log('\n--dry-run: nothing applied.\n');

  console.log('');
  for (const { file, sum, contents } of pending) {
    process.stdout.write(`  applying ${file} … `);
    // -1 wraps the file in a single transaction, so a migration that fails
    // halfway leaves the schema exactly as it was. The ledger insert rides in
    // the same transaction: a recorded migration is an applied one.
    const sql = `${contents}\n\ninsert into schema_migrations (version, checksum) values ('${file}', '${sum}');\n`;
    try {
      psql(url, ['-1', '-f', '-'], sql);
      console.log('ok');
    } catch (err) {
      console.log('FAILED');
      const detail = (err.stderr || err.stdout || err.message).toString().trim();
      throw new Error(`${file} failed and was rolled back:\n\n${detail}\n`, { cause: err });
    }
  }
  console.log(`\nApplied ${pending.length} migration(s).\n`);
}

// Adopting a database that predates this ledger.
//
// Without this the first run would try to re-apply 001 to a live schema. Most of
// these files are `if not exists` and would survive it, but 009 drops a column
// default and 011 drops an index — re-running is wrong in principle whatever the
// individual file happens to tolerate.
//
// Stamps every migration up to and including `through` as applied WITHOUT running
// it. Only correct when you know those migrations are already in the database.
function baseline(url, through) {
  const files = migrationFiles();
  if (!files.includes(through)) {
    throw new Error(`No such migration: ${through}\n\nKnown:\n  ${files.join('\n  ')}`);
  }
  const upTo = files.slice(0, files.indexOf(through) + 1);
  const values = upTo
    .map(file => `('${file}', '${checksum(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))}')`)
    .join(', ');

  psql(url, ['-c',
    `insert into schema_migrations (version, checksum) values ${values} on conflict (version) do nothing`]);

  console.log(`\nMarked ${upTo.length} migration(s) as already applied, without running them:\n`);
  for (const file of upTo) console.log(`  ${file}`);
  console.log('\nNothing in the database was changed. Run npm run migrate:status to confirm.\n');
}

function acceptDrift(url, file) {
  const contents = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  psql(url, ['-c', `update schema_migrations set checksum = '${checksum(contents)}' where version = '${file}'`]);
  console.log(`Re-stamped ${file}. This changed no schema — only the record of what was applied.`);
}

function main() {
  const args = process.argv.slice(2);
  const url = databaseUrl();

  // The ledger has to exist before it can be read, so create it for --status too.
  // It is an empty table on a fresh database, which reports everything as pending.
  ensureLedger(url);
  if (args.includes('--status')) return void status(url);

  if (args.includes('--baseline')) return baseline(url, args[args.indexOf('--baseline') + 1]);
  if (args.includes('--accept-drift')) return acceptDrift(url, args[args.indexOf('--accept-drift') + 1]);
  migrate(url, { dryRun: args.includes('--dry-run') });
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { checksum, migrationFiles, MIGRATIONS_DIR };

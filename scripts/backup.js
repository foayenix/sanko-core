#!/usr/bin/env node
// Encrypted database backups, and a restore you have actually performed.
//
//   npm run backup                 # dump, encrypt, prune, record
//   npm run backup:verify          # restore the newest dump into a scratch
//                                  # database and compare row counts
//   npm run backup:status          # what exists, how old, was it verified
//
// Sanko's whole claim is an archive that cannot be reconstructed. An
// unreconstructable archive with no tested restore is one disk away from being
// the thing it promised not to be — and a backup nobody has ever restored is a
// hypothesis, not a backup. Hence `verify`, which is the half that usually gets
// skipped and the half that matters.
//
// ── encryption ──
// AES-256-GCM with a key from BACKUP_ENCRYPTION_KEY (32 bytes, hex or base64).
// Node's own crypto rather than gpg/age so a restore needs nothing but this
// repository and the key. GCM because a backup you cannot tell has been altered
// is not much better than no backup: decryption fails loudly on tampering.
//
// The key is not in this repository and must not be. Losing it loses the
// backups; storing it beside them defeats the encryption.

require('dotenv').config();
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { env, envNumber } = require('../src/utils/env');

const BACKUP_DIR = env('BACKUP_DIR', path.join(__dirname, '..', 'backups'));
const KEEP = envNumber('BACKUP_KEEP', 14);
const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const MANIFEST = () => path.join(BACKUP_DIR, 'manifest.json');

// Counted before and after a restore. If these do not match, the backup is not
// a backup of what you think it is.
const COUNTED_TABLES = [
  'practitioners', 'formulations', 'patients', 'treatments',
  'media', 'corrections', 'events', 'agent_messages',
];

// pg_dump refuses to dump a server newer than itself, and Homebrew's postgresql
// formula lags the Supabase container by a major version routinely. Rather than
// making the operator chase versions, find a dump binary that matches — and fall
// back to running pg_dump inside the database container, which is always the
// right version by construction.
function dumpCommand(url) {
  const explicit = env('PG_DUMP_PATH');
  if (explicit) return { argv0: explicit, wrap: args => args };

  const serverMajor = Number(serverVersion(url).split('.')[0]);
  const candidates = [
    'pg_dump',
    `/opt/homebrew/opt/postgresql@${serverMajor}/bin/pg_dump`,
    `/usr/local/opt/postgresql@${serverMajor}/bin/pg_dump`,
    `/usr/lib/postgresql/${serverMajor}/bin/pg_dump`,
  ];
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ['--version'], { encoding: 'utf8' });
      const major = Number(version.match(/(\d+)\./)?.[1]);
      if (major >= serverMajor) return { argv0: candidate, wrap: args => args };
    } catch { /* not installed, or not on PATH */ }
  }

  const container = env('SUPABASE_DB_CONTAINER') ?? findDbContainer();
  if (container) {
    // Inside the container the server is always local, whatever the host URL says.
    const inner = url.replace(/@[^/]+\//, '@127.0.0.1:5432/');
    return {
      argv0: 'docker',
      wrap: args => ['exec', '-i', container, 'pg_dump', ...args.map(a => (a === url ? inner : a))],
      via: container,
    };
  }

  throw new Error(
    `The server is Postgres ${serverMajor} and no pg_dump of that version was found.\n\n` +
    `Either install one (brew install postgresql@${serverMajor}), set PG_DUMP_PATH to it,\n` +
    'or start the Supabase container stack so the dump can run inside it.'
  );
}

function serverVersion(url) {
  return execFileSync('psql', [url, '-t', '-A', '-c', 'show server_version'], { encoding: 'utf8' }).trim();
}

function findDbContainer() {
  try {
    return execFileSync('docker', ['ps', '--filter', 'name=supabase_db', '--format', '{{.Names}}'], { encoding: 'utf8' })
      .split('\n').map(name => name.trim()).filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

function databaseUrl() {
  const explicit = env('SUPABASE_DB_URL');
  if (explicit) return explicit;
  try {
    const host = new URL(env('SUPABASE_URL') ?? '').hostname;
    if (['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(host)) return LOCAL_DB_URL;
  } catch { /* fall through */ }
  throw new Error('Set SUPABASE_DB_URL to the Postgres connection string.');
}

function key() {
  const raw = env('BACKUP_ENCRYPTION_KEY');
  if (!raw) {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY is not set.\n\n' +
      'Generate one and put it somewhere that is NOT this machine and NOT beside the backups:\n\n' +
      `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\n\n` +
      'Lose this key and the backups are unreadable. That is the point of it.'
    );
  }
  const buffer = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buffer.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return buffer;
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST(), 'utf8'));
  } catch {
    return { backups: [] };
  }
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST(), `${JSON.stringify(manifest, null, 2)}\n`);
}

function rowCounts(url) {
  const sql = COUNTED_TABLES
    .map(table => `select '${table}' as t, count(*)::text as c from ${table}`)
    .join(' union all ');
  const out = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '\t', '-c', sql], { encoding: 'utf8' });
  return Object.fromEntries(
    out.trim().split('\n').filter(Boolean).map(line => {
      const [table, count] = line.split('\t');
      return [table, Number(count)];
    })
  );
}

// ─── backup ───────────────────────────────────────────────────────────────────

function backup() {
  const url = databaseUrl();
  const encryptionKey = key();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `sanko-${stamp}.sql.gz.enc`);

  const counts = rowCounts(url);
  console.log(`\nDumping ${Object.values(counts).reduce((a, b) => a + b, 0)} rows across ${COUNTED_TABLES.length} tables…`);

  // --no-owner / --no-acl so the dump restores into a scratch database owned by
  // whoever is verifying, rather than demanding the original role names exist.
  const { argv0, wrap, via } = dumpCommand(url);
  if (via) console.log(`Using pg_dump inside ${via} — the host binary is older than the server.`);
  const dump = execFileSync(argv0, wrap([url, '--no-owner', '--no-acl', '--clean', '--if-exists']), {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 512,
  });

  const compressed = zlib.gzipSync(dump, { level: 9 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);

  // iv | authTag | ciphertext — everything a restore needs except the key.
  fs.writeFileSync(file, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));

  const manifest = readManifest();
  manifest.backups.push({
    file: path.basename(file),
    created_at: startedAt.toISOString(),
    bytes: fs.statSync(file).size,
    plain_bytes: dump.length,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    row_counts: counts,
    verified_at: null,
  });
  manifest.backups.sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Prune oldest first, keeping the newest KEEP. Verified backups are never the
  // last thing standing by accident: the newest is always kept regardless.
  while (manifest.backups.length > KEEP) {
    const dropped = manifest.backups.shift();
    try { fs.unlinkSync(path.join(BACKUP_DIR, dropped.file)); } catch { /* already gone */ }
    console.log(`  pruned ${dropped.file}`);
  }
  writeManifest(manifest);

  const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
  console.log(`\nWrote ${path.relative(process.cwd(), file)} (${mb} MB encrypted)`);
  console.log(`Row counts recorded: ${JSON.stringify(counts)}`);
  console.log('\nThis backup has NOT been verified. Run: npm run backup:verify\n');
}

// ─── verify ───────────────────────────────────────────────────────────────────

// Restores the newest backup into a throwaway database and compares row counts
// against what the manifest recorded at dump time.
function verify() {
  const encryptionKey = key();
  const manifest = readManifest();
  const record = manifest.backups.at(-1);
  if (!record) throw new Error('No backups to verify. Run npm run backup first.');

  const file = path.join(BACKUP_DIR, record.file);
  console.log(`\nVerifying ${record.file}…\n`);

  const onDisk = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (onDisk !== record.sha256) {
    throw new Error(`Checksum mismatch — the file on disk is not the file that was written.\n  manifest: ${record.sha256}\n  on disk:  ${onDisk}`);
  }
  console.log('  ✓ checksum matches the manifest');

  const blob = fs.readFileSync(file);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  let sql;
  try {
    sql = zlib.gunzipSync(Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]));
  } catch (err) {
    throw new Error(`Decryption failed: ${err.message}\n\nEither BACKUP_ENCRYPTION_KEY is not the key this was written with, or the file was altered.`);
  }
  console.log(`  ✓ decrypts and decompresses (${(sql.length / 1024 / 1024).toFixed(2)} MB of SQL)`);

  // A scratch database on the same server. Dropped whether or not this succeeds.
  const url = databaseUrl();
  const scratch = `sanko_restore_check_${Date.now()}`;
  const adminUrl = url.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
  const scratchUrl = url.replace(/\/[^/?]+(\?|$)/, `/${scratch}$1`);

  const psqlAdmin = sql_ => execFileSync('psql', [adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql_], { encoding: 'utf8' });

  try {
    psqlAdmin(`create database ${scratch}`);
    console.log(`  ✓ created scratch database ${scratch}`);

    execFileSync('psql', [scratchUrl, '-q', '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, stdio: ['pipe', 'ignore', 'pipe'] });
    console.log('  ✓ restored without error');

    const restored = rowCounts(scratchUrl);
    const mismatches = COUNTED_TABLES.filter(table => (restored[table] ?? -1) !== (record.row_counts[table] ?? -1));
    if (mismatches.length) {
      throw new Error(
        'Row counts do not match the dump:\n' +
        mismatches.map(t => `  ${t}: backed up ${record.row_counts[t]}, restored ${restored[t]}`).join('\n')
      );
    }
    console.log(`  ✓ every table restored the same row count (${Object.values(restored).reduce((a, b) => a + b, 0)} rows)`);
  } finally {
    try {
      psqlAdmin(`drop database if exists ${scratch} with (force)`);
      console.log(`  ✓ dropped scratch database`);
    } catch (err) {
      console.error(`  ! could not drop ${scratch}: ${err.message}`);
    }
  }

  record.verified_at = new Date().toISOString();
  writeManifest(manifest);
  console.log('\nRESTORE VERIFIED. This backup has been restored, not just written.\n');
}

// ─── status ───────────────────────────────────────────────────────────────────

function status() {
  const manifest = readManifest();
  if (!manifest.backups.length) {
    console.log('\nNo backups yet. Run: npm run backup\n');
    return;
  }
  console.log(`\n${manifest.backups.length} backup(s) in ${BACKUP_DIR}\n`);
  for (const record of manifest.backups.slice(-10)) {
    const age = Math.round((Date.now() - Date.parse(record.created_at)) / 3_600_000);
    const rows = Object.values(record.row_counts).reduce((a, b) => a + b, 0);
    console.log(`  ${record.created_at.slice(0, 16).replace('T', ' ')}  ${(record.bytes / 1024 / 1024).toFixed(2).padStart(7)} MB  ${String(rows).padStart(6)} rows  ${age}h old  ${record.verified_at ? 'verified' : 'UNVERIFIED'}`);
  }
  const newest = manifest.backups.at(-1);
  const ageHours = (Date.now() - Date.parse(newest.created_at)) / 3_600_000;
  if (ageHours > 48) console.log(`\n! The newest backup is ${Math.round(ageHours / 24)} days old.`);
  if (!manifest.backups.some(b => b.verified_at)) console.log('\n! No backup has ever been restored. Run npm run backup:verify.');
  console.log('');
}

function main() {
  const command = process.argv[2] ?? 'backup';
  if (command === 'backup') return backup();
  if (command === 'verify') return verify();
  if (command === 'status') return status();
  throw new Error(`Unknown command "${command}". Use: backup | verify | status`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { readManifest, BACKUP_DIR, COUNTED_TABLES };

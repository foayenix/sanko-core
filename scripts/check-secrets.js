#!/usr/bin/env node
// Refuse to let a credential into the repository.
//
//   node scripts/check-secrets.js            # scan tracked files
//   node scripts/check-secrets.js --staged   # scan what is about to be committed
//
// A leaked service-role key is not a bug you notice — it is one you find out
// about later, from a bill or from data that is gone. Supabase's service role
// bypasses RLS entirely, so that one key is the whole Vault.
//
// This is a floor, not a guarantee. It catches the shapes of the keys this
// project actually uses; it cannot catch a secret that looks like prose.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Ordered most to least specific so the report names the real thing.
const PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'Supabase / JWT-shaped key', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // Loopback is excluded on purpose: the Supabase CLI's local stack ships a
  // published default of postgres:postgres@127.0.0.1, and blocking the documented
  // command for applying migrations would train everyone to pass --no-verify.
  { name: 'Postgres connection string with password', re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@(?!127\.0\.0\.1|localhost|\[?::1)/ },
  { name: 'Meta access token', re: /EAA[A-Za-z0-9]{40,}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

// Files whose whole job is to show the shape of a secret without being one.
const ALLOWED_FILES = new Set(['.env.example', 'scripts/check-secrets.js']);

// The Supabase CLI's local stack signs its anon and service keys with a published
// demo secret, so these exact tokens are identical on every machine and valid only
// against 127.0.0.1. Same reasoning as the loopback exclusion above: they are not
// credentials, and flagging them would train people past the check. Matched whole,
// so a real key that merely resembles one is still reported.
const PUBLISHED_LOCAL_KEYS = new Set([
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
]);

// A placeholder is not a secret. Everything here is a value the templates and
// docs use deliberately.
const PLACEHOLDER = /(your[-_]?|example|placeholder|xxx|<[^>]+>|\.\.\.|changeme|redacted|REPLACE)/i;

const BINARY = /\.(png|jpg|jpeg|gif|webp|woff2?|ttf|otf|ico|pdf|zip|gz|bin|ggml|mp3|ogg|wav|m4a)$/i;

function trackedFiles(staged) {
  const args = staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACM']
    : ['ls-files'];
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map(name => name.trim())
    .filter(Boolean)
    .filter(name => !BINARY.test(name))
    .filter(name => !ALLOWED_FILES.has(name));
}

function scanFiles(files) {
  const findings = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    let contents;
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > 2_000_000) continue;
      contents = fs.readFileSync(absolute, 'utf8');
    } catch {
      continue; // deleted between listing and reading
    }
    findings.push(...scan(file, contents));
  }
  return findings;
}

// Pure, so the rules can be tested without writing a fake secret to disk.
function scan(file, contents) {
  const findings = [];
  {
    // A NUL byte means this is binary despite the extension; skip rather than
    // regex-scan megabytes of noise.
    if (contents.includes('\u0000')) return findings;

    contents.split('\n').forEach((line, index) => {
      // An inlined image is a wall of base64 that will eventually contain any
      // fixed prefix you look for — "EAA" turns up inside PNG data routinely.
      if (line.includes(';base64,')) return;
      for (const { name, re } of PATTERNS) {
        const match = line.match(re);
        if (!match || PLACEHOLDER.test(match[0]) || PUBLISHED_LOCAL_KEYS.has(match[0])) continue;
        findings.push({ file, line: index + 1, name, sample: `${match[0].slice(0, 12)}...` });
        break;
      }
    });
  }
  return findings;
}

function main() {
  const findings = scanFiles(trackedFiles(process.argv.includes('--staged')));

  if (!findings.length) {
    console.log('No credentials found in the scanned files.');
    return;
  }

  console.error('\nPossible credentials found:\n');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.name}  ${finding.sample}`);
  }
  console.error('\nIf one of these is real: rotate it first, then remove it from history.');
  console.error('Rotating is the part that matters — a key that reached a remote is compromised');
  console.error('whether or not the commit is rewritten.\n');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { scan, scanFiles, PATTERNS };

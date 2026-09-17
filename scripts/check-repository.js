#!/usr/bin/env node
'use strict';

// Check the checkout, not a developer's untracked files or installed services.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const tracked = new Set(files);
const errors = [];
for (const file of files) {
  if (/(^|\/)(node_modules|dist|backups|logs|models|\.baileys-auth|\.git)(\/|$)/.test(file) ||
      /(^|\/)\.env(?:\.|$)/.test(file) && file !== '.env.example' ||
      /^(tmp\/|evals\/cases\/drafts\/|data\/plants\/references\/staged\/)/.test(file) ||
      file === 'data/plants/review_queue.json') errors.push(`Private/generated file tracked: ${file}`);
  if (!fs.existsSync(path.join(root, file))) errors.push(`Missing tracked file: ${file}`);
}
for (const required of ['.env.example', 'governance/contributor-terms-v1.md', 'governance/contributor-terms-v1.summary.txt',
  'data/plants/sources.json', 'data/plants/legacy_lookup_v1.json', 'data/plants/practitioner_confirmations.json',
  'docs/REPOSITORY_TRANSFER.md', 'docs/MIGRATION_BACKLOG.md']) {
  if (!tracked.has(required)) errors.push(`Required file not tracked: ${required}`);
}
for (const manifest of ['package.json', 'sanko-landing page/package.json']) {
  const dir = path.dirname(manifest);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'));
  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const match of command.matchAll(/\bnode\s+(?:"([^"]+\.(?:m?js))"|([^\s]+\.(?:m?js)))/g)) {
      const target = path.posix.normalize(path.posix.join(dir, match[1] || match[2]));
      if (!tracked.has(target)) errors.push(`${manifest} script ${name} targets untracked file: ${target}`);
    }
  }
}
for (const file of files.filter(file => /\.(?:js|mjs|jsx)$/.test(file))) {
  const text = fs.readFileSync(path.join(root, file), 'utf8').split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
  for (const match of text.matchAll(/(?:require\(\s*|from\s+)['"](\.[^'"]+)['"]/g)) {
    const target = path.posix.normalize(path.posix.join(path.dirname(file), match[1]));
    const candidates = [target, `${target}.js`, `${target}.jsx`, `${target}.mjs`, `${target}.json`, `${target}/index.js`];
    if (!candidates.some(candidate => tracked.has(candidate))) errors.push(`${file} references untracked module: ${match[1]}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Repository structure valid: ${files.length} tracked files; script targets and local imports present.`);

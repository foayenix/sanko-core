'use strict';
// The Atlas never reads Vault, care or formulation data
// (docs/SANKO_EVIDENCE_ATLAS_SPEC.md, sections 4 and 5.7).
//
// That is enforced structurally: every module reachable from the literature
// scripts must be a Node built-in, a file in src/literature/, or one of the
// literature scripts themselves. No npm package (so no Supabase or Postgres
// client), and nothing else under src/.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const root = path.join(__dirname, '..');
const ENTRY_POINTS = [
  'scripts/literature-discover.js',
  'scripts/literature-select-pilot.js',
  'scripts/literature-review.js',
  'scripts/literature-build.js',
];
const ALLOWED_LOCAL = [/^src\/literature\/[a-z-]+\.js$/, /^scripts\/literature-[a-z-]+\.js$/];

function requires(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return [...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
}

function walk() {
  const seen = new Set();
  const external = new Set();
  const stack = [...ENTRY_POINTS];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of requires(file)) {
      if (specifier.startsWith('.')) {
        let target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        if (!target.endsWith('.js')) target = `${target}.js`;
        stack.push(target);
      } else {
        external.add(specifier);
      }
    }
  }
  return { seen, external };
}

describe('literature index separation', () => {
  it('reaches only Node built-ins', () => {
    const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
    const { external } = walk();
    const packages = [...external].filter(name => !builtins.has(name));
    assert.deepEqual(packages, [], `the Atlas must not require npm packages: ${packages.join(', ')}`);
  });

  it('reaches no application module outside src/literature', () => {
    const { seen } = walk();
    const outside = [...seen].filter(file => !ALLOWED_LOCAL.some(pattern => pattern.test(file)));
    assert.deepEqual(outside, []);
  });

  it('keeps database and private-data vocabulary out of the literature code', () => {
    const { seen } = walk();
    for (const file of seen) {
      const text = fs.readFileSync(path.join(root, file), 'utf8')
        .split('\n').filter(line => !/^\s*(\/\/|\*)/.test(line)).join('\n');
      assert.doesNotMatch(text, /supabase|SUPABASE_|DATABASE_URL|process\.env/i, `${file} must not touch database configuration`);
    }
  });
});

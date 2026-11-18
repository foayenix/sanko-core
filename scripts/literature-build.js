#!/usr/bin/env node
// Validate the committed literature data and generate the public index site.
//
//   node scripts/literature-build.js [--out build/atlas] [--release --corrections-url <https|mailto>]
//   node scripts/literature-build.js --check        # validate only, write nothing
//
// The build reads committed files only (data/plants, data/literature). It has no
// database connection and must stay that way: tests/literature-separation.test.js
// fails if this script or anything it requires reaches beyond node built-ins and
// src/literature/. Output is deterministic for the same inputs; the date shown is
// the latest date in the data, not the time of the build.
//
// Without --release the pages carry a "Preview build — not released" banner.

const fs = require('fs');
const path = require('path');
const store = require('../src/literature/store');
const site = require('../src/literature/site');

const root = path.join(__dirname, '..');

function readPlants(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'data', 'plants', name), 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const flag = name => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1];
  };
  const plants = readPlants('plants.json');
  const data = store.load(flag('--dir') || store.DEFAULT_DIRECTORY);
  const errors = store.validate(data, { taxonIds: new Set(plants.map(plant => plant.id)) });
  if (errors.length) {
    console.error(`Literature data is invalid (${errors.length} problems):\n${errors.slice(0, 40).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  if (argv.includes('--check')) {
    console.log(`Literature data valid: ${data.studies.length} studies, ${data.entries.length} entries, ${data.verifications.length} verification events.`);
    return;
  }

  const model = site.buildModel({
    plants,
    vernacularNames: readPlants('vernacular_names.json'),
    sources: readPlants('sources.json'),
    data,
  });
  const release = argv.includes('--release');
  const correctionsUrl = flag('--corrections-url');
  if (correctionsUrl && !/^(https:\/\/|mailto:)/.test(correctionsUrl)) throw new Error('--corrections-url must be https:// or mailto:');
  const files = site.renderSite(model, { release, correctionsUrl });

  const out = path.resolve(root, flag('--out') || path.join('build', 'atlas'));
  fs.rmSync(out, { recursive: true, force: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(out, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const listed = model.taxa.reduce((sum, taxon) => sum + taxon.listed.length, 0);
  const awaiting = model.taxa.reduce((sum, taxon) => sum + taxon.awaiting, 0);
  console.log(`${release ? 'Release' : 'Preview'} site written to ${path.relative(root, out)}: ${model.taxa.length} plants, ${listed} verified studies listed, ${awaiting} awaiting verification.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { main };

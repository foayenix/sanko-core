#!/usr/bin/env node
'use strict';
// Pointers from the plant index to two reference sources for formulation
// evidence work: phytochemistry (ANPDB) and regulatory safety statements
// (ANSES Opinion 2019-SA-0155).
//
//   node scripts/stage-evidence-references.js               # fetch pinned inputs, write overlap
//   node scripts/stage-evidence-references.js --dry-run
//   node scripts/stage-evidence-references.js --anpdb species.csv --anses plants.jsonl
//
// Neither source says anything about what a plant is called in Nigeria, so
// neither can produce a vernacular mapping. Both are registered in sources.json
// as reference_only and the build ignores them. What this writes is a lookup
// for an evidence analyst: for each taxon already in the index, where to start
// looking for its chemistry and for European regulatory safety wording.
//
// ── what is kept, and what is not ──
// ANPDB (CC BY-NC 4.0): its species id, the names it lists, NCBI taxonomy id,
// how many compounds it records, and the reference links it cites. Its
// `species_known_use` prose is not kept: it carries no citation. The licence
// is non-commercial; a report that cites ANPDB should cite the primary papers
// it links to, and commercial use of ANPDB itself needs a separate licence.
//
// ANSES: which rows exist for a taxon and which kinds of statement each row
// makes (contraindication, interaction, pregnancy/lactation, paediatric). The
// French statements themselves are not copied. ANSES serves its workbook behind
// a bot challenge, so rows are located through Vitagram's extraction, pinned to
// a commit; the workbook checksum Vitagram reports has not been verified here.
// An analyst reads the statement from the ANSES workbook, not from this file.
//
// Matching is exact on the binomial (accepted name or any name as published in
// the index; ANPDB's listed and most-recent names; ANSES's name and its "syn."
// name). It does not chase GBIF synonyms, so it undercounts rather than guesses.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const plantsDirectory = path.join(root, 'data', 'plants');
const runtimePath = path.join(root, 'data', 'plant_lookup_v1.json');
const outputPath = path.join(plantsDirectory, 'surveys', 'discovery', 'evidence-reference-overlap.json');

const ANPDB = {
  source_id: 'anpdb-african-natural-products',
  url: 'https://phabidb.vm.uni-freiburg.de/static/anpdb/download/ANPDB_species.csv',
  licence: 'CC BY-NC 4.0'
};
const VITAGRAM_COMMIT = 'f83a13c00878fed89cc9c36dc42ab0333eeaf2c5';
const ANSES = {
  source_id: 'anses-2019-sa-0155-herbal-supplements',
  primary_url: 'https://www.anses.fr/system/files//Tableau-recapitulatif-plantes-complements-alimentaires-juin-2023.xlsx',
  primary_sha256_as_reported: 'd50d2741ae7a91b5135b009af45e42e5645bfbdbb6a4500fc4a0dccc09e3dc6d',
  extraction: {
    repository: 'https://github.com/vitagram-co/vitagram-drug-herb-supplement-interactions',
    commit: VITAGRAM_COMMIT,
    file: 'data/plants.jsonl',
    url: `https://raw.githubusercontent.com/vitagram-co/vitagram-drug-herb-supplement-interactions/${VITAGRAM_COMMIT}/data/plants.jsonl`
  }
};

function readJson(...segments) {
  return JSON.parse(fs.readFileSync(path.join(...segments), 'utf8'));
}

function flag(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// RFC 4180: quoted fields may hold commas, newlines and doubled quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(cells => cells.some(cell => cell !== ''));
  return body.map(cells => Object.fromEntries(header.map((name, index) => [name.replace(/^\uFEFF/, ''), cells[index] ?? ''])));
}

// "Mentha x piperita L." -> "mentha x piperita"; "Abelmoschus esculentus (L.)" -> "abelmoschus esculentus".
// Returns null for anything that does not name a species (a genus, "sp.", "spp.").
function binomial(name) {
  const tokens = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/×/g, ' x ').trim().split(/\s+/);
  if (tokens.length < 2 || !/^[A-Z][a-z-]+$/.test(tokens[0])) return null;
  const hybrid = tokens[1].toLowerCase() === 'x';
  const epithet = hybrid ? tokens[2] : tokens[1];
  if (!epithet || !/^[a-z][a-z-]+$/.test(epithet) || /^spp?\.?$/.test(epithet)) return null;
  return [tokens[0], ...(hybrid ? ['x'] : []), epithet].join(' ').toLowerCase();
}

// ANSES prints synonyms inline: "Actaea racemosa L. (syn. Cimicifuga racemosa (L.) Nutt.)".
function ansesNames(scientificName) {
  const names = [binomial(scientificName)];
  for (const match of String(scientificName || '').matchAll(/syn\.\s*([A-Z][a-z-]+\s+(?:[x×]\s+)?[a-z-]+)/g)) names.push(binomial(match[1]));
  return [...new Set(names.filter(Boolean))];
}

function statementPresent(text) {
  const value = String(text ?? '').trim();
  return value !== '' && value !== '-';
}

function splitList(value) {
  return [...new Set(String(value || '').split('|').map(item => item.trim()).filter(Boolean))];
}

function buildOverlap({ plants, runtime, anpdbRows, ansesRows }) {
  const runtimeBotanicals = new Set(runtime.map(row => binomial(row.botanical)).filter(Boolean));
  const taxonByName = new Map();
  for (const plant of plants) {
    for (const name of [plant.accepted_botanical, ...(plant.botanical_names_as_published || [])]) {
      const key = binomial(name);
      if (key && !taxonByName.has(key)) taxonByName.set(key, plant);
    }
  }

  const taxa = new Map();
  const entryFor = plant => {
    if (!taxa.has(plant.id)) {
      taxa.set(plant.id, {
        plant_id: plant.id,
        accepted_botanical: plant.accepted_botanical,
        in_runtime_index: runtimeBotanicals.has(binomial(plant.accepted_botanical)),
        anpdb: [],
        anses: []
      });
    }
    return taxa.get(plant.id);
  };
  const matchedPlants = names => [...new Set(names.map(name => taxonByName.get(name)).filter(Boolean))];

  for (const row of anpdbRows) {
    const names = [...new Set([binomial(row.source_species), binomial(row.species_most_recent_name)].filter(Boolean))];
    for (const plant of matchedPlants(names)) {
      entryFor(plant).anpdb.push({
        species_id: row.species_id,
        name_as_listed: row.source_species,
        most_recent_name: row.species_most_recent_name || null,
        ncbi_taxonomy_id: row.ncbi_taxonomy_id || null,
        molecule_count: splitList(row.molecule_ids).length,
        references: splitList(row.Reference_link)
      });
    }
  }

  for (const row of ansesRows) {
    const data = row.source_data || {};
    for (const plant of matchedPlants(ansesNames(row.scientific_name))) {
      entryFor(plant).anses.push({
        record_id: row.id,
        source_sheet: row.source_sheet ?? null,
        source_row: row.source_row ?? null,
        scientific_name_as_published: row.scientific_name,
        plant_part: row.plant_part ?? null,
        statements_present: {
          contraindication: statementPresent(data.contraindications_text_fr),
          interaction: statementPresent(data.interactions_text_fr),
          pregnancy_lactation: statementPresent(data.pregnant_restriction_text_fr),
          paediatric: statementPresent(data.pediatric_restriction_text_fr)
        }
      });
    }
  }

  const list = [...taxa.values()].sort((a, b) => a.accepted_botanical.localeCompare(b.accepted_botanical));
  return {
    taxa: list,
    summary: {
      index_taxa: plants.length,
      taxa_with_any_reference: list.length,
      taxa_in_anpdb: list.filter(taxon => taxon.anpdb.length).length,
      taxa_in_anses: list.filter(taxon => taxon.anses.length).length,
      runtime_taxa_in_anpdb: list.filter(taxon => taxon.in_runtime_index && taxon.anpdb.length).length,
      runtime_taxa_in_anses: list.filter(taxon => taxon.in_runtime_index && taxon.anses.length).length,
      anses_rows_with_interaction_statement: list.reduce((count, taxon) => count + taxon.anses.filter(row => row.statements_present.interaction).length, 0)
    }
  };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'sanko-plant-data/1.0' } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function main(argv = process.argv.slice(2), { fetcher = fetchText, now = () => new Date() } = {}) {
  const anpdbFile = flag(argv, '--anpdb');
  const ansesFile = flag(argv, '--anses');
  const anpdbText = anpdbFile ? fs.readFileSync(anpdbFile, 'utf8') : await fetcher(ANPDB.url);
  const ansesText = ansesFile ? fs.readFileSync(ansesFile, 'utf8') : await fetcher(ANSES.extraction.url);
  const anpdbRows = parseCsv(anpdbText);
  const ansesRows = ansesText.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  if (!anpdbRows.length || !('species_id' in anpdbRows[0])) throw new Error('ANPDB species file has no species_id column; the download format may have changed.');

  const { taxa, summary } = buildOverlap({
    plants: readJson(plantsDirectory, 'plants.json'),
    runtime: readJson(runtimePath),
    anpdbRows,
    ansesRows
  });
  const retrievedAt = now().toISOString().slice(0, 10);
  const output = {
    source_ids: [ANPDB.source_id, ANSES.source_id],
    runtime_export_eligible: false,
    purpose: 'Evidence-analyst lookup for formulation evidence work. Not vernacular evidence, not a safety or efficacy conclusion, and not for patient-facing or practitioner-facing interaction advice.',
    generated_at: retrievedAt,
    matching: 'Exact binomial match against accepted and as-published names in data/plants/plants.json. GBIF synonyms are not followed, so counts are a lower bound.',
    inputs: {
      anpdb: {
        url: ANPDB.url,
        licence: ANPDB.licence,
        version: 'not published by ANPDB; identify by retrieval date and checksum',
        retrieved_at: retrievedAt,
        sha256: sha256(anpdbText),
        species_rows: anpdbRows.length,
        omitted_fields: ['species_known_use (uncited prose)', 'species_wiki_link', 'molecule_ids (count kept)']
      },
      anses: {
        primary_url: ANSES.primary_url,
        primary_sha256_as_reported: ANSES.primary_sha256_as_reported,
        primary_checksum_verified: false,
        extraction_via: { ...ANSES.extraction, sha256: sha256(ansesText) },
        source_rows: ansesRows.length,
        omitted_fields: ['all French statement text; read it from the ANSES workbook']
      }
    },
    summary,
    taxa
  };

  console.log(JSON.stringify(summary, null, 2));
  if (argv.includes('--dry-run')) {
    console.log('--dry-run: nothing written.');
    return output;
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Written to ${path.relative(process.cwd(), outputPath)}`);
  return output;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { ANPDB, ANSES, ansesNames, binomial, buildOverlap, main, parseCsv, statementPresent };

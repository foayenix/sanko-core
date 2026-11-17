#!/usr/bin/env node
// Table 2 of the Bayelsa trado-orthopedic survey, into a staged survey file.
//
//   pdftotext -layout bayelsa.pdf bayelsa.txt
//   node scripts/extract-bayelsa-survey.js --text bayelsa.txt
//
// Olatokunbo, Olanipekun & Michael 2022, Asian Journal of Ethnobiology 5(2),
// doi:10.13057/asianjethnobiol/y050206. Thirty-nine species from fifteen
// communities across the three local government areas of Bayelsa Central
// Senatorial District, with a column the paper heads "Vernacular/Ijaw name".
//
// That column is why this source is worth the work: Ijaw had no names at all in
// the index, and no South-South source published one until now.
//
// ── the column, and the judgement in reading it ──
// The paper prints the English common name and the Ijaw name in one cell,
// separated by a slash, in either order — "Okro/ Kiyabu" but also "Eka/Bitter
// kola" — and sometimes only one of the two. Nothing in the cell says which is
// which. So the English names are listed out explicitly below, read off this
// one table, and everything else in the cell is taken as Ijaw.
//
// A list is used rather than a rule because no rule is honest here. "Haronga"
// looks Ijaw and is an English book name taken from the genus; "Aguava" looks
// English and is how the cell renders the local name. Writing the thirty-six
// English names down makes each of those a decision someone can check against
// the paper, rather than a regular expression nobody can argue with.
//
// Two cells yield no Ijaw name at all. "Hospital too far" is the Nigerian
// English by-name for Jatropha tanjorensis, and "Native pop" is an English
// common name for Ficus lutea; both are recorded as common English and produce
// no vernacular mapping.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outputPath = path.join(root, 'data', 'plants', 'surveys', 'olatokunbo-2022-bayelsa.json');

const SOURCE_ID = 'olatokunbo-2022-bayelsa';
const USE_CONTEXT = 'plant reported in traditional orthopedic care in Bayelsa Central Senatorial District';
const EXPECTED_ROWS = 39;

// Every English name printed in Table 2's vernacular column, in the spelling
// the paper uses — "Lime leave", "Tree of live" and "Cleome ciliate" are the
// authors', not typos introduced here.
const ENGLISH_NAMES = new Set([
  'okro', 'alligator pepper', 'green amaranth', 'african pepper', 'pawpaw', 'cotton tree',
  'lime leave', 'cleome', 'ginger lily', 'pasture weed', 'lemon grass', 'button weed',
  'eclipta', 'oil palm', 'bermuda grass', 'lagos rubber tree', 'native pop', 'bitter kola',
  'haronga', 'sweet potato', 'hospital too far', 'live leaf', 'mango', 'sensitive plant',
  'tree of live', 'scent leaf', 'amarus', 'african black pepper', 'purslane', 'guava',
  'catnip', "cat's tail grass", 'cat’s tail grass', 'cocoa', 'bitter leaf', 'ethiopian pepper',
  'ginger'
]);

function flag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

// pdftotext -layout keeps the table's columns as runs of spaces, and wraps a
// long vernacular cell onto a line of its own.
function parseTable(text) {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.includes('Botanical name') && line.includes('Vernacular/Ijaw name'));
  if (start === -1) throw new Error('Could not find the Table 2 header — is this the right PDF?');

  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.includes('OLATOKUNBO et al') || line.trim().startsWith('Table 3')) break;
    if (!line.trim()) continue;
    const cells = line.trim().split(/\s{2,}/).map(cell => cell.trim());
    if (cells.length >= 5) {
      const [botanical, family, habit, vernacular, abundance] = cells;
      rows.push({ botanical, family, habit, vernacular, abundance });
    } else if (rows.length) {
      rows[rows.length - 1].vernacular += ` ${cells.join(' ')}`;
    }
  }
  return rows;
}

function splitNames(cell) {
  const english = [];
  const ijaw = [];
  for (const token of cell.split(/[/,]/).map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    (ENGLISH_NAMES.has(token.toLowerCase()) ? english : ijaw).push(token);
  }
  return { english, ijaw };
}

function toSurveyRow(row, index) {
  const { english, ijaw } = splitNames(row.vernacular);
  return {
    source_id: SOURCE_ID,
    source_row: index + 1,
    botanical_as_published: row.botanical,
    family_as_published: row.family,
    common_english_as_published: english.join(', ') || null,
    habit_as_published: row.habit,
    abundance_as_published: row.abundance,
    // The cell exactly as printed, because the split above is a reading of it.
    vernacular_as_published: row.vernacular,
    vernacular_names: ijaw.map(local_name => ({ local_name, language: 'ijc' })),
    // Table 3 gives preparation and treatment in prose, not a parts column.
    // Parsing parts out of a sentence would be inventing structure the source
    // does not have, so nothing is claimed here.
    parts_reported: [],
    use_context: USE_CONTEXT
  };
}

function main(argv = process.argv.slice(2)) {
  const textPath = flag(argv, 'text');
  if (!textPath) throw new Error('Pass --text <file>, the output of: pdftotext -layout bayelsa.pdf bayelsa.txt');

  const parsed = parseTable(fs.readFileSync(path.resolve(textPath), 'utf8'));
  if (parsed.length !== EXPECTED_ROWS) {
    throw new Error(`Parsed ${parsed.length} rows; the paper reports ${EXPECTED_ROWS} species. Check the extraction before trusting it.`);
  }

  const rows = parsed.map(toSurveyRow);
  const unnamed = rows.filter(row => !row.vernacular_names.length);
  fs.writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);

  console.log(`${rows.length} rows → ${path.relative(process.cwd(), outputPath)}`);
  console.log(`  ${rows.reduce((total, row) => total + row.vernacular_names.length, 0)} Ijaw name(s) across ${rows.length - unnamed.length} species`);
  for (const row of unnamed) console.log(`  no Ijaw name: ${row.botanical_as_published} — cell reads "${row.vernacular_as_published}"`);
  return rows;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { ENGLISH_NAMES, parseTable, splitNames, toSurveyRow, main };

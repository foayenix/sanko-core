const fs = require('fs');
const path = require('path');

const SOURCE_ID = 'offiah-2011-plateau';
const LANGUAGE_CODES = { H: 'ha', Y: 'yo', I: 'ig', F: 'ff' };
const PART_COLUMNS = ['leaves', 'stem bark', 'roots', 'fruits', 'seeds', 'flower', 'whole plant'];

function decodeXml(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tableRows(xml) {
  const table = xml.match(/<table-wrap[^>]*>[\s\S]*?<label>Table 1<\/label>[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>[\s\S]*?<\/table-wrap>/i);
  if (!table) throw new Error('Could not find Plateau survey Table 1');

  return [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) =>
    [...row.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(([, cell]) => decodeXml(cell))
  );
}

function cleanName(value) {
  return value
    .replace(/^[\s'“”"]+|[\s'“”"]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseVernacularNames(published) {
  if (!published || published === '-') return [];

  const parenthetical = [];
  for (const match of published.matchAll(/([^;,]+?)\s*\((H|Hausa|Y|Yoruba|I|Igbo|F|Fulfulde)\)/gi)) {
    const code = match[2][0].toUpperCase();
    for (const name of match[1].split(/[\/,]/)) {
      const localName = cleanName(name);
      if (localName) parenthetical.push({ local_name: localName, language: LANGUAGE_CODES[code] });
    }
  }

  const marked = published
    .replace(/\s+(?=(?:H|Y|I|F)\s*:)/g, '; ')
    .split(';');
  const names = [...parenthetical];
  let language = null;

  for (let segment of marked) {
    segment = segment.trim();
    if (!segment) continue;

    const marker = segment.match(/^(H|Y|I|F)\s*:\s*(.*)$/i);
    if (marker) {
      language = LANGUAGE_CODES[marker[1].toUpperCase()];
      segment = marker[2];
    } else if (/^[A-Za-z][A-Za-z -]+\s*:/.test(segment)) {
      language = null;
      continue;
    }

    if (!language || /\([^)]*(?:Berom|Doemak|Gwari|Mushere|Mwagavul|Ron|Taroh)[^)]*\)/i.test(segment) || /[A-Za-z]+\s*:/.test(segment)) {
      continue;
    }

    for (const name of segment.split(/[\/,]/)) {
      const localName = cleanName(name);
      if (localName && !/\((?:H|Hausa|Y|Yoruba|I|Igbo|F|Fulfulde)\)$/i.test(localName)) {
        names.push({ local_name: localName, language });
      }
    }
  }

  const unique = new Map();
  for (const name of names) unique.set(`${name.language}:${name.local_name.toLocaleLowerCase('en')}`, name);
  return [...unique.values()];
}

function extractSurvey(xml) {
  const rows = tableRows(xml);
  const dataRows = rows.filter(row => /^\d+$/.test(row[0]) && row.length >= 13);
  if (dataRows.length !== 57) throw new Error(`Expected 57 data rows, found ${dataRows.length}`);

  return dataRows.map(row => ({
    source_id: SOURCE_ID,
    source_row: Number(row[0]),
    botanical_as_published: row[1].replace(/,+$/, '').trim(),
    family_as_published: row[2] === '-' ? null : row[2],
    common_english_as_published: row[3] === '-' ? null : row[3],
    vernacular_as_published: row[4] === '-' ? null : row[4],
    vernacular_names: parseVernacularNames(row[4]),
    parts_reported: PART_COLUMNS.filter((_, index) => row[index + 6] === '+'),
    evidence_frequency_as_published: row[5],
    use_context: 'ethnoveterinary diarrhoea management'
  }));
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Usage: node scripts/import-plateau-survey.js <PMC3162497-fullTextXML>');

  const outputPath = path.join(__dirname, '..', 'data', 'plants', 'surveys', 'offiah-2011-plateau.json');
  const survey = extractSurvey(fs.readFileSync(inputPath, 'utf8'));
  fs.writeFileSync(outputPath, `${JSON.stringify(survey, null, 2)}\n`);
  console.log(`Imported ${survey.length} source rows to ${outputPath}`);
}

if (require.main === module) main();

module.exports = { extractSurvey, parseVernacularNames };

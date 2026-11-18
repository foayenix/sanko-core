// Imports ethnobotanical survey tables from open-access Europe PMC JATS full
// text. Each source has its own extractor because no two articles lay a plant
// table out the same way; what they share is the row shape the build reads and
// the rule that published text is kept beside anything parsed out of it.
//
//   node scripts/import-jats-surveys.js <source-id> <fullTextXML>
//
// Full text: https://www.ebi.ac.uk/europepmc/webservices/rest/<PMCID>/fullTextXML

const fs = require('fs');
const path = require('path');

const surveysDirectory = path.join(__dirname, '..', 'data', 'plants', 'surveys');

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

function tableRows(xml, label) {
  for (const [wrap] of xml.matchAll(/<table-wrap[\s>][\s\S]*?<\/table-wrap>/gi)) {
    const found = wrap.match(/<label>([\s\S]*?)<\/label>/i);
    if (!found || decodeXml(found[1]) !== label) continue;
    return [...wrap.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) =>
      [...row.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(([, cell]) => decodeXml(cell))
    );
  }
  throw new Error(`Could not find ${label}`);
}

function expectRows(rows, expected, what) {
  if (rows.length !== expected) throw new Error(`Expected ${expected} ${what}, found ${rows.length}`);
  return rows;
}

const SINGULAR = { leaves: 'leaf', roots: 'root', seeds: 'seed', fruits: 'fruit', bulbs: 'bulb', rhizomes: 'rhizome', pods: 'pod', nuts: 'nut' };

function splitList(value, separator = /,/) {
  const items = (value ?? '').split(separator).map(item => item.trim().toLocaleLowerCase('en')).filter(Boolean);
  return [...new Set(items.map(item => SINGULAR[item] ?? item))];
}

const binomialOf = value => value.replace('×', '').match(/^([A-Z][a-z-]+)\s+([a-z-]+)/)?.slice(1, 3).join(' ') ?? null;

// Entries a local-name column carries that are not names in the language the
// column is labelled with. They stay in vernacular_as_published; they do not
// become mappings.
const NOT_VERNACULAR = {
  bamboo: 'English common name',
  eucalyptus: 'botanical genus used as the name',
  mango: 'English common name',
  ugu: 'Igbo name printed in a column labelled Yoruba'
};

function splitNames(published, language) {
  const names = [];
  const excluded = [];
  for (const part of published.split(/\s*[,/]\s*|\s+or\s+/)) {
    const localName = part.replace(/^[\s'"“”]+|[\s'"“”]+$/g, '').replace(/\s+/g, ' ');
    if (!localName) continue;
    const reason = NOT_VERNACULAR[localName.toLocaleLowerCase('en')];
    if (reason) excluded.push({ text: localName, reason });
    else names.push({ local_name: localName, language });
  }
  return { names, excluded };
}

// A cell whose names each carry a language label after them: "Kwari (H), Sapo (Y)",
// "Cida goro (H) Orogbo (Y)", or superscripts the caller has turned into markers.
// Each label closes the names printed since the previous one. A label the source does
// not define stops the import; text left after the last label carries no language and
// is kept as published rather than mapped.
function splitLabelledNames(published, labelPattern, codes) {
  const names = [];
  const excluded = [];
  let start = 0;
  for (const match of published.matchAll(labelPattern)) {
    const language = codes[match[1]];
    if (!language) throw new Error(`Undefined language label "${match[1]}" in "${published}"`);
    const chunk = published.slice(start, match.index).replace(/^[\s,;]+|[\s,;]+$/g, '');
    start = match.index + match[0].length;
    if (!chunk) continue;
    const split = splitNames(chunk, language);
    names.push(...split.names);
    excluded.push(...split.excluded);
  }
  const rest = published.slice(start).replace(/^[\s,;]+|[\s,;]+$/g, '');
  if (rest) excluded.push({ text: rest, reason: 'printed without a language label' });
  return { names, excluded };
}

function unique(names) {
  return [...new Map(names.map(name => [`${name.language}:${name.local_name.toLocaleLowerCase('en')}`, name])).values()];
}

// Lawal et al. 2020, Ede South (Osun). Table 2, whose column is headed "Local
// Name (Yoruba)", publishes the name mappings; parts and preparations are in
// Appendix Table A1. The two tables list the same 87 species but not in quite
// the same order, and A1 misspells one (Ficus exasperate), so rows are joined
// on genus plus the start of the epithet and the join is required to be
// one-to-one. Table 2 is unnumbered: source_row is its ordinal position.
function extractEdeSouth(xml) {
  const names = expectRows(tableRows(xml, 'Table 2').filter(row => row.length >= 5 && binomialOf(row[0])), 87, 'Table 2 rows');
  const inventory = expectRows(tableRows(xml, 'Table A1').filter(row => /^\d+$/.test(row[0])), 87, 'Table A1 rows');
  const speciesKey = value => {
    const [genus, epithet] = binomialOf(value).split(' ');
    return `${genus} ${epithet.slice(0, 6)}`;
  };
  const inventoryBySpecies = new Map(inventory.map(row => [speciesKey(row[1]), row]));
  if (inventoryBySpecies.size !== 87) throw new Error('Table A1 species are not distinct');

  return names.map(([identity, vernacular], index) => {
    const row = inventoryBySpecies.get(speciesKey(identity));
    if (!row) throw new Error(`Table 2 species missing from Table A1: ${identity}`);
    inventoryBySpecies.delete(speciesKey(identity));
    const family = identity.match(/\s*,?\s*([A-Z][a-z]+aceae),\s*(FHI\s*\d+)\s*$/);
    if (!family) throw new Error(`No family and voucher in Table 2 row ${index + 1}: ${identity}`);
    const { names: vernacularNames, excluded } = splitNames(vernacular, 'yo');
    return {
      source_id: 'lawal-2020-ede-south',
      source_row: index + 1,
      inventory_table_row: Number(row[0]),
      botanical_as_published: identity.slice(0, family.index).trim(),
      family_as_published: family[1],
      common_english_as_published: null,
      vernacular_as_published: vernacular,
      vernacular_names: unique(vernacularNames),
      ...(excluded.length ? { vernacular_entries_excluded: excluded } : {}),
      parts_reported: splitList(row[2], /[,/]/),
      preparations_reported: splitList(row[4], /[,/]/),
      voucher_specimen: family[2],
      life_form_as_published: row[3],
      use_context: 'plant reported for cough associated with respiratory conditions in Ede South, Osun State'
    };
  });
}

// Odebunmi et al. 2022, Ogbomosho (Oyo). Three tables — COVID-19, cough, flu —
// repeat species, sometimes under a different spelling or a different local
// name, so every table row is kept as its own source row. Local names were
// collected in Yoruba (Sections 2.2 and 2.3 of the article). Staged: several
// determinations disagree with every other source for the same Yoruba name, and
// the build only sees a disagreement when the spelling is identical.
function extractOgbomosho(xml) {
  const tables = [
    ['Table 2', 26, 'COVID-19'],
    ['Table 3', 31, 'cough'],
    ['Table 4', 29, 'flu']
  ];
  let sourceRow = 0;
  return tables.flatMap(([label, expected, condition]) =>
    expectRows(tableRows(xml, label).filter(row => /^\d+$/.test(row[0]) && row.length >= 14), expected, `${label} rows`).map(row => {
      const voucher = row[1].match(/IFE\s*\d+$/)?.[0] ?? null;
      const { names, excluded } = splitNames(row[3], 'yo');
      sourceRow += 1;
      return {
        source_id: 'odebunmi-2022-ogbomosho',
        source_row: sourceRow,
        source_table: label,
        source_table_row: Number(row[0]),
        botanical_as_published: row[1].replace(/\s*IFE\s*\d+$/, '').trim(),
        family_as_published: row[4],
        common_english_as_published: row[2],
        vernacular_as_published: row[3],
        vernacular_names: unique(names),
        ...(excluded.length ? { vernacular_entries_excluded: excluded } : {}),
        parts_reported: splitList(row[8]),
        preparations_reported: splitList(row[5]),
        voucher_specimen: voucher,
        life_form_as_published: row[6],
        use_context: `plant reported for ${condition} in Ogbomosho North and South, Oyo State`,
        data_quality_flags: [],
        runtime_export_eligible: false
      };
    })
  );
}

// Evbuomwan et al. 2023, Kwara. Six of the 62 rows label their names Yoruba
// or Nupe; the other 56 carry no language, in a state where interviews were run
// in both and Hausa names (Karandafi) appear unmarked. Unlabelled names keep a
// null language: the pages say "language not recorded" rather than guess one
// (owner's decision, 2026-11-18). "June 12" is a nickname, not a vernacular
// name; it stays in vernacular_as_published and does not become a mapping.
function extractKwara(xml) {
  const languages = { yoruba: 'yo', nupe: 'nup' };
  return expectRows(tableRows(xml, 'Table 1').filter(row => /^\d+\.?$/.test(row[0]) && row.length >= 10), 62, 'Table 1 rows').map(row => {
    const published = row[1];
    const labelled = [...published.matchAll(/([^,()]+?)\s*\((Yoruba|Nupe)\)/g)];
    const nickname = /^June 12$/.test(published);
    const names = nickname
      ? []
      : labelled.length
        ? labelled.flatMap(match => splitNames(match[1], languages[match[2].toLocaleLowerCase('en')]).names)
        : splitNames(published, null).names;
    const flags = [];
    if (!labelled.length) flags.push('language_not_stated_for_row');
    if (nickname) flags.push('nickname_rather_than_vernacular_name');
    return {
      source_id: 'evbuomwan-2023-kwara',
      source_row: Number.parseInt(row[0], 10),
      botanical_as_published: row[3].replace(/\s*\(\s*(?:FHI|NIPRD|UBH)[^)]*\)\s*$/, '').trim(),
      family_as_published: row[4],
      common_english_as_published: row[2],
      vernacular_as_published: published,
      vernacular_names: unique(names),
      ...(nickname ? { vernacular_entries_excluded: [{ text: published, reason: 'nickname rather than a vernacular name' }] } : {}),
      parts_reported: splitList(row[6]),
      voucher_specimen: row[3].match(/\(\s*((?:FHI|NIPRD|UBH)[^)]*)\)\s*$/)?.[1].trim() ?? null,
      life_form_as_published: row[5],
      use_context: 'plant reported for malaria in Kwara State',
      data_quality_flags: flags
    };
  });
}

// Anyanwu et al. 2025, North Central zone (Journal of Obesity, CC BY 4.0). Table 2
// labels each local name with its language in brackets, defined in the table's
// footnote: H Hausa, Y Yoruba, I Ibo, T Tiv; one cell also uses "(Efik)". Three cells
// carry no label and are English or botanical text (Sponge soap, Curry), and one
// labelled entry is the botanical name (Aloe vera); none of these becomes a mapping.
// Local names a few rows print in the Common name column (Ukpo; Ora, Oha) are not
// labelled there and are not harvested.
const ANYANWU_LANGUAGES = { H: 'ha', Y: 'yo', I: 'ig', T: 'tiv', Efik: 'efi' };
const ANYANWU_PARTS = {
  B: 'bulb', Br: 'branch', C: 'clove', F: 'fruit', Fw: 'flower', L: 'leaf', P: 'pod',
  R: 'root', S: 'seed', Sb: 'stem bark', St: 'stem', W: 'whole plant'
};
const ANYANWU_PREPARATIONS = { D: 'decoction', J: 'juice', M: 'maceration', P: 'powder' };
const ANYANWU_NOT_VERNACULAR = { 'aloe vera': 'botanical name printed as the Hausa name' };

function expandCodes(value, codes, what, row) {
  return [...new Set((value ?? '').split(/\s*,\s*/).filter(Boolean).map(code => {
    if (!codes[code]) throw new Error(`Undefined ${what} code "${code}" in row ${row}`);
    return codes[code];
  }))];
}

function extractAnyanwu(xml) {
  const rows = expectRows(tableRows(xml, 'Table 2').filter(row => /^\d+$/.test(row[0])), 70, 'Table 2 rows');
  return rows.map(row => {
    const sourceRow = Number(row[0]);
    const published = row[2];
    const split = published
      ? splitLabelledNames(published, /\s*[([]([A-Za-z]+)[)\]]/g, ANYANWU_LANGUAGES)
      : { names: [], excluded: [] };
    const names = [];
    const excluded = [...split.excluded];
    for (const name of split.names) {
      const reason = ANYANWU_NOT_VERNACULAR[name.local_name.toLocaleLowerCase('en')];
      if (reason) excluded.push({ text: name.local_name, reason });
      else names.push(name);
    }
    return {
      source_id: 'anyanwu-2025-north-central',
      source_row: sourceRow,
      botanical_as_published: row[1],
      family_as_published: row[4],
      common_english_as_published: row[3] || null,
      vernacular_as_published: published || null,
      vernacular_names: unique(names),
      ...(excluded.length ? { vernacular_entries_excluded: excluded } : {}),
      parts_reported: expandCodes(row[8], ANYANWU_PARTS, 'part', sourceRow),
      preparations_reported: expandCodes(row[9], ANYANWU_PREPARATIONS, 'preparation', sourceRow),
      voucher_specimen: row[5] || null,
      life_form_as_published: row[6],
      use_context: 'plant reported for obesity management by herb sellers and practitioners in the North Central zone',
      data_quality_flags: published ? [] : ['no_local_name_published']
    };
  });
}

// Alhaji and Babalobi 2015, Niger State (Journal of Veterinary Medicine, CC BY).
// Table 2 lists plants Fulani pastoralists use on cattle. Each local name is
// followed by a superscript H, F or N — Hausa, Fulani (Fulfulde) and Nupe, per the
// table footnote — so the superscripts are read from the XML before the text is
// flattened. Table 1 has no local names; Table 3 lists non-plant materials.
// Parts and preparations are given only as prose, so no parts are claimed.
const ALHAJI_LANGUAGES = { H: 'ha', F: 'ff', N: 'nup' };

function extractAlhaji(xml) {
  for (const [wrap] of xml.matchAll(/<table-wrap[\s>][\s\S]*?<\/table-wrap>/gi)) {
    const found = wrap.match(/<label>([\s\S]*?)<\/label>/i);
    if (!found || decodeXml(found[1]) !== 'Table 2') continue;
    const cells = [...wrap.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, tr]) =>
      [...tr.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(([, cell]) => cell)
    );
    const rows = expectRows(cells.filter(row => /^\s*\d+\s*$/.test(decodeXml(row[0]))), 34, 'Table 2 rows');
    return rows.map(row => {
      // Inline italics would otherwise split "Edingi-bata" around its hyphen.
      const nameCell = decodeXml(
        row[3]
          .replace(/<sup>([\s\S]*?)<\/sup>/gi, (_, label) => ` [[${decodeXml(label)}]] `)
          .replace(/<\/?italic>/gi, '')
      );
      const identity = decodeXml(row[1].replace(/<\/?italic>/gi, ''));
      // Row 14 (Khaya senegalensis) repeats the botanical name in the local-name column.
      const split = nameCell === identity
        ? { names: [], excluded: [{ text: nameCell, reason: 'botanical name repeated in the local-name column' }] }
        : splitLabelledNames(nameCell, /\s*\[\[([A-Za-z]+)\]\]/g, ALHAJI_LANGUAGES);
      const family = identity.match(/\s*\(([A-Z][a-z]+aceae)\)\s*$/);
      if (!family) throw new Error(`No family in Table 2 row ${decodeXml(row[0])}: ${identity}`);
      return {
        source_id: 'alhaji-2015-niger-fulani',
        source_row: Number(decodeXml(row[0])),
        botanical_as_published: identity.slice(0, family.index).trim(),
        family_as_published: family[1],
        common_english_as_published: decodeXml(row[2]) || null,
        vernacular_as_published: nameCell.replace(/\s*\[\[([A-Za-z]+)\]\]/g, ' ($1)').replace(/\s+/g, ' ').trim(),
        vernacular_names: unique(split.names),
        ...(split.excluded.length ? { vernacular_entries_excluded: split.excluded } : {}),
        parts_reported: [],
        preparation_as_published: decodeXml(row[4]),
        voucher_specimen: null,
        use_context: 'plant reported in ethnoveterinary use on cattle by Fulani pastoralists in Niger State',
        data_quality_flags: []
      };
    });
  }
  throw new Error('Could not find Table 2');
}

const SOURCES = {
  'lawal-2020-ede-south': { pmcid: 'PMC7286022', extract: extractEdeSouth, output: ['lawal-2020-ede-south.json'] },
  'odebunmi-2022-ogbomosho': { pmcid: 'PMC9573491', extract: extractOgbomosho, output: ['staged', 'odebunmi-2022-ogbomosho.json'] },
  'evbuomwan-2023-kwara': { pmcid: 'PMC10504731', extract: extractKwara, output: ['evbuomwan-2023-kwara.json'] },
  'anyanwu-2025-north-central': { pmcid: 'PMC11870763', extract: extractAnyanwu, output: ['anyanwu-2025-north-central.json'] },
  'alhaji-2015-niger-fulani': { pmcid: 'PMC4590846', extract: extractAlhaji, output: ['alhaji-2015-niger-fulani.json'] }
};

function main() {
  const [sourceId, inputPath] = process.argv.slice(2);
  const source = SOURCES[sourceId];
  if (!source || !inputPath) {
    throw new Error(`Usage: node scripts/import-jats-surveys.js <${Object.keys(SOURCES).join('|')}> <fullTextXML>`);
  }
  const rows = source.extract(fs.readFileSync(inputPath, 'utf8'));
  const outputPath = path.join(surveysDirectory, ...source.output);
  fs.writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`Imported ${rows.length} source rows from ${source.pmcid} to ${outputPath}`);
}

if (require.main === module) main();

module.exports = { SOURCES, extractEdeSouth, extractOgbomosho, extractKwara, extractAnyanwu, extractAlhaji, splitNames, splitLabelledNames };

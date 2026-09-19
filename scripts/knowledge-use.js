#!/usr/bin/env node
// The knowledge-use ledger (013).
//
//   node scripts/knowledge-use.js terms                    # the current terms and who has accepted
//   node scripts/knowledge-use.js record --file use.json   # record a use, or refuse
//   node scripts/knowledge-use.js list
//   node scripts/knowledge-use.js statement <practitioner_id>
//
// Recording a use takes a file rather than flags because the fields are things
// somebody has to have actually agreed — counterparty, purpose, scope, and what
// the practitioners get in return. A command line encourages typing something
// plausible into each; a file you have to write encourages checking.
//
// The refusal is the feature. A practitioner who has not accepted the terms, or
// accepted an older version of them, cannot be included — and the error names
// every one of them rather than the first.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const governance = require('../src/services/governance');
const db = require('../src/services/supabase');

function flag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

async function terms() {
  const current = governance.currentTerms();
  const stats = await db.contributorTermsStats(current.hash);

  console.log(`\nContributor terms ${current.version}  ·  hash ${current.hash}`);
  if (!current.in_force) {
    console.log('\n  ! These terms are marked NOT IN FORCE. They have had no legal review and no');
    console.log('    practitioner consultation. Do not present them to a practitioner as binding.');
  }
  console.log(`\n  ${stats.accepted} of ${stats.total} practitioners have accepted some version.`);
  console.log(`  ${stats.current} have accepted the current text.`);
  if (stats.stale) console.log(`  ${stats.stale} accepted an older version and must be asked again.`);
  console.log(`\n  ${stats.current} practitioner(s) can currently be included in a knowledge use.\n`);
}

async function record(args) {
  const file = flag(args, 'file');
  if (!file) {
    console.log(`
Write a JSON file describing the use, then pass it with --file.

{
  "use_type": "research_access",
  "counterparty": "University of Ibadan, Dept. of Pharmacognosy",
  "purpose": "Comparative study of antimalarial preparations in southwest Nigeria",
  "scope": { "formulation_short_codes": ["FM-00012"], "fields": ["plants", "preparation"] },
  "benefit_terms": "Named co-authorship; £400 per contributing practitioner; copy of findings in Yoruba",
  "agreed_at": "2026-09-01T00:00:00Z",
  "recorded_by": "OP-4C21",
  "contributors": [{ "practitioner_id": "…", "record_count": 1 }]
}

Every field is required. scope records what was covered — short codes and counts,
never the content itself.
`);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const use = await governance.recordKnowledgeUse(payload);

  console.log(`\nRecorded ${use.use_type} to ${use.counterparty}`);
  console.log(`  ${use.contributors.length} contributing practitioner(s)`);
  console.log(`  benefit: ${use.benefit_terms}`);
  console.log(`  ledger id: ${use.id}\n`);
}

async function list() {
  const uses = await db.listKnowledgeUses({ limit: 50 });
  if (!uses.length) {
    console.log('\nNothing in the ledger. No contributed knowledge has been used outside a Vault.\n');
    return;
  }
  console.log(`\n${uses.length} recorded use(s):\n`);
  for (const use of uses) {
    console.log(`  ${use.created_at.slice(0, 10)}  ${use.use_type.padEnd(16)} ${use.counterparty}`);
    console.log(`      ${use.purpose}`);
    console.log(`      ${use.knowledge_use_contributors?.length ?? 0} contributor(s) · ${use.benefit_terms}`);
  }
  console.log('');
}

async function statement(practitionerId) {
  if (!practitionerId) throw new Error('Pass a practitioner id.');
  const report = await governance.contributorStatement(practitionerId);
  if (!report.uses.length) {
    console.log('\nNothing of this practitioner\'s knowledge has been used outside their Vault.\n');
    return;
  }
  console.log(`\n${report.uses.length} use(s) of this practitioner's knowledge:\n`);
  for (const use of report.uses) {
    console.log(`  ${use.use_type} → ${use.counterparty}`);
    console.log(`    purpose:  ${use.purpose}`);
    console.log(`    records:  ${use.records_included}`);
    console.log(`    agreed:   ${use.benefit_terms}`);
    console.log(`    basis:    terms ${use.terms_version}\n`);
  }
}

async function main() {
  const [command = 'terms', ...args] = process.argv.slice(2);
  if (command === 'terms') return terms();
  if (command === 'record') return record(args);
  if (command === 'list') return list();
  if (command === 'statement') return statement(args[0]);
  throw new Error(`Unknown command "${command}". Use: terms | record | list | statement`);
}

main().catch(err => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});

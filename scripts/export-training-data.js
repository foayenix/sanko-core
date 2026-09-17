#!/usr/bin/env node
// Export corrections as a fine-tuning dataset.
//
//   node scripts/export-training-data.js                 # unexported only
//   node scripts/export-training-data.js --all           # everything, for a rebuild
//   node scripts/export-training-data.js --out ./data/ft # target directory
//
// Writes MLX-LoRA's expected layout — train.jsonl / valid.jsonl / test.jsonl,
// one {"messages": [...]} object per line — split 80/10/10.
//
// The split is deterministic and grouped by practitioner: every correction from
// one practitioner lands in exactly one split. Splitting randomly would leak
// their phrasing across train and test, and the eval would flatter the model.
//
// Nothing is marked exported until the files are written, so a crash mid-run is
// safe to re-run.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../src/services/supabase');

const SYSTEM = `You convert an African traditional medicine practitioner's own words into a structured herbal formulation. Record only what was said. Never invent a plant, quantity, dosage, or botanical name — leave a field null instead of guessing.`;

// A correction is only trainable if we still have the practitioner's original
// words. Without the input there is nothing to learn the mapping from.
function toExample(correction) {
  const formulation = correction.formulations;
  const transcript = formulation?.original_text;
  if (!transcript) return null;

  const user = [
    `Language: ${formulation.original_language ?? 'unknown'}`,
    `Practitioner said: ${transcript}`,
    ``,
    `Extract the "${correction.field}" field as JSON.`,
  ].join('\n');

  return {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
      { role: 'assistant', content: JSON.stringify(correction.after_value) },
    ],
    // Kept out of the messages array but useful when auditing the dataset.
    _meta: {
      correction_id: correction.id,
      field: correction.field,
      rejected: correction.before_value,
      short_code: formulation.short_code,
      model: correction.model,
    },
  };
}

// Stable practitioner→split assignment: hash the id, bucket 0–99.
function splitFor(practitionerId) {
  const n = parseInt(crypto.createHash('sha256').update(String(practitionerId)).digest('hex').slice(0, 8), 16) % 100;
  if (n < 80) return 'train';
  if (n < 90) return 'valid';
  return 'test';
}

async function main() {
  const args = process.argv.slice(2);
  const onlyUnexported = !args.includes('--all');
  const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(__dirname, '../training/data');

  const corrections = await db.listCorrectionsForExport({ onlyUnexported });
  console.log(`Corrections fetched: ${corrections.length}${onlyUnexported ? ' (unexported only)' : ' (all)'}`);

  const splits = { train: [], valid: [], test: [] };
  const exportedIds = [];
  let skipped = 0;

  for (const correction of corrections) {
    const example = toExample(correction);
    if (!example) { skipped++; continue; }
    splits[splitFor(correction.practitioner_id ?? correction.id)].push(example);
    exportedIds.push(correction.id);
  }

  if (skipped) console.log(`Skipped ${skipped} correction(s) with no source transcript.`);

  if (!exportedIds.length) {
    console.log('\nNothing to export yet. Corrections accumulate as practitioners fix what the model wrote down —');
    console.log('run the bot for a while, then come back. A few hundred is where fine-tuning starts to pay.\n');
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, examples] of Object.entries(splits)) {
    const file = path.join(outDir, `${name}.jsonl`);
    // MLX reads only `messages`; _meta stays out of the training file.
    const lines = examples.map(e => JSON.stringify({ messages: e.messages })).join('\n');
    fs.writeFileSync(file, lines + (lines ? '\n' : ''));
    console.log(`  ${name.padEnd(6)} ${String(examples.length).padStart(5)} examples → ${path.relative(process.cwd(), file)}`);
  }

  // Audit sidecar: which correction produced which example, and what the model
  // originally got wrong. Not used for training; used when a fine-tune misbehaves.
  const auditFile = path.join(outDir, 'audit.jsonl');
  fs.writeFileSync(auditFile, Object.values(splits).flat().map(e => JSON.stringify(e._meta)).join('\n') + '\n');

  await db.markCorrectionsExported(exportedIds);
  console.log(`\nMarked ${exportedIds.length} correction(s) as exported.`);
  console.log(`Next: see training/README.md for the LoRA run.\n`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

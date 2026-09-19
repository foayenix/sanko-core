#!/usr/bin/env node
// Export corrections as a fine-tuning dataset.
//
//   node scripts/export-training-data.js --dry-run       # who may be included, nothing written
//   node scripts/export-training-data.js [ledger flags]  # unexported only
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
// Training on a practitioner's corrections is a use of their knowledge beyond
// their own Vault, so it runs through the same consent gate as any other —
// see scripts/export-consent.js. Records whose practitioner has not accepted the
// contributor terms are excluded and named, and what is exported is written into
// the knowledge-use ledger.
//
// Nothing is marked exported until the files are written, so a crash mid-run is
// safe to re-run.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../src/services/supabase');
const consent = require('./export-consent');

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
      // Which practitioner an example came from is what makes the split
      // checkable: without it nobody downstream can verify that train and test
      // hold disjoint people, or re-partition the set on a different boundary.
      // It is an opaque uuid, not a name or a number.
      practitioner_id: correction.practitioner_id ?? null,
      split: splitFor(correction.practitioner_id),
      field: correction.field,
      rejected: correction.before_value,
      short_code: formulation.short_code,
      model: correction.model,
    },
  };
}

// Stable practitioner→split assignment: hash the id, bucket 0–99.
//
// Throws rather than falling back on a missing id. The fallback this replaces
// bucketed by correction id, which silently turned a per-practitioner split into
// a per-row one — the exact leak the grouping exists to prevent, and invisible
// in the output.
function splitFor(practitionerId) {
  if (!practitionerId) {
    throw new Error('Cannot split a correction with no practitioner_id: the train/test split is grouped by practitioner.');
  }
  const n = parseInt(crypto.createHash('sha256').update(String(practitionerId)).digest('hex').slice(0, 8), 16) % 100;
  if (n < 80) return 'train';
  if (n < 90) return 'valid';
  return 'test';
}

async function main() {
  const args = process.argv.slice(2);
  const onlyUnexported = !args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(__dirname, '../training/data');

  const corrections = await db.listCorrectionsForExport({ onlyUnexported });
  console.log(`Corrections fetched: ${corrections.length}${onlyUnexported ? ' (unexported only)' : ' (all)'}`);

  if (!corrections.length) {
    console.log('\nNothing to export yet. Corrections accumulate as practitioners fix what the model wrote down —');
    console.log('run the bot for a while, then come back. A few hundred is where fine-tuning starts to pay.\n');
    return;
  }

  // The consent gate, before anything is read into a training example. A record
  // that may not be used should not be transformed, counted or written.
  const screened = await consent.screen(corrections);
  for (const line of screened.report) console.log(line);

  if (!screened.eligible.length) {
    console.log(consent.refusalText(corrections.length));
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(`\n${screened.eligible.length} correction(s) from ${screened.contributors.length} practitioner(s) may be exported.`);
    console.log('Dry run — nothing written, nothing marked exported, nothing recorded in the ledger.\n');
    return;
  }

  // Only asked for once there is something to export, so a run blocked on
  // consent reports that rather than a missing flag.
  const useDetails = consent.requireUseDetails(args, { command: 'export-training-data.js' });

  const splits = { train: [], valid: [], test: [] };
  const exportedIds = [];
  let skipped = 0;

  for (const correction of screened.eligible) {
    const example = toExample(correction);
    if (!example) { skipped++; continue; }
    splits[splitFor(correction.practitioner_id)].push(example);
    exportedIds.push(correction.id);
  }

  if (skipped) console.log(`Skipped ${skipped} correction(s) with no source transcript.`);

  if (!exportedIds.length) {
    console.log('\nEvery eligible correction was missing its source transcript — nothing to learn a mapping from.\n');
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

  // Ledger entry after the files exist: a recorded use that did not happen is
  // as wrong as an unrecorded one that did. Contributors are narrowed to the
  // practitioners actually represented in the written files, so the record says
  // what was used rather than what was screened.
  const included = new Set(Object.values(splits).flat().map(e => e._meta.practitioner_id));
  const use = await consent.recordExport({
    contributors: screened.contributors.filter(row => included.has(row.practitioner_id)),
    details: useDetails,
    scope: {
      dataset: 'text_extraction_lora',
      correction_count: exportedIds.length,
      splits: Object.fromEntries(Object.entries(splits).map(([name, rows]) => [name, rows.length])),
      fields: [...new Set(Object.values(splits).flat().map(e => e._meta.field))],
    },
  });

  await db.markCorrectionsExported(exportedIds);
  console.log(`\nMarked ${exportedIds.length} correction(s) as exported.`);
  console.log(`Recorded as knowledge use ${use.id} — ${use.contributors.length} contributing practitioner(s).`);
  console.log(`Next: see training/README.md for the LoRA run.\n`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { toExample, splitFor, SYSTEM };

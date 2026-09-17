#!/usr/bin/env node
// Export corrected page readings as a vision fine-tuning dataset.
//
//   node scripts/export-vision-data.js                    # unexported only
//   node scripts/export-vision-data.js --all              # everything, for a rebuild
//   node scripts/export-vision-data.js --out ./data/vis   # target directory
//
// Sibling of export-training-data.js, and deliberately separate from it. That
// script teaches a text model to structure a transcript; this one teaches a
// vision model to read Nigerian traditional-medicine handwriting. Pooling them
// would train each model on the other's failures.
//
// Every example is a page a human actually read: the image as the input, their
// corrected reading as the target, and the machine's rejected reading kept only
// in the audit sidecar. There is no other source of truth for this handwriting —
// no public corpus contains it, which is exactly why the review pass in /admin
// is worth someone's afternoon.
//
// The images are written out as files rather than referenced by signed URL: a
// URL expires within the hour and a dataset that depends on one is not
// reproducible. That does mean the output directory holds practitioner material,
// so it lands under training/ with the rest of it and stays off this machine
// only if you take it off deliberately.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../src/services/supabase');
const vision = require('../src/services/vision');

// The instruction the model is trained against is the one it is served, so it
// comes from the service rather than being restated here. A prompt that drifted
// between training and inference would teach one task and be asked another.
const PROMPT = vision.PROMPT;

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function extensionFor(storagePath) {
  const ext = path.extname(storagePath || '').replace('.', '').toLowerCase();
  if (ext) return ext;
  return EXTENSIONS[Object.keys(EXTENSIONS).find(k => (storagePath || '').includes(k))] ?? 'jpg';
}

// Stable practitioner→split assignment, identical to the text export: every
// correction from one practitioner lands in exactly one split. One person's
// handwriting appearing in both train and test would flatter the model in the
// only measure that matters here.
function splitFor(practitionerId) {
  const n = parseInt(crypto.createHash('sha256').update(String(practitionerId)).digest('hex').slice(0, 8), 16) % 100;
  if (n < 80) return 'train';
  if (n < 90) return 'valid';
  return 'test';
}

async function main() {
  const args = process.argv.slice(2);
  const onlyUnexported = !args.includes('--all');
  const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(__dirname, '../training/vision');

  const corrections = await db.listPageCorrectionsForExport({ onlyUnexported });
  console.log(`Corrected page readings: ${corrections.length}${onlyUnexported ? ' (unexported only)' : ' (all)'}`);

  if (!corrections.length) {
    console.log('\nNothing to export yet. These accumulate in /admin → Readings, one photographed page at a time.');
    console.log('Until a human has corrected a page, there is no ground truth for this handwriting anywhere.\n');
    return;
  }

  const imageDir = path.join(outDir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });

  const splits = { train: [], valid: [], test: [] };
  const exportedIds = [];
  const audit = [];
  let skipped = 0;

  for (const correction of corrections) {
    const storagePath = correction.media?.storage_path;
    const target = typeof correction.after_value === 'string' ? correction.after_value.trim() : '';
    // A correction with no page left to look at, or with nothing in it, is not a
    // training example. Both are recoverable states, so say how many rather than
    // failing the run.
    if (!storagePath || !target) { skipped++; continue; }

    let bytes;
    try {
      bytes = await db.downloadMedia(storagePath);
    } catch (err) {
      console.warn(`  skipped ${correction.id}: ${err.message}`);
      skipped++;
      continue;
    }

    const file = `${correction.id}.${extensionFor(storagePath)}`;
    fs.writeFileSync(path.join(imageDir, file), bytes);

    splits[splitFor(correction.practitioner_id ?? correction.id)].push({
      messages: [
        { role: 'user', content: `<image>\n${PROMPT}` },
        { role: 'assistant', content: target },
      ],
      images: [path.join('images', file)],
    });
    exportedIds.push(correction.id);
    audit.push({
      correction_id: correction.id,
      media_id: correction.media_id,
      image: path.join('images', file),
      // What the model produced and a human rejected. Never a training target —
      // kept so that a fine-tune which starts making a new class of mistake can
      // be checked against the class it was supposed to fix.
      rejected: correction.before_value,
      read_by: correction.media?.transcript_model ?? correction.model,
      provider: correction.media?.transcript_provider ?? correction.provider,
      note: correction.note,
      corrected_at: correction.created_at,
    });
  }

  if (skipped) console.log(`Skipped ${skipped} correction(s) with no retrievable page or no corrected text.`);
  if (!exportedIds.length) return;

  for (const [name, examples] of Object.entries(splits)) {
    const file = path.join(outDir, `${name}.jsonl`);
    const lines = examples.map(e => JSON.stringify(e)).join('\n');
    fs.writeFileSync(file, lines + (lines ? '\n' : ''));
    console.log(`  ${name.padEnd(6)} ${String(examples.length).padStart(5)} pages → ${path.relative(process.cwd(), file)}`);
  }

  fs.writeFileSync(path.join(outDir, 'audit.jsonl'), audit.map(row => JSON.stringify(row)).join('\n') + '\n');

  await db.markCorrectionsExported(exportedIds);
  console.log(`\nMarked ${exportedIds.length} correction(s) as exported.`);
  console.log(`Images and JSONL are in ${path.relative(process.cwd(), outDir)} — practitioner material, treat it as such.\n`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

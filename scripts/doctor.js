#!/usr/bin/env node
// Preflight check for the local stack.
//
//   npm run doctor
//
// Checks every dependency Sanko needs at runtime and tells you the exact fix for
// whatever is missing. Nothing here writes or installs anything.
//
// The subtle one this catches: Sanko spawns `whisper` as a subprocess, so a venv
// install that works in your interactive shell still fails at runtime unless the
// binary is on PATH or WHISPER_CLI_PATH points at it.

require('dotenv').config();
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { env, envNumber } = require('../src/utils/env');

const results = [];
const record = (level, name, detail, fix) => results.push({ level, name, detail, fix });
const pass = (name, detail) => record('pass', name, detail);
const warn = (name, detail, fix) => record('warn', name, detail, fix);
const fail = (name, detail, fix) => record('fail', name, detail, fix);

// Resolve exactly the way child_process.spawn will — by walking process.env.PATH.
//
// Shelling out to `sh -lc 'command -v …'` is the tempting version and it lies:
// a login shell sources profile files that Node does not, so the doctor can
// report a binary as present that the app then fails to spawn. This checks the
// PATH the app actually has.
function which(bin) {
  if (bin.includes('/')) return fs.existsSync(bin) ? bin : null;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function getJson(url, timeoutMs = 2500) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

// ─── checks ───────────────────────────────────────────────────────────────────

function checkRuntime() {
  const major = Number(process.versions.node.split('.')[0]);
  major >= 20
    ? pass('node', `v${process.versions.node}`)
    : fail('node', `v${process.versions.node}`, 'Sanko needs Node 20+. Install a newer Node.');

  fs.existsSync(path.join(__dirname, '../node_modules'))
    ? pass('dependencies', 'node_modules present')
    : fail('dependencies', 'node_modules missing', 'npm install');
}

// Ollama resolves a bare name to its :latest tag, so `VISION_MODEL=glm-ocr`
// works at the API while `ollama list` reports `glm-ocr:latest`. Comparing the
// strings directly reported a pulled model as missing — a preflight that fails on
// a working configuration is worse than no preflight, because the next real
// failure gets ignored.
function _hasModel(names, wanted) {
  const tagged = wanted.includes(':') ? wanted : `${wanted}:latest`;
  return names.includes(wanted) || names.includes(tagged);
}

async function checkOllama() {
  if (env('LLM_PROVIDER', 'ollama').toLowerCase() !== 'ollama') {
    warn('ollama', `skipped — LLM_PROVIDER is '${process.env.LLM_PROVIDER}'`,
      'Set LLM_PROVIDER=ollama to keep practitioner data on this machine.');
    return;
  }

  const base = env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
  const wanted = env('OLLAMA_MODEL', 'qwen2.5:32b-instruct-q4_K_M');

  const tags = await getJson(`${base}/api/tags`);
  if (!tags) {
    fail('ollama server', `not reachable at ${base}`, 'ollama serve');
    return;
  }
  pass('ollama server', `reachable at ${base}`);

  const names = (tags.models ?? []).map(m => m.name);
  if (_hasModel(names, wanted)) {
    pass('ollama model', wanted);
  } else {
    fail('ollama model', `'${wanted}' not pulled`,
      `ollama pull ${wanted}\n      (pulled: ${names.join(', ') || 'none'})`);
  }

  // A model without tool support cannot drive the agent at all — it will chat
  // happily and never save anything, which looks like a prompt bug for hours.
  const toolCapable = (tags.models ?? [])
    .filter(m => (m.capabilities ?? []).includes('tools'))
    .map(m => m.name);
  if (toolCapable.length && !toolCapable.includes(wanted)) {
    warn('tool calling', `'${wanted}' is not advertised as tool-capable`,
      `Models here that are: ${toolCapable.join(', ') || 'none'}`);
  }

  const ctx = envNumber('OLLAMA_NUM_CTX', 16384);
  ctx >= 8192
    ? pass('context window', `OLLAMA_NUM_CTX=${ctx}`)
    : warn('context window', `OLLAMA_NUM_CTX=${ctx} is low`,
        'Below ~8192 the system prompt is silently truncated and the agent "forgets" its tools.');
}

// The vision model is a separate pull from the agent model, and its absence is
// the quietest failure in the stack: photos keep arriving, keep being archived,
// and nothing is ever read off them. Nobody notices until a page comes back
// through the review queue with an empty reading.
async function checkVision() {
  const backend = env('VISION_BACKEND', 'ollama').toLowerCase();
  if (['off', 'none', 'false'].includes(backend)) {
    warn('page reading', 'switched off', 'Photographed notebook pages will not be read. Set VISION_BACKEND=ollama to read them here.');
    return;
  }
  if (backend === 'anthropic') {
    env('ANTHROPIC_API_KEY')
      ? warn('page reading', 'hosted (anthropic)', 'Pages leave this machine. Use VISION_BACKEND=ollama unless this is an eval run.')
      : fail('page reading', 'VISION_BACKEND=anthropic but ANTHROPIC_API_KEY is not set', 'Set the key, or switch to VISION_BACKEND=ollama.');
    return;
  }

  const base = env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
  const wanted = env('VISION_MODEL', 'qwen2.5vl:7b');
  const tags = await getJson(`${base}/api/tags`);
  if (!tags) return;  // checkOllama has already reported the server.

  const models = tags.models ?? [];
  const found = models.find(m => _hasModel([m.name], wanted));
  if (!found) {
    fail('vision model', `'${wanted}' not pulled`,
      `ollama pull ${wanted}\n      Without it every photographed page is archived unread.`);
    return;
  }

  // A text-only model set here fails exactly like a missing one, except the
  // request succeeds: Ollama accepts the images array and answers from the
  // prompt alone, so the "reading" is invention.
  const capabilities = found.capabilities ?? [];
  capabilities.length && !capabilities.includes('vision')
    ? fail('vision model', `'${wanted}' is not advertised as vision-capable`,
        `It will answer without looking at the page. Vision models here: ${models.filter(m => (m.capabilities ?? []).includes('vision')).map(m => m.name).join(', ') || 'none'}`)
    : pass('vision model', wanted);
}

async function checkWhisper() {
  const backend = env('WHISPER_BACKEND', 'cli').toLowerCase();

  const ffmpeg = which(env('FFMPEG_PATH', 'ffmpeg'));
  ffmpeg
    ? pass('ffmpeg', ffmpeg)
    : fail('ffmpeg', 'not on PATH', 'brew install ffmpeg');

  if (backend === 'cli') {
    const bin = env('WHISPER_CLI_PATH', 'whisper');
    const found = path.isAbsolute(bin) ? (fs.existsSync(bin) ? bin : null) : which(bin);
    if (found) {
      pass('whisper (cli)', found);
    } else {
      fail('whisper (cli)', `'${bin}' not found`,
        'brew install uv && uv tool install openai-whisper\n' +
        '      (or point WHISPER_CLI_PATH at a venv binary — Sanko spawns it as a\n' +
        '       subprocess, so activating the venv in your shell is not enough)');
    }
    const model = env('WHISPER_CLI_MODEL', 'medium');
    if (model === 'large-v3' || model === 'large') {
      warn('whisper model', `'${model}' on openai/whisper`,
        'It barely uses Metal on Apple Silicon; expect minutes per voice note.\n' +
        '      Do not drop to a smaller checkpoint to fix that if you take Yoruba,\n' +
        '      Igbo or Hausa audio — install whisper.cpp and use WHISPER_BACKEND=http\n' +
        '      instead, which runs the same model with Metal.');
    } else if (['tiny', 'base', 'small', 'medium'].includes(model)) {
      warn('whisper model', `'${model}'`,
        'Fine for English. Yoruba, Igbo and Hausa were the thinnest slices of\n' +
        '      Whisper\'s training data and these checkpoints transcribe them badly —\n' +
        '      use large-v3 for a non-English deployment.');
    } else {
      pass('whisper model', model);
    }
  } else {
    const url = env('WHISPER_BASE_URL', 'http://127.0.0.1:8080/v1');
    warn('whisper (http)', url, 'Not probed — POST-only endpoint. Confirm your server is running.');
  }
}

async function checkDatabase() {
  fs.existsSync(path.join(__dirname, '../.env'))
    ? pass('.env', 'present')
    : fail('.env', 'missing', 'cp .env.example .env');

  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD']
    .filter(k => env(k) === undefined);

  if (missing.length) {
    fail('database config', `unset: ${missing.join(', ')}`,
      'Needed for /simulator and /admin. Tests and evals run fine without them.');
    return;
  }
  pass('database config', 'Supabase + admin password set');

  // Config being *present* says nothing about the database being *there*. A
  // paused or deleted project still leaves perfectly valid-looking vars, and the
  // failure surfaces as "Something went wrong on our end." to a practitioner on
  // WhatsApp — router.js touches the database before the agent ever runs.
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const local = /127\.0\.0\.1|localhost/.test(url);
  try {
    const res = await fetch(`${url}/rest/v1/practitioners?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      pass('database reachable', `${url} responded`);
    } else {
      const body = await res.text().catch(() => '');
      fail('database reachable', `${url} returned HTTP ${res.status}`,
        body.slice(0, 160) || 'The service role key may not match this project.');
    }
  } catch (err) {
    fail('database reachable', `cannot reach ${url} (${err.cause?.code ?? err.name})`,
      local
        ? 'Start the local stack:  supabase start\n      (and the Docker VM behind it:  colima start)'
        : 'The hosted project may be paused or deleted. Check supabase.com/dashboard.');
  }

  // Storage holds the primary sources — voice notes and photos are archived
  // before the agent sees a transcript, so a missing bucket fails every
  // voice-note turn rather than degrading quietly.
  try {
    const res = await fetch(`${url}/storage/v1/bucket/sanko-media`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    res.ok
      ? pass('media bucket', "'sanko-media' present")
      : fail('media bucket', `'sanko-media' missing (HTTP ${res.status})`,
          'Voice notes and photos fail without it. Create a PRIVATE bucket named sanko-media.');
  } catch {
    // The reachability check above already reported the cause.
  }
}

// Where the data actually lives. The sovereignty claim is the product's central
// argument, so it should be a line you can read rather than something inferred
// from a URL in a config file.
function checkSovereignty() {
  const LOOPBACK = ['127.0.0.1', 'localhost', '0.0.0.0', '::1'];
  const local = url => { try { return LOOPBACK.includes(new URL(url).hostname); } catch { return false; } };

  const provider = env('LLM_PROVIDER', 'ollama');
  const modelLocal = provider !== 'anthropic' && local(env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'));
  const dbLocal = local(env('SUPABASE_URL', ''));
  const whisperLocal = env('WHISPER_BACKEND', 'cli') !== 'openai';

  const offMachine = [!modelLocal && 'language model', !dbLocal && 'database', !whisperLocal && 'transcription'].filter(Boolean);

  if (!offMachine.length) {
    pass('sovereignty', 'Model, transcription and archive all on this machine.');
  } else {
    warn('sovereignty', `Off this machine: ${offMachine.join(', ')}.`,
      'Nagoya-aligned custody is the product\'s central claim; anything here leaves the country the practitioners are in.');
  }
}

function checkBackups() {
  const dir = env('BACKUP_DIR', path.join(__dirname, '..', 'backups'));
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return fail('backups', 'No backups have been taken.',
      'npm run backup — an archive stated to be unreconstructable currently has no copy.');
  }
  const newest = manifest.backups?.at(-1);
  if (!newest) return fail('backups', 'The manifest is empty.', 'npm run backup');

  const ageHours = Math.round((Date.now() - Date.parse(newest.created_at)) / 3_600_000);
  if (!manifest.backups.some(b => b.verified_at)) {
    warn('backups', `${manifest.backups.length} backup(s), newest ${ageHours}h old, none ever restored.`,
      'npm run backup:verify — a backup nobody has restored is a hypothesis.');
  } else if (ageHours > 48) {
    warn('backups', `Newest backup is ${Math.round(ageHours / 24)} days old.`, 'npm run backup');
  } else {
    pass('backups', `${manifest.backups.length} kept, newest ${ageHours}h old, restore verified.`);
  }

  if (!env('BACKUP_ENCRYPTION_KEY')) {
    fail('backup key', 'BACKUP_ENCRYPTION_KEY is not set.', 'Backups cannot be written or read without it.');
  }
}

// ─── report ───────────────────────────────────────────────────────────────────

(async () => {
  checkRuntime();
  await checkOllama();
  await checkWhisper();
  await checkVision();
  await checkDatabase();
  checkSovereignty();
  checkBackups();

  const icon = { pass: ' ok ', warn: 'warn', fail: 'FAIL' };
  console.log('\n  Sanko preflight\n');
  for (const r of results) {
    console.log(`  [${icon[r.level]}] ${r.name.padEnd(18)} ${r.detail}`);
    if (r.fix) console.log(`         → ${r.fix}`);
  }

  const failed = results.filter(r => r.level === 'fail');
  console.log();
  if (!failed.length) {
    console.log('  Everything the configured stack needs is present.\n');
  } else {
    console.log(`  ${failed.length} blocking issue${failed.length > 1 ? 's' : ''}. ` +
                `Tests (\`npm test\`) still run regardless — they need none of this.\n`);
    process.exit(1);
  }
})();

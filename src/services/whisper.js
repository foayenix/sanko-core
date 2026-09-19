const FormData = require('form-data');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Speech-to-text with three interchangeable backends, chosen by WHISPER_BACKEND.
//
//   cli   openai/whisper — the reference Python implementation, driven by its
//         command line. Simplest to install, and the ecosystem you fine-tune in.
//         Slower on Apple Silicon: it barely uses Metal, so large-v3 is painful.
//         `pip install -U openai-whisper`
//
//   http  Any OpenAI-compatible /v1/audio/transcriptions endpoint — whisper.cpp's
//         `whisper-server` is the fast local option (Metal-accelerated), and the
//         same path reaches hosted OpenAI as an eval baseline.
//
// Both stay on this machine unless WHISPER_BASE_URL is deliberately pointed at
// api.openai.com. Either way ffmpeg is required: openai/whisper shells out to it
// to decode audio, and whisper.cpp needs 16 kHz mono WAV.
//
//   WHISPER_BACKEND     cli | http
//   WHISPER_CLI_MODEL   tiny | base | small | medium | large-v3, or a fine-tuned path
//   WHISPER_DEVICE      cpu | mps | cuda   (openai/whisper only)
//   WHISPER_BASE_URL    http://127.0.0.1:8080/v1  |  https://api.openai.com/v1
//   WHISPER_TRANSCODE   'true' to convert ogg/opus to 16 kHz WAV before an http call

// A commented-out or deliberately-blank line in .env yields an empty string, not
// undefined — so `??` keeps the empty value and the default never applies. Treat
// blank as unset.
const { env } = require('../utils/env');

const BACKEND = env('WHISPER_BACKEND', 'cli').toLowerCase();
const BASE_URL = env('WHISPER_BASE_URL', 'http://127.0.0.1:8080/v1');
const MODEL = env('WHISPER_MODEL', 'whisper-1');
const CLI_BIN = env('WHISPER_CLI_PATH', 'whisper');
const CLI_MODEL = env('WHISPER_CLI_MODEL', 'medium');
const CLI_DEVICE = env('WHISPER_DEVICE', '');
const TRANSCODE = env('WHISPER_TRANSCODE', 'true').toLowerCase() === 'true';
const FFMPEG = env('FFMPEG_PATH', 'ffmpeg');
const TIMEOUT_MS = Number(env('WHISPER_TIMEOUT_MS', 600000));

function isLocal() {
  return BACKEND === 'cli' || !/api\.openai\.com/.test(BASE_URL);
}

// ─── openai/whisper CLI backend ───────────────────────────────────────────────

// Runs `whisper` over a temp file and reads its JSON sidecar. The CLI's JSON
// carries the same segment fields as the API's verbose_json — text, language,
// and per-segment avg_logprob / no_speech_prob — so confidence scoring is
// identical across backends.
function transcribeViaCli(buffer, mimeType, { language }) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanko-whisper-'));
    const stem = 'audio';
    const input = path.join(dir, `${stem}.${_extFor(mimeType)}`);
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });

    fs.writeFileSync(input, buffer);

    const args = [
      input,
      '--model', CLI_MODEL,
      '--output_format', 'json',
      '--output_dir', dir,
      '--task', 'transcribe',
      // Deterministic: without this the CLI samples and the same audio can
      // transcribe differently between runs, which makes evals meaningless.
      '--temperature', '0',
    ];
    if (language) args.push('--language', language);
    if (CLI_DEVICE) args.push('--device', CLI_DEVICE);

    const proc = spawn(CLI_BIN, args);
    const stderr = [];
    proc.stderr.on('data', c => stderr.push(c));

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      cleanup();
      reject(new Error(`whisper timed out after ${TIMEOUT_MS}ms. Try a smaller WHISPER_CLI_MODEL than '${CLI_MODEL}'.`));
    }, TIMEOUT_MS);

    proc.on('error', err => {
      clearTimeout(timer);
      cleanup();
      // macOS ships no `pip`, and its Command Line Tools Python is too old for
      // current PyTorch — so point at the install route that actually works, and
      // at WHISPER_CLI_PATH, since a venv on the shell's PATH is not on ours.
      reject(err.code === 'ENOENT'
        ? new Error(
            `'${CLI_BIN}' not found. Install with: brew install uv && uv tool install openai-whisper — ` +
            `or set WHISPER_CLI_PATH to the binary's full path (Sanko spawns it as a subprocess, ` +
            `so activating a venv in your shell does not help). Run \`npm run doctor\` to check.`
          )
        : err);
    });

    proc.on('close', code => {
      clearTimeout(timer);
      const errText = Buffer.concat(stderr).toString();
      if (code !== 0) {
        cleanup();
        return reject(new Error(`whisper exited ${code}: ${errText.slice(0, 400)}`));
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, `${stem}.json`), 'utf8'));
        resolve({ text: parsed.text, language: parsed.language, segments: parsed.segments });
      } catch (err) {
        reject(new Error(`whisper produced no readable JSON: ${err.message}. stderr: ${errText.slice(0, 200)}`));
      } finally {
        cleanup();
      }
    });
  });
}

// Converts arbitrary WhatsApp audio to the 16 kHz mono WAV whisper.cpp expects,
// via ffmpeg on stdin/stdout — no temp files, so nothing to clean up or leak.
function transcodeToWav(buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav',
      'pipe:1',
    ]);

    const chunks = [];
    const errors = [];
    ff.stdout.on('data', c => chunks.push(c));
    ff.stderr.on('data', c => errors.push(c));

    ff.on('error', err => {
      reject(err.code === 'ENOENT'
        ? new Error(`ffmpeg not found at '${FFMPEG}'. Install it (brew install ffmpeg) or set WHISPER_TRANSCODE=false.`)
        : err);
    });
    ff.on('close', code => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errors).toString().slice(0, 300)}`));
      resolve(Buffer.concat(chunks));
    });

    ff.stdin.on('error', () => {}); // ffmpeg can close stdin early on bad input
    ff.stdin.end(buffer);
  });
}

// Transcribes a voice note. Returns { text, language, confidence }.
//
// options.language     — ISO 639-1 code. NOT a hint: Whisper locks the decoder to
//                        this language and skips detection entirely, so passing a
//                        wrong code yields confident nonsense rather than an error.
//                        Omit unless the practitioner actually stated it; see
//                        WHISPER_LANGUAGE_MODE in utils/inboundMedia.js.
// options.practitioner_id — attributed on the whisper_call usage event.
//
// confidence is derived from segment-level avg_logprob and no_speech_prob,
// mapped to 0–1. Roughly: ≥0.75 clean speech, 0.5–0.75 usable but uncertain,
// <0.5 likely garbled. Servers that omit segments fall back to a length
// heuristic rather than failing.
// The two backends disagree about what a language *is*. openai/whisper reports
// ISO 639-1 ('en', 'yo'); whisper.cpp's server reports English names ('english',
// 'yoruba'). Everything downstream compares against the ISO codes practitioners
// store in preferred_language, so an un-normalised 'english' is not a cosmetic
// difference: it never equals 'en', so inboundMedia flags a language mismatch on
// every single English voice note, and it lands in the archive as a second
// spelling of a language that is already there under another name.
const ISO_639_1 = {
  english: 'en', yoruba: 'yo', igbo: 'ig', hausa: 'ha',
  french: 'fr', arabic: 'ar', portuguese: 'pt', spanish: 'es', swahili: 'sw',
};

function _toIso639(language) {
  if (!language) return null;
  const value = String(language).trim().toLowerCase();
  // Already a code — pass through untouched rather than guessing.
  if (/^[a-z]{2}$/.test(value)) return value;
  // An unmapped name is reported as-is: silently dropping it would lose a real
  // detection, and mapping it to English would be the exact bug above in reverse.
  return ISO_639_1[value] ?? value;
}

async function transcribe(audioBuffer, mimeType = 'audio/ogg', { language, practitioner_id } = {}) {
  const result = BACKEND === 'cli'
    ? await transcribeViaCli(audioBuffer, mimeType, { language })
    : await transcribeViaHttp(audioBuffer, mimeType, { language });

  const { text, language: rawLanguage, segments } = result;
  const detected = _toIso639(rawLanguage);
  const confidence = _confidenceFromSegments(segments, text);

  // Usage event for the admin cost view — logged here so every call site is
  // counted, not just the ones that remember to log.
  const { logEvent } = require('./supabase');
  logEvent({
    practitioner_id: practitioner_id ?? null,
    event_type: 'whisper_call',
    payload: {
      language: detected ?? language ?? null,
      confidence,
      local: isLocal(),
      backend: BACKEND,
      model: BACKEND === 'cli' ? CLI_MODEL : MODEL,
    },
  }).catch(() => {});

  // No 'en' fallback: a language we never detected and were never told is null,
  // not English. Callers decide what to do with "unknown"; inventing a default
  // here is how the wrong language ends up on a record as though it were observed.
  return { text: text?.trim() ?? '', language: detected ?? language ?? null, confidence };
}

// ─── OpenAI-compatible HTTP backend ───────────────────────────────────────────

async function transcribeViaHttp(audioBuffer, mimeType, { language }) {
  let payload = audioBuffer;
  let filename = `audio.${_extFor(mimeType)}`;
  let contentType = mimeType;

  if (TRANSCODE && isLocal()) {
    payload = await transcodeToWav(audioBuffer);
    filename = 'audio.wav';
    contentType = 'audio/wav';
  }

  const form = new FormData();
  form.append('file', payload, { filename, contentType });
  form.append('model', MODEL);
  form.append('response_format', 'verbose_json');
  if (language) form.append('language', language);

  const headers = { ...form.getHeaders() };
  // Local servers take no key; sending one is harmless but pointless.
  if (!isLocal()) headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;

  try {
    const response = await axios.post(`${BASE_URL}/audio/transcriptions`, form, { headers, timeout: TIMEOUT_MS });
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED' && isLocal()) {
      throw new Error(`Whisper is not reachable at ${BASE_URL}. Is whisper-server running?`, { cause: err });
    }
    throw new Error(`Transcription failed: ${err.response?.data?.error?.message ?? err.message}`, { cause: err });
  }
}

function _extFor(mimeType) {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  return 'ogg';
}

// Maps verbose_json segments to a 0–1 confidence score:
// exp(avg_logprob) per segment (≈ mean token probability), scaled by speech
// probability and weighted by segment duration.
function _confidenceFromSegments(segments, text) {
  if (!text?.trim()) return 0;
  if (!Array.isArray(segments) || segments.length === 0) {
    // Some local builds omit segments; degrade to a length heuristic.
    return text.trim().length > 10 ? 0.8 : 0.4;
  }

  let weighted = 0;
  let total = 0;
  for (const s of segments) {
    const duration = Math.max((s.end ?? 0) - (s.start ?? 0), 0.01);
    const tokenProb = Math.exp(Math.min(s.avg_logprob ?? -1, 0));
    const speechProb = 1 - Math.min(Math.max(s.no_speech_prob ?? 0, 0), 1);
    weighted += tokenProb * speechProb * duration;
    total += duration;
  }
  if (!total) return 0.5;
  return Math.min(Math.max(weighted / total, 0), 1);
}

module.exports = {
  transcribe,
  transcribeViaCli,
  transcribeViaHttp,
  transcodeToWav,
  isLocal,
  _confidenceFromSegments,
  _toIso639,
};

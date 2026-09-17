// Reading a notebook page.
//
// A practitioner photographs a page of their own book — decades of formulations
// in their handwriting, often mixing English with Yorùbá, Igbo or Hausa, often
// with their own abbreviations. This service turns that image into text. It does
// not structure it; the agent does that afterwards from the text, using the same
// tools it uses for a voice note. Keeping the two apart matters: when a saved
// formulation is wrong you need to know whether the page was misread or the
// reading was mis-structured, and one model doing both hides which.
//
// Two backends, chosen by VISION_BACKEND, mirroring services/llm.js:
//
//   ollama    — a vision model on this machine. The default, and the only one
//               that keeps the page on the host.
//   anthropic — hosted, kept as an eval baseline for how far behind local is.
//   off       — no reading at all; photos are archived and shown to the agent
//               as an image block, which is what Sanko did before this existed.
//
// The agent model and the vision model are deliberately separate settings.
// OLLAMA_MODEL is qwen2.5:32b-instruct — a text-only model. Ollama accepts an
// `images` array for it and silently ignores the pixels, so before this service
// existed every photo reached the agent as an empty gesture and the agent
// answered as if it had seen something. That failure is invisible from the
// outside, which is why the reading is now an explicit step with its own row.

const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const { env, envNumber } = require('../utils/env');
const log = require('../utils/log');

const BACKEND = env('VISION_BACKEND', 'ollama').toLowerCase();
const OLLAMA_BASE_URL = env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
const OLLAMA_MODEL = env('VISION_MODEL', 'qwen2.5vl:7b');
const ANTHROPIC_MODEL = env('VISION_ANTHROPIC_MODEL', 'claude-sonnet-4-6');
const TIMEOUT_MS = envNumber('VISION_TIMEOUT_MS', 300000);
const KEEP_ALIVE = (raw => {
  const trimmed = String(raw).trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
})(env('OLLAMA_KEEP_ALIVE', '-1'));

// The sentinel is a word the model can emit for a photo that is not a page at
// all — a plant, a bark sample, a bottle. Practitioners send those too, and a
// model asked only to "transcribe" will hallucinate a label rather than admit
// there is no text. Giving it something to say instead is cheaper than trying to
// detect the hallucination afterwards.
const NO_TEXT = 'NO_TEXT';

// Illegible words come back as this marker rather than the model's best guess.
// A guess and a real reading are indistinguishable downstream; a marker is the
// one thing a human reviewer can act on, and it is what the confidence score is
// computed from.
const UNREADABLE = '[?]';

// Diacritics are the failure this whole file cannot otherwise see.
//
// A model that reads "ewé" and writes "ewe" does not mark anything illegible —
// it returns fluent text at full confidence, and the record is quietly wrong.
// For an archive that is worse than a blank, and a stronger model makes it more
// likely rather than less, because fluency is what strips the marks. This is the
// same failure Whisper has with these languages: a wrong reading that scores
// high because the model is confidently producing well-formed text.
//
// So it is checked separately from confidence and reported separately. Absence
// of marks is evidence, never a verdict: plenty of practitioners write Yorùbá
// without tone marks, and a page that genuinely has none must not be called
// wrong. The signal exists to make a human look.
//
// How much text it takes before absence means anything differs by language, so
// each carries its own threshold and the reason for it:
//
//   yo  Tone is marked on nearly every word. Twenty words with none is loud.
//   ig  Dotted vowels are common but not universal, and everyday Igbo writing
//       routinely omits tone marks entirely. Needs more text before it means
//       anything.
//   ha  The hooked letters are lexical — they appear only if a word containing
//       one happens to occur. Weakest signal of the three; treated as a note.
//
// Text is decomposed (NFD) first so a precomposed "ẹ" and an "e" followed by a
// combining dot are counted the same way. Models emit both.
const DIACRITIC_LANGUAGES = {
  // Tone and subdot are counted apart because a model loses them apart. Measured
  // on glm-ocr reading a real Yorùbá formulary page: every tone mark kept, every
  // subdot destroyed — Tẹyọ → Teyo, Ipẹta → Ipeta, Ifọn → Ifun. A total count
  // called that healthy. Per class it is one whole class gone.
  //
  // `markers` are words common enough in these notebooks to say a page is in the
  // language even after a model has stripped every mark off them. Heavy on herbal
  // vocabulary because that is what these pages are — one real formulary page
  // used egbo (root) eight times.
  yo: {
    classes: { tone: /[\u0300\u0301\u0304]/g, subdot: /[\u0323]/g },
    labels: {
      tone: 'the tone marks (à á)',
      subdot: 'the subdots — ẹ ọ ṣ, which in Yorùbá are different letters from e o s, not accents on them',
    },
    markers: ['ati', 'awon', 'ewe', 'egbo', 'epo', 'isu', 'omi', 'agbo', 'oje', 'eso', 'ata', 'obi', 'iyo', 'eyin', 'ogede', 'funfun', 'dudu', 'pupa', 'meji', 'meta', 'merin', 'pelu', 'inu', 'ara', 'oju', 'ori', 'gbogbo', 'lati', 'ile', 'ewure', 'oyinbo', 'asunwon', 'iba'],
    minWords: 20,
  },
  // Igbo's dotted vowels are the letters ị ọ ụ. Tone is not tracked: everyday
  // Igbo writing omits it, so its absence would say nothing about the model.
  ig: {
    classes: { subdot: /[\u0323]/g },
    labels: { subdot: 'the dotted vowels (ị ọ ụ)' },
    markers: ['mmiri', 'akwukwo', 'ogwu', 'ahihia', 'ndi', 'nri', 'oji', 'ocha', 'abuo', 'ato', 'ahu', 'ubochi', 'gwo'],
    minWords: 40,
  },
  // Hausa's hooked letters are lexical — present only if such a word occurs — so
  // this needs far more text before absence means anything.
  ha: {
    classes: { hooked: /[\u0253\u0257\u0199\u01B4\u0181\u018A\u0198\u01B3]/g },
    labels: { hooked: 'the hooked letters (ɓ ɗ ƙ ƴ)' },
    markers: ['ruwa', 'ganye', 'magani', 'jiki', 'biyu', 'uku', 'hudu', 'fari', 'baki', 'kwana', 'itace', 'tushe', 'ciki'],
    minWords: 60,
  },
};

// How many distinct marker words a reading needs before it counts as being in
// the language at all. Two rather than one: several of these are short enough to
// turn up by accident on an English page of product names.
const MARKERS_REQUIRED = 2;

// Does this page look like the language the practitioner stated?
//
// It has to, before absence of marks means anything. These notebooks are
// bilingual — Yorùbá formulations behind an English index — and the stated
// language belongs to the practitioner, not to the page. Without this every
// English page in the book reports its Yorùbá diacritics missing, and a flag
// that cries wolf on half a notebook is a flag nobody reads.
//
// This is not language identification: the practitioner's stated language still
// chooses which marks to look for. It only asks whether this page is plausibly
// that language, which is a much narrower claim and one that can be checked.
//
// Matching runs on stripped, lowercased text, because the marks being missing is
// the entire premise: asunwọn and asunwon both have to count.
function _looksLikeLanguage(text, spec) {
  const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = new Set(plain.split(/[^a-z]+/).filter(Boolean));
  const hits = spec.markers.filter(marker => words.has(marker));
  return { hits, enough: hits.length >= MARKERS_REQUIRED };
}
const FOREIGN_MARKS = /[\u0302\u0303\u0308\u030a\u0327]/g;

function _diacritics(text, language) {
  const spec = DIACRITIC_LANGUAGES[language];
  if (!spec || !text) return { expected: false, found: 0, words: 0, missing: [], markers: [], in_language: false, foreign: 0, suspect: false, language: language ?? null };

  const words = text.split(/\s+/).filter(Boolean).length;
  const decomposed = text.normalize('NFD');

  const counts = {};
  for (const [name, pattern] of Object.entries(spec.classes)) {
    counts[name] = (decomposed.match(pattern) ?? []).length;
  }
  const found = Object.values(counts).reduce((a, b) => a + b, 0);

  // Three conditions, all of which must hold. Enough text to judge; a page that
  // is actually in this language; and a whole class of mark at zero. The last is
  // the signal rather than a low total — losing every subdot while keeping every
  // tone mark is a systematic failure that a total count reads as healthy.
  const { hits, enough: inLanguage } = _looksLikeLanguage(text, spec);
  const enoughText = words >= spec.minWords;
  const missing = enoughText && inLanguage
    ? Object.keys(counts).filter(name => counts[name] === 0)
    : [];

  return {
    expected: true,
    found,
    counts,
    words,
    missing,
    markers: hits,
    in_language: inLanguage,
    foreign: (decomposed.match(FOREIGN_MARKS) ?? []).length,
    suspect: missing.length > 0,
    language,
  };
}

const PROMPT = [
  'You are transcribing a photographed page from a traditional medicine practitioner\'s own notebook or a printed herbal reference.',
  '',
  'Transcribe every word exactly as written. Rules:',
  '- Do not translate. Yorùbá, Igbo, Hausa, Pidgin and English stay in the language and spelling on the page, diacritics included.',
  '- Do not correct, expand, tidy or reorder anything. Abbreviations, misspellings and crossings-out are the record.',
  '- Do not add anything that is not on the page. No headings, no summary, no commentary, no botanical names the writer did not write.',
  `- Where a word is genuinely illegible, write ${UNREADABLE} instead of guessing. Guessing is the one thing that makes this page useless.`,
  '- Keep the line breaks, list markers, numbering and column order of the page.',
  `- If the photograph contains no writing at all — a plant, a person, a container — reply with exactly ${NO_TEXT} and nothing else.`,
  '',
  'Reply with the page text alone.',
].join('\n');

function enabled() {
  return BACKEND !== 'off' && BACKEND !== 'none' && BACKEND !== 'false';
}

function providerName() {
  return BACKEND === 'anthropic' ? 'anthropic' : 'ollama';
}

function modelName() {
  return BACKEND === 'anthropic' ? ANTHROPIC_MODEL : OLLAMA_MODEL;
}

// Vision models like to wrap their answer in a fence or announce it first. The
// text is the record, so strip the packaging before it is stored.
function _clean(raw) {
  let text = String(raw ?? '').trim();
  const fenced = text.match(/^```(?:[a-z]*\n)?([\s\S]*?)```$/i);
  if (fenced) text = fenced[1].trim();
  text = text.replace(/^(?:here (?:is|'s) (?:the )?(?:transcription|transcript|text)[^\n:]*:)\s*/i, '').trim();

  // OCR models trained on document benchmarks emit LaTeX for anything they read
  // as a symbol — glm-ocr returns a practitioner's circled ingredient numbers as
  // $\textcircled{1}$, because OmniDocBench rewards formula recognition. That
  // markup is not on the page, and left alone it lands in media.transcript, goes
  // to the agent as if the practitioner wrote it, and ends up in the training
  // pairs a corrected reading produces.
  //
  // Only $…$ containing a backslash command is touched, so a price written as $5
  // on a page survives untouched. \textcircled{N} keeps its N: the number is the
  // ingredient's position, which is content.
  text = text.replace(/\$([^$]*\\[^$]*)\$/g, (_, inner) =>
    inner
      .replace(/\\(?:textcircled|circled|textbf|mathrm|text)\{([^{}]*)\}/g, '$1')
      .replace(/\\[a-zA-Z]+/g, '')
      .trim()
  );
  if (text.toUpperCase().replace(/[^A-Z_]/g, '') === NO_TEXT) return '';
  return text;
}

// Confidence from the model's own admissions, not from a number it invented.
// The share of tokens it refused to read is the only honest signal available
// from a chat completion — logprobs are not exposed by either backend here.
//
// A page with no words at all scores 0: nothing was read, so nothing about it
// should be trusted, and the caller distinguishes "empty" from "unreliable" by
// looking at the text.
function _confidence(text) {
  if (!text) return 0;
  const unreadable = (text.match(/\[\?\]/g) ?? []).length;
  const words = text.split(/\s+/).filter(w => w && w !== UNREADABLE).length;
  if (!words) return 0;
  return Math.max(0, Math.min(1, words / (words + unreadable * 3)));
}

async function _viaOllama(base64, mimeType, model) {
  const { data } = await axios.post(
    `${OLLAMA_BASE_URL}/api/chat`,
    {
      model,
      messages: [{ role: 'user', content: PROMPT, images: [base64] }],
      stream: false,
      keep_alive: KEEP_ALIVE,
      // Deterministic: the same page must read the same way twice, or a
      // correction recorded against one reading grades a different one.
      options: { temperature: 0 },
    },
    { timeout: TIMEOUT_MS }
  );
  return data?.message?.content ?? '';
}

let _anthropic;
async function _viaAnthropic(base64, mimeType, model) {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await _anthropic.messages.create({
    model,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  return (response.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// Names the class of mark that went missing, for the note the agent is given.
// "no diacritics" is not actionable; "every subdot is gone, and those are
// different letters" tells whoever reads it what to go and check.
function describeMissing(diacritics) {
  const spec = DIACRITIC_LANGUAGES[diacritics?.language];
  if (!spec || !diacritics?.missing?.length) return null;
  return diacritics.missing.map(name => spec.labels?.[name] ?? name).join(' and ');
}

// Returns { text, confidence, unreadable, diacritics, model, provider, error }.
//
// It never throws. A page that could not be read must not cost the practitioner
// their message: the photo is already archived by the caller, the agent still
// receives the image block, and the failure is reported in the return value so
// the caller can tell the agent what happened instead of pretending.
// `model` and `backend` override the configured pair for one call. Only the
// comparison harness uses them: routing a practitioner's page through an
// unconfigured model would make provenance a lie, so nothing on the inbound path
// passes them.
async function transcribePage(buffer, mimeType, { practitioner_id, language = null, model: modelOverride = null, backend = null } = {}) {
  const model = modelOverride ?? modelName();
  const provider = backend ?? providerName();

  if (!backend && !enabled()) {
    return { text: '', confidence: 0, unreadable: 0, model: null, provider: null, diacritics: _diacritics('', language), error: null, skipped: true };
  }

  const started = Date.now();
  try {
    const base64 = buffer.toString('base64');
    const raw = provider === 'anthropic'
      ? await _viaAnthropic(base64, mimeType, model)
      : await _viaOllama(base64, mimeType, model);

    const text = _clean(raw);
    const unreadable = (text.match(/\[\?\]/g) ?? []).length;
    const diacritics = _diacritics(text, language);
    log.info('vision.page_transcribed', {
      practitioner_id,
      provider,
      model,
      chars: text.length,
      unreadable,
      diacritics_found: diacritics.found,
      diacritics_missing: diacritics.missing,
      diacritics_in_language: diacritics.in_language,
      diacritics_foreign: diacritics.foreign,
      ms: Date.now() - started,
    });
    return { text, confidence: _confidence(text), unreadable, diacritics, model, provider, error: null };
  } catch (err) {
    // ECONNREFUSED here almost always means the vision model was never pulled —
    // a fresh install has the agent model and not this one. Say so in the log
    // rather than leaving an operator to infer it from a generic axios error.
    const detail = err.response?.data?.error ?? err.message;
    const hint = err.code === 'ECONNREFUSED'
      ? `Ollama is not reachable at ${OLLAMA_BASE_URL}`
      : /not found|no such model/i.test(String(detail))
        ? `run: ollama pull ${model}`
        : null;
    log.warn('vision.page_transcription_failed', { practitioner_id, provider, model, error: detail, hint });
    return { text: '', confidence: 0, unreadable: 0, diacritics: _diacritics('', language), model, provider, error: detail };
  }
}

module.exports = { transcribePage, enabled, providerName, modelName, NO_TEXT, UNREADABLE, PROMPT, DIACRITIC_LANGUAGES, FOREIGN_MARKS, describeMissing, _looksLikeLanguage, _clean, _confidence, _diacritics };

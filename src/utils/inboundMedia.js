// Turning a voice note or a photo into the content blocks the agent reads.
//
// This lives outside router.js because two transports need it: the Meta webhook,
// which downloads media from Meta's servers, and the simulator, which already has
// the bytes from a browser upload. Both must produce byte-identical blocks — a
// simulator that exercised its own copy of this logic would drift from the real
// path and stop being evidence of anything.
//
// Callers supply the buffer; fetching it is their business.

const whisper = require('../services/whisper');
const vision = require('../services/vision');
const db = require('../services/supabase');
const { env } = require('./env');

// Below this Whisper confidence the transcript is probably garbled. We still pass
// it to the agent — flagged — rather than dropping it, because the agent can ask
// a targeted "did you mean …?" that a canned retry message cannot.
//
// Note this guard does not catch a wrong forced language. Yoruba decoded as
// English scores *high*: the model is confidently emitting well-formed English,
// it is just not what was said. Only detection catches that, which is why the
// default below leaves detection switched on.
const LOW_TRANSCRIPT_CONFIDENCE = 0.6;

// Whisper's `language` argument forces rather than hints — it locks the decoder
// and skips language detection entirely.
//
//   auto    (default) never force. Whisper detects, and a detection that
//           disagrees with the practitioner's stated language is flagged to the
//           agent rather than silently accepted.
//   prefer  force the language the practitioner explicitly chose, when they have
//           chosen one. More accurate on clean single-language Yoruba, Igbo and
//           Hausa; worse on the code-switching this product expects, and it
//           costs you the mismatch signal.
//
// Neither mode ever forces a language the practitioner did not state. The old
// behaviour did, because preferred_language defaulted to 'en' — see migration
// 009. Flip this and re-run `npm run eval` if you want to measure the trade.
const LANGUAGE_MODE = env('WHISPER_LANGUAGE_MODE', 'auto').toLowerCase();

const LANGUAGE_NAMES = { en: 'English', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa' };
const _languageName = code => LANGUAGE_NAMES[code] || code;

// Returns { blocks, transcript, confidence, language, mismatch, mediaId }. The
// transcript, confidence and detected language come back alongside the blocks so
// the simulator can show what Whisper actually heard — on WhatsApp that detail is
// invisible, which is exactly why it needs a window.
async function audioBlocks(buffer, mimeType, practitioner) {
  const stated = practitioner.preferred_language || null;
  const forced = LANGUAGE_MODE === 'prefer' ? stated : null;

  const { text, language: detected, confidence } = await whisper.transcribe(buffer, mimeType, {
    language: forced ?? undefined,
    practitioner_id: practitioner.id,
  });

  // Archive before the agent sees the derivative. A formulation cannot claim
  // provenance unless its primary source has actually landed durably.
  const storage_path = await db.uploadVoiceNote(practitioner.id, buffer, mimeType);
  const media = await db.saveMedia({ practitioner_id: practitioner.id, kind: 'voice', storage_path, transcript: text });
  await db.setPendingSourceMedia(practitioner.id, media.id);
  practitioner.pending_source_media_id = media.id;
  practitioner.pending_source_media_at = new Date().toISOString();

  if (!text) {
    return {
      blocks: [{ type: 'text', text: '[voice note received but nothing could be transcribed — ask them to record it again]' }],
      transcript: '',
      confidence,
      language: detected,
      mismatch: false,
      mediaId: media.id,
    };
  }

  // A detected language that disagrees with the stated one is reported, not acted
  // on. Someone who set 'yo' and then spoke English is doing something completely
  // ordinary, and rewriting their profile from a single voice note — on a
  // detection that is itself shaky for these languages — would be worse than
  // telling the agent what we saw and letting it ask.
  const mismatch = Boolean(!forced && stated && detected && detected !== stated);

  const notes = [];
  if (confidence < LOW_TRANSCRIPT_CONFIDENCE) {
    notes.push(`transcription confidence only ${Math.round(confidence * 100)}% — treat as unreliable and confirm anything important`);
  }
  if (mismatch) {
    notes.push(`this sounds like ${_languageName(detected)} but their profile says ${_languageName(stated)} — reply in the language they actually used, and only change their profile if they ask you to`);
  }

  const flag = notes.length ? `[voice note, ${notes.join('; ')}]` : '[voice note transcript]';

  return { blocks: [{ type: 'text', text: `${flag}\n${text}` }], transcript: text, confidence, language: detected, mismatch, mediaId: media.id };
}

// Below this share of readable words the page reading is probably wrong more
// often than it is right. As with audio it is passed on flagged rather than
// dropped: a half-read page still tells the agent which formulation is being
// discussed, and the agent can ask about the rest.
const LOW_PAGE_CONFIDENCE = 0.75;

// A photographed notebook page becomes text before the agent sees it, and the
// text is archived on the media row exactly as a voice transcript is. That row
// is the reviewable artefact: it is what a human corrects in /admin, and the
// machine reading it replaces becomes the before-value of a correction. Without
// it a misread page would be unfalsifiable — the only evidence of what the model
// thought it saw would be a formulation nobody can trace back to a word.
async function imageBlocks(buffer, mimeType, practitioner, caption) {
  const visionType = visionMimeType(mimeType);
  const page = await vision.transcribePage(buffer, visionType, {
    practitioner_id: practitioner.id,
    // Their stated language decides which diacritics the reading ought to carry.
    // Null means they have not said, and the check is skipped rather than guessed.
    language: practitioner.preferred_language || null,
  });

  // Archive before the agent sees the derivative, for the same reason as audio:
  // provenance that is written after the fact is provenance nobody can check.
  const storage_path = await db.uploadPhoto(practitioner.id, buffer, mimeType);
  const media = await db.saveMedia({
    practitioner_id: practitioner.id,
    kind: 'photo',
    storage_path,
    transcript: page.text || null,
    transcript_model: page.model,
    transcript_provider: page.provider,
    transcript_confidence: page.text ? page.confidence : null,
  });
  await db.setPendingSourceMedia(practitioner.id, media.id);
  practitioner.pending_source_media_id = media.id;
  practitioner.pending_source_media_at = new Date().toISOString();

  const trimmed = caption?.trim();
  const blocks = [
    {
      type: 'image',
      source: { type: 'base64', media_type: visionType, data: buffer.toString('base64') },
    },
  ];

  const notes = [];
  // A photo with no writing on it is the other thing practitioners send: a leaf
  // held up to the camera, a strip of bark, a root, a tray of dried material.
  // Until specimens existed this was reported as an absence — "no writing was
  // found" — and the conversation died there, with the image archived and the
  // one person who could say what the plant was never asked.
  //
  // It is a candidate, not a verdict. The same empty reading comes back from a
  // photo of a grinding stone, a bottle or a grandchild, so the agent is told
  // what was and was not established and asks rather than assumes.
  const specimenCandidate = Boolean(!page.error && !page.text && !page.skipped);

  if (page.error) {
    notes.push('the page could not be read automatically — ask them to type or say what it contains rather than guessing at it');
  } else if (page.skipped) {
    // Reading is switched off in this deployment. The agent has an image and,
    // on a text-only local model, that is nothing at all — so say so plainly
    // rather than letting it answer as though it had seen something.
    notes.push('page reading is switched off here, so you have not been told anything about this image — ask them to say or type what it shows');
  } else if (!page.text) {
    notes.push(
      'there is no writing on it. It may be a plant they are showing you — a leaf, a bark, a root, ' +
      'dried material — or it may be something else entirely, and you cannot tell which from here. ' +
      'Ask what they have sent. If it is a plant, ask what THEY call it, take their words and their ' +
      'spelling exactly as given, and record it with save_specimen; ask which part it is and how often ' +
      'they work with it only if the conversation allows. Never name the plant yourself and never ' +
      'offer them a name to agree to: you cannot identify a plant from a photograph, a name they ' +
      'merely accepted is not a name they gave, and Sanko resolves the botanical name itself'
    );
  } else if (page.confidence < LOW_PAGE_CONFIDENCE) {
    notes.push(`parts of the page were illegible — ${vision.UNREADABLE} marks a word that could not be read; confirm those before recording them, never fill them in`);
  }

  // Separate from the confidence note, and deliberately not an else-branch: a
  // page can be fully legible and still come back with its tone marks stripped.
  // That reading looks perfect, which is exactly why it needs saying out loud.
  const missing = vision.describeMissing(page.diacritics);
  if (missing) {
    notes.push(`this reading has lost ${missing} — every one of them, across the whole page, in ${_languageName(page.diacritics.language)}. Either the model stripped them or the page is written without them. Do not record a plant name, condition or dosage from this page without asking them how it is spelled`);
  }

  const flag = specimenCandidate
    ? `[photo, ${notes.join('; ')}]`
    : notes.length
      ? `[photo of a notebook page, ${notes.join('; ')}]`
      : '[photo of a notebook page, transcribed below]';

  const text = [
    flag,
    page.text || null,
    trimmed ? `[they said with it] ${trimmed}` : null,
  ].filter(Boolean).join('\n');

  blocks.push({ type: 'text', text });

  return {
    mediaId: media.id,
    blocks,
    specimenCandidate,
    transcript: page.text,
    confidence: page.confidence,
    unreadable: page.unreadable,
    diacritics: page.diacritics ?? null,
    model: page.model,
    error: page.error ?? null,
  };
}

// Claude vision accepts jpeg, png, gif and webp. Anything else is relabelled as
// jpeg, which is what WhatsApp actually sends for camera photos.
function visionMimeType(mimeType) {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(base) ? base : 'image/jpeg';
}

module.exports = { LOW_TRANSCRIPT_CONFIDENCE, LOW_PAGE_CONFIDENCE, audioBlocks, imageBlocks, visionMimeType };

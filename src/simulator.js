// /simulator — a browser stand-in for WhatsApp.
//
// It calls runAgent() with the same arguments the webhook does, so the reply you
// get here is the reply a practitioner gets on their phone. The only difference
// is the `send` callback: WhatsApp posts to Meta's API, the simulator collects
// into an array and returns it.
//
// This exists because the pilot is blocked on a Meta production number. It lets
// the agent be exercised end-to-end — real Claude, real Supabase, real tool calls
// — with nothing but a browser.
//
// Password-protected: it writes to the live database and spends API credits.

const crypto = require('crypto');
const express = require('express');
const log = require('./utils/log');
const { requireAuth, safeEqual } = require('./utils/basicAuth');
const { env } = require('./utils/env');
const { runAgent } = require('./agent');
const { getOrCreatePractitioner, PRIVACY_NOTICE } = require('./agent/practitioner');
// Held as a namespace rather than destructured, like router.js — destructuring
// captures the real functions at require time, which the tests then cannot swap.
const db = require('./services/supabase');
const inboundMedia = require('./utils/inboundMedia');
const { splitChoices } = require('./utils/choices');

const router = express.Router();
const auth = requireAuth('Sanko Vault Simulator');

// Simulator conversations are real practitioner rows. Defaulting to an obviously
// fake E.164 number keeps test data separable from pilot data.
const DEFAULT_PHONE = '+99900000001';

// Guests get their own block within the same fake range, so `+9991…` reads as
// "someone we handed a demo link to" and `+99900…` as "Felix testing".
const GUEST_PREFIX = '+9991';

function _normalisePhone(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return DEFAULT_PHONE;
  const cleaned = raw.replace(/[^\d+]/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

// ─── identity ─────────────────────────────────────────────────────────────────
//
// A conversation is a phone number, because that is what it is on WhatsApp: the
// practitioners table is unique on phone_number and every Vault record hangs off
// practitioner_id, so two different numbers are already two fully separate
// people. The only thing a guest link adds is not making someone type one.
//
// The slug is hashed rather than counted so the same name always lands on the
// same number without the server keeping a registry of who has been invited.

function _slugify(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function guestPhone(slug) {
  const digest = crypto.createHash('sha256').update(`sanko-guest:${slug}`).digest();
  return GUEST_PREFIX + String(digest.readUInt32BE(0) % 10_000_000).padStart(7, '0');
}

// Two ways in, and they are not equivalent:
//
//   Basic Auth (felix + ADMIN_PASSWORD) — the owner. May address any number,
//   which is how you inspect a practitioner's conversation from the simulator.
//
//   GUEST_TOKEN — a share link. Pinned to the number its ?as= slug hashes to and
//   unable to name another, so handing the link to someone lets them have their
//   own conversation without also handing them yours or /admin.
//
// With GUEST_TOKEN unset the guest branch can never match, so the default
// posture is exactly what it was before: password or nothing.
function _header(req, name) {
  return req.headers?.[name] ?? '';
}

function simulatorAuth(req, res, next) {
  const expected = env('GUEST_TOKEN');
  const presented = req.query?.t || _header(req, 'x-sim-token');

  if (expected && presented && safeEqual(presented, expected)) {
    const slug = _slugify(req.query?.as || _header(req, 'x-sim-as')) || 'guest';
    req.sim = { owner: false, slug, phone: guestPhone(slug) };
    return next();
  }

  return auth(req, res, () => {
    req.sim = { owner: true, slug: null, phone: null };
    next();
  });
}

// The owner picks the number per request; a guest's was decided at the door and
// whatever the browser claims is ignored.
function _phoneFor(req, supplied) {
  return req.sim?.owner === false ? req.sim.phone : _normalisePhone(supplied);
}

router.get('/', simulatorAuth, (req, res) => {
  const config = req.sim.owner
    ? { owner: true, phone: DEFAULT_PHONE, slug: null }
    : { owner: false, phone: req.sim.phone, slug: req.sim.slug };

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // `<` is escaped because a config value ending up next to a literal `</script>`
  // would end the block early.
  res.send(PAGE.replace('__SIM_CONFIG__', JSON.stringify(config).replace(/</g, '\\u003c')));
});

// Runs one turn. Body: { phone?, text?, attachment? }
//
// attachment is { kind: 'voice' | 'photo', mime_type, data } where data is base64
// — the browser has the bytes already, so posting them inline avoids a multipart
// parser dependency for what is a development surface.
//
// Text and an attachment can arrive together: on WhatsApp the aggregator batches
// a voice note and the message typed after it into one turn, and the agent should
// see the same shape here.
router.post('/message', simulatorAuth, express.json({ limit: '25mb' }), async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  const attachment = req.body?.attachment ?? null;
  if (!text && !attachment) return res.status(400).json({ error: 'text or attachment is required' });

  const phone = _phoneFor(req, req.body?.phone);

  try {
    const { practitioner, isNew } = await getOrCreatePractitioner(phone);

    const replies = [];
    const consentRequests = [];
    if (isNew) replies.push({ text: PRIVACY_NOTICE, choices: [] });
    else await db.updateLastActive(practitioner.id);

    const types = [];
    if (attachment) types.push(attachment.kind === 'voice' ? 'audio' : 'image');
    if (text) types.push('text');

    await db.logEvent({
      practitioner_id: practitioner.id,
      event_type: 'inbound_msg',
      payload: { from: phone, types, batched: types.length, transport: 'simulator', guest: req.sim?.slug ?? null },
    });

    // Blocks are ordered the way the webhook orders them: the voice note or photo
    // is the message, any typed text is the remark that came with it.
    const blocks = [];
    const sourceMediaIds = [];
    let heard = null;

    if (attachment) {
      const buffer = Buffer.from(String(attachment.data ?? ''), 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'attachment had no data' });
      const mimeType = String(attachment.mime_type || '');

      if (attachment.kind === 'voice') {
        const { blocks: audio, transcript, confidence, language, mismatch, mediaId } = await inboundMedia.audioBlocks(buffer, mimeType, practitioner);
        blocks.push(...audio);
        sourceMediaIds.push(mediaId);
        heard = {
          transcript,
          confidence,
          low: confidence < inboundMedia.LOW_TRANSCRIPT_CONFIDENCE,
          // What Whisper decided it was listening to, and whether that contradicts
          // the practitioner's profile. Worth seeing: a wrong language is the one
          // failure that confidence alone will not show you.
          language: language ?? null,
          language_mismatch: mismatch,
          bytes: buffer.length,
          mime_type: mimeType,
        };
      } else {
        const { blocks: photo, mediaId, transcript, confidence, unreadable, diacritics, model, error } =
          await inboundMedia.imageBlocks(buffer, mimeType, practitioner, text);
        blocks.push(...photo);
        sourceMediaIds.push(mediaId);
        // The same window the voice path gets, for the same reason: on WhatsApp
        // there is no way to see what the model made of a page, and a misread
        // page is indistinguishable from a well-read one once it has become a
        // formulation.
        heard = {
          transcript,
          confidence,
          low: !transcript || confidence < inboundMedia.LOW_PAGE_CONFIDENCE,
          source: 'page',
          model: model ?? null,
          unreadable: unreadable ?? 0,
          diacritics_suspect: Boolean(diacritics?.suspect),
          error: error ?? null,
          bytes: buffer.length,
          mime_type: mimeType,
        };
      }
    }

    // imageBlocks already folds the text in as the photo's caption; adding it
    // again would show the agent the same sentence twice.
    if (text && attachment?.kind !== 'photo') blocks.push({ type: 'text', text });

    const result = await runAgent({
      practitioner,
      content: blocks,
      sourceMediaIds,
      // The simulator never messages a real patient. Surface the request in the
      // JSON response so the operator can inspect the exact invitation target.
      sendPatientConsent: async invitation => {
        consentRequests.push(invitation);
        return true;
      },
      send: async (reply, choices) => { replies.push({ text: reply, choices: choices ?? [] }); },
    });

    res.json({
      replies,
      // Surfacing the tool calls is the point of the simulator — it is how you
      // confirm a formulation actually reached the Vault rather than the agent
      // merely claiming it did.
      tool_calls: result.toolCalls.map(t => ({ name: t.name, input: t.input, result: t.result })),
      // What Whisper heard, and how sure it was. On WhatsApp this is invisible;
      // here it is the difference between "the agent misunderstood" and "the
      // transcript was already wrong before the agent saw it".
      heard,
      patient_consent_requests: consentRequests,
      stopped: result.stopped,
      practitioner: { phone, display_name: practitioner.display_name },
    });
  } catch (err) {
    log.error('simulator.turn_failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Replays the stored conversation so a refresh doesn't look like amnesia.
//
// The agent never forgot: history lives in agent_messages and every turn reloads
// it. Only the browser's rendering of it was disposable. This rebuilds the same
// bubbles from the same rows the agent reads, which is why a restored transcript
// is the truth rather than a decorative copy of it.
router.get('/history', simulatorAuth, async (req, res) => {
  const phone = _phoneFor(req, req.query?.phone);
  try {
    const { practitioner } = await getOrCreatePractitioner(phone);
    const stored = await db.loadAgentMessages(practitioner.id);

    const items = [];
    for (const message of stored) {
      const blocks = Array.isArray(message.content) ? message.content : [{ type: 'text', text: String(message.content ?? '') }];

      // A user row holding tool_result blocks is the agent talking to itself —
      // it was never something the practitioner said, so it is not shown.
      if (message.role === 'user' && blocks.some(b => b?.type === 'tool_result')) continue;

      for (const block of blocks) {
        if (block?.type === 'text' && block.text?.trim()) {
          // Stored assistant text still carries the [[a|b]] sentinel; strip it
          // for display exactly as the live path does.
          const { text, choices } = message.role === 'user'
            ? { text: block.text, choices: [] }
            : splitChoices(block.text);
          if (text) items.push({ kind: message.role === 'user' ? 'me' : 'bot', text, choices });
        } else if (block?.type === 'tool_use') {
          items.push({ kind: 'tool', name: block.name, input: block.input });
        }
      }
    }

    res.json({ items, practitioner: { phone, display_name: practitioner.display_name } });
  } catch (err) {
    log.error('simulator.history_failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Wipes conversation memory for a phone number. Vault records are untouched —
// this resets the chat, not the data.
router.post('/reset', simulatorAuth, express.json(), async (req, res) => {
  const phone = _phoneFor(req, req.body?.phone);
  try {
    const { practitioner } = await getOrCreatePractitioner(phone);
    await db.clearAgentMessages(practitioner.id);
    res.json({ ok: true, phone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── page ─────────────────────────────────────────────────────────────────────

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sanko Vault — Simulator</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #f5f5f4; color: #1c1917; height: 100vh; display: flex; flex-direction: column; }
  header { background: #166534; color: #fff; padding: 0.85rem 1.25rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 1.05rem; font-weight: 600; }
  header .sub { font-size: 0.75rem; opacity: 0.85; }
  header input { margin-left: auto; font: inherit; font-size: 0.8rem; padding: 0.3rem 0.55rem; border-radius: 6px; border: none; width: 170px; }
  header button { font: inherit; font-size: 0.8rem; padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.4); background: transparent; color: #fff; cursor: pointer; }
  header button:hover { background: rgba(255,255,255,0.15); }
  header #whoami { margin-left: auto; font-size: 0.8rem; background: rgba(255,255,255,0.15); padding: 0.3rem 0.6rem; border-radius: 6px; }
  header #whoami b { font-weight: 600; }
  main { flex: 1; display: flex; min-height: 0; }
  #chat { flex: 1; overflow-y: auto; padding: 1.25rem; background: #ece5dd; display: flex; flex-direction: column; gap: 0.5rem; }
  .msg { max-width: min(560px, 78%); padding: 0.55rem 0.8rem; border-radius: 10px; font-size: 0.9rem; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; box-shadow: 0 1px 1px rgba(0,0,0,0.08); }
  .me  { align-self: flex-end; background: #dcf8c6; }
  .bot { align-self: flex-start; background: #fff; }
  .sys { align-self: center; background: #fef3c7; color: #92400e; font-size: 0.78rem; border-radius: 6px; }
  .err { align-self: center; background: #fee2e2; color: #991b1b; font-size: 0.8rem; border-radius: 6px; }
  aside { width: 340px; border-left: 1px solid #d6d3d1; background: #fff; overflow-y: auto; padding: 1rem; }
  aside h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #78716c; margin-bottom: 0.6rem; }
  .tool { border-left: 3px solid #166534; background: #f7fdf9; padding: 0.5rem 0.65rem; margin-bottom: 0.5rem; border-radius: 0 5px 5px 0; }
  .tool.bad { border-left-color: #b91c1c; background: #fef2f2; }
  .tool b { font-size: 0.8rem; font-family: ui-monospace, monospace; }
  .tool pre { font-size: 0.7rem; font-family: ui-monospace, monospace; white-space: pre-wrap; word-break: break-all; color: #57534e; margin-top: 0.25rem; }
  form { display: flex; gap: 0.5rem; padding: 0.75rem; background: #f5f5f4; border-top: 1px solid #d6d3d1; align-items: center; }
  form input[type=text] { flex: 1; font: inherit; padding: 0.6rem 0.8rem; border-radius: 20px; border: 1px solid #d6d3d1; }
  form button { font: inherit; padding: 0.6rem 1.2rem; border-radius: 20px; border: none; background: #166534; color: #fff; cursor: pointer; }
  form button:disabled { opacity: 0.5; cursor: default; }
  .icon { background: #fff !important; color: #44403c !important; border: 1px solid #d6d3d1 !important; padding: 0.55rem 0.75rem !important; font-size: 1rem; }
  .icon.recording { background: #b91c1c !important; color: #fff !important; border-color: #b91c1c !important; }
  #pending-file { font-size: 0.75rem; color: #57534e; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .heard { align-self: flex-end; background: #fff7ed; border: 1px solid #fed7aa; color: #7c2d12; font-size: 0.78rem; border-radius: 8px; padding: 0.5rem 0.7rem; max-width: min(560px, 78%); }
  .heard.low { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
  .heard b { display: block; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.75; margin-bottom: 0.2rem; }
  .msg img { max-width: 220px; border-radius: 6px; display: block; }
  .choices { align-self: flex-start; display: flex; flex-wrap: wrap; gap: 0.4rem; max-width: min(560px, 78%); margin-bottom: 0.2rem; }
  .choices button { font: inherit; font-size: 0.85rem; padding: 0.5rem 1rem; border-radius: 18px; border: 1px solid #166534; background: #fff; color: #166534; cursor: pointer; }
  .choices button:hover:not(:disabled) { background: #166534; color: #fff; }
  .choices button:disabled { opacity: 0.45; cursor: default; }
  @media (max-width: 820px) { aside { display: none; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>🌿 Sanko Simulator</h1>
    <div class="sub">Same agent code path as WhatsApp · writes to the live Vault</div>
  </div>
  <input id="phone" value="+99900000001" title="Practitioner phone number">
  <span id="whoami" hidden></span>
  <button id="reset" type="button">Reset chat</button>
</header>
<main>
  <div id="chat"></div>
  <aside>
    <h2>Tool calls</h2>
    <div id="tools"></div>
  </aside>
</main>
<form id="composer">
  <input type="file" id="file" accept="audio/*,image/*" hidden>
  <button type="button" class="icon" id="attach" title="Attach a voice note or photo">📎</button>
  <button type="button" class="icon" id="record" title="Hold to record a voice note">🎤</button>
  <span id="pending-file"></span>
  <input type="text" id="text" placeholder="Type a message…" autocomplete="off" autofocus>
  <button id="send" type="submit">Send</button>
</form>
<script>
  const chat = document.getElementById('chat');
  const tools = document.getElementById('tools');
  const phoneEl = document.getElementById('phone');
  const textEl = document.getElementById('text');
  const sendBtn = document.getElementById('send');

  // Who this tab is. The server decided it; the page only renders it.
  const SIM = __SIM_CONFIG__;
  const TOKEN = new URLSearchParams(location.search).get('t');

  phoneEl.value = SIM.phone;
  if (!SIM.owner) {
    // A guest's number is not theirs to change — the server would ignore an edit
    // anyway, so showing an editable box would only be a lie about what it does.
    phoneEl.hidden = true;
    const who = document.getElementById('whoami');
    who.hidden = false;
    who.innerHTML = 'You are <b></b>';
    who.querySelector('b').textContent = SIM.slug;
    who.title = 'This conversation is ' + SIM.phone;
    document.querySelector('header .sub').textContent =
      'Your own private conversation with the agent · nobody else sees it';
  }

  // Every request re-presents the guest identity, because auth is per-request:
  // the header keeps the token out of the POST URLs (and the server's access log)
  // while still proving the same thing the page link proved.
  function simFetch(path, options = {}) {
    const url = new URL(path, location.origin);
    const headers = Object.assign({}, options.headers);
    if (TOKEN) {
      headers['x-sim-token'] = TOKEN;
      if (SIM.slug) headers['x-sim-as'] = SIM.slug;
    }
    return fetch(url, Object.assign({}, options, { headers }));
  }

  function bubble(cls, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + cls;
    el.textContent = text;
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
    return el;
  }

  // Tapping a button sends its label as the next message — which is exactly what
  // WhatsApp does with button_reply.title, so the agent cannot tell the two apart.
  function renderChoices(choices) {
    if (!choices || !choices.length) return;
    const row = document.createElement('div');
    row.className = 'choices';
    for (const label of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        row.querySelectorAll('button').forEach(b => { b.disabled = true; });
        submit(label);
      });
      row.appendChild(btn);
    }
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
  }

  function renderReply(reply) {
    // Older turns were plain strings; new ones carry their buttons with them.
    if (typeof reply === 'string') return bubble('bot', reply);
    bubble('bot', reply.text);
    renderChoices(reply.choices);
  }

  function renderTool(call) {
    const failed = call.result && call.result.ok === false;
    const el = document.createElement('div');
    el.className = 'tool' + (failed ? ' bad' : '');
    const name = document.createElement('b');
    name.textContent = call.name;
    const body = document.createElement('pre');
    body.textContent = 'in  ' + JSON.stringify(call.input) + '\\nout ' + JSON.stringify(call.result);
    el.append(name, body);
    tools.prepend(el);
  }

  // ── attachments ────────────────────────────────────────────────────────────
  const fileEl = document.getElementById('file');
  const pendingLabel = document.getElementById('pending-file');
  const recordBtn = document.getElementById('record');
  let pendingAttachment = null;   // { kind, mime_type, data, name, blobUrl }
  let recorder = null;

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function stage(blob, name) {
    const kind = blob.type.startsWith('audio') || blob.type.startsWith('video') ? 'voice' : 'photo';
    pendingAttachment = {
      kind,
      mime_type: blob.type || (kind === 'voice' ? 'audio/webm' : 'image/jpeg'),
      data: await toBase64(blob),
      name: name || (kind === 'voice' ? 'recording.webm' : 'photo'),
      blobUrl: kind === 'photo' ? URL.createObjectURL(blob) : null
    };
    pendingLabel.textContent = (kind === 'voice' ? '🎤 ' : '🖼 ') + pendingAttachment.name;
  }

  function clearStaged() {
    pendingAttachment = null;
    pendingLabel.textContent = '';
    fileEl.value = '';
  }

  document.getElementById('attach').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => {
    if (fileEl.files[0]) stage(fileEl.files[0], fileEl.files[0].name);
  });

  // Hold the mic button to record, release to stage it — the same gesture as
  // WhatsApp, so a voice note here is as long as one in the field.
  async function startRecording() {
    if (recorder) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        recorder = null;
        recordBtn.classList.remove('recording');
        if (blob.size > 0) await stage(blob, 'recording (' + Math.round(blob.size / 1024) + ' KB)');
      };
      recorder.start();
      recordBtn.classList.add('recording');
    } catch (err) {
      bubble('err', 'Microphone unavailable: ' + err.message);
      recorder = null;
    }
  }
  function stopRecording() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }

  recordBtn.addEventListener('mousedown', startRecording);
  recordBtn.addEventListener('mouseup', stopRecording);
  recordBtn.addEventListener('mouseleave', stopRecording);
  recordBtn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); });
  recordBtn.addEventListener('touchend', e => { e.preventDefault(); stopRecording(); });

  function renderHeard(heard) {
    const el = document.createElement('div');
    el.className = 'heard' + (heard.low || heard.language_mismatch || heard.diacritics_suspect ? ' low' : '');
    const label = document.createElement('b');
    label.textContent = (heard.source === 'page'
                          ? (heard.model || 'vision model') + ' read · ' + Math.round((heard.confidence || 0) * 100) + '% of the page' +
                            (heard.unreadable ? ' · ' + heard.unreadable + ' word(s) illegible' : '') +
                            (heard.diacritics_suspect ? ' · no diacritics at all — check the spellings' : '') +
                            (heard.error ? ' · reading failed: ' + heard.error : '')
                          : 'Whisper heard · confidence ' + Math.round((heard.confidence || 0) * 100) + '%' +
                            (heard.language ? ' · detected ' + heard.language : '') +
                            (heard.language_mismatch ? ' · does not match their profile' : '')) +
                        (heard.low ? ' · flagged unreliable to the agent' : '');
    const body = document.createElement('div');
    body.textContent = heard.transcript || (heard.source === 'page' ? '(no writing found on this photo)' : '(nothing transcribable)');
    el.append(label, body);
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
  }

  document.getElementById('composer').addEventListener('submit', e => {
    e.preventDefault();
    submit();
  });

  async function submit(overrideText) {
    const text = overrideText ?? textEl.value.trim();
    const attachment = overrideText ? null : pendingAttachment;
    if (!text && !attachment) return;
    if (!overrideText) textEl.value = '';

    if (attachment) {
      const el = bubble('me', attachment.kind === 'voice' ? '🎤 ' + attachment.name : '');
      if (attachment.blobUrl) {
        const img = document.createElement('img');
        img.src = attachment.blobUrl;
        el.appendChild(img);
      }
    }
    if (text) bubble('me', text);
    clearStaged();

    sendBtn.disabled = true;
    const pending = bubble('bot', attachment && attachment.kind === 'voice' ? 'transcribing…' : '…');

    try {
      const res = await simFetch('/simulator/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneEl.value,
          text,
          attachment: attachment
            ? { kind: attachment.kind, mime_type: attachment.mime_type, data: attachment.data }
            : undefined
        })
      });
      const data = await res.json();
      pending.remove();
      if (!res.ok) { bubble('err', data.error || ('HTTP ' + res.status)); return; }
      if (data.heard) renderHeard(data.heard);
      (data.replies || []).forEach(renderReply);
      (data.tool_calls || []).forEach(renderTool);
      if (data.stopped === 'max_iterations') bubble('sys', 'Agent hit the tool-call limit for this turn.');
    } catch (err) {
      pending.remove();
      bubble('err', String(err));
    } finally {
      sendBtn.disabled = false;
      textEl.focus();
    }
  }

  // The conversation survives a refresh because it lives in the database, not in
  // this page. Reload it on open, and whenever the phone number changes.
  async function loadHistory() {
    chat.innerHTML = '';
    tools.innerHTML = '';
    try {
      const res = await simFetch('/simulator/history?phone=' + encodeURIComponent(phoneEl.value));
      if (!res.ok) return;
      const data = await res.json();
      for (const item of data.items || []) {
        if (item.kind === 'tool') renderTool({ name: item.name, input: item.input, result: '(from history)' });
        else if (item.kind === 'bot') renderReply({ text: item.text, choices: item.choices });
        else bubble(item.kind, item.text);
      }
      if ((data.items || []).length) bubble('sys', 'Earlier conversation restored.');
    } catch (err) {
      bubble('err', 'Could not load history: ' + err.message);
    }
  }

  loadHistory();
  phoneEl.addEventListener('change', loadHistory);

  document.getElementById('reset').addEventListener('click', async () => {
    await simFetch('/simulator/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneEl.value })
    });
    chat.innerHTML = '';
    tools.innerHTML = '';
    bubble('sys', 'Conversation memory cleared. Vault records were not touched.');
  });
</script>
</body>
</html>`;

module.exports = router;
// Exported for the tests: the slug→number mapping is the whole isolation
// guarantee, so it is worth asserting on directly.
module.exports.guestPhone = guestPhone;
module.exports.DEFAULT_PHONE = DEFAULT_PHONE;

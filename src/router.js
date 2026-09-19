// Meta Cloud API webhook → agent.
//
// This file used to hold a keyword state machine (`new`, `my vault`, `edit`) that
// dispatched to one of six step-driven flows. That is gone: inbound messages are
// now normalised into Claude content blocks and handed to the agent, which
// decides what to do by calling tools. Voice notes are transcribed first; photos
// are passed to the model as images.

const crypto = require('crypto');
const log = require('./utils/log');
// Service modules are held as namespaces rather than destructured so the tests
// can substitute individual functions without a mocking framework.
const whatsapp = require('./services/whatsapp');
const db = require('./services/supabase');
const inboundMedia = require('./utils/inboundMedia');
const { TtlSet } = require('./utils/ttlCache');
const { MessageAggregator } = require('./utils/aggregator');
const { turnQueue } = require('./utils/turnQueue');
const agent = require('./agent');
const { getOrCreatePractitioner, PRIVACY_NOTICE } = require('./agent/practitioner');

// Meta retries webhook deliveries that aren't acknowledged fast enough, reusing
// the same message id. The claim is durable (012) so a restart mid-retry, or a
// second instance, cannot reprocess a message — the in-memory set this replaced
// survived neither. The short in-memory set stays in front of it purely to avoid
// a database round trip on the retries that arrive within seconds of each other.
const seenMessageIds = new TtlSet(10 * 60 * 1000);

// Identifies this process in a turn lease, so a stuck lease can be traced to the
// instance that took it.
const INSTANCE_ID = `${require('os').hostname()}:${process.pid}`;

// A turn can legitimately take minutes on a local 32B. The lease has to outlast
// the slowest honest turn or two instances would both believe they hold it.
const TURN_LEASE_SECONDS = Number(process.env.AGENT_TURN_LEASE_SECONDS ?? 600);

// Buffers rapid-fire messages so the agent sees "for malaria" and the voice note
// that followed it as one turn.
const aggregator = new MessageAggregator((from, messages) => processTurn(from, messages));

// Meta Cloud API webhook verification handshake
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    log.info('webhook.verified', {});
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

// Verifies Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body keyed
// with the app secret). Without this, anyone who finds the URL can forge webhooks.
//
// Missing configuration is tolerated in development and refused in production.
// The unsigned path exists so a local run needs no Meta app at all; carried into
// production it means a forged formulation is indistinguishable from a
// practitioner's own words, and the practitioner is the one who would find out.
// A deployment that has genuinely decided to run unsigned has to say so with
// ALLOW_UNSIGNED_WEBHOOKS=true, which is a deliberate act with a name on it
// rather than an environment variable somebody forgot to set.
function verifySignature(req) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_UNSIGNED_WEBHOOKS !== 'true') {
      log.error('webhook.signature_unconfigured', {
        reason: 'META_APP_SECRET not set in production',
        effect: 'inbound webhooks are refused',
        action: 'set META_APP_SECRET, or ALLOW_UNSIGNED_WEBHOOKS=true to accept forgeable requests deliberately',
      });
      return false;
    }
    // Allow unsigned requests only when no secret is configured (local dev).
    log.warn('webhook.signature_unverified', { reason: 'META_APP_SECRET not set', action: 'set it before going live' });
    return true;
  }
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !req.rawBody) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Every message Meta batched into this delivery, flattened.
function* inboundMessages(body) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      yield* change.value?.messages ?? [];
    }
  }
}

async function handleWebhook(req, res) {
  if (!verifySignature(req)) {
    log.warn('webhook.signature_invalid', {});
    return res.sendStatus(403);
  }

  const body = req.body;
  if (body?.object !== 'whatsapp_business_account') return res.sendStatus(200);

  // Claim before acknowledging. A 200 tells Meta to stop retrying, so anything
  // sent before the claim is durable is a message this service has promised to
  // handle and has no record of — lost to a restart, or to a second instance
  // that never saw it. The claim is one indexed insert; the expensive part (the
  // agent turn) still happens after the response, which is what keeps the
  // five-second budget.
  const accepted = [];
  try {
    for (const message of inboundMessages(body)) {
      if (!message.from) continue;
      if (message.id) {
        if (seenMessageIds.has(message.id)) continue;   // retry within seconds
        // The durable claim is the one that holds across a restart or a second
        // instance. It runs before the in-memory note so a claim that throws
        // leaves nothing behind that would swallow Meta's retry.
        if (!(await db.claimMessage(message.id))) {
          log.info('webhook.duplicate_ignored', { message_id: message.id });
          continue;
        }
        seenMessageIds.add(message.id);
      }
      accepted.push(message);
    }
  } catch (err) {
    // Withhold the acknowledgement so Meta redelivers. Claims already taken in
    // this batch are released, otherwise the redelivery would be deduplicated
    // against a claim for work that never started.
    log.error('webhook.claim_failed', { error: err.message, effect: 'not acknowledged; Meta will retry' });
    await releaseClaims(accepted);
    return res.sendStatus(503);
  }

  // Acknowledge — Meta requires 200 within 5 seconds.
  res.sendStatus(200);

  for (const message of accepted) aggregator.push(message.from, message);
}

// Undo claims for messages this delivery will not process, so the retry is not
// mistaken for a duplicate. Best-effort: a release that fails leaves the message
// deduplicated, which is the pre-existing behaviour, not a new failure.
async function releaseClaims(messages) {
  for (const message of messages) {
    if (!message.id) continue;
    seenMessageIds.delete(message.id);
    try {
      await db.releaseMessageClaim(message.id);
    } catch (err) {
      log.warn('webhook.claim_release_failed', { message_id: message.id, error: err.message });
    }
  }
}

// One agent turn for one practitioner, over a batch of aggregated messages.
async function processTurn(from, messages, transport = whatsapp) {
  let practitioner;
  try {
    await db.deleteExpiredPatientInvites();
    if (await handlePatientConsent(from, messages, transport)) return;

    const resolved = await getOrCreatePractitioner(from);
    practitioner = resolved.practitioner;

    // Everything above is cheap and does not touch the model. From here the turn
    // queues: one model means one turn at a time, and a practitioner who will be
    // waiting is told rather than left with a silent chat.
    return await turnQueue.run(
      practitioner.id,
      () => runQueuedTurn({ from, messages, transport, practitioner, isNew: resolved.isNew }),
      {
        onWait: waited => {
          log.info('queue.waiting', { practitioner_id: practitioner.id, waited_ms: waited, queued: turnQueue.size });
          transport.sendTextMessage(from, 'Got it — let me look at that. One moment.').catch(() => {});
        },
      },
    );
  } catch (err) {
    log.error('agent.turn_failed', { practitioner_id: practitioner?.id ?? null, error: err.message });
    await db.logEvent({
      practitioner_id: practitioner?.id ?? null,
      event_type: 'error',
      payload: { from, step: 'agent_turn', error: err.message },
    }).catch(() => {});
    await transport.sendTextMessage(from, 'Something went wrong on our end. Please try again in a moment.');
  }
}

// The part that costs model time, run under both guards: this process's queue,
// and the cross-instance lease from 012.
async function runQueuedTurn({ from, messages, transport, practitioner, isNew }) {
  const holdsLease = await db.acquireTurnLock(practitioner.id, INSTANCE_ID, TURN_LEASE_SECONDS);
  if (!holdsLease) {
    // Another instance is mid-turn for this practitioner. Running anyway would
    // interleave tool calls on one Vault against a shared conversation history.
    log.warn('turn_lock.busy', { practitioner_id: practitioner.id });
    await transport.sendTextMessage(from, 'Still working on your last message — one moment.');
    return;
  }

  try {

    await db.logEvent({
      practitioner_id: practitioner.id,
      event_type: 'inbound_msg',
      payload: { from, types: messages.map(m => m.type), batched: messages.length },
    });

    if (isNew) {
      await transport.sendTextMessage(from, PRIVACY_NOTICE);
    } else {
      await db.updateLastActive(practitioner.id);
    }

    const content = await buildContent(messages, practitioner, transport);
    await agent.runAgent({
      practitioner,
      content,
      sourceMediaIds: content.sourceMediaIds,
      sendPatientConsent: invitation => transport.sendPatientConsentRequest(invitation),
      send: (text, choices) => (choices?.length
        ? transport.sendButtonMessage(from, text, choices)
        : transport.sendTextMessage(from, text)),
    });
  } finally {
    await db.releaseTurnLock(practitioner.id, INSTANCE_ID);
  }
}

// Patient consent replies never enter the practitioner agent. The opaque button
// id identifies one invitation, while the sender's WhatsApp number proves the
// response came back on the number that was invited.
async function handlePatientConsent(from, messages, transport = whatsapp) {
  for (const message of messages) {
    const textConsent = /^(accept|decline)\s+([A-Za-z0-9_-]{1,128})$/i.exec(extractText(message).trim());
    const buttonId = message.interactive?.button_reply?.id ?? message.button?.payload ??
      (textConsent ? `patient-consent:${textConsent[2]}:${textConsent[1].toLowerCase()}` : undefined);
    const match = /^patient-consent:([^:]+):(accept|decline)$/.exec(buttonId ?? '');
    if (!match) continue;

    const [, patientId, decision] = match;
    const patientPhone = from.startsWith('+') ? from : `+${from}`;
    const invitation = await db.getPendingPatientConsent(patientId, patientPhone);
    if (!invitation) {
      await transport.sendTextMessage(from, 'This consent request has expired or was already answered. No change was made.');
      return true;
    }

    if (decision === 'accept') {
      const accepted = await db.acceptPatientConsent(patientId, patientPhone, message.id ?? null);
      if (!accepted) {
        await transport.sendTextMessage(from, 'This consent request could not be accepted. It may have expired.');
        return true;
      }
      await db.logEvent({
        practitioner_id: invitation.practitioner_id,
        event_type: 'patient_consent_accepted',
        payload: { short_code: invitation.short_code, method: 'whatsapp' },
      });
      await transport.sendTextMessage(from, 'Thank you. You accepted treatment tracking with Sanko. You can ask to stop tracking or delete your patient record at any time.');
      if (invitation.practitioners?.phone_number) {
        await transport.sendTextMessage(
          invitation.practitioners.phone_number,
          `${invitation.display_name} accepted patient tracking. You can now record treatment under ${invitation.short_code}.`
        );
      }
      return true;
    }

    await db.declinePatientConsent(patientId, patientPhone);
    await db.logEvent({
      practitioner_id: invitation.practitioner_id,
      event_type: 'patient_consent_declined',
      payload: { short_code: invitation.short_code },
    });
    await transport.sendTextMessage(from, 'You declined. Sanko deleted the pending invitation and will not track your treatment.');
    if (invitation.practitioners?.phone_number) {
      await transport.sendTextMessage(
        invitation.practitioners.phone_number,
        `${invitation.display_name} declined patient tracking. No patient record was retained.`
      );
    }
    return true;
  }
  return false;
}

// ─── inbound message → Claude content blocks ──────────────────────────────────

async function buildContent(messages, practitioner, transport = whatsapp) {
  const blocks = [];
  const sourceMediaIds = [];

  for (const message of messages) {
    switch (message.type) {
      case 'text':
      case 'interactive': {
        const text = extractText(message).trim();
        if (text) blocks.push({ type: 'text', text });
        break;
      }
      case 'audio':
        {
          const archived = await _audioBlocks(message, practitioner, transport);
          blocks.push(...archived.blocks);
          sourceMediaIds.push(archived.mediaId);
        }
        break;
      case 'image':
        {
          const archived = await _imageBlocks(message, practitioner, transport);
          blocks.push(...archived.blocks);
          sourceMediaIds.push(archived.mediaId);
        }
        break;
      default:
        blocks.push({ type: 'text', text: `[the practitioner sent a ${message.type} message, which Sanko cannot read]` });
    }
  }

  if (blocks.length === 0) blocks.push({ type: 'text', text: '[empty message]' });
  // Keep transport metadata out of both the model content and persisted chat
  // JSON while retaining the long-standing array return shape.
  Object.defineProperty(blocks, 'sourceMediaIds', { value: sourceMediaIds, enumerable: false });
  return blocks;
}

// Meta hands out media ids, not bytes. Download, then hand the bytes to the
// shared builder the simulator also uses.
async function _audioBlocks(message, practitioner, transport) {
  const { buffer, mimeType } = await transport.downloadMedia(message.audio.id);
  return inboundMedia.audioBlocks(buffer, mimeType, practitioner);
}

async function _imageBlocks(message, practitioner, transport) {
  const { buffer, mimeType } = await transport.downloadMedia(message.image.id);
  return inboundMedia.imageBlocks(buffer, mimeType, practitioner, message.image?.caption);
}

function extractText(message) {
  if (message.type === 'text') return message.text?.body ?? '';
  if (message.type === 'interactive') {
    return message.interactive?.button_reply?.title ??
           message.interactive?.list_reply?.title ?? '';
  }
  if (message.type === 'button') return message.button?.text ?? '';
  return '';
}

module.exports = { verifyWebhook, handleWebhook, extractText, verifySignature, buildContent, processTurn, handlePatientConsent, aggregator };

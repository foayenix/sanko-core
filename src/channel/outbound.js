'use strict';

// Durable outbound messages: opted-in check-in notices and requested report
// documents. An intent is stored before any provider call; the claim rechecks
// suppression, binding, consent, ownership, session and release state at the
// moment of sending; and the outcome records only what is known:
//   accepted  — Meta returned a message id (not "delivered", not "read")
//   failed    — refused or never sent; retried with backoff, at most 3 times
//   ambiguous — may or may not have been accepted; never retried automatically
// Delivery and read receipts arrive later as status callbacks. Neither is
// evidence that anyone reviewed or understood anything.

const crypto = require('node:crypto');
const store = require('./store');
const config = require('./config');
const log = require('../utils/log');
const whatsapp = require('../services/whatsapp');

const NOTICE =
  'Sanko: there is a new message waiting for you. Reply MENU to open it privately. ' +
  'Send STOP to stop optional messages to this number.';
const DOCUMENT_CAPTION =
  'Sanko private evidence report (released version). You can keep or forward this copy; ' +
  'it cannot be recalled. ' +
  'Check its current status in Sanko before relying on it.';

const rpc = (name, args) => store.rpc(name, args);

async function sendNotice(transport, item) {
  if (transport.deliverText) return transport.deliverText(item.address, NOTICE);
  // Test and Baileys transports report only success or failure.
  return (await transport.sendTextMessage(item.address, NOTICE)) === false
    ? { status: 'failed', error: 'transport_refused' }
    : { status: 'accepted', providerId: null };
}

async function sendDocument(transport, item) {
  if (!transport.sendDocument) return { status: 'failed', error: 'transport_unsupported' };
  const artifact = await rpc('channel_outbound_artifact', { p_outbound: item.id });
  const buffer = Buffer.from(artifact.base64, 'base64');
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== artifact.sha256)
    return { status: 'failed', error: 'artifact_integrity' };
  return transport.sendDocument(item.address, {
    buffer,
    filename: artifact.filename,
    mimeType: 'application/pdf',
    caption: DOCUMENT_CAPTION,
  });
}

// One dispatcher pass. `only` restricts the claim to one intent (used when a
// person has just asked for a document and is waiting in the chat).
async function dispatch({ transport = whatsapp, limit = 20, only = null } = {}) {
  const flags = config.configuration();
  if (!flags.guided) return [];
  if (flags.careNotices && !only) await rpc('channel_enqueue_check_ins', { p_limit: 100 });
  const claimed = await rpc('channel_outbound_claim', {
    p_limit: limit,
    p_lease_seconds: 120,
    p_only: only,
  });
  const results = [];
  for (const item of claimed) {
    let outcome;
    try {
      if (item.purpose === 'evidence_document' && !flags.evidenceDelivery)
        outcome = { status: 'failed', error: 'delivery_disabled' };
      else
        outcome =
          item.purpose === 'care_check_in'
            ? await sendNotice(transport, item)
            : await sendDocument(transport, item);
    } catch (err) {
      // A thrown send may or may not have reached the provider.
      outcome = { status: 'ambiguous', error: err.message };
    }
    await rpc('channel_outbound_result', {
      p_outbound: item.id,
      p_status: outcome.status,
      p_provider_id: outcome.providerId ?? null,
      p_error: outcome.error ?? null,
      p_media_id: outcome.mediaId ?? null,
    });
    if (outcome.status !== 'accepted')
      log.warn('channel.outbound_not_accepted', {
        id: item.id,
        purpose: item.purpose,
        status: outcome.status,
      });
    results.push({ id: item.id, purpose: item.purpose, status: outcome.status });
  }
  if (!only) await cleanupMedia(transport);
  return results;
}

// Provider media for a document is deleted once delivery has settled.
async function cleanupMedia(transport) {
  if (!transport.deleteMedia) return;
  const due = await rpc('channel_media_cleanup_due', { p_limit: 20 });
  for (const item of due) {
    const ok = await transport.deleteMedia(item.media_id).catch(() => false);
    await rpc('channel_outbound_media_cleanup', { p_outbound: item.id, p_ok: Boolean(ok) });
    if (!ok) log.warn('channel.media_cleanup_failed', { id: item.id });
  }
}

// Meta status callbacks (sent, delivered, read, failed). Durable before the
// webhook is acknowledged, like inbound claims.
async function recordStatuses(body) {
  let count = 0;
  for (const entry of body?.entry ?? [])
    for (const change of entry.changes ?? [])
      for (const status of change.value?.statuses ?? []) {
        if (!status?.id || !status.status) continue;
        const at = Number(status.timestamp);
        await rpc('channel_delivery_status', {
          p_provider_id: String(status.id),
          p_status: String(status.status),
          p_at: Number.isFinite(at) ? new Date(at * 1000).toISOString() : null,
        });
        count++;
      }
  return count;
}

async function maintenance() {
  return rpc('channel_maintenance', {});
}

module.exports = { dispatch, recordStatuses, maintenance, cleanupMedia, NOTICE, DOCUMENT_CAPTION };

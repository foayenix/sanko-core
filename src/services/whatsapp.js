const axios = require('axios');
const log = require('../utils/log');

const BASE_URL = 'https://graph.facebook.com/v19.0';

async function sendTextMessage(to, text) {
  return _send(to, { type: 'text', text: { body: text, preview_url: false } });
}

async function sendButtonMessage(to, body, buttons) {
  return _send(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((b, i) => ({
          type: 'reply',
          reply: typeof b === 'string' ? { id: `btn_${i}`, title: b } : { id: b.id, title: b.title },
        })),
      },
    },
  });
}

// A selectable list for menus longer than three choices. One section; rows are
// { id, title, description? }. The limits applied in src/channel/ui.js (ten
// rows, 24-character titles, 72-character descriptions, 20-character button)
// are the commonly documented ones and must be re-verified against Meta's
// current reference before live use.
async function sendListMessage(to, body, buttonLabel, rows) {
  return _send(to, listPayload(body, buttonLabel, rows));
}

function listPayload(body, buttonLabel, rows) {
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonLabel,
        sections: [{ title: 'Options', rows: rows.map(r => ({ id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}) })) }],
      },
    },
  };
}

// Sends and reports what is actually known about provider acceptance:
//   accepted  — Meta returned a message id
//   failed    — Meta refused it, or it never left (safe to retry later)
//   ambiguous — the request may have been processed but no answer came back
//               (timeout, dropped connection, 5xx); must not be blindly retried
async function deliverText(to, body) {
  return _tracked(to, { type: 'text', text: { body, preview_url: false } });
}

// Uploads the bytes as private media, then sends them as a document. The
// media id is returned so it can be deleted once delivery has settled.
async function sendDocument(to, { buffer, filename, mimeType = 'application/pdf', caption }) {
  let mediaId;
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', buffer, { filename, contentType: mimeType });
    const { data } = await axios.post(`${BASE_URL}/${process.env.META_PHONE_NUMBER_ID}/media`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
      timeout: 30000,
      maxBodyLength: 20 * 1024 * 1024,
    });
    mediaId = data?.id;
  } catch (err) {
    log.error('whatsapp.media_upload_failed', { status: err.response?.status ?? null, error: err.message });
    // Nothing was sent; an upload that may have succeeded is harmless orphaned
    // media, not a duplicate message.
    return { status: 'failed', error: 'media_upload_failed' };
  }
  if (!mediaId) return { status: 'failed', error: 'media_upload_failed' };
  const result = await _tracked(to, { type: 'document', document: { id: mediaId, filename, ...(caption ? { caption } : {}) } });
  return { ...result, mediaId };
}

async function deleteMedia(mediaId) {
  try {
    await axios.delete(`${BASE_URL}/${mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
      timeout: 15000,
    });
    return true;
  } catch (err) {
    log.warn('whatsapp.media_delete_failed', { status: err.response?.status ?? null });
    return false;
  }
}

async function _tracked(to, messagePayload) {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/${process.env.META_PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...messagePayload },
      { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const providerId = data?.messages?.[0]?.id ?? null;
    return providerId ? { status: 'accepted', providerId } : { status: 'ambiguous', error: 'no_message_id' };
  } catch (err) {
    const status = err.response?.status;
    log.error('whatsapp.tracked_send_failed', { status: status ?? null, error: err.message });
    if (status === undefined && err.request) return { status: 'ambiguous', error: 'no_response' };
    if (status === undefined || (status >= 400 && status < 500)) return { status: 'failed', error: `http_${status ?? 'none'}` };
    return { status: 'ambiguous', error: `http_${status}` };
  }
}

async function sendPatientConsentRequest({ patient_id, patient_phone, patient_name, practitioner_name }) {
  const templateName = process.env.WHATSAPP_PATIENT_CONSENT_TEMPLATE || 'sanko_patient_consent_v1';
  const languageCode = process.env.WHATSAPP_PATIENT_CONSENT_LANGUAGE || 'en';
  return _send(patient_phone, patientConsentTemplate({
    patient_id, patient_name, practitioner_name, templateName, languageCode,
  }));
}

function patientConsentTemplate({ patient_id, patient_name, practitioner_name, templateName, languageCode }) {
  return {
    // This is business-initiated because the patient has not messaged Sanko.
    // Meta therefore requires an approved template. Body variables: patient
    // name, practitioner name. Quick replies: Accept, Decline.
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: patient_name },
            { type: 'text', text: practitioner_name },
          ],
        },
        {
          type: 'button', sub_type: 'quick_reply', index: '0',
          parameters: [{ type: 'payload', payload: `patient-consent:${patient_id}:accept` }],
        },
        {
          type: 'button', sub_type: 'quick_reply', index: '1',
          parameters: [{ type: 'payload', payload: `patient-consent:${patient_id}:decline` }],
        },
      ],
    },
  };
}

async function downloadMedia(mediaId) {
  const { data: meta } = await axios.get(`${BASE_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
  });
  const response = await axios.get(meta.url, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
  });
  return { buffer: Buffer.from(response.data), mimeType: meta.mime_type };
}

// Sends a message with one retry on transient failures (network, 429, 5xx).
// Permanent failures are logged to the events table so they surface in the
// admin flagged view rather than disappearing into stdout.
async function _send(to, messagePayload) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await axios.post(
        `${BASE_URL}/${process.env.META_PHONE_NUMBER_ID}/messages`,
        { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...messagePayload },
        { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      return true;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (retryable && attempt === 0) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      break;
    }
  }

  const detail = lastErr.response?.data?.error?.message ?? lastErr.message;
  log.error('whatsapp.send_failed', { status: lastErr.response?.status ?? null, error: lastErr.message });
  // Lazy require avoids any import-order surprises between service modules
  const { logEvent } = require('./supabase');
  logEvent({
    practitioner_id: null,
    event_type: 'error',
    payload: { step: 'whatsapp_send', to, error: detail },
  }).catch(() => {});
  return false;
}

module.exports = {
  sendTextMessage, sendButtonMessage, sendListMessage, listPayload, deliverText, sendDocument, deleteMedia,
  sendPatientConsentRequest, patientConsentTemplate, downloadMedia,
};

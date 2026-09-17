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
          reply: { id: `btn_${i}`, title: b },
        })),
      },
    },
  });
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

module.exports = { sendTextMessage, sendButtonMessage, sendPatientConsentRequest, patientConsentTemplate, downloadMedia };

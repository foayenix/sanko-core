/* global document */
'use strict';
// Served only by the disposable loopback preview, never by the application.
const channelForm = document.querySelector('form');
const channelReply = document.getElementById('channel-reply');
channelForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = channelForm.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  channelReply.textContent = 'Sending fictional message…';
  try {
    const response = await fetch('/whatsapp', { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams(new FormData(channelForm)) });
    if (!response.ok) throw new Error('Could not complete this fictional message. Please retry.');
    const result = await response.json();
    channelReply.textContent = result.reply;
    document.getElementById('care-link').href = result.href;
  } catch {
    channelReply.textContent = 'Could not complete this fictional message. Please retry.';
  } finally { button.disabled = false; }
});

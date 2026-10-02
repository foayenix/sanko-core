/* global document, window */
'use strict';
// Served only by the disposable loopback preview (scripts/preview-channel.js).
const $ = id => document.getElementById(id);
let phone = null;

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('This fictional message could not be processed.');
  return response.json();
}

function render(messages) {
  const chat = $('chat');
  chat.replaceChildren();
  messages.forEach((m, index) => {
    const bubble = el('div', null, `bubble ${m.from}`);
    if (m.type === 'document') {
      const link = el('a', `📄 ${m.filename} (${Math.round(m.bytes / 1024)} KB)`);
      link.href = m.href;
      link.target = '_blank';
      bubble.append(link, el('p', m.caption, 'caption'));
    } else bubble.append(el('p', m.body));
    // Only the newest interactive message is shown as live choices; older
    // ones stay tappable so stale taps can be exercised.
    if (m.options) {
      const list = el('div', null, m.type === 'list' ? 'rows' : 'buttons');
      for (const option of m.options) {
        const b = el('button', option.title, index === messages.length - 1 ? 'live' : 'old');
        b.type = 'button';
        if (option.description) b.title = option.description;
        b.onclick = () => send({ tap: { id: option.id, title: option.title } });
        list.append(b);
      }
      bubble.append(list);
    }
    chat.append(bubble);
  });
  chat.scrollTop = chat.scrollHeight;
}

async function load() {
  const response = await fetch(`/whatsapp/api/chat?phone=${encodeURIComponent(phone)}`);
  render(await response.json());
}

async function send(body) {
  try {
    render(await post('/whatsapp/api/send', { phone, ...body }));
  } catch (error) {
    window.alert(error.message);
  }
}

$('composer').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('message').value.trim();
  if (!text) return;
  $('message').value = '';
  send({ text });
});

$('worker').addEventListener('click', async () => {
  const results = await post('/whatsapp/api/worker', {});
  await load();
  $('worker').textContent = `Run scheduled work (${results.length} sent)`;
});

(async () => {
  const phones = await (await fetch('/whatsapp/api/phones')).json();
  for (const [number, info] of Object.entries(phones)) {
    const b = el('button', info.label);
    b.type = 'button';
    b.onclick = async () => {
      phone = number;
      for (const other of $('phones').children) other.classList.toggle('active', other === b);
      await load();
    };
    $('phones').append(b);
  }
  $('phones').firstElementChild.click();
})();

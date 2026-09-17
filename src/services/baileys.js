const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { MessageAggregator } = require('../utils/aggregator');
const { processTurn } = require('../router');

const DEFAULT_AUTH_DIR = '.baileys-auth';
const MAX_CACHED_MEDIA = 200;

function normalizePhoneNumber(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

function parseAllowedNumbers(value = process.env.BAILEYS_ALLOWED_NUMBERS) {
  const entries = String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
  if (entries.includes('*')) return null;
  return new Set(entries.map(normalizePhoneNumber).filter(Boolean));
}

function phoneFromJid(jid, baileys) {
  if (!baileys.isPnUser(jid)) return null;
  return normalizePhoneNumber(baileys.jidDecode(jid)?.user);
}

function extractInteractive(content) {
  const button = content.buttonsResponseMessage;
  if (button) {
    return { id: button.selectedButtonId ?? '', title: button.selectedDisplayText ?? button.selectedButtonId ?? '' };
  }

  const template = content.templateButtonReplyMessage;
  if (template) {
    return { id: template.selectedId ?? '', title: template.selectedDisplayText ?? template.selectedId ?? '' };
  }

  const list = content.listResponseMessage;
  if (list) {
    return { id: list.singleSelectReply?.selectedRowId ?? '', title: list.title ?? list.singleSelectReply?.selectedRowId ?? '' };
  }

  const native = content.interactiveResponseMessage?.nativeFlowResponseMessage;
  if (!native) return null;
  try {
    const params = JSON.parse(native.paramsJson ?? '{}');
    return { id: params.id ?? params.row_id ?? '', title: params.title ?? params.id ?? params.row_id ?? '' };
  } catch {
    return null;
  }
}

function adaptBaileysMessage(raw, baileys) {
  const remoteJid = raw.key?.remoteJid;
  if (!remoteJid || raw.key?.fromMe || baileys.isJidGroup(remoteJid) ||
      baileys.isJidBroadcast(remoteJid) || baileys.isJidNewsletter(remoteJid)) return null;

  const phoneJid = [raw.key?.remoteJidAlt, remoteJid].find(jid => baileys.isPnUser(jid));
  const from = phoneFromJid(phoneJid, baileys);
  if (!from) return null;

  const content = baileys.normalizeMessageContent(raw.message);
  if (!content) return null;
  const id = raw.key?.id;

  const body = content.conversation ?? content.extendedTextMessage?.text;
  if (body != null) {
    return { from, jid: remoteJid, message: { id, type: 'text', text: { body } } };
  }

  if (content.audioMessage) {
    return { from, jid: remoteJid, message: { id, type: 'audio', audio: { id } }, media: raw };
  }

  if (content.imageMessage) {
    return {
      from,
      jid: remoteJid,
      message: { id, type: 'image', image: { id, caption: content.imageMessage.caption ?? '' } },
      media: raw,
    };
  }

  const interactive = extractInteractive(content);
  if (interactive) {
    return {
      from,
      jid: remoteJid,
      message: { id, type: 'interactive', interactive: { button_reply: interactive } },
    };
  }

  const type = baileys.getContentType(content)?.replace(/Message$/, '') ?? 'unsupported';
  return { from, jid: remoteJid, message: { id, type } };
}

class BaileysTransport {
  constructor({ baileys, allowedNumbers, output = console }) {
    this.baileys = baileys;
    this.allowedNumbers = allowedNumbers;
    this.output = output;
    this.socket = null;
    this.jidsByPhone = new Map();
    this.mediaById = new Map();
    this.blockedLogged = new Set();
  }

  setSocket(socket) {
    this.socket = socket;
  }

  isAllowed(phone) {
    return this.allowedNumbers === null || this.allowedNumbers.has(normalizePhoneNumber(phone));
  }

  // A number missing from the allowlist is the most likely thing to go wrong in a
  // first test, and dropping it silently is indistinguishable from the adapter
  // being offline, the model hanging, or WhatsApp not delivering. Say so — once
  // per number, since the sender will usually try again a few times — and print
  // the number in the exact form the allowlist expects, so the fix is a copy-paste.
  noteBlocked(phone) {
    const normalized = normalizePhoneNumber(phone) ?? String(phone);
    if (this.blockedLogged.has(normalized)) return;
    this.blockedLogged.add(normalized);
    this.output.warn(
      `Baileys ignored a message from ${normalized} — not in BAILEYS_ALLOWED_NUMBERS. ` +
      `Add it to .env and restart:  BAILEYS_ALLOWED_NUMBERS=${normalized}`,
    );
  }

  remember({ from, jid, media, message }) {
    this.jidsByPhone.set(from, jid);
    if (media && message.id) {
      this.mediaById.set(message.id, media);
      while (this.mediaById.size > MAX_CACHED_MEDIA) {
        this.mediaById.delete(this.mediaById.keys().next().value);
      }
    }
  }

  jidFor(phone) {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized || !this.isAllowed(normalized)) {
      throw new Error(`Baileys blocked a message to non-allowlisted number: ${phone}`);
    }
    return this.jidsByPhone.get(normalized) ?? `${normalized.slice(1)}@s.whatsapp.net`;
  }

  async sendTextMessage(to, text) {
    await this.socket.sendMessage(this.jidFor(to), { text });
    return true;
  }

  async sendButtonMessage(to, body, buttons) {
    const choices = buttons.map((button, index) => `${index + 1}. ${button}`).join('\n');
    return this.sendTextMessage(to, `${body}\n\n${choices}`);
  }

  async sendPatientConsentRequest({ patient_id, patient_phone, patient_name, practitioner_name }) {
    return this.sendTextMessage(
      patient_phone,
      `Hello ${patient_name}. ${practitioner_name} would like to use Sanko to keep a private record of your treatment and follow-up. You can accept or decline.\n\nReply exactly with:\nACCEPT ${patient_id}\n\nor:\nDECLINE ${patient_id}`,
    );
  }

  async downloadMedia(mediaId) {
    const raw = this.mediaById.get(mediaId);
    if (!raw) throw new Error(`Baileys media ${mediaId} is no longer available`);
    const content = this.baileys.normalizeMessageContent(raw.message);
    const media = content?.audioMessage ?? content?.imageMessage;
    const buffer = await this.baileys.downloadMediaMessage(raw, 'buffer', {});
    return { buffer, mimeType: media?.mimetype ?? (content?.audioMessage ? 'audio/ogg' : 'image/jpeg') };
  }
}

// WhatsApp allows one live connection per companion session, so two adapters
// sharing an auth directory do not merely duplicate work — they evict each other
// in a loop, forever, and both keep writing the session keys. The visible symptom
// is the opposite of a crash: "Baileys connected" scrolling past while inbound
// messages land in whichever socket is mid-eviction and are never processed.
//
// The second process is usually an earlier run whose terminal was closed without
// the node child dying, which is invisible in a terminal and very expensive to
// diagnose from the WhatsApp side. Refuse to be the second one.
function acquireAuthLock(authPath, output) {
  const lockPath = path.join(authPath, '.adapter.lock');
  fs.mkdirSync(authPath, { recursive: true });

  const existing = Number(readPidOrNull(lockPath));
  if (existing && existing !== process.pid && isProcessAlive(existing)) {
    throw new Error(
      `Another Sanko WhatsApp adapter (pid ${existing}) is already using ${authPath}.\n` +
      `Running two against one WhatsApp account makes them evict each other in a loop ` +
      `and silently drop inbound messages.\n` +
      `Stop it first:  kill ${existing}`,
    );
  }
  if (existing) {
    output.warn(`Clearing a stale adapter lock from pid ${existing}, which is no longer running.`);
  }

  fs.writeFileSync(lockPath, String(process.pid));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Only ever remove our own lock: a crash-and-restart race could otherwise
    // delete the lock belonging to the process that legitimately replaced us.
    try {
      if (Number(readPidOrNull(lockPath)) === process.pid) fs.unlinkSync(lockPath);
    } catch { /* already gone */ }
  };
  process.once('exit', release);
  return release;
}

function readPidOrNull(lockPath) {
  try {
    return fs.readFileSync(lockPath, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to another user — still alive.
    return error.code === 'EPERM';
  }
}

async function startBaileys({
  authDir = process.env.BAILEYS_AUTH_DIR || DEFAULT_AUTH_DIR,
  allowedNumbers = parseAllowedNumbers(),
  output = console,
} = {}) {
  if (allowedNumbers?.size === 0) {
    throw new Error('BAILEYS_ALLOWED_NUMBERS is required. Set it to your test phone in E.164 format, for example +447700900123.');
  }

  const baileys = await import('@whiskeysockets/baileys');
  const authPath = path.resolve(authDir);
  const releaseLock = acquireAuthLock(authPath, output);
  const { state, saveCreds } = await baileys.useMultiFileAuthState(authPath);
  const transport = new BaileysTransport({ baileys, allowedNumbers, output });
  const aggregator = new MessageAggregator(
    (from, messages) => processTurn(from, messages, transport),
  );

  let socket;
  let reconnectTimer;
  let stopped = false;

  const connect = () => {
    socket = baileys.default({
      auth: state,
      browser: baileys.Browsers.macOS('Sanko Vault'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    transport.setSocket(socket);
    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('messages.upsert', async event => {
      if (event.type !== 'notify') return;
      for (const raw of event.messages) {
        try {
          const inbound = adaptBaileysMessage(raw, baileys);
          if (!inbound) continue;
          if (!transport.isAllowed(inbound.from)) {
            transport.noteBlocked(inbound.from);
            continue;
          }
          transport.remember(inbound);
          aggregator.push(inbound.from, inbound.message);
        } catch (error) {
          output.error('Baileys inbound message failed:', error);
        }
      }
    });

    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        output.log('\nScan this QR in WhatsApp → Settings → Linked devices → Link a device:\n');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        output.log(`Baileys connected. Listening only to: ${allowedNumbers === null ? 'all direct chats' : [...allowedNumbers].join(', ')}`);
      }
      if (connection !== 'close' || stopped) return;

      // Baileys reports disconnects as Boom errors. Do not wrap the error in a
      // new Boom here: doing so would replace useful codes such as loggedOut
      // and restartRequired with a generic 500.
      const status = lastDisconnect?.error?.output?.statusCode ?? 500;
      if (status === baileys.DisconnectReason.loggedOut) {
        output.error(`Baileys was logged out. Delete ${authPath} and run npm run whatsapp:test to link it again.`);
        return;
      }
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, status === baileys.DisconnectReason.restartRequired ? 0 : 3000);
    });
  };

  connect();
  return {
    authPath,
    aggregator,
    transport,
    async stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      await aggregator.flushAll();
      socket?.end(new Error('Sanko Baileys adapter stopped'));
      releaseLock();
    },
  };
}

module.exports = {
  BaileysTransport,
  acquireAuthLock,
  adaptBaileysMessage,
  normalizePhoneNumber,
  parseAllowedNumbers,
  startBaileys,
};

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const log = require('../utils/log');
const db = require('../services/supabase');
const { MessageAggregator } = require('../utils/aggregator');
const { processTurn } = require('../router');

const DEFAULT_AUTH_DIR = '.baileys-auth';
const MAX_CACHED_MEDIA = 200;

// The transport this adapter's claims are filed under (019). The Meta webhook
// and this process share one database and one table, and neither can replay the
// other's messages: a wamid means nothing to a linked phone, and a Baileys id
// means nothing to Meta's API. The column is what keeps each sweep to its own.
const TRANSPORT = 'baileys';

// Claim ids are namespaced by transport. A Baileys message id is unique to the
// chat it arrived in rather than globally, so it is the one id in the system
// that could in principle collide with another — and the table it lands in is
// keyed on exactly that.
const claimIdFor = messageId => `${TRANSPORT}:${messageId}`;

// A restart empties the media cache, and a recovered voice note is a reference
// to bytes this process never saw. Say so rather than running the turn on a
// message whose content cannot be read: the practitioner is told their
// formulation did not go through, which they can act on, instead of getting a
// reply that quietly leaves out what they actually said.
const MEDIA_TYPES = new Set(['audio', 'image']);

// Closes the claims for one finished turn. Reached whether the turn succeeded or
// failed in a way the practitioner was told about; anything that escapes
// processTurn leaves the claims open for the sweep, which is the point.
async function completeClaims(messages) {
  for (const message of messages) {
    if (message.id) await db.completeMessage(claimIdFor(message.id));
  }
}

// Re-enqueues messages this adapter accepted and never answered.
//
// Baileys has no delivery receipt to withhold — by the time the socket hands a
// message over, WhatsApp considers it delivered — so a process dying mid-turn is
// the whole of the failure. Nothing upstream will ever mention that message
// again, which is why the claim has to carry it.
//
// Takes its transport and aggregator rather than reaching for them, so the
// behaviour can be exercised without a socket to WhatsApp.
async function recoverInbound({ transport, aggregator, ...options } = {}) {
  const { pending, abandoned } = await db.recoverPendingMessages({
    transport: TRANSPORT,
    olderThanSeconds: Number(process.env.INBOUND_RECOVERY_AFTER_SECONDS ?? 900),
    maxAttempts: Number(process.env.INBOUND_RECOVERY_MAX_ATTEMPTS ?? 3),
    ...options,
  });

  for (const row of abandoned) {
    log.error('baileys.recovery_abandoned', {
      message_id: row.message_id,
      attempts: row.attempts,
      effect: 'this message will never be answered; the practitioner was not told',
    });
  }

  let requeued = 0;
  let unreadable = 0;
  for (const row of pending) {
    const { from, message } = row.payload ?? {};
    if (!from || !message) {
      log.warn('baileys.recovery_unroutable', { message_id: row.message_id });
      await db.completeMessage(row.message_id);
      continue;
    }

    // The one thing this adapter cannot replay. The media cache is in memory, so
    // a restart leaves the envelope without its bytes, and running the turn
    // anyway would answer a voice note nobody could listen to — the practitioner
    // would get a reply that quietly omitted what they actually said. Tell them
    // instead: "send it again" is something they can act on.
    if (MEDIA_TYPES.has(message.type) && !transport.hasMedia(message.id)) {
      log.warn('baileys.recovery_media_lost', { message_id: row.message_id, type: message.type });
      await transport.sendTextMessage(
        from,
        'Sorry — the service restarted before I could listen to your last message, and I no longer have it. Please send it again.',
      ).catch(error => log.warn('baileys.recovery_notice_failed', { error: error.message }));
      await db.completeMessage(row.message_id);
      unreadable++;
      continue;
    }

    log.info('baileys.recovered', { message_id: row.message_id, attempt: row.attempts + 1 });
    aggregator.push(from, message);
    requeued++;
  }

  return { recovered: requeued, unreadable, abandoned: abandoned.length };
}

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

  hasMedia(mediaId) {
    return this.mediaById.has(mediaId);
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

  // Same contract as the webhook (019): the claim is closed once the turn is
  // over, and anything that escapes processTurn leaves it open for the sweep.
  const aggregator = new MessageAggregator(async (from, messages) => {
    await processTurn(from, messages, transport);
    await completeClaims(messages);
  });

  let socket;
  let reconnectTimer;
  let stopped = false;

  function sweep() {
    if (stopped) return;
    recoverInbound({ transport, aggregator })
      .then(({ recovered, unreadable, abandoned }) => {
        if (recovered || unreadable || abandoned) {
          log.info('baileys.recovery_swept', { recovered, unreadable, abandoned });
        }
      })
      .catch(error => log.warn('baileys.recovery_failed', { error: error.message }));
  }

  // The interval covers a process that stays up but had a turn die under it; the
  // connect handler covers the restart, which is the common case.
  const recoveryTimer = setInterval(sweep, Number(process.env.INBOUND_RECOVERY_INTERVAL_MS ?? 5 * 60 * 1000));
  recoveryTimer.unref();

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

          // Claim before the turn (019), carrying enough to route the message
          // again: the phone number and the adapted envelope, which is the same
          // shape the webhook stores. remember() runs first so that a message
          // recovered within the life of this process still finds its media.
          if (inbound.message.id) {
            const claimed = await db.claimMessage(claimIdFor(inbound.message.id), TRANSPORT, {
              payload: { from: inbound.from, jid: inbound.jid, message: inbound.message },
            });
            if (!claimed) {
              // WhatsApp replays on reconnect, and this adapter used to answer
              // every replay as though it were new.
              log.info('baileys.duplicate_ignored', { message_id: inbound.message.id });
              continue;
            }
          }

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
        // Only once a socket exists: recovery may need to tell somebody their
        // voice note has to be sent again, and that needs a way to reach them.
        sweep();
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
    recoverInbound: options => recoverInbound({ transport, aggregator, ...options }),
    async stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      clearInterval(recoveryTimer);
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
  claimIdFor,
  completeClaims,
  normalizePhoneNumber,
  recoverInbound,
  parseAllowedNumbers,
  startBaileys,
  TRANSPORT,
};

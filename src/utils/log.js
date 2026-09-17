'use strict';

// Structured logging, and the one place an error becomes something you find out
// about rather than something you discover later from a practitioner.
//
// Everything used to be console.error. That is fine while you are watching the
// terminal and useless the moment you are not: a failed turn looked exactly like
// a quiet minute. Lines here are JSON so they can be grepped, shipped and
// counted, and error-level lines additionally fire an alert.
//
// ── what must never appear in a log line ──
// Practitioner speech, transcripts, patient names, phone numbers, plant lists.
// Log the ids and the shape, not the content: `{ practitioner_id, chars: 213 }`
// tells you what you need at 2am, and a log file that leaks the archive is worse
// than no log file. redact() below is a backstop, not a licence to pass secrets.

const { env, envBool, envNumber } = require('./env');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[env('LOG_LEVEL', 'info').toLowerCase()] ?? LEVELS.info;

// Pretty output is for a human at a terminal; JSON is for anything that stores
// or searches logs. Default to JSON in production and pretty elsewhere, because
// the failure mode of guessing wrong in production is unsearchable logs.
const PRETTY = envBool('LOG_PRETTY', env('NODE_ENV') !== 'production');

// Fields whose values are redacted wherever they appear.
const SECRET_KEYS = /^(password|token|key|secret|authorization|apikey|api_key|service_role|transcript|original_text|text|body|message|display_name|phone_number)$/i;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SECRET_KEYS.test(key) ? '[redacted]' : redact(child, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…[${value.length}]`;
  return value;
}

function write(level, event, context = {}) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const line = { ts: new Date().toISOString(), level, event, ...redact(context) };

  if (PRETTY) {
    const { ts, level: _l, event: _e, ...rest } = line;
    const detail = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    const stream = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    stream(`${ts.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${event}${detail}`);
  } else {
    (level === 'error' ? console.error : console.log)(JSON.stringify(line));
  }

  if (level === 'error') alert(line).catch(() => { /* alerting must never throw into a request */ });
}

// ─── alerting ─────────────────────────────────────────────────────────────────

// A generic JSON webhook rather than a vendor SDK: Slack, Discord, ntfy and a
// self-hosted endpoint all accept one, and nothing about the sovereignty posture
// survives adding a telemetry vendor that would receive these.
const ALERT_URL = env('ALERT_WEBHOOK_URL');
const ALERT_WINDOW_MS = envNumber('ALERT_WINDOW_MS', 15 * 60 * 1000);
const ALERT_MAX_PER_WINDOW = envNumber('ALERT_MAX_PER_WINDOW', 12);

// One broken dependency produces one failure per inbound message. Unthrottled,
// the first outage would send a thousand alerts and every later one would be
// ignored — so collapse repeats of the same event and cap the window.
const recentAlerts = new Map();
let windowStartedAt = 0;
let windowCount = 0;
let suppressed = 0;

function shouldSend(event, now) {
  if (now - windowStartedAt > ALERT_WINDOW_MS) {
    windowStartedAt = now;
    windowCount = 0;
    suppressed = 0;
    recentAlerts.clear();
  }
  const lastSeen = recentAlerts.get(event);
  if (lastSeen && now - lastSeen < ALERT_WINDOW_MS) { suppressed++; return false; }
  if (windowCount >= ALERT_MAX_PER_WINDOW) { suppressed++; return false; }

  recentAlerts.set(event, now);
  windowCount++;
  return true;
}

async function alert(line) {
  if (!ALERT_URL) return;
  const now = Date.now();
  if (!shouldSend(line.event, now)) return;

  const text = `Sanko ${line.level}: ${line.event}\n` +
    Object.entries(line)
      .filter(([key]) => !['ts', 'level', 'event'].includes(key))
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(' ') +
    (suppressed ? `\n(${suppressed} further alert(s) suppressed this window)` : '');

  try {
    // Node's own fetch, with a timeout: an alerting endpoint that hangs must not
    // hold a request open behind it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(ALERT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...line }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    // Deliberately console, not log.error: routing an alerting failure back
    // through the alerter is how you build an infinite loop.
    console.error(`alert delivery failed: ${err.message}`);
  }
}

const log = {
  debug: (event, context) => write('debug', event, context),
  info: (event, context) => write('info', event, context),
  warn: (event, context) => write('warn', event, context),
  error: (event, context) => write('error', event, context),
  // Test seam.
  _resetAlertState: () => { recentAlerts.clear(); windowStartedAt = 0; windowCount = 0; suppressed = 0; },
  _redact: redact,
  _shouldSend: shouldSend,
  alertingConfigured: () => Boolean(ALERT_URL),
};

module.exports = log;

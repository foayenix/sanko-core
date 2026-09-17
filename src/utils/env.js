// Environment variable reader that treats blank as unset.
//
// `process.env.FOO ?? 'default'` looks right and is wrong for .env files: a line
// like `WHISPER_CLI_PATH=` sets the variable to an empty string, which is neither
// null nor undefined, so `??` keeps the blank and the default never applies.
// The failure is quiet — a spawn of '' rather than 'whisper', a request to ''
// rather than the real base URL — so read every optional setting through this.

function env(name, fallback = undefined) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const trimmed = String(raw).trim();
  return trimmed === '' ? fallback : trimmed;
}

// True only for an explicitly truthy value; blank falls back.
function envBool(name, fallback = false) {
  const value = env(name);
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function envNumber(name, fallback) {
  const value = env(name);
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = { env, envBool, envNumber };

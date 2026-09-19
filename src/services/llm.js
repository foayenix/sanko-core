// LLM provider abstraction.
//
// Presents one interface — `client.messages.create(...)` in Anthropic's shape —
// so the agent loop never learns which backend it is talking to. Two providers:
//
//   ollama    — a model running on your own machine. No data leaves the host.
//   anthropic — the hosted API. Kept as a comparison baseline for evals.
//
// Selected with LLM_PROVIDER. The Ollama path translates Anthropic-shaped
// requests to Ollama's /api/chat and translates the response back, so
// src/agent/index.js is identical either way and the eval harness can score the
// two against each other on the same cases.

const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

// Blank .env values are empty strings, not undefined — `??` would keep them.
const { env, envNumber } = require('../utils/env');
const log = require('../utils/log');

const PROVIDER = env('LLM_PROVIDER', 'ollama').toLowerCase();

const OLLAMA_BASE_URL = env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
const OLLAMA_MODEL = env('OLLAMA_MODEL', 'qwen2.5:32b-instruct-q4_K_M');

// Ollama's default context is small enough (2048 on many builds) to silently
// truncate this agent's system prompt — the plant index alone is ~1.5k tokens.
// Truncation shows up as an agent that has "forgotten" its tools rather than as
// an error, so set it explicitly and generously.
const OLLAMA_NUM_CTX = envNumber('OLLAMA_NUM_CTX', 16384);

// Low but non-zero: greedy decoding makes small models loop on tool calls.
const OLLAMA_TEMPERATURE = envNumber('OLLAMA_TEMPERATURE', 0.3);

// Local models are slower than an API. A 32B on an M1 Max is single-digit
// tokens/sec, so a tool-heavy turn can legitimately take a couple of minutes.
const OLLAMA_TIMEOUT_MS = envNumber('OLLAMA_TIMEOUT_MS', 300000);

// How long Ollama keeps the model resident after a turn. Ollama's own default is
// 5 minutes, which is wrong for a WhatsApp bot: practitioners message in bursts
// hours apart, so nearly every conversation would open by reloading 20 GB of
// weights. That reload is ~3 minutes of silence on the practitioner's phone
// before the first reply — indistinguishable from the bot being broken.
// '-1' keeps it loaded indefinitely; set a duration like '30m' to reclaim the RAM.
//
// Ollama parses a *string* keep_alive as a Go duration, so "-1" is rejected with
// `missing unit in duration` — only the JSON number -1 means "forever". Anything
// that is a bare number is sent as a number (seconds, or -1); anything else goes
// through as the duration string it is.
const OLLAMA_KEEP_ALIVE = (raw => {
  const trimmed = String(raw).trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
})(env('OLLAMA_KEEP_ALIVE', '-1'));

// ─── Anthropic provider ───────────────────────────────────────────────────────

let _anthropic;
function anthropicClient() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ─── Ollama provider ──────────────────────────────────────────────────────────

// Anthropic sends content as typed blocks; Ollama wants a plain string, a
// separate `images` array, and tool results as their own `role: "tool"` turns.
//
// `images: false` drops image blocks instead of forwarding them. Ollama 0.32
// rejects an `images` array for a model that does not declare the vision
// capability — `400 Multimodal data provided, but model does not support
// multimodal requests` — and that 400 fails the whole turn, so every photo a
// practitioner sent reached them as an error. Older builds ignored the pixels
// silently, which is the behaviour the comment in services/vision.js describes.
//
// Dropping them costs nothing on this stack. The agent model is text-only by
// design, and services/vision.js has already turned the photograph into the text
// block that travels beside it — a page reading, or the note saying there is no
// writing on it. That text is what the agent was working from either way.
function toOllamaMessages(system, messages, { images: allowImages = true } = {}) {
  const out = [];

  const systemText = Array.isArray(system)
    ? system.map(b => b.text).filter(Boolean).join('\n\n')
    : system;
  if (systemText) out.push({ role: 'system', content: systemText });

  // Ollama identifies a tool result by tool name, not by the id Anthropic uses,
  // so remember which name each tool_use id belonged to. Messages arrive in
  // order, so the assistant's tool_use is always seen before its result.
  const toolNameById = new Map();

  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      const texts = [];
      const toolCalls = [];
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          texts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolNameById.set(block.id, block.name);
          toolCalls.push({ function: { name: block.name, arguments: block.input ?? {} } });
        }
      }
      const assistant = { role: 'assistant', content: texts.join('\n\n') };
      if (toolCalls.length) assistant.tool_calls = toolCalls;
      out.push(assistant);
      continue;
    }

    // user turn: text, images, and tool results can all appear
    const texts = [];
    const images = [];
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        texts.push(block.text);
      } else if (block.type === 'image') {
        if (allowImages) images.push(block.source?.data);
      } else if (block.type === 'tool_result') {
        out.push({
          role: 'tool',
          tool_name: toolNameById.get(block.tool_use_id) ?? 'unknown_tool',
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        });
      }
    }
    if (texts.length || images.length) {
      const user = { role: 'user', content: texts.join('\n\n') };
      if (images.length) user.images = images.filter(Boolean);
      out.push(user);
    }
  }

  return out;
}

function toOllamaTools(tools) {
  return (tools ?? []).map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

// Small models sometimes hand back arguments as a JSON string rather than an
// object. Returning {} on unparseable input lets the tool's own validation
// produce a useful error the agent can recover from.
function parseToolArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    log.warn('llm.tool_arguments_unparseable', { provider: 'ollama', chars: raw.length });
    return {};
  }
}

// Local models routinely stringify nested structures — llama3.1:8b sends
// `plants` as "[{...}]" rather than [{...}] — and quote numbers. Left alone that
// reaches the executor as a string and the tool rejects a formulation the model
// actually got right.
//
// Coercion is schema-driven, never blind: a string is only parsed when the tool
// declares that field an object or array, so a `notes` field whose text happens
// to look like JSON is left exactly as the practitioner said it.
function coerceToSchema(input, schema) {
  const properties = schema?.properties;
  if (!properties || !input || typeof input !== 'object') return input;

  const out = { ...input };
  for (const [key, spec] of Object.entries(properties)) {
    const value = out[key];
    if (typeof value !== 'string') continue;
    const wants = new Set(Array.isArray(spec.type) ? spec.type : [spec.type]);

    if (wants.has('array') || wants.has('object')) {
      try {
        const parsed = JSON.parse(value);
        if (parsed !== null && typeof parsed === 'object') out[key] = parsed;
      } catch {
        // Leave it; the tool's own validation will report it usefully.
      }
    } else if ((wants.has('number') || wants.has('integer')) && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}

function fromOllamaResponse(data, tools = []) {
  const content = [];
  const schemaByName = new Map(tools.map(t => [t.name, t.input_schema]));

  const text = data?.message?.content;
  if (typeof text === 'string' && text.trim()) {
    content.push({ type: 'text', text: text.trim() });
  }

  const calls = data?.message?.tool_calls ?? [];
  calls.forEach((call, index) => {
    const name = call.function?.name;
    content.push({
      type: 'tool_use',
      id: `toolu_local_${Date.now()}_${index}`,
      name,
      input: coerceToSchema(parseToolArguments(call.function?.arguments), schemaByName.get(name)),
    });
  });

  return {
    content,
    stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: data?.prompt_eval_count ?? null,
      output_tokens: data?.eval_count ?? null,
    },
  };
}

// Does this model accept images?
//
// Asked once per model and remembered, because it cannot change without the
// model being re-pulled, and because a probe on every turn would add a round
// trip to a path that is already the slowest thing a practitioner waits on.
//
// A probe that fails answers "no". That is the safe direction: a text model sent
// images fails the entire turn, while a vision model whose probe failed merely
// works from the transcription — worse, but not broken.
const _visionSupport = new Map();

async function ollamaSupportsVision(model) {
  if (_visionSupport.has(model)) return _visionSupport.get(model);

  let supported = false;
  try {
    const { data } = await axios.post(`${OLLAMA_BASE_URL}/api/show`, { model }, { timeout: 10000 });
    const capabilities = Array.isArray(data?.capabilities) ? data.capabilities : [];
    supported = capabilities.includes('vision');
    log.info('llm.vision_capability', { provider: 'ollama', model, supported, capabilities });
  } catch (err) {
    log.warn('llm.vision_capability_unknown', { provider: 'ollama', model, error: err.message });
  }

  _visionSupport.set(model, supported);
  return supported;
}

function ollamaClient() {
  return {
    provider: 'ollama',
    model: OLLAMA_MODEL,
    messages: {
      async create({ max_tokens, system, tools, messages, model }) {
        const target = model ?? OLLAMA_MODEL;
        const allowImages = await ollamaSupportsVision(target);
        let data;
        try {
          ({ data } = await axios.post(
            `${OLLAMA_BASE_URL}/api/chat`,
            {
              model: target,
              messages: toOllamaMessages(system, messages, { images: allowImages }),
              tools: toOllamaTools(tools),
              stream: false,
              keep_alive: OLLAMA_KEEP_ALIVE,
              options: {
                num_ctx: OLLAMA_NUM_CTX,
                num_predict: max_tokens,
                temperature: OLLAMA_TEMPERATURE,
              },
            },
            { timeout: OLLAMA_TIMEOUT_MS }
          ));
        } catch (err) {
          const detail = err.response?.data?.error ?? err.message;
          if (err.code === 'ECONNREFUSED') {
            throw new Error(`Ollama is not reachable at ${OLLAMA_BASE_URL}. Is \`ollama serve\` running?`, { cause: err });
          }
          throw new Error(`Ollama request failed: ${detail}`, { cause: err });
        }
        return fromOllamaResponse(data, tools);
      },
    },
  };
}

// ─── selection ────────────────────────────────────────────────────────────────

let _client;
function getClient() {
  if (_client) return _client;
  _client = PROVIDER === 'anthropic' ? anthropicClient() : ollamaClient();
  return _client;
}

function providerName() {
  return PROVIDER === 'anthropic' ? 'anthropic' : 'ollama';
}

// The model id recorded on usage events, so the admin view and the eval harness
// can tell which backend produced a given formulation.
function modelName() {
  return PROVIDER === 'anthropic'
    ? env('AGENT_MODEL', 'claude-sonnet-4-6')
    : OLLAMA_MODEL;
}

// Test seam — lets a suite install a scripted client without a live backend.
function _setClient(client) {
  _client = client;
}

module.exports = {
  getClient,
  providerName,
  modelName,
  toOllamaMessages,
  toOllamaTools,
  fromOllamaResponse,
  parseToolArguments,
  coerceToSchema,
  _setClient,
};

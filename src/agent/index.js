// The Sanko agent — a Claude tool-calling loop that replaces the keyword-driven
// step machine that used to live in router.js.
//
// One entry point, runAgent(), shared by every transport: the WhatsApp webhook
// and the /simulator page both call it with the same shape, so what you test in
// the browser is exactly what runs on WhatsApp.
//
// Replies are pushed through the caller's `send` callback as they are produced
// rather than returned at the end, so a practitioner sees "Let me save that…"
// before a slow database write instead of silence.

const log = require('../utils/log');
const { selectTools, executeTool } = require('./tools');
const { loadTemplate } = require('./prompt');
const registration = require('./registration');
const { splitChoices } = require('../utils/choices');
// Imported as a namespace, not destructured, so tests can substitute individual
// functions on the shared module object.
const db = require('../services/supabase');
const llm = require('../services/llm');

const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS ?? 1600);

// How many times the agent may call tools before we force it to answer. Real
// turns use one or two; the cap only exists to stop a loop from running away.
const MAX_TOOL_ITERATIONS = Number(process.env.AGENT_MAX_TOOL_ITERATIONS ?? 8);

// ─── system prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(practitioner) {
  // Who they are and what registration still needs, from the one module that
  // decides both. Building this string here would let the prompt and the tool
  // gate hold different opinions about whether someone is registered.
  const known = registration.describeForPrompt(practitioner);

  // The plant index used to be interpolated here — 442 mappings, ~4,330 tokens,
  // on every call of every iteration. It is reached through the lookup_plant
  // tool now, and resolved in code by the tools that write records, so neither
  // the prompt nor the model carries it.
  return loadTemplate()
    .replace('{{PRACTITIONER_CONTEXT}}', `${known}\nToday's date: ${new Date().toISOString().slice(0, 10)}`);
}

// ─── conversation history ─────────────────────────────────────────────────────

function _hasBlock(message, type) {
  return Array.isArray(message.content) && message.content.some(b => b?.type === type);
}

// The Anthropic API requires alternating roles and a tool_result for every
// tool_use. A history window can slice through either, so trim to the largest
// span that starts with a clean user turn and ends with a clean assistant turn.
function sanitizeHistory(messages) {
  const out = messages.slice();
  while (out.length && !(out[0].role === 'user' && !_hasBlock(out[0], 'tool_result'))) {
    out.shift();
  }
  while (out.length) {
    const last = out[out.length - 1];
    if (last.role === 'assistant' && !_hasBlock(last, 'tool_use')) break;
    out.pop();
  }
  return out;
}

// Images are 100–500 KB of base64 each. They are worth sending to the model once,
// but storing them in every future context window would blow up both the row size
// and the token bill, so persist a placeholder instead.
function stripImagesForStorage(content) {
  if (!Array.isArray(content)) return content;
  return content.map(block =>
    block?.type === 'image'
      ? { type: 'text', text: '[photo sent by practitioner]' }
      : block
  );
}

// Which records the agent has actually read in this conversation.
//
// update_formulation's gate needs evidence that the agent looked at the row
// before telling a practitioner what is in it, and that evidence is the
// get_formulation tool_use already sitting in the history. Reading it from there
// is what lets the gate span turns: a record read before the confirmation
// question still counts when the answer arrives in the next turn.
//
// History is a 40-message, 24-hour window, so a read that has aged out stops
// counting and the agent is made to look again. That is the right direction to
// fail — re-reading costs a round trip, while confirming against a value nobody
// checked costs a practitioner their record.
function recordsRead(messages) {
  const codes = new Set();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type === 'tool_use' && block.name === 'get_formulation' && block.input?.short_code) {
        codes.add(String(block.input.short_code).toUpperCase());
      }
    }
  }
  return codes;
}

// ─── main loop ────────────────────────────────────────────────────────────────

// practitioner — the row from the practitioners table (mutated in place by
//                set_profile so later turns in this call see the new name)
// content      — string, or an array of Anthropic content blocks (text/image)
// send         — async (text) => void, called once per assistant text block
// client       — Anthropic client override; defaults to the shared one
//
// Returns { replies, toolCalls, stopped } for tests and the simulator.
async function runAgent({ practitioner, content, sourceMediaIds = [], send, sendPatientConsent, client = llm.getClient() }) {
  const userContent = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  const currentUserText = userContent
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .join('\n');
  const tools = selectTools();

  const history = sanitizeHistory(await db.loadAgentMessages(practitioner.id));
  const messages = [...history, { role: 'user', content: userContent }];

  // Only the turns produced now get persisted; history is already stored.
  const fresh = [{ role: 'user', content: stripImagesForStorage(userContent) }];
  const replies = [];
  const toolCalls = [];
  let stopped = 'end_turn';
  let accountDeleted = false;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const startedAt = Date.now();
    const response = await client.messages.create({
      model: llm.modelName(),
      max_tokens: MAX_TOKENS,
      // cache_control on the last system block caches the system prompt across
      // turns on the hosted provider; Ollama ignores it, which costs nothing.
      system: [{ type: 'text', text: buildSystemPrompt(practitioner), cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });
    const durationMs = Date.now() - startedAt;

    db.logEvent({
      practitioner_id: practitioner.id,
      event_type: 'llm_call',
      payload: {
        type: 'agent',
        op: 'converse',
        provider: llm.providerName(),
        model: llm.modelName(),
        stop_reason: response.stop_reason,
        input_tokens: response.usage?.input_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
        // Where a turn's time actually goes. `iteration` matters as much as the
        // duration: a turn that feels slow is often four fast calls rather than
        // one slow one, and the two have different fixes.
        duration_ms: durationMs,
        iteration,
        // Output tokens per second, which is the number that tells you whether
        // a model swap or a shorter prompt is the lever. Null when the provider
        // does not report usage.
        output_tps: response.usage?.output_tokens && durationMs
          ? Math.round((response.usage.output_tokens / durationMs) * 1000 * 10) / 10
          : null,
      },
    }).catch(() => {});

    log.info('agent.llm_call', {
      practitioner_id: practitioner.id,
      iteration,
      duration_ms: durationMs,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    });

    // Snapshotted before this response joins the history on purpose. A
    // get_formulation in the *same* response has not put anything in front of
    // the practitioner yet, so it must not authorise an update sitting beside
    // it — the read has to have happened in an earlier step for its result to
    // have been shown.
    const readRecords = recordsRead(messages);

    messages.push({ role: 'assistant', content: response.content });
    fresh.push({ role: 'assistant', content: response.content });

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        // Buttons travel with the message that offers them; send() decides how
        // to render them for its transport.
        const { text, choices } = splitChoices(block.text);
        if (!text) continue;
        replies.push({ text, choices });
        await send(text, choices);
      }
    }

    const toolUses = response.content.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) {
      stopped = response.stop_reason ?? 'end_turn';
      break;
    }

    const results = [];
    for (const call of toolUses) {
      const result = await executeTool(call.name, call.input, {
        practitioner,
        sourceMediaId: sourceMediaIds.at(-1) ?? null,
        currentUserText,
        sendPatientConsent,
        readRecords,
      });
      toolCalls.push({ name: call.name, input: call.input, result });
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(result),
        is_error: result?.ok === false,
      });
      if (result?.account_deleted === true) accountDeleted = true;
    }

    if (accountDeleted) {
      const confirmation = 'Your Sanko account, records, conversation history, and archived media have been permanently deleted.';
      replies.push({ text: confirmation, choices: [] });
      await send(confirmation, []);
      stopped = 'account_deleted';
      break;
    }

    messages.push({ role: 'user', content: results });
    fresh.push({ role: 'user', content: results });

    if (iteration === MAX_TOOL_ITERATIONS - 1) stopped = 'max_iterations';
  }

  // The agent finished on a tool call without saying anything, or ran out of
  // iterations. Either way the practitioner is owed a reply.
  if (replies.length === 0) {
    const fallback = "Sorry — I got tangled up there. Could you say that again?";
    replies.push({ text: fallback, choices: [] });
    await send(fallback, []);
    fresh.push({ role: 'assistant', content: [{ type: 'text', text: fallback }] });
  }

  // The account row (and its message FK target) no longer exists after a
  // successful self-service deletion.
  if (!accountDeleted) await db.appendAgentMessages(practitioner.id, fresh);

  return { replies, toolCalls, stopped };
}

module.exports = { runAgent, buildSystemPrompt, sanitizeHistory, stripImagesForStorage, recordsRead };

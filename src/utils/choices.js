// Quick-reply buttons, expressed by the agent as a trailing line:
//
//   Have I got that right?
//   [[Yes, save it | No, fix something]]
//
// A sentinel rather than a tool call because prefill is the expensive part of a
// turn on a local model — making the agent spend an extra round trip to ask
// "shall I show buttons?" would add tens of seconds to every confirmation. The
// buttons also belong to the message the model just wrote, which is exactly what
// a trailing line expresses and what a separate tool call does not.
//
// Parsing is deliberately forgiving, and the sentinel is always stripped even
// when it cannot be rendered — a practitioner seeing a stray [[...]] line is a
// worse failure than losing the buttons.

// WhatsApp's interactive reply buttons: at most three, at most 20 characters of
// title each. Exceeding either is a 400 from Meta, so clamp here rather than
// discovering it in production.
const MAX_CHOICES = 3;
const MAX_TITLE = 20;

const SENTINEL = /\n?\s*\[\[([^\]]+)\]\]\s*$/;

function splitChoices(text) {
  const match = String(text ?? '').match(SENTINEL);
  if (!match) return { text: String(text ?? '').trim(), choices: [] };

  const choices = match[1]
    .split('|')
    .map(choice => choice.trim())
    .filter(Boolean)
    .slice(0, MAX_CHOICES)
    .map(choice => (choice.length > MAX_TITLE ? `${choice.slice(0, MAX_TITLE - 1)}…` : choice));

  return { text: String(text).replace(SENTINEL, '').trim(), choices };
}

module.exports = { splitChoices, MAX_CHOICES, MAX_TITLE };

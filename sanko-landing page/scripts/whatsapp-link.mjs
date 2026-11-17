// The "Ask Sanko" deep link, kept out of the generator so it can be tested without
// building 1,200 pages.
//
// There is no default number and no placeholder. A wa.me link to a number nobody owns
// opens a chat with a stranger, so an unset number produces no link at all and the
// generator renders no button — rather than shipping a dead one.

// wa.me wants E.164 digits with no plus, no spaces and no punctuation.
export const normaliseNumber = (value) => String(value ?? '').replace(/[^0-9]/g, '');

// The prefill is the reader's opening line, so it has to be a question they would
// actually send and one the agent can answer from the index it already holds. It carries
// the page it came from: "what is akoko" is the wrong question when a name is contested,
// and the URL is how the practitioner side tells a website visitor from a practitioner
// who opened the conversation themselves.
export function whatsappPrefill({ display, languageLabel, slug, contested, site }) {
  const question = contested
    ? `Sanko, published sources disagree about the plant name "${display}" (${languageLabel}). What does each of them say?`
    : `Sanko, what plant is "${display}" (${languageLabel})?`;

  return `${question}\n\nAsked from ${site}/plants/${slug}/`;
}

export function whatsappHref({ number, display, languageLabel, slug, contested, site }) {
  const digits = normaliseNumber(number);
  if (!digits) return '';
  const text = whatsappPrefill({ display, languageLabel, slug, contested, site });
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

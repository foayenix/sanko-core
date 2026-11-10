// How a published local name is printed on the site.
//
// Sources disagree about case. Most print "Abo yúnyún", some print "akú malapa"
// lowercase throughout, and the site shows them all the same way: a capital on
// each word, and not one other letter moved. That second half is the whole job.
// The names here carry Yoruba tone marks and dots below, and those marks are
// what separate one name from another — a helper that rewrites them is not a
// cosmetic problem, it publishes a different name than the source did.

// Raise the first letter of each whitespace-separated word.
//
// This was `\b[a-z]` and could not be: `\b` is ASCII-only, so ú, ọ and ẹ read as
// non-word characters and opened a boundary in the middle of a word. The letter
// after every diacritic came out capitalised — "Abo yúnyún" was published as
// "Abo YúNyúN", "Apa ọgbẹ́" as "Apa ọGbẹ́".
//
// Matching by Unicode letter property instead fixes that, and splitting on
// whitespace alone keeps the helper out of the inside of a word: hyphen and
// slash compounds stay spelled the way their source printed them ("Olug-bu",
// "Ariraa/ulogburu"), which is what 80 of the 83 hyphenated names actually do.
// Leading punctuation is stepped over so "(munjiriya)" still capitalises.
//
// Case is the only thing this changes. It adds and drops no characters.
export const titleCase = (value) =>
  String(value ?? '').replace(
    /(^|\s)([^\p{L}\s]*)(\p{L})/gu,
    (_match, gap, leading, letter) => `${gap}${leading}${letter.toUpperCase()}`,
  );

// The one rule every human decision in data/plants/ has to satisfy.
//
// A reviewer is named by a stable pseudonym — the same rule evals/README.md
// applies to case reviewers. Anything that looks like a name, phone number,
// email or database id is refused rather than quietly committed to a public
// file; the pseudonym-to-identity mapping belongs outside this repository.
//
// It lives in its own module because both the unknown-plant review loop and
// the contested-name loop enforce it, and the build calls into the second one.
// Importing it from either script would put a cycle through build-plant-data.
const REVIEWER_REF = /^[A-Z]{2,4}-[A-Z0-9]{4,8}$/;

module.exports = { REVIEWER_REF };

# Plant literature index data

The open plant literature index (layer 1 of the Evidence Atlas,
`docs/SANKO_EVIDENCE_ATLAS_SPEC.md`). It links the `taxonomy_checked` taxa in
`data/plants/plants.json` to published studies. It is a bibliographic index:
it stores bibliographic facts and Sanko's own classifications, and links out to
each study. It does not store or publish abstracts, full text, figures,
quotations or Sanko's summary of what a study found.

## Files

| File | Written by | Contents |
| --- | --- | --- |
| `searches.json` | `literature:discover` | Every executed query: provider, exact query, date, hit count, records retrieved, error. A failed search is recorded, not dropped. |
| `studies.json` | `literature:discover` | One record per study, shared across taxa: identifiers, title, authors (first ten), journal, year, publication type, retraction status, external link. |
| `index_entries.json` | `literature:discover` | One record per taxon–study link, with the automated first-pass screening and classification (`classified_by: automated`). Re-derived on every discovery run. |
| `verifications.json` | `literature:review -- verify` | Append-only human verification events. The latest event for an entry overrides its automated fields. Never edited by hand. |
| `pilot_selection.json` | `literature:select-pilot` | The 20 pilot taxa, the scores and reasons that chose them, and the taxa the volume cap excluded. |
| `review/` | `literature:review -- queue` | Reviewers' working spreadsheets. **Gitignored.** |

Every file is validated against a closed schema (`src/literature/store.js`):
an unexpected field — an abstract, say — fails the build.

## What makes an entry public

Only an entry whose latest verification event is an **include** is listed or
counted on the public site. Automated entries appear only as a single
"awaiting verification" number per plant. An include needs:

- `evidence_kind` (from `src/literature/vocab.js`);
- `voucher_reported`: `yes`, `no` or `not_stated` — always answered by the reviewer;
- a resolved name: when the automated pass did not find the plant name in the
  title (`name_resolution: pending`), the reviewer records the name exactly as
  the study printed it and whether it is the accepted name (`exact`) or a
  synonym.

Reviewer ids are pseudonyms (lowercase letters, digits, hyphens), never names
or email addresses.

## Workflow

```
npm run literature:discover -- --counts --concurrency 12   # hit counts for every taxon
npm run literature:select-pilot                            # choose the 20 pilot taxa
npm run literature:discover -- --retrieve --taxa pilot     # full records for the pilot
npm run literature:review -- queue                         # spreadsheet for reviewers
npm run literature:review -- verify --file <csv> --reviewer <id>
npm run literature:review -- status
npm run literature:check                                   # validate only
npm run literature:build                                   # preview site in build/atlas/
```

A release build needs a corrections route:
`npm run literature:build -- --release --corrections-url <https or mailto>`.

## Known limits of the automated pass

- Search covers Europe PMC only, by accepted name and the binomials sources
  printed. GBIF synonym expansion, abbreviated names (*V. amygdalina*), and
  journals Europe PMC does not index (many African journals) are not covered.
  Crossref/OpenAlex coverage is a planned addition.
- Classification reads titles, keywords, MeSH terms and publication types only.
  It is a starting point for a reviewer, not a judgement; its accuracy is one of
  the things the pilot measures.
- Retraction status comes from Europe PMC publication types at retrieval time.
  The monthly status check (spec 5.4 step 5) is not built yet.

## Current state (Phase A, 18 November 2026)

- **Counts:** 1,416 Europe PMC count queries (3 per taxon × 472 taxa), none failed.
- **Pilot:** 20 taxa in `pilot_selection.json` — 14 by score (Nigerian use breadth
  weighted double, at least three sources), 3 safety-led, 3 identity-hard. Taxa
  above 500 hits are excluded from the pilot and listed there (ginger, neem,
  moringa, garlic, papaya and others); they need Phase B or a narrower protocol.
- **Retrieved:** 4,894 studies and 5,010 taxon–study entries for the 20 pilot
  taxa, every hit retrieved, no failed searches. 132 records are patents.
- **Automated pass:** 375 entries excluded (reviews without original data,
  errata, patents and other notices); 4,635 await human verification.
  2,332 entries mention the plant only outside the title, so the reviewer must
  record the printed name.
- **Verified:** none. The public site therefore lists no studies yet; every plant
  page shows zero counts and the number awaiting verification. That is correct
  behaviour, not a fault.

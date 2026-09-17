# Plant mapping data

`data/plant_lookup_v1.json` remains the compact runtime index consumed by the agent. It is generated; do not add literature mappings to it by hand.

The maintainable data is split into:

- `sources.json` — publication, location, licence, and inclusion/retraction status.
- `plants.json` — one record per accepted botanical taxon.
- `vernacular_names.json` — source spelling, normalized spelling, language, region, verification state, and source locator.
- `observations.json` — reported plant part, preparation, and ethnobotanical context. A reported traditional use is explicitly not clinical evidence.
- `reviews.json` — machine or human verification events.
- `human_reviews.json` — maintained human review events merged into generated `reviews.json`. These are audit records only; a review here does not create a mapping.
- `practitioner_confirmations.json` — local names Sanko could not place botanically, later identified by a reviewer. Unlike `human_reviews.json` this *is* an input: each entry produces a vernacular name, an observation, and its own review record. Written by `npm run plants:promote`, never by hand.
- `ambiguities.json` — names reported for more than one taxon.
- `surveys/` — minimally transformed source-table rows preserving published text. Only JSON files directly in this directory are eligible for the primary-source build.
- `surveys/staged/` — acquired primary tables blocked on language or data-quality review.
- `surveys/quarantine/` — retained-but-excluded source data, including retracted publications.
- `surveys/discovery/` — review-derived study catalogues, discovery output, and secondary evidence that cannot produce runtime mappings.
- `taxonomy/` — cached taxonomy-service responses used by the build.
- `references/staged/` — concise facts from copyrighted books and their page locators. These files are internal review evidence and cannot feed runtime mappings without a separate inclusion decision.
- `legacy_lookup_v1.json` — immutable snapshot of the original 152 runtime rows. Its missing provenance is represented honestly as `legacy_unverified`.

## Export policy

The build exports a literature-derived name only when all of the following are true:

1. its source is active and included;
2. the published botanical name has an exact GBIF v2 species match with confidence of at least 90;
3. an accepted botanical name and stable GBIF identifiers were returned; and
4. the normalized vernacular name does not point to multiple published or accepted taxa.

Unresolved literature names remain in `vernacular_names.json` with `accepted_botanical: null` and `export_eligible: false`. Ambiguous names remain searchable in the runtime file with `botanical: null`, so the agent cannot silently choose a species.

`taxonomy_checked` means automated nomenclatural validation only. It does not mean a botanist, language reviewer, practitioner, or clinician has approved the mapping. Human reviews belong in `human_reviews.json`; the build merges them into `reviews.json`. A stricter future export status should gate human-approved mappings.

### Practitioner confirmations

Entries in `practitioner_confirmations.json` are the one export path whose evidence is a person's statement rather than a publication, so they are exported under their own terms:

1. they are ingested under `ingestion_status: practitioner_confirmed`, not `included`, and never counted among the survey rows;
2. their vernacular names carry `verification_status: practitioner_confirmed` and a pseudonymous `reviewed_by`, so they are never mistaken for taxonomy-checked literature;
3. they are `export_eligible` — a confirmation that does not reach the runtime index has not closed the loop it exists to close; and
4. rule 4 above still governs them: where a confirmation disagrees with a published source, the name becomes ambiguous and drops out of the runtime index rather than one source overwriting the other.

The transcripts that motivated a confirmation stay out of this directory entirely. They live only in the gitignored `review_queue.json` that `npm run plants:pull` writes.

The current primary build combines the Plateau State, Lagos State, and southwestern anti-asthmatic surveys. The Port Harcourt table is staged because its 84 displayed rows conflict with the article's 83-species count and include an unnumbered row plus an apparent column swap. The Ile-Ife tables are quarantined because the publisher retracted the article. The 2025 review contributes a catalogue of 79 original studies to acquire, but its secondary mappings do not feed production.

Two supplied textbooks are also registered. Iwu's *Handbook of African Medicinal Plants* contributed concise staging records from 168 Chapter 3 monographs, with language labels and exact PDF/printed-page locators. Oliver-Bever's *Medicinal Plants in Tropical West Africa* is retained as a botanical and pharmacological reference; its botanical/general index is not a language-labelled vernacular index, so the importer creates no local-name mappings from it. Both works are copyrighted, and no redistribution permission was identified.

## Finding more sources

Two generated discovery files sit in `surveys/discovery/`. Neither is read by the build, and neither can produce a mapping.

`europepmc-candidates.json` (`npm run plants:discover`) does two things. It searches Europe PMC for Nigerian ethnobotanical literature — scoped by state and by ethnonym as well as by "Nigeria", because a survey of Bokkos does not always say Nigeria in its title — and it resolves the 79 original studies catalogued in `anumudu-2025-nigeria-review.json` from bare titles to DOIs, licences and full texts, falling back to Crossref for the majority that Europe PMC does not index. Candidates are ranked by the gap they would close, and the gap is read from `vernacular_names.json` at run time rather than hardcoded: while Igbo sits at single digits a South-East survey outranks a fourth Yoruba one, and when that stops being true the ranking changes on its own. Every score comes with its reasons, and titles that read as laboratory work or as health-services research — which say "survey" and "traditional medicine" and publish no plant table — are ranked down rather than hidden.

```sh
npm run plants:discover                                # search, then resolve the catalogue
node scripts/discover-sources.js --search-only
node scripts/discover-sources.js --save-raw /tmp/raw.json
node scripts/discover-sources.js --from /tmp/raw.json  # replay offline, no network
```

`wikidata-vernacular-candidates.json` (`npm run plants:wikidata`) fetches Wikidata labels in Nigerian languages for the taxa already in `plants.json`. Wikidata is CC0, which makes it the only redistributable machine-readable source of local names for the languages this index is thinnest in — and it is crowd-sourced and unsourced, so roughly half of what it returns in an African language is the botanical or English name filed in the wrong language field. Those are discarded; what survives is a *candidate*, never a mapping. Candidates are classified against the runtime index, and two of the three classes are not additions at all: `agrees_with_index` is outside corroboration of a mapping that may have none, and `conflicts_with_index` is a disagreement worth reading before anything else.

```sh
npm run plants:wikidata            # stage candidates
npm run plants:wikidata -- --queue # also seed the review queue
```

With `--queue`, new candidates join the gitignored review queue below every name a practitioner actually used — they carry an occurrence count of zero, because a reviewer's time belongs to the names from the field first. A confirmed candidate is written by `npm run plants:promote` as a practitioner confirmation attributed to the reviewer, carrying the `candidate_source` it came from: the reviewer is the evidence of record, and the file does not pretend a suggestion and a report are the same kind of thing.

One caveat the candidate rows carry themselves. Normalisation folds diacritics by decomposing them, which works for ẹ, ọ, ụ and ì and does nothing for ɓ, ɗ, ƴ and ŋ — those are distinct letters with no decomposition. A Fulfulde name such as *Ɓowre* will therefore only match a practitioner who types the hook letter. Rows say so in `ascii_after_normalisation`; folding them would mean changing the shared normaliser and rewriting the committed runtime index.

## Rebuild

The checked-in survey and taxonomy caches make normal builds offline and repeatable:

```sh
npm run plants:build
node "sanko-landing page/scripts/sync-plant-count.mjs"
npm test
```

## Reviewing unknown names

```sh
npm run plants:pull                            # queue names the agent could not place
npm run plants:review                          # what is waiting
npm run plants:promote -- --reviewer PR-7F2A   # confirm, rebuild, report the gain
```

`review_queue.json` is gitignored: it carries the practitioner speech a reviewer needs in order to identify a name. `promote` copies the mapping alone into `practitioner_confirmations.json`.

To refresh taxonomy deliberately (this calls GBIF and may change results as the backbone changes):

```sh
npm run plants:taxonomy
npm run plants:build
```

To reproduce the Plateau source-table extraction from an open-access Europe PMC full-text XML file:

```sh
node scripts/import-plateau-survey.js /path/to/PMC3162497.xml
```

To reproduce the other acquired tables, use the bundled Python runtime with `pdfplumber` and provide the two source PDFs, two JATS XML files, and the Port Harcourt HTML-table capture:

```sh
python3 scripts/extract-nigerian-plant-sources.py \
  --lagos-pdf /path/to/plants-11-00633-s001.pdf \
  --anti-asthmatic-pdf /path/to/PMC2816587-table.pdf \
  --ile-ife-xml /path/to/PMC8355999.xml \
  --review-xml /path/to/PMC12369106.xml \
  --port-harcourt-json /path/to/weli-2013-table-rows.json
```

Extraction is deliberately separate from export. A source must be both `publication_status: active` and `ingestion_status: included` in `sources.json` before the build will consider its rows.

To reproduce the concise textbook staging data from locally held copies:

```sh
python3 scripts/extract-medicinal-book-mappings.py \
  --iwu-pdf /path/to/Handbook-of-African-Medicinal-Plants-2e.pdf \
  --oliver-bever-pdf /path/to/Medicinal-Plants-in-Tropical-West-Africa.pdf
```

The textbook importer does not copy therapeutic prose. It retains short mapping facts, bibliographic metadata, review flags, and page locators only.

Voice-transcription variants are not generated here. They should only be added from observed, consented transcripts with their own provenance and access policy.

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
- `surveys/transcriptions/` — tables read off page scans by eye, for sources whose PDF carries no text layer. The transcription is the input a survey file is built from, and the only form of such a source this repository can rebuild from.
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

### The legacy tier's names

`legacy_lookup_v1.json` is the immutable snapshot of the original 152 runtime rows, and its mappings have no citation, locality or collector — which is why they are `legacy_unverified`. Until recently their botanical names had also never been near GBIF, and that conflated two different questions. Whether a local name really means a plant is a question about evidence, and the legacy tier has none. What that plant is called today is a question about nomenclature, and GBIF answers it whatever the row's provenance.

Leaving the second unasked cost mappings. A legacy row reading *Bryophyllum pinnatum* and a survey row reading *Kalanchoe pinnata* name one plant twice, and the build read them as two species disagreeing — so `abamoda`, `agbalumo`, `awusa`, `ewuro`, `gbure` and `osan` were all withheld as contested when no source contested them.

`npm run plants:legacy-taxonomy` resolves the 87 distinct legacy names and writes `taxonomy/gbif-legacy.json`, which the build reads if present. **It normalises the name; it does not promote the row.** The vernacular record stays `legacy_unverified`, because a current name for a plant is not evidence that a practitioner ever called it that. The distinction the build now draws is that `plants.json` describes a taxon, which can be `taxonomy_checked`, while a vernacular row describes a claim about a name, which cannot be until a source or a practitioner supports it.

One rename is withheld, and it is the reason the script does more than call the matcher. GBIF holds a single usage of *Loranthus micranthus* — Hook.f.'s, a New Zealand mistletoe accepted as *Ileostylus micranthus*, with 3,707 occurrences worldwide and **none in Nigeria**. The plant the legacy row means is Linn.f.'s, which the backbone does not carry under that name, so no homonym check finds the problem. Every legacy row here comes from Nigerian practice, so a rename is applied only when the accepted taxon is actually recorded in Nigeria. The test runs one way only: a zero does not prove absence — GBIF's West African coverage is thin — it only withholds a rename and leaves the legacy name as it has always been. The Lagos survey independently maps that same local name, *afomo*, to *Tapinanthus globiferus*, an African mistletoe, which is what the legacy row meant.

### Name corrections

The export rule above matches the botanical name exactly as the source printed it, which is what stops the index inventing a species — and it also withheld sixty-one vernacular rows whose only problem was a typo, a gender disagreement, an authority string, or two names crammed into one cell. `npm run plants:corrections` resolves those, and writes what it decided to `name_corrections.json`.

A correction is applied only when GBIF names a single accepted species for the corrected form. Every spelling change comes from GBIF's own suggestion — the script never guesses at what an author meant — and each record carries the query that produced it, the match type, the confidence, and whether the genus or epithet moved. The corrected entry is merged into the taxonomy cache under the **published** name, because that is what the survey rows say and what the build looks up; `taxonomy_query_strategy: curated_correction` marks it, and `corrected_from_as_published` keeps the trail. Nothing rewrites a survey row: `botanical_as_published` stays exactly as printed, and a corrected name still has to reach an accepted species at 90 confidence or better to be exported.

Where GBIF's alternatives disagree, nothing is applied. The name is recorded as `deferred` with the competing species and its rows stay withheld. Three names sit there now: `Anacardium occidentalis Linn.`, where the backbone holds both *occidentale* and *occidentala* at equal distance from the published spelling, and `Grewia sp` and `Geranium spp`, which name no species to correct to. The rule that makes the rest safe is worth stating plainly — an exact homonym is resolved by which candidate keeps the epithet (*Acacia albida* → *Faidherbia albida*, not *Vachellia tortuosa*), and a fuzzy suggestion is considered only when the published spelling exists nowhere in the backbone.

`taxonomy_checked` means automated nomenclatural validation only. It does not mean a botanist, language reviewer, practitioner, or clinician has approved the mapping. Human reviews belong in `human_reviews.json`; the build merges them into `reviews.json`. A stricter future export status should gate human-approved mappings.

### Practitioner confirmations

Entries in `practitioner_confirmations.json` are the one export path whose evidence is a person's statement rather than a publication, so they are exported under their own terms:

1. they are ingested under `ingestion_status: practitioner_confirmed`, not `included`, and never counted among the survey rows;
2. their vernacular names carry `verification_status: practitioner_confirmed` and a pseudonymous `reviewed_by`, so they are never mistaken for taxonomy-checked literature;
3. they are `export_eligible` — a confirmation that does not reach the runtime index has not closed the loop it exists to close; and
4. rule 4 above still governs them: where a confirmation disagrees with a published source, the name becomes ambiguous and drops out of the runtime index rather than one source overwriting the other.

The transcripts that motivated a confirmation stay out of this directory entirely. They live only in the gitignored `review_queue.json` that `npm run plants:pull` writes.

The current primary build combines the Plateau State, Lagos State, southwestern anti-asthmatic, Port Harcourt, Bayelsa, Rivers State, and Ede South (Osun State) surveys. The Ogbomosho (Oyo State) tables are staged because several of their determinations disagree with the other sources for the same Yoruba name under a different spelling, which the ambiguity rule cannot see. The Kwara State table is staged because 56 of its 62 rows do not say which language their names are in. The Ile-Ife tables are quarantined because the publisher retracted the article. The 2025 review contributes a catalogue of 79 original studies to acquire, but its secondary mappings do not feed production.

### Rivers State: a source that had to be transcribed

The Ajibesin 2012 Rivers State survey is the largest South-South source here — 188 species from 460 households across every local government area — and the only one that could not be extracted by machine. Its PDF is a scan: `pdffonts` lists nothing, `pdfimages` shows one 2550×3300 image per page, and no OCR tool was available. Table 1 was read off the page images, and that reading is committed at `surveys/transcriptions/ajibesin-2012-rivers-table1.json` because it is the only form of the source this repository can rebuild from.

The transcription is therefore the thing to check, and three properties are checkable: 188 rows, specimen numbers PNM 1–188 with no gap and no repeat, and a family on every row. `scripts/build-rivers-survey.js` asserts all three before writing, and the tests assert them against the committed file. Botanical names are checked downstream by GBIF, where a misread letter surfaces as an unresolved name rather than a wrong species. **A misread local name cannot be checked by anything.** That is the cost of using a scan, and why the source records `extraction_method`.

Local names are printed with the language bracketed after them, in the four the paper names. Three map onto ISO 639-3 — Ikwerre `ikw` (83 names), Kalabari `ijn` (38), Ekpeye `ekp` (31). **Ogoni does not**: it names a cluster — Khana, Gokana, Eleme, Baan, Tee — so its 32 rows keep `language_as_published: "Ogoni"` and carry no code, rather than this repository picking one the paper does not state. Four more rows print no language at all, and one repeats the botanical name in the local-name column (`"Aloe vera"`) and yields no mapping. Two pairs of specimens share a merged cell and are paired in printed order; all four are flagged.

The plant-part column was transcribed in a second pass, and is read by looking for known part terms rather than by splitting on punctuation — the cells run words together where the print wrapped (`RootLeaves`, `LeavesBran`, `leavesTuber`) and every one ends in a bracketed run of local-government codes that are not parts. Terms are matched longest-first so *whole plant* is not read as *plant*, earliest-first so the parts come out in the order the cell prints them, and anything a cell contains that matches no term is reported by the builder rather than dropped. All 188 cells parse with nothing left over.

*stem bark* and *root bark* are deliberately absent from that vocabulary, though both are real parts and appear in other sources: in this table the word pair only ever arises from a wrap — "Stem and bark", or Root and Bark printed on two lines against two preparations — so reading it as one part would invent a part and lose one.

### Bayelsa: reading one column two ways

The Bayelsa trado-orthopedic survey is the first Ijaw source in the index and the second from the South-South. Its Table 2 prints the English common name and the Ijaw name in a single cell separated by a slash — in either order, and sometimes only one of the two — and nothing in the cell says which is which. `scripts/extract-bayelsa-survey.js` lists the thirty-six English names read off that table and treats everything else in the cell as Ijaw, keeping the cell verbatim in `vernacular_as_published`.

A list rather than a rule, because no rule is honest here: *Haronga* looks Ijaw and is an English book name taken from the genus, while *Aguava* looks English and is the cell's rendering of the local name. Two cells yield no Ijaw name at all — *Hospital too far* for Jatropha tanjorensis and *Native pop* for Ficus lutea are both English. Table 3 gives preparation in prose rather than a parts column, so the rows claim no plant parts.

The article is diamond open access with no reuse licence stated in the PDF, on the journal site, or in Crossref and OpenAlex metadata. It is ingested on the same terms as `sonibare-2008-anti-asthmatic`: freely readable, reuse terms unstated, only the published name mappings used.

To reproduce it from the article PDF:

```sh
pdftotext -layout bayelsa.pdf bayelsa.txt
node scripts/extract-bayelsa-survey.js --text bayelsa.txt
```

### Port Harcourt: what was adjudicated

The Port Harcourt table was held in staged review over two defects. Both were resolved against the published table rather than by re-extraction, and both are recorded in the rows.

Its serials run 1-83 with no gap and no duplicate, and one further row carries no serial at all — so the article's "83 species" counts the numbered rows while Table 1 displays 84. The unnumbered row is *Acanthus montanus*, complete and taxonomically resolvable, and it is kept with `serial_as_published: null` and its `unnumbered_source_row` flag. Discarding a published row because the authors missed a serial would lose a real mapping; it contributes the Igbo name *Nyin-yiog-wu*.

Three rows print the botanical name in the common-name column and the common name in the botanical column — serials 47, 48 and 49, which are *Azadirachta indica*, *Moringa oleifera* and *Persea americana*. GBIF matches the common-name cell to an accepted species and the botanical cell to nothing in all three, which is what settled it. The values are recorded under the attribute they describe, and what each column printed is kept verbatim in `source_columns_as_printed`. Only one of the three had been flagged during extraction.

Two species are listed twice by the authors, with differing vernacular spellings; both printings are kept. Seven rows carry a botanical name that resolves to no accepted species — misspellings such as *Telfaria occidentalis* and *Dioscoreae cayennensis*, and one genus-only `Grewia sp`. These are left exactly as published, so the build withholds them as `taxonomy_unresolved` rather than this repository guessing at what the authors meant.

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

## Contested names

A name reported for more than one taxon is exported with `botanical: null`. The build does not choose between sources, and that rule is what keeps a guess out of the index — but for a long time it was also the end of the matter. Forty-five names sat there with nothing able to move them, including `uziza`, where three sources say *Piper guineense* and one row of a fourth says liquorice.

`npm run plants:adjudicate` shows what is contested and how, and `npm run plants:adjudicate:propose` writes a pending entry per name into `name_adjudications.json` with the candidates, their source rows, and the shape of the disagreement. A reviewer edits that file and rebuilds.

A reviewer may say exactly two things:

- **`source_row_error`** — this row of this source is wrong, and here is why. A claim about a publication, checkable by anyone who opens it. It removes that row from the candidates; it does not nominate a winner. If one candidate is left the name resolves on its own, and if two are left it stays contested. The struck row stays in `vernacular_names.json`, marked `adjudicated_out` with the reason and the reviewer.
- **`contest_upheld`** — the disagreement is real. Nothing changes, the name keeps its null, and the reasoning is on record so the name stops coming back to the queue.

There is deliberately no "the answer is X". Picking a winner is unfalsifiable and would put a reviewer's opinion where the build's rule used to be; saying "PNM 133 of this paper is a typo" can be checked against page 1136. Both decisions need a reason and a pseudonymous `reviewed_by`, and an entry missing either is treated as still pending rather than quietly applied.

Most of what is contested is not error. Of the 45, twenty-nine are one source disagreeing with itself and seventeen are species of the same genus — a folk name covering a species pair is ordinary and correct. *Ayunre* is both *Albizia ferruginea* and *Albizia lebbeck*; *eyin olobe* is both *Phyllanthus amarus* and *Phyllanthus niruri*. The honest record of those is `contest_upheld` with a reason, not a species chosen to make a number go up.

The proposals also report how many rows name each taxon. That is for deciding what to read first, and nothing in the build reads it: counting rows is not evidence about a plant.

## Rebuild

The checked-in survey and taxonomy caches make normal builds offline and repeatable:

```sh
npm run plants:build
node "sanko-landing page/scripts/sync-plant-count.mjs"
npm test
```

`npm run plants:resolver` rebuilds the public pages under `sanko-landing page/public/plants/`
from the same data. It reads one optional environment variable:

```sh
SANKO_WHATSAPP_NUMBER="+234..." npm run plants:resolver
```

`SANKO_WHATSAPP_NUMBER` is the number the "Ask Sanko on WhatsApp" button on each name page
opens a chat with, written however you like — the build reduces it to the digits `wa.me`
wants. **Unset, no button is rendered on any page**, which is deliberate: a `wa.me` link to
a number Sanko does not own opens a chat with a stranger, so the absence of a number
produces the absence of a link rather than a placeholder. The committed pages are built
without it; the deployment sets it.

The prefilled question differs for a contested name — it asks what each source says, not
which one is right — because the agent is not allowed to settle a contest either.

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

To reproduce the Ede South, Ogbomosho, and Kwara tables from their Europe PMC full-text XML (`https://www.ebi.ac.uk/europepmc/webservices/rest/<PMCID>/fullTextXML`):

```sh
node scripts/import-jats-surveys.js lawal-2020-ede-south /path/to/PMC7286022.xml
node scripts/import-jats-surveys.js odebunmi-2022-ogbomosho /path/to/PMC9573491.xml   # writes to surveys/staged/
node scripts/import-jats-surveys.js evbuomwan-2023-kwara /path/to/PMC10504731.xml     # writes to surveys/staged/
```

Adding a source can remove resolved names as well as add them: where it gives a different taxon for a name the index already had, export rule 4 turns that name ambiguous. Compare `resolved_runtime_mappings` and `ambiguities.json` before and after, and read the names that dropped out.

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

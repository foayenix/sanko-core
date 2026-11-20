# Plant literature index — reviewer guide

For doctors, pharmacists and scientists checking entries in Sanko's open plant
literature index. Read this once fully before your first sheet; afterwards the
tables in sections 5–7 are the reference.

**Version:** 1.0, 19 November 2026. Specification:
`docs/SANKO_EVIDENCE_ATLAS_SPEC.md`. Data rules: `data/literature/README.md`.

## 1. What you are doing

Sanko is building a public index of published research on medicinal plants
recorded in Nigerian ethnobotanical surveys. A computer has searched the
literature and guessed what each study is. **Nothing becomes public until a
person has checked it against the study itself.** You are that person.

You are checking *what a study is*, not *whether the plant works*. You never
judge effectiveness, rate quality, or summarise findings. That belongs to the
reviewed evidence profiles, a separate later step.

The current priority, decided on 19 November 2026, is **safety studies and
human studies first**. Your sheets will mostly contain those.

## 2. Rules that are not negotiable

1. **Never copy text from a study** into any cell — not the abstract, not a
   sentence, not a table. The index stores bibliographic facts and your
   classification only. Write notes in your own words, at most 280
   characters; a longer note is rejected.
2. **Classify what the study reports, not what you believe.** If the paper says
   it is about *Vernonia amygdalina*, you record that, even if you doubt the
   identification. Doubts go in `notes`.
3. **No patient, practitioner or Sanko user information** anywhere in a sheet.
4. **Declare conflicts.** If you are an author of a study, or have a financial
   link to a product made from a plant you are reviewing, tell the coordinator
   and skip those rows.
5. **Your reviewer id is a pseudonym** the coordinator gives you (for example
   `rev-adaeze` or `rev-07`). Your name and email are never stored.
6. **Do not guess to fill a cell.** Where the study does not say, use
   `not_reported` / `not_stated`. "Not stated" is a valid, useful answer.

## 3. Your sheet

Sheets are CSV files that open in Excel, Google Sheets or LibreOffice. Do not
change the column names or the `entry_id` column. Save as CSV when you finish.
`allowed-values.csv` always comes with your sheet and lists every permitted value.

**Left-hand columns (read-only):** the entry id, plant, title, year, journal,
`link` to the study, retraction status and publication type.

**`auto_*` columns (review queue only):** what the computer guessed. Treat them
as suggestions that are often wrong.

**Right-hand columns:** yours. In a **review queue** sheet, a blank right-hand
cell means "the automated guess is correct" — so only leave a cell blank if you
checked it and agree. In a **calibration** sheet there are no guesses: fill
every column for every row you include, and record `minutes_spent`.

Multiple values in one cell are separated by a semicolon and space:
`leaf; stem_bark`.

## 4. Each row, step by step

1. Open the `link`. Use the full text where you can; the abstract alone is not
   enough to answer the voucher question.
2. Confirm the study is about this plant (section 5.2).
3. Decide `include` or `exclude` (section 5.1). For an exclusion, give the
   reason and move on.
4. For an include, fill the classification columns (sections 6 and 7).
5. Answer `voucher_reported` (section 7.1). It is required for every include.
6. Add a short note only where something would help the next person.

Aim for consistency rather than speed. The calibration round measures how long
this really takes.

## 5. Include or exclude

### 5.1 Decision

**Include** when the study reports **original data** about this plant or an
extract of it: an experiment, a trial, an observational study, a case report,
an ethnobotanical survey listing the plant, a chemical analysis, or a
systematic review with a stated search method.

**Exclude** with exactly one reason:

| `exclusion_reason` | Use when |
| --- | --- |
| `wrong_taxon` | The study is about a different plant, or only a genus ("*Vernonia* sp."), or names the plant ambiguously |
| `no_original_data` | Narrative review, commentary, book review, protocol with no results |
| `name_only_mention` | The plant appears only in passing: a list in the introduction, a reference, a comparison plant not actually tested |
| `duplicate` | The same study already appears as another entry (note the other entry id) |
| `not_retrievable` | You cannot get the full text or enough of it to answer the required columns. This is recorded and revisited, not final |
| `not_research_publication` | Patent, erratum, notice, news item |

A **retracted** study whose original data concerned this plant is still
**included**: the public page shows it struck through with the retraction. A
**preprint** is included and labelled as not peer reviewed.

### 5.2 The plant name

| Column | What to record |
| --- | --- |
| `botanical_name_as_published` | The scientific name exactly as the study prints it, without the author abbreviation: `Vernonia amygdalina`, not `Vernonia amygdalina Del.` |
| `name_resolution` | `exact` if that is the plant's accepted name (shown in the `taxon` column); `synonym` if it is another name for the same species (the public plant page lists known older names, e.g. *Vernonia amygdalina* for *Gymnanthemum amygdalinum*) |

If you cannot tell whether the printed name means this species, exclude as
`wrong_taxon` and explain in `notes`. An include must have a resolved name.

## 6. What kind of study it is

### 6.1 `evidence_kind` — choose one, using the first rule that fits

| Order | Value | The study… |
| --- | --- | --- |
| 1 | `systematic_review` | …searched the literature with a stated, reproducible method (with or without meta-analysis) |
| 2 | `human_interventional` | …gave people the plant or a preparation and measured an outcome (randomised or not, any size) |
| 3 | `case_report` | …describes one or a few named clinical cases, typically poisoning or an adverse event |
| 4 | `human_observational` | …observed people without assigning the plant: cohort, case-control, cross-sectional, a survey of patients' herbal use |
| 5 | `ethnobotanical_report` | …surveyed healers or communities about which plants they use |
| 6 | `animal` | …tested the plant in live animals (rats, mice, rabbits, fish, chickens…) |
| 7 | `in_vitro` | …tested it on cells, microorganisms, enzymes or in a test tube, including computer docking |
| 8 | `analytical_quality` | …only analysed composition: phytochemistry, nutrients, contaminants, standardisation |

When a paper has several parts (for example in vitro and animal), choose the
one **highest in the table**.

### 6.2 `is_safety_study`

`yes` when toxicity, adverse effects, herb–drug interactions, contamination
that matters for safety, or poisoning is **a stated aim or a reported outcome**
— acute or repeated-dose toxicity, LD50, genotoxicity, reproductive toxicity,
case reports of harm. A study that only measured liver enzymes as one of many
efficacy outcomes is `no` unless it reports them as a safety finding.

### 6.3 Other classification columns

| Column | Values | Guidance |
| --- | --- | --- |
| `plant_part` | see `allowed-values.csv` | All parts actually tested. `not_reported` if the study does not say |
| `preparation` | free text | As published, briefly: `aqueous`, `ethanol`, `decoction`, `essential oil`. `not_reported` if absent |
| `model` | `human`, `rat`, `mouse`, `rabbit`, `other_animal`, `cell_line`, `microorganism`, `chemical_assay`, `not_reported` | The main test system |
| `area_studied` | see `allowed-values.csv` | The body systems or outcomes **studied**. One or more. Use `toxicology` for safety outcomes and `other` only if nothing fits |
| `collection_country` | two-letter code, e.g. `NG`, `GH`, `CM`, or `not_reported` | Where the plant material came from |
| `study_country` | two-letter code or `not_reported` | Where the work was carried out |

## 7. Questions with special weight

### 7.1 `voucher_reported`

This tells readers whether anyone can check that the right plant was studied.
It is required for every include.

| Value | When |
| --- | --- |
| `yes` | The study gives a voucher or herbarium number, or states that a voucher specimen was deposited at a named herbarium |
| `no` | The study describes how the plant was identified (for example "identified by a botanist at the department") but gives no deposited voucher |
| `not_stated` | The study says nothing about how the plant was identified or authenticated |

Commercially bought material with no voucher is `no`; say "commercial source"
in `notes`. If only the abstract is available you usually cannot answer this:
use `not_retrievable` rather than guessing.

### 7.2 Hard cases

| Situation | Do this |
| --- | --- |
| A mixture of several plants | Include if this plant is a named ingredient and the mixture was tested; note "polyherbal" |
| An isolated compound from the plant | Include; note the compound name. The profile stage decides how much it applies |
| The plant is a food ingredient in an animal-feed trial | Include as `animal`, area `nutrition` |
| A survey lists the plant among 200 others | Include as `ethnobotanical_report` only if the plant appears in the results table; otherwise `name_only_mention` |
| You suspect misidentification (implausible location, wrong plant part) | Record what the study reports; explain your concern in `notes` |
| A conference abstract with results | Include if it has original data and enough detail to classify; otherwise `not_retrievable` |
| You disagree strongly with the automated guess | Correct it. Wrong guesses are expected and are what this step is for |

## 8. Calibration round

Before the main queue, two reviewers check the **same 50 entries
independently** on a blind sheet with no automated guesses.

1. The coordinator gives each reviewer their own copy of
   `calibration-1.csv`. Do not discuss rows until both are finished.
2. Fill every column for each include, and `minutes_spent` for every row.
3. The coordinator runs the agreement report (section 9). It shows where you
   disagree with each other, how often the computer was right, how long an
   entry takes, and how many safety or human studies the priority queue
   would miss.
4. Reviewers meet, settle each disagreement, and revise this guide where a rule
   was unclear. One reconciled sheet is then imported.

Some calibration rows come from outside the safety/human priority on purpose:
they measure what that priority misses.

## 9. Coordinator commands

A Claude Code session runs these on the founder's behalf, following
`docs/LITERATURE_COORDINATOR_RUNBOOK.md`. Reviewers only need sections 1–8.
Run from the repository root. Sheets are written to `data/literature/review/`,
which is not committed; send them to reviewers from there.

```bash
npm run literature:review -- calibration-sample --seed calibration-1
```

A blank copy of an existing sample can be regenerated at any time:

```bash
npm run literature:review -- calibration-sheet --seed calibration-1
```

```bash
npm run literature:review -- calibration-report --seed calibration-1 --a <reviewer-a.csv> --reviewer-a <id> --b <reviewer-b.csv> --reviewer-b <id>
```

```bash
npm run literature:review -- verify --file <reconciled.csv> --reviewer <id>
```

```bash
npm run literature:review -- queue
```

```bash
npm run literature:review -- status
```

```bash
npm run literature:build
```

`queue` writes the safety and human priority queue; add `--scope all` for every
unverified entry. `verify` imports nothing if any row is invalid and lists the
problems; fix the sheet and run it again. Commit
`data/literature/verifications.json` and the files in
`data/literature/calibration/` after each import or report.

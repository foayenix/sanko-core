# Sanko Evidence Atlas — specification

**Status:** specification, not implementation. Nothing described here is built,
deployed, reviewed or released unless a later implementation record says so.\
**Prepared:** 18 November 2026\
**Owner:** founder\
**Related:** `SANKO_SOURCE_OF_TRUTH.md` (decision 14),
`docs/SANKO_FORMULATION_EVIDENCE_IMPLEMENTATION_PLAN.md`,
`docs/EVIDENCE_IMPLEMENTATION.md`, `data/plants/README.md`.

## 1. Founder decisions this spec implements

Recorded 18 November 2026:

1. **No consumer health publishing.** Sanko does not publish a Healthline- or
   MedlinePlus-style site for the general public at this stage.
2. **Primary audience is clinicians and researchers.** A public explainer layer
   may follow later and needs its own decision.
3. **Reviewers:** the founder reviews alongside independent doctors and
   scientists Sanko engages. The independence rules in section 6.4 apply.
4. **The plant literature index is approved as open public.** It is a
   bibliographic tool modelled on PubMed's role, not PMC's: it links to papers
   and does not host them.
5. **The index comes first.** The 20-plant evidence-profile pilot draws its
   sources from the index.
6. **Safety and human studies are verified first** (19 November 2026). The
   review queue defaults to entries the automated pass flagged as safety or
   human studies; laboratory and animal studies follow. A two-reviewer
   calibration round measures what that flag misses. Reviewer instructions:
   `docs/LITERATURE_REVIEWER_GUIDE.md`.

## 2. Purpose

Sanko's long-term evidence will come from practitioner-documented,
formulation-linked outcomes (real-world evidence). That takes years of adoption
and follow-up. The Atlas uses what already exists — published literature — to:

- show, per plant, what has and has not been studied, by study type;
- give clinicians and researchers reviewed, safety-first evidence profiles;
- expose research gaps that funders and universities can act on;
- give future real-world observations a literature baseline to be compared with.

The Atlas organises published evidence. It does not prove that any plant or
preparation works, and it never gives patient-specific advice.

## 3. Three layers

| Layer | Modelled on | Access | Content | Status |
| --- | --- | --- | --- | --- |
| 1. Plant literature index | PubMed (index, not archive) | **Open**, no account | Plant ↔ study links with bibliographic metadata and study-type classification | Approved; build first |
| 2. Evidence profiles | Systematic-review summaries | **Verified clinicians and researchers** | Reviewed syntheses: identity, safety, evidence by type, certainty, gaps | Approved for pilot (20 plants) |
| 3. Public explainers | MedlinePlus herb pages (tone only) | Public | Plain-language summaries derived only from released profiles | **Not approved.** Future decision |

## 4. Boundaries that do not change

- **No Vault or care data in the Atlas.** Neither the index nor profiles read
  practitioner records, patient records, formulation snapshots or aggregate
  counts derived from them. Prioritisation uses published sources only
  (section 7.1). This is enforced by building the index from committed public
  data in a pipeline that has no database credentials (section 5.7).
- **No recommendations, doses or treatment selection.** Profiles state what was
  studied and how certain the findings are. They do not tell anyone to use a plant.
- **No hosted papers, abstracts or copyrighted extracts.** The index stores
  bibliographic facts and Sanko's own classifications, and links out. This follows
  `AGENTS.md` and the source-licence rules in `data/plants/README.md`.
- **The landing-page vision views stay fictional demonstrations.** The Atlas is a
  separate product surface and must not reuse their projected numbers.
- **Contributor terms remain a draft** and are not touched by this work.

## 5. Layer 1 — open plant literature index

### 5.1 Unit and scope

One **index entry** links one accepted taxon to one published study.

- Taxa: the `taxonomy_checked` records in `data/plants/plants.json` (472 of 473 at
  the time of writing; the `legacy_unverified` record is excluded until resolved).
- Studies: any published or preprinted work that reports original data on the
  taxon or an extract of it: ethnobotanical surveys, in vitro, animal, human
  observational, human interventional, systematic reviews, analytical/quality
  studies, and case reports.
- Geography: not restricted to Nigerian studies. A study of *Vernonia amygdalina*
  from Cameroon is relevant to a Nigerian clinician. Collection country is recorded.

### 5.2 Entry fields

Reuse the evidence workflow's vocabularies in `src/evidence/reports.js` so layer 2
can consume layer 1 without translation.

| Field | Values / notes |
| --- | --- |
| `entry_id` | Stable id |
| `taxon_id` | `plants.json` id |
| `botanical_name_as_published` | Exactly as printed; never rewritten |
| `name_resolution` | `exact`, `synonym`, `curated_correction`, `unresolved`, `pending` (name not in the title; a reviewer must record it). Unresolved and pending entries are not public |
| `study_id` | Stable id shared across taxa (one study can cover many plants) |
| `doi`, `pmid`, `pmcid` | Any available identifiers |
| `title`, `authors`, `year`, `journal` | Bibliographic facts |
| `publication_type` | `peer_reviewed`, `preprint`, `thesis`, `book_chapter`, `report` |
| `source_status` | Reuses `ENUMS.source_status`: `active`, `corrected`, `retracted`, `questioned`, `unknown` |
| `evidence_kind` | Reuses `ENUMS.evidence_kind`; `traditional_account` is not used in the index; add `case_report` |
| `plant_part` | As published, plus normalised term where unambiguous |
| `preparation` | Extract type/solvent/preparation as published, or `not_reported` |
| `model` | Cell line, animal species, or human population descriptor, or `not_reported` |
| `area_studied` | Controlled vocabulary of body systems/outcome areas (e.g. `metabolic`, `infection`, `hepatic_safety`); labelled "studied for", never "used for" |
| `is_safety_study` | Toxicity, adverse effect or interaction focus |
| `voucher_reported` | `yes`, `no`, `not_stated` — whether a voucher specimen backs the identity; null until a reviewer answers |
| `collection_country`, `study_country` | ISO 3166 codes or `not_reported` |
| `full_text_link` | Publisher, PMC or Europe PMC link; never a Sanko-hosted copy |
| `classified_by` | `automated`, `human` (automated covers rules or a model) |
| `verified_by`, `verified_at` | Pseudonymous reviewer id and date; null until human-verified |
| `indexed_at`, `last_status_check_at` | Dates |

**Not stored:** abstracts, full text, figures, quotations, effect sizes, Sanko
summaries of what a study found, or any "supports/does not support" judgement.
Direction and certainty belong to reviewed layer-2 profiles.

### 5.3 Display rules (public)

Each plant page shows:

1. Accepted name, published synonyms and GBIF identifiers. Local names come
   only from the committed, source-cited `vernacular_names.json` and show the
   source and language exactly as the README requires (including "language not
   recorded").
2. A study-type breakdown that **always lists every type, including zeros**, with
   human interventional trials first. "0 human trials" is shown, not hidden.
3. Safety studies listed in their own section, above all other areas.
4. The study list, filterable by type, area, part, country and voucher status.
5. A fixed notice: *"This is an index of published research, not medical advice.
   The number of studies does not indicate that a plant is effective or safe.
   Most studies listed are laboratory or animal studies."* (the last sentence is
   shown only when true for that plant).

Prohibited on public pages: "benefits", "uses for", "helps with", "treats", star
ratings, ranking plants by study count, advertising, product links, and any
practitioner, Vault or Sanko-user signal (e.g. "popular with practitioners").

Retracted studies remain listed, struck through with the retraction notice. Preprints
are labelled. Automatically classified entries are counted in a separate "not yet verified"
bucket and excluded from the study-type breakdown until a human verifies them.

Pages may be indexed by search engines. Titles are bibliographic
(*"Vernonia amygdalina — published studies"*), never benefit-led.

### 5.4 Pipeline

1. **Discovery.** Extend `scripts/discover-sources.js` (`npm run plants:discover`)
   with a per-taxon mode: query Europe PMC by accepted name and published
   synonyms, falling back to Crossref/OpenAlex as the existing script does.
   Record each executed query, date, hit count and provider error, as the
   evidence workflow requires for searches.
2. **Deduplication** by DOI, then PMID/PMCID, then normalised title+year.
3. **Screening.** Include/exclude with a reason code (`wrong_taxon`,
   `no_original_data`, `name_only_mention`, `duplicate`, `not_retrievable`).
   Exclusions are kept, not deleted.
4. **Classification.** Automated classification of `evidence_kind`, `model`,
   `plant_part`, `area_studied` and `is_safety_study` from title and metadata is
   allowed, marked `classified_by: automated`. A human verifies against the
   source before the entry enters public counts.
5. **Status monitoring.** Monthly check of `source_status` against Crossref
   update metadata and the Retraction Watch data, recorded in
   `last_status_check_at`.
6. **Build.** A deterministic script generates the public dataset and pages from
   committed files. The same inputs produce the same output.

### 5.5 Data location

Following the plant-data pattern ("plant data must reproduce from committed
sources"):

- `data/literature/studies.json` — one record per study.
- `data/literature/index_entries.json` — taxon ↔ study links with automated screening and classification.
- `data/literature/searches.json` — executed queries and outcomes.
- `data/literature/verifications.json` — append-only human verification events (include/exclude with reason, corrected fields).
- `data/literature/README.md` — rules, as `data/plants/README.md` does for names.

Bibliographic metadata is factual and may be committed. Downloaded PDFs or
abstracts must not be committed.

### 5.6 Corrections

Public pages carry a "report an error in this entry" route that creates a review
item; it does not edit data directly. Corrections are versioned and the change is
visible in the entry history.

### 5.7 Hosting and separation

- A static site generated from `data/literature/` and `data/plants/`. No database
  connection, no Supabase credentials and no runtime API to the Vault.
- Its own build in CI with a test that fails if the Atlas build imports any module
  under `src/` that touches Supabase, care, Vault or evidence-request data.
- Brand follows `BRAND_IDENTITY.md` and `DESIGN.md`. It must not imitate the look of
  NLM/NIH or any government site.
- No analytics that identify individuals. Aggregate page counts only, if any.

### 5.8 Layer 1 acceptance criteria

- Every public count is reproducible from committed files.
- Every public entry has a working link to an external copy of the source and a
  human verification record.
- No public page contains abstract or full-text content, or a prohibited phrase
  (enforced by a test over the generated output).
- Zero-count study types render on every plant page.
- Separation test passes (section 5.7).
- `npm run lint`, `npm test`, `npm run check-secrets`, `npm run check-repository`
  pass.

## 6. Layer 2 — evidence profiles for verified professionals

### 6.1 What a profile is

A reviewed, versioned synthesis for one taxon (optionally one plant part), built
with the existing evidence workflow (`src/evidence/`). It is a new request type —
`atlas_profile` — with no practitioner owner and no formulation snapshot. Sources
come from the layer-1 index plus any targeted safety searches the protocol adds.

### 6.2 Profile sections (in this order)

1. **Identity and confusion risk** — accepted name, synonyms, known look-alikes
   and ambiguous local names (from `ambiguities.json`), and how often studies
   reported a voucher specimen.
2. **Safety** — toxicity (acute/repeated dose), human adverse-event reports,
   herb–drug interaction evidence, pregnancy and lactation, children, hepatic and
   renal signals. Each finding uses the evidence workflow's safety classes
   (observed clinical, case report, preclinical, mechanistic/theoretical,
   not assessed). "Not assessed" is stated, never left blank.
3. **Documented traditional use** — from published ethnobotanical sources only,
   cited, explicitly labelled as reported use and not evidence of effect.
4. **Evidence by outcome area** — for each area: study types, applicability
   (reusing `ENUMS.applicability`), finding direction (reusing
   `ENUMS.finding_direction`, including `null` and `adverse`), and a certainty
   statement (6.3).
5. **Research gaps** — what study would most reduce uncertainty.
6. **Methods** — search protocol, executed queries and dates, screening counts,
   exclusions, coverage limitations.
7. **Review record** — reviewers' roles, competence snapshot, conflict-of-interest
   statements, decision, version, date, and supersession history.

### 6.3 Certainty statements

Human-outcome certainty uses five levels: **no human evidence**, **very low**,
**low**, **moderate**, **high**, adapted from GRADE principles (risk of bias,
inconsistency, indirectness, imprecision, publication bias). Preclinical findings
never raise a human-outcome certainty level and are reported separately as
*"preclinical signal: present / absent / conflicting"*.

Profiles do not use "effective", "recommended", or dosing language.

### 6.4 Reviewer model

| Role | Who | Responsibility |
| --- | --- | --- |
| Analyst | Founder or trained analyst | Search, screen, extract, draft |
| Clinical reviewer | Medical doctor or pharmacist, ideally with pharmacology/toxicology experience | Safety section, interactions, clinical wording |
| Scientific reviewer | Pharmacognosist, pharmacologist or toxicologist | Study quality, preparation applicability, certainty levels |
| Botanical identity reviewer | Botanist/taxonomist (required for the pilot batch) | Identity, look-alikes, voucher interpretation |

Rules:

- The author of a profile revision cannot approve or release it. This already
  holds in the evidence workflow and stays enforced. The founder may act as
  analyst *or* as a reviewer on a given profile, never both.
- Release needs **both** a clinical and a scientific sign-off on the same revision
  hash. In the pilot batch, a botanical identity sign-off is also required.
- At least one signing reviewer on every profile is not a Sanko employee or
  shareholder.
- Each reviewer files a conflict-of-interest declaration per profile (including
  ties to herbal product sellers) and is paid a stated fee. The fee schedule is a
  founder decision (section 9).
- Substantive revisions need renewed sign-off. Negative and "no human evidence"
  profiles are releasable.

### 6.5 Access

- New principal role `atlas_reader`, separate from owner/analyst/reviewer roles.
- Verification is manual in the pilot. Proposed evidence: a professional register
  entry (for example the Medical and Dental Council of Nigeria or the Pharmacists
  Council of Nigeria, or the equivalent body elsewhere), or an institutional
  research affiliation with ORCID. The accepted list is a founder decision.
- Readers accept terms: no redistribution of profile text, not for patient-facing
  material, cite by profile id and version.
- Every profile view and download is audited. Access can be revoked.
- Institutional access (programme-wide) can later be part of an institutional
  agreement, consistent with section 15 of the source of truth.

### 6.6 Maintenance

A released profile records its search date. It is flagged *"update due"* when the
index gains a new human study or safety study for that taxon, or 24 months after
its search date, whichever comes first. Superseded versions remain retrievable by
id for citation.

## 7. Pilot — 20 plants

### 7.1 Selection (published data only)

Score `taxonomy_checked` taxa on:

1. **Use breadth** — number of distinct included sources in
   `data/plants/observations.json` reporting the taxon.
2. **Evidence volume** — layer-1 count of human and animal studies.
3. **Safety concern** — any layer-1 safety study or case report.
4. **Identity cleanliness** — no unresolved ambiguity in `ambiguities.json`, or a
   deliberate inclusion of 2–3 high-confusion taxa to test the identity section.

Pick about 14 by combined score, 3 safety-led and 3 identity-hard. The selection
script and its output are committed so the choice is auditable.

### 7.2 Phases

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| A. Index tooling | Schema, discovery per taxon, screening, classification, build, separation test | Acceptance criteria 5.8 on the 20 pilot taxa, all human-verified |
| B. Index coverage | All 472 `taxonomy_checked` taxa; automatically classified entries counted as awaiting verification | Public site live with the 20 verified taxa; others shown with "not yet verified" counts |
| C. Profiles | 20 profiles through analyst → clinical + scientific (+ botanical) sign-off | Measured outcomes in 7.3 recorded per profile |

B and C run in parallel once A exits.

### 7.3 What the pilot measures

- Analyst hours and reviewer hours per profile, by stage.
- Model classification accuracy against human verification, by field.
- Blocking review comments per profile, by type (identity, safety, quality,
  wording).
- Proportion of taxa with zero human studies, and with zero safety studies.
- Inter-reviewer disagreement on certainty levels.

These numbers decide whether profiles scale beyond 20, how many reviewers are
needed, and the real cost per profile. No scale-up target is set before they exist.

## 8. Layer 3 — public explainers (future, not approved)

If later approved: written only from released profiles; MedlinePlus-style
conservative wording; safety first; no dosing; reviewed by a clinical reviewer
for public wording; linked to the profile version it derives from. Requires a new
founder decision covering audience, legal review per market and correction policy.

## 9. Decisions still open

| Decision | Needed before |
| --- | --- |
| Atlas name and domain (separate from the landing site or a subpath) | Phase B launch |
| Reviewer fee schedule and contract form | Phase C |
| Accepted credential list for `atlas_reader` | Phase C release |
| Whether automatically classified entries appear publicly at all, or only verified ones | Phase B launch (spec default: shown separately as "not yet verified") |
| Whether plants outside the Nigerian survey taxonomy are added | After pilot |
| Per-profile DOI deposit (e.g. Zenodo) for citability | After first releases — this is publication and needs its own decision |

## 10. Engineering plan

- `data/literature/` and its README (5.5).
- `scripts/literature-discover.js`: per-taxon counts and retrieval (a separate script rather than a mode of `discover-sources.js`, so the Atlas import graph stays isolated); `npm run literature:discover`. **Built (Phase A).**
- `scripts/literature-select-pilot.js`: section 7.1 scoring, committed output; `npm run literature:select-pilot`. **Built.**
- `scripts/literature-review.js`: reviewer spreadsheet queue and verification import; `npm run literature:review`. **Built.**
- `scripts/literature-build.js`: validate and build the public site and dataset; `npm run literature:build`, `npm run literature:check`. **Built.**
- `src/literature/`: vocabularies, classification, records, store/validation, site rendering. **Built.**
- `scripts/check-literature-status.js`: monthly retraction/correction monitoring. Not built.
- Static site package (location decided with the domain); separation and
  prohibited-phrase tests on generated output.
- Evidence workflow: `atlas_profile` request type without owner/snapshot, profile
  sections per 6.2, two-role sign-off rule, `atlas_reader` role and audited reads —
  as **new** migrations (027 onward). Existing migrations are not edited.
- Tests: schema validation of every committed literature file, reproducible build,
  zero-count rendering, no abstract/full-text fields in output, author cannot sign,
  release blocked without both sign-offs, `atlas_reader` cannot see drafts or
  Vault-linked evidence.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Study counts read as endorsement | Type breakdown with zeros, fixed notice, no ranking, bibliographic titles |
| Misidentified plants in source studies | Voucher field, identity section, botanical reviewer in pilot |
| Model misclassification shown publicly | Unverified entries excluded from breakdowns and labelled |
| Retracted studies shaping profiles | Monthly status checks; retracted sources cannot support findings |
| Private knowledge leaking via prioritisation | Selection from published data only; build has no database access |
| Reviewer independence questioned | Two-role sign-off, non-employee signer, COI declarations, paid fees |
| Profile cost exceeds capacity | Pilot measures cost before any scale-up commitment |
| Copyright | Metadata and own classifications only; links out; no hosted text |

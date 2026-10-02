# Sanko — Product Source of Truth and AI Development Guide

**Version:** 1.0\
**Prepared:** 29 September 2026\
**Product owner:** Felix Ayeni\
**Canonical repository:** https://github.com/foayenix/sanko-core\
**Repository snapshot reviewed:** `main` at `5dddddfe0ee74129c4bb907db4de28681f92645f` (19 September 2026)\
**Intended location:** `/SANKO_SOURCE_OF_TRUTH.md` in the repository root\
**Audience:** coding assistants, developers, designers, collaborators and the founder.

> **Read this before changing Sanko.** Sanko is practitioner-centred documentation, provenance and evidence infrastructure for African Traditional Medicine. Its immediate interface is WhatsApp. Its enduring asset is a trustworthy, permissioned connection between knowledge, its source, formulations and documented outcomes. Do not turn it into an autonomous clinician, a generic chatbot, a practitioner subscription business, or an unrestricted traditional-knowledge database.

## Contents

1. [How to use this document](#1-how-to-use-this-document)
2. [What Sanko is](#2-what-sanko-is)
3. [Decisions that define the product](#3-decisions-that-define-the-product)
4. [What Sanko is not](#4-what-sanko-is-not)
5. [Users, beneficiaries and paying customers](#5-users-beneficiaries-and-paying-customers)
6. [Product workflow and practitioner experience](#6-product-workflow-and-practitioner-experience)
7. [Domain model and data meaning](#7-domain-model-and-data-meaning)
8. [Plant knowledge and identification boundaries](#8-plant-knowledge-and-identification-boundaries)
9. [Patient tracking and formulation-linked outcomes](#9-patient-tracking-and-formulation-linked-outcomes)
10. [Ownership, permissions and knowledge governance](#10-ownership-permissions-and-knowledge-governance)
11. [AI responsibilities and model improvement](#11-ai-responsibilities-and-model-improvement)
12. [What the reviewed repository contains](#12-what-the-reviewed-repository-contains)
13. [Architecture and engineering boundaries](#13-architecture-and-engineering-boundaries)
14. [Public website, brand and claims](#14-public-website-brand-and-claims)
15. [Business model](#15-business-model)
16. [Development priorities and future direction](#16-development-priorities-and-future-direction)
17. [Measures of success](#17-measures-of-success)
18. [Rules for coding assistants](#18-rules-for-coding-assistants)
19. [Acceptance scenarios](#19-acceptance-scenarios)
20. [Known gaps and unresolved decisions](#20-known-gaps-and-unresolved-decisions)
21. [Repository installation instructions](#21-repository-installation-instructions)
22. [Sources and maintenance](#22-sources-and-maintenance)

## 1. How to use this document

This is a product definition and development guide. It combines founder decisions from Sanko conversations with a static review of the canonical repository. It is not a claim that all described capabilities are deployed, clinically validated, legally approved or commercially operational.

Use these labels throughout:

| Label | Meaning |
| --- | --- |
| **Established direction** | Founder-stated intent or an explicit current repository product rule. Preserve it unless the founder changes it. |
| **Code present** | Relevant implementation exists at the reviewed commit. This does not establish deployment, successful operation or field accuracy. |
| **Gated** | Code exists but use requires configuration and/or governance prerequisites. Do not switch it on as routine development. |
| **Required direction** | An engineering or product requirement derived from Sanko's mission. It may exceed the current implementation. |
| **Future** | A possible or intended later capability. It is not automatic permission to build it now. |
| **Unverified** | Not established by this review. Do not fill the gap with an assumption. |

### Authority and conflicts

- The founder's latest explicit product decision controls product direction. Older brainstorming and assistant suggestions do not silently override it.
- This document is the consolidated product reference. Read `AGENTS.md` for repository procedures and the relevant source code, migrations and tests for actual behaviour.
- `PRODUCT.md`, `BRAND_IDENTITY.md`, `DESIGN.md`, `PRIVACY.md` and governance documents remain relevant. Do not ignore them or replace them wholesale with this file.
- Running code establishes what the implementation does, not what Sanko ought to become. Existing defects are not product requirements.
- For a conflict about ownership, patient access, external sharing, pricing, clinical claims or product identity, identify the conflict and obtain a specific founder decision before changing that boundary. Continue unrelated, clearly authorised work.
- For ordinary implementation details within the agreed scope, use engineering judgement and proceed.
- No product document overrides an assistant's platform rules, security controls or applicable obligations.

**Staleness rule:** this build inventory is pinned to one commit. Before claiming something is built or absent in a later session, inspect the current canonical branch. Do not use an archived branch, mock screen or this historical snapshot as evidence of current deployment.

## 2. What Sanko is

### One sentence

**Sanko helps African traditional medicine practitioners preserve their knowledge as private, structured, traceable records and build a documented history of how their formulations are used and what outcomes are reported.**

### Full definition

Sanko is documentation, provenance and evidence infrastructure for African Traditional Medicine (ATM), beginning with practitioners in Nigeria. Practitioners use familiar communication methods—WhatsApp text, voice notes, photographs of notebooks and photographs of plants—to contribute information in their own language and words.

Sanko helps organise that information into a personal knowledge archive, called the **Vault**. The archive should preserve the original source, local terminology, practitioner attribution, uncertainty and subsequent corrections. With the appropriate activation and patient consent, treatment records can be connected to formulations and followed over time.

The long-term goal is a trustworthy foundation for research, safety investigation, public programmes and appropriate institutional collaboration, with permission and benefit-sharing. Documentation enables investigation; it does not itself prove that a treatment works.

WhatsApp is the current access channel. AI is an assisting technology. Neither is the entire business. Sanko's value lies in making knowledge usable and traceable while respecting the people and communities from whom it comes.

### Why it exists

The founder's ambition is to help African herbal medicine earn rigorous recognition alongside other established medical traditions. Sanko addresses a practical part of that ambition: valuable knowledge and records can be fragmented across memory, speech, notebooks and disconnected patient encounters.

Sanko should help practitioners answer:

- What did I record, and can I find it again?
- What exactly did I say or photograph, and what did the software infer?
- Which preparation did I use for a particular treatment?
- What happened afterwards, including no improvement, worsening and missing follow-up?
- Who may use this knowledge, for which purpose, and on what terms?

### Scope

Nigeria is the initial operating focus; African Traditional Medicine is the product's central domain. Future geographic expansion should respect different languages, traditions, rights-holders and governance arrangements. Do not treat Africa as a single language, practice or regulatory environment.

Sanko is not restricted to sickle cell disease. The founder's separate doctoral research interests may inform future research partnerships, but they do not turn the whole product into a sickle-cell study or make a university the owner of Sanko's records.

## 3. Decisions that define the product

1. **Practitioners use Sanko free.** Do not add practitioner subscriptions, paid record limits, paid exports or a fee to recover their own knowledge. Institutional revenue is the commercial direction.
2. **Practitioner value comes first.** Saving, finding and correcting useful records must be worthwhile before any research or institutional use exists.
3. **Knowledge is not acquired merely by storing it.** Sanko provides custody and processing; it does not silently claim ownership or an unrestricted commercial licence.
4. **Original words and provenance matter.** Keep local names, source material, language, attribution and uncertainty. Normalisation is an additional layer, not replacement of the source.
5. **Text, voice and photos are first-class inputs.** Do not describe or design Sanko as voice-note-only.
6. **Formulation-linked outcomes are central to the direction.** A disconnected collection of recipes or generic patient notes does not fulfil the long-term mission.
7. **The AI documents; it does not diagnose or prescribe.** Record practitioner-reported information without turning it into a Sanko recommendation.
8. **Privacy and permissions belong in code.** Prompts, UI labels and policy text alone are insufficient controls.
9. **Scientific uncertainty stays visible.** Missing, ambiguous, disputed and negative information must remain representable.
10. **Future research use requires governance.** Private Vault access, patient tracking, training, publication and commercial use are different purposes.
11. **Demonstrations stay demonstrably fictional.** Future numbers, sample records and mock partnerships must never pass as achieved results.
12. **Sanko Core is the development source of truth.** `foayenix/sanko-vault` is historical reference. Port selected work with its evidence; do not merge archive branches indiscriminately.

These are enduring product boundaries. A request such as “make this more commercial”, “improve onboarding” or “add AI” does not implicitly revoke them.

## 4. What Sanko is not

| Do not turn Sanko into… | Boundary |
| --- | --- |
| An autonomous doctor or herbal prescriber | No patient-specific diagnosis, dosage generation, treatment selection or replacement of clinical judgement. |
| A treatment efficacy certification engine | Documentation, reported improvement and model confidence are not clinical validation. |
| An AI plant-identification authority | A photograph or fluent botanical guess is not a verified specimen identification. |
| A generic WhatsApp chatbot business | The agent serves the archive, provenance and outcome workflows. Unrelated business automation is outside the core scope. |
| A wellness marketplace or booking platform | Do not import SANA's marketplace, commissions, booking or practitioner subscription model. SANA is a separate earlier venture. |
| A herbal shop or product manufacturer | Sanko does not become Yemkem's storefront or a medicine sales channel by default. |
| An unrestricted research dataset | Payment, affiliation or an API key does not grant access to private formulations or patient records. |
| A public directory of secret formulations | Public plant reference information and private practitioner knowledge have different permissions. |
| A compulsory data-contribution scheme | Declining optional knowledge use must not remove the practitioner's basic Vault access. |
| A fully deployed institutional platform because a demo exists | The 2030 persona screens are illustrative. A real aggregate dashboard has a much narrower purpose. |
| A self-training system that changes silently | Model updates need attributable data, evaluation and deliberate promotion. |

A later, explicitly approved expansion may introduce adjacent capabilities. It must explain why they serve Sanko, what new obligations they introduce, and how the existing boundaries remain intact.

## 5. Users, beneficiaries and paying customers

| Group | Job Sanko serves | Access boundary |
| --- | --- | --- |
| Traditional medicine practitioners | Capture, retrieve, correct and preserve knowledge; document treatment and follow-up where enabled | Their own Vault and authorised workflows; free practitioner access |
| Patients | Understand and choose whether care information is tracked; exercise applicable rights | Consent is separate from the practitioner's account; no public record exposure |
| Sanko operators and reviewers | Support users, investigate extraction errors and maintain quality | Controlled operational access; review is not ownership or permission to publish |
| Assisted-onboarding staff or field agents | Help practitioners contribute and use the service | Future operational option; delegated access must be attributable and limited |
| Practitioner associations | Support adoption and approved programmes | Membership does not automatically grant access to members' private knowledge |
| Universities and research teams | Investigate well-defined questions using appropriately governed information | Future project-specific access, not unrestricted browsing |
| Government, regulators, NGOs and funders | Support documentation programmes, infrastructure and appropriately scoped reporting | Contracts do not override practitioner or patient permissions |
| Commercial research partners | Explore agreed research or discovery opportunities | Explicit scope, permissions, attribution and benefit-sharing |

The public website primarily serves institutional visitors considering collaboration. The practitioner's everyday experience should remain simple and usable through WhatsApp.

**Assisted adoption:** the founder has considered hiring people to help practitioners who find the product confusing. This is a possible delivery method, not an approved staffing plan or proof that Sanko must become a consultancy. Measure the assistance required and its sustainability. Do not introduce a privileged agent role without its own identity, permissions and audit trail.

## 6. Product workflow and practitioner experience

### 6.1 Registration

**Code present:** registration collects the name the practitioner wishes to use and their practice region, in their own words. These are required before normal record-writing tools. Language is optional; experience and tradition are optional and self-declared.

- Ask one manageable question at a time. Do not impose a long form.
- Explain why region matters: local plant names can differ by place.
- Do not convert registration into professional verification or licensing.
- Preserve a remedy already supplied while asking for missing registration details.
- Keep account reads, export and deletion available despite incomplete onboarding.

### 6.2 Capture and structure

The core experience is:

1. The practitioner sends text, a voice note or a notebook photograph.
2. Voice or page content is transcribed where necessary.
3. The agent extracts what was actually supplied and retains uncertainty.
4. It asks only for meaningful clarification, then presents a readable summary.
5. The practitioner agrees to the summary.
6. Sanko saves the record and returns its actual reference code.
7. The practitioner can retrieve or correct it later.

Photographed pages and photographed plants are different inputs. A page may contain several formulations, which should be documented separately. A plant photo follows the specimen workflow in section 8.

**Partial information is acceptable.** Missing duration or quantity does not justify fabrication. Save a truthful partial record when it meets the actual minimum requirements. A completely unspecified remedy is not a meaningful formulation record.

### 6.3 Correction and retrieval

For an update, retrieve the current record, explain the proposed difference and obtain confirmation before overwriting it. Keep correction provenance. An operator's suggested correction must not silently become the practitioner's statement.

Use database-returned reference codes. Never invent `FM-`, `PT-`, `TX-` or `SP-` identifiers in conversational text.

### 6.4 Reasons to return

Prioritise reliable, immediate usefulness: finding an old preparation, correcting a record, keeping a personal collection organised, recording a newly encountered plant, and reviewing due follow-ups when enabled. More advanced summaries should grow from real data quality and practitioner need.

Do not make practitioners contribute to a research project before receiving value. Do not use unsolicited messaging or manipulative streaks as substitutes for a useful product.

### 6.5 Language and accessibility

English, Yorùbá, Igbo, Hausa and Nigerian Pidgin are intended communication languages, including mixed-language messages. This is a scope statement, not a claim of equal measured model accuracy across them.

Keep replies short and respectful. Use the practitioner's language where supported. Ask rather than guess when speech or handwriting is unclear. Do not force English, Latin plant names or technical terminology on practitioners. Preserve original spelling and diacritics even if a separate search key is normalised.

Avoid database field names, JSON, confidence percentages and internal feature flags in practitioner conversations. Describe only capabilities actually available in that session.

## 7. Domain model and data meaning

The following is a conceptual model, not a command to replace the existing schema.

| Concept | Meaning | Current evidence / intended distinction |
| --- | --- | --- |
| Practitioner | A knowledge contributor and account holder | Profile and registration exist; self-declared details are not verified credentials |
| Source material | The message, audio or page from which a record arose | Media and original text links exist; permission and retention still apply |
| Transcription | A machine or reviewed reading of audio/page content | Separate from extraction into formulation fields |
| Formulation | A particular documented combination and preparation, including a single ingredient where appropriate | `formulations`, generally with an `FM-` reference |
| Ingredient | A practitioner-stated ingredient, plant part and quantity | Local name must survive any botanical mapping |
| Botanical mapping | A sourced association between a name and a taxon | It is not proof of a photographed specimen's identity |
| Specimen record | A photograph associated with a practitioner's own name and context | `specimens`, generally with an `SP-` reference; not necessarily a physical voucher specimen |
| Formulation version | The specific composition/preparation recorded at a point in time | Required direction for robust longitudinal evidence; correction logs are not an immutable version system |
| Patient | A person associated with a practitioner's consented tracking workflow | `patients`, generally with a `PT-` reference |
| Treatment episode | An instance of treatment, optionally linked to a formulation in current code | `treatments`, generally with a `TX-` reference |
| Outcome observation | A dated report of what happened during/after an episode | Current code mainly updates an outcome and notes; a full observation timeline is future work |
| Correction / review | A proposed or accepted change, attributed to its source | Practitioner edits and operator proposals must remain distinguishable |
| Permission | Authorisation for a particular activity and subject | Patient tracking and contributor terms are different mechanisms |
| Knowledge use | A recorded downstream use and its purpose, counterparty and agreed benefit | Ledger code exists; an entry is not itself proof of complete authorisation |

### Required data principles

- Maintain stable relationships among practitioner, source, formulation, treatment and observation.
- Distinguish source text, extracted interpretation, normalised terminology and human review.
- Retain model/provider/prompt and plant-index provenance where the system can establish them. Never backfill historical provenance with today's settings.
- Keep “not recorded”, “unknown”, “not applicable”, “disputed” and negative results distinct where they have different meanings.
- Preserve raw quantities such as a local measure; do not invent a gram or millilitre equivalent.
- A condition label records what was reported. A normalised term or code must not manufacture a diagnosis.
- Do not merge two practitioners' formulations just because their plant lists overlap.
- Do not treat the same ingredients prepared differently as automatically equivalent.
- Do not let a later formulation edit retrospectively change what an earlier patient is recorded as having received.
- A future research extract must identify its dataset version, selection rules, transformations, exclusions and authorisation.

The idea of a formulation/outcome ontology or evidence graph is compatible with this model. Its formal name, schema and technology are not fixed merely because they appeared in brainstorming.

## 8. Plant knowledge and identification boundaries

### 8.1 Current approach

**Code present:** the practitioner supplies the local name. Application code resolves that name using `data/plant_lookup_v1.json`. The model does not supply the saved botanical name.

For photographs, Sanko asks what the practitioner calls the plant. `save_specimen` checks that the submitted name appears in the practitioner's current-turn words. It does not offer an AI-generated species for the practitioner to endorse.

The result can be:

- A name with a mapping in the index.
- A name with competing mappings and no single botanical answer.
- A name not yet in the index.

All three are valid information. Unresolved names create review work rather than permission to guess.

**Say:** “Sanko's index maps this local name to…”\
**Do not say:** “This photograph is definitely…”

### 8.2 Evidence levels must remain separate

| Evidence | What it establishes |
| --- | --- |
| Practitioner-provided local name | What that practitioner calls the plant |
| Published vernacular mapping | What a particular source reports, with its context |
| Automated taxonomy check | Nomenclatural reconciliation, not human botanical verification |
| Practitioner confirmation | An attributed human statement, not automatically a laboratory or voucher determination |
| Independent specimen review | A separate review of a specimen, if a governed workflow is implemented |
| Clinical evidence | A different question entirely; plant identity alone establishes neither safety nor efficacy |

### 8.3 Data maintenance

The runtime index is generated. Maintain source data, eligibility, taxonomy caches, ambiguity records and review provenance under `data/plants/`; then rebuild. Do not hand-edit the generated index to inflate coverage.

Respect excluded, staged, quarantined and legacy-unverified material. Discovery results are candidates, not automatically eligible mappings. Copyrighted books and private practitioner speech must not be committed as source extracts merely to make a build convenient.

At the reviewed commit, the runtime JSON contains **479 name rows, 442 with a botanical value, representing 249 distinct botanical values**. These are index counts, not numbers of clinically validated medicinal plants. Recompute them from the current file before reuse.

### 8.4 The earlier Yes / No / Not sure idea

The founder proposed practitioner feedback for plant identification. The current implementation makes a narrower, deliberate choice: collect the practitioner's own name first and avoid anchoring it with an AI guess.

Migration `018_specimens.sql` includes `specimen_identifications` for independent answers, including a restriction against the specimen owner reviewing their own record. A complete cross-practitioner review application is not present in the reviewed workflow.

Treat **Yes / No / Not sure** as a future independent-review direction, subject to permissions and protocol design. It is not permission to enable confident photo identification or to train automatically on every “yes”.

The current workflow does not read EXIF coordinates. Do not silently introduce precise collection-site capture or public location disclosure.

## 9. Patient tracking and formulation-linked outcomes

### 9.1 Current implemented scope

Patient tools are disabled by default. The documented activation uses `AGENT_TOOLS=full` and `PATIENT_TRACKING_ENABLED=true`, following the required governance review. Do not enable them as part of unrelated work.

When enabled:

1. A practitioner supplies the minimum information for a patient invitation.
2. Sanko sends an invitation to that patient's WhatsApp number.
3. A pending invitation is not consent or an active treatment record.
4. Acceptance must come from the invited number.
5. Declined or expired invitations are removed; pending invitations expire after seven days.
6. Treatment logging requires an active, consented patient.

Current treatment tools support a formulation link, reported condition, dates, follow-up date, outcome notes and outcomes including `ongoing`, `improved`, `resolved`, `no_change`, `worse` and `unknown`. A formulation link is currently optional, so not every treatment row is formulation-linked evidence.

`list_due_follow_ups` helps the practitioner retrieve due work. It is not evidence of an automated daily patient check-in programme. Do not claim that programme exists without locating and verifying its scheduler, messaging, consent and response handling.

### 9.2 The longitudinal goal

The founder wants practitioners eventually to inspect years of documented use of a formulation: who received it, for what reported condition, how it was prepared and used, and what happened afterwards.

**Required direction for that goal:**

- A stable formulation identity plus an immutable version or treatment-time snapshot.
- Treatment-specific preparation, dose and adherence information where reported and relevant.
- Baseline and dated follow-up observations using defined measures where appropriate.
- Reporter identity/role, source and observation time.
- Adverse-event reports, worsening, lack of improvement and lost follow-up.
- Distinction between patient report, practitioner report, a measured result and a research assessment.
- Explicit handling of repeated episodes, concurrent treatments and incomplete records.

These requirements describe work needed for trustworthy outcomes infrastructure. They are not claims that the current schema already provides it.

### 9.3 Analytics and evidence rules

Never convert an informal report into “proven efficacy”, “cure rate” or a Sanko treatment recommendation.

For example, if a **fictional demonstration** includes 100 episodes, 60 with follow-up and 48 reporting improvement, the defensible descriptive statement is “48 of 60 followed-up episodes reported improvement; 40 had no follow-up.” It is not evidence that the formulation is 80% effective, nor that 80% of all treated people improved.

Any real summary needs a defined measure, period, eligible cohort, denominator, missing-data account and limitations. Distinguish people from episodes and formula versions from broad formula names. A missing adverse-event report does not mean “no adverse events”.

Use evidence descriptions suited to their source: documented traditional use, reported observational outcome, research analysis, laboratory finding or clinical study result. Do not make these interchangeable badges.

Do not claim regulatory-grade dossiers, validated pharmacovigilance or clinical research readiness from the mere existence of structured fields.

## 10. Ownership, permissions and knowledge governance

### 10.1 Product commitment

Practitioners retain control of their contributed knowledge. Attribution, correction, access, export and deletion workflows are core product responsibilities. “Practitioner-owned” describes the knowledge-control commitment; it does not assert a particular corporate shareholding or cooperative legal structure.

Traditional knowledge may involve community rights and other rights-holders. Do not assume the account holder can license everything a community knows. Patient information also involves the patient's rights and the responsibilities of the relevant organisations; it is not a tradable asset owned solely by a practitioner.

### 10.2 Separate purposes

| Purpose | Required boundary |
| --- | --- |
| Private documentation | Process information to operate the practitioner's Vault under the applicable service arrangements |
| Patient tracking | Separate patient invitation/consent workflow and deployment governance |
| Operational support | Limited, attributable operator access for support and quality work |
| Model improvement | Appropriate contributor permission and controlled, attributable use of corrections/media |
| Independent plant review | Permission to show contributed material to the reviewer; no assumption that a photo is public |
| Research, licensing or publication | Use-specific authority, scope, attribution and agreed benefit before access |
| Public communication | Approved public material or clearly labelled synthetic content |

Do not infer one purpose's permission from another. In particular, agreeing to store a formula is not blanket permission for training or commercial discovery.

### 10.3 Current governance implementation

Contributor-terms acceptance, a version/hash mechanism and a knowledge-use ledger exist. Training/vision exports have contributor-eligibility screening and ledger integration.

**The terms are explicitly a draft, not in force.** The repository requires legal review and practitioner consultation before activation. `CONTRIBUTOR_TERMS_IN_FORCE` must remain disabled during routine development. Do not manufacture acceptance, remove checks or activate the flag simply to get an export working.

These mechanisms are foundations, not a complete research-access platform. Checking a current terms hash does not prove a separate agreement for every purpose, and recording benefit text does not prove benefits were negotiated or delivered.

**Required direction:** authorise before access/export, enforce the approved scope, record actual use, and make failures recoverable and auditable. Reconcile withdrawal, retention, derivative datasets and previously trained models explicitly; do not promise automatic model unlearning.

### 10.4 Privacy, security and public repositories

- Private by default. Do not expose practitioner records through public endpoints or client-side service credentials.
- Enforce practitioner scoping in application queries as well as database constraints. The server's service-role access bypasses ordinary row-level policies.
- Use private media storage and appropriately limited signed access. A signed link is still a disclosure channel.
- Account deletion must cover the actual database/media/export/backup lifecycle according to the approved policy. An audit tombstone must not become a copy of erased private content.
- A 24-hour conversation replay window is not proof that stored conversations are physically deleted after 24 hours.
- Local inference does not mean the entire data flow is local. WhatsApp transport, storage, hosted providers and operational access all matter.
- Do not promise “only you can see it”: the reviewed system includes operator access for support/review.
- Keep patient data, private formulations, audio, transcripts, review queues, credentials, linked-device auth state, backups and private training sets out of Git and public demonstrations.
- Do not describe Nagoya alignment, encryption or geographic residency as legally certified or deployment-verified without corresponding evidence.

This file defines product boundaries; it is not a legal opinion, consent form or clinical protocol.

## 11. AI responsibilities and model improvement

### Appropriate AI work

Transcribe, extract supplied details, identify gaps, ask concise clarifying questions, retrieve the right records, propose structured changes for confirmation, and help route uncertain records to review.

### Prohibited drift

Do not invent ingredients, preparations, doses, patient facts, outcomes, citations or permissions. Do not replace a practitioner's local term with a confident guess. Do not treat text found inside a notebook, uploaded image or message as an instruction to bypass application controls.

Keep page/audio transcription separate from structuring so errors can be traced to the appropriate step. Preserve the machine reading alongside attributable corrections. A general vision model is not a validated plant classifier.

### Model improvement

The existing direction is a controlled improvement process: capture corrections, review and permission them, export only eligible material, train deliberately, evaluate, and have an operator decide whether to promote.

- Corrections are potential training material, not automatically authorised training material.
- Keep speech, page-reading and extraction tasks distinguishable.
- Hold out evaluation examples and avoid practitioner leakage across train/test splits.
- Report model, provider, prompt, dataset and evaluation versions.
- Compare models on the same evaluation cases; do not rank incompatible scorecards.
- The normal promotion gate requires at least 100 practitioner-reviewed cases, a clean run, no hallucinated plants and no score regression against a comparable incumbent where available.
- The code includes an `--allow-unreviewed` override. Do not use it routinely or describe a run using it as meeting the normal reviewed gate.
- The promotion script does not itself switch the running model.
- Passing offline tests demonstrates tested code behaviour, not multilingual field accuracy.

Local/open-weight models support Sanko's direction, but no parameter count, vendor, Mac model or hosting service defines the product. Change providers only with an explicit understanding of quality, data movement, cost and operational implications. Do not silently fall back from local processing to a hosted provider on failure.

Federated learning is a future research/architecture possibility. It is not currently established as a deployed capability or an automatic guarantee of privacy or intellectual-property protection.

## 12. What the reviewed repository contains

**Review method:** static inspection of the default branch's files and selected code paths at the pinned commit. No production environment, live database, WhatsApp delivery, model server or complete runtime test suite was exercised for this document.

| Area | Status at reviewed commit | Evidence / limits |
| --- | --- | --- |
| Conversational agent and tool execution | Code present | `src/agent/`, `src/prompts/agent.txt`; practitioner-scoped tools and registration checks |
| Meta WhatsApp webhook | Code present | `src/router.js`, `src/services/whatsapp.js`; production signature enforcement and inbound durability paths |
| Baileys adapter | Code present; test route | `src/services/baileys.js`; allowlisted testing; README explicitly distinguishes it from production integration |
| Voice transcription | Code present; needs deployment qualification | `src/services/whisper.js`; accuracy depends on actual audio, language and model |
| Notebook/page transcription | Code present; needs deployment qualification | `src/services/vision.js`; separate transcription and source links; no field-accuracy finding here |
| Vault formulation create/read/update | Code present | `src/agent/tools.js`, `src/services/supabase.js`; source/provenance and correction mechanisms |
| Practitioner-named plant photographs | Code present | `save_specimen`, migration `018`; no AI species identification |
| Plant-name reference pipeline | Code/data present | `data/plants/`, generated runtime index and plant build/review scripts |
| Patient invitations and treatment records | Gated | Patient activation flags plus consent checks; not automatically active in a running deployment |
| Due follow-up listing | Code present within patient workflow | Retrieval of due treatments; no established automated daily patient check-in system |
| Account export/deletion | Code present | Tools and database/media operations; actual deployment lifecycle still needs verification |
| Operator/admin review | Code present | `src/admin.js`, `src/adminPage.js`; review proposals and transcript/page review |
| Browser simulator | Code present | `src/simulator.js`; testing surface using the agent path |
| Public aggregate dashboard | Code present | `src/dashboard.js`, `dashboardGetStats`; counts/activity, not research access to private records |
| Website and plant resolver pages | Assets/code present | `sanko-landing page/`; several generations of landing files coexist |
| Website enquiry collection | Schema/integration pieces; deployment unverified | Migration `016` and notification function; inspected landing assets include placeholder or blank production delivery configuration |
| Contributor terms and knowledge-use ledger | Gated foundations | `src/services/governance.js`, migration `013`; draft terms not in force |
| Training exports and evaluation tooling | Code present; use gated | `scripts/export-consent.js`, exporters, `evals/`, promotion/review scripts |
| Independent specimen identification | Schema foundation only in inspected workflow | `specimen_identifications`; do not mistake the table for a delivered review product |
| Immutable formulation versions + repeated outcome observations | Required direction; not established as a complete implemented system | Current treatments link to a formulation row and update outcome/notes |
| Researcher/regulator/public persona platform | Vision demo | React views and `src/data.js` under the landing project contain illustrative future data |
| Federated learning, clinical validation, production research marketplace | Future / unverified | Not established by the reviewed implementation |

**Important distinction:** `src/dashboard.js` is a real aggregate page implementation. The landing project's researcher/regulator/persona screens are a separate future-state demonstration. Neither grants institutions a right to private Vault records.

## 13. Architecture and engineering boundaries

### Existing structure

The backend is Node.js/CommonJS with Express, using Supabase/Postgres and storage. Agent, transcription and vision providers have separate service modules. The repository includes a React/Vite vision demo and static website assets.

The package declares Node.js `>=20.19.0` and Express `^5.2.1` at the reviewed commit. The README's stack line still says Express 4; consult `package.json` and the lockfile when changing dependencies.

| Location | Responsibility |
| --- | --- |
| `src/index.js` | HTTP entry point, routes and background cleanup/recovery |
| `src/router.js` | Meta ingestion and turn processing integration |
| `src/agent/index.js` | Agent execution loop |
| `src/agent/tools.js` | Tool definitions, validation/execution and feature selection |
| `src/agent/registration.js` | Registration prerequisites |
| `src/services/llm.js` | Model-provider abstraction |
| `src/services/whisper.js`, `vision.js` | Audio and page processing |
| `src/services/supabase.js` | Database/storage operations |
| `src/services/governance.js` | Terms, contributor eligibility and knowledge-use records |
| `src/utils/plantLookup.js` | Runtime name lookup and data-version reference |
| `supabase/` | Ordered database migrations and supporting functions |
| `data/plants/` | Plant source, taxonomy and review evidence |
| `tests/`, `evals/` | Software behaviour checks and model evaluation respectively |
| `sanko-landing page/` | Public website assets and distinct vision demonstration |
| `docs/MIGRATION_BACKLOG.md` | Archive work and qualification gaps |

### Preserve these boundaries

- Do not rewrite the stack or split it into services just because a coding assistant prefers another framework.
- Keep model decisions behind validated tools. Enforce important invariants outside the prompt.
- Preserve duplicate-message handling, per-practitioner turn ordering, inbound recovery and safe failure responses.
- Do not claim successful persistence or message delivery before receiving a successful result.
- Preserve migration filenames and applied SQL checksums. Add migrations; do not rewrite history or fill numbering gaps cosmetically.
- Retain account-level scoping for every read, write, lookup and media operation. Never accept arbitrary cross-account IDs from a model.
- Preserve separation of public aggregates, operator functions, private Vault information and future institutional access.
- Treat production deployment, model activation, governance activation and data migration as separate actions from writing code.
- Keep proprietary/private data and bulky runtime artifacts out of the source repository.

The product definition does not require a new graph database, blockchain, federated deployment or microservice architecture. Adopt technology for a demonstrated requirement.

## 14. Public website, brand and claims

### Website purpose

Help institutions quickly understand what Sanko does, why practitioner control and provenance matter, how to experience the available WhatsApp product, and how to start a partnership discussion.

The two primary journeys are **try/request access to Sanko on WhatsApp** and **discuss a partnership**. Label access according to the actual deployment: an access request is not immediate live access, and a validated form is not a delivered enquiry.

The founder has asked for a less dense hero. A concise opening should explain the practical product before asking visitors to understand the entire evidence vision. Do not cram the full ontology, architecture and revenue model into the hero.

### Claims discipline

- “Turn living knowledge into verifiable evidence” expresses a direction. Supporting copy must explain the documentation process and avoid implying clinical proof.
- Use “practitioner-reported”, “documented”, “structured” and “traceable” accurately.
- Label demo formulations, AI-created illustrations and projected outcome histories visibly where confusion could arise.
- Future figures must use future/conditional language beside the figures, not only a disclaimer elsewhere.
- Do not invent testimonials, customer logos, user counts, institutional endorsements, regulatory approvals or commercial agreements.
- Family connections, outreach and a demo's “partnership confirmed” text are not sufficient evidence of a signed partnership.
- Derive plant counts from the generated data and distinguish names, resolved mappings and taxa.
- Only claim local/private processing to the extent supported by the actual deployment. Do not copy older absolute residency/security claims without verification.

### Brand continuity

The reviewed repository names the **D1 Source Mark + SANKO** as the approved active identity. It uses the documented indigo/knowledge-record visual system, Archivo and IBM Plex Mono. Legacy bird, seal and earlier concept assets coexist in the repository; their presence is not an instruction to restore them as the primary logo.

Follow `BRAND_IDENTITY.md` and `DESIGN.md` for exact assets and tokens. The founder can approve later changes, but an AI should not redesign the identity while performing unrelated work. Keep mobile usability, contrast, keyboard access and reduced-motion support.

## 15. Business model

**Established direction:** Sanko is free for practitioners. Revenue should come from institutions and appropriately governed programmes or partnerships.

Potential commercial offerings, to be specified and validated individually:

| Offering | Possible paying organisation | What is being purchased |
| --- | --- | --- |
| Documentation/evidence programmes | Government, NGOs, foundations, associations | Programme setup, onboarding, operations and agreed reporting |
| Institutional infrastructure | Public bodies or institutions | Configured workflows, support, hosting and appropriate access controls |
| Research partnerships | Universities and research funders | Agreed research services and permissioned access appropriate to a specific project |
| Evidence analysis | Authorised institutional partners | Defined analysis with methods, limitations and permitted outputs |
| Commercial discovery collaboration | Relevant research/commercial partners | Negotiated work with attribution, rights and benefit-sharing |
| Governed interfaces/APIs | Authorised partners | A controlled service with explicit permitted uses, not unrestricted extraction |

These are business directions, not existing customers, signed contracts, approved price lists or instructions to build every product tier.

Do not monetise by selling unrestricted raw patient information, secret formulations or unconsented practitioner knowledge. Do not make knowledge contribution the hidden price of free access. Research access fees do not remove restrictions on reuse or redistribution.

No revenue forecast, valuation, contract amount or benefit-sharing percentage is established by this document. Derive commercial terms from an actual scope, costs, counterparties and founder decision.

## 16. Development priorities and future direction

The sequencing below is a **recommended implementation order derived from the product**, not a dated delivery promise or authorisation to start all work.

| Stage | Intended outcome | Evidence needed before broadening claims |
| --- | --- | --- |
| 1. Reliable practitioner archive | Practitioners can capture, retrieve and correct records with tolerable effort | End-to-end delivery, realistic language/media testing, recovery, ownership isolation and support learning |
| 2. Controlled adoption | A repeatable onboarding process and reasons to return | Actual usage/retention, consent comprehension and measured assistance costs |
| 3. Trustworthy treatment histories | Properly governed, formulation-specific longitudinal observations | Activated patient governance, historical formulation identity, repeated observations and interpretable measures |
| 4. Governed programmes and research | Useful institutional collaboration without losing contributor control | Scoped agreements, rights and access controls, auditability, methods and permitted outputs |
| 5. Broader evidence infrastructure | Interoperable, multi-site and potentially multi-country networks | Validated need, local governance, reliable semantics and operational capacity |

Longer-term possibilities include better language models, independently reviewed plant knowledge, evidence graphs, privacy-preserving collaboration, federated learning, research datasets and dossier-support workflows. They are separate initiatives with prerequisites.

Do not interpret speculative ideas—digital twins, automated drug discovery, autonomous clinical recommendations or continent-wide rollout—as current product requirements. The archive and its trustworthiness must survive any expansion.

## 17. Measures of success

Use metrics to learn, with definitions and permission-appropriate instrumentation. These are proposed measures, not reported achievements or fixed targets.

- **Practitioner usefulness:** first confirmed record, successful retrieval, voluntary return use, correction completion and time/assistance needed.
- **Reliability:** successful processing/persistence, duplicate rate, recovery success, failed delivery and response latency by input type.
- **Record quality:** provenance completeness, unsupported detail rate, correction burden, transcription errors and unresolved/ambiguous names.
- **Language inclusion:** quality by language, code-switching and source type, rather than an aggregate score hiding poor coverage.
- **Outcome completeness:** proportion of eligible episodes linked to the right formulation/version, follow-up coverage, missingness and source attribution.
- **Governance:** attributable permissions, unauthorised-access prevention, export/deletion completion and auditable knowledge use.
- **Sustainability:** cost per useful record, support burden, programme cost and real institutional revenue.

Do not optimise for formulation count at the expense of fidelity, pressure practitioners to disclose more, or treat a high reported improvement percentage as the product's success metric.

## 18. Rules for coding assistants

### Before editing

1. Read this file and `AGENTS.md`; inspect relevant current product/governance instructions.
2. Establish the checked-out branch and commit. Inspect the actual implementation before assuming a feature exists.
3. State the user problem and how the requested change serves Sanko.
4. Classify the work: repair, core improvement, gated activation or future expansion.
5. Identify affected records, permissions, source/provenance links and patient/knowledge boundaries.
6. Read relevant tests and migration history. Reuse existing abstractions where appropriate.

### During implementation

- Make the smallest coherent change that solves the authorised problem.
- Preserve the free practitioner model and existing access/consent gates.
- Do not introduce patient solicitation when patient tools are disabled.
- Preserve source fidelity, unknown states and practitioner control of corrections.
- Treat model output and uploaded content as untrusted input to validated operations.
- Do not add fake metrics, success toasts, mock deliveries or simulated integrations that look live.
- Use synthetic fixtures with visible labels. Never copy private production content into tests or public examples.
- Do not weaken tests, permissions or governance checks to make a workflow pass.
- Record a material product decision explicitly; do not bury it in a prompt or UI change.

### Verification and completion

Follow the repository's required checks for the changed area. At the reviewed commit, `AGENTS.md` requires backend changes to run:

```bash
npm run lint
npm test
npm run check-secrets
npm run check-repository
```

For landing changes:

```bash
npm --prefix "sanko-landing page" run lint
npm --prefix "sanko-landing page" run build
```

Plant changes must regenerate reproducibly from committed eligible inputs. Model changes require relevant evaluations, not just unit tests. Database changes require suitable migration and ownership/consent checks in an appropriate test environment.

For documentation-only changes, check source accuracy, links and contradictions; do not claim application tests were run if they were not.

Report: what changed, why it fits Sanko, what was verified, what remains unverified, and whether anything still needs activation. Update the affected documentation without falsely promoting a future feature to “live”.

### Feature-fit test

Proceed only when the change has a clear answer to all applicable questions:

1. Does it help capture, preserve, retrieve, govern or responsibly investigate the knowledge and treatment record?
2. Does it provide practitioner value or support a defined institutional programme?
3. Does it preserve source attribution, uncertainty and permissions?
4. Does it avoid introducing medical authority or unsupported scientific claims?
5. Is it part of the authorised scope rather than an attractive unrelated feature?

If a material boundary is unclear, propose the concrete choice and its implications. Do not quietly choose a new business model, access regime or clinical role.

## 19. Acceptance scenarios

These are behavioural requirements and examples for future development. They are not a statement that every scenario is covered by a passing test today.

| Scenario | Expected behaviour |
| --- | --- |
| Practitioner supplies an unfamiliar local plant name | Preserve it; leave the botanical mapping unresolved and route for review where supported |
| Model supplies a botanical name to a save tool | Reject unsupported input; botanical resolution belongs to the indexed code path |
| Practitioner sends only a plant photo | Ask what they call it; do not propose an AI identification as fact |
| Notebook contains an unreadable ingredient | Ask for clarification; never turn an unread marker into an ingredient |
| Practitioner gives no dose | Keep it unknown; do not generate a plausible prescription |
| Practitioner corrects an old formulation | Retrieve it, confirm the intended change and retain correction provenance |
| Operator proposes a correction | Record a proposal; do not silently overwrite the practitioner's approved formulation |
| Guessed reference code belongs to another practitioner | Return no accessible record; never reveal the other owner or contents |
| A patient invitation is pending | No treatment tracking before the invited patient's valid acceptance |
| Patient tools are disabled | Do not solicit or create patient-tracking records |
| Practitioner declines optional contribution terms | Preserve their basic Vault access |
| Export includes a contributor with no valid permission | Exclude/refuse as appropriate; do not bypass the gate |
| A training set is needed but terms are still a draft | Use appropriately permitted alternatives such as synthetic evaluation material; do not activate draft terms |
| Old outcomes exist and a formula is changed | Preserve historical treatment meaning; do not represent current composition as what was previously given |
| Follow-up is missing | Count it as missing, not improved and not automatically “no change” |
| Partner asks to download private formulas | Require the defined governance process; payment alone is insufficient |
| A public screen uses projected statistics | Label the projection at the numbers and keep it separate from actual usage |
| Local model fails | Give a truthful recoverable failure; no undisclosed hosted-model fallback |
| Someone asks for the most effective remedy for a patient | Do not convert Sanko's documentation agent into a prescribing service |

## 20. Known gaps and unresolved decisions

This section prevents assumptions from becoming implementation by accident. It records both observed limitations and decisions needing further work.

| Issue | Finding / boundary | Required next action when relevant |
| --- | --- | --- |
| Deployment status | Repository existence does not show which commit, flags, models, forms or transports are live | Inspect the actual deployment before making operational claims |
| Outcome history | Current treatment rows update outcome/notes and link to a mutable formulation; complete immutable versions and repeated measures are not established | Design historical formulation linkage and observations before claiming robust longitudinal analytics |
| Patient-facing follow-up | Due-listing exists; automated daily check-ins are not established by reviewed paths | Specify protocol, permissions, scheduling and response handling before building |
| Patient withdrawal | Policy describes withdrawal; a complete patient self-service withdrawal journey was not established in this review | Verify operational and technical handling before broad patient deployment |
| Governance authority | Draft terms and current-hash checks are not a full per-purpose access regime | Complete consultation/review and use-specific authorisation design |
| Governance enforcement details | `eligibility()` checks acceptance/hash; it does not itself check `in_force`. `recordKnowledgeUse()` relies on eligibility. Export ledger recording follows file creation | Review fail-closed activation, per-use authority and export failure recovery before enabling real downstream use |
| Benefit sharing | Principles exist; concrete terms, recipients and fulfilment processes are not fixed | Agree and record them with relevant rights-holders; do not invent percentages |
| Community knowledge | Individual vs community authority remains explicitly open in draft terms | Resolve within programme governance; no default blanket licence |
| Plant feedback | Named-specimen capture is implemented; independent review is not a finished application | Preserve current grounding and build only a specifically authorised review workflow |
| Model quality | Offline tests and model scripts do not establish accuracy with real practitioners | Qualify actual languages, audio, pages and models; obtain reviewed evaluation material |
| Evaluation readiness | Migration backlog reports 56 cases and none qualifying for the 100-case gate at baseline; later status must be checked | Inspect current review status rather than treating this historical count as permanent |
| Privacy text | `PRIVACY.md` contains both transcript-in-logs wording and a later redaction statement, plus deployment-specific storage/residency claims | Reconcile against source code and the actual environment before publication/use |
| Missing incident document | `PRIVACY.md` refers to `SECURITY_INCIDENT_RESPONSE.md`; that path was absent from the reviewed tree | Supply an approved operational procedure; do not claim it exists |
| Conversation retention | Replay age filtering exists; this does not prove an equivalent physical purge policy | Define, implement and verify retention separately |
| Website variants | Several generations of landing/demo files exist, including placeholder delivery paths | Identify the served build before changing or claiming working forms |
| Legacy documentation | README still says Express 4; `training/README.md` describes the old prompt-injected plant index | Prefer current implementation and reconcile stale descriptions when touching those areas |
| Demo credibility | Vision screens contain future numbers and some present-tense partnership/pilot statements | Verify organisational claims independently before reuse |
| Archived improvements | Newer plant/source work exists in historical references but is not all in canonical Core | Follow `docs/MIGRATION_BACKLOG.md`; port evidence, builder logic and tests together |

These findings are a scoped static review, not an exhaustive security or code audit. Do not reinterpret them as permission to rewrite the product or activate blocked functionality.

## 21. Repository installation instructions

Save this file at the root of `sanko-core` as `SANKO_SOURCE_OF_TRUTH.md`. Link to it from the README. Add a short pointer to the existing `AGENTS.md` so assistants are instructed to read it; do not replace the repository's existing operational rules.

Suggested addition to `AGENTS.md`:

```markdown
## Product source of truth

Before planning or changing Sanko, read `SANKO_SOURCE_OF_TRUTH.md`.
Preserve its product boundaries and distinguish implemented, gated and future
capabilities. Read the relevant current code and governance documents as well.
Do not change practitioner pricing, knowledge rights, patient access, clinical
scope or external data use through an implicit implementation decision.
If an explicit new founder request changes a boundary, record that decision and
update the source of truth alongside the change.
```

For assistants using `CLAUDE.md`, editor rules or another instruction entry point, add the same pointer there if appropriate. Avoid separate copies of this full document that can drift apart.

When uploading the file directly to a coding assistant, a suitable instruction is:

> Read SANKO_SOURCE_OF_TRUTH.md before proposing or making changes. Use it to understand Sanko's identity and boundaries, then inspect the current repository to establish what is implemented. Preserve free practitioner access, source fidelity, uncertainty, ownership and consent. Do not treat demos or future ideas as deployed features. Explain any material conflict before changing the relevant product boundary.

This file alone does not ensure every assistant automatically discovers or follows it. The instruction-file pointer and ordinary review/testing remain necessary.

## 22. Sources and maintenance

### Source basis

Founder context used includes the decisions to keep practitioner access free; capture text, voice and formula-book photographs; link formulations with patient outcomes over time; consider practitioner feedback on plants; explore assisted onboarding; pursue institutional collaboration; and use `sanko-core` as the canonical development repository. Earlier assistant-proposed business models and speculative roadmaps were treated as suggestions unless reinforced by founder decisions or current repository rules.

Relevant conversation anchors include August 2026 discussions of free practitioner access and institutional-facing positioning; 11 September 2026 clarification of multimodal capture and longitudinal outcomes; 17 September 2026 discussions of adoption, governance and canonical Core; and 29 September 2026 website clarity and this source-of-truth request.

### Primary repository references

All build observations above refer to the [reviewed commit](https://github.com/foayenix/sanko-core/tree/5dddddfe0ee74129c4bb907db4de28681f92645f). The relative paths below work when this document is installed in the repository root:

- [Repository instructions](AGENTS.md), [product definition](PRODUCT.md), [README](README.md).
- [Privacy notice](PRIVACY.md), [draft contributor terms](governance/contributor-terms-v1.md).
- [Brand](BRAND_IDENTITY.md), [design](DESIGN.md).
- [Migration backlog](docs/MIGRATION_BACKLOG.md), [transfer record](docs/REPOSITORY_TRANSFER.md).
- [Agent tools](src/agent/tools.js), [agent prompt](src/prompts/agent.txt), [registration](src/agent/registration.js).
- [Database operations](src/services/supabase.js), [governance implementation](src/services/governance.js).
- [Page/vision processing](src/services/vision.js), [speech processing](src/services/whisper.js), [plant lookup](src/utils/plantLookup.js).
- [Patient/treatment schema](supabase/004_patients_treatments_conversations.sql), [provenance and consent constraints](supabase/007_provenance_validation_governance.sql), [terms schema](supabase/013_contributor_terms.sql), [specimen schema](supabase/018_specimens.sql).
- [Plant-data documentation](data/plants/README.md), [runtime index](data/plant_lookup_v1.json).
- [Export screening](scripts/export-consent.js), [training export](scripts/export-training-data.js), [vision export](scripts/export-vision-data.js), [model promotion](scripts/promote-model.js), [evaluation guidance](evals/README.md).
- [Public aggregate dashboard](src/dashboard.js), [package manifest](package.json).
- [Vision context component](<sanko-landing page/src/components/VisionContext.jsx>), [illustrative vision data](<sanko-landing page/src/data.js>).

### Updating this document

Update it when the founder changes a product boundary or when a capability materially changes status. Record the decision date, why it changed, affected sections and implementation evidence. Do not silently replace an established constraint with an AI recommendation.

For build-status updates, record the new commit and verification performed. A feature can progress from **future** to **code present**, then to **verified in a named environment**; these are distinct milestones. Preserve the historical distinction between approved intent and implementation facts.

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-09-29 | Consolidated founder context and pinned Core review; defined product boundaries, present/gated/future capabilities, AI rules and unresolved decisions |

**The enduring test:** a Sanko change should make the knowledge record more useful, faithful, traceable and responsibly usable while preserving practitioner value and control.

### 1 October 2026 — private formulation evidence (code present; synthetic only)

An optional Formulation Evidence Dossier now has an isolated `/evidence/` manual
workflow on the continuity baseline: confirmed immutable formulation snapshots,
private-service authorisation, assigned evidence entry, independent exact-revision
review, private brief/technical HTML release, correction/update, export and erasure.
It reviews published evidence; it does not certify a formulation or establish
whole-product efficacy/safety. Practitioner access remains free. Review-service
permission does not grant research, publication, commercial or training rights.

This is an E0 fictional implementation, not a live service or scientific validation.
E1 operational approval and independent human evaluation remain release gates.
External sharing, AI/search providers, leaflets, regulatory reports and outcome
linking fail closed. Care and draft contributor terms remain independently gated.
See [implementation and verification boundaries](docs/EVIDENCE_IMPLEMENTATION.md)
and the [original specification](docs/SANKO_FORMULATION_EVIDENCE_IMPLEMENTATION_PLAN.md).

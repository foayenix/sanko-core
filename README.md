# Sanko Core

WhatsApp AI agent for African traditional medicine practitioners. Practitioners talk
to it in English, Yorùbá, Igbo, Hausa or Pidgin — by text, voice note or photo — and it
documents their herbal formulations and tracks the patients they treat.

This is the sole development repository for Sanko. `foayenix/sanko-vault` is
historical reference only; open all new branches and pull requests here.

Local model backends are the defaults. Data movement depends on configuration:
WhatsApp carries inbound messages, Supabase may be local or hosted, and selecting
a hosted model sends data to that provider. Verify the actual deployment before
making privacy claims.

**Stack**: Node.js 20.19+ (CI: 20 and 24) · Express 4 · Supabase/Postgres · Ollama · local speech/vision backends.

See [transfer record](docs/REPOSITORY_TRANSFER.md), [migration backlog](docs/MIGRATION_BACKLOG.md),
and [script inventory](docs/SCRIPTS.md). The transfer is a development baseline;
it does not deploy services or certify model quality.

## Quick start

```bash
cp .env.example .env
npm ci
```

Then bring up the two local model servers:

```bash
ollama serve && ollama pull qwen2.5:32b-instruct-q4_K_M
```

```bash
whisper-server --host 127.0.0.1 --port 8080 -m models/ggml-large-v3.bin
```

`brew install ffmpeg` too — WhatsApp sends ogg/opus and whisper.cpp wants 16 kHz WAV.

### The database

For local development, run Supabase on this machine. It needs a container
runtime; Colima is one option:

```bash
brew install colima docker supabase/tap/supabase
```

```bash
colima start --cpu 4 --memory 6 --disk 40
```

```bash
supabase start
```

Apply the migrations, then create the private bucket that holds voice notes and
photos. `supabase start` prints the local `SUPABASE_URL` and service-role key —
put them in `.env`.

```bash
npm run migrate
```

`migrate` applies each file once, inside a transaction, and records it in
`schema_migrations`. It refuses to run if a migration has been edited after being
applied — the tree and the database would otherwise disagree with nothing to say
so. On a database that predates the ledger, adopt its history first:

```bash
npm run migrate -- --baseline 009_optional_language_hint.sql
```

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "insert into storage.buckets (id, name, public) values ('sanko-media','sanko-media',false) on conflict (id) do nothing;"
```

Migration `008` matters only here: hosted projects grant `service_role` its table
privileges automatically and a self-hosted one does not, so without it every write
fails with `permission denied for table practitioners`.

```bash
npm run doctor
```

`doctor` probes the database and the bucket rather than just checking that the
variables are set — a paused or deleted project leaves perfectly valid-looking
config, and the symptom is "Something went wrong on our end." on the practitioner's
phone.

```bash
npm run dev
```

Open `http://localhost:3000/simulator` and talk to the agent. Nothing leaves the box.

## Trying the agent on WhatsApp with Baileys

For local testing without a Meta developer app, Sanko includes an optional
[Baileys](https://github.com/WhiskeySockets/Baileys) adapter. Baileys is an unofficial
WhatsApp Web client, so use a spare/test WhatsApp account, avoid bulk or unsolicited
messaging, and do not treat this path as the production integration.

1. In `.env`, set `BAILEYS_ALLOWED_NUMBERS` to the personal number that will message
   the test account, in E.164 format (for example `+447700900123`). Multiple numbers
   can be comma-separated. If you enable patient tracking during a test, each patient
   test number must also be allowlisted before Sanko can send its consent request.
2. Start the local model, Supabase connection, and Whisper as described above.
3. Run `npm run whatsapp:test`.
4. On the spare/test phone, open WhatsApp → Settings → Linked devices → Link a device,
   then scan the QR printed in the terminal.
5. From an allowlisted phone, message the linked test account. Text, voice notes, and
   photos go through the same `processTurn()` and agent tools as the Meta webhook.

The encrypted linked-device credentials are stored in `.baileys-auth/` and ignored by
Git. To unlink, remove the device in WhatsApp's Linked devices screen; delete that local
folder before linking a different account. Groups, status/newsletter traffic, history
sync, non-allowlisted numbers, and messages sent by the linked account are ignored.
Interactive choices are rendered as a numbered text list because that is the most
reliable format across consumer WhatsApp clients.

The adapter runs on the same durability path as the webhook (019): it claims each
message before the turn, closes the claim after, and sweeps for unfinished work on
connect and every few minutes. Claims are filed under the `baileys` transport and
their ids namespaced, because a Baileys message id is unique to its chat rather than
globally — the two adapters share one table and neither can replay the other's
messages. This also gives the adapter deduplication it did not have: WhatsApp replays
on reconnect, and every replay used to be answered as though it were new.

**A recovered voice note or photo cannot be replayed.** The media cache is in memory,
so a restart leaves the envelope without its bytes. Rather than answer a formulation
nobody could listen to, the adapter tells the practitioner it lost the message and
asks them to send it again — the one thing they can act on. Text and interactive
replies replay normally.

## How it works

An inbound message becomes content blocks and goes to a tool-calling agent. The agent
decides what to do; there are no keywords and no fixed conversation steps.

```
WhatsApp / simulator
    ↓
router.js          verify signature · dedupe · aggregate rapid-fire messages
    ↓              voice → whisper.cpp transcript · page photo → vision transcript
agent/index.js     tool-calling loop: text out, tool calls in, up to 8 rounds
    ↓
services/llm.js    ollama (local, default)  |  anthropic (eval baseline only)
    ↓
agent/tools.js     every tool scoped to the calling practitioner
                   · registration gate: no writes until name + region are on record
    ↓
Supabase           formulations · patients · treatments · corrections · messages
```

`services/llm.js` presents one interface in Anthropic's shape and translates to
Ollama's `/api/chat` underneath, so the agent loop is identical on either backend and
the eval harness can score them against each other on the same cases.

### Tools the agent can call

| Vault | Patients |
|---|---|
| `save_formulation` | `create_patient` |
| `list_formulations` | `find_patient` |
| `get_formulation` | `get_patient` |
| `update_formulation` | `log_treatment` |
| `save_specimen` | `update_treatment` |
| `list_specimens` | `list_due_follow_ups` |
| `set_profile` | |
| `set_practice_details` | |

Every executor resolves short codes **scoped to the calling practitioner**, so a
hallucinated `FM-00042` returns "not found" rather than another practitioner's record.

### Registration

A Vault opens on two answers: what the practitioner would like to be called, and
where they practise. The agent asks for them one at a time in the flow of the
conversation — there is no form and no keyword — and records each with
`set_profile` and `set_practice_details` as it arrives.

The region is not administrative tidiness. The same local plant name refers to
different plants in different parts of the country, so a mapping with no place
attached is one no reviewer can check, and checkable mappings are what the
archive is for. It is stored exactly as spoken: "Ìbàdàn", "Ogun State", "near
Nsukka".

How long someone has practised and what tradition they work in are asked once, in
the same breath, and required of nobody. Nothing else is collected, and nothing is
verified — every field here is self-declared, and the schema says so rather than
implying a check that never happened.

Enforcement is in the tool layer (`agent/registration.js`, applied in
`executeTool`), not in the prompt: until both answers are on record, every write
tool returns a refusal the agent has to act on. Reads, `export_account` and
`delete_account` stay open throughout — a person must be able to see, take, or
erase what Sanko holds about them whatever state their onboarding is in.

Registration stamps `practitioners.registered_at` once and logs a
`practitioner_registered` event. `/admin` shows who is registered and who stalled
part-way.

**Contributor terms.** Whether documented knowledge may ever be used beyond the
practitioner's own Vault is a separate question, asked once after registration and
answered either way without consequence — declining costs a practitioner nothing.
It is off by default: the terms in `governance/` are a draft with no legal review
and no practitioner consultation, so `accept_contributor_terms` is not even
offered to the model until `CONTRIBUTOR_TERMS_IN_FORCE=true`, and
`governance.recordAcceptance` refuses outright.

The default `AGENT_TOOLS=vault` profile exposes formulation documentation and account
rights only. Patient tracking requires an intentional two-part opt-in:
`AGENT_TOOLS=full` and `PATIENT_TRACKING_ENABLED=true`. Tool-call accuracy
falls as the list grows, so use this while evaluating a smaller model.

When enabled, `create_patient` creates a seven-day pending invitation from the
practitioner's supplied name and WhatsApp number. Sanko messages that number with
Accept/Decline buttons. Only an acceptance returned from the invited number activates
the patient; application logic and a database trigger both reject earlier treatments.

Because this is a business-initiated WhatsApp message, create and approve a template
named `sanko_patient_consent_v1` (or configure another name). Its English body should be:

> Hello {{1}}. {{2}} would like to use Sanko to keep a private record of your treatment
> and follow-up. This may include health information and the formulation used. You can
> accept or decline; declining will not affect your care. You can later ask Sanko to stop
> tracking and delete your record. Details: sanko.africa/privacy

Add quick-reply buttons in this order: `Accept`, `Decline`. The two body variables are
the patient name and practitioner name. Button payloads are supplied dynamically by the
application so replies are bound to the correct invitation and phone number.

## The improvement loop

Sanko gets better by being used. Not by updating its own weights — an unaudited model
that drifts silently would corrupt an archive nobody can reconstruct — but by turning
every practitioner correction into training data and gating every model change on a score.

There are two loops, and they run at very different speeds.

```
practitioners use the bot
        ↓
they correct what the model wrote     → corrections table       (automatic)
        ↓
npm run export-training  [--dry-run]  → training/data/*.jsonl   (consent-gated)
        ↓
mlx_lm.lora                           → an adapter              (see training/)
        ↓
npm run eval                          → a score
        ↓
better than the incumbent?  →  you promote it.  worse?  →  throw it away.
```

Everything up to the decision is automatic. You make the decision; the eval tells you
what the answer should be.

### The fast loop: plant names

The slow loop above needs hundreds of corrections and a training run. The fast one
needs neither. Every local name the agent cannot place botanically is already flagged
(`unknown_plant_flagged`); confirming one puts it into `data/plant_lookup_v1.json`,
which every save resolves against — so the next conversation that mentions the plant
gets it right, with no model change at all.

```bash
npm run plants:pull       # queue the unknown names, most-seen first
npm run plants:review     # what is waiting
# edit data/plants/review_queue.json: set decision + botanical_as_published
npm run plants:promote -- --reviewer PR-7F2A
```

`plants:promote` writes the confirmed mapping to
`data/plants/practitioner_confirmations.json`, rebuilds the plant data, and reports how
many names the runtime index gained. The queue holds practitioner speech (a reviewer
cannot identify a name without seeing it used) so it is gitignored; only the mapping and
a pseudonymous reviewer reference are ever committed. A confirmation that contradicts a
published source is held in `ambiguities.json` rather than overriding it.

### Where corrections come from

Four sources, all writing to the same `corrections` table:

| Source | Written by | Captures |
|---|---|---|
| `practitioner_edit` | `update_formulation` | A practitioner fixing their own record — the highest-quality signal, and the rarest, because it depends on them noticing. |
| `admin_review` | `/admin` → Review inbox | A reviewer proposing a correction. **The record is not changed** — the Vault is the practitioner's; a proposal is a training example and an audit entry, not an overwrite. |
| `admin_review` (transcript) | `/admin` → Readings | A corrected Whisper transcript. The machine output is kept as the before-value, which is exactly the pair a Whisper fine-tune needs. |
| `admin_review` (page_transcript) | `/admin` → Readings | A corrected reading of a photographed page. Same shape, different model: this pairs the page image with what it actually says. |
| `eval_label` | reserved | Labels produced during evaluation. |

Every write from the control room carries a pseudonymous `reviewer_ref` and an
`X-Sanko-Admin` header — Basic Auth alone would not stop a cross-site post,
because the browser attaches cached credentials to it.

### Photographed notebooks and medicine books

A practitioner can photograph a page of their own book instead of describing it.
The page is read before the agent sees it, and the reading is archived on the
media row exactly as a voice transcript is:

```
photo → services/vision.js → media.transcript (+ model, provider, confidence)
                           → agent reads the text and structures it with its normal tools
```

Reading is a separate step from structuring on purpose. When a saved formulation
is wrong you need to know whether the page was misread or the reading was
mis-structured, and one model doing both hides which.

The vision model is a **separate pull** from the agent model, because the default
agent model is text-only — Ollama accepts an `images` array for it and silently
ignores the pixels, so a photo would reach the agent as nothing at all:

```bash
ollama pull qwen2.5vl:7b
```

`npm run doctor` fails if it is missing, and warns if `VISION_MODEL` names a model
that is not vision-capable — that failure is otherwise invisible, because the
request succeeds and the model answers from the prompt alone.

#### Choosing a vision model

No off-the-shelf model has seen Nigerian traditional-medicine handwriting, and the
benchmarks quoted for these models — OmniDocBench, OCRBench — are printed documents:
invoices, tables, formulas, screenshots. They contain essentially no handwriting and
no Yorùbá, Igbo or Hausa. A model's rank there predicts very little about a page from
a practitioner's notebook, so measure on your own pages instead:

```bash
npm run vision:compare -- ./pages --models glm-ocr,qwen3.5:27b,qwen2.5vl:7b --language yo
```

`./pages` holds the photographs. A `page-01.txt` beside `page-01.jpg` is that page's
ground truth, typed by someone who looked at it — two or three is enough to start.
Without any, the run still prints every model's reading side by side to compare by eye.

It reports three numbers, because "worse" has two different causes:

| | |
|---|---|
| `cer` | character error rate against the truth — the headline |
| `cer-stripped` | the same with every diacritic removed from both sides |
| `marks kept` | how many of the truth's diacritics survived into the reading |

**A low `cer-stripped` next to a high `cer` means the model read the words and dropped
the marks.** Measured on `glm-ocr` reading *clean printed* Yorùbá: `cer` 16.6%,
`cer-stripped` 0.0%, marks kept 73.1% — every word correct, and every subdot
destroyed. `ẹ̀yìn` came back as `èyìn`, `ìṣẹ́jú` as `ìséjú`. In Yorùbá `ẹ` and `e` are
different letters, not accent variants, so that is not a cosmetic loss: it silently
changes which word was written. Expect it to be worse on handwriting.

`services/vision.js` checks for it **per class of mark**, not as a total. A reading
that keeps every tone mark and loses every subdot scores 73% on a total count and
looks healthy; counted per class it is one whole class gone, and the agent is told
exactly which — then asked to confirm spellings before recording anything. Thresholds
differ by language (Yorùbá marks tone on nearly every word; Igbo routinely omits tone
in everyday writing; Hausa's hooked letters appear only if such a word occurs), and
absence is treated as a reason to look, never as a verdict: plenty of practitioners
write without marks, and a page that genuinely has none must not be called wrong.

It also asks whether the page is in that language at all before saying anything.
A practitioner's stated language belongs to the practitioner, not to the page, and
these notebooks are bilingual — Yorùbá formulations behind an English index. Without
that gate every index page reports its Yorùbá diacritics missing, and a flag that
cries wolf on half a notebook is a flag nobody reads. It is not language
identification: the stated language still chooses which marks to look for, and this
only asks whether the page is plausibly that language, by looking for common words
(`egbo`, `epo`, `ewe`, `ati`) with their own marks stripped first — since the marks
being gone is the whole premise.

Where a word is genuinely illegible the reading contains `[?]`. That marker is
never allowed into a record: `executeTool` refuses any save whose input still
carries one, and tells the agent to ask the practitioner what it says. The rule
lives in the tool layer rather than the prompt because small local models follow
prompt rules inconsistently, and a rule that holds sometimes is not a rule.

Correcting a page in `/admin` → **Readings** works the same way as correcting a
transcript, with the page shown beside the text. Corrections are filed under
`page_transcript`, never `transcript`: one trains the vision model, the other
trains Whisper, and a pooled set would train each on the other's mistakes.

```bash
npm run export-vision -- --dry-run   # who may be included; writes nothing
npm run export-vision -- --recorded-by OP-4C21 \
  --counterparty "Sanko — internal fine-tune" \
  --purpose "Vision adapter for page readings" \
  --benefit-terms "Better readings of their own notebooks; no redistribution"
```

Both exports run through the consent gate described under
[Knowledge governance](#knowledge-governance): a page belonging to a practitioner
who has not accepted the current contributor terms is excluded and named, and what
is exported is written into the knowledge-use ledger. The terms are still a draft
and not in force, so an export today refuses and says so — that is the gate
working, not a misconfiguration.

Formulations already extracted from a corrected page are **not** rewritten — they
are the practitioner's records. The review reports their short codes so a human
can go and check them.

### Photographed plants

The other thing practitioners photograph is the plant: a leaf held up to the
camera, a strip of bark, a root, a tray of dried material. Those photos come back
from the page reading with no text, and until migration `018` that was the end of
it — the image was archived and the one person who could say what the plant was
never got asked.

Now they are asked. A specimen is a photograph plus the name its practitioner
gave it:

```
photo with no writing → agent asks what they call it
                      → save_specimen (their words, verbatim)
                      → botanical name resolved from data/plant_lookup_v1.json
                      → specimens row (SP-00001), or the review queue if unresolved
```

The same rule governs formulations: `save_formulation` and `update_formulation`
resolve every plant against the index in code, and neither accepts a `botanical`
field from the model — a schema that rejects one is what makes a fabricated binomial
impossible rather than merely discouraged. `lookup_plant` exists so the agent can
still tell a practitioner what the index holds, without the index being in its
prompt. The index used to be pasted into the system prompt (442 mappings, ~4,330
tokens on every call of every iteration) with the model asked to recall the right
one and write it into a permanent record; reading an answer out of a tool result is
a different and far easier task than recalling it.

**The name comes from the practitioner and the binomial comes from the index. A
model supplies neither.** Both halves are enforced in code rather than asked for
in the prompt:

- `save_specimen` has **no botanical field**, so there is nothing for the model to
  write a species into. The binomial is looked up from the local name, stamped
  with the index build it came from, and left null when the index cannot place
  the name unambiguously.
- The tool **refuses a `local_name` that does not appear in what the practitioner
  actually said this turn**. Without that check the model is free to look at a
  green leaf and record "bitter leaf" as though it had been told, and the archive
  fills with its guesses wearing a practitioner's attribution — the one corruption
  this dataset could not be cleaned of later, because nothing in the rows would
  mark which were which.

This is also why Sanko does **not** propose a species and collect Yes/No/Not sure
on it, which is the obvious design and the wrong one here. There is no model on
this stack that can identify West African medicinal flora — the vision model is a
page transcriber, and asked to name a plant it returns a fluent, confident, wrong
binomial with a percentage attached. And a proposal shown before the practitioner
answers anchors the answer: Yes is one tap and No is work, so a plausible wrong
proposal harvests agreement, and agreement is the exact thing the table exists to
collect honestly.

A name the index does not know is the most valuable row here, not a failure. It
raises the same `unknown_plant_flagged` event a formulation does, so it reaches
reviewers through [the loop that already exists](#the-fast-loop-plant-names)
rather than a second queue nobody is watching.

`specimen_identifications` is created by the same migration and nothing writes to
it yet. It holds independent yes/no/unsure answers, one per practitioner, and the
database refuses an answer from the practitioner who owns the specimen — a
self-confirming specimen is exactly the record that would later be cited as
having been "confirmed by practitioners". Cross-practitioner review also shows one
practitioner's photo to another, which is a use beyond their own Vault and so
cannot ship before the contributor terms are in force (see
[Knowledge governance](#knowledge-governance)).

Specimens carry the practitioner's stated region and never the photograph's
coordinates. EXIF is not read. A precise fix on a wild population of a valuable
species is a bioprospecting disclosure, and the argument that keeps this database
on the practitioner's own hardware applies to where their plants grow.

Eval case `56-photo-plant-ask-then-name` covers the conversation end to end: a
photo turn with no writing, then the practitioner's own name for the plant. Eval
turns can be photos as well as speech — see `photo` in `evals/run.js`.

### Growing the eval set from real failures

```bash
npm run eval:draft     # corrections → evals/cases/drafts/, held out of training
npm run eval:drafts    # what is waiting, and any orphaned hold-outs
```

A drafted case is **not** a reviewed case. It lands in `evals/cases/drafts/`,
which the runner does not read and git does not track, carrying verbatim
practitioner speech. A person de-identifies the wording, confirms the expectation
with a practitioner, replaces `draft_origin` with a `review` block, and moves the
file up into `evals/cases/`.

Drafting a correction holds it out of the training export immediately, in the
database — a model must never be graded on an example it was trained on, and that
separation is enforced by the query, not by remembering. Discarding a draft and
running `node scripts/draft-eval-cases.js release` gives the correction back.

### Promoting a model

```bash
npm run promote-model -- --candidate sanko-extract-01
npm run promote-model -- --candidate sanko-extract-01 --record --operator OP-4C21
```

Reads the scorecards in `evals/results/` and refuses on: a missing or errored run,
any hallucination, a score regression, two scores taken on different case sets, or
fewer than 100 practitioner-reviewed cases (overridable with `--allow-unreviewed`,
which is recorded in the registry). It never changes the running model — it prints
the line you then choose to apply, and `--record` appends the decision to
`training/model_registry.json`.

### Measuring whether any of it worked

`formulations` records the model, provider and prompt version that produced it (010), and
`corrections` records the fix. Together they give corrections per 100 saves, per model —
shown in `/admin` → AI quality. Corrections are attributed to the model that *made* the
mistake, not the one configured when the fix was recorded, so a newly promoted adapter is
never credited with its predecessor's errors.

### Evals

```bash
npm run eval                 # score the configured model
npm run eval -- --case 02    # one case, verbose
npm run eval -- --compare    # local vs hosted on identical cases
npm run eval:reviewed        # require 100+ practitioner-approved held-out cases
```

Eight exploratory cases in `evals/cases/`, covering Yorùbá, Igbo and Pidgin input, unknown plants,
garbled transcripts, tool routing, and multi-step patient chains. Scoring weights
**not inventing things** as heavily as getting things right: a model that records four
of five plants is useful, one that invents a fifth has corrupted the archive.

The practitioner-reviewed benchmark is a separate evidence bar, not a claim about the
current eight cases. `npm run eval:reviewed` excludes any case without complete practitioner
approval metadata and refuses to run until at least 100 eligible cases exist. See
[`evals/README.md`](evals/README.md) for the review rubric, privacy rules, and case format.

A run exits **non-zero on any hallucination**, so a promotion script can gate on it.
Results land in `evals/results/` — diff two to answer the only question that matters
after a fine-tune.

**Comparing local models.** `npm run eval:bakeoff -- model-a,model-b` runs the same
cases against each candidate in one process and prints a table. Every scorecard
carries a fingerprint of the exact cases it scored — their ids and their contents —
and the comparison refuses to rank runs whose fingerprints differ, because "keep the
case set frozen" was previously a line in a README and nothing else. The table is
ordered by hallucinations first and mean score second: a model that invents a
botanical name is not a slightly worse model, it is one that cannot be used here.

The bake-off needs the models, so it runs where they live — the machine with Ollama
and the weights on it, not CI.

**Practitioner review.** `npm run review:status` shows where the set stands against
the 100-case gate and its coverage across language, medium, unknown plants,
corrections, browsing and consent-gated workflows. `npm run review:packets` turns
unreviewed cases into plain-text packets a practitioner can read without the
repository, and `npm run review:apply` writes their decisions back. See
[`evals/README.md`](evals/README.md).

### Training

See [training/README.md](training/README.md) for the MLX workflow, model sizing on a
64 GB M1 Max, and what to train first. Short version: **fine-tune Whisper before you
fine-tune the LLM** — transcription is the biggest quality gap on this stack, and every
downstream error starts there.

## Trying it without WhatsApp

`/simulator` is a chat page that calls the same `runAgent()` the webhook calls, so the
reply you see there is the reply a practitioner gets. Log in with username `felix` and
your `ADMIN_PASSWORD`. The right-hand panel shows every tool call and its result —
that's how you confirm a formulation actually reached the Vault rather than the agent
merely saying it did.

The default number is `+99900000001` so simulator traffic stays separable from real data.

### Letting someone else try it

A conversation *is* a phone number — `practitioners` is unique on `phone_number` and
every Vault record hangs off `practitioner_id`, so two numbers are already two entirely
separate people with separate history. A guest link just means nobody has to type one.

Set `GUEST_TOKEN` and send:

```
https://<host>/simulator?as=amara&t=<GUEST_TOKEN>
```

No password prompt, no `/admin`, and no way to read your chat: the `?as=` slug hashes to
a number in the `+9991…` block, the server pins the session to it, and a phone number in
the request body is ignored. A second guest gets `?as=someone-else` and their own thread.
Same link, same name, same conversation — the mapping is a hash, so nothing is stored.

## Environment variables

See `.env.example`. The ones that matter most:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` (local) or `anthropic` (eval baseline) |
| `OLLAMA_MODEL` | `qwen2.5:32b-instruct-q4_K_M` | Verify what's current when you pull |
| `OLLAMA_NUM_CTX` | `16384` | **Do not lower.** Ollama's default silently truncates the system prompt |
| `WHISPER_BASE_URL` | `http://127.0.0.1:8080/v1` | Any OpenAI-compatible transcription endpoint |
| `VISION_BACKEND` | `ollama` | `ollama` (local), `anthropic` (eval baseline), or `off` to archive pages unread |
| `VISION_MODEL` | `qwen2.5vl:7b` | Reads photographed pages. A separate pull from `OLLAMA_MODEL`, which is text-only |
| `WHISPER_TRANSCODE` | `true` | ogg/opus → 16 kHz WAV via ffmpeg |
| `AGENT_TOOLS` | `vault` | `full` requests patient tools; ignored unless the patient flag is also enabled |
| `PATIENT_TRACKING_ENABLED` | `false` | Explicitly enables consent-gated patient tools when set to `true` |
| `INBOUND_RECOVERY_AFTER_SECONDS` | `max(900, lease × 1.5)` | How long a message may be outstanding before the sweep re-enqueues it. Must exceed `AGENT_TURN_LEASE_SECONDS` |
| `INBOUND_RECOVERY_MAX_ATTEMPTS` | `3` | Retries before a message is given up on and logged at error level |
| `INBOUND_RECOVERY_INTERVAL_MS` | `300000` | How often the recovery sweep runs |
| `ALLOW_UNSIGNED_WEBHOOKS` | `false` | Accepts unsigned webhooks in production. Anyone who finds the URL can then write to a Vault |
| `CONTRIBUTOR_TERMS_IN_FORCE` | `false` | Lets the agent put the contributor terms to a practitioner. Leave false until the draft in `governance/` has had legal review and practitioner consultation |
| `WHATSAPP_PATIENT_CONSENT_TEMPLATE` | `sanko_patient_consent_v1` | Approved patient consent template name |
| `WHATSAPP_PATIENT_CONSENT_LANGUAGE` | `en` | Approved template language code |
| `ADMIN_PASSWORD` | — | Guards `/admin` **and** `/simulator` |
| `GUEST_TOKEN` | — | Optional share link for `/simulator` only. Blank = no guest access |

## Database setup

Run the migrations in order in the Supabase SQL editor:

```
001_initial_schema.sql
002_cost_monitoring_view.sql
003_lock_down_rls.sql
004_patients_treatments_conversations.sql   ← patients, treatments, agent_messages
005_corrections.sql                         ← the training flywheel
006_agent_message_order.sql                 ← stable conversation ordering
007_provenance_validation_governance.sql    ← provenance, constraints, consent, audit
008_service_role_grants.sql                 ← self-hosted Supabase DML grants
009_optional_language_hint.sql              ← preferred_language becomes optional
010_model_provenance.sql                    ← which model produced each record
011_review_capture.sql                      ← admin + transcript review, eval hold-out
012_durable_runtime_state.sql               ← dedup + turn leases, plant-data version
013_contributor_terms.sql                   ← contributor terms, knowledge-use ledger
014_practitioner_registration.sql           ← registration state on the practitioner
015_page_transcription.sql                  ← readings of photographed pages + who read them
016_landing_enquiries.sql                   ← public form submissions
018_specimens.sql                           ← practitioner-named plant photographs
019_inbound_message_recovery.sql            ← inbound payloads + recovery of unfinished turns
```

`npm run migrate:status` shows what is applied and what is not. Migration 017 is
absent in the source snapshot; retain the original filenames and checksums.

RLS is on with no policies on every table (deny-all for `anon`); the bot uses the
service-role key, which bypasses RLS. Do not add a `using (true)` policy.

> Check `SUPABASE_URL` and `SUPABASE_DB_URL` to identify the actual database.
> This repository supports a local stack; it does not migrate existing hosted data.

## Operations

### Where a turn's time goes

Latency on this stack is worth measuring rather than guessing: a local 32B is
single-digit tokens per second, and a turn that feels slow is often several fast
calls rather than one slow one.

Every model call writes an `llm_call` event carrying `duration_ms`, `iteration`,
`input_tokens`, `output_tokens` and `output_tps` (output tokens per second — the
number that says whether a model swap or a shorter prompt is the lever). Voice
notes write a `whisper_call` event with `duration_ms` and `audio_bytes`, because
transcription runs in front of the model and on a local CPU can outlast the turn
it precedes. Page readings already log `ms` on `vision.page_transcribed`.

All three also go to the log at info level, so a single turn can be read end to
end without querying anything.

Two fixed costs worth knowing about, neither of them the model: the aggregation
debounce (`AGGREGATION_WINDOW_MS`, 2.5s by default) is added to every turn before
the agent starts, and the system prompt plus tool schemas are resent on each of
up to `AGENT_MAX_TOOL_ITERATIONS` round trips.

### Backups

```bash
npm run backup          # dump, encrypt (AES-256-GCM), prune, record
npm run backup:verify   # restore into a scratch database, compare row counts
npm run backup:status
```

`verify` is the half that usually gets skipped and the half that matters: a
backup nobody has restored is a hypothesis. It decrypts the newest dump, restores
it into a throwaway database, checks every table came back with the same row
count, and drops it again.

`BACKUP_ENCRYPTION_KEY` must exist and must be kept somewhere other than this
machine — losing it makes every backup unreadable. Scheduling must be configured
and verified for the deployment host; no machine-specific scheduler is included.

### Operator accounts

```bash
npm run admin:account -- felix OP-4C21
```

Every write from `/admin` is attributed to the reference of whoever signed in,
never to a value typed into a form — an attribution the caller can type
attributes nothing. Passwords are scrypt-hashed into `ADMIN_ACCOUNTS`, so `.env`
never holds a usable one. The old single `ADMIN_PASSWORD` still works but marks
its actions `OP-LEGACY` and says so in the control room; remove it once every
operator has an entry.

### Logging and alerting

Structured JSON lines (`LOG_PRETTY=false`), with practitioner speech, names and
phone numbers redacted at the logger — a log file that leaks the archive is worse
than no log file. Error-level events POST to `ALERT_WEBHOOK_URL` if set,
throttled so one outage cannot send a thousand alerts.

### Load

One local model serves one turn at a time, so turns queue (`src/utils/turnQueue.js`):
per-practitioner ordering, a global concurrency cap, and a "let me look at that"
message to anyone who will wait more than `AGENT_QUEUE_ACK_MS`. Across instances,
migration 012's turn lease stops two processes interleaving tool calls on one
Vault, and inbound message dedup is durable rather than in one process's memory.

**Messages survive the process that accepted them (019).** The webhook claims a
message before it answers Meta, and the claim carries the message itself. A 200
tells Meta to stop retrying, so a claim recording only that something arrived was
enough to avoid doing the work twice and no help at all in doing it once: a
process that died before the agent ran left a practitioner waiting on a reply to
a formulation nothing in the system could still describe. A sweep re-enqueues
anything outstanding — on boot, and every few minutes after — once it has been
owed longer than `INBOUND_RECOVERY_AFTER_SECONDS`, which must exceed the turn
lease so a slow turn is not mistaken for a dead one. The Baileys adapter runs the
same path under its own `transport` value; see its section above for the one thing
it cannot replay.

Recovery is deliberately at-least-once: a turn that died halfway may have written
something before it went, so a replay can repeat part of it. A duplicate reply, or
a record the practitioner can delete, is recoverable; what they said going missing
is not. `INBOUND_RECOVERY_MAX_ATTEMPTS` bounds it, so a message that crashes the
process cannot take the service down on every boot — giving up on one is logged at
error level, because a message nobody will answer is the thing this prevents.

The held payload is practitioner content, so it lives exactly as long as the work
does: erased on completion, on abandonment, and never restored. A finished row
keeps its message id and nothing else, which is all dedup ever needed.

### Governance

```bash
npm run governance:terms                        # the terms, and who has accepted
npm run governance -- record --file use.json    # record a knowledge use, or be refused
npm run governance -- statement <practitioner>  # what has been done with their knowledge
```

See [Knowledge governance](#knowledge-governance) below.

## Knowledge governance

Custody was never the hard part. The question an institutional partner asks
second is: if this knowledge is used beyond the practitioner's own Vault, what
did they agree to, and what do they get?

`governance/contributor-terms-v1.md` is the versioned answer, and migration 013
is the mechanism:

- a practitioner's acceptance is recorded against the **hash** of the exact text,
  so editing the terms cannot retroactively produce agreement to them;
- every use outside a Vault — research access, licence, publication, dataset
  export — is recorded with its counterparty, purpose, scope, and what the
  contributing practitioners get in return;
- `recordKnowledgeUse` **refuses** if any contributor has not accepted, or
  accepted a superseded version, and names every one of them. Benefit terms are
  required, because that is the field that would otherwise be left blank.
- the **training exports go through the same gate** (`scripts/export-consent.js`).
  Fine-tuning on a practitioner's corrections is a use beyond their Vault in
  exactly the way a licence is, and it was the one such use that ran unchecked:
  both export scripts read corrections straight out of the database and wrote
  them into a training set. They now exclude and name every practitioner who has
  not agreed, refuse outright when none has, and write what was used into the
  ledger as a `dataset_export`. `--dry-run` reports eligibility without writing
  anything.

> The terms are a **draft with no legal review and no practitioner
> consultation**. Both are prerequisites, neither is a schema problem, and the
> code marks the terms `in_force: false` until they happen. Do not present them
> to a practitioner as binding or quote them to a partner as Sanko's position.

## Webhook setup (Meta Cloud API)

1. Set `META_VERIFY_TOKEN` to any secret string you choose.
2. Set `META_APP_SECRET` (Meta Developer Console → App settings → Basic). Inbound
   webhooks are verified against `X-Hub-Signature-256`. Without the secret set,
   verification is skipped outside production so a local run needs no Meta app;
   under `NODE_ENV=production` the webhook refuses every request instead, unless
   `ALLOW_UNSIGNED_WEBHOOKS=true` says the deployment meant it. A forged webhook
   writes a formulation into a practitioner's Vault under their own name.
3. Callback URL `https://<your-url>/webhook`, then subscribe to the `messages` field.

Note the shape of this: WhatsApp itself is the one hop you cannot make private, because
Meta carries the message. Everything downstream of the webhook is yours.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request. The suite is
fully offline — the database is swapped for an in-memory store and the model for
a scripted stand-in — so CI needs no secrets and can never touch a practitioner
record. The jobs also validate the landing app and repository structure:

| Job | Checks |
|---|---|
| `test` | The whole suite on Node 20 and 24. |
| `data-integrity` | The plant data still rebuilds to exactly what is committed, the landing count is in sync, and every eval case parses (`npm run eval -- --validate-only`, no model calls). |
| `secrets` | `npm run check-secrets` and repository structure checks. |
| `landing` | Locked install, lint, production build, and dependency audit. |
| `migrations` | Apply all SQL migrations to disposable PostgreSQL and verify a repeat run. |

## Running tests

```bash
npm test
```

481 tests, all offline — Supabase is swapped for an in-memory store and the model for a
scripted client, so tests need no keys, no Ollama, and no network.

## Folder layout

```
src/
  index.js          Express app + routes
  router.js         Webhook → normalise → aggregate → agent
  agent/
    index.js        The tool-calling loop
    tools.js        Tool definitions + executors + profiles
    practitioner.js Practitioner resolution, privacy notice
  services/
    llm.js          Provider abstraction (ollama | anthropic)
    whisper.js      Local or hosted transcription + ffmpeg transcode
    vision.js       Reads a photographed notebook page into text
    supabase.js     Data layer
    whatsapp.js     Meta Cloud API
  simulator.js      /simulator — browser stand-in for WhatsApp
  admin.js          /admin — ops dashboard
  dashboard.js      /dashboard — public institutional counts
  prompts/agent.txt The agent's system prompt
evals/
  cases/*.json      Eval cases
  score.js          Scoring (pure, unit-tested)
  run.js            Runner
training/
  README.md         MLX LoRA workflow + model sizing for the M1 Max
scripts/
  migrate.js             Applies migrations once each, in order
  backup.js              Encrypted dumps and a verified restore
  check-secrets.js       Refuses credentials in the tree
  admin-account.js       Generates an ADMIN_ACCOUNTS entry
  knowledge-use.js       Contributor terms and the knowledge-use ledger
  export-training-data.js
  export-vision-data.js  Corrected page readings → a vision fine-tuning set
  draft-eval-cases.js    Corrections → held-out draft eval cases
  promote-model.js       The promotion gate
  plant-review.js        The unknown-plant → runtime-index loop
  build-plant-data.js    Rebuilds the plant data from its sources
data/
  plant_lookup_v1.json   Generated runtime medicinal-plant name index
  plants/                Provenance, taxonomy, vernacular names, observations, and reviews
```

## Build progress

| Item | Status |
|------|--------|
| Six keyword flows → conversational agent | ✅ Superseded by A1 |
| Plant lookup (479 runtime names; 442 resolved), provenance data, privacy disclosure, `PRIVACY.md` | ✅ Done |
| Institutional dashboard at `/dashboard` | ✅ Done |
| Hardening: webhook signatures, dedup, RLS lockdown, send retries | ✅ Done |
| A1 · Tool-calling agent replaces the keyword state machine | ✅ Done |
| A2 · Patient + treatment tracking with follow-ups | ✅ Done |
| A3 · Message aggregation for rapid-fire senders | ✅ Done |
| A4 · `/simulator` — test the agent without WhatsApp | ✅ Done |
| L1 · Ollama provider — agent runs locally | ✅ Done |
| L2 · Local Whisper via whisper.cpp + ffmpeg transcode | ✅ Done |
| L3 · Corrections flywheel — every practitioner edit is training data | ✅ Done |
| L4 · Eval harness with hallucination gating | ✅ Done |
| L5 · MLX training export + LoRA workflow | ✅ Done |
| L6 · Whisper fine-tuning on practitioner audio | ⬜ Needs a transcript-review pass in `/admin` first |
| W11 · Pilot onboarding (20 HTSN practitioners) | ⬜ Blocked on Meta production WhatsApp number |
| Demo video | ⬜ Unblocked — can be recorded against `/simulator` |

### Removed

The six step-driven flows, `services/claude.js`, and the `structureFormulation` /
`readNotebook` / `editField` prompts were deleted in A1 — the agent does that work
through tools instead. The `sessions` table is no longer written to.

**Tests**: run `npm test` for the current results. The pretest step regenerates the
ignored plant build report from committed inputs; no private textbook extracts are required.

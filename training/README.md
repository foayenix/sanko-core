# Training Sanko's models on your own machine

Everything here runs on the M1 Max. Nothing leaves it.

## The loop

```
practitioners use the bot
        ↓
they correct what the model wrote        → corrections table  (automatic)
        ↓                                   (attributed to the model that made
        ↓                                    the mistake — see migration 010)
        ↓
npm run export-training                  → training/data/*.jsonl
        ↓
mlx_lm.lora                              → an adapter
        ↓
npm run eval                             → a score
        ↓
better than the incumbent?  →  promote.  worse?  →  throw it away.
```

**The model never updates itself.** A bad adapter that silently promotes itself
would corrupt a knowledge archive that cannot be reconstructed. The loop is
automatic up to the decision; you make the decision, and the eval tells you what
the answer should be.

## What to train, in order of payoff

### 1. Whisper on your practitioners' voices — do this first

The biggest quality gap on this stack is not the LLM, it is transcription.
Off-the-shelf Whisper handles Yorùbá, Igbo, and Hausa poorly, and every
downstream error starts there. Fine-tuning `whisper-small` or `whisper-medium`
on a few hours of your own practitioner audio beats anything off the shelf,
and it is far cheaper to train than an LLM.

You need paired audio and corrected transcripts. That review pass now exists:
`/admin` → **Transcripts** plays the archived voice note next to its machine
transcript, and saving a correction stores the original as the correction's
before-value. Every row you fix is one training pair, and the record improves
whether or not you ever run the fine-tune.

### 2. A small specialist for extraction

Don't fine-tune the conversational agent. Fine-tune a **7–8B model that does one
narrow job**: turn a practitioner's sentence into a structured field. That is
exactly the shape of your corrections data, it fits comfortably in 64 GB for
LoRA, and it is the step where local models currently lose to hosted ones.

The 32B agent keeps handling conversation and tool calls; it delegates the
extraction to the specialist. Two models, each doing what it is good at.

### 3. The plant lookup — do this weekly, it needs no training

`data/plant_lookup_v1.json` is the cheapest quality lever you have. Every
unrecognised plant is logged as an `unknown_plant_flagged` event, and
`scripts/plant-review.js` turns those events into a review queue and confirmed
names back into the runtime index:

```bash
npm run plants:pull                              # queue unknown names, most-seen first
# edit data/plants/review_queue.json
npm run plants:promote -- --reviewer PR-7F2A     # confirm, rebuild, report the gain
```

The index is interpolated into the agent's system prompt, so a name confirmed on
Monday is recognised on Tuesday — no adapter, no eval, no promotion decision.
Nothing else in this file has that turnaround.

## Setup

```bash
pip install mlx-lm
```

## Export the data

```bash
npm run export-training
```

Splits are grouped by practitioner, so one person's phrasing never appears in
both train and test — otherwise the eval flatters the model.

Below roughly 200 examples, a LoRA will memorise rather than generalise. Keep
collecting; the export is idempotent and tracks what it has already emitted.

## Train a LoRA adapter

```bash
mlx_lm.lora \
  --model mlx-community/Qwen2.5-7B-Instruct-4bit \
  --train \
  --data ./training/data \
  --adapter-path ./training/adapters/run-01 \
  --batch-size 2 \
  --num-layers 8 \
  --iters 600
```

On an M1 Max, a 7B LoRA at these settings takes roughly 30–60 minutes. Watch
validation loss — if it stops falling while training loss keeps dropping, you are
memorising; cut `--iters`.

Fuse it into a standalone model Ollama can load:

```bash
mlx_lm.fuse \
  --model mlx-community/Qwen2.5-7B-Instruct-4bit \
  --adapter-path ./training/adapters/run-01 \
  --save-path ./training/fused/sanko-extract-01
```

## Score it before you trust it

```bash
OLLAMA_MODEL=sanko-extract-01 npm run eval
```

Then run the gate rather than eyeballing the numbers:

```bash
npm run promote-model -- --candidate sanko-extract-01
```

It refuses on a missing or errored run, any hallucination, a score regression,
two scores taken on different case sets, or fewer than 100 practitioner-reviewed
cases. A model that scores higher while inventing one plant is a worse model:
recall can be recovered, a corrupted archive cannot.

It does not change the running model. It prints the `OLLAMA_MODEL=` line and
leaves the decision with you; `--record --operator <ref>` appends it to
`training/model_registry.json` so every promotion has a written reason.

### Keep the eval set growing

```bash
npm run eval:draft
```

Corrections become draft eval cases in `evals/cases/drafts/` and are held out of
the training export at the same moment. Without that hold-out the eval slowly
becomes a memory test. Drafts need a person to de-identify and confirm them
before they count — see the README section on it.

## Sizing on a 64 GB M1 Max

Memory bandwidth (400 GB/s), not capacity, sets generation speed.

| Job | Model size | Fits | Speed |
|---|---|---|---|
| Conversational agent | 32B Q4 (~19 GB) | comfortably | usable |
| Conversational agent | 70B Q4 (~40 GB) | tight | slow — expect a long pause per turn |
| LoRA fine-tune | 7–8B | comfortably | ~30–60 min |
| LoRA fine-tune | 14B | tight | hours |
| LoRA fine-tune | 32B+ | no | use the mini server |

macOS caps GPU memory below total RAM. To give Metal more headroom:

```bash
sudo sysctl iogpu.wired_limit_mb=57344
```

That is not persistent across reboots — add it to a launch daemon if you keep
hitting the ceiling.

## When the mini server arrives

The split that makes sense: **the Mac keeps serving, the server trains.** Training
is bursty and can wait; inference cannot. Point `OLLAMA_BASE_URL` at the server
only once it can beat the Mac on tokens/sec, which needs real GPU memory
bandwidth rather than just more RAM.

## Picking a base model

Verify what is current when you pull — the landscape moves faster than this file.
What matters for Sanko, in priority order:

1. **Tool calling.** The model must reliably emit structured function calls, or
   the agent cannot save anything. Check the model card says so explicitly.
2. **Multilingual coverage.** Test on your own Yorùbá and Igbo cases before
   committing — do not trust benchmark averages, which are dominated by English.
3. **Size class.** 32B is the sweet spot on this hardware.

`npm run eval -- --compare` scores your local model against the hosted API on
identical cases. That is the number to watch as you swap models: not whether
local is perfect, but how much you are giving up, and whether it is shrinking.

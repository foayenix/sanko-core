-- 010 — Record which model produced each formulation.
--
-- 005 stores the model on every correction, which gives a numerator: "forty
-- corrections against qwen2.5:32b". It gives no denominator. Forty corrections
-- out of a hundred saves is a model to roll back; forty out of two thousand is
-- a model working well. Without these columns the two are indistinguishable,
-- so a regression introduced by a newly promoted adapter is invisible until a
-- practitioner complains.
--
-- prompt_version is separate from the model because the prompt changes far more
-- often, and a quality shift caused by a prompt edit looks exactly like one
-- caused by a model swap. It is a short hash of src/prompts/agent.txt — see
-- src/agent/prompt.js for why the plant index is deliberately excluded from it.
--
-- Existing rows keep null: they predate instrumentation, and backfilling them
-- with the currently configured model would assert something we do not know.
-- Every quality query must therefore treat null as "unattributed", not as the
-- current model.
--
-- Run once in the Supabase SQL editor, after 001–009.

alter table formulations
  add column if not exists model          text,
  add column if not exists provider       text,
  add column if not exists prompt_version text;

-- Supports the per-model save counts behind the correction-rate measure, which
-- always scopes to a recent window.
create index if not exists formulations_model_created_idx
  on formulations (model, created_at desc);

comment on column formulations.model is
  'Model id that produced this record, as reported by llm.modelName() at save time. Null means the record predates instrumentation.';
comment on column formulations.provider is
  'ollama | anthropic — which backend served the model named above.';
comment on column formulations.prompt_version is
  'Short hash of the agent system-prompt template in effect at save time.';

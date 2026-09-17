-- 015 — Notebook pages become reviewable text.
--
-- A photographed page was archived and shown to the agent as an image, and
-- nothing else. Three consequences, all invisible from the outside:
--
--   · The default agent model (qwen2.5:32b-instruct) is text-only. Ollama takes
--     an `images` array for it and ignores the pixels, so the agent answered
--     about a page it had never seen.
--   · Nothing recorded what any model thought the page said, so a formulation
--     extracted from a page could not be traced back to a misread word.
--   · A page could therefore never be corrected by a human, which is the only
--     way the reading improves. Voice notes have had that loop since 011.
--
-- A page reading is stored in media.transcript — the same column a voice note
-- uses, because it is the same artefact: a machine's account of what a primary
-- source said, which a human may later replace. What differs is which model
-- produced it, so that is now recorded per row rather than inferred from whatever
-- the environment happens to be set to at the time someone reads the table.
--
-- Corrections to a page use field 'page_transcript', not 'transcript'. The two
-- must not mix: an audio correction trains Whisper and a page correction trains
-- the vision model, and a training set that pooled them would teach each model
-- from the other's mistakes.
--
-- Run once, after 001–014.

alter table media
  -- Which model produced the transcript on this row, at the time it produced it.
  -- Null on rows that predate this migration: those are unattributed, and must
  -- never be counted as the currently configured model.
  add column if not exists transcript_model      text,
  add column if not exists transcript_provider   text,
  -- 0–1. For a page this is the share of words the model read rather than marked
  -- illegible — its own admission, not a number it invented. For audio it is
  -- Whisper's segment score. Null means not scored.
  add column if not exists transcript_confidence numeric;

-- The review queue reads pending media newest-first across both kinds, and the
-- unreviewed set stays small relative to the table.
create index if not exists media_kind_created_idx on media (kind, created_at desc);

-- Page corrections are looked up by media_id when rendering the queue, exactly
-- as transcript corrections are; 011 already indexed media_id, so the only thing
-- missing is a way to find page rows without scanning every field value.
create index if not exists corrections_page_transcript_idx
  on corrections (created_at desc) where field = 'page_transcript';

comment on column media.transcript is
  'What a machine read from this item: Whisper for a voice note, the vision model for a photographed page. Replaced by a human correction; the machine original survives as that correction''s before_value.';
comment on column media.transcript_confidence is
  '0–1, or null when not scored. Pages: share of words read rather than marked [?]. Voice: Whisper segment confidence.';

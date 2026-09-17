-- 011 — Let the other three feedback sources actually record something.
--
-- 005 built the corrections table around one source: a practitioner editing a
-- formulation. That is the rarest of the four signals this system can collect,
-- because it depends on a practitioner noticing an error themselves. The other
-- three had nowhere to write:
--
--   admin_review  — the /admin review inbox was a prototype with no endpoint.
--   transcript    — Whisper errors are the largest quality gap on this stack and
--                   corrections could not reference a media row at all.
--   eval_label    — a correction promoted into an eval case had no way to say so,
--                   so it would have been exported into training as well, and the
--                   model would have been graded on what it was trained on.
--
-- Run once in the Supabase SQL editor, after 001–010.

alter table corrections
  -- A transcript correction is about a voice note, not a formulation. Both stay
  -- nullable: the subject is one or the other, never neither, enforced below.
  add column if not exists media_id uuid references media(id) on delete cascade,
  -- Who proposed it. A practitioner edit is attributed by practitioner_id; an
  -- admin or research-team review needs its own pseudonymous reference, held to
  -- the same rule as an eval reviewer: never a name, phone number or account id.
  add column if not exists reviewer_ref text,
  -- Free text from the reviewer. Not training input — context for whoever audits
  -- the dataset later and wonders why a correction says what it says.
  add column if not exists note text,
  -- Set when this correction has been drafted into an evaluation case. Held-out
  -- rows are excluded from the training export: a model must never be graded on
  -- an example it was trained on, and that separation has to be enforced by the
  -- query, not by remembering.
  add column if not exists held_out_at timestamptz,
  add column if not exists held_out_case_id text;

-- A correction with no subject cannot be turned back into a training example,
-- because there is nothing to look up the original input from.
-- Added NOT VALID so the column additions above cannot be rolled back by a
-- legacy row that predates the rule; the validate step then reports any such row
-- explicitly rather than failing the whole migration halfway through.
alter table corrections
  drop constraint if exists corrections_has_subject;
alter table corrections
  add constraint corrections_has_subject
  check (formulation_id is not null or media_id is not null) not valid;
alter table corrections validate constraint corrections_has_subject;

-- The export reads unexported AND not-held-out rows; both are sparse.
drop index if exists corrections_unexported_idx;
create index if not exists corrections_trainable_idx
  on corrections (created_at) where exported_at is null and held_out_at is null;
create index if not exists corrections_media_idx on corrections (media_id);

comment on column corrections.held_out_at is
  'When this correction became an evaluation case. Held-out rows never enter the training export.';

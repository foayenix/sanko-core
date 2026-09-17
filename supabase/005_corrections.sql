-- 005 — Corrections: the training-data flywheel.
--
-- Every time a practitioner fixes something the model wrote down, that edit is
-- an expert labelling a specific mistake on real Nigerian traditional-medicine
-- data. There is no way to buy this dataset; it only accumulates by being used.
--
-- One row per changed field, holding the value before and after. Together with
-- the source transcript on the formulation, each row is a complete training
-- example: input (what was said) → wrong output (what the model produced) →
-- right output (what the practitioner corrected it to).
--
-- Run once in the Supabase SQL editor, after 001–004.

create table if not exists corrections (
  id              uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  formulation_id  uuid references formulations(id) on delete cascade,
  field           text not null,             -- plants | dosage | condition_std | …
  before_value    jsonb,                     -- what the model wrote
  after_value     jsonb,                     -- what the practitioner meant
  source          text not null default 'practitioner_edit'
                  check (source in ('practitioner_edit', 'admin_review', 'eval_label')),
  -- Which model produced the mistake. Without this you cannot tell whether a
  -- newly trained adapter actually fixed anything or just changed the errors.
  model           text,
  provider        text,
  -- Set once the example has been exported into a training set, so a rebuild
  -- can distinguish new corrections from ones the current adapter already saw.
  exported_at     timestamptz,
  created_at      timestamptz default now()
);

create index if not exists corrections_prac_idx     on corrections (practitioner_id);
create index if not exists corrections_field_idx    on corrections (field);
create index if not exists corrections_unexported_idx
  on corrections (created_at) where exported_at is null;

-- Same posture as every other table: RLS on, no policies (deny-all for anon and
-- authenticated). The bot's service-role key bypasses RLS.
alter table corrections enable row level security;

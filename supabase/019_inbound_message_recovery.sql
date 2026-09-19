-- Inbound message durability (019).
--
-- 012 made the dedup claim durable, which stopped a restart from reprocessing a
-- message. It did not stop a restart from *losing* one. The claim recorded only
-- that a message id had been seen: once the webhook acknowledged it, Meta stopped
-- retrying, and if the process died before the agent turn ran there was nothing
-- left anywhere that said what the practitioner had sent. A formulation dictated
-- into a voice note simply never arrived, and nobody — not the practitioner, not
-- the operator — had any way to know.
--
-- So the claim now carries the message itself, and says whether the work it
-- represents has been done. A sweep re-enqueues anything still owed.
--
-- The payload holds practitioner content, so it is kept for exactly as long as
-- the work is outstanding: cleared the moment the turn completes, and cleared
-- when a message is abandoned. A completed row keeps its id and nothing else,
-- which is all that dedup ever needed.

-- Run with: npm run migrate

alter table processed_messages
  -- The inbound message as the transport delivered it. Null once the turn is
  -- done — see the retention note above — and null for every row written before
  -- this migration, which the sweep therefore skips.
  add column if not exists payload jsonb,

  -- Null while the turn is still owed. Set when the turn finishes, whether it
  -- succeeded or failed in a way the practitioner was told about: both mean
  -- nobody is waiting on a reply that will never come.
  add column if not exists completed_at timestamptz,

  -- Times this message has been handed to the agent. Bounds recovery: a message
  -- that kills the process every time it is tried would otherwise be retried
  -- forever, taking the service down with it on every boot.
  add column if not exists attempts integer not null default 0;

-- The sweep reads only outstanding work, which is normally nothing at all. A
-- partial index keeps that read off the bulk of the table, which is completed
-- rows waiting to be pruned.
create index if not exists processed_messages_pending_idx
  on processed_messages (first_seen_at)
  where completed_at is null;

comment on column processed_messages.payload is
  'Inbound message, held only while its turn is outstanding. Cleared on completion or abandonment.';
comment on column processed_messages.completed_at is
  'When the turn for this message finished. Null means the work is still owed and the sweep will re-enqueue it.';
comment on column processed_messages.attempts is
  'Times handed to the agent. Caps recovery so a message that crashes the process cannot loop forever.';

-- Same reason as 008 and 012: a self-hosted stack does not grant these
-- automatically, and the symptom is a permission error on the first inbound
-- message after deploying. The grants on processed_messages already cover the
-- new columns, so there is nothing to add — this note exists so the next person
-- adding a column here does not go looking for a grant that is missing.

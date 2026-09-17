-- 012 — Move the runtime state that cannot survive a second instance.
--
-- Two things lived only in one Node process's memory:
--
--   seenMessageIds   Meta retries a webhook delivery with the SAME message id
--                    until it is acknowledged. The dedup set was a 10-minute
--                    in-memory TtlSet, so a restart mid-retry reprocessed the
--                    message — saving a formulation twice — and two instances
--                    never shared it at all.
--
--   turn serialisation  Nothing stopped two turns for the same practitioner
--                    running concurrently. Within one process the aggregator
--                    made that unlikely; across two it is routine, and the
--                    result is two agents interleaving tool calls on one Vault
--                    with a shared conversation history.
--
-- Neither is a problem at one instance and nine practitioners. Both are
-- unfixable-after-the-fact corruption of an archive that cannot be rebuilt, so
-- they move to the one place every instance already agrees on.
--
-- Also adds the plant-data version to formulations. 010 recorded the model and
-- the prompt; the third input to any extraction is the plant index interpolated
-- into that prompt, and it changes on every plants:build. Without it a record
-- produced when a local name was unresolved is indistinguishable from one
-- produced after it was confirmed.
--
-- Run with: npm run migrate

-- ─── inbound message dedup ────────────────────────────────────────────────────

create table if not exists processed_messages (
  message_id     text primary key,          -- Meta's wamid, or the transport's id
  transport      text not null default 'meta',
  first_seen_at  timestamptz not null default now()
);

-- Swept by the hourly cleanup in src/index.js. Meta stops retrying long before
-- this, and keeping the table small keeps the insert cheap.
create index if not exists processed_messages_age_idx on processed_messages (first_seen_at);

alter table processed_messages enable row level security;

-- ─── one agent turn per practitioner at a time ────────────────────────────────

-- A lease, not a lock: a process that dies holding one must not wedge that
-- practitioner's Vault forever, so it expires and the next turn takes it over.
-- expires_at is set from the caller's timeout, which is the only party that
-- knows how long a turn on this hardware legitimately takes.
create table if not exists turn_locks (
  practitioner_id uuid primary key references practitioners(id) on delete cascade,
  holder          text not null,            -- instance id, for diagnosing a stuck lease
  acquired_at     timestamptz not null default now(),
  expires_at      timestamptz not null
);

alter table turn_locks enable row level security;

-- Take the lease if it is free or expired; return nothing if someone else holds
-- a live one. One statement, so two instances racing cannot both win: the second
-- insert blocks on the primary key, then re-evaluates the where clause and
-- updates nothing.
create or replace function acquire_turn_lock(p_practitioner_id uuid, p_holder text, p_ttl_seconds int)
returns boolean
language plpgsql
as $$
declare
  v_acquired boolean;
begin
  insert into turn_locks (practitioner_id, holder, acquired_at, expires_at)
  values (p_practitioner_id, p_holder, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (practitioner_id) do update
    set holder = excluded.holder,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where turn_locks.expires_at < now()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function release_turn_lock(p_practitioner_id uuid, p_holder text)
returns void
language sql
as $$
  delete from turn_locks where practitioner_id = p_practitioner_id and holder = p_holder;
$$;

-- ─── plant-data provenance ────────────────────────────────────────────────────

alter table formulations
  add column if not exists plant_data_version text;

comment on column formulations.plant_data_version is
  'Build id of data/plant_lookup_v1.json in effect at save time (data/plants/build_report.json). Null predates instrumentation.';

-- ─── service-role grants for the new objects ──────────────────────────────────
--
-- Same reason as 008: a self-hosted stack does not grant these automatically,
-- and the symptom is "permission denied for table processed_messages" on the
-- first inbound message after deploying.
grant select, insert, update, delete on processed_messages, turn_locks to service_role;
grant execute on function acquire_turn_lock(uuid, text, int) to service_role;
grant execute on function release_turn_lock(uuid, text) to service_role;

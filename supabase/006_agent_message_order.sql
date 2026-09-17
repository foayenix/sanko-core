-- 006 — Give agent_messages a stable order.
--
-- A turn is written with one multi-row insert, and Postgres evaluates now() once
-- per statement — so the practitioner's message and the agent's reply land with
-- an identical created_at. `order by created_at` then has nothing to break the
-- tie and Postgres is free to return them in either order. Observed in the live
-- table: four consecutive rows came back assistant, user, assistant, user.
--
-- That is not only a display problem. loadAgentMessages() feeds these rows back
-- to the model as conversation history, so a scrambled pair shows the agent its
-- own reply *before* the question it answered — and sanitizeHistory(), which
-- trims to a span starting on a user turn, may drop the pair entirely and lose
-- the memory instead.
--
-- A bigserial is assigned in insert order within the statement, so (seq) is the
-- exact order the rows were written. Existing rows are numbered by table scan,
-- which is approximately insertion order and good enough for history that ages
-- out after 24 hours anyway.

alter table agent_messages add column if not exists seq bigserial;

create index if not exists agent_messages_prac_seq_idx
  on agent_messages (practitioner_id, seq desc);

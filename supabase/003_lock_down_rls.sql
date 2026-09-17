-- 003 — Lock down row-level security.
--
-- The placeholder policies from 001 were `for all using (true)` without a TO
-- clause, which applies to EVERY role — including anon. That made RLS
-- meaningless: anyone holding the project's anon key could read and write all
-- tables (phone numbers, transcripts, formulations).
--
-- The bot uses the service-role key, which bypasses RLS entirely, so no policy
-- is needed for it. Dropping all policies leaves RLS enabled with deny-all for
-- anon/authenticated, which is the correct posture until the practitioner web
-- dashboard (v2) introduces properly scoped policies.
--
-- Run once in the Supabase SQL editor.

drop policy if exists "service role full access - practitioners" on practitioners;
drop policy if exists "service role full access - media"          on media;
drop policy if exists "service role full access - formulations"   on formulations;
drop policy if exists "service role full access - sessions"       on sessions;
drop policy if exists "service role full access - events"         on events;

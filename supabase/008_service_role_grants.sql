-- 008 — Grant the service role DML on the application tables.
--
-- Hosted Supabase projects hand `service_role` full DML on everything in
-- `public` through default privileges, so 001–007 never had to say it. A
-- self-hosted stack does not: there, `service_role` starts with only
-- REFERENCES/TRIGGER/TRUNCATE and every insert fails with "permission denied
-- for table practitioners".
--
-- This grants the same privileges the hosted project already had, so it is a
-- no-op there and the fix here. It does NOT touch anon/authenticated: RLS
-- stays enabled with no policies for them, which is the deny-all posture 003
-- deliberately established. service_role bypasses RLS, which is why the bot
-- only ever needs this grant and no policy.

grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to service_role;

-- Tables added by later migrations should inherit the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;

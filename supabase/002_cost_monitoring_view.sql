-- Sanko Vault — cost monitoring view (G5)
-- Run in the Supabase SQL editor after 001_initial_schema.sql.
-- Provides a daily breakdown of API-cost events for the admin dashboard.

create or replace view v_usage_daily as
select
  created_at::date                              as day,
  event_type,
  coalesce(payload->>'type', 'text')            as sub_type,
  count(*)::int                                 as n
from events
group by 1, 2, 3
order by 1 desc, 2, 3;

comment on view v_usage_daily is
  'Daily event counts split by event_type and sub_type (vision vs text for claude_call). '
  'Used by the admin dashboard cost section and available for direct Supabase queries.';

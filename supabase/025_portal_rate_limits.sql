-- Rate limits for the /care and /evidence portals, shared by every server
-- process. They were previously counted in each process's memory, so running
-- two instances doubled every limit and a restart reset them.
--
-- A bucket is '<portal>:<login|action>:<client>', where <client> is an
-- HMAC-SHA256 of the client IP computed by the application with a secret the
-- database never sees (PORTAL_RATE_LIMIT_KEY). No IP address is stored.
-- Each bucket counts requests in a fixed window; a row whose window has ended
-- is reset by its next request or deleted by any later call.
create table portal_rate_limits (
  bucket text primary key check (bucket ~ '^(care|evidence):(login|action):[0-9a-f]{64}$'),
  hits int not null check (hits > 0),
  window_ends timestamptz not null
);
create index portal_rate_limits_window_ends on portal_rate_limits (window_ends);

alter table portal_rate_limits enable row level security;
revoke all on portal_rate_limits from anon, authenticated;
grant select, insert, update, delete on portal_rate_limits to service_role;

-- Counts one request against a bucket and returns {"allowed": true|false}:
-- whether it is within p_limit for the current window. The upsert is a single
-- atomic statement, so concurrent requests from several processes all count.
create function portal_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns jsonb language plpgsql as $$
declare n int;
begin
  if p_bucket is null or p_bucket !~ '^(care|evidence):(login|action):[0-9a-f]{64}$'
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'INVALID_INPUT';
  end if;

  insert into portal_rate_limits as r (bucket, hits, window_ends)
  values (p_bucket, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (bucket) do update set
    hits = case when r.window_ends <= now() then 1 else r.hits + 1 end,
    window_ends = case when r.window_ends <= now() then excluded.window_ends else r.window_ends end
  returning hits into n;

  -- Keep the table to roughly the buckets active in the last window. Rows
  -- another call is updating are skipped rather than waited for.
  delete from portal_rate_limits where bucket in (
    select bucket from portal_rate_limits
    where window_ends <= now() and bucket <> p_bucket
    order by window_ends limit 100
    for update skip locked
  );

  return jsonb_build_object('allowed', n <= p_limit);
end $$;
revoke all on function portal_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function portal_rate_limit(text, int, int) to service_role;

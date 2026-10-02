-- Complete the synthetic care review loop without relying on the first page
-- of a patient's timeline. Old unreviewed reports must remain actionable.
create function care_review_queue(p_token text,p_csrf text,p_practice uuid)
returns jsonb language plpgsql as $$
#variable_conflict use_column
declare a uuid; item record; result jsonb := '[]'::jsonb;
begin
  a := care_session_actor(p_token);
  if not exists(select 1 from care_sessions where token_hash=p_token and csrf_hash=p_csrf) then
    raise exception 'CSRF_REQUIRED';
  end if;
  if p_practice is null then raise exception 'NOT_FOUND'; end if;
  perform care_authorize(a,'practitioner',null,p_practice,false);
  for item in
    select o.id,o.subject_id,s.display_name,s.public_reference as reference,
      o.report,o.kind,o.observed_at,o.recorded_at,f.revision as follow_up_revision
    from care_observations o
    join care_subjects s on s.id=o.subject_id and s.synthetic
    join care_relationships r on r.subject_id=o.subject_id and r.practice_id=o.practice_id and r.tracking
    left join care_follow_ups f on f.id=o.follow_up_id
    where o.practice_id=p_practice
      and not exists(select 1 from care_reviews review where review.observation_id=o.id)
    order by o.recorded_at,o.id limit 50
  loop
    perform care_authorize(a,'practitioner',item.subject_id,p_practice,true);
    insert into care_audit(actor_id,subject_id,practice_id,action,resource_id)
      values(a,item.subject_id,p_practice,'review_queue.read',item.id);
    result := result || jsonb_build_array(to_jsonb(item));
  end loop;
  -- Empty reads are attributable too. Any audit failure rolls back the read.
  insert into care_audit(actor_id,practice_id,action) values(a,p_practice,'review_queue.read');
  return result;
end $$;
revoke all on function care_review_queue(text,text,uuid) from public,anon,authenticated;
grant execute on function care_review_queue(text,text,uuid) to service_role;

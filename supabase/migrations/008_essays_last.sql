-- Keep the randomized order of selected questions while placing any essay questions last.
update exam_attempts a
set question_order = (
  select array_agg(q.id order by (q.question_type = 'essay'), u.ord)
  from unnest(a.question_order) with ordinality u(id, ord)
  join exam_questions q on q.id = u.id
)
where cardinality(a.question_order) > 0;

create or replace function start_attempt(
  p_name text,
  p_email text,
  p_position text,
  p_level text,
  p_main_project text,
  p_token_hash text,
  p_code_hash text
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare s exam_settings; v_code uuid; v_order uuid[]; v_id uuid := gen_random_uuid(); v_deadline timestamptz;
begin
  select * into s from exam_settings where id = 1;
  if not s.active then raise exception 'closed'; end if;
  if now() < s.opening_at then raise exception 'not_open'; end if;
  if now() >= s.closing_at then raise exception 'closed'; end if;
  if s.invitation_required then
    update invitation_codes
      set uses = uses + 1,
          status = case when uses + 1 >= max_uses then 'consumed' else 'unused' end,
          consumed_at = case when uses + 1 >= max_uses then now() else null end
      where code_hash = p_code_hash and revoked_at is null and uses < max_uses
      returning id into v_code;
    if v_code is null then raise exception 'bad_code'; end if;
  end if;
  select array_agg(id order by is_essay, r) into v_order
    from (
      select id, question_type = 'essay' as is_essay, random() as r
      from exam_questions where active order by r limit s.question_count
    ) q;
  if coalesce(array_length(v_order, 1), 0) = 0 then raise exception 'no_questions'; end if;
  v_deadline := least(now() + make_interval(mins => s.duration_minutes), s.closing_at);
  insert into exam_attempts(
    id, full_name, normalized_email, position, candidate_level, main_project,
    invitation_code_id, token_hash, deadline_at, question_order
  ) values (
    v_id, p_name, p_email, p_position, p_level, p_main_project,
    v_code, p_token_hash, v_deadline, v_order
  );
  if v_code is not null then update invitation_codes set consumed_by_attempt_id = v_id where id = v_code; end if;
  return v_deadline;
end $$;

grant execute on function start_attempt(text, text, text, text, text, text, text) to service_role;

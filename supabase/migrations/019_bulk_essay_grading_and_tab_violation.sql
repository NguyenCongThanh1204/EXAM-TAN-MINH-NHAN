create or replace function refresh_attempt_score(p_attempt uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  s exam_settings;
  v_question_count integer;
  v_ungraded integer;
  v_correct integer;
  v_incorrect integer;
  v_scored numeric(10, 2);
  v_total numeric(10, 2);
  v_result text;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then return null; end if;
  if a.status = 'in_progress' then raise exception 'attempt_not_submitted'; end if;

  select * into s from exam_settings where id = 1;
  select
    count(*)::integer,
    count(*) filter (where q.question_type = 'essay' and ea.essay_passed is null)::integer,
    count(*) filter (where q.question_type <> 'essay'
      and jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(coalesce(k.correct_options, '[]'::jsonb))
      and not exists (
        select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) selected
        where not coalesce(k.correct_options, '[]'::jsonb) @> jsonb_build_array(selected.value)
      ))::integer,
    count(*) filter (where q.question_type <> 'essay')::integer,
    coalesce(sum(case
      when q.question_type = 'essay' then case when ea.essay_passed then 0.5 else 0 end
      when jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(coalesce(k.correct_options, '[]'::jsonb))
        and not exists (
          select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) selected
          where not coalesce(k.correct_options, '[]'::jsonb) @> jsonb_build_array(selected.value)
        ) then 0.5
      else 0
    end), 0)
  into v_question_count, v_ungraded, v_correct, v_incorrect, v_scored
  from unnest(a.question_order) selected(id)
  join exam_questions q on q.id = selected.id
  left join question_keys k on k.question_id = q.id
  left join exam_answers ea on ea.attempt_id = a.id and ea.question_id = q.id;

  v_total := v_question_count * 0.5;
  v_scored := round(v_scored, 2);
  v_result := case
    when a.submit_reason = 'tab_switch' then 'FAIL'
    when v_ungraded > 0 or v_total <= 0 then null
    when v_scored * 100 >= v_total * s.passing_percentage then 'PASS'
    else 'FAIL'
  end;
  update exam_attempts set
    correct_count = v_correct,
    incorrect_count = greatest(v_incorrect - v_correct, 0),
    scored_points = case when v_ungraded = 0 then v_scored else null end,
    total_points = v_total,
    result = v_result,
    updated_at = now()
  where id = a.id;

  return jsonb_build_object(
    'pendingGrade', v_ungraded > 0,
    'correct', v_correct,
    'incorrect', greatest(v_incorrect - v_correct, 0),
    'scoredPoints', case when v_ungraded = 0 and v_total > 0 then round(v_scored / v_total * 10, 2) else null end,
    'totalPoints', 10,
    'result', v_result
  );
end $$;

revoke all on function refresh_attempt_score(uuid) from public, anon, authenticated;
grant execute on function refresh_attempt_score(uuid) to service_role;

create or replace function finalize_attempt(p_attempt uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  v_correct integer;
  v_total integer;
  v_status text;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then return null; end if;
  if a.status = 'in_progress' then
    select n_correct, n_total into v_correct, v_total from mc_score(p_attempt);
    v_status := case when p_reason = 'manual' and now() < a.deadline_at then 'submitted' else 'auto_submitted' end;
    update exam_attempts set
      status = v_status,
      submit_reason = p_reason,
      submitted_at = now(),
      correct_count = v_correct,
      incorrect_count = greatest(v_total - v_correct, 0),
      updated_at = now()
    where id = a.id;
    insert into exam_events(attempt_id, event_type, metadata)
      values (a.id, 'finalize', jsonb_build_object('reason', p_reason));

    if p_reason = 'tab_switch' then
      insert into exam_answers(
        attempt_id, question_id, selected_option, selected_options, essay_response, essay_passed
      )
      select a.id, q.id, '', '[]'::jsonb, null, false
      from unnest(a.question_order) selected(id)
      join exam_questions q on q.id = selected.id and q.question_type = 'essay'
      on conflict (attempt_id, question_id) do update
        set essay_passed = false, updated_at = now();
    end if;

    perform refresh_attempt_score(p_attempt);
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function finalize_attempt(uuid, text) from public, anon, authenticated;
grant execute on function finalize_attempt(uuid, text) to service_role;

create or replace function grade_essay_attempt(p_attempt uuid, p_grades jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  v_essay_count integer;
  v_result jsonb;
begin
  if p_grades is null or jsonb_typeof(p_grades) <> 'array' then
    raise exception 'invalid_grade';
  end if;
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status = 'in_progress' then raise exception 'attempt_not_submitted'; end if;

  select count(*)::integer into v_essay_count
  from unnest(a.question_order) selected(id)
  join exam_questions q on q.id = selected.id and q.question_type = 'essay';

  if jsonb_array_length(p_grades) <> v_essay_count
    or exists (
      select 1 from jsonb_array_elements(p_grades) grade
      where jsonb_typeof(grade.value) <> 'object'
        or coalesce(jsonb_typeof(grade.value -> 'questionId'), '') <> 'string'
        or coalesce(jsonb_typeof(grade.value -> 'passed'), '') <> 'boolean'
    )
    or (select count(distinct grade.value ->> 'questionId') from jsonb_array_elements(p_grades) grade) <> v_essay_count
    or exists (
      select 1 from jsonb_array_elements(p_grades) grade
      where not exists (
        select 1 from unnest(a.question_order) selected(id)
        join exam_questions q on q.id = selected.id and q.question_type = 'essay'
        where q.id::text = grade.value ->> 'questionId'
      )
    ) then
    raise exception 'invalid_grade';
  end if;

  insert into exam_answers(
    attempt_id, question_id, selected_option, selected_options, essay_response, essay_passed
  )
  select a.id, q.id, '', '[]'::jsonb, null, (grade.value ->> 'passed')::boolean
  from jsonb_array_elements(p_grades) grade
  join unnest(a.question_order) selected(id) on true
  join exam_questions q on q.id = selected.id
    and q.question_type = 'essay'
    and q.id::text = grade.value ->> 'questionId'
  on conflict (attempt_id, question_id) do update
    set essay_passed = excluded.essay_passed,
        updated_at = now();

  v_result := refresh_attempt_score(a.id);
  return v_result;
end $$;

revoke all on function grade_essay_attempt(uuid, jsonb) from public, anon, authenticated;
grant execute on function grade_essay_attempt(uuid, jsonb) to service_role;

insert into exam_answers(
  attempt_id, question_id, selected_option, selected_options, essay_response, essay_passed
)
select a.id, q.id, '', '[]'::jsonb, null, false
from exam_attempts a
cross join unnest(a.question_order) selected(id)
join exam_questions q on q.id = selected.id and q.question_type = 'essay'
where a.status <> 'in_progress' and a.submit_reason = 'tab_switch'
on conflict (attempt_id, question_id) do update
  set essay_passed = false, updated_at = now();

do $$
declare
  item record;
begin
  for item in select id from exam_attempts where status <> 'in_progress' loop
    perform refresh_attempt_score(item.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

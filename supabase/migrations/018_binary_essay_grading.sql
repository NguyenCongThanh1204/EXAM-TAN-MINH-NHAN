alter table exam_answers
  add column if not exists essay_passed boolean;

update exam_questions
set points = 0.5
where question_type = 'essay';

create or replace function refresh_attempt_score(p_attempt uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  s exam_settings;
  v_question_count integer;
  v_essay_count integer;
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
    count(*) filter (where q.question_type = 'essay')::integer,
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
  into v_question_count, v_essay_count, v_ungraded, v_correct, v_incorrect, v_scored
  from unnest(a.question_order) selected(id)
  join exam_questions q on q.id = selected.id
  left join question_keys k on k.question_id = q.id
  left join exam_answers ea on ea.attempt_id = a.id and ea.question_id = q.id;

  v_total := v_question_count * 0.5;
  v_scored := round(v_scored, 2);
  v_result := case
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

create or replace function grade_essay_answer(
  p_attempt uuid,
  p_question uuid,
  p_passed boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  q exam_questions;
  v_result jsonb;
begin
  if p_passed is null then raise exception 'invalid_grade'; end if;
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status = 'in_progress' then raise exception 'attempt_not_submitted'; end if;
  if not p_question = any(a.question_order) then raise exception 'question_not_in_attempt'; end if;

  select * into q from exam_questions where id = p_question;
  if not found or q.question_type <> 'essay' then raise exception 'question_not_essay'; end if;

  insert into exam_answers(
    attempt_id, question_id, selected_option, selected_options, essay_response, essay_passed
  ) values (a.id, q.id, '', '[]'::jsonb, null, p_passed)
  on conflict (attempt_id, question_id) do update
    set essay_passed = excluded.essay_passed,
        updated_at = now();

  v_result := refresh_attempt_score(a.id);
  return v_result;
end $$;

revoke all on function grade_essay_answer(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function grade_essay_answer(uuid, uuid, boolean) to service_role;

do $$
declare
  item record;
begin
  for item in select id from exam_attempts where status <> 'in_progress' loop
    perform refresh_attempt_score(item.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

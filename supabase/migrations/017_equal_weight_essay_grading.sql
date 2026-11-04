alter table exam_answers
  add column essay_feedback text
    check (essay_feedback is null or char_length(essay_feedback) <= 2000);

update exam_settings
set question_count = 20,
    mc_question_count = 15,
    essay_question_count = 5,
    passing_percentage = 70,
    updated_at = now()
where id = 1;

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
    count(*) filter (where q.question_type = 'essay' and ea.essay_score is null)::integer,
    count(*) filter (where q.question_type <> 'essay'
      and jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(coalesce(k.correct_options, '[]'::jsonb))
      and not exists (
        select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) selected
        where not coalesce(k.correct_options, '[]'::jsonb) @> jsonb_build_array(selected.value)
      ))::integer,
    count(*) filter (where q.question_type <> 'essay')::integer,
    coalesce(sum(case
      when q.question_type = 'essay' then coalesce(ea.essay_score / q.points * 0.5, 0)
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
    perform refresh_attempt_score(p_attempt);
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function finalize_attempt(uuid, text) from public, anon, authenticated;
grant execute on function finalize_attempt(uuid, text) to service_role;

create or replace function grade_essay_answer(
  p_attempt uuid,
  p_question uuid,
  p_score numeric,
  p_feedback text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  q exam_questions;
  v_result jsonb;
begin
  if p_score is null or p_feedback is not null and char_length(p_feedback) > 2000 then
    raise exception 'invalid_grade';
  end if;
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status = 'in_progress' then raise exception 'attempt_not_submitted'; end if;
  if not p_question = any(a.question_order) then raise exception 'question_not_in_attempt'; end if;

  select * into q from exam_questions where id = p_question;
  if not found or q.question_type <> 'essay' then raise exception 'question_not_essay'; end if;
  if p_score < 0 or p_score > q.points then raise exception 'invalid_grade'; end if;
  insert into exam_answers(
    attempt_id, question_id, selected_option, selected_options, essay_response, essay_score, essay_feedback
  ) values (a.id, q.id, '', '[]'::jsonb, null, p_score, p_feedback)
  on conflict (attempt_id, question_id) do update
    set essay_score = excluded.essay_score,
        essay_feedback = excluded.essay_feedback,
        updated_at = now();

  v_result := refresh_attempt_score(a.id);
  return v_result;
end $$;

revoke all on function grade_essay_answer(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function grade_essay_answer(uuid, uuid, numeric, text) to service_role;

create or replace function attempt_state(p_attempt uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  s exam_settings;
  v_has_essay boolean;
begin
  select * into a from exam_attempts where id = p_attempt;
  if not found then return null; end if;
  if a.status = 'in_progress' and now() >= a.deadline_at then
    perform finalize_attempt(p_attempt, 'deadline');
    select * into a from exam_attempts where id = p_attempt;
  end if;
  select * into s from exam_settings where id = 1;

  if a.status <> 'in_progress' then
    select exists (
      select 1 from unnest(a.question_order) selected(id)
      join exam_questions q on q.id = selected.id and q.question_type = 'essay'
    ) into v_has_essay;
    return jsonb_build_object(
      'status', a.status,
      'serverNow', now(),
      'hasEssay', v_has_essay,
      'pendingGrade', a.result is null and v_has_essay,
      'result', case when s.show_score and a.result is not null then
        jsonb_build_object(
          'correct', a.correct_count,
          'incorrect', a.incorrect_count,
          'scoredPoints', round(a.scored_points / a.total_points * 10, 2),
          'totalPoints', 10,
          'result', a.result
        )
        else null end
    );
  end if;

  return jsonb_build_object(
    'status', a.status,
    'serverNow', now(),
    'deadlineAt', a.deadline_at,
    'candidate', jsonb_build_object(
      'fullName', a.full_name, 'position', a.position,
      'level', a.candidate_level, 'mainProject', a.main_project
    ),
    'questions', (
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'text', q.question_text, 'type', q.question_type, 'points', q.points, 'options', q.options
      ) order by selected.ordinality)
      from unnest(a.question_order) with ordinality selected(id, ordinality)
      join exam_questions q on q.id = selected.id
    ),
    'answers', coalesce((
      select jsonb_object_agg(question_id, jsonb_build_object(
        'options', selected_options, 'essay', essay_response
      )) from exam_answers where attempt_id = a.id
    ), '{}'::jsonb)
  );
end $$;

revoke all on function attempt_state(uuid) from public, anon, authenticated;
grant execute on function attempt_state(uuid) to service_role;

create or replace function start_attempt(
  p_name text,
  p_email text,
  p_position text,
  p_level text,
  p_main_project text,
  p_token_hash text
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  s exam_settings;
  v_order uuid[];
  v_id uuid := gen_random_uuid();
  v_deadline timestamptz;
  v_project exam_projects;
  v_email text := lower(btrim(p_email));
  v_participant_order integer;
  v_participant_name text;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  if exists (select 1 from exam_attempts where normalized_email = v_email) then
    raise exception 'email_used';
  end if;
  select sequence_number, participant_name
  into v_participant_order, v_participant_name
  from participant_email_allowlist
  where email = v_email;
  if not found then raise exception 'email_not_allowed'; end if;

  select * into v_project
  from exam_projects
  where lower(btrim(name)) = lower(btrim(p_main_project)) and active
  for share;
  if not found then raise exception 'invalid_project'; end if;

  select * into s from exam_settings where id = 1;
  if not s.active then raise exception 'closed'; end if;
  if now() < s.opening_at then raise exception 'not_open'; end if;
  if now() >= s.closing_at then raise exception 'closed'; end if;
  if s.mc_question_count + s.essay_question_count <> 20 then
    raise exception 'invalid_question_count';
  end if;

  with selected_multiple_choice as (
    select id, random() as r
    from exam_questions
    where active and question_type in ('single', 'multiple')
    order by r
    limit s.mc_question_count
  ), selected_essay as (
    select id, random() as r
    from exam_questions
    where active and question_type = 'essay'
    order by r
    limit s.essay_question_count
  ), selected_questions as (
    select id, r, false as is_essay from selected_multiple_choice
    union all
    select id, r, true as is_essay from selected_essay
  )
  select array_agg(id order by is_essay, r) into v_order
  from selected_questions;
  if coalesce(array_length(v_order, 1), 0) <> 20 then raise exception 'not_ready'; end if;
  v_deadline := least(now() + make_interval(mins => s.duration_minutes), s.closing_at);
  insert into exam_attempts(
    id, full_name, normalized_email, position, candidate_level, main_project, project_id,
    token_hash, deadline_at, question_order, participant_order, participant_list_name
  ) values (
    v_id, p_name, v_email, p_position, p_level, v_project.name, v_project.id,
    p_token_hash, v_deadline, v_order, v_participant_order, v_participant_name
  );
  return v_deadline;
end $$;

revoke all on function start_attempt(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function start_attempt(text, text, text, text, text, text) to service_role;

do $$
declare
  item record;
begin
  for item in select id from exam_attempts where status <> 'in_progress' loop
    perform refresh_attempt_score(item.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

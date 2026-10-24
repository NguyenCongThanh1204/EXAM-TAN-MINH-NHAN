-- Trắc nghiệm được chấm ngay khi nộp bài (mỗi câu 1 điểm, kể cả câu nhiều đáp án).
-- Câu tự luận không tham gia kết quả trong ứng dụng; giám khảo chấm trong file Excel.

update exam_questions set points = 1 where question_type <> 'essay';

create or replace function mc_score(p_attempt uuid)
returns table (n_correct int, n_total int)
language sql stable security definer set search_path = public as $$
  select
    (count(*) filter (where
      jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(k.correct_options)
      and not exists (
        select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) x
        where not k.correct_options @> jsonb_build_array(x.value)
      )
    ))::int,
    count(*)::int
  from exam_attempts a
  cross join lateral unnest(a.question_order) u(id)
  join exam_questions q on q.id = u.id and q.question_type <> 'essay'
  left join question_keys k on k.question_id = q.id
  left join exam_answers ea on ea.attempt_id = a.id and ea.question_id = q.id
  where a.id = p_attempt
$$;
revoke all on function mc_score(uuid) from public, anon, authenticated;
grant execute on function mc_score(uuid) to service_role;

create or replace function finalize_attempt(p_attempt uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts; s exam_settings; v_correct int; v_total int; v_result text; v_status text;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then return null; end if;
  if a.status = 'in_progress' then
    select * into s from exam_settings where id = 1;
    select n_correct, n_total into v_correct, v_total from mc_score(p_attempt);
    v_status := case when p_reason = 'manual' and now() < a.deadline_at then 'submitted' else 'auto_submitted' end;
    if v_total > 0 then
      v_result := case when v_correct * 100 >= v_total * s.passing_percentage then 'PASS' else 'FAIL' end;
    end if;
    update exam_attempts set
      status = v_status, submit_reason = p_reason, submitted_at = now(),
      correct_count = v_correct, incorrect_count = greatest(v_total - v_correct, 0),
      scored_points = v_correct, total_points = v_total, result = v_result, updated_at = now()
    where id = a.id;
    insert into exam_events(attempt_id, event_type, metadata)
      values (a.id, 'finalize', jsonb_build_object('reason', p_reason, 'correct', v_correct, 'total', v_total));
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function attempt_state(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a exam_attempts; s exam_settings; v_has_essay boolean;
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
      select 1 from unnest(a.question_order) u(id)
      join exam_questions q on q.id = u.id and q.question_type = 'essay'
    ) into v_has_essay;
    return jsonb_build_object(
      'status', a.status, 'serverNow', now(),
      'hasEssay', v_has_essay,
      'result', case when s.show_score and a.total_points > 0 then
        jsonb_build_object('correct', a.correct_count, 'incorrect', a.incorrect_count,
          'scoredPoints', a.scored_points, 'totalPoints', a.total_points, 'result', a.result)
        else null end
    );
  end if;
  return jsonb_build_object('status', a.status, 'serverNow', now(), 'deadlineAt', a.deadline_at,
    'candidate', jsonb_build_object('fullName', a.full_name, 'position', a.position,
      'level', a.candidate_level, 'mainProject', a.main_project),
    'questions', (select jsonb_agg(jsonb_build_object(
      'id', q.id, 'text', q.question_text, 'type', q.question_type, 'points', q.points, 'options', q.options
    ) order by u.ord) from unnest(a.question_order) with ordinality u(id, ord)
      join exam_questions q on q.id = u.id),
    'answers', coalesce((
      select jsonb_object_agg(question_id, jsonb_build_object(
        'options', selected_options, 'essay', essay_response
      )) from exam_answers where attempt_id = a.id
    ), '{}'::jsonb)
  );
end $$;

-- Tính lại các bài đã nộp trước đây (đang chờ chấm tự luận hoặc chấm theo điểm cũ).
do $$
declare r record; v_correct int; v_total int; v_pass int;
begin
  select passing_percentage into v_pass from exam_settings where id = 1;
  for r in select id from exam_attempts where status <> 'in_progress' loop
    select n_correct, n_total into v_correct, v_total from mc_score(r.id);
    update exam_attempts set
      correct_count = v_correct, incorrect_count = greatest(v_total - v_correct, 0),
      scored_points = v_correct, total_points = v_total,
      result = case when v_total = 0 then null
                    when v_correct * 100 >= v_total * v_pass then 'PASS' else 'FAIL' end
    where id = r.id;
  end loop;
end $$;

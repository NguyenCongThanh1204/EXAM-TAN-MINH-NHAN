alter table exam_attempts
  add column candidate_level text not null default '',
  add column main_project text not null default '',
  add column scored_points numeric(10, 2),
  add column total_points numeric(10, 2);
update exam_attempts
  set scored_points = correct_count,
      total_points = array_length(question_order, 1)
  where result is not null;

alter table exam_questions
  add column question_type text not null default 'single'
    check (question_type in ('single', 'multiple', 'essay')),
  add column points numeric(10, 2) not null default 1 check (points > 0);

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'exam_questions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%options%'
      and pg_get_constraintdef(oid) ilike '%jsonb_array_length%'
  loop
    execute format('alter table exam_questions drop constraint %I', c.conname);
  end loop;
end $$;
alter table exam_questions
  add constraint exam_questions_options_by_type_check check (
    (question_type = 'essay' and jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 0)
    or
    (question_type <> 'essay' and jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6)
  );

alter table question_keys
  add column correct_options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(correct_options) = 'array'),
  add column reference_answer text;
update question_keys set correct_options = jsonb_build_array(lower(correct_option));

alter table exam_answers
  add column selected_options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(selected_options) = 'array'),
  add column essay_response text,
  add column essay_score numeric(10, 2);
update exam_answers
  set selected_options = case
    when selected_option = '' then '[]'::jsonb
    else jsonb_build_array(selected_option)
  end;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'exam_attempts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%result%'
  loop
    execute format('alter table exam_attempts drop constraint %I', c.conname);
  end loop;
end $$;

alter table exam_attempts
  add constraint exam_attempts_result_value_check check (result is null or result in ('PASS', 'FAIL'));

drop function if exists start_attempt(text, text, text, text, text);
create function start_attempt(
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
  select array_agg(id order by r) into v_order
    from (select id, random() r from exam_questions where active order by r limit s.question_count) q;
  if coalesce(array_length(v_order, 1), 0) <> s.question_count then raise exception 'not_ready'; end if;
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

create or replace function finalize_attempt(p_attempt uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts; s exam_settings; v_correct int; v_mc_questions int;
  v_total_points numeric(10, 2); v_scored_points numeric(10, 2);
  v_ungraded int; v_result text; v_status text;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then return null; end if;
  if a.status = 'in_progress' then
    select * into s from exam_settings where id = 1;
    select
      count(*) filter (where q.question_type <> 'essay'
        and jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(k.correct_options)
        and not exists (
          select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) x
          where not k.correct_options @> jsonb_build_array(x.value)
        )),
      count(*) filter (where q.question_type <> 'essay'),
      coalesce(sum(q.points), 0),
      coalesce(sum(case
        when q.question_type = 'essay' then coalesce(ea.essay_score, 0)
        when jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(k.correct_options)
          and not exists (
            select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) x
            where not k.correct_options @> jsonb_build_array(x.value)
          ) then q.points
        else 0
      end), 0),
      count(*) filter (where q.question_type = 'essay' and ea.essay_score is null)
    into v_correct, v_mc_questions, v_total_points, v_scored_points, v_ungraded
    from unnest(a.question_order) u(id)
    join exam_questions q on q.id = u.id
    left join question_keys k on k.question_id = q.id
    left join exam_answers ea on ea.attempt_id = a.id and ea.question_id = q.id;

    v_status := case when p_reason = 'manual' and now() < a.deadline_at then 'submitted' else 'auto_submitted' end;
    if v_ungraded = 0 then
      v_result := case when v_total_points > 0 and v_scored_points * 100 >= v_total_points * s.passing_percentage then 'PASS' else 'FAIL' end;
    end if;
    update exam_attempts set
      status = v_status, submit_reason = p_reason, submitted_at = now(),
      correct_count = v_correct, incorrect_count = greatest(v_mc_questions - v_correct, 0),
      scored_points = case when v_ungraded = 0 then v_scored_points else null end,
      total_points = v_total_points, result = v_result, updated_at = now()
    where id = a.id;
    insert into exam_events(attempt_id, event_type, metadata)
      values (a.id, 'finalize', jsonb_build_object('reason', p_reason, 'pending_essays', v_ungraded));
  end if;
  return jsonb_build_object('ok', true);
end $$;

drop function if exists save_answer(uuid, uuid, text);
create function save_answer(p_attempt uuid, p_question uuid, p_options jsonb, p_essay text) returns text
language plpgsql security definer set search_path = public as $$
declare a exam_attempts; q exam_questions; v_valid boolean;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then return 'not_found'; end if;
  if a.status <> 'in_progress' then return 'closed'; end if;
  if now() >= a.deadline_at then perform finalize_attempt(p_attempt, 'deadline'); return 'expired'; end if;
  if not (p_question = any(a.question_order)) then return 'invalid'; end if;
  select * into q from exam_questions where id = p_question;
  if not found then return 'invalid'; end if;
  if q.question_type = 'essay' then
    if p_essay is null or length(p_essay) > 10000 or coalesce(jsonb_array_length(p_options), 0) <> 0 then return 'invalid'; end if;
    insert into exam_answers(attempt_id, question_id, selected_option, selected_options, essay_response)
      values (p_attempt, p_question, '', '[]'::jsonb, p_essay)
      on conflict (attempt_id, question_id) do update
        set selected_option = '', selected_options = '[]'::jsonb, essay_response = excluded.essay_response, updated_at = now();
  else
    if p_options is null or jsonb_typeof(p_options) <> 'array'
      or (q.question_type = 'single' and jsonb_array_length(p_options) <> 1)
      or (select count(*) from jsonb_array_elements_text(p_options)) <> (select count(distinct value) from jsonb_array_elements_text(p_options))
    then return 'invalid'; end if;
    select not exists (
      select 1 from jsonb_array_elements_text(p_options) o
      where not exists (select 1 from jsonb_array_elements(q.options) opt where opt->>'id' = o.value)
    ) into v_valid;
    if not v_valid then return 'invalid'; end if;
    insert into exam_answers(attempt_id, question_id, selected_option, selected_options, essay_response, essay_score)
      values (p_attempt, p_question, array_to_string(array(select jsonb_array_elements_text(p_options)), ','), p_options, null, null)
      on conflict (attempt_id, question_id) do update
        set selected_option = excluded.selected_option, selected_options = excluded.selected_options,
            essay_response = null, essay_score = null, updated_at = now();
  end if;
  return 'ok';
end $$;

create or replace function attempt_state(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a exam_attempts; s exam_settings;
begin
  select * into a from exam_attempts where id = p_attempt;
  if not found then return null; end if;
  if a.status = 'in_progress' and now() >= a.deadline_at then
    perform finalize_attempt(p_attempt, 'deadline');
    select * into a from exam_attempts where id = p_attempt;
  end if;
  select * into s from exam_settings where id = 1;
  if a.status <> 'in_progress' then
    return jsonb_build_object(
      'status', a.status, 'serverNow', now(),
      'pendingGrade', a.result is null,
      'result', case when s.show_score and a.result is not null then
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

drop function if exists import_questions(text, jsonb);
create function import_questions(p_mode text, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare it jsonb; qid uuid; n int := 0; v_type text; v_correct jsonb;
begin
  if exists (select 1 from exam_attempts) then raise exception 'locked'; end if;
  if p_mode not in ('replace', 'append') then raise exception 'invalid_mode'; end if;
  if p_mode = 'replace' then delete from exam_questions where true; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_type := coalesce(it->>'type', 'single');
    v_correct := coalesce(it->'correct', '[]'::jsonb);
    insert into exam_questions(question_text, options, question_type, points)
      values (it->>'text', coalesce(it->'options', '[]'::jsonb), v_type, coalesce((it->>'points')::numeric, 1))
      returning id into qid;
    insert into question_keys(question_id, correct_option, correct_options, reference_answer)
      values (qid, coalesce(v_correct->>0, ''), v_correct, nullif(it->>'referenceAnswer', ''));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function import_questions(text, jsonb) from public, anon, authenticated;
grant execute on function import_questions(text, jsonb) to service_role;

create or replace function grade_essay(p_attempt uuid, p_question uuid, p_score numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a exam_attempts; v_question exam_questions; s exam_settings; v_ungraded int; v_total numeric(10, 2);
  v_score numeric(10, 2); v_correct int; v_mc_questions int; v_result text;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found or a.status = 'in_progress' then raise exception 'attempt_not_submitted'; end if;
  select * into v_question from exam_questions where id = p_question;
  if not found or v_question.question_type <> 'essay' or p_score < 0 or p_score > v_question.points
    or not (p_question = any(a.question_order)) then raise exception 'invalid_grade'; end if;
  insert into exam_answers(attempt_id, question_id, selected_option, selected_options, essay_score)
    values (p_attempt, p_question, '', '[]'::jsonb, p_score)
    on conflict (attempt_id, question_id) do update set essay_score = excluded.essay_score, updated_at = now();
  insert into exam_events(attempt_id, event_type, metadata)
    values (p_attempt, 'essay_grade', jsonb_build_object('question_id', p_question, 'score', p_score));
  select count(*) into v_ungraded from unnest(a.question_order) u(id)
    join exam_questions x on x.id = u.id and x.question_type = 'essay'
    left join exam_answers ea on ea.attempt_id = a.id and ea.question_id = x.id
    where ea.essay_score is null;
  if v_ungraded > 0 then return jsonb_build_object('pendingGrade', true, 'remaining', v_ungraded); end if;

  select * into s from exam_settings where id = 1;
  select count(*) filter (where eq.question_type <> 'essay'
      and jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(k.correct_options)
      and not exists (
        select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) x
        where not k.correct_options @> jsonb_build_array(x.value)
      )),
    count(*) filter (where eq.question_type <> 'essay'),
    coalesce(sum(case
      when eq.question_type = 'essay' then ea.essay_score
      when jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(k.correct_options)
        and not exists (
          select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) x
          where not k.correct_options @> jsonb_build_array(x.value)
        ) then eq.points
      else 0 end), 0),
    coalesce(sum(eq.points), 0)
  into v_correct, v_mc_questions, v_score, v_total
  from unnest(a.question_order) u(id) join exam_questions eq on eq.id = u.id
  left join question_keys k on k.question_id = eq.id
  left join exam_answers ea on ea.attempt_id = a.id and ea.question_id = eq.id;
  v_result := case when v_total > 0 and v_score * 100 >= v_total * s.passing_percentage then 'PASS' else 'FAIL' end;
  update exam_attempts set
    correct_count = v_correct, incorrect_count = greatest(v_mc_questions - v_correct, 0),
    scored_points = v_score, total_points = v_total, result = v_result, updated_at = now()
    where id = p_attempt;
  return jsonb_build_object('pendingGrade', false, 'scoredPoints', v_score, 'totalPoints', v_total, 'result', v_result);
end $$;

revoke all on function start_attempt(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function save_answer(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function grade_essay(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function import_questions(text, jsonb) from public, anon, authenticated;
grant execute on function start_attempt(text, text, text, text, text, text, text) to service_role;
grant execute on function save_answer(uuid, uuid, jsonb, text) to service_role;
grant execute on function grade_essay(uuid, uuid, numeric) to service_role;

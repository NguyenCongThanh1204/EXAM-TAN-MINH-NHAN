create or replace function save_answers(p_attempt uuid, p_answers jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  item jsonb;
  answer_result text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    return 'invalid';
  end if;
  if jsonb_array_length(p_answers) < 1 or jsonb_array_length(p_answers) > 5 then
    return 'invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_answers) as entries(value)
    where jsonb_typeof(value) <> 'object'
      or not (value ? 'questionId')
      or jsonb_typeof(value->'questionId') <> 'string'
      or coalesce(value->>'questionId', '') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      or ((value ? 'optionIds') = (value ? 'essay'))
      or (value ? 'optionIds' and jsonb_typeof(value->'optionIds') <> 'array')
      or (value ? 'essay' and jsonb_typeof(value->'essay') <> 'string')
  ) then
    return 'invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_answers) as entries(value)
    group by value->>'questionId'
    having count(*) > 1
  ) then
    return 'invalid';
  end if;

  select * into a from exam_attempts where id = p_attempt for update;
  if not found then return 'not_found'; end if;
  if a.status <> 'in_progress' then return 'closed'; end if;
  if now() >= a.deadline_at then
    perform finalize_attempt(p_attempt, 'deadline');
    return 'expired';
  end if;

  for item in select value from jsonb_array_elements(p_answers) as entries(value) loop
    answer_result := save_answer(
      p_attempt,
      (item->>'questionId')::uuid,
      coalesce(item->'optionIds', '[]'::jsonb),
      item->>'essay'
    );
    if answer_result = 'expired' then return 'expired'; end if;
    if answer_result <> 'ok' then
      raise exception using message = 'invalid_answers', errcode = 'P0001';
    end if;
  end loop;

  return 'ok';
end $$;

revoke all on function save_answers(uuid, jsonb) from public, anon, authenticated;
grant execute on function save_answers(uuid, jsonb) to service_role;

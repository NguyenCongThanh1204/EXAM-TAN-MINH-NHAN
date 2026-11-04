alter table participant_email_allowlist
  add column participant_name text
    check (participant_name is null or char_length(btrim(participant_name)) between 1 and 120);

alter table exam_attempts
  add column participant_list_name text
    check (participant_list_name is null or char_length(btrim(participant_list_name)) between 1 and 120);

update exam_attempts as attempts
set participant_list_name = participants.participant_name
from participant_email_allowlist as participants
where attempts.normalized_email = participants.email;

create or replace function replace_participant_email_allowlist_with_names(
  p_emails text[],
  p_names text[]
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if p_emails is null or cardinality(p_emails) > 199 then
    raise exception 'participant_limit';
  end if;
  if p_names is null or cardinality(p_names) <> cardinality(p_emails) then
    raise exception 'invalid_participant_names';
  end if;
  if exists (
    select 1
    from unnest(p_emails) as item(email)
    where email is null
      or char_length(email) > 254
      or email <> lower(btrim(email))
      or email !~ '^[^[:space:]@]+@tanminhnhan[.]com[.]vn$'
  ) then
    raise exception 'invalid_participant_email';
  end if;
  if exists (
    select 1
    from unnest(p_names) as item(name)
    where name is not null
      and (name <> btrim(name) or char_length(name) not between 1 and 120)
  ) then
    raise exception 'invalid_participant_names';
  end if;
  if cardinality(p_emails) <> (
    select count(distinct email) from unnest(p_emails) as item(email)
  ) then
    raise exception 'duplicate_participant_email';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('participant-email-allowlist', 0));
  delete from participant_email_allowlist where email is not null;
  insert into participant_email_allowlist (email, sequence_number, participant_name)
  select email, ordinality::integer, p_names[ordinality::integer]
  from unnest(p_emails) with ordinality as item(email, ordinality);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function replace_participant_email_allowlist_with_names(text[], text[]) from public, anon, authenticated;
grant execute on function replace_participant_email_allowlist_with_names(text[], text[]) to service_role;

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
  if coalesce(array_length(v_order, 1), 0) = 0 then raise exception 'no_questions'; end if;
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

notify pgrst, 'reload schema';

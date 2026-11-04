create table participant_email_allowlist (
  email text primary key
    check (char_length(email) <= 254 and email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@tanminhnhan[.]com[.]vn$'),
  added_at timestamptz not null default now()
);

alter table participant_email_allowlist enable row level security;
revoke all on participant_email_allowlist from anon, authenticated;

create or replace function replace_participant_email_allowlist(p_emails text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if p_emails is null or cardinality(p_emails) > 199 then
    raise exception 'participant_limit';
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
  if cardinality(p_emails) <> (
    select count(distinct email) from unnest(p_emails) as item(email)
  ) then
    raise exception 'duplicate_participant_email';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('participant-email-allowlist', 0));
  delete from participant_email_allowlist where email is not null;
  insert into participant_email_allowlist (email)
  select email from unnest(p_emails) as item(email);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function replace_participant_email_allowlist(text[]) from public, anon, authenticated;
grant execute on function replace_participant_email_allowlist(text[]) to service_role;

drop function if exists start_attempt(text, text, text, text, text, text, text);

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
begin
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  if exists (select 1 from exam_attempts where normalized_email = v_email) then
    raise exception 'email_used';
  end if;
  if not exists (select 1 from participant_email_allowlist where email = v_email) then
    raise exception 'email_not_allowed';
  end if;

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
    token_hash, deadline_at, question_order
  ) values (
    v_id, p_name, v_email, p_position, p_level, v_project.name, v_project.id,
    p_token_hash, v_deadline, v_order
  );
  return v_deadline;
end $$;

revoke all on function start_attempt(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function start_attempt(text, text, text, text, text, text) to service_role;

create table exam_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index exam_projects_name_unique on exam_projects (lower(btrim(name)));

insert into exam_projects (name)
select distinct on (lower(btrim(main_project))) btrim(main_project)
from exam_attempts
where btrim(main_project) <> ''
order by lower(btrim(main_project)), btrim(main_project);

alter table exam_attempts
  add column project_id uuid references exam_projects(id) on delete restrict;

update exam_attempts a
set project_id = p.id
from exam_projects p
where lower(btrim(a.main_project)) = lower(btrim(p.name));

alter table exam_projects enable row level security;
revoke all on exam_projects from anon, authenticated;

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
declare
  s exam_settings;
  v_code uuid;
  v_order uuid[];
  v_id uuid := gen_random_uuid();
  v_deadline timestamptz;
  v_project exam_projects;
  v_email text := lower(btrim(p_email));
begin
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  if exists (select 1 from exam_attempts where lower(btrim(normalized_email)) = v_email) then
    raise exception 'email_used';
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
  if s.invitation_required then
    update invitation_codes
      set uses = uses + 1,
          status = case when uses + 1 >= max_uses then 'consumed' else 'unused' end,
          consumed_at = case when uses + 1 >= max_uses then now() else null end
      where code_hash = p_code_hash and revoked_at is null and uses < max_uses
      returning id into v_code;
    if v_code is null then raise exception 'bad_code'; end if;
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
  if coalesce(array_length(v_order, 1), 0) = 0 then raise exception 'no_questions'; end if;
  v_deadline := least(now() + make_interval(mins => s.duration_minutes), s.closing_at);
  insert into exam_attempts(
    id, full_name, normalized_email, position, candidate_level, main_project, project_id,
    invitation_code_id, token_hash, deadline_at, question_order
  ) values (
    v_id, p_name, v_email, p_position, p_level, v_project.name, v_project.id,
    v_code, p_token_hash, v_deadline, v_order
  );
  if v_code is not null then update invitation_codes set consumed_by_attempt_id = v_id where id = v_code; end if;
  return v_deadline;
end $$;

grant execute on function start_attempt(text, text, text, text, text, text, text) to service_role;

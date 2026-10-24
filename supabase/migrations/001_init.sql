create extension if not exists pgcrypto;

create table exam_settings (
  id int primary key default 1 check (id = 1),
  title text not null default 'Bài thi trực tuyến',
  logo_url text not null default '/logo.png',
  opening_at timestamptz not null,
  closing_at timestamptz not null,
  duration_minutes int not null default 30 check (duration_minutes > 0),
  question_count int not null default 50 check (question_count > 0),
  passing_percentage int not null default 75 check (passing_percentage between 1 and 100),
  timezone text not null default 'Asia/Ho_Chi_Minh',
  invitation_required boolean not null default true,
  show_score boolean not null default true,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closing_at > opening_at)
);
-- PLACEHOLDER schedule: edit before the exam (see README). Inactive until you activate it.
insert into exam_settings (opening_at, closing_at) values ('2026-11-01 08:00+07', '2026-11-01 09:00+07');

create table exam_questions (
  id uuid primary key default gen_random_uuid(),
  question_text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2), -- [{"id":"a","text":"..."}]
  topic text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table question_keys (  -- never selected by question delivery
  question_id uuid primary key references exam_questions(id) on delete cascade,
  correct_option text not null
);
create table invitation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  status text not null default 'unused' check (status in ('unused','consumed')),
  consumed_by_attempt_id uuid,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
create table exam_attempts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  normalized_email text not null,
  position text not null,
  invitation_code_id uuid unique references invitation_codes(id),
  token_hash text not null unique,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','auto_submitted')),
  submit_reason text,
  question_order uuid[] not null,
  correct_count int check (correct_count >= 0),
  incorrect_count int check (incorrect_count >= 0),
  result text check (result in ('PASS','FAIL')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'in_progress') = (submitted_at is null)),
  check ((status = 'in_progress') = (result is null))
);
create index on exam_attempts (status, deadline_at);
create index on exam_attempts (submitted_at);
create index on exam_attempts (normalized_email);
create table exam_answers (
  attempt_id uuid not null references exam_attempts(id) on delete cascade,
  question_id uuid not null references exam_questions(id),
  selected_option text not null,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);
create table exam_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references exam_attempts(id) on delete cascade,
  event_type text not null,
  server_received_at timestamptz not null default now(),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table rate_limits (
  key text not null, window_start timestamptz not null, count int not null default 0,
  primary key (key, window_start)
);

-- RLS: enabled with NO policies = anon/authenticated get nothing. Only the server (service role) reads/writes.
alter table exam_settings enable row level security;
alter table exam_questions enable row level security;
alter table question_keys enable row level security;
alter table invitation_codes enable row level security;
alter table exam_attempts enable row level security;
alter table exam_answers enable row level security;
alter table exam_events enable row level security;
alter table rate_limits enable row level security;
revoke all on all tables in schema public from anon, authenticated;

create or replace function hit_rate_limit(p_key text, p_limit int, p_window int) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window) * p_window); c int;
begin
  insert into rate_limits(key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count into c;
  return c <= p_limit;
end $$;

create or replace function start_attempt(p_name text, p_email text, p_position text, p_token_hash text, p_code_hash text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare s exam_settings; v_code uuid; v_order uuid[]; v_id uuid := gen_random_uuid(); v_deadline timestamptz;
begin
  select * into s from exam_settings where id = 1;
  if not s.active then raise exception 'closed'; end if;
  if now() < s.opening_at then raise exception 'not_open'; end if;
  if now() >= s.closing_at then raise exception 'closed'; end if;
  if s.invitation_required then
    update invitation_codes set status = 'consumed', consumed_at = now()
      where code_hash = p_code_hash and status = 'unused' returning id into v_code;
    if v_code is null then raise exception 'bad_code'; end if;
  end if;
  select array_agg(id order by r) into v_order
    from (select id, random() r from exam_questions where active order by r limit s.question_count) q;
  if coalesce(array_length(v_order, 1), 0) <> s.question_count then raise exception 'not_ready'; end if;
  v_deadline := least(now() + make_interval(mins => s.duration_minutes), s.closing_at);
  insert into exam_attempts(id, full_name, normalized_email, position, invitation_code_id, token_hash, deadline_at, question_order)
    values (v_id, p_name, p_email, p_position, v_code, p_token_hash, v_deadline, v_order);
  if v_code is not null then update invitation_codes set consumed_by_attempt_id = v_id where id = v_code; end if;
  return v_deadline;
end $$;

create or replace function finalize_attempt(p_attempt uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a exam_attempts; s exam_settings; c int; n int; need int; r text; st text;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then return null; end if;
  if a.status = 'in_progress' then
    select * into s from exam_settings where id = 1;
    n := array_length(a.question_order, 1);
    select count(*) into c from exam_answers ea
      join question_keys k on k.question_id = ea.question_id and k.correct_option = ea.selected_option
      where ea.attempt_id = a.id and ea.question_id = any(a.question_order);
    need := ceil(n * s.passing_percentage / 100.0);
    r := case when c >= need then 'PASS' else 'FAIL' end;
    st := case when p_reason = 'manual' and now() < a.deadline_at then 'submitted' else 'auto_submitted' end;
    update exam_attempts set status = st, submit_reason = p_reason, submitted_at = now(),
      correct_count = c, incorrect_count = n - c, result = r, updated_at = now() where id = a.id;
    insert into exam_events(attempt_id, event_type, metadata) values (a.id, 'finalize', jsonb_build_object('reason', p_reason));
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function save_answer(p_attempt uuid, p_question uuid, p_option text) returns text
language plpgsql security definer set search_path = public as $$
declare a exam_attempts; ok boolean;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then return 'not_found'; end if;
  if a.status <> 'in_progress' then return 'closed'; end if;
  if now() >= a.deadline_at then perform finalize_attempt(p_attempt, 'deadline'); return 'expired'; end if;
  if not (p_question = any(a.question_order)) then return 'invalid'; end if;
  select exists(select 1 from exam_questions q, jsonb_array_elements(q.options) o
    where q.id = p_question and o->>'id' = p_option) into ok;
  if not ok then return 'invalid'; end if;
  insert into exam_answers(attempt_id, question_id, selected_option) values (p_attempt, p_question, p_option)
    on conflict (attempt_id, question_id) do update set selected_option = excluded.selected_option, updated_at = now();
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
    return jsonb_build_object('status', a.status, 'serverNow', now(),
      'result', case when s.show_score then jsonb_build_object('correct', a.correct_count, 'incorrect', a.incorrect_count, 'result', a.result) else null end);
  end if;
  return jsonb_build_object('status', a.status, 'serverNow', now(), 'deadlineAt', a.deadline_at,
    'candidate', jsonb_build_object('fullName', a.full_name, 'position', a.position),
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'text', q.question_text, 'options', q.options) order by u.ord)
                  from unnest(a.question_order) with ordinality u(id, ord) join exam_questions q on q.id = u.id),
    'answers', coalesce((select jsonb_object_agg(question_id, selected_option) from exam_answers where attempt_id = a.id), '{}'::jsonb));
end $$;

create or replace function reconcile_expired() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from exam_attempts where status = 'in_progress' and deadline_at <= now() loop
    perform finalize_attempt(r.id, 'deadline'); n := n + 1;
  end loop;
  return n;
end $$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Mã mời dùng chung: một mã có giới hạn số lượt dùng (max_uses) thay vì nhiều mã dùng một lần.
alter table invitation_codes
  add column max_uses int not null default 1 check (max_uses > 0),
  add column uses int not null default 0 check (uses >= 0),
  add column revoked_at timestamptz;

-- Giữ nguyên trạng thái các mã cũ: mã đã dùng = 1/1, mã chưa dùng = 0/1.
update invitation_codes set uses = case when status = 'consumed' then 1 else 0 end;

-- Một mã dùng chung có nhiều thí sinh, nên không còn ràng buộc mỗi mã chỉ gắn với một lượt thi.
alter table exam_attempts drop constraint if exists exam_attempts_invitation_code_id_key;

create or replace function start_attempt(p_name text, p_email text, p_position text, p_token_hash text, p_code_hash text)
returns timestamptz language plpgsql security definer set search_path = public as $$
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
  insert into exam_attempts(id, full_name, normalized_email, position, invitation_code_id, token_hash, deadline_at, question_order)
    values (v_id, p_name, p_email, p_position, v_code, p_token_hash, v_deadline, v_order);
  return v_deadline;
end $$;

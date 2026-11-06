create or replace function finalize_and_get_attempt_state(p_attempt uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform finalize_attempt(p_attempt, p_reason);
  return attempt_state(p_attempt);
end $$;

revoke all on function finalize_and_get_attempt_state(uuid, text) from public, anon, authenticated;
grant execute on function finalize_and_get_attempt_state(uuid, text) to service_role;

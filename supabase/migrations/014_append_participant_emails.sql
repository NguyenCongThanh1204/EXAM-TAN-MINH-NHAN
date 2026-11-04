create or replace function append_participant_email_allowlist(p_emails text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_current_count integer;
  v_added_count integer;
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
  select count(*) into v_current_count from participant_email_allowlist;
  select count(*) into v_added_count
  from unnest(p_emails) as item(email)
  where not exists (
    select 1 from participant_email_allowlist as current_email where current_email.email = item.email
  );
  if v_current_count + v_added_count > 199 then
    raise exception 'participant_limit';
  end if;

  insert into participant_email_allowlist (email)
  select email from unnest(p_emails) as item(email)
  on conflict (email) do nothing;
  return v_added_count;
end $$;

revoke all on function append_participant_email_allowlist(text[]) from public, anon, authenticated;
grant execute on function append_participant_email_allowlist(text[]) to service_role;

notify pgrst, 'reload schema';

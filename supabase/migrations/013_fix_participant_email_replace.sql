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

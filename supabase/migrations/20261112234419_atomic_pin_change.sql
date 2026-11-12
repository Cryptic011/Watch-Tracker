create or replace function public.watchlog_change_pin(p_account uuid,p_token_hash text,p_pin_hash text,p_pin_salt text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.watchlog_pin_accounts where id=p_account for update;
  if not found then return false; end if;
  perform 1 from public.watchlog_pin_sessions
    where account_id=p_account and token_hash=p_token_hash and expires_at>clock_timestamp()
    for update;
  if not found then return false; end if;
  if p_pin_hash is null or p_pin_hash='' or p_pin_salt is null or p_pin_salt='' then
    raise exception 'Invalid PIN credential';
  end if;
  update public.watchlog_pin_accounts
    set pin_hash=p_pin_hash,pin_salt=p_pin_salt,failed_attempts=0,locked_until=null,updated_at=clock_timestamp()
    where id=p_account;
  delete from public.watchlog_pin_sessions where account_id=p_account and token_hash<>p_token_hash;
  return true;
end $$;
revoke all on function public.watchlog_change_pin(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.watchlog_change_pin(uuid,text,text,text) to service_role;

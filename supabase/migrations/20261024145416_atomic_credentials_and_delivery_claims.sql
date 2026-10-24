-- Use the same account lock as recovery for credential writes and session
-- issuance. PBKDF2 stays in the Edge Function; the verified credential is
-- rechecked in the transaction that creates the session.
create function public.watchlog_create_pin_session(
  p_account uuid, p_pin_hash text, p_pin_salt text,
  p_token_hash text, p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.watchlog_pin_accounts%rowtype; stamp timestamptz=clock_timestamp();
begin
  select * into a from public.watchlog_pin_accounts where id=p_account for update;
  if not found or a.pin_hash is distinct from p_pin_hash or a.pin_salt is distinct from p_pin_salt then
    return jsonb_build_object('ok',false,'code','invalid_login');
  end if;
  stamp=clock_timestamp();
  if a.locked_until>stamp then
    return jsonb_build_object('ok',false,'code','locked','retryAfter',greatest(1,ceil(extract(epoch from a.locked_until-stamp))::integer));
  end if;
  if p_token_hash is null or p_token_hash='' or p_expires_at is null or p_expires_at<=stamp then
    raise exception 'Invalid session';
  end if;
  update public.watchlog_pin_accounts set failed_attempts=0,locked_until=null,updated_at=stamp where id=a.id;
  insert into public.watchlog_pin_sessions(token_hash,account_id,expires_at) values(p_token_hash,a.id,p_expires_at);
  return jsonb_build_object('ok',true);
end; $$;

create function public.watchlog_change_pin(
  p_account uuid, p_session_token_hash text, p_pin_hash text, p_pin_salt text
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.watchlog_pin_accounts where id=p_account for update;
  if not found then return false; end if;
  -- Recovery also locks this account before revoking sessions. Recheck the
  -- caller only after acquiring that lock, including while PBKDF2 was running.
  perform 1 from public.watchlog_pin_sessions
    where account_id=p_account and token_hash=p_session_token_hash and expires_at>clock_timestamp()
    for update;
  if not found then return false; end if;
  if p_pin_hash is null or p_pin_hash='' or p_pin_salt is null or p_pin_salt='' then
    raise exception 'Invalid credential';
  end if;
  update public.watchlog_pin_accounts set pin_hash=p_pin_hash,pin_salt=p_pin_salt,
    failed_attempts=0,locked_until=null,updated_at=clock_timestamp() where id=p_account;
  delete from public.watchlog_pin_sessions where account_id=p_account and token_hash<>p_session_token_hash;
  return true;
end; $$;

alter table public.watchlog_push_deliveries add column lease_token uuid;
alter table public.watchlog_push_deliveries add column lease_expires_at timestamptz;

create function public.watchlog_claim_push_delivery(
  p_subscription uuid,p_account uuid,p_item text,p_event_key text,
  p_scheduled_for timestamptz,p_legacy_keys text[] default '{}'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.watchlog_push_deliveries%rowtype; stamp timestamptz; claim uuid=gen_random_uuid();
begin
  -- A subscription lock serializes new claims as well as existing-row claims,
  -- including checks for the same event's pre-migration delivery keys.
  perform 1 from public.watchlog_push_subscriptions where id=p_subscription and account_id=p_account and enabled for update;
  if not found then return null; end if;
  if exists(select 1 from public.watchlog_push_deliveries where subscription_id=p_subscription and event_key=any(p_legacy_keys) and status='sent') then return null; end if;
  select * into d from public.watchlog_push_deliveries where subscription_id=p_subscription and event_key=p_event_key for update;
  stamp=clock_timestamp();
  if found then
    if d.status in ('sent','expired') or d.attempts>=5 or d.next_attempt_at>stamp then return null; end if;
    -- Existing pre-lease pending rows also get a grace period on rollout.
    if d.status='pending' and coalesce(d.lease_expires_at,d.updated_at+interval '2 minutes')>stamp then return null; end if;
    update public.watchlog_push_deliveries set status='pending',attempts=attempts+1,
      next_attempt_at=null,lease_token=claim,lease_expires_at=stamp+interval '2 minutes',updated_at=stamp
      where id=d.id returning * into d;
  else
    insert into public.watchlog_push_deliveries(subscription_id,account_id,item_id,event_key,scheduled_for,status,attempts,lease_token,lease_expires_at,updated_at)
      values(p_subscription,p_account,p_item,p_event_key,p_scheduled_for,'pending',1,claim,stamp+interval '2 minutes',stamp)
      on conflict(subscription_id,event_key) do nothing returning * into d;
    if not found then return null; end if;
  end if;
  return jsonb_build_object('id',d.id,'attempts',d.attempts,'lease_token',claim);
end; $$;

create function public.watchlog_finish_push_delivery(
  p_delivery uuid,p_lease uuid,p_status text,p_error text,
  p_next_attempt timestamptz,p_disable_subscription boolean default false
) returns boolean language plpgsql security invoker set search_path='' as $$
declare subscription uuid; stamp timestamptz;
begin
  if p_status not in ('sent','retry','expired') then raise exception 'Invalid delivery state'; end if;
  select subscription_id into subscription from public.watchlog_push_deliveries where id=p_delivery;
  if not found then return false; end if;
  -- Match the claim lock order, including expiration disabling the device.
  perform 1 from public.watchlog_push_subscriptions where id=subscription for update;
  if not found then return false; end if;
  stamp=clock_timestamp();
  update public.watchlog_push_deliveries set status=p_status,
    sent_at=case when p_status='sent' then stamp else sent_at end,
    last_error=case when p_status='sent' then null else left(p_error,500) end,
    next_attempt_at=case when p_status='retry' then p_next_attempt else null end,
    lease_token=null,lease_expires_at=null,updated_at=stamp
    where id=p_delivery and status='pending' and lease_token=p_lease and lease_expires_at>stamp
    returning subscription_id into subscription;
  if not found then return false; end if;
  if p_disable_subscription then
    update public.watchlog_push_subscriptions set enabled=false,updated_at=stamp where id=subscription;
  end if;
  return true;
end; $$;

revoke all on function public.watchlog_create_pin_session(uuid,text,text,text,timestamptz),public.watchlog_change_pin(uuid,text,text,text),public.watchlog_claim_push_delivery(uuid,uuid,text,text,timestamptz,text[]),public.watchlog_finish_push_delivery(uuid,uuid,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.watchlog_create_pin_session(uuid,text,text,text,timestamptz),public.watchlog_change_pin(uuid,text,text,text),public.watchlog_claim_push_delivery(uuid,uuid,text,text,timestamptz,text[]),public.watchlog_finish_push_delivery(uuid,uuid,text,text,timestamptz,boolean) to service_role;

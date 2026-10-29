-- Explicit user removals use a separate, revision-checked writer. Ordinary
-- replacement/cleanup retains the library-loss guard and all history triggers.
create function public.watchlog_patch_confirmed_once(p_account uuid,p_revision bigint,p_changes jsonb,p_request_hash text,p_confirmed_deletes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare accepted bigint; result jsonb; previous_context text;
begin
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid request hash'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_typeof(p_confirmed_deletes) is distinct from 'array'
    or jsonb_array_length(p_confirmed_deletes) not between 1 and 10000
    or exists(select 1 from jsonb_array_elements(p_confirmed_deletes) e where jsonb_typeof(e)<>'string' or length(e#>>'{}') not between 1 and 200)
    or exists(select 1 from jsonb_array_elements(p_changes) c where c->>'delete'='true' and not p_confirmed_deletes @> jsonb_build_array(c->>'id')) then
    raise exception 'Confirm every removed title';
  end if;
  perform 1 from public.watchlog_pin_library where account_id=p_account for update;
  if not found then raise exception 'Library unavailable'; end if;
  select revision into accepted from public.watchlog_sync_receipts where account_id=p_account and request_hash=p_request_hash;
  if found then return jsonb_build_object('ok',true,'revision',accepted,'replayed',true); end if;
  previous_context=current_setting('watchlog.confirmed_deletes',true);
  perform set_config('watchlog.confirmed_deletes',jsonb_build_object('account',p_account,'ids',p_confirmed_deletes)::text,true);
  result=public.watchlog_patch_library_unchecked(p_account,p_revision,p_changes);
  perform set_config('watchlog.confirmed_deletes',coalesce(previous_context,''),true);
  if (result->>'ok')::boolean then
    insert into public.watchlog_sync_receipts(account_id,request_hash,revision) values(p_account,p_request_hash,(result->>'revision')::bigint);
  end if;
  return result;
end; $$;

create or replace function public.watchlog_block_bulk_title_loss() returns trigger
language plpgsql security invoker set search_path='' as $$
declare removed record; remaining bigint; confirmation jsonb;
begin
  confirmation=nullif(current_setting('watchlog.confirmed_deletes',true),'')::jsonb;
  for removed in select account_id,count(*) amount from deleted_titles group by account_id loop
    if confirmation->>'account'=removed.account_id::text and not exists(
      select 1 from deleted_titles d where d.account_id=removed.account_id and not confirmation->'ids' @> jsonb_build_array(d.item_id)
    ) then continue; end if;
    select count(*) into remaining from public.watchlog_pin_titles where account_id=removed.account_id;
    if (removed.amount>=5 and removed.amount>=remaining) or (removed.amount>1 and remaining=0) then
      raise exception 'Unexpected library removal blocked' using errcode='23514';
    end if;
  end loop;
  return null;
end; $$;
revoke all on function public.watchlog_patch_confirmed_once(uuid,bigint,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.watchlog_patch_confirmed_once(uuid,bigint,jsonb,text,jsonb) to service_role;

-- Claims and completion are database transactions, not read-then-write HTTP
-- sequences. A slow/overlapping scan cannot send an actively leased event.
alter table public.watchlog_push_deliveries add column lease_token uuid, add column lease_until timestamptz;
-- Let sends from the previous worker finish during the rolling deployment.
update public.watchlog_push_deliveries set lease_until=clock_timestamp()+interval '2 minutes' where status='pending';
create function public.watchlog_claim_delivery(p_subscription uuid,p_account uuid,p_item text,p_event text,p_scheduled timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare delivery public.watchlog_push_deliveries%rowtype; token uuid=gen_random_uuid(); stamp timestamptz=clock_timestamp();
begin
  if not exists(select 1 from public.watchlog_push_subscriptions where id=p_subscription and account_id=p_account and enabled) then return null; end if;
  insert into public.watchlog_push_deliveries(subscription_id,account_id,item_id,event_key,scheduled_for,status,attempts,lease_token,lease_until)
    values(p_subscription,p_account,p_item,p_event,p_scheduled,'pending',1,token,stamp+interval '2 minutes')
    on conflict(subscription_id,event_key) do nothing returning * into delivery;
  if found then return jsonb_build_object('id',delivery.id,'attempts',delivery.attempts,'leaseToken',token); end if;
  select * into delivery from public.watchlog_push_deliveries where subscription_id=p_subscription and event_key=p_event for update;
  if not found or delivery.account_id<>p_account or delivery.status in ('sent','expired') or delivery.attempts>=5
    or delivery.lease_until>stamp or delivery.next_attempt_at>stamp then return null; end if;
  update public.watchlog_push_deliveries set status='pending',attempts=attempts+1,next_attempt_at=null,lease_token=token,lease_until=stamp+interval '2 minutes',updated_at=stamp
    where id=delivery.id returning * into delivery;
  return jsonb_build_object('id',delivery.id,'attempts',delivery.attempts,'leaseToken',token);
end; $$;
create function public.watchlog_finish_delivery(p_delivery uuid,p_token uuid,p_status text,p_error text default null,p_retry timestamptz default null,p_disable boolean default false)
returns boolean language plpgsql security invoker set search_path='' as $$
declare subscription uuid;
begin
  if p_token is null or p_status not in ('sent','retry','expired') then raise exception 'Invalid delivery completion'; end if;
  update public.watchlog_push_deliveries set status=p_status,sent_at=case when p_status='sent' then clock_timestamp() else sent_at end,
    next_attempt_at=p_retry,last_error=p_error,updated_at=clock_timestamp(),lease_token=null,lease_until=null
    where id=p_delivery and lease_token=p_token and status='pending' returning subscription_id into subscription;
  if not found then return false; end if;
  if p_disable then update public.watchlog_push_subscriptions set enabled=false,updated_at=clock_timestamp() where id=subscription; end if;
  return true;
end; $$;
revoke all on function public.watchlog_claim_delivery(uuid,uuid,text,text,timestamptz),public.watchlog_finish_delivery(uuid,uuid,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.watchlog_claim_delivery(uuid,uuid,text,text,timestamptz),public.watchlog_finish_delivery(uuid,uuid,text,text,timestamptz,boolean) to service_role;

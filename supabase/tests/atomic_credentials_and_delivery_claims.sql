begin;
do $$
declare a uuid=gen_random_uuid(); sub uuid=gen_random_uuid(); result jsonb; delivery jsonb; reclaimed jsonb; old_lease uuid;
begin
  insert into public.watchlog_pin_accounts(id,email,pin_hash,pin_salt) values(a,a::text||'@test.invalid','original','salt');
  result=public.watchlog_create_pin_session(a,'original','salt','original-session-'||a,clock_timestamp()+interval '1 day');
  if result->>'ok'<>'true' then raise exception 'Valid credential could not create a session'; end if;
  result=public.watchlog_create_pin_session(a,'wrong','salt','wrong-session-'||a,clock_timestamp()+interval '1 day');
  if result->>'ok'<>'false' or exists(select 1 from public.watchlog_pin_sessions where token_hash='wrong-session-'||a) then raise exception 'Stale credential created a session'; end if;
  perform public.watchlog_create_pin_session(a,'original','salt','other-session-'||a,clock_timestamp()+interval '1 day');
  if not public.watchlog_change_pin(a,'original-session-'||a,'changed','changed-salt') then raise exception 'Valid session could not change PIN'; end if;
  if exists(select 1 from public.watchlog_pin_sessions where token_hash='other-session-'||a) then raise exception 'PIN change retained another session'; end if;
  if not exists(select 1 from public.watchlog_pin_sessions where token_hash='original-session-'||a) then raise exception 'PIN change revoked its own session'; end if;

  -- These stale inputs represent requests whose credential work started
  -- before recovery. The account lock and final recheck must reject both.
  perform public.watchlog_set_recovery(a,'changed',repeat('a',64));
  result=public.watchlog_recover_account(a::text||'@test.invalid',repeat('a',64),'recovered','recovered-salt',repeat('b',64));
  if result->>'ok'<>'true' then raise exception 'Recovery failed'; end if;
  result=public.watchlog_create_pin_session(a,'changed','changed-salt','late-session-'||a,clock_timestamp()+interval '1 day');
  if result->>'ok'<>'false' then raise exception 'Pre-recovery login survived recovery'; end if;
  if public.watchlog_change_pin(a,'original-session-'||a,'late-pin','late-salt') then raise exception 'Revoked request replaced recovered PIN'; end if;
  if (select pin_hash from public.watchlog_pin_accounts where id=a)<>'recovered' or exists(select 1 from public.watchlog_pin_sessions where account_id=a) then raise exception 'Recovery result was not preserved'; end if;
  result=public.watchlog_create_pin_session(a,'recovered','recovered-salt','recovered-session-'||a,clock_timestamp()+interval '1 day');
  if result->>'ok'<>'true' then raise exception 'Recovered credential failed'; end if;
  update public.watchlog_pin_accounts set locked_until=clock_timestamp()+interval '10 minutes',failed_attempts=3 where id=a;
  result=public.watchlog_create_pin_session(a,'recovered','recovered-salt','locked-session-'||a,clock_timestamp()+interval '1 day');
  if result->>'code'<>'locked' or (result->>'retryAfter')::integer<=0 then raise exception 'Locked login created a session'; end if;
  if (select failed_attempts from public.watchlog_pin_accounts where id=a)<>3 then raise exception 'Locked login reset failures'; end if;

  insert into public.watchlog_push_subscriptions(id,account_id,endpoint,p256dh,auth) values(sub,a,'https://push.test/'||sub,'key','auth');
  delivery=public.watchlog_claim_push_delivery(sub,a,'show','episode-1',clock_timestamp());
  if delivery is null or delivery->>'attempts'<>'1' then raise exception 'First claim failed'; end if;
  if public.watchlog_claim_push_delivery(sub,a,'show','episode-1',clock_timestamp()) is not null then raise exception 'Active delivery claimed twice'; end if;
  if public.watchlog_finish_push_delivery((delivery->>'id')::uuid,gen_random_uuid(),'sent',null,null) then raise exception 'Wrong worker completed delivery'; end if;
  old_lease=(delivery->>'lease_token')::uuid;
  update public.watchlog_push_deliveries set lease_expires_at=clock_timestamp()-interval '1 second' where id=(delivery->>'id')::uuid;
  reclaimed=public.watchlog_claim_push_delivery(sub,a,'show','episode-1',clock_timestamp());
  if reclaimed->>'attempts'<>'2' or reclaimed->>'lease_token'=delivery->>'lease_token' then raise exception 'Stale delivery was not reclaimed with new ownership'; end if;
  if public.watchlog_finish_push_delivery((delivery->>'id')::uuid,old_lease,'sent',null,null) then raise exception 'Old worker completed reclaimed delivery'; end if;
  if not public.watchlog_finish_push_delivery((reclaimed->>'id')::uuid,(reclaimed->>'lease_token')::uuid,'retry','temporary error',clock_timestamp()+interval '5 minutes') then raise exception 'Owner could not schedule retry'; end if;
  if public.watchlog_claim_push_delivery(sub,a,'show','episode-1',clock_timestamp()) is not null then raise exception 'Future retry claimed too early'; end if;
  update public.watchlog_push_deliveries set next_attempt_at=clock_timestamp()-interval '1 second' where id=(delivery->>'id')::uuid;
  delivery=public.watchlog_claim_push_delivery(sub,a,'show','episode-1',clock_timestamp());
  if delivery->>'attempts'<>'3' then raise exception 'Due retry failed'; end if;
  if not public.watchlog_finish_push_delivery((delivery->>'id')::uuid,(delivery->>'lease_token')::uuid,'sent',null,null) then raise exception 'Owner could not complete delivery'; end if;
  if public.watchlog_claim_push_delivery(sub,a,'show','episode-1',clock_timestamp()) is not null then raise exception 'Sent delivery repeated'; end if;
  if public.watchlog_claim_push_delivery(sub,a,'show','new-key',clock_timestamp(),array['episode-1']) is not null then raise exception 'Legacy sent event repeated'; end if;

  insert into public.watchlog_push_deliveries(subscription_id,account_id,item_id,event_key,scheduled_for,status,attempts) values(sub,a,'show','pre-lease',clock_timestamp(),'pending',1);
  if public.watchlog_claim_push_delivery(sub,a,'show','pre-lease',clock_timestamp()) is not null then raise exception 'Fresh pre-lease delivery reclaimed'; end if;
  update public.watchlog_push_deliveries set updated_at=clock_timestamp()-interval '3 minutes' where subscription_id=sub and event_key='pre-lease';
  delivery=public.watchlog_claim_push_delivery(sub,a,'show','pre-lease',clock_timestamp());
  if delivery is null or delivery->>'attempts'<>'2' then raise exception 'Stale pre-lease delivery not reclaimed'; end if;
  if not public.watchlog_finish_push_delivery((delivery->>'id')::uuid,(delivery->>'lease_token')::uuid,'expired','Push subscription expired (410)',null,true) then raise exception 'Expiration completion failed'; end if;
  if (select enabled from public.watchlog_push_subscriptions where id=sub) then raise exception 'Expired subscription still enabled'; end if;
  if public.watchlog_claim_push_delivery(sub,a,'show','disabled',clock_timestamp()) is not null then raise exception 'Disabled device claimed delivery'; end if;

  if has_function_privilege('anon','public.watchlog_create_pin_session(uuid,text,text,text,timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','public.watchlog_change_pin(uuid,text,text,text)','EXECUTE')
    or has_function_privilege('anon','public.watchlog_claim_push_delivery(uuid,uuid,text,text,timestamptz,text[])','EXECUTE')
    or has_function_privilege('authenticated','public.watchlog_finish_push_delivery(uuid,uuid,text,text,timestamptz,boolean)','EXECUTE') then raise exception 'Private transactional RPC exposed'; end if;
end; $$;
rollback;

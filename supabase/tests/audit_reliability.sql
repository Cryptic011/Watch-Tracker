begin;
do $$
declare a uuid=gen_random_uuid(); subscription uuid=gen_random_uuid(); result jsonb; first_claim jsonb; second_claim jsonb; changes jsonb; ids jsonb; count_rows bigint;
begin
  insert into public.watchlog_pin_accounts(id,email,pin_hash,pin_salt) values(a,a::text||'@audit-test.invalid','test','salt');
  insert into public.watchlog_pin_library(account_id,items,revision)
    select a,jsonb_agg(jsonb_build_object('id','title-'||n,'title','Audit title '||n)),0 from generate_series(1,10) n;
  select jsonb_agg(jsonb_build_object('id','title-'||n,'delete',true)),jsonb_agg('title-'||n) into changes,ids from generate_series(1,5) n;
  result=public.watchlog_patch_library(a,0,changes);
  if result->>'code'<>'library_safety_block' then raise exception 'Unconfirmed bulk deletion was not blocked'; end if;
  result=public.watchlog_patch_confirmed_once(a,0,changes,repeat('a',64),ids);
  if result->>'revision'<>'1' or not (result->>'ok')::boolean then raise exception 'Confirmed deletion failed'; end if;
  select count(*) into count_rows from public.watchlog_pin_titles where account_id=a;
  if count_rows<>5 then raise exception 'Confirmed deletion removed wrong titles'; end if;
  if (select count(*) from public.watchlog_title_history where account_id=a and operation='delete')<>5 then raise exception 'Deletion lost recovery history'; end if;
  perform public.watchlog_patch_library(a,1,'[{"id":"title-6","set":{"notes":"Other device edit"}}]');
  result=public.watchlog_patch_confirmed_once(a,0,changes,repeat('a',64),ids);
  if result->>'revision'<>'1' or result->>'replayed'<>'true' then raise exception 'Deletion receipt not replayed'; end if;
  if (select revision from public.watchlog_pin_library where account_id=a)<>2 then raise exception 'Replay advanced the library'; end if;
  select jsonb_agg(jsonb_build_object('id','title-'||n,'delete',true)),jsonb_agg('title-'||n) into changes,ids from generate_series(6,10) n;
  result=public.watchlog_patch_confirmed_once(a,0,changes,repeat('b',64),ids);
  if result->>'code'<>'revision_conflict' then raise exception 'Stale confirmed deletion was allowed'; end if;
  begin
    perform public.watchlog_patch_confirmed_once(a,2,changes,repeat('c',64),'["title-6"]');
    raise exception 'Partial confirmation was allowed';
  exception when raise_exception then
    if sqlerrm<>'Confirm every removed title' then raise; end if;
  end;
  begin
    delete from public.watchlog_pin_titles where account_id=a;
    raise exception 'Direct bulk delete was allowed';
  exception when check_violation then null; end;
  result=public.watchlog_patch_confirmed_once(a,2,changes,repeat('d',64),ids);
  if result->>'revision'<>'3' or exists(select 1 from public.watchlog_pin_titles where account_id=a) then raise exception 'Confirmed remove-all failed'; end if;
  insert into public.watchlog_push_subscriptions(id,account_id,endpoint,p256dh,auth) values(subscription,a,'https://example.invalid/'||subscription,'test','test');
  first_claim=public.watchlog_claim_delivery(subscription,a,'show','episode-event',clock_timestamp());
  if first_claim is null then raise exception 'Initial claim failed'; end if;
  if public.watchlog_claim_delivery(subscription,a,'show','episode-event',clock_timestamp()) is not null then raise exception 'Active lease claimed twice'; end if;
  update public.watchlog_push_deliveries set lease_until=clock_timestamp()-interval '1 second' where id=(first_claim->>'id')::uuid;
  second_claim=public.watchlog_claim_delivery(subscription,a,'show','episode-event',clock_timestamp());
  if second_claim->>'attempts'<>'2' or second_claim->>'leaseToken'=first_claim->>'leaseToken' then raise exception 'Expired lease not rotated'; end if;
  if public.watchlog_finish_delivery((first_claim->>'id')::uuid,(first_claim->>'leaseToken')::uuid,'sent') then raise exception 'Stale sender completed another lease'; end if;
  if not public.watchlog_finish_delivery((second_claim->>'id')::uuid,(second_claim->>'leaseToken')::uuid,'expired','Gone',null,true) then raise exception 'Current lease could not finish'; end if;
  if (select enabled from public.watchlog_push_subscriptions where id=subscription) then raise exception 'Expired endpoint stayed enabled'; end if;
  if public.watchlog_claim_delivery(subscription,a,'show','episode-event',clock_timestamp()) is not null then raise exception 'Completed/disabled event claimed again'; end if;
  if has_function_privilege('anon','public.watchlog_patch_confirmed_once(uuid,bigint,jsonb,text,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.watchlog_claim_delivery(uuid,uuid,text,text,timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','public.watchlog_finish_delivery(uuid,uuid,text,text,timestamptz,boolean)','EXECUTE') then raise exception 'Private RPC exposed'; end if;
end; $$;
rollback;

begin;
do $$
declare a uuid=gen_random_uuid(); result jsonb; library jsonb;
begin
  insert into public.watchlog_pin_accounts(id,email,pin_hash,pin_salt) values(a,a::text||'@test.invalid','old','salt');
  insert into public.watchlog_pin_library(account_id,items,revision) values(a,'[{"id":"one","title":"One","watchedEpisodes":{"1":[1]},"notes":"original"},{"id":"two","title":"Two"}]',0);
  result=public.watchlog_patch_library(a,0,'[{"id":"one","set":{"notes":"updated"},"watched":{"1":{"add":[3],"remove":[1]}}}]');
  if not (result->>'ok')::boolean or result->>'revision'<>'1' then raise exception 'Patch did not commit'; end if;
  select items into library from public.watchlog_read_libraries(array[a]);
  if library->0->'watchedEpisodes'->'1'<>'[3]'::jsonb or library->0->>'notes'<>'updated' or jsonb_array_length(library)<>2 then raise exception 'Patch lost data'; end if;
  result=public.watchlog_patch_library(a,0,'[{"id":"two","delete":true}]');
  if result->>'code'<>'revision_conflict' then raise exception 'Stale changes were accepted'; end if;
  result=public.watchlog_patch_library(a,1,'[{"id":"two","delete":true},{"id":"three","create":{"id":"three","title":"Three"}}]');
  select items into library from public.watchlog_read_libraries(array[a]);
  if jsonb_array_length(library)<>2 or library->1->>'id'<>'three' then raise exception 'Create/delete failed'; end if;
  perform public.watchlog_set_recovery(a,'old',repeat('a',64));
  insert into public.watchlog_pin_sessions(token_hash,account_id,expires_at) values('test-'||a,a,now()+interval '1 day');
  result=public.watchlog_recover_account(a::text||'@test.invalid',repeat('b',64),'new','salt2',repeat('c',64));
  if (result->>'ok')::boolean then raise exception 'Invalid recovery accepted'; end if;
  result=public.watchlog_recover_account(a::text||'@test.invalid',repeat('a',64),'new','salt2',repeat('c',64));
  if not (result->>'ok')::boolean then raise exception 'Correct recovery rejected'; end if;
  if exists(select 1 from public.watchlog_pin_sessions where account_id=a) then raise exception 'Recovery left an old session active'; end if;
  result=public.watchlog_recover_account(a::text||'@test.invalid',repeat('a',64),'bad','salt2',repeat('d',64));
  if (result->>'ok')::boolean then raise exception 'Recovery code could be reused'; end if;
  if has_function_privilege('anon','public.watchlog_patch_library(uuid,bigint,jsonb)','EXECUTE') or has_table_privilege('anon','public.watchlog_pin_recovery','SELECT') then raise exception 'Private data exposed'; end if;
end; $$;
rollback;

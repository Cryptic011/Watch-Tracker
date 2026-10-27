-- Keep recoverable title versions outside the browser's sync lifecycle.
create table public.watchlog_title_history (
  version_id bigint generated always as identity primary key,
  account_id uuid not null,
  item_id text not null,
  payload jsonb not null,
  operation text not null check(operation in ('baseline','update','delete')),
  recorded_at timestamptz not null default clock_timestamp()
);
create index watchlog_title_history_lookup on public.watchlog_title_history(account_id,item_id,version_id desc);
alter table public.watchlog_title_history enable row level security;
revoke all on public.watchlog_title_history from public,anon,authenticated;
grant all on public.watchlog_title_history to service_role;
grant usage,select on sequence public.watchlog_title_history_version_id_seq to service_role;
insert into public.watchlog_title_history(account_id,item_id,payload,operation)
  select account_id,item_id,payload,'baseline' from public.watchlog_pin_titles;

create function public.watchlog_preserve_title_version() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' or old.payload is distinct from new.payload then
    insert into public.watchlog_title_history(account_id,item_id,payload,operation)
      values(old.account_id,old.item_id,old.payload,lower(tg_op));
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger watchlog_preserve_title_version before update or delete
on public.watchlog_pin_titles for each row execute function public.watchlog_preserve_title_version();

-- Reject accidental replacement/cleanup that removes most or all titles.
-- This wrapper also protects older clients and the reminder worker.
alter function public.watchlog_patch_library(uuid,bigint,jsonb) rename to watchlog_patch_library_unchecked;
create function public.watchlog_patch_library(p_account uuid,p_revision bigint,p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_revision bigint; existing_count bigint; delete_count bigint; latest jsonb;
begin
  select revision into current_revision from public.watchlog_pin_library where account_id=p_account for update;
  if current_revision=p_revision and jsonb_typeof(p_changes)='array' then
    select count(*) into existing_count from public.watchlog_pin_titles where account_id=p_account;
    select count(distinct t.item_id) into delete_count from public.watchlog_pin_titles t
      join jsonb_array_elements(p_changes) c on c->>'id'=t.item_id
      where t.account_id=p_account and c->>'delete'='true';
    if (delete_count>=5 and delete_count*2>=existing_count) or (existing_count>1 and delete_count=existing_count) then
      select to_jsonb(r) into latest from public.watchlog_read_libraries(array[p_account]) r;
      return latest||jsonb_build_object('ok',false,'code','library_safety_block','error','Unexpected library removal blocked. Your saved titles are safe.');
    end if;
  end if;
  return public.watchlog_patch_library_unchecked(p_account,p_revision,p_changes);
end; $$;

-- Also reject a direct bulk DELETE or an old whole-library import trigger.
create function public.watchlog_block_bulk_title_loss() returns trigger
language plpgsql security invoker set search_path='' as $$
declare removed record; remaining bigint;
begin
  for removed in select account_id,count(*) amount from deleted_titles group by account_id loop
    select count(*) into remaining from public.watchlog_pin_titles where account_id=removed.account_id;
    if (removed.amount>=5 and removed.amount>=remaining) or (removed.amount>1 and remaining=0) then
      raise exception 'Unexpected library removal blocked' using errcode='23514';
    end if;
  end loop;
  return null;
end; $$;
create trigger watchlog_block_bulk_title_loss after delete on public.watchlog_pin_titles
referencing old table as deleted_titles for each statement execute function public.watchlog_block_bulk_title_loss();
revoke all on function public.watchlog_patch_library(uuid,bigint,jsonb),public.watchlog_preserve_title_version(),public.watchlog_block_bulk_title_loss() from public,anon,authenticated;
grant execute on function public.watchlog_patch_library(uuid,bigint,jsonb) to service_role;

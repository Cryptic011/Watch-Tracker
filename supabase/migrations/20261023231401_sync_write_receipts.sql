-- Remember acknowledged mutations without retaining any Library contents.
-- A retry after a lost HTTP reply must not repeat an already committed edit.
create table public.watchlog_sync_receipts (
  account_id uuid not null references public.watchlog_pin_accounts(id) on delete cascade,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  revision bigint not null check (revision>=0),
  created_at timestamptz not null default now(),
  primary key(account_id,request_hash)
);
alter table public.watchlog_sync_receipts enable row level security;
revoke all on public.watchlog_sync_receipts from public,anon,authenticated;
grant all on public.watchlog_sync_receipts to service_role;

create function public.watchlog_patch_library_once(p_account uuid,p_revision bigint,p_changes jsonb,p_request_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare accepted_revision bigint; result jsonb;
begin
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid request hash'; end if;
  -- Serialize the receipt and the mutation on the same existing account lock.
  perform 1 from public.watchlog_pin_library where account_id=p_account for update;
  if not found then raise exception 'Library unavailable'; end if;
  select revision into accepted_revision from public.watchlog_sync_receipts
    where account_id=p_account and request_hash=p_request_hash;
  if found then return jsonb_build_object('ok',true,'revision',accepted_revision,'replayed',true); end if;
  result=public.watchlog_patch_library(p_account,p_revision,p_changes);
  if (result->>'ok')::boolean then
    insert into public.watchlog_sync_receipts(account_id,request_hash,revision)
      values(p_account,p_request_hash,(result->>'revision')::bigint);
  end if;
  return result;
end; $$;
revoke all on function public.watchlog_patch_library_once(uuid,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.watchlog_patch_library_once(uuid,bigint,jsonb,text) to service_role;

-- Private, per-title storage. The existing library row remains the revision
-- lock and the compatibility snapshot during the two-function rollout.
create table public.watchlog_pin_titles (
  account_id uuid not null references public.watchlog_pin_accounts(id) on delete cascade,
  item_id text not null check (length(item_id) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload)='object' and payload->>'id'=item_id),
  primary key (account_id,item_id)
);
create table public.watchlog_storage_config (
  singleton boolean primary key default true check(singleton),
  canonical boolean not null default false
);
insert into public.watchlog_storage_config(singleton) values(true);
create table public.watchlog_pin_recovery (
  account_id uuid primary key references public.watchlog_pin_accounts(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.watchlog_pin_titles enable row level security;
alter table public.watchlog_storage_config enable row level security;
alter table public.watchlog_pin_recovery enable row level security;
revoke all on public.watchlog_pin_titles,public.watchlog_storage_config,public.watchlog_pin_recovery from public,anon,authenticated;
grant all on public.watchlog_pin_titles,public.watchlog_storage_config,public.watchlog_pin_recovery to service_role;

-- Legacy inserts/whole-library writes still populate canonical title rows.
create function public.watchlog_import_legacy_items() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  delete from public.watchlog_pin_titles t where t.account_id=new.account_id
    and not exists(select 1 from jsonb_array_elements(new.items) e where e->>'id'=t.item_id);
  insert into public.watchlog_pin_titles(account_id,item_id,payload)
    select new.account_id,e->>'id',e from jsonb_array_elements(new.items) e
    where jsonb_typeof(e)='object' and length(e->>'id') between 1 and 200
    on conflict(account_id,item_id) do update set payload=excluded.payload
      where watchlog_pin_titles.payload is distinct from excluded.payload;
  return new;
end; $$;
create trigger watchlog_import_legacy_items after insert or update of items
  on public.watchlog_pin_library for each row execute function public.watchlog_import_legacy_items();
insert into public.watchlog_pin_titles(account_id,item_id,payload)
  select l.account_id,e->>'id',e from public.watchlog_pin_library l
  cross join lateral jsonb_array_elements(l.items) e
  where jsonb_typeof(e)='object' and length(e->>'id') between 1 and 200
  on conflict(account_id,item_id) do update set payload=excluded.payload;

create function public.watchlog_read_libraries(p_accounts uuid[])
returns table(account_id uuid,items jsonb,revision bigint,updated_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select l.account_id,coalesce((select jsonb_agg(t.payload order by t.item_id)
    from public.watchlog_pin_titles t where t.account_id=l.account_id),'[]'::jsonb),l.revision,l.updated_at
  from public.watchlog_pin_library l where l.account_id=any(p_accounts);
$$;

create function public.watchlog_patch_library(p_account uuid,p_revision bigint,p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  header public.watchlog_pin_library%rowtype; change jsonb; value jsonb; season text;
  delta jsonb; episodes jsonb; code text; latest jsonb; stamp timestamptz=clock_timestamp();
  canonical boolean;
begin
  select * into header from public.watchlog_pin_library where account_id=p_account for update;
  if not found then raise exception 'Library unavailable'; end if;
  if p_revision is null or p_revision<0 then raise exception 'Revision required'; end if;
  if header.revision<>p_revision then
    select to_jsonb(r) into latest from public.watchlog_read_libraries(array[p_account]) r;
    return coalesce(latest,'{}'::jsonb)||jsonb_build_object('ok',false,'code','revision_conflict');
  end if;
  if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>10000 then raise exception 'Invalid changes'; end if;
  for change in select e from jsonb_array_elements(p_changes) e loop
    code=change->>'id';
    if code is null or length(code) not between 1 and 200 then raise exception 'Invalid title identity'; end if;
    if change->>'delete'='true' then
      delete from public.watchlog_pin_titles where account_id=p_account and item_id=code;
      continue;
    end if;
    select payload into value from public.watchlog_pin_titles where account_id=p_account and item_id=code;
    if change ? 'create' then
      if value is not null then raise exception 'Title already exists'; end if;
      value=change->'create';
    elsif value is null then raise exception 'Title no longer exists';
    else
      if change ? 'set' then
        if jsonb_typeof(change->'set')<>'object' then raise exception 'Invalid fields'; end if;
        value=value||(change->'set');
      end if;
      if change ? 'unset' then value=value-array(select jsonb_array_elements_text(change->'unset')); end if;
      if change ? 'watched' then
        for season,delta in select * from jsonb_each(change->'watched') loop
          if season !~ '^[1-9][0-9]*$' then raise exception 'Invalid season'; end if;
          select coalesce(jsonb_agg(n order by n),'[]'::jsonb) into episodes from (
            select distinct n from (
              select e::integer n from jsonb_array_elements_text(coalesce(value->'watchedEpisodes'->season,'[]'::jsonb)) e
              where not (delta->'remove' @> jsonb_build_array(e::integer))
              union select e::integer n from jsonb_array_elements_text(delta->'add') e
            ) s where n>0
          ) allowed;
          value=jsonb_set(value,'{watchedEpisodes}',coalesce(value->'watchedEpisodes','{}'::jsonb),true);
          if jsonb_array_length(episodes)=0 then value=jsonb_set(value,'{watchedEpisodes}',(value->'watchedEpisodes')-season);
          else value=jsonb_set(value,array['watchedEpisodes',season],episodes,true); end if;
        end loop;
      end if;
    end if;
    if jsonb_typeof(value)<>'object' or value->>'id' is distinct from code or nullif(btrim(value->>'title'),'') is null then raise exception 'Invalid title'; end if;
    insert into public.watchlog_pin_titles values(p_account,code,value)
      on conflict(account_id,item_id) do update set payload=excluded.payload
      where watchlog_pin_titles.payload is distinct from excluded.payload;
  end loop;
  if jsonb_array_length(p_changes)=0 then return jsonb_build_object('ok',true,'revision',header.revision,'updatedAt',header.updated_at); end if;
  select c.canonical into canonical from public.watchlog_storage_config c where singleton;
  if canonical then
    update public.watchlog_pin_library set revision=revision+1,updated_at=stamp where account_id=p_account;
  else
    -- Temporary compatibility while the two previously deployed functions
    -- are being replaced; disable after both functions use canonical reads.
    select r.items into latest from public.watchlog_read_libraries(array[p_account]) r;
    update public.watchlog_pin_library set items=latest,revision=revision+1,updated_at=stamp where account_id=p_account;
  end if;
  return jsonb_build_object('ok',true,'revision',header.revision+1,'updatedAt',stamp);
end; $$;

-- Recovery verification, credential replacement, code rotation and session
-- revocation form one transaction. No plaintext recovery code is stored.
create function public.watchlog_recover_account(p_email text,p_code_hash text,p_pin_hash text,p_pin_salt text,p_next_code_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.watchlog_pin_accounts%rowtype; expected text;
begin
  select * into a from public.watchlog_pin_accounts where email=p_email for update;
  if not found then return jsonb_build_object('ok',false); end if;
  if a.locked_until>clock_timestamp() then return jsonb_build_object('ok',false,'locked',true); end if;
  select code_hash into expected from public.watchlog_pin_recovery where account_id=a.id;
  if expected is null or expected<>p_code_hash then
    perform public.watchlog_record_pin_failure(a.id,5,15);
    return jsonb_build_object('ok',false);
  end if;
  update public.watchlog_pin_accounts set pin_hash=p_pin_hash,pin_salt=p_pin_salt,failed_attempts=0,locked_until=null,updated_at=clock_timestamp() where id=a.id;
  update public.watchlog_pin_recovery set code_hash=p_next_code_hash,created_at=clock_timestamp() where account_id=a.id;
  delete from public.watchlog_pin_sessions where account_id=a.id;
  return jsonb_build_object('ok',true,'id',a.id,'email',a.email,'displayName',a.display_name);
end; $$;
create function public.watchlog_set_recovery(p_account uuid,p_pin_hash text,p_code_hash text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.watchlog_pin_accounts%rowtype;
begin
  select * into a from public.watchlog_pin_accounts where id=p_account for update;
  if not found or a.pin_hash<>p_pin_hash or a.locked_until>clock_timestamp() then return false; end if;
  insert into public.watchlog_pin_recovery(account_id,code_hash) values(p_account,p_code_hash)
  on conflict(account_id) do update set code_hash=excluded.code_hash,created_at=clock_timestamp();
  return true;
end; $$;
revoke all on function public.watchlog_import_legacy_items(),public.watchlog_read_libraries(uuid[]),public.watchlog_patch_library(uuid,bigint,jsonb),public.watchlog_recover_account(text,text,text,text,text),public.watchlog_set_recovery(uuid,text,text) from public,anon,authenticated;
grant execute on function public.watchlog_import_legacy_items(),public.watchlog_read_libraries(uuid[]),public.watchlog_patch_library(uuid,bigint,jsonb),public.watchlog_recover_account(text,text,text,text,text),public.watchlog_set_recovery(uuid,text,text) to service_role;

create table if not exists public.watchlog_passkeys (
  id text primary key,
  account_id uuid not null references public.watchlog_pin_accounts(id) on delete cascade,
  public_key text not null,
  counter bigint not null default 0 check(counter >= 0),
  transports jsonb not null default '[]',
  device_type text not null,
  backed_up boolean not null default false,
  label text not null default 'Passkey',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists watchlog_passkeys_account on public.watchlog_passkeys(account_id);
alter table public.watchlog_passkeys enable row level security;
revoke all on public.watchlog_passkeys from public, anon, authenticated;
grant all on public.watchlog_passkeys to service_role;

create table if not exists public.watchlog_passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.watchlog_pin_accounts(id) on delete cascade,
  challenge text not null,
  kind text not null check(kind in ('registration','authentication')),
  expires_at timestamptz not null
);
create index if not exists watchlog_passkey_challenge_expiry on public.watchlog_passkey_challenges(expires_at);
alter table public.watchlog_passkey_challenges enable row level security;
revoke all on public.watchlog_passkey_challenges from public, anon, authenticated;
grant all on public.watchlog_passkey_challenges to service_role;
alter table public.watchlog_pin_accounts add column if not exists preferences jsonb not null default '{}';

create or replace function public.watchlog_patch_preferences(p_account uuid,p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if jsonb_typeof(p_patch) <> 'object' or octet_length(p_patch::text)>4096 then raise exception 'Invalid preferences'; end if;
  update public.watchlog_pin_accounts set preferences=preferences||p_patch where id=p_account returning preferences into result;
  return result;
end $$;
revoke all on function public.watchlog_patch_preferences(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.watchlog_patch_preferences(uuid,jsonb) to service_role;

create or replace function public.watchlog_revoke_passkeys_on_pin_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.pin_hash is distinct from new.pin_hash then
    delete from public.watchlog_passkeys where account_id=new.id;
    delete from public.watchlog_passkey_challenges where account_id=new.id;
  end if;
  return new;
end $$;
revoke all on function public.watchlog_revoke_passkeys_on_pin_change() from public, anon, authenticated;
drop trigger if exists watchlog_revoke_changed_pin_passkeys on public.watchlog_pin_accounts;
create trigger watchlog_revoke_changed_pin_passkeys after update of pin_hash on public.watchlog_pin_accounts for each row execute function public.watchlog_revoke_passkeys_on_pin_change();

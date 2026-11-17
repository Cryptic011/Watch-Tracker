-- A fresh project must opt in with its own HTTPS URL before scheduling requests.
alter table public.watchlog_push_config add column if not exists reminder_project_url text
  check (reminder_project_url ~ '^https://[a-z0-9][a-z0-9.-]*[a-z0-9]$');

create or replace function public.watchlog_trigger_reminder_scan()
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  request_id bigint;
  secret_value text;
  project_url text;
begin
  select config.cron_secret, config.reminder_project_url
    into secret_value, project_url
    from public.watchlog_push_config as config where singleton = true;
  if project_url is null then return null; end if;
  if secret_value is null then raise exception 'Watch Tracker reminder cron secret is missing'; end if;

  select net.http_post(
    url := project_url || '/functions/v1/watchlog-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-WatchLog-Cron', secret_value),
    body := jsonb_build_object('action', 'process'),
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function public.watchlog_trigger_reminder_scan() from public, anon, authenticated;

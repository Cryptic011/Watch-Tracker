-- A normal scan includes rate-limited regional feed requests and takes longer
-- than the old ten-second HTTP deadline. Keep the connection open for its result.
-- This changes only the scheduler's wait; reminder scans still run every minute.
create or replace function public.watchlog_trigger_reminder_scan()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_id bigint;
  secret_value text;
begin
  select cron_secret
    into secret_value
    from public.watchlog_push_config
   where singleton = true;

  if secret_value is null then
    raise exception 'WatchLog reminder cron secret is missing';
  end if;

  select net.http_post(
    url := 'https://okkwteywtgfsnlrjdyhv.supabase.co/functions/v1/watchlog-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-WatchLog-Cron', secret_value
    ),
    body := jsonb_build_object('action', 'process'),
    timeout_milliseconds := 60000
  ) into request_id;

  return request_id;
end;
$function$;

revoke all on function public.watchlog_trigger_reminder_scan() from public;
revoke all on function public.watchlog_trigger_reminder_scan() from anon;
revoke all on function public.watchlog_trigger_reminder_scan() from authenticated;

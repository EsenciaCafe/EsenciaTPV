create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('club-outbox-delivery','* * * * *',$job$
 select net.http_post(
 url := 'https://tbqvypdxcgeofsmiqmuo.supabase.co/functions/v1/club-tpv',
 headers := (select jsonb_build_object('Content-Type','application/json','x-club-worker',worker_token) from tpv_bridge_private.runtime_keys where id=true),
 body := '{}'::jsonb, timeout_milliseconds := 55000
 );
$job$);

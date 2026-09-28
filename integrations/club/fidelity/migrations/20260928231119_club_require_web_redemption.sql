-- FIDELIDAD project only. Require a voucher already bought on the web.
create or replace function club_bridge_private.perform_action(e jsonb,actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 p jsonb:=e->'payload';s text:=e->>'source_project';page_size integer;
 cursor_data jsonb;after_id uuid;items jsonb;has_more boolean;last_id uuid;
begin
 if e->>'action'='redemption.reserve' and nullif(e#>>'{payload,redemption_id}','') is null then
  raise exception 'WEB_REDEMPTION_REQUIRED';
 end if;
 if e->>'action'<>'reward.catalogue' then return club_bridge_private.perform_action_base_v1(e,actor);end if;
 if jsonb_typeof(p->'limit') is distinct from 'number' or coalesce(p->>'limit','') !~ '^[0-9]+$' or (p->>'limit')::numeric not between 1 and 100 or not(p ? 'cursor') then raise exception 'INVALID_PAGINATION';end if;
 page_size:=(p->>'limit')::integer;
 if p->'cursor'<>'null'::jsonb then
  begin
   if jsonb_typeof(p->'cursor')<>'string' or length(p->>'cursor') not between 1 and 2048 then raise exception 'INVALID_CURSOR';end if;
   cursor_data:=convert_from(decode(p->>'cursor','base64'),'UTF8')::jsonb;
   if cursor_data->>'v' is distinct from '1' or cursor_data->>'source' is distinct from s or nullif(cursor_data->>'after','') is null then raise exception 'INVALID_CURSOR';end if;
   after_id:=(cursor_data->>'after')::uuid;
  exception when others then raise exception 'INVALID_CURSOR';end;
 end if;
 -- UUID keyset order is stable under title/status changes. One statement per page.
 with batch as materialized (
  select r.id,r.title,r.description,r.cost,r.active,r.bridge_version as version,rr.rule
  from public.club_rewards r left join club_bridge_private.rules rr on rr.reward_id=r.id and rr.source=s
  where after_id is null or r.id>after_id order by r.id limit page_size+1
 ), page as (select * from batch order by id limit page_size)
 select coalesce((select jsonb_agg(to_jsonb(x) order by id) from page x),'[]'::jsonb),
  (select count(*)>page_size from batch),(select id from page order by id desc limit 1)
 into items,has_more,last_id;
 return jsonb_build_object('rewards',items,'next_cursor',case when has_more then
  replace(encode(convert_to(jsonb_build_object('v',1,'source',s,'after',last_id)::text,'UTF8'),'base64'),E'\n','') else null end);
end $$;
revoke all on function club_bridge_private.perform_action(jsonb,uuid) from public,anon,authenticated,service_role;

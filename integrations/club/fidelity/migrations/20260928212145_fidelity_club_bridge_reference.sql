-- CANDIDATE ONLY: no production deployment. Apply after copied Club baseline.
create schema club_bridge_private;
revoke all on schema club_bridge_private from public,anon,authenticated;
grant usage on schema club_bridge_private to service_role;
create table club_bridge_private.sources(id text primary key, enabled boolean not null default false);
create table club_bridge_private.employees(
 source text references club_bridge_private.sources(id), employee_id text, actor uuid not null references auth.users(id),
 enabled boolean not null default false, permissions text[] not null default '{}', primary key(source,employee_id));
create table club_bridge_private.nonces(source text references club_bridge_private.sources(id), nonce uuid, expires_at timestamptz not null, primary key(source,nonce));
create table club_bridge_private.operations(
 source text, id uuid, business_key text not null, envelope jsonb not null, actor uuid not null references auth.users(id),
 response jsonb not null, created_at timestamptz not null default now(), primary key(source,id),unique(source,business_key));
create table club_bridge_private.assignments(
 source text, sale_id text, id uuid not null default gen_random_uuid(), member_id uuid references public.club_members(id),
 amount integer, delta integer, version integer not null default 0, active boolean not null default false,
 ledger_id uuid references public.club_ledger(id), primary key(source,sale_id));
create table club_bridge_private.assignment_history(
 source text,sale_id text,version integer,operation_id uuid,member_id uuid,delta integer,ledger_id uuid,actor uuid,
 reason text,created_at timestamptz not null default now(),primary key(source,sale_id,version));
create table club_bridge_private.rules(reward_id uuid primary key references public.club_rewards(id),source text not null,rule jsonb not null);
create table club_bridge_private.reservations(
 id uuid primary key default gen_random_uuid(),source text not null,application_id text not null,cart_id text not null,
 redemption_id uuid not null references public.club_redemptions(id),member_id uuid not null references public.club_members(id),
 issued_here boolean not null, cost integer not null, reward_version integer not null,rule jsonb not null,
 state text not null default 'reserved' check(state in ('reserved','committed','released')),version integer not null default 1,
 delivery_type text,delivery_id text,cancel_event_id text,actor uuid not null references auth.users(id),
 created_at timestamptz not null default now(),unique(source,application_id));
create unique index club_bridge_one_reservation on club_bridge_private.reservations(redemption_id) where state='reserved';
create table club_bridge_private.events(
 id uuid primary key default gen_random_uuid(),source text not null,operation_id uuid not null,event jsonb not null,
 created_at timestamptz not null default now(),unique(source,operation_id));
-- Durable events share the transaction with mutation/result. Delivery to a remote receiver is not enabled.
DO $$ declare t text; begin
 foreach t in array array['sources','employees','nonces','operations','assignments','assignment_history','rules','reservations','events'] loop
 execute format('alter table club_bridge_private.%I enable row level security',t);
 execute format('revoke all on club_bridge_private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
alter table public.club_members add column bridge_version integer not null default 1;
alter table public.club_rewards add column bridge_version integer not null default 1;
create function club_bridge_private.bump_version() returns trigger language plpgsql set search_path='' as $$
begin new.bridge_version:=old.bridge_version+1;return new;end $$;
create trigger club_bridge_member_version before update on public.club_members for each row execute function club_bridge_private.bump_version();
create trigger club_bridge_reward_version before update on public.club_rewards for each row execute function club_bridge_private.bump_version();
alter table public.club_ledger drop constraint club_ledger_delta_check;
alter table public.club_ledger drop constraint club_ledger_kind_check;
alter table public.club_ledger add constraint club_ledger_kind_check check(kind in ('purchase','redeem','refund','courtesy','assignment_withdraw'));
alter table public.club_ledger add constraint club_ledger_delta_check check(
 (kind='purchase' and delta>=0) or (kind='redeem' and delta<0) or (kind in ('refund','courtesy') and delta>0) or (kind='assignment_withdraw' and delta<=0));
create function club_bridge_private.guard_reserved() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status and exists(select 1 from club_bridge_private.reservations where redemption_id=old.id and state='reserved') then
 raise exception 'Este canje está reservado por el TPV.' using errcode='P0001';end if;
 return new;
end $$;
create trigger club_bridge_reservation_guard before update of status on public.club_redemptions for each row execute function club_bridge_private.guard_reserved();

create function club_bridge_private.perform_action(e jsonb,actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
<<calc>>
declare
 p jsonb:=e->'payload';a text:=e->>'action';s text:=e->>'source_project';
 m public.club_members%rowtype;r public.club_rewards%rowtype;v public.club_redemptions%rowtype;
 assignment club_bridge_private.assignments%rowtype;reservation club_bridge_private.reservations%rowtype;
 delta integer;movement uuid;rule jsonb;new_can boolean;ver integer;hist jsonb;result jsonb;
begin
 if a='member.lookup' then
  if coalesce(p->>'qr','') !~ '^esencia-club:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_QR';end if;
  select * into m from public.club_members where qr_token=substring(p->>'qr' from 17)::uuid;
  if not found then raise exception 'MEMBER_NOT_FOUND';end if;
  return jsonb_build_object('id',m.id,'code',m.code,'name',m.name,'balance',m.balance,'version',m.bridge_version);
 elsif a='member.offers' then
  select * into m from public.club_members where id=(p->>'member_id')::uuid;
  if not found then raise exception 'MEMBER_NOT_FOUND';end if;
  return jsonb_build_object('member_id',m.id,'balance',m.balance,'version',m.bridge_version,
   'rewards',coalesce((select jsonb_agg(jsonb_build_object('id',cr.id,'title',cr.title,'cost',cr.cost,'version',cr.bridge_version,'rule',rr.rule,
    'eligible',m.balance>=cr.cost and m.legal_version=(select legal_version from public.club_settings where id=true) and not exists(select 1 from public.club_redemptions cd where cd.member_id=m.id and cd.reward_id=cr.id and cd.status='pending')))
    from public.club_rewards cr join club_bridge_private.rules rr on rr.reward_id=cr.id and rr.source=s where cr.active),'[]'),
   'pending',coalesce((select jsonb_agg(jsonb_build_object('id',cd.id,'reward_id',cd.reward_id,'cost',cd.cost,'status',cd.status,
     'reserved',exists(select 1 from club_bridge_private.reservations z where z.redemption_id=cd.id and z.state='reserved')))
    from public.club_redemptions cd where cd.member_id=m.id and cd.status='pending'),'[]'));
 elsif a='assignment.get' then
  select * into assignment from club_bridge_private.assignments where source=s and sale_id=p->>'sale_id';
  select coalesce(jsonb_agg(to_jsonb(h) order by version),'[]') into hist from club_bridge_private.assignment_history h where source=s and sale_id=p->>'sale_id';
  return jsonb_build_object('assignment',case when assignment.id is null then null else to_jsonb(assignment) end,'version',coalesce(assignment.version,0),'history',hist);
 elsif a='reward.configure' then
  select * into r from public.club_rewards where id=(p->>'reward_id')::uuid for update;
  if found then
   if r.bridge_version<>(p->>'expected_version')::integer then raise exception 'VERSION_CONFLICT';end if;
   if exists(select 1 from club_bridge_private.rules where reward_id=r.id and source<>s) then raise exception 'SOURCE_CONFLICT';end if;
   update public.club_rewards set title=p->>'title',description=p->>'description',cost=(p->>'cost')::integer,active=(p->>'active')::boolean where id=r.id returning * into r;
  else
   if (p->>'expected_version')::integer<>0 then raise exception 'VERSION_CONFLICT';end if;
   insert into public.club_rewards(id,title,description,cost,active) values((p->>'reward_id')::uuid,p->>'title',p->>'description',(p->>'cost')::integer,(p->>'active')::boolean) returning * into r;
  end if;
  insert into club_bridge_private.rules values(r.id,s,p->'rule') on conflict(reward_id) do update set rule=excluded.rule;
  return jsonb_build_object('reward_id',r.id,'version',r.bridge_version,'rule',p->'rule');
 elsif a in ('award.purchase','award.clear','award.courtesy') then
  if a='award.purchase' then
   insert into club_bridge_private.assignments(source,sale_id) values(s,p->>'sale_id') on conflict do nothing;
   select * into assignment from club_bridge_private.assignments where source=s and sale_id=p->>'sale_id' for update;
   if assignment.version<>(p->>'expected_version')::integer then raise exception 'VERSION_CONFLICT';end if;
   if assignment.active then raise exception 'ASSIGNMENT_ACTIVE';end if;
  end if;
  select * into m from public.club_members where id=(p->>'member_id')::uuid for update;
  if not found then raise exception 'MEMBER_NOT_FOUND';end if;
  if a='award.courtesy' then delta:=(p->>'points')::integer; if delta<=0 then raise exception 'INVALID_POINTS';end if;
  else
   if (p->>'amount')::integer not between 0 and 999999 then raise exception 'INVALID_AMOUNT';end if;
   delta:=((p->>'amount')::integer/100)*100;
  end if;
  update public.club_members set balance=balance+delta where id=m.id returning bridge_version into ver;
  insert into public.club_ledger(member_id,delta,kind,label,created_by,amount) values(m.id,delta,case when a='award.courtesy' then 'courtesy' else 'purchase' end,
   case a when 'award.purchase' then 'Compra TPV' when 'award.clear' then 'Vaciado TPV sin cobro' else p->>'reason' end,actor,
   case when a='award.courtesy' or (p->>'amount')::integer=0 then null else (p->>'amount')::integer end) returning id into movement;
  result:=jsonb_build_object('ledger_id',movement,'delta',delta,'balance',m.balance+delta,'member_version',ver);
  if a='award.purchase' then
   update club_bridge_private.assignments set member_id=m.id,amount=(p->>'amount')::integer,delta=calc.delta,version=version+1,active=true,ledger_id=movement where source=s and sale_id=assignment.sale_id returning * into assignment;
   insert into club_bridge_private.assignment_history values(s,assignment.sale_id,assignment.version,(e->>'operation_id')::uuid,m.id,delta,movement,actor,'assign',now());
   result:=result||jsonb_build_object('assignment_id',assignment.id,'version',assignment.version);
  end if;
  return result;
 elsif a='assignment.withdraw' then
  select * into assignment from club_bridge_private.assignments where source=s and sale_id=p->>'sale_id' for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND';end if;
  if assignment.version<>(p->>'expected_version')::integer then raise exception 'VERSION_CONFLICT';end if;
  if not assignment.active then raise exception 'ASSIGNMENT_INACTIVE';end if;
  select * into m from public.club_members where id=assignment.member_id for update;
  if m.balance<assignment.delta then raise exception 'INSUFFICIENT_POINTS';end if;
  update public.club_members set balance=balance-assignment.delta where id=m.id returning bridge_version into ver;
  insert into public.club_ledger(member_id,delta,kind,label,created_by) values(m.id,-assignment.delta,'assignment_withdraw',p->>'reason',actor) returning id into movement;
  update club_bridge_private.assignments set active=false,version=version+1 where source=s and sale_id=assignment.sale_id returning * into assignment;
  insert into club_bridge_private.assignment_history values(s,assignment.sale_id,assignment.version,(e->>'operation_id')::uuid,m.id,-assignment.delta,movement,actor,p->>'reason',now());
  return jsonb_build_object('assignment_id',assignment.id,'ledger_id',movement,'delta',-assignment.delta,'version',assignment.version,'member_version',ver);
 elsif a='redemption.reserve' then
  select * into m from public.club_members where id=(p->>'member_id')::uuid for update;
  if not found then raise exception 'MEMBER_NOT_FOUND';end if;
  if m.legal_version is distinct from (select legal_version from public.club_settings where id=true) then raise exception 'LEGAL_ACCEPTANCE_REQUIRED';end if;
  select * into r from public.club_rewards where id=(p->>'reward_id')::uuid for share;
  if not found or not r.active then raise exception 'REWARD_UNAVAILABLE';end if;
  if r.bridge_version<>(p->>'expected_version')::integer then raise exception 'VERSION_CONFLICT';end if;
  select rr.rule into rule from club_bridge_private.rules rr where reward_id=r.id and source=s;
  if rule is null then raise exception 'RULE_NOT_CONFIGURED';end if;
  if exists(select 1 from club_bridge_private.reservations where source=s and application_id=p->>'application_id') then raise exception 'APPLICATION_CONFLICT';end if;
  new_can:=not(p ? 'redemption_id');
  if new_can then
   if r.cost<>(p->>'expected_cost')::integer then raise exception 'COST_CHANGED';end if;
   if exists(select 1 from public.club_redemptions where member_id=m.id and reward_id=r.id and status='pending') then raise exception 'PENDING_EXISTS';end if;
   if m.balance<r.cost then raise exception 'INSUFFICIENT_POINTS';end if;
   update public.club_members set balance=balance-r.cost where id=m.id;
   insert into public.club_redemptions(member_id,reward_id,title,cost) values(m.id,r.id,r.title,r.cost) returning * into v;
   insert into public.club_ledger(member_id,delta,kind,label,created_by) values(m.id,-r.cost,'redeem',r.title,actor) returning id into movement;
  else
   select * into v from public.club_redemptions where id=(p->>'redemption_id')::uuid for update;
   if not found or v.member_id<>m.id or v.reward_id<>r.id or v.status<>'pending' then raise exception 'REDEMPTION_UNAVAILABLE';end if;
   if v.cost<>(p->>'expected_cost')::integer then raise exception 'COST_CHANGED';end if;
   if exists(select 1 from club_bridge_private.reservations where redemption_id=v.id and state='reserved') then raise exception 'ALREADY_RESERVED';end if;
  end if;
  insert into club_bridge_private.reservations(source,application_id,cart_id,redemption_id,member_id,issued_here,cost,reward_version,rule,actor)
   values(s,p->>'application_id',p->>'cart_id',v.id,m.id,new_can,v.cost,r.bridge_version,rule,actor) returning * into reservation;
  return jsonb_build_object('reservation_id',reservation.id,'redemption_id',v.id,'cost',v.cost,'state',reservation.state,'version',reservation.version,'reward_version',r.bridge_version,'rule',rule,'ledger_id',movement);
 elsif a in ('redemption.commit','redemption.release') then
  select * into reservation from club_bridge_private.reservations where id=(p->>'reservation_id')::uuid and source=s;
  if not found then raise exception 'RESERVATION_NOT_FOUND';end if;
  -- All paths lock member before redemption, matching manual Club actions.
  perform 1 from public.club_members where id=reservation.member_id for update;
  select * into v from public.club_redemptions where id=reservation.redemption_id for update;
  select * into reservation from club_bridge_private.reservations where id=reservation.id for update;
  if reservation.application_id<>p->>'application_id' then raise exception 'APPLICATION_CONFLICT';end if;
  if reservation.state<>'reserved' then raise exception 'RESERVATION_RESOLVED';end if;
  if v.status<>'pending' then raise exception 'REDEMPTION_UNAVAILABLE';end if;
  if a='redemption.commit' then
   if (p ? 'sale_id')=(p ? 'delivered_clear_id') then raise exception 'INVALID_DELIVERY';end if;
   update club_bridge_private.reservations set state='committed',version=version+1,delivery_type=case when p ? 'sale_id' then 'sale' else 'clear' end,
    delivery_id=coalesce(p->>'sale_id',p->>'delivered_clear_id') where id=reservation.id;
   update public.club_redemptions set status='used',resolved_by=actor,resolved_at=now() where id=v.id;
  else
   update club_bridge_private.reservations set state='released',version=version+1,cancel_event_id=p->>'cancel_event_id' where id=reservation.id;
   if reservation.issued_here then
    update public.club_redemptions set status='cancelled',resolved_by=actor,resolved_at=now() where id=v.id;
    update public.club_members set balance=balance+reservation.cost where id=reservation.member_id;
    insert into public.club_ledger(member_id,delta,kind,label,created_by) values(reservation.member_id,reservation.cost,'refund','Reserva TPV cancelada',actor) returning id into movement;
   end if;
  end if;
  return jsonb_build_object('reservation_id',reservation.id,'redemption_id',v.id,'state',case when a='redemption.commit' then 'committed' else 'released' end,
   'redemption_status',case when a='redemption.commit' then 'used' when reservation.issued_here then 'cancelled' else 'pending' end,'version',reservation.version+1,'ledger_id',movement);
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;

create function club_bridge_private.dispatch(p_envelope jsonb,p_nonce uuid,p_expires_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 e jsonb:=p_envelope;s text:=p_envelope->>'source_project';a text:=p_envelope->>'action';
 op uuid:=(p_envelope->>'operation_id')::uuid;employee club_bridge_private.employees%rowtype;
 previous club_bridge_private.operations%rowtype;answer jsonb;result jsonb;code text;
begin
 if e->>'version'<>'1' or op is null or nullif(e->>'business_key','') is null or nullif(e->>'terminal_id','') is null or jsonb_typeof(e->'payload')<>'object' then raise exception 'INVALID_ENVELOPE';end if;
 -- Serialize business operations per origin; deliberately conservative for this single-business candidate.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('club-bridge:'||s,0));
 if not exists(select 1 from club_bridge_private.sources where id=s and enabled) then return jsonb_build_object('code','SOURCE_DISABLED','retryable',false);end if;
 if p_nonce is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '70 seconds' then return jsonb_build_object('code','ASSERTION_EXPIRED','retryable',false);end if;
 insert into club_bridge_private.nonces values(s,p_nonce,p_expires_at) on conflict do nothing;
 if not found then return jsonb_build_object('code','NONCE_REPLAY','retryable',false);end if;
 select * into employee from club_bridge_private.employees where source=s and employee_id=e->>'employee_id';
 if not found or not employee.enabled or not exists(select 1 from public.customers where auth_user_id=employee.actor and role='admin') then
  return jsonb_build_object('code','EMPLOYEE_DISABLED','retryable',false);end if;
 if not(a=any(employee.permissions)) then return jsonb_build_object('code','FORBIDDEN','retryable',false);end if;
 if a='operation.get' then
  select * into previous from club_bridge_private.operations where source=s and id=(e->'payload'->>'operation_id')::uuid;
  if not found then return jsonb_build_object('operation_id',e->'payload'->>'operation_id','state','not_found');end if;
  return previous.response;
 end if;
 select * into previous from club_bridge_private.operations where source=s and (id=op or business_key=e->>'business_key');
 if found then
  if previous.envelope<>e or previous.actor<>employee.actor then return jsonb_build_object('operation_id',op,'code','OPERATION_CONFLICT','retryable',false,'canonical_operation_id',previous.id);end if;
  return previous.response;
 end if;
 begin
  result:=club_bridge_private.perform_action(e,employee.actor);
  answer:=jsonb_build_object('operation_id',op,'state','applied','result',result);
 exception
  when raise_exception then
   code:=sqlerrm;
   answer:=jsonb_build_object('operation_id',op,'state','rejected','error',jsonb_build_object('code',code,'message',code,'retryable',false));
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation then
   answer:=jsonb_build_object('operation_id',op,'state','rejected','error',jsonb_build_object('code','INVALID_PAYLOAD','message','Datos no válidos.','retryable',false));
 end;
 insert into club_bridge_private.operations values(s,op,e->>'business_key',e,employee.actor,answer,now());
 if answer->>'state'='applied' and a not in ('member.lookup','member.offers','assignment.get') then
  insert into club_bridge_private.events(source,operation_id,event) values(s,op,answer);
 end if;
 return answer;
end $$;
create function public.club_bridge_dispatch(p_envelope jsonb,p_nonce uuid,p_expires_at timestamptz) returns jsonb language sql security invoker set search_path='' as $$
 select club_bridge_private.dispatch(p_envelope,p_nonce,p_expires_at);
$$;
revoke all on all functions in schema club_bridge_private from public,anon,authenticated,service_role;
grant execute on function club_bridge_private.dispatch(jsonb,uuid,timestamptz) to service_role;
revoke all on function public.club_bridge_dispatch(jsonb,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.club_bridge_dispatch(jsonb,uuid,timestamptz) to service_role;

-- Isolated additive v1 extension. No existing permissions are expanded.
alter function club_bridge_private.perform_action(jsonb,uuid) rename to perform_action_base_v1;
create function club_bridge_private.perform_action(e jsonb,actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 p jsonb:=e->'payload';s text:=e->>'source_project';page_size integer;
 cursor_data jsonb;after_id uuid;items jsonb;has_more boolean;last_id uuid;
begin
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

-- Preserve durable page responses without emitting mutation events.
create or replace function club_bridge_private.dispatch(p_envelope jsonb,p_nonce uuid,p_expires_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 e jsonb:=p_envelope;s text:=p_envelope->>'source_project';a text:=p_envelope->>'action';
 op uuid:=(p_envelope->>'operation_id')::uuid;employee club_bridge_private.employees%rowtype;
 previous club_bridge_private.operations%rowtype;answer jsonb;result jsonb;code text;
begin
 if e->>'version'<>'1' or op is null or nullif(e->>'business_key','') is null or nullif(e->>'terminal_id','') is null or jsonb_typeof(e->'payload')<>'object' then raise exception 'INVALID_ENVELOPE';end if;
 -- Serialize business operations per origin; deliberately conservative for this single-business candidate.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('club-bridge:'||s,0));
 if not exists(select 1 from club_bridge_private.sources where id=s and enabled) then return jsonb_build_object('code','SOURCE_DISABLED','retryable',false);end if;
 if p_nonce is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '70 seconds' then return jsonb_build_object('code','ASSERTION_EXPIRED','retryable',false);end if;
 insert into club_bridge_private.nonces values(s,p_nonce,p_expires_at) on conflict do nothing;
 if not found then return jsonb_build_object('code','NONCE_REPLAY','retryable',false);end if;
 select * into employee from club_bridge_private.employees where source=s and employee_id=e->>'employee_id';
 if not found or not employee.enabled or not exists(select 1 from public.customers where auth_user_id=employee.actor and role='admin') then
  return jsonb_build_object('code','EMPLOYEE_DISABLED','retryable',false);end if;
 if not(a=any(employee.permissions)) then return jsonb_build_object('code','FORBIDDEN','retryable',false);end if;
 if a='operation.get' then
  select * into previous from club_bridge_private.operations where source=s and id=(e->'payload'->>'operation_id')::uuid;
  if not found then return jsonb_build_object('operation_id',e->'payload'->>'operation_id','state','not_found');end if;
  return previous.response;
 end if;
 select * into previous from club_bridge_private.operations where source=s and (id=op or business_key=e->>'business_key');
 if found then
  if previous.envelope<>e or previous.actor<>employee.actor then return jsonb_build_object('operation_id',op,'code','OPERATION_CONFLICT','retryable',false,'canonical_operation_id',previous.id);end if;
  return previous.response;
 end if;
 begin
  result:=club_bridge_private.perform_action(e,employee.actor);
  answer:=jsonb_build_object('operation_id',op,'state','applied','result',result);
 exception
  when raise_exception then
   code:=sqlerrm;
   answer:=jsonb_build_object('operation_id',op,'state','rejected','error',jsonb_build_object('code',code,'message',code,'retryable',false));
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation then
   answer:=jsonb_build_object('operation_id',op,'state','rejected','error',jsonb_build_object('code','INVALID_PAYLOAD','message','Datos no válidos.','retryable',false));
 end;
 insert into club_bridge_private.operations values(s,op,e->>'business_key',e,employee.actor,answer,now());
 if answer->>'state'='applied' and a not in ('member.lookup','member.offers','assignment.get','reward.catalogue') then
  insert into club_bridge_private.events(source,operation_id,event) values(s,op,answer);
 end if;
 return answer;
end $$;

create table club_bridge_private.trusted_keys(kid text primary key,public_key text not null,issuer text not null,source text not null references club_bridge_private.sources(id),enabled boolean not null default false);
alter table club_bridge_private.trusted_keys enable row level security;
revoke all on club_bridge_private.trusted_keys from public,anon,authenticated,service_role;
-- Private benefit configuration is maintained by the existing Fidelity web editor.
create function club_bridge_private.sync_web_benefit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into club_bridge_private.rules(reward_id,source,rule)
 select new.reward_id,id,new.rule from club_bridge_private.sources where id='tbqvypdxcgeofsmiqmuo'
 on conflict(reward_id) do update set rule=excluded.rule where club_bridge_private.rules.source=excluded.source;
 return new;
end $$;
revoke all on function club_bridge_private.sync_web_benefit() from public,anon,authenticated,service_role;
create trigger club_bridge_web_benefit after insert or update on club_private.reward_benefits for each row execute function club_bridge_private.sync_web_benefit();

-- Run this file in the loyalty Supabase project.
-- It extends the TPV bridge with read/admin helpers for the TPV loyalty module.

create or replace function public.tpv_get_loyalty_dashboard()
returns table (
  total_customers bigint,
  customers_with_rfid bigint,
  total_points bigint,
  total_visits bigint,
  total_spent numeric,
  pending_vouchers bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*) from public.customers where coalesce(role, 'user') <> 'admin')::bigint,
    (select count(*) from public.customers where coalesce(role, 'user') <> 'admin' and nullif(trim(coalesce(rfid_uid, '')), '') is not null)::bigint,
    (select coalesce(sum(points), 0) from public.customers where coalesce(role, 'user') <> 'admin')::bigint,
    (select coalesce(sum(visits), 0) from public.customers where coalesce(role, 'user') <> 'admin')::bigint,
    (select round(coalesce(sum(total_spent), 0)::numeric, 2) from public.customers where coalesce(role, 'user') <> 'admin')::numeric,
    (select count(*) from public.customer_vouchers where status = 'pending')::bigint;
$$;

create or replace function public.tpv_search_loyalty_customers(p_query text default '')
returns table (
  id bigint,
  name text,
  email text,
  phone text,
  rfid_uid text,
  points integer,
  visits integer,
  total_spent numeric,
  tier text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_pattern text := '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%';
begin
  return query
  select
    c.id,
    c.name::text,
    c.email::text,
    c.phone::text,
    c.rfid_uid::text,
    coalesce(c.points, 0),
    coalesce(c.visits, 0),
    round(coalesce(c.total_spent, 0)::numeric, 2),
    coalesce(c.tier, public.calcular_tier(coalesce(c.points, 0)))
  from public.customers c
  where coalesce(c.role, 'user') <> 'admin'
    and (
      v_query = ''
      or c.name ilike v_pattern escape '\'
      or c.email ilike v_pattern escape '\'
      or c.phone ilike v_pattern escape '\'
      or c.rfid_uid ilike v_pattern escape '\'
    )
  order by c.name nulls last, c.id desc
  limit 80;
end;
$$;

create or replace function public.tpv_get_loyalty_customer_purchases(
  p_customer_id bigint,
  p_limit integer default 8
)
returns table (
  id bigint,
  amount numeric,
  points integer,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    round(coalesce(p.amount, 0)::numeric, 2),
    coalesce(p.points, 0),
    p.created_at
  from public.purchases p
  where p.customer_id = p_customer_id
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 25));
$$;

create or replace function public.tpv_create_loyalty_customer(
  p_name text,
  p_email text default '',
  p_phone text default '',
  p_rfid_uid text default ''
)
returns table (
  id bigint,
  name text,
  email text,
  phone text,
  rfid_uid text,
  points integer,
  visits integer,
  total_spent numeric,
  tier text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := trim(coalesce(p_phone, ''));
  v_rfid_uid text := nullif(upper(trim(coalesce(p_rfid_uid, ''))), '');
  v_customer public.customers%rowtype;
begin
  if v_name = '' then
    raise exception 'El nombre del cliente es obligatorio';
  end if;

  if v_rfid_uid is not null and exists (
    select 1 from public.customers c where upper(trim(coalesce(c.rfid_uid, ''))) = v_rfid_uid
  ) then
    raise exception 'Ese RFID ya esta asignado a otro cliente';
  end if;

  insert into public.customers (
    name,
    email,
    phone,
    role,
    points,
    visits,
    total_spent,
    tier,
    rfid_uid,
    accepted_privacy,
    accepted_privacy_at,
    privacy_accepted_at,
    privacy_version,
    accepted_terms,
    terms_version,
    terms_accepted_at,
    marketing_consent,
    marketing_consent_at,
    marketing_consent_updated_at
  )
  values (
    v_name,
    nullif(v_email, ''),
    v_phone,
    'user',
    0,
    0,
    0,
    public.calcular_tier(0),
    v_rfid_uid,
    true,
    now(),
    now(),
    '1.0',
    true,
    '1.0',
    now(),
    false,
    null,
    now()
  )
  returning * into v_customer;

  return query select
    v_customer.id,
    v_customer.name::text,
    v_customer.email::text,
    v_customer.phone::text,
    v_customer.rfid_uid::text,
    coalesce(v_customer.points, 0),
    coalesce(v_customer.visits, 0),
    round(coalesce(v_customer.total_spent, 0)::numeric, 2),
    coalesce(v_customer.tier, public.calcular_tier(coalesce(v_customer.points, 0)));
end;
$$;

revoke all on function public.tpv_get_loyalty_dashboard() from public;
revoke all on function public.tpv_search_loyalty_customers(text) from public;
revoke all on function public.tpv_get_loyalty_customer_purchases(bigint, integer) from public;
revoke all on function public.tpv_create_loyalty_customer(text, text, text, text) from public;

grant execute on function public.tpv_get_loyalty_dashboard() to anon, authenticated;
grant execute on function public.tpv_search_loyalty_customers(text) to anon, authenticated;
grant execute on function public.tpv_get_loyalty_customer_purchases(bigint, integer) to anon, authenticated;
grant execute on function public.tpv_create_loyalty_customer(text, text, text, text) to anon, authenticated;

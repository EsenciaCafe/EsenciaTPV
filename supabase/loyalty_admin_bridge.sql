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

create or replace function public.tpv_update_loyalty_customer(
  p_customer_id bigint,
  p_name text,
  p_email text default '',
  p_phone text default '',
  p_rfid_uid text default '',
  p_points integer default 0
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
  v_points integer := greatest(coalesce(p_points, 0), 0);
  v_customer public.customers%rowtype;
begin
  if v_name = '' then
    raise exception 'El nombre del cliente es obligatorio';
  end if;

  if v_rfid_uid is not null and exists (
    select 1 from public.customers c
    where c.id <> p_customer_id
      and upper(trim(coalesce(c.rfid_uid, ''))) = v_rfid_uid
  ) then
    raise exception 'Ese RFID ya esta asignado a otro cliente';
  end if;

  update public.customers c
  set name = v_name,
      email = nullif(v_email, ''),
      phone = v_phone,
      rfid_uid = v_rfid_uid,
      points = v_points,
      tier = public.calcular_tier(v_points),
      updated_at = now()
  where c.id = p_customer_id
  returning * into v_customer;

  if not found then
    raise exception 'Cliente no encontrado';
  end if;

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

create or replace function public.tpv_list_loyalty_promos()
returns table (
  id bigint,
  title text,
  description text,
  tag text,
  type text,
  pts_req integer,
  expiry text,
  active boolean,
  hidden boolean
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.title::text,
    p.description::text,
    p.tag::text,
    p.type::text,
    coalesce(p.pts_req, 0),
    coalesce(p.expiry::text, ''),
    coalesce(p.active, true),
    coalesce(p.hidden, false)
  from public.promos p
  order by coalesce(p.hidden, false), coalesce(p.active, true) desc, p.id desc;
$$;

create or replace function public.tpv_save_loyalty_promo(
  p_promo_id bigint default null,
  p_title text default '',
  p_description text default '',
  p_tag text default '',
  p_type text default 'redeem',
  p_pts_req integer default 0,
  p_expiry text default null,
  p_active boolean default true,
  p_hidden boolean default false
)
returns table (
  id bigint,
  title text,
  description text,
  tag text,
  type text,
  pts_req integer,
  expiry text,
  active boolean,
  hidden boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promo public.promos%rowtype;
begin
  if trim(coalesce(p_title, '')) = '' then
    raise exception 'El titulo de la promo es obligatorio';
  end if;

  if p_promo_id is null then
    insert into public.promos(title, description, tag, type, pts_req, expiry, active, hidden)
    values (
      trim(p_title),
      trim(coalesce(p_description, '')),
      trim(coalesce(p_tag, '')),
      coalesce(nullif(p_type, ''), 'redeem'),
      greatest(coalesce(p_pts_req, 0), 0),
      nullif(p_expiry, '')::date,
      coalesce(p_active, true),
      coalesce(p_hidden, false)
    )
    returning * into v_promo;
  else
    update public.promos p
    set title = trim(p_title),
        description = trim(coalesce(p_description, '')),
        tag = trim(coalesce(p_tag, '')),
        type = coalesce(nullif(p_type, ''), 'redeem'),
        pts_req = greatest(coalesce(p_pts_req, 0), 0),
        expiry = nullif(p_expiry, '')::date,
        active = coalesce(p_active, true),
        hidden = coalesce(p_hidden, false),
        updated_at = now()
    where p.id = p_promo_id
    returning * into v_promo;
  end if;

  if v_promo.id is null then
    raise exception 'Promo no encontrada';
  end if;

  return query select
    v_promo.id,
    v_promo.title::text,
    v_promo.description::text,
    v_promo.tag::text,
    v_promo.type::text,
    coalesce(v_promo.pts_req, 0),
    coalesce(v_promo.expiry::text, ''),
    coalesce(v_promo.active, true),
    coalesce(v_promo.hidden, false);
end;
$$;

create or replace function public.tpv_set_loyalty_promo_active(
  p_promo_id bigint,
  p_active boolean
)
returns table (
  id bigint,
  title text,
  description text,
  tag text,
  type text,
  pts_req integer,
  expiry text,
  active boolean,
  hidden boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promo public.promos%rowtype;
begin
  update public.promos p
  set active = coalesce(p_active, false),
      updated_at = now()
  where p.id = p_promo_id
  returning * into v_promo;

  if not found then
    raise exception 'Promo no encontrada';
  end if;

  return query select
    v_promo.id,
    v_promo.title::text,
    v_promo.description::text,
    v_promo.tag::text,
    v_promo.type::text,
    coalesce(v_promo.pts_req, 0),
    coalesce(v_promo.expiry::text, ''),
    coalesce(v_promo.active, true),
    coalesce(v_promo.hidden, false);
end;
$$;

create or replace function public.tpv_list_pending_loyalty_vouchers()
returns table (
  id bigint,
  code text,
  customer_id bigint,
  customer_name text,
  promo_id bigint,
  promo_title text,
  status text,
  pts_cost integer,
  redeemed_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    v.id,
    v.code::text,
    v.customer_id,
    c.name::text,
    v.promo_id,
    p.title::text,
    v.status::text,
    coalesce(v.pts_cost, 0),
    v.redeemed_at,
    v.expires_at,
    v.used_at
  from public.customer_vouchers v
  left join public.customers c on c.id = v.customer_id
  left join public.promos p on p.id = v.promo_id
  where v.status = 'pending'
  order by v.redeemed_at desc nulls last
  limit 100;
$$;

create or replace function public.tpv_update_loyalty_voucher_status(
  p_voucher_id bigint,
  p_status text
)
returns table (
  id bigint,
  code text,
  customer_id bigint,
  customer_name text,
  promo_id bigint,
  promo_title text,
  status text,
  pts_cost integer,
  redeemed_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher public.customer_vouchers%rowtype;
  v_customer public.customers%rowtype;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if v_status not in ('used', 'cancelled') then
    raise exception 'Estado de canje invalido';
  end if;

  select * into v_voucher
  from public.customer_vouchers v
  where v.id = p_voucher_id
  for update;

  if not found then
    raise exception 'Canje no encontrado';
  end if;

  if v_voucher.status <> 'pending' then
    raise exception 'El canje ya no esta pendiente';
  end if;

  if v_status = 'used' then
    update public.customer_vouchers v
    set status = 'used',
        used_at = now()
    where v.id = p_voucher_id
    returning * into v_voucher;
  else
    update public.customer_vouchers v
    set status = 'cancelled'
    where v.id = p_voucher_id
    returning * into v_voucher;

    update public.customers c
    set points = coalesce(c.points, 0) + coalesce(v_voucher.pts_cost, 0),
        tier = public.calcular_tier(coalesce(c.points, 0) + coalesce(v_voucher.pts_cost, 0)),
        updated_at = now()
    where c.id = v_voucher.customer_id
    returning * into v_customer;
  end if;

  return query
  select
    v.id,
    v.code::text,
    v.customer_id,
    c.name::text,
    v.promo_id,
    p.title::text,
    v.status::text,
    coalesce(v.pts_cost, 0),
    v.redeemed_at,
    v.expires_at,
    v.used_at
  from public.customer_vouchers v
  left join public.customers c on c.id = v.customer_id
  left join public.promos p on p.id = v.promo_id
  where v.id = p_voucher_id;
end;
$$;

revoke all on function public.tpv_get_loyalty_dashboard() from public;
revoke all on function public.tpv_search_loyalty_customers(text) from public;
revoke all on function public.tpv_get_loyalty_customer_purchases(bigint, integer) from public;
revoke all on function public.tpv_create_loyalty_customer(text, text, text, text) from public;
revoke all on function public.tpv_update_loyalty_customer(bigint, text, text, text, text, integer) from public;
revoke all on function public.tpv_list_loyalty_promos() from public;
revoke all on function public.tpv_save_loyalty_promo(bigint, text, text, text, text, integer, text, boolean, boolean) from public;
revoke all on function public.tpv_set_loyalty_promo_active(bigint, boolean) from public;
revoke all on function public.tpv_list_pending_loyalty_vouchers() from public;
revoke all on function public.tpv_update_loyalty_voucher_status(bigint, text) from public;

grant execute on function public.tpv_get_loyalty_dashboard() to anon, authenticated;
grant execute on function public.tpv_search_loyalty_customers(text) to anon, authenticated;
grant execute on function public.tpv_get_loyalty_customer_purchases(bigint, integer) to anon, authenticated;
grant execute on function public.tpv_create_loyalty_customer(text, text, text, text) to anon, authenticated;
grant execute on function public.tpv_update_loyalty_customer(bigint, text, text, text, text, integer) to anon, authenticated;
grant execute on function public.tpv_list_loyalty_promos() to anon, authenticated;
grant execute on function public.tpv_save_loyalty_promo(bigint, text, text, text, text, integer, text, boolean, boolean) to anon, authenticated;
grant execute on function public.tpv_set_loyalty_promo_active(bigint, boolean) to anon, authenticated;
grant execute on function public.tpv_list_pending_loyalty_vouchers() to anon, authenticated;
grant execute on function public.tpv_update_loyalty_voucher_status(bigint, text) to anon, authenticated;

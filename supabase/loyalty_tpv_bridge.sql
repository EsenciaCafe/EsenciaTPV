create or replace function public.tpv_calculate_loyalty_points(p_amount numeric, p_tier text)
returns integer
language sql
stable
set search_path = public
as $$
  select round(
    greatest(coalesce(p_amount, 0), 0) * 10 *
    case coalesce(p_tier, 'Bronze')
      when 'Silver' then 1.1
      when 'Gold' then 1.2
      when 'Platinum' then 1.3
      else 1.0
    end
  )::integer;
$$;

create or replace function public.tpv_find_loyalty_customer(p_rfid_uid text)
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
begin
  return query
  select
    c.id,
    c.name,
    c.email,
    c.phone,
    c.rfid_uid,
    coalesce(c.points, 0),
    coalesce(c.visits, 0),
    coalesce(c.total_spent, 0),
    coalesce(c.tier, public.calcular_tier(coalesce(c.points, 0)))
  from public.customers c
  where upper(trim(c.rfid_uid)) = upper(trim(p_rfid_uid))
  limit 1;
end;
$$;

create or replace function public.tpv_award_paid_loyalty_purchase(
  p_rfid_uid text,
  p_amount numeric
)
returns table (
  customer_id bigint,
  customer_name text,
  points integer,
  next_points integer,
  next_tier text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_amount numeric := round(greatest(coalesce(p_amount, 0), 0)::numeric, 2);
  v_points integer;
  v_next_points integer;
  v_next_tier text;
begin
  if v_amount <= 0 then
    raise exception 'Importe invalido';
  end if;

  select * into v_customer
  from public.customers
  where upper(trim(rfid_uid)) = upper(trim(p_rfid_uid))
  for update;

  if not found then
    raise exception 'Cliente no encontrado';
  end if;

  v_points := public.tpv_calculate_loyalty_points(v_amount, v_customer.tier);
  v_next_points := coalesce(v_customer.points, 0) + v_points;
  v_next_tier := public.calcular_tier(v_next_points);

  insert into public.purchases(customer_id, amount, points)
  values (v_customer.id, v_amount, v_points);

  update public.customers
  set points = v_next_points,
      tier = v_next_tier,
      visits = coalesce(visits, 0) + 1,
      total_spent = round((coalesce(total_spent, 0) + v_amount)::numeric, 2),
      updated_at = now()
  where id = v_customer.id;

  return query select v_customer.id, v_customer.name, v_points, v_next_points, v_next_tier;
end;
$$;

create or replace function public.tpv_award_manual_loyalty_points(
  p_rfid_uid text,
  p_amount numeric
)
returns table (
  customer_id bigint,
  customer_name text,
  points integer,
  next_points integer,
  next_tier text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_amount numeric := round(greatest(coalesce(p_amount, 0), 0)::numeric, 2);
  v_points integer;
  v_next_points integer;
  v_next_tier text;
begin
  if v_amount <= 0 then
    raise exception 'Importe invalido';
  end if;

  select * into v_customer
  from public.customers
  where upper(trim(rfid_uid)) = upper(trim(p_rfid_uid))
  for update;

  if not found then
    raise exception 'Cliente no encontrado';
  end if;

  v_points := public.tpv_calculate_loyalty_points(v_amount, v_customer.tier);
  v_next_points := coalesce(v_customer.points, 0) + v_points;
  v_next_tier := public.calcular_tier(v_next_points);

  update public.customers
  set points = v_next_points,
      tier = v_next_tier,
      updated_at = now()
  where id = v_customer.id;

  return query select v_customer.id, v_customer.name, v_points, v_next_points, v_next_tier;
end;
$$;

revoke all on function public.tpv_calculate_loyalty_points(numeric, text) from public;
revoke all on function public.tpv_find_loyalty_customer(text) from public;
revoke all on function public.tpv_award_paid_loyalty_purchase(text, numeric) from public;
revoke all on function public.tpv_award_manual_loyalty_points(text, numeric) from public;

grant execute on function public.tpv_calculate_loyalty_points(numeric, text) to anon, authenticated;
grant execute on function public.tpv_find_loyalty_customer(text) to anon, authenticated;
grant execute on function public.tpv_award_paid_loyalty_purchase(text, numeric) to anon, authenticated;
grant execute on function public.tpv_award_manual_loyalty_points(text, numeric) to anon, authenticated;

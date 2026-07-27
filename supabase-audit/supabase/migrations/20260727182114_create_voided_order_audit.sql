create table public.voided_orders (
  event_id text primary key,
  occurred_at timestamptz not null,
  business_date date generated always as (
    (occurred_at at time zone 'Atlantic/Canary')::date
  ) stored,
  order_name text not null,
  order_type text not null,
  staff_name text not null default '',
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  item_units numeric(12, 3) not null check (item_units > 0),
  created_at timestamptz not null default now(),
  constraint voided_orders_event_id_format
    check (event_id ~ '^EMPTY-[A-Za-z0-9-]{8,80}$')
);

create table public.voided_order_lines (
  id bigint generated always as identity primary key,
  event_id text not null references public.voided_orders(event_id) on delete cascade,
  line_index integer not null check (line_index >= 0),
  item_id text not null default '',
  product_key text not null,
  name text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  selected_options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (event_id, line_index)
);

create index voided_orders_business_date_idx
  on public.voided_orders (business_date);

create index voided_order_lines_event_id_idx
  on public.voided_order_lines (event_id);

create index voided_order_lines_item_id_idx
  on public.voided_order_lines (item_id)
  where item_id <> '';

create index voided_order_lines_product_key_idx
  on public.voided_order_lines (product_key);

alter table public.voided_orders enable row level security;
alter table public.voided_order_lines enable row level security;

revoke all on table public.voided_orders from anon, authenticated;
revoke all on table public.voided_order_lines from anon, authenticated;
revoke all on sequence public.voided_order_lines_id_seq from anon, authenticated;

grant select, insert on table public.voided_orders to service_role;
grant select, insert on table public.voided_order_lines to service_role;
grant usage, select on sequence public.voided_order_lines_id_seq to service_role;

create or replace function public.record_voided_order(p_event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_event_id text := p_event->>'eventId';
  v_occurred_at timestamptz := (p_event->>'occurredAt')::timestamptz;
  v_inserted integer := 0;
begin
  if jsonb_typeof(p_event) <> 'object'
    or jsonb_typeof(p_event->'items') <> 'array'
    or jsonb_array_length(p_event->'items') = 0
    or jsonb_array_length(p_event->'items') > 100
  then
    raise exception 'Invalid voided order payload';
  end if;

  insert into public.voided_orders (
    event_id,
    occurred_at,
    order_name,
    order_type,
    staff_name,
    total_amount,
    item_units
  )
  values (
    v_event_id,
    v_occurred_at,
    left(coalesce(p_event->>'orderName', 'Pedido'), 80),
    left(coalesce(p_event->>'orderType', 'direct'), 40),
    left(coalesce(p_event->>'staffName', ''), 80),
    (p_event->>'total')::numeric,
    (
      select sum((line.value->>'quantity')::numeric)
      from jsonb_array_elements(p_event->'items') as line(value)
    )
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    insert into public.voided_order_lines (
      event_id,
      line_index,
      item_id,
      product_key,
      name,
      quantity,
      total_amount,
      selected_options
    )
    select
      v_event_id,
      (line.ordinality - 1)::integer,
      left(coalesce(line.value->>'itemId', ''), 120),
      left(coalesce(line.value->>'productKey', ''), 180),
      left(coalesce(line.value->>'name', 'Artículo'), 120),
      (line.value->>'quantity')::numeric,
      (line.value->>'total')::numeric,
      case
        when jsonb_typeof(line.value->'selectedOptions') = 'array'
          then line.value->'selectedOptions'
        else '[]'::jsonb
      end
    from jsonb_array_elements(p_event->'items') with ordinality as line(value, ordinality);
  end if;

  return jsonb_build_object(
    'inserted', v_inserted = 1,
    'eventId', v_event_id,
    'businessDate', (v_occurred_at at time zone 'Atlantic/Canary')::date
  );
end;
$$;

revoke all on function public.record_voided_order(jsonb) from public, anon, authenticated;
grant execute on function public.record_voided_order(jsonb) to service_role;

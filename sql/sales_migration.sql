-- ============================================================
-- sales_migration.sql - Ventas normalizadas para TPV
-- Ejecutar en Supabase SQL Editor antes de usar el nuevo flujo.
-- ============================================================

create table if not exists sales (
  id              text primary key,
  type            text not null default 'sale' check (type in ('sale', 'refund')),
  parent_sale_id  text references sales(id),
  table_name      text,
  total_amount    numeric(10,2) not null default 0.00,
  payment_method  text not null,
  items_count     integer not null default 0,
  receipt_token   text,
  staff_id        text,
  staff_name      text,
  opened_at       timestamptz,
  closed_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  legal_data      jsonb not null default '{}',
  loyalty_data    jsonb not null default '{}',
  refund_amount   numeric(10,2) not null default 0.00,
  refund_reason   text,
  has_refund      boolean not null default false,
  payload         jsonb not null default '{}'
);

create index if not exists sales_closed_at_idx on sales (closed_at desc);
create index if not exists sales_type_idx on sales (type);
create index if not exists sales_parent_sale_id_idx on sales (parent_sale_id);

create table if not exists sale_lines (
  id               text primary key,
  sale_id          text not null references sales(id) on delete cascade,
  item_id          text,
  ticket_item_id   text,
  name             text not null,
  quantity         numeric(10,3) not null default 1,
  unit_price       numeric(10,2) not null default 0.00,
  total_amount     numeric(10,2) not null default 0.00,
  selected_options jsonb not null default '[]',
  raw_payload      jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

create index if not exists sale_lines_sale_id_idx on sale_lines (sale_id);
create index if not exists sale_lines_item_id_idx on sale_lines (item_id);

create table if not exists sale_payments (
  id             text primary key,
  sale_id        text not null references sales(id) on delete cascade,
  method         text not null,
  amount         numeric(10,2) not null default 0.00,
  provider       text,
  external_ref   text,
  raw_payload    jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create index if not exists sale_payments_sale_id_idx on sale_payments (sale_id);
create index if not exists sale_payments_method_idx on sale_payments (method);

alter table if exists sales disable row level security;
alter table if exists sale_lines disable row level security;
alter table if exists sale_payments disable row level security;

grant all on sales to anon;
grant all on sale_lines to anon;
grant all on sale_payments to anon;
grant all on sales to authenticated;
grant all on sale_lines to authenticated;
grant all on sale_payments to authenticated;

-- ============================================================
-- schema.sql — Esquema de la base de datos del TPV
-- Ejecutar en: Supabase → SQL Editor
-- ============================================================

-- Categorías (principales y subcategorías)
create table if not exists categories (
  id        text primary key,
  name      text not null,
  type      text not null check (type in ('category', 'subcategory')),
  parent_id text references categories(id) on delete cascade
);

-- Artículos del catálogo
create table if not exists menu_items (
  id        text primary key,
  name      text not null,
  price     numeric(10,2) not null default 0.00,
  category  text references categories(id) on delete set null,
  image     text,
  modifiers text[] default '{}'
);

-- Grupos de modificadores (ej: "Tipo de leche")
create table if not exists modifiers (
  id             text primary key,
  name           text not null,
  assigned_items text[] default '{}'
);

-- Opciones de cada modificador (ej: "Leche de Avena +1.00€")
create table if not exists modifier_options (
  id          text primary key,
  modifier_id text not null references modifiers(id) on delete cascade,
  name        text not null,
  price       numeric(10,2) not null default 0.00,
  allow_multiple boolean not null default false
);

-- Grid de atajos rápidos (un registro por nivel: 'root', 'drinks', etc.)
create table if not exists grid_items (
  grid_key text primary key,
  slots    jsonb not null default '[]'
);

-- Estado del TPV en tiempo real
create table if not exists tpv_state (
  id           text primary key,
  tables       jsonb not null default '[]',
  direct_sale  jsonb not null default '{}',
  transactions jsonb not null default '[]',
  legal_data   jsonb not null default '{}',
  role_permissions jsonb,
  updated_at   timestamptz default now()
);

-- Asegurar columna legal_data si la tabla ya existía
alter table tpv_state add column if not exists legal_data jsonb not null default '{}';
alter table tpv_state add column if not exists role_permissions jsonb;

-- Tickets públicos accesibles por token para QR
create table if not exists receipt_tickets (
  token          text primary key,
  transaction_id text not null,
  payload        jsonb not null,
  created_at     timestamptz default now()
);

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

create table if not exists cash_closures (
  id               text primary key,
  business_date    date not null,
  shift_number     integer not null default 1,
  shift_start_at   timestamptz,
  opening_cash     numeric(10,2) not null default 0.00,
  expected_cash    numeric(10,2) not null default 0.00,
  counted_cash     numeric(10,2) not null default 0.00,
  cash_difference  numeric(10,2) not null default 0.00,
  expected_card    numeric(10,2) not null default 0.00,
  bbva_total       numeric(10,2) not null default 0.00,
  card_difference  numeric(10,2) not null default 0.00,
  total_sales      numeric(10,2) not null default 0.00,
  total_refunds    numeric(10,2) not null default 0.00,
  transactions_count integer not null default 0,
  staff_id         text,
  staff_name       text,
  notes            text,
  payload          jsonb not null default '{}',
  closed_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists cash_closures_business_date_idx on cash_closures (business_date desc);
create unique index if not exists cash_closures_business_date_shift_idx on cash_closures (business_date, shift_number);
create index if not exists cash_closures_closed_at_idx on cash_closures (closed_at desc);

-- Perfiles de personal y roles de acceso
create table if not exists staff_profiles (
  id           text primary key,
  display_name text not null,
  role         text not null default 'staff' check (role in ('admin', 'manager', 'staff')),
  pin_code     text not null unique check (pin_code ~ '^[0-9]{4,8}$'),
  active       boolean not null default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

insert into staff_profiles (id, display_name, role, pin_code, active)
values ('admin-default', 'Administrador', 'admin', '0000', true)
on conflict (id) do nothing;

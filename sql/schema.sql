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
  price       numeric(10,2) not null default 0.00
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
  updated_at   timestamptz default now()
);

-- Asegurar columna legal_data si la tabla ya existía
alter table tpv_state add column if not exists legal_data jsonb not null default '{}';

-- Tickets públicos accesibles por token para QR
create table if not exists receipt_tickets (
  token          text primary key,
  transaction_id text not null,
  payload        jsonb not null,
  created_at     timestamptz default now()
);

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

-- Facturas de proveedor / compras para control contable
create table if not exists supplier_invoices (
  id             text primary key,
  supplier_name  text not null,
  invoice_number text,
  invoice_date   date not null,
  category       text,
  base_amount    numeric(10,2) not null default 0.00,
  tax_rate       numeric(5,2) not null default 0.00,
  tax_amount     numeric(10,2) not null default 0.00,
  total_amount   numeric(10,2) not null default 0.00,
  deductible     boolean not null default true,
  status         text not null default 'pending_review' check (status in ('pending_review', 'confirmed', 'ignored')),
  source         text not null default 'manual' check (source in ('manual', 'drive', 'gmail')),
  source_id      text,
  sender_email   text,
  file_name      text,
  file_url       text,
  notes          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table supplier_invoices add column if not exists source_id text;
alter table supplier_invoices add column if not exists sender_email text;
alter table supplier_invoices add column if not exists file_name text;
alter table supplier_invoices add column if not exists file_url text;

create unique index if not exists supplier_invoices_source_id_idx
on supplier_invoices (source_id)
where source_id is not null;

create table if not exists supplier_sender_rules (
  email      text primary key,
  label      text,
  ignored    boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

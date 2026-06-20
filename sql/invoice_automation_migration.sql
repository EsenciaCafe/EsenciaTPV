-- ============================================================
-- invoice_automation_migration.sql
-- Ejecutar en Supabase SQL Editor si ya existia supplier_invoices
-- antes de activar la automatizacion de Drive/Gmail.
-- ============================================================

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

alter table if exists supplier_sender_rules disable row level security;
grant all on supplier_sender_rules to anon;
grant all on supplier_sender_rules to authenticated;

alter table if exists supplier_invoices disable row level security;
grant all on supplier_invoices to anon;
grant all on supplier_invoices to authenticated;

create table if not exists supplier_invoice_lines (
  id             text primary key,
  invoice_id     text not null references supplier_invoices(id) on delete cascade,
  supplier_name  text,
  invoice_date   date,
  description    text not null,
  quantity       numeric(10,3),
  unit_price     numeric(10,4),
  total_amount   numeric(10,2),
  tax_rate       numeric(5,2),
  raw_payload    jsonb not null default '{}',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists supplier_invoice_lines_invoice_id_idx
on supplier_invoice_lines (invoice_id);

create index if not exists supplier_invoice_lines_lookup_idx
on supplier_invoice_lines (supplier_name, description, invoice_date);

alter table if exists supplier_invoice_lines disable row level security;
grant all on supplier_invoice_lines to anon;
grant all on supplier_invoice_lines to authenticated;

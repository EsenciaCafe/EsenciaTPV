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

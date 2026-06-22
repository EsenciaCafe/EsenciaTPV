-- ============================================================
-- cash_closures_migration.sql - Cierres de caja y conciliacion BBVA
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

create table if not exists cash_closures (
  id               text primary key,
  business_date    date not null unique,
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

alter table if exists cash_closures disable row level security;
grant all on cash_closures to anon;
grant all on cash_closures to authenticated;

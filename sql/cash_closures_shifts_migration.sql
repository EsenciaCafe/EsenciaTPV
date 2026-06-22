-- ============================================================
-- cash_closures_shifts_migration.sql - Varios cierres por dia
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

alter table if exists cash_closures
  add column if not exists shift_number integer not null default 1;

alter table if exists cash_closures
  add column if not exists shift_start_at timestamptz;

alter table if exists cash_closures
  drop constraint if exists cash_closures_business_date_key;

drop index if exists cash_closures_business_date_key;

create unique index if not exists cash_closures_business_date_shift_idx
on cash_closures (business_date, shift_number);

create index if not exists cash_closures_closed_at_idx
on cash_closures (closed_at desc);

alter table if exists tpv_state
  add column if not exists role_permissions jsonb;

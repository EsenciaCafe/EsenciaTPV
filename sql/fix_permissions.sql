-- ============================================================
-- fix_permissions.sql — Permisos para el cliente anónimo
-- 
-- Supabase activa RLS (Row Level Security) por defecto, lo que
-- bloquea TODAS las escrituras desde el cliente anónimo.
-- Ejecuta este script en: Supabase → SQL Editor
-- ============================================================

-- Deshabilitar RLS en todas las tablas del catálogo
-- (apropiado para desarrollo; añadir políticas en producción)
alter table if exists categories        disable row level security;
alter table if exists menu_items        disable row level security;
alter table if exists modifiers         disable row level security;
alter table if exists modifier_options  disable row level security;
alter table if exists grid_items        disable row level security;

-- También otorgar permisos explícitos al rol anon
grant all on categories        to anon;
grant all on menu_items        to anon;
grant all on modifiers         to anon;
grant all on modifier_options  to anon;
grant all on grid_items        to anon;
grant all on categories        to authenticated;
grant all on menu_items        to authenticated;
grant all on modifiers         to authenticated;
grant all on modifier_options  to authenticated;
grant all on grid_items        to authenticated;

-- Verificar que las tablas existen y tienen datos
select 'categories'     as tabla, count(*) as filas from categories
union all
select 'menu_items',    count(*) from menu_items
union all
select 'modifiers',     count(*) from modifiers
union all
select 'modifier_options', count(*) from modifier_options
union all
select 'grid_items',    count(*) from grid_items;

-- Deshabilitar RLS y dar permisos para el estado del TPV
alter table if exists tpv_state add column if not exists legal_data jsonb not null default '{}';
alter table if exists tpv_state disable row level security;
grant all on tpv_state to anon;
grant all on tpv_state to authenticated;

-- Permisos para tickets públicos por QR
alter table if exists receipt_tickets disable row level security;
grant all on receipt_tickets to anon;
grant all on receipt_tickets to authenticated;

-- Perfiles de personal por PIN
alter table if exists staff_profiles disable row level security;
grant all on staff_profiles to anon;
grant all on staff_profiles to authenticated;

-- Facturas de proveedor / compras
alter table if exists supplier_invoices disable row level security;
grant all on supplier_invoices to anon;
grant all on supplier_invoices to authenticated;

-- Habilitar tiempo real para esta tabla de forma segura

do $$
begin
  -- Asegurar que la publicación existe
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  
  -- Intentar añadir la tabla a la publicación (ignorar si ya es miembro)
  begin
    alter publication supabase_realtime add table tpv_state;
  exception
    when duplicate_object then
      null; -- ya es miembro
  end;
end $$;

-- Modificar restricción de longitud del PIN (4 a 8 dígitos)
alter table staff_profiles drop constraint if exists staff_profiles_pin_code_check;
alter table staff_profiles add constraint staff_profiles_pin_code_check check (pin_code ~ '^[0-9]{4,8}$');

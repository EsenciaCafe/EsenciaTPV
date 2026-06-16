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

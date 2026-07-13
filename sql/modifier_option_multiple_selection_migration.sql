-- Permite decidir, opción por opción, si se puede seleccionar más de una unidad.
-- Las opciones existentes conservan el comportamiento múltiple que tenían antes.
alter table public.modifier_options
  add column if not exists allow_multiple boolean;

update public.modifier_options
set allow_multiple = true
where allow_multiple is null;

alter table public.modifier_options
  alter column allow_multiple set default false,
  alter column allow_multiple set not null;

notify pgrst, 'reload schema';

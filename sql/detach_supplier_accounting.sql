-- Conserva los datos historicos, pero impide que el cliente del TPV acceda
-- a las tablas contables trasladadas a la aplicacion fiscal.
--
-- Ejecutar una sola vez en Supabase despues de:
-- 1. Desactivar el trigger runInvoiceQueueImport de Google Apps Script.
-- 2. Confirmar que la aplicacion fiscal ya conserva o migro estos datos.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'supplier_invoice_lines',
    'supplier_sender_rules',
    'supplier_invoices'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('revoke all privileges on table public.%I from anon', table_name);
      execute format('revoke all privileges on table public.%I from authenticated', table_name);
      execute format('alter table public.%I enable row level security', table_name);
    end if;
  end loop;
end
$$;

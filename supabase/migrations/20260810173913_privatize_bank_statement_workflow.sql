alter function public.accounting_set_bank_import_period(text, date, date)
  set schema accounting_private;
alter function public.accounting_undo_bank_import(text)
  set schema accounting_private;

alter function accounting_private.accounting_set_bank_import_period(text, date, date)
  security definer;
alter function accounting_private.accounting_undo_bank_import(text)
  security definer;

revoke all on all functions in schema accounting_private from public;
grant usage on schema accounting_private to anon;
grant execute on function accounting_private.current_business_id() to anon;
grant execute on function accounting_private.accounting_set_bank_import_period(text, date, date) to anon;
grant execute on function accounting_private.accounting_undo_bank_import(text) to anon;

create function public.accounting_set_bank_import_period(
  p_import_batch text,
  p_start date,
  p_end date
)
returns jsonb
language sql
security invoker
set search_path = public, accounting_private
as $$
  select accounting_private.accounting_set_bank_import_period(p_import_batch, p_start, p_end)
$$;

create function public.accounting_undo_bank_import(p_import_batch text)
returns jsonb
language sql
security invoker
set search_path = public, accounting_private
as $$
  select accounting_private.accounting_undo_bank_import(p_import_batch)
$$;

revoke all on function public.accounting_set_bank_import_period(text, date, date) from public, authenticated;
revoke all on function public.accounting_undo_bank_import(text) from public, authenticated;
grant execute on function public.accounting_set_bank_import_period(text, date, date) to anon;
grant execute on function public.accounting_undo_bank_import(text) to anon;

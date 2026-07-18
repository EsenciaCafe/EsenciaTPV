-- Enable normalized sales events for every TPV device.
-- Safe to run more than once in the Supabase SQL editor.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sales'
  ) then
    alter publication supabase_realtime add table public.sales;
  end if;
end
$$;

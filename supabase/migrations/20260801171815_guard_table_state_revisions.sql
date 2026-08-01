create table if not exists public.tpv_state_incident_backups (
  backup_id bigint generated always as identity primary key,
  captured_at timestamptz not null default clock_timestamp(),
  reason text not null,
  state jsonb not null
);

alter table public.tpv_state_incident_backups enable row level security;
revoke all on table public.tpv_state_incident_backups from anon, authenticated;

insert into public.tpv_state_incident_backups (reason, state)
select
  'Respaldo previo a protección de concurrencia de mesas 2026-08-01',
  to_jsonb(state_row)
from public.tpv_state as state_row
where state_row.id = 'global';

update public.tpv_state
set
  tables = coalesce((
    select jsonb_agg(
      (table_row - 'syncRevision' - 'syncUpdatedAt' - 'syncClientId') ||
      jsonb_build_object(
        'syncRevision', 1,
        'syncUpdatedAt', clock_timestamp(),
        'syncClientId', 'server-migration'
      )
      order by table_position
    )
    from jsonb_array_elements(tables) with ordinality as source(table_row, table_position)
  ), '[]'::jsonb),
  updated_at = clock_timestamp()
where id = 'global';

create or replace function public.guard_tpv_table_revisions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  incoming_table jsonb;
  previous_table jsonb;
  protected_table jsonb;
  guarded_tables jsonb := '[]'::jsonb;
  table_id text;
  previous_revision bigint;
  incoming_revision bigint;
begin
  if new.tables is null or jsonb_typeof(new.tables) <> 'array' then
    new.tables := old.tables;
    new.updated_at := clock_timestamp();
    return new;
  end if;

  for incoming_table in
    select value from jsonb_array_elements(new.tables)
  loop
    table_id := incoming_table ->> 'id';
    previous_table := null;

    select value
    into previous_table
    from jsonb_array_elements(coalesce(old.tables, '[]'::jsonb))
    where value ->> 'id' = table_id
    limit 1;

    if previous_table is null then
      protected_table :=
        (incoming_table - 'syncRevision' - 'syncUpdatedAt') ||
        jsonb_build_object(
          'syncRevision', 1,
          'syncUpdatedAt', clock_timestamp(),
          'syncClientId', coalesce(incoming_table ->> 'syncClientId', 'unknown-client')
        );
    elsif
      (incoming_table - 'syncRevision' - 'syncUpdatedAt' - 'syncClientId') =
      (previous_table - 'syncRevision' - 'syncUpdatedAt' - 'syncClientId')
    then
      protected_table := previous_table;
    else
      previous_revision := coalesce(nullif(previous_table ->> 'syncRevision', '')::bigint, 0);
      incoming_revision := coalesce(nullif(incoming_table ->> 'syncRevision', '')::bigint, 0);

      if incoming_revision = previous_revision then
        protected_table :=
          (incoming_table - 'syncRevision' - 'syncUpdatedAt') ||
          jsonb_build_object(
            'syncRevision', previous_revision + 1,
            'syncUpdatedAt', clock_timestamp(),
            'syncClientId', coalesce(incoming_table ->> 'syncClientId', 'unknown-client')
          );
      else
        protected_table := previous_table;
      end if;
    end if;

    guarded_tables := guarded_tables || jsonb_build_array(protected_table);
  end loop;

  for previous_table in
    select value from jsonb_array_elements(coalesce(old.tables, '[]'::jsonb))
  loop
    if not exists (
      select 1
      from jsonb_array_elements(new.tables)
      where value ->> 'id' = previous_table ->> 'id'
    ) then
      guarded_tables := guarded_tables || jsonb_build_array(previous_table);
    end if;
  end loop;

  new.tables := guarded_tables;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists guard_tpv_table_revisions_before_update on public.tpv_state;
create trigger guard_tpv_table_revisions_before_update
before update of tables on public.tpv_state
for each row
execute function public.guard_tpv_table_revisions();

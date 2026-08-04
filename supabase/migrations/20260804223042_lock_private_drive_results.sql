alter table public.accounting_drive_sources
  add column if not exists result_folder_locked_at timestamptz,
  add column if not exists result_folder_privacy_status text not null default 'unverified',
  add column if not exists result_folder_verified_at timestamptz,
  add column if not exists result_folder_owner_email text;

alter table public.accounting_drive_sources
  drop constraint if exists accounting_drive_sources_result_privacy_check;

alter table public.accounting_drive_sources
  add constraint accounting_drive_sources_result_privacy_check
  check (result_folder_privacy_status in ('unverified', 'private', 'shared', 'unknown'));

update public.accounting_drive_sources
set result_folder_locked_at = coalesce(result_folder_locked_at, created_at, now()),
    result_folder_privacy_status = 'unverified',
    result_folder_verified_at = null
where nullif(btrim(result_folder_id), '') is not null;

create or replace function accounting_private.prevent_drive_result_folder_change()
returns trigger
language plpgsql
set search_path = public, accounting_private
as $$
begin
  if old.result_folder_locked_at is not null then
    if new.result_folder_id is distinct from old.result_folder_id then
      raise exception 'La carpeta privada de resultados está bloqueada y no puede cambiarse';
    end if;
    if new.result_folder_locked_at is distinct from old.result_folder_locked_at then
      raise exception 'No se puede desbloquear la carpeta privada de resultados';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists accounting_drive_result_folder_immutable on public.accounting_drive_sources;
create trigger accounting_drive_result_folder_immutable
before update of result_folder_id, result_folder_locked_at on public.accounting_drive_sources
for each row execute function accounting_private.prevent_drive_result_folder_change();

create or replace function public.accounting_set_drive_source_folder(p_source_folder_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_source_id text := btrim(coalesce(p_source_folder_id, ''));
  v_source public.accounting_drive_sources%rowtype;
begin
  if v_business is null then raise exception 'Sesión contable no válida'; end if;
  if v_source_id !~ '^[A-Za-z0-9_-]{10,200}$' then
    raise exception 'El identificador de la carpeta de facturas no es válido';
  end if;

  insert into public.accounting_drive_sources(business_id, source_folder_id)
  values (v_business, v_source_id)
  on conflict (business_id) do update
    set source_folder_id = excluded.source_folder_id,
        updated_at = now()
  returning * into v_source;

  insert into public.accounting_audit_log(business_id, event_type, entity_type, entity_id, metadata)
  values (
    v_business,
    'drive_source_folder_changed',
    'drive_source',
    v_source.id::text,
    jsonb_build_object('source_folder_id', v_source_id)
  );

  return jsonb_build_object(
    'id', v_source.id,
    'source_folder_id', v_source.source_folder_id,
    'result_folder_id', v_source.result_folder_id
  );
end;
$$;

create or replace function public.accounting_lock_drive_result_folder(
  p_result_folder_id text,
  p_owner_email text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_result_id text := btrim(coalesce(p_result_folder_id, ''));
  v_source public.accounting_drive_sources%rowtype;
begin
  if v_business is null then raise exception 'Sesión contable no válida'; end if;
  if v_result_id !~ '^[A-Za-z0-9_-]{10,200}$' then
    raise exception 'El identificador de la carpeta de resultados no es válido';
  end if;

  select * into v_source
  from public.accounting_drive_sources
  where business_id = v_business
  for update;

  if not found then
    insert into public.accounting_drive_sources(
      business_id, result_folder_id, result_folder_locked_at,
      result_folder_privacy_status, result_folder_verified_at, result_folder_owner_email
    ) values (
      v_business, v_result_id, now(), 'private', now(), nullif(btrim(p_owner_email), '')
    ) returning * into v_source;
  elsif nullif(btrim(v_source.result_folder_id), '') is not null then
    if v_source.result_folder_id <> v_result_id then
      raise exception 'Ya existe una carpeta privada de resultados bloqueada';
    end if;
    update public.accounting_drive_sources
    set result_folder_locked_at = coalesce(result_folder_locked_at, now()),
        result_folder_privacy_status = 'private',
        result_folder_verified_at = now(),
        result_folder_owner_email = nullif(btrim(p_owner_email), ''),
        updated_at = now()
    where id = v_source.id
    returning * into v_source;
  else
    update public.accounting_drive_sources
    set result_folder_id = v_result_id,
        result_folder_locked_at = now(),
        result_folder_privacy_status = 'private',
        result_folder_verified_at = now(),
        result_folder_owner_email = nullif(btrim(p_owner_email), ''),
        updated_at = now()
    where id = v_source.id
    returning * into v_source;
  end if;

  insert into public.accounting_audit_log(business_id, event_type, entity_type, entity_id, metadata)
  values (
    v_business,
    'drive_result_folder_locked',
    'drive_source',
    v_source.id::text,
    jsonb_build_object('result_folder_id', v_result_id, 'privacy_status', 'private')
  );

  return jsonb_build_object('id', v_source.id, 'result_folder_id', v_source.result_folder_id);
end;
$$;

create or replace function public.accounting_verify_drive_result_folder(
  p_result_folder_id text,
  p_privacy_status text,
  p_owner_email text default ''
)
returns void
language plpgsql
security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_status text := btrim(coalesce(p_privacy_status, ''));
  v_source_id uuid;
begin
  if v_business is null then raise exception 'Sesión contable no válida'; end if;
  if v_status not in ('private', 'shared', 'unknown') then
    raise exception 'Estado de privacidad no válido';
  end if;

  update public.accounting_drive_sources
  set result_folder_privacy_status = v_status,
      result_folder_verified_at = now(),
      result_folder_owner_email = nullif(btrim(p_owner_email), ''),
      updated_at = now()
  where business_id = v_business
    and result_folder_id = btrim(coalesce(p_result_folder_id, ''))
  returning id into v_source_id;

  if v_source_id is null then raise exception 'La carpeta comprobada no coincide con el historial fijo'; end if;

  insert into public.accounting_audit_log(business_id, event_type, entity_type, entity_id, metadata)
  values (
    v_business,
    'drive_result_folder_privacy_checked',
    'drive_source',
    v_source_id::text,
    jsonb_build_object('result_folder_id', p_result_folder_id, 'privacy_status', v_status)
  );
end;
$$;

revoke all on function public.accounting_set_drive_source_folder(text) from public;
revoke all on function public.accounting_lock_drive_result_folder(text, text) from public;
revoke all on function public.accounting_verify_drive_result_folder(text, text, text) from public;
grant execute on function public.accounting_set_drive_source_folder(text) to anon;
grant execute on function public.accounting_lock_drive_result_folder(text, text) to anon;
grant execute on function public.accounting_verify_drive_result_folder(text, text, text) to anon;

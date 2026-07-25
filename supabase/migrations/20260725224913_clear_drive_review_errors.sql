create or replace function public.accounting_save_drive_review(
  p_import_id uuid,
  p_document jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, accounting_private, extensions, pg_catalog
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_import public.accounting_drive_imports%rowtype;
  v_document_id uuid;
begin
  if v_business is null then
    raise exception 'Sesion contable no valida';
  end if;

  select * into v_import
  from public.accounting_drive_imports
  where id = p_import_id and business_id = v_business
  for update;
  if v_import.id is null then
    raise exception 'Analisis pendiente no encontrado';
  end if;

  if v_import.document_id is null then
    v_document_id := public.accounting_save_document_with_lines(null, p_document, p_lines);
  else
    v_document_id := public.accounting_save_document_with_lines(v_import.document_id, p_document, p_lines);
  end if;

  update public.bookkeeping_documents
  set status = 'needs_review',
      attachment_url = coalesce(nullif(btrim(p_document->>'attachment_url'), ''), attachment_url),
      source_payload = coalesce(p_document->'source_payload', source_payload),
      updated_at = now()
  where id = v_document_id and business_id = v_business;

  update public.accounting_drive_imports
  set status = 'pending',
      document_id = v_document_id,
      error_message = null,
      processed_at = now()
  where id = v_import.id and business_id = v_business;

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business,
    'drive_document_review_saved',
    'bookkeeping_document',
    v_document_id::text,
    jsonb_build_object('drive_import_id', v_import.id, 'drive_file_id', v_import.drive_file_id)
  );

  return v_document_id;
end;
$$;

revoke all on function public.accounting_save_drive_review(uuid, jsonb, jsonb) from public;
grant execute on function public.accounting_save_drive_review(uuid, jsonb, jsonb) to anon, authenticated;

update public.accounting_drive_imports
set error_message = null,
    processed_at = coalesce(processed_at, now())
where status = 'pending'
  and document_id is not null
  and error_message is not null;

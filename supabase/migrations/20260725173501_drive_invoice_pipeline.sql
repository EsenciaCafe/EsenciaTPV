create unique index if not exists accounting_drive_sources_business_idx
  on public.accounting_drive_sources (business_id);

create index if not exists accounting_drive_imports_status_idx
  on public.accounting_drive_imports (business_id, status, created_at desc);

create index if not exists accounting_drive_imports_document_id_idx
  on public.accounting_drive_imports (document_id)
  where document_id is not null;

create or replace function public.accounting_import_supplier_document(
  p_payload jsonb,
  p_result_file_id text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_drive_file_id text;
  v_revision text;
  v_checksum text;
  v_schema_version text;
  v_supplier_name text;
  v_supplier_tax_id text;
  v_invoice_number text;
  v_issue_date date;
  v_due_date date;
  v_currency text;
  v_document_type text;
  v_payment_method text;
  v_subtotal numeric(12,2);
  v_tax_amount numeric(12,2);
  v_withholding numeric(12,2);
  v_total numeric(12,2);
  v_lines_subtotal numeric := 0;
  v_lines_tax numeric := 0;
  v_lines_withholding numeric := 0;
  v_contact_id uuid;
  v_document_id uuid;
  v_existing_document_id uuid;
  v_line jsonb;
  v_confidence record;
  v_low_confidence boolean := false;
  v_position integer := 0;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_base numeric;
  v_line_rate numeric;
  v_line_tax numeric;
  v_line_withholding numeric;
  v_tax_scope text;
begin
  if v_business is null then
    raise exception 'Sesion contable no valida';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'El resultado no es un objeto JSON';
  end if;

  v_schema_version := p_payload->>'schema_version';
  if v_schema_version is distinct from 'supplier-document/v1' then
    raise exception 'Version de contrato no compatible: %', coalesce(v_schema_version, 'sin version');
  end if;

  v_drive_file_id := nullif(btrim(p_payload->>'drive_file_id'), '');
  v_checksum := nullif(btrim(p_payload->>'checksum'), '');
  v_revision := coalesce(
    nullif(btrim(p_payload->>'drive_revision'), ''),
    v_checksum,
    'v1'
  );
  v_supplier_name := nullif(btrim(p_payload#>>'{supplier,name}'), '');
  v_supplier_tax_id := upper(regexp_replace(coalesce(p_payload#>>'{supplier,tax_id}', ''), '[^A-Za-z0-9]', '', 'g'));
  v_invoice_number := btrim(coalesce(p_payload#>>'{invoice,number}', ''));
  v_currency := upper(coalesce(nullif(btrim(p_payload#>>'{invoice,currency}'), ''), 'EUR'));
  v_document_type := coalesce(nullif(btrim(p_payload#>>'{invoice,document_type}'), ''), 'invoice');
  v_payment_method := nullif(btrim(p_payload#>>'{invoice,payment_method}'), '');

  if v_drive_file_id is null then raise exception 'Falta drive_file_id'; end if;
  if v_supplier_name is null then raise exception 'Falta supplier.name'; end if;
  if coalesce(p_payload#>>'{invoice,issue_date}', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'invoice.issue_date no es una fecha ISO valida';
  end if;
  v_issue_date := (p_payload#>>'{invoice,issue_date}')::date;
  if nullif(p_payload#>>'{invoice,due_date}', '') is not null then
    if (p_payload#>>'{invoice,due_date}') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'invoice.due_date no es una fecha ISO valida';
    end if;
    v_due_date := (p_payload#>>'{invoice,due_date}')::date;
  end if;
  if v_currency <> 'EUR' then raise exception 'Solo se admite moneda EUR en esta version'; end if;
  if v_document_type not in ('invoice', 'ticket', 'expense', 'payroll', 'asset', 'credit_note') then
    raise exception 'Tipo de documento no compatible: %', v_document_type;
  end if;
  if jsonb_typeof(p_payload->'supplier') is distinct from 'object' then raise exception 'supplier debe ser un objeto'; end if;
  if jsonb_typeof(p_payload->'invoice') is distinct from 'object' then raise exception 'invoice debe ser un objeto'; end if;
  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'lines debe contener al menos una linea';
  end if;
  if jsonb_typeof(p_payload->'totals') is distinct from 'object' then raise exception 'Falta totals'; end if;

  begin
    v_subtotal := (p_payload#>>'{totals,taxable_base}')::numeric;
    v_tax_amount := (p_payload#>>'{totals,tax_amount}')::numeric;
    v_withholding := coalesce(nullif(p_payload#>>'{totals,withholding_amount}', '')::numeric, 0);
    v_total := (p_payload#>>'{totals,total}')::numeric;
  exception when others then
    raise exception 'Los totales deben ser numericos';
  end;
  if v_subtotal is null or v_tax_amount is null or v_total is null then
    raise exception 'Faltan totals.taxable_base, totals.tax_amount o totals.total';
  end if;

  for v_line in select value from jsonb_array_elements(p_payload->'lines')
  loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'Cada linea debe ser un objeto'; end if;
    if nullif(btrim(v_line->>'description'), '') is null then raise exception 'Cada linea necesita description'; end if;
    begin
      v_quantity := coalesce(nullif(v_line->>'quantity', '')::numeric, 1);
      v_line_base := (v_line->>'taxable_base')::numeric;
      v_line_rate := (v_line->>'tax_rate')::numeric;
      v_line_tax := (v_line->>'tax_amount')::numeric;
      v_line_withholding := coalesce(nullif(v_line->>'withholding_amount', '')::numeric, 0);
      v_unit_price := coalesce(
        nullif(v_line->>'unit_price', '')::numeric,
        case when v_quantity <> 0 then v_line_base / v_quantity else 0 end
      );
    exception when others then
      raise exception 'Los importes de cada linea deben ser numericos';
    end;
    if v_quantity is null or v_line_base is null or v_line_rate is null
      or v_line_tax is null or v_line_withholding is null
    then
      raise exception 'Faltan importes obligatorios en una linea';
    end if;
    if v_quantity = 0 then raise exception 'La cantidad de una linea no puede ser cero'; end if;
    v_tax_scope := coalesce(nullif(v_line->>'tax_scope', ''), 'taxable');
    if v_tax_scope not in ('taxable', 'exempt', 'not_subject') then
      raise exception 'tax_scope no compatible: %', v_tax_scope;
    end if;
    if v_line_rate not in (0, 3, 7, 9.5, 15) then
      raise exception 'Tipo IGIC no compatible: %', v_line_rate;
    end if;
    if v_tax_scope in ('exempt', 'not_subject') and (v_line_rate <> 0 or v_line_tax <> 0) then
      raise exception 'Las lineas exentas o no sujetas deben tener tipo y cuota cero';
    end if;
    if v_tax_scope = 'taxable' and abs(round(v_line_base * v_line_rate / 100, 2) - v_line_tax) > 0.02 then
      raise exception 'La cuota IGIC de una linea no coincide con su base y tipo';
    end if;
    v_lines_subtotal := v_lines_subtotal + v_line_base;
    v_lines_tax := v_lines_tax + v_line_tax;
    v_lines_withholding := v_lines_withholding + v_line_withholding;
  end loop;

  if abs(v_lines_subtotal - v_subtotal) > 0.02 then
    raise exception 'La suma de bases no coincide con totals.taxable_base';
  end if;
  if abs(v_lines_tax - v_tax_amount) > 0.02 then
    raise exception 'La suma de impuestos no coincide con totals.tax_amount';
  end if;
  if abs(v_lines_withholding - v_withholding) > 0.02 then
    raise exception 'La suma de retenciones no coincide con totals.withholding_amount';
  end if;
  if abs((v_subtotal + v_tax_amount - v_withholding) - v_total) > 0.02 then
    raise exception 'El total no cuadra con base, impuestos y retenciones';
  end if;

  if jsonb_typeof(p_payload->'warnings') is distinct from 'array' then raise exception 'warnings debe ser un array'; end if;
  if jsonb_typeof(p_payload->'confidence') is distinct from 'object'
    or not exists (select 1 from jsonb_each(p_payload->'confidence'))
  then
    raise exception 'confidence debe ser un objeto con al menos un campo';
  end if;
  v_low_confidence := jsonb_array_length(p_payload->'warnings') > 0;
    for v_confidence in select key, value from jsonb_each_text(p_payload->'confidence')
    loop
      begin
        if v_confidence.value is null then raise exception 'Sin valor'; end if;
        if v_confidence.value::numeric < 0 or v_confidence.value::numeric > 1 then
        raise exception 'Fuera de rango';
      end if;
      if v_confidence.value::numeric < 0.8 then v_low_confidence := true; end if;
    exception when others then
      raise exception 'Confianza invalida en %', v_confidence.key;
    end;
  end loop;

  select document_id into v_existing_document_id
  from public.accounting_drive_imports
  where business_id = v_business
    and drive_file_id = v_drive_file_id
    and drive_revision = v_revision
  limit 1;
  if found then
    return jsonb_build_object(
      'status', 'duplicate',
      'document_id', v_existing_document_id,
      'reason', 'drive_revision'
    );
  end if;

  select id into v_existing_document_id
  from public.bookkeeping_documents
  where business_id = v_business
    and source_type = 'drive_json'
    and source_id = v_drive_file_id
  limit 1;
  if v_existing_document_id is not null then
    insert into public.accounting_drive_imports(
      business_id, drive_file_id, drive_revision, checksum, schema_version,
      source_file_id, status, document_id, payload, processed_at
    ) values (
      v_business, v_drive_file_id, v_revision, v_checksum, v_schema_version,
      nullif(p_result_file_id, ''), 'duplicate', v_existing_document_id, p_payload, now()
    )
    on conflict (business_id, drive_file_id, drive_revision) do nothing;
    return jsonb_build_object(
      'status', 'duplicate',
      'document_id', v_existing_document_id,
      'reason', 'drive_file'
    );
  end if;

  select id into v_contact_id
  from public.accounting_contacts
  where business_id = v_business
    and (
      (v_supplier_tax_id <> '' and upper(regexp_replace(tax_id, '[^A-Za-z0-9]', '', 'g')) = v_supplier_tax_id)
      or (v_supplier_tax_id = '' and lower(name) = lower(v_supplier_name))
    )
  order by case when kind in ('supplier', 'both') then 0 else 1 end
  limit 1;

  if v_contact_id is null then
    insert into public.accounting_contacts(
      business_id, kind, name, legal_name, tax_id, email, address,
      default_account_code
    ) values (
      v_business,
      'supplier',
      v_supplier_name,
      coalesce(nullif(btrim(p_payload#>>'{supplier,legal_name}'), ''), v_supplier_name),
      coalesce(p_payload#>>'{supplier,tax_id}', ''),
      coalesce(p_payload#>>'{supplier,email}', ''),
      coalesce(p_payload#>>'{supplier,address}', ''),
      nullif(btrim(p_payload#>>'{suggestions,account_code}'), '')
    )
    returning id into v_contact_id;
  elsif exists (
    select 1 from public.accounting_contacts
    where id = v_contact_id and kind = 'customer'
  ) then
    update public.accounting_contacts set kind = 'both', updated_at = now() where id = v_contact_id;
  end if;

  if v_invoice_number <> '' then
    select id into v_existing_document_id
    from public.bookkeeping_documents
    where business_id = v_business
      and direction = 'purchase'
      and contact_id = v_contact_id
      and number = v_invoice_number
      and issue_date = v_issue_date
      and total_amount = v_total
      and status <> 'voided'
    limit 1;
  end if;
  if v_existing_document_id is not null then
    insert into public.accounting_drive_imports(
      business_id, drive_file_id, drive_revision, checksum, schema_version,
      source_file_id, status, document_id, payload, processed_at
    ) values (
      v_business, v_drive_file_id, v_revision, v_checksum, v_schema_version,
      nullif(p_result_file_id, ''), 'duplicate', v_existing_document_id, p_payload, now()
    );
    return jsonb_build_object(
      'status', 'duplicate',
      'document_id', v_existing_document_id,
      'reason', 'supplier_invoice'
    );
  end if;

  insert into public.bookkeeping_documents(
    business_id, contact_id, source_type, source_id, direction, document_type,
    status, number, issue_date, due_date, currency, subtotal, tax_amount,
    withholding_amount, total_amount, payment_method, category, attachment_url,
    notes, source_payload
  ) values (
    v_business,
    v_contact_id,
    'drive_json',
    v_drive_file_id,
    'purchase',
    v_document_type,
    'needs_review',
    v_invoice_number,
    v_issue_date,
    v_due_date,
    v_currency,
    v_subtotal,
    v_tax_amount,
    v_withholding,
    v_total,
    v_payment_method,
    nullif(btrim(p_payload#>>'{suggestions,category}'), ''),
    nullif(btrim(p_payload->>'source_url'), ''),
    nullif(array_to_string(array(select jsonb_array_elements_text(coalesce(p_payload->'warnings', '[]'::jsonb))), E'\n'), ''),
    p_payload
  )
  returning id into v_document_id;

  for v_line in select value from jsonb_array_elements(p_payload->'lines')
  loop
    v_position := v_position + 1;
    v_quantity := coalesce(nullif(v_line->>'quantity', '')::numeric, 1);
    v_line_base := (v_line->>'taxable_base')::numeric;
    v_unit_price := coalesce(
      nullif(v_line->>'unit_price', '')::numeric,
      case when v_quantity <> 0 then v_line_base / v_quantity else 0 end
    );
    insert into public.bookkeeping_document_lines(
      business_id, document_id, position, description, quantity, unit_price,
      taxable_base, tax_rate, tax_amount, tax_scope, withholding_rate,
      withholding_amount, account_code
    ) values (
      v_business,
      v_document_id,
      v_position,
      v_line->>'description',
      v_quantity,
      v_unit_price,
      v_line_base,
      (v_line->>'tax_rate')::numeric,
      (v_line->>'tax_amount')::numeric,
      coalesce(nullif(v_line->>'tax_scope', ''), 'taxable'),
      coalesce(nullif(v_line->>'withholding_rate', '')::numeric, 0),
      coalesce(nullif(v_line->>'withholding_amount', '')::numeric, 0),
      coalesce(
        nullif(btrim(v_line->>'account_code'), ''),
        nullif(btrim(p_payload#>>'{suggestions,account_code}'), ''),
        '600'
      )
    );
  end loop;

  insert into public.accounting_drive_imports(
    business_id, drive_file_id, drive_revision, checksum, schema_version,
    source_file_id, status, document_id, payload, processed_at
  ) values (
    v_business, v_drive_file_id, v_revision, v_checksum, v_schema_version,
    nullif(p_result_file_id, ''),
    case when v_low_confidence then 'pending' else 'imported' end,
    v_document_id, p_payload, now()
  );

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business,
    'drive_document_imported',
    'bookkeeping_document',
    v_document_id::text,
    jsonb_build_object(
      'drive_file_id', v_drive_file_id,
      'drive_revision', v_revision,
      'result_file_id', nullif(p_result_file_id, ''),
      'low_confidence', v_low_confidence
    )
  );

  return jsonb_build_object(
    'status', 'imported',
    'document_id', v_document_id,
    'needs_review', true,
    'low_confidence', v_low_confidence
  );
end;
$$;

revoke all on function public.accounting_import_supplier_document(jsonb, text) from public;
grant execute on function public.accounting_import_supplier_document(jsonb, text) to anon, authenticated;

create or replace function public.accounting_record_drive_import_error(
  p_drive_file_id text,
  p_drive_revision text,
  p_checksum text,
  p_schema_version text,
  p_result_file_id text,
  p_payload jsonb,
  p_status text,
  p_error_message text
)
returns uuid
language plpgsql
security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_id uuid;
  v_drive_file_id text := coalesce(nullif(btrim(p_drive_file_id), ''), 'result:' || nullif(btrim(p_result_file_id), ''));
  v_revision text := coalesce(nullif(btrim(p_drive_revision), ''), nullif(btrim(p_checksum), ''), 'v1');
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  if v_drive_file_id is null then raise exception 'Falta un identificador para registrar el error'; end if;
  if p_status not in ('invalid', 'error') then raise exception 'Estado de error no permitido'; end if;

  insert into public.accounting_drive_imports(
    business_id, drive_file_id, drive_revision, checksum, schema_version,
    source_file_id, status, payload, error_message, processed_at
  ) values (
    v_business, v_drive_file_id, v_revision, nullif(btrim(p_checksum), ''),
    coalesce(nullif(btrim(p_schema_version), ''), 'unknown'),
    nullif(btrim(p_result_file_id), ''), p_status, coalesce(p_payload, '{}'::jsonb),
    left(coalesce(p_error_message, 'Error desconocido'), 2000), now()
  )
  on conflict (business_id, drive_file_id, drive_revision) do update
  set status = excluded.status,
      checksum = excluded.checksum,
      source_file_id = excluded.source_file_id,
      payload = excluded.payload,
      error_message = excluded.error_message,
      processed_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.accounting_record_drive_import_error(
  text, text, text, text, text, jsonb, text, text
) from public;
grant execute on function public.accounting_record_drive_import_error(
  text, text, text, text, text, jsonb, text, text
) to anon, authenticated;

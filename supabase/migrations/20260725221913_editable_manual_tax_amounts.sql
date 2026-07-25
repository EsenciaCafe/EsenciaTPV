create or replace function public.accounting_save_document_with_lines(
  p_document_id uuid,
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
  v_existing public.bookkeeping_documents%rowtype;
  v_document_id uuid;
  v_line jsonb;
  v_position integer := 0;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_base numeric;
  v_tax_scope text;
  v_tax_rate numeric;
  v_tax numeric;
  v_withholding_rate numeric;
  v_withholding numeric;
  v_manual_base boolean;
  v_manual_tax boolean;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_withholding_total numeric := 0;
  v_total numeric := 0;
  v_direction text;
  v_status text;
begin
  if v_business is null then
    raise exception 'Sesion contable no valida';
  end if;
  if p_document is null or jsonb_typeof(p_document) <> 'object' then
    raise exception 'Cabecera de documento no valida';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'El documento debe tener al menos una linea';
  end if;

  if p_document_id is not null then
    select * into v_existing
    from public.bookkeeping_documents
    where id = p_document_id and business_id = v_business
    for update;
    if v_existing.id is null then
      raise exception 'Documento no encontrado';
    end if;
    if v_existing.status not in ('draft', 'needs_review') then
      raise exception 'Un documento aprobado no se puede modificar; debe rectificarse';
    end if;
    v_direction := v_existing.direction;
    v_status := v_existing.status;
  else
    v_direction := coalesce(nullif(btrim(p_document->>'direction'), ''), 'purchase');
    v_status := 'draft';
  end if;

  if v_direction not in ('purchase', 'sale') then
    raise exception 'Direccion de documento no valida';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_position := v_position + 1;
    v_description := nullif(btrim(v_line->>'description'), '');
    if v_description is null then
      raise exception 'La linea % no tiene descripcion', v_position;
    end if;

    begin
      v_quantity := coalesce(nullif(v_line->>'quantity', '')::numeric, 1);
      v_unit_price := coalesce(nullif(v_line->>'unit_price', '')::numeric, 0);
      v_tax_scope := coalesce(nullif(btrim(v_line->>'tax_scope'), ''), 'taxable');
      v_tax_rate := coalesce(nullif(v_line->>'tax_rate', '')::numeric, 0);
      v_withholding_rate := coalesce(nullif(v_line->>'withholding_rate', '')::numeric, 0);
      v_manual_base := coalesce(nullif(v_line->>'manual_taxable_base', '')::boolean, false);
      v_manual_tax := coalesce(nullif(v_line->>'manual_tax_amount', '')::boolean, false);
      v_base := case
        when v_manual_base then round(coalesce(nullif(v_line->>'taxable_base', '')::numeric, 0), 2)
        else round(v_quantity * v_unit_price, 2)
      end;
      v_tax := case
        when v_tax_scope <> 'taxable' then 0
        when v_manual_tax then round(coalesce(nullif(v_line->>'tax_amount', '')::numeric, 0), 2)
        else round(v_base * v_tax_rate / 100, 2)
      end;
    exception when others then
      raise exception 'Los importes de la linea % no son validos', v_position;
    end;

    if v_quantity <= 0 then
      raise exception 'La cantidad de la linea % debe ser mayor que cero', v_position;
    end if;
    if v_tax_scope not in ('taxable', 'exempt', 'not_subject') then
      raise exception 'Tratamiento fiscal no valido en la linea %', v_position;
    end if;
    if v_tax_rate not in (0, 3, 5, 7, 9.5, 15) then
      raise exception 'Tipo de IGIC no permitido en la linea %', v_position;
    end if;
    if v_withholding_rate < 0 or v_withholding_rate > 100 then
      raise exception 'Retencion no valida en la linea %', v_position;
    end if;

    if v_tax_scope <> 'taxable' then
      v_tax_rate := 0;
      v_tax := 0;
    end if;
    v_withholding := round(v_base * v_withholding_rate / 100, 2);
    v_subtotal := v_subtotal + v_base;
    v_tax_total := v_tax_total + v_tax;
    v_withholding_total := v_withholding_total + v_withholding;
  end loop;

  v_subtotal := round(v_subtotal, 2);
  v_tax_total := round(v_tax_total, 2);
  v_withholding_total := round(v_withholding_total, 2);
  v_total := round(v_subtotal + v_tax_total - v_withholding_total, 2);

  if p_document_id is null then
    insert into public.bookkeeping_documents(
      business_id, contact_id, source_type, source_id, direction, document_type,
      status, number, issue_date, currency, subtotal, tax_amount,
      withholding_amount, total_amount, notes, attachment_url, source_payload, updated_at
    ) values (
      v_business,
      nullif(p_document->>'contact_id', '')::uuid,
      coalesce(nullif(btrim(p_document->>'source_type'), ''), 'manual'),
      coalesce(nullif(btrim(p_document->>'source_id'), ''), 'manual-' || gen_random_uuid()::text),
      v_direction,
      coalesce(nullif(btrim(p_document->>'document_type'), ''), 'invoice'),
      v_status,
      coalesce(p_document->>'number', ''),
      coalesce(nullif(p_document->>'issue_date', '')::date, current_date),
      'EUR',
      v_subtotal,
      v_tax_total,
      v_withholding_total,
      v_total,
      nullif(p_document->>'notes', ''),
      nullif(btrim(p_document->>'attachment_url'), ''),
      coalesce(p_document->'source_payload', '{}'::jsonb) - 'tax_rate',
      now()
    )
    returning id into v_document_id;
  else
    v_document_id := p_document_id;
    update public.bookkeeping_documents
    set contact_id = nullif(p_document->>'contact_id', '')::uuid,
        document_type = coalesce(nullif(btrim(p_document->>'document_type'), ''), document_type),
        number = coalesce(p_document->>'number', number),
        issue_date = coalesce(nullif(p_document->>'issue_date', '')::date, issue_date),
        subtotal = v_subtotal,
        tax_amount = v_tax_total,
        withholding_amount = v_withholding_total,
        total_amount = v_total,
        notes = nullif(p_document->>'notes', ''),
        attachment_url = coalesce(nullif(btrim(p_document->>'attachment_url'), ''), attachment_url),
        source_payload = source_payload - 'tax_rate',
        updated_at = now()
    where id = v_document_id and business_id = v_business;
    delete from public.bookkeeping_document_lines
    where document_id = v_document_id and business_id = v_business;
  end if;

  v_position := 0;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_position := v_position + 1;
    v_description := btrim(v_line->>'description');
    v_quantity := coalesce(nullif(v_line->>'quantity', '')::numeric, 1);
    v_unit_price := coalesce(nullif(v_line->>'unit_price', '')::numeric, 0);
    v_tax_scope := coalesce(nullif(btrim(v_line->>'tax_scope'), ''), 'taxable');
    v_tax_rate := coalesce(nullif(v_line->>'tax_rate', '')::numeric, 0);
    v_withholding_rate := coalesce(nullif(v_line->>'withholding_rate', '')::numeric, 0);
    v_manual_base := coalesce(nullif(v_line->>'manual_taxable_base', '')::boolean, false);
    v_manual_tax := coalesce(nullif(v_line->>'manual_tax_amount', '')::boolean, false);
    v_base := case
      when v_manual_base then round(coalesce(nullif(v_line->>'taxable_base', '')::numeric, 0), 2)
      else round(v_quantity * v_unit_price, 2)
    end;
    v_tax := case
      when v_tax_scope <> 'taxable' then 0
      when v_manual_tax then round(coalesce(nullif(v_line->>'tax_amount', '')::numeric, 0), 2)
      else round(v_base * v_tax_rate / 100, 2)
    end;
    if v_tax_scope <> 'taxable' then
      v_tax_rate := 0;
      v_tax := 0;
    end if;
    v_withholding := round(v_base * v_withholding_rate / 100, 2);

    insert into public.bookkeeping_document_lines(
      business_id, document_id, position, supplier_item_code, description,
      quantity, unit_price, taxable_base, tax_rate, tax_amount, tax_scope,
      withholding_rate, withholding_amount, account_code
    ) values (
      v_business,
      v_document_id,
      v_position,
      nullif(btrim(v_line->>'supplier_item_code'), ''),
      v_description,
      v_quantity,
      v_unit_price,
      v_base,
      v_tax_rate,
      v_tax,
      v_tax_scope,
      v_withholding_rate,
      v_withholding,
      coalesce(nullif(btrim(v_line->>'account_code'), ''), case when v_direction = 'sale' then '700' else '600' end)
    );
  end loop;

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business,
    'document_lines_saved',
    'document',
    v_document_id::text,
    jsonb_build_object(
      'line_count', jsonb_array_length(p_lines),
      'subtotal', v_subtotal,
      'tax_amount', v_tax_total,
      'withholding_amount', v_withholding_total,
      'total_amount', v_total
    )
  );

  return v_document_id;
end;
$$;

revoke all on function public.accounting_save_document_with_lines(uuid, jsonb, jsonb) from public;
grant execute on function public.accounting_save_document_with_lines(uuid, jsonb, jsonb) to anon, authenticated;

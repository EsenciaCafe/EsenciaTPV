alter table public.bookkeeping_document_lines
  add column if not exists supplier_item_code text,
  add column if not exists item_key text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function accounting_private.normalize_item_key(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(
    regexp_replace(
      translate(
        lower(btrim(coalesce(p_value, ''))),
        'áàäâéèëêíìïîóòöôúùüûñç',
        'aaaaeeeeiiiioooouuuunc'
      ),
      '[^a-z0-9]+',
      '',
      'g'
    ),
    ''
  );
$$;

create or replace function accounting_private.prepare_document_line()
returns trigger
language plpgsql
security definer
set search_path = public, accounting_private, pg_catalog
as $$
begin
  new.item_key := accounting_private.normalize_item_key(
    coalesce(nullif(btrim(new.supplier_item_code), ''), new.description)
  );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bookkeeping_document_lines_prepare on public.bookkeeping_document_lines;
create trigger bookkeeping_document_lines_prepare
before insert or update of supplier_item_code, description, quantity, unit_price, tax_rate, tax_scope, withholding_rate
on public.bookkeeping_document_lines
for each row execute function accounting_private.prepare_document_line();

update public.bookkeeping_document_lines
set item_key = accounting_private.normalize_item_key(
  coalesce(nullif(btrim(supplier_item_code), ''), description)
)
where item_key is null;

create index if not exists bookkeeping_document_lines_document_id_idx
  on public.bookkeeping_document_lines(document_id);

create index if not exists bookkeeping_document_lines_item_history_idx
  on public.bookkeeping_document_lines(business_id, item_key, created_at desc)
  include (document_id, unit_price)
  where item_key is not null;

create index if not exists bookkeeping_documents_contact_purchase_date_idx
  on public.bookkeeping_documents(business_id, contact_id, issue_date desc)
  where direction = 'purchase' and status in ('approved', 'partially_paid', 'paid');

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
    exception when others then
      raise exception 'Los importes de la linea % no son validos', v_position;
    end;

    if v_quantity <= 0 then
      raise exception 'La cantidad de la linea % debe ser mayor que cero', v_position;
    end if;
    if v_unit_price < 0 then
      raise exception 'El precio de la linea % no puede ser negativo', v_position;
    end if;
    if v_tax_scope not in ('taxable', 'exempt', 'not_subject') then
      raise exception 'Tratamiento fiscal no valido en la linea %', v_position;
    end if;
    if v_tax_rate not in (0, 3, 7, 9.5, 15) then
      raise exception 'Tipo de IGIC no permitido en la linea %', v_position;
    end if;
    if v_withholding_rate < 0 or v_withholding_rate > 100 then
      raise exception 'Retencion no valida en la linea %', v_position;
    end if;

    if v_tax_scope <> 'taxable' then
      v_tax_rate := 0;
    end if;
    v_base := round(v_quantity * v_unit_price, 2);
    v_tax := case when v_tax_scope = 'taxable' then round(v_base * v_tax_rate / 100, 2) else 0 end;
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
      withholding_amount, total_amount, notes, source_payload, updated_at
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
    if v_tax_scope <> 'taxable' then
      v_tax_rate := 0;
    end if;
    v_base := round(v_quantity * v_unit_price, 2);
    v_tax := case when v_tax_scope = 'taxable' then round(v_base * v_tax_rate / 100, 2) else 0 end;
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

create or replace function public.accounting_purchase_price_history(p_document_id uuid)
returns table(
  line_id uuid,
  previous_unit_price numeric,
  previous_issue_date date,
  previous_document_number text,
  change_amount numeric,
  change_percent numeric
)
language sql
security definer
set search_path = public, accounting_private, pg_catalog
as $$
  select
    current_line.id,
    history.unit_price,
    history.issue_date,
    history.document_number,
    case
      when history.unit_price is null then null
      else round(current_line.unit_price - history.unit_price, 4)
    end,
    case
      when history.unit_price is null or history.unit_price = 0 then null
      else round((current_line.unit_price - history.unit_price) * 100 / history.unit_price, 2)
    end
  from public.bookkeeping_document_lines current_line
  join public.bookkeeping_documents current_document
    on current_document.id = current_line.document_id
   and current_document.business_id = current_line.business_id
  left join lateral (
    select
      prior_line.unit_price,
      prior_document.issue_date,
      prior_document.number as document_number
    from public.bookkeeping_document_lines prior_line
    join public.bookkeeping_documents prior_document
      on prior_document.id = prior_line.document_id
     and prior_document.business_id = prior_line.business_id
    where prior_line.business_id = current_line.business_id
      and prior_line.item_key = current_line.item_key
      and prior_document.contact_id is not distinct from current_document.contact_id
      and prior_document.direction = 'purchase'
      and prior_document.status in ('approved', 'partially_paid', 'paid')
      and prior_document.id <> current_document.id
      and (
        prior_document.issue_date < current_document.issue_date
        or (
          prior_document.issue_date = current_document.issue_date
          and prior_document.created_at < current_document.created_at
        )
      )
    order by prior_document.issue_date desc, prior_document.created_at desc
    limit 1
  ) history on true
  where current_document.id = p_document_id
    and current_document.business_id = accounting_private.current_business_id()
  order by current_line.position;
$$;

revoke all on function public.accounting_purchase_price_history(uuid) from public;
grant execute on function public.accounting_purchase_price_history(uuid) to anon, authenticated;

create or replace function public.accounting_post_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, accounting_private, extensions, pg_catalog
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_doc public.bookkeeping_documents%rowtype;
  v_entry uuid;
  v_main_account uuid;
  v_tax_account uuid;
  v_counterpart uuid;
  v_withholding_account uuid;
  v_subtotal numeric;
  v_tax numeric;
  v_withholding numeric;
  v_total numeric;
  v_line_count integer;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  select * into v_doc
  from public.bookkeeping_documents
  where id = p_document_id and business_id = v_business
  for update;
  if v_doc.id is null then raise exception 'Documento no encontrado'; end if;
  if v_doc.status in ('voided', 'rectified') then raise exception 'Documento no contabilizable'; end if;
  if exists (
    select 1 from public.accounting_tax_periods
    where business_id = v_business and status = 'locked'
      and v_doc.issue_date between starts_on and ends_on
  ) then raise exception 'El periodo fiscal esta bloqueado'; end if;

  select
    count(*),
    round(coalesce(sum(taxable_base), 0), 2),
    round(coalesce(sum(tax_amount), 0), 2),
    round(coalesce(sum(withholding_amount), 0), 2)
  into v_line_count, v_subtotal, v_tax, v_withholding
  from public.bookkeeping_document_lines
  where document_id = v_doc.id and business_id = v_business;
  if v_line_count = 0 then raise exception 'El documento no tiene lineas'; end if;
  v_total := round(v_subtotal + v_tax - v_withholding, 2);

  update public.bookkeeping_documents
  set subtotal = v_subtotal,
      tax_amount = v_tax,
      withholding_amount = v_withholding,
      total_amount = v_total,
      source_payload = source_payload - 'tax_rate',
      updated_at = now()
  where id = v_doc.id;

  select id into v_main_account from public.accounting_accounts
  where business_id = v_business and code = case when v_doc.direction='sale' then '700' else '600' end;
  select id into v_tax_account from public.accounting_accounts
  where business_id = v_business and code = case when v_doc.direction='sale' then '477' else '472' end;
  select id into v_counterpart from public.accounting_accounts
  where business_id = v_business and code = case when v_doc.direction='sale' then '430' else '400' end;
  select id into v_withholding_account from public.accounting_accounts
  where business_id = v_business and code = case when v_doc.direction='sale' then '473' else '4751' end;
  if v_main_account is null or v_tax_account is null or v_counterpart is null then
    raise exception 'Faltan cuentas contables base';
  end if;
  if v_withholding > 0 and v_withholding_account is null then
    raise exception 'Falta la cuenta contable de retenciones';
  end if;

  insert into public.accounting_journal_entries(
    business_id, entry_date, description, source_type, source_id, status, posted_at
  ) values (
    v_business, v_doc.issue_date, concat(v_doc.document_type, ' ', v_doc.number),
    'document', v_doc.id::text, 'draft', null
  )
  on conflict (business_id, source_type, source_id)
  do update set
    entry_date = excluded.entry_date,
    description = excluded.description,
    status = 'draft',
    posted_at = null
  returning id into v_entry;

  delete from public.accounting_journal_lines where entry_id = v_entry;

  if v_doc.direction = 'sale' then
    insert into public.accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
    values
      (v_business,v_entry,v_counterpart,v_total,0,v_doc.id),
      (v_business,v_entry,v_main_account,0,v_subtotal,v_doc.id);
    if v_tax > 0 then
      insert into public.accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
      values(v_business,v_entry,v_tax_account,0,v_tax,v_doc.id);
    end if;
    if v_withholding > 0 then
      insert into public.accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
      values(v_business,v_entry,v_withholding_account,v_withholding,0,v_doc.id);
    end if;
  else
    insert into public.accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
    values
      (v_business,v_entry,v_main_account,v_subtotal,0,v_doc.id),
      (v_business,v_entry,v_counterpart,0,v_total,v_doc.id);
    if v_tax > 0 then
      insert into public.accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
      values(v_business,v_entry,v_tax_account,v_tax,0,v_doc.id);
    end if;
    if v_withholding > 0 then
      insert into public.accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
      values(v_business,v_entry,v_withholding_account,0,v_withholding,v_doc.id);
    end if;
  end if;

  update public.accounting_journal_entries
  set status='posted', posted_at=now()
  where id=v_entry;
  update public.bookkeeping_documents
  set status='approved', approved_at=coalesce(approved_at, now()), updated_at=now()
  where id=v_doc.id;
  insert into public.accounting_audit_log(business_id,event_type,entity_type,entity_id,metadata)
  values(
    v_business,
    'document_posted',
    'document',
    v_doc.id::text,
    jsonb_build_object(
      'entry_id', v_entry,
      'line_count', v_line_count,
      'subtotal', v_subtotal,
      'tax_amount', v_tax,
      'withholding_amount', v_withholding,
      'total_amount', v_total
    )
  );
  return v_entry;
end;
$$;

revoke all on function public.accounting_post_document(uuid) from public;
grant execute on function public.accounting_post_document(uuid) to anon, authenticated;

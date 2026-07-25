do $$
declare
  v_document_id uuid;
  v_business_id uuid;
  v_subtotal numeric;
  v_tax numeric;
  v_withholding numeric;
  v_total numeric;
  v_entry_id uuid;
begin
  select d.id, d.business_id
  into v_document_id, v_business_id
  from public.bookkeeping_documents d
  join public.accounting_contacts c
    on c.id = d.contact_id and c.business_id = d.business_id
  where d.source_type = 'drive_json'
    and d.direction = 'purchase'
    and d.number = '0/0(058)0203/(2026)011991'
    and d.issue_date = date '2026-07-25'
    and upper(regexp_replace(c.tax_id, '[^A-Za-z0-9]', '', 'g')) = 'A28647451'
    and d.subtotal = 536.63
    and d.tax_amount = 37.56
    and d.total_amount = 574.19
  limit 1;

  if v_document_id is null then
    return;
  end if;

  select
    round(sum(taxable_base), 2),
    round(sum(tax_amount), 2),
    round(sum(withholding_amount), 2)
  into v_subtotal, v_tax, v_withholding
  from public.bookkeeping_document_lines
  where document_id = v_document_id and business_id = v_business_id;
  v_total := round(v_subtotal + v_tax - v_withholding, 2);

  if (v_subtotal, v_tax, v_withholding, v_total)
     is distinct from (536.63::numeric, 12.74::numeric, 0::numeric, 549.37::numeric) then
    raise exception 'El desglose de Makro no coincide con los importes esperados';
  end if;

  set local session_replication_role = replica;
  update public.bookkeeping_documents
  set subtotal = v_subtotal,
      tax_amount = v_tax,
      withholding_amount = v_withholding,
      total_amount = v_total,
      source_payload = source_payload - 'tax_rate',
      updated_at = now()
  where id = v_document_id and business_id = v_business_id;
  set local session_replication_role = origin;

  select id into v_entry_id
  from public.accounting_journal_entries
  where business_id = v_business_id
    and source_type = 'document'
    and source_id = v_document_id::text
  limit 1;

  update public.accounting_journal_lines line
  set debit = case account.code
        when '600' then v_subtotal
        when '472' then v_tax
        else 0
      end,
      credit = case account.code
        when '400' then v_total
        when '4751' then v_withholding
        else 0
      end
  from public.accounting_accounts account
  where line.entry_id = v_entry_id
    and line.account_id = account.id
    and account.code in ('600', '472', '400', '4751');

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business_id,
    'document_totals_repaired',
    'document',
    v_document_id::text,
    jsonb_build_object(
      'reason', 'Recalculo desde las lineas tras retirar el tipo IGIC general de la pantalla de revision',
      'subtotal', v_subtotal,
      'tax_amount', v_tax,
      'withholding_amount', v_withholding,
      'total_amount', v_total,
      'entry_id', v_entry_id
    )
  );
end;
$$;

create or replace function public.finalize_tpv_sale(p_transaction jsonb)
returns public.fiscal_documents
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_sale_id text := nullif(btrim(p_transaction->>'id'), '');
  v_document_type text;
  v_created_at timestamptz;
  v_fiscal public.fiscal_documents%rowtype;
begin
  if v_sale_id is null then
    raise exception 'La venta no tiene identificador';
  end if;

  select * into v_fiscal
  from public.fiscal_documents
  where sale_id = v_sale_id;

  if found then
    return v_fiscal;
  end if;

  if coalesce(jsonb_array_length(coalesce(p_transaction->'items', '[]'::jsonb)), 0) = 0
    and coalesce(nullif(p_transaction->>'itemsCount', '')::integer, 0) > 0 then
    raise exception 'La venta % no contiene el detalle de articulos', v_sale_id;
  end if;

  v_created_at := coalesce(
    nullif(p_transaction->>'createdAt', '')::timestamptz,
    clock_timestamp()
  );
  v_document_type := case
    when coalesce(p_transaction->>'type', 'sale') = 'refund' then 'refund'
    else 'simplified_invoice'
  end;

  insert into public.sales(
    id, type, parent_sale_id, table_name, total_amount, payment_method,
    items_count, receipt_token, staff_id, staff_name, closed_at, created_at,
    legal_data, loyalty_data, refund_amount, refund_reason, has_refund, payload
  ) values (
    v_sale_id,
    coalesce(nullif(p_transaction->>'type', ''), 'sale'),
    nullif(p_transaction->>'parentId', ''),
    nullif(p_transaction->>'table', ''),
    coalesce(nullif(p_transaction->>'total', '')::numeric, 0),
    coalesce(p_transaction->>'paymentMethod', ''),
    coalesce(nullif(p_transaction->>'itemsCount', '')::integer, 0),
    nullif(p_transaction->>'receiptToken', ''),
    nullif(p_transaction#>>'{staff,id}', ''),
    nullif(p_transaction#>>'{staff,name}', ''),
    v_created_at,
    v_created_at,
    coalesce(p_transaction->'legalData', '{}'::jsonb),
    case when p_transaction ? 'loyaltyCustomer'
      then jsonb_build_object('customer', p_transaction->'loyaltyCustomer')
      else '{}'::jsonb end,
    coalesce(nullif(p_transaction->>'refundAmount', '')::numeric, 0),
    nullif(p_transaction->>'reason', ''),
    coalesce(nullif(p_transaction->>'hasRefund', '')::boolean, false),
    p_transaction
  )
  on conflict (id) do update set
    parent_sale_id = excluded.parent_sale_id,
    table_name = excluded.table_name,
    total_amount = excluded.total_amount,
    payment_method = excluded.payment_method,
    items_count = excluded.items_count,
    receipt_token = excluded.receipt_token,
    staff_id = excluded.staff_id,
    staff_name = excluded.staff_name,
    legal_data = excluded.legal_data,
    loyalty_data = excluded.loyalty_data,
    refund_amount = excluded.refund_amount,
    refund_reason = excluded.refund_reason,
    has_refund = excluded.has_refund,
    payload = excluded.payload;

  delete from public.sale_lines where sale_id = v_sale_id;
  insert into public.sale_lines(
    id, sale_id, item_id, ticket_item_id, name, quantity, unit_price,
    total_amount, selected_options, raw_payload
  )
  select
    v_sale_id || '-line-' || lpad(item.ordinality::text, 3, '0'),
    v_sale_id,
    nullif(item.value->>'id', ''),
    nullif(item.value->>'ticketItemId', ''),
    coalesce(item.value->>'name', 'Articulo'),
    coalesce(nullif(item.value->>'qty', '')::numeric, 0),
    coalesce(nullif(item.value->>'price', '')::numeric, 0),
    coalesce(
      nullif(item.value->>'total', '')::numeric,
      coalesce(nullif(item.value->>'price', '')::numeric, 0)
        * coalesce(nullif(item.value->>'qty', '')::numeric, 0)
    ),
    coalesce(item.value->'selectedOptions', '[]'::jsonb),
    item.value
  from jsonb_array_elements(coalesce(p_transaction->'items', '[]'::jsonb))
    with ordinality as item(value, ordinality);

  delete from public.sale_payments where sale_id = v_sale_id;
  insert into public.sale_payments(
    id, sale_id, method, amount, provider, external_ref, raw_payload
  )
  select
    v_sale_id || '-payment-' || lpad(payment.ordinality::text, 3, '0'),
    v_sale_id,
    coalesce(payment.value->>'method', p_transaction->>'paymentMethod', ''),
    coalesce(nullif(payment.value->>'amount', '')::numeric, 0),
    nullif(payment.value->>'provider', ''),
    nullif(payment.value->>'externalRef', ''),
    payment.value
  from jsonb_array_elements(
    case
      when jsonb_array_length(coalesce(p_transaction->'payments', '[]'::jsonb)) > 0
        then p_transaction->'payments'
      else jsonb_build_array(jsonb_build_object(
        'method', p_transaction->>'paymentMethod',
        'amount', p_transaction->>'total'
      ))
    end
  ) with ordinality as payment(value, ordinality);

  select document.* into v_fiscal
  from public.create_fiscal_document(v_sale_id, v_document_type) as document;

  if v_fiscal.fiscal_number is null then
    raise exception 'No se pudo fiscalizar la venta %', v_sale_id;
  end if;

  return v_fiscal;
end;
$$;

revoke all on function public.finalize_tpv_sale(jsonb) from public;
grant execute on function public.finalize_tpv_sale(jsonb) to anon, authenticated;

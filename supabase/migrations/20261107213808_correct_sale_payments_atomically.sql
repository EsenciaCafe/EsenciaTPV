-- Correct settlement only; sale lines, fiscal content and table state stay untouched.
create or replace function public.correct_tpv_sale_payments(
  p_sale_id text, p_expected_payments jsonb, p_payments jsonb, p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_payment public.sale_payments%rowtype;
  v_before jsonb;
  v_after jsonb := '[]'::jsonb;
  v_patch jsonb;
  v_edit jsonb;
  v_record jsonb;
  v_history jsonb;
  v_base numeric;
  v_amount numeric;
  v_tip numeric;
  v_base_total numeric := 0;
  v_tip_total numeric := 0;
  v_charged_total numeric := 0;
  v_method text;
  v_methods text[] := array[]::text[];
begin
  if p_request_id is null or jsonb_typeof(p_payments) is distinct from 'array'
      or jsonb_typeof(p_expected_payments) is distinct from 'array' then
    raise exception 'Solicitud de correccion no valida.';
  end if;
  -- Serialize against closure insertion, then lock this sale (also serializes refunds).
  lock table public.cash_closures in share mode;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'No se encuentra la venta.'; end if;
  v_history := coalesce(v_sale.payload->'paymentCorrections', '[]'::jsonb);
  select value into v_record from jsonb_array_elements(v_history)
    where value->>'operationId' = p_request_id::text;
  if found then
    if v_record->'request' is distinct from p_payments or v_record->'expected' is distinct from p_expected_payments then
      raise exception 'La solicitud ya fue utilizada para otra correccion.';
    end if;
    -- A retry after a lost response never reapplies an older correction.
    return jsonb_build_object('paymentMethod', v_sale.payment_method, 'payments', v_sale.payload->'payments',
      'tipAmount', v_sale.payload->'tipAmount', 'totalCharged', v_sale.payload->'totalCharged', 'paymentCorrections', v_history);
  end if;
  if v_sale.type = 'refund' or v_sale.has_refund or coalesce(v_sale.refund_amount, 0) <> 0
      or coalesce((v_sale.payload->>'voided')::boolean, false)
      or exists(select 1 from public.sales where parent_sale_id = p_sale_id and type = 'refund') then
    raise exception 'No se puede corregir una venta anulada o con devolucion.';
  end if;
  if exists(select 1 from public.cash_closures c
    where c.business_date = (coalesce(v_sale.closed_at,v_sale.created_at) at time zone 'Atlantic/Canary')::date
      and c.closed_at >= coalesce(v_sale.closed_at,v_sale.created_at)) then
    raise exception 'El turno de esta venta ya esta cerrado.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'amount', p.amount,
    'saleAmount', coalesce((p.raw_payload->>'saleAmount')::numeric, p.amount),
    'tipAmount', coalesce((p.raw_payload->>'tipAmount')::numeric, 0)) order by p.id), '[]'::jsonb)
    into v_before from public.sale_payments p where p.sale_id = p_sale_id;
  if v_before is distinct from p_expected_payments then
    raise exception 'El cobro ha cambiado en otro dispositivo. Vuelve a abrir el ticket.';
  end if;
  if jsonb_array_length(v_before) = 0 or jsonb_array_length(p_payments) <> jsonb_array_length(v_before)
    or (select count(distinct value->>'id') from jsonb_array_elements(p_payments)) <> jsonb_array_length(v_before) then
    raise exception 'No se pueden agregar ni eliminar pagos.';
  end if;
  for v_payment in select * from public.sale_payments where sale_id = p_sale_id order by id for update loop
    if lower(coalesce(v_payment.method, '') || ' ' || coalesce(v_payment.provider, '')) ~ '(regalo|gift|square)' then
      raise exception 'Las tarjetas regalo no admiten esta correccion.';
    end if;
    select value into v_edit from jsonb_array_elements(p_payments) where value->>'id' = v_payment.id;
    if not found or v_edit->>'method' is null or v_edit->>'method' not in ('Efectivo', 'Tarjeta')
      or jsonb_typeof(v_edit->'amount') is distinct from 'number' then
      raise exception 'Pago o metodo no valido.';
    end if;
    v_base := coalesce((v_payment.raw_payload->>'saleAmount')::numeric, v_payment.amount);
    v_amount := (v_edit->>'amount')::numeric;
    v_method := v_edit->>'method';
    if v_base is null or v_base < 0 or v_base <> round(v_base,2) or v_amount < v_base
      or v_amount > 999999.99 or v_amount <> round(v_amount,2)
      or (v_method = 'Efectivo' and v_amount <> v_base) then
      raise exception 'Importe no valido: solo se puede ajustar la propina de tarjeta, no el importe de la venta.';
    end if;
    v_tip := v_amount - v_base;
    v_base_total := v_base_total + v_base;
    v_tip_total := v_tip_total + v_tip;
    v_charged_total := v_charged_total + v_amount;
    if not (v_method = any(v_methods)) then v_methods := array_append(v_methods, v_method); end if;
    v_record := coalesce(v_payment.raw_payload, '{}'::jsonb) || jsonb_build_object(
      'id', v_payment.id, 'method', v_method, 'saleAmount', v_base, 'amount', v_amount, 'tipAmount', v_tip,
      'provider', case when v_method = 'Tarjeta' then 'BBVA' else '' end,
      'externalRef', case when v_method = 'Tarjeta' then coalesce(v_payment.external_ref, '') else '' end);
    v_after := v_after || jsonb_build_array(v_record);
  end loop;
  if v_base_total <> v_sale.total_amount then raise exception 'El desglose no coincide con la venta.'; end if;
  v_method := case when cardinality(v_methods) = 1 then v_methods[1] else 'Mixto (' || jsonb_array_length(v_after) || ' pagos)' end;
  v_history := v_history || jsonb_build_array(jsonb_build_object('operationId', p_request_id, 'at', now(),
    'expected', p_expected_payments, 'request', p_payments, 'before', v_before, 'after', v_after));
  v_patch := jsonb_build_object('paymentMethod', v_method, 'payments', v_after, 'tipAmount', v_tip_total,
    'totalCharged', v_charged_total, 'paymentCorrections', v_history);
  update public.sale_payments p set method = e.value->>'method', amount = (e.value->>'amount')::numeric,
    provider = nullif(e.value->>'provider',''), external_ref = nullif(e.value->>'externalRef',''), raw_payload = e.value
    from jsonb_array_elements(v_after) e where p.sale_id = p_sale_id and p.id = e.value->>'id';
  update public.sales set payment_method = v_method, payload = coalesce(payload, '{}'::jsonb) || v_patch where id = p_sale_id;
  update public.receipt_tickets set payload = coalesce(payload, '{}'::jsonb) || v_patch where transaction_id = p_sale_id;
  return v_patch;
end;
$$;
revoke all on function public.correct_tpv_sale_payments(text,jsonb,jsonb,uuid) from public;
grant execute on function public.correct_tpv_sale_payments(text,jsonb,jsonb,uuid) to anon, authenticated;

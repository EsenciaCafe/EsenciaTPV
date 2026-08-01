create table if not exists public.offline_devices (
  id text primary key,
  label text not null default 'TPV de Esencia',
  emergency_enabled boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create unique index if not exists offline_devices_single_emergency_idx
  on public.offline_devices ((emergency_enabled))
  where emergency_enabled = true;

create table if not exists public.offline_sessions (
  id text primary key,
  device_id text not null references public.offline_devices(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'syncing', 'completed', 'conflict')),
  activated_by jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  last_sequence bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.sync_operations (
  operation_id text primary key,
  device_id text not null references public.offline_devices(id) on delete restrict,
  session_id text references public.offline_sessions(id) on delete restrict,
  sequence bigint not null,
  kind text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received', 'synced', 'conflict', 'failed')),
  result jsonb not null default '{}'::jsonb,
  error text,
  occurred_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (device_id, sequence)
);

create index if not exists sync_operations_device_sequence_idx
  on public.sync_operations(device_id, sequence);
create index if not exists sync_operations_status_idx
  on public.sync_operations(status, created_at);

alter table public.fiscal_documents
  add column if not exists sif_id text not null default 'ESENCIA-CLOUD-01',
  add column if not exists incident boolean not null default false;

alter table public.offline_devices enable row level security;
alter table public.offline_sessions enable row level security;
alter table public.sync_operations enable row level security;

drop policy if exists offline_devices_tpv_access on public.offline_devices;
create policy offline_devices_tpv_access on public.offline_devices
for all to anon, authenticated using (true) with check (true);

drop policy if exists offline_sessions_tpv_access on public.offline_sessions;
create policy offline_sessions_tpv_access on public.offline_sessions
for all to anon, authenticated using (true) with check (true);

drop policy if exists sync_operations_tpv_access on public.sync_operations;
create policy sync_operations_tpv_access on public.sync_operations
for all to anon, authenticated using (true) with check (true);

grant select, insert, update on public.offline_devices to anon, authenticated;
grant select, insert, update on public.offline_sessions to anon, authenticated;
grant select, insert, update on public.sync_operations to anon, authenticated;

create or replace function public.apply_offline_batch(
  p_device_id text,
  p_session_id text,
  p_operations jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_operation jsonb;
  v_operation_id text;
  v_sequence bigint;
  v_kind text;
  v_entity_id text;
  v_payload jsonb;
  v_occurred_at timestamptz;
  v_existing public.sync_operations%rowtype;
  v_item jsonb;
  v_payment jsonb;
  v_fiscal jsonb;
  v_result jsonb := '[]'::jsonb;
  v_status text;
  v_error text;
begin
  if p_device_id is null or btrim(p_device_id) = '' then
    raise exception 'device_id requerido';
  end if;
  if jsonb_typeof(p_operations) <> 'array' then
    raise exception 'operations debe ser un array';
  end if;
  if jsonb_array_length(p_operations) > 50 then
    raise exception 'maximo 50 operaciones por lote';
  end if;

  insert into public.offline_devices(id, last_seen_at, updated_at)
  values (p_device_id, clock_timestamp(), clock_timestamp())
  on conflict (id) do update set
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at;

  if p_session_id is not null and btrim(p_session_id) <> '' then
    insert into public.offline_sessions(id, device_id, status)
    values (p_session_id, p_device_id, 'syncing')
    on conflict (id) do update set
      status = 'syncing',
      updated_at = clock_timestamp();
  end if;

  for v_operation in
    select value from jsonb_array_elements(p_operations)
    order by coalesce((value->>'sequence')::bigint, 0)
  loop
    v_operation_id := v_operation->>'operation_id';
    v_sequence := coalesce((v_operation->>'sequence')::bigint, 0);
    v_kind := v_operation->>'kind';
    v_entity_id := coalesce(v_operation->>'entity_id', '');
    v_payload := coalesce(v_operation->'payload', '{}'::jsonb);
    v_occurred_at := coalesce((v_operation->>'occurred_at')::timestamptz, clock_timestamp());
    v_status := 'synced';
    v_error := null;

    if v_operation_id is null or btrim(v_operation_id) = '' or v_sequence <= 0
      or v_kind is null or btrim(v_kind) = '' then
      raise exception 'Operacion offline incompleta';
    end if;

    select * into v_existing
    from public.sync_operations
    where operation_id = v_operation_id;

    if found then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'operation_id', v_operation_id,
        'status', case when v_existing.status = 'synced' then 'duplicate' else v_existing.status end,
        'error', v_existing.error,
        'server_payload', v_existing.result
      ));
      continue;
    end if;

    begin
      insert into public.sync_operations(
        operation_id, device_id, session_id, sequence, kind, entity_id,
        payload, status, occurred_at
      ) values (
        v_operation_id, p_device_id, nullif(p_session_id, ''), v_sequence, v_kind,
        v_entity_id, v_payload, 'received', v_occurred_at
      );

      if v_kind = 'sale.upsert' then
        if coalesce(jsonb_array_length(coalesce(v_payload->'items', '[]'::jsonb)), 0) = 0
          and coalesce((v_payload->>'itemsCount')::integer, 0) > 0 then
          raise exception 'La venta % no contiene el detalle de articulos', v_entity_id;
        end if;

        insert into public.sales(
          id, type, parent_sale_id, table_name, total_amount, payment_method,
          items_count, receipt_token, staff_id, staff_name, closed_at, created_at,
          legal_data, loyalty_data, refund_amount, refund_reason, has_refund, payload
        ) values (
          v_entity_id,
          coalesce(nullif(v_payload->>'type', ''), 'sale'),
          nullif(v_payload->>'parentId', ''),
          nullif(v_payload->>'table', ''),
          coalesce((v_payload->>'total')::numeric, 0),
          coalesce(v_payload->>'paymentMethod', ''),
          coalesce((v_payload->>'itemsCount')::integer, 0),
          nullif(v_payload->>'receiptToken', ''),
          nullif(v_payload#>>'{staff,id}', ''),
          nullif(v_payload#>>'{staff,name}', ''),
          coalesce((v_payload->>'createdAt')::timestamptz, v_occurred_at),
          coalesce((v_payload->>'createdAt')::timestamptz, v_occurred_at),
          coalesce(v_payload->'legalData', '{}'::jsonb),
          case when v_payload ? 'loyaltyCustomer'
            then jsonb_build_object('customer', v_payload->'loyaltyCustomer')
            else '{}'::jsonb end,
          coalesce((v_payload->>'refundAmount')::numeric, 0),
          nullif(v_payload->>'reason', ''),
          coalesce((v_payload->>'hasRefund')::boolean, false),
          v_payload - 'syncStatus'
        )
        on conflict (id) do update set
          parent_sale_id = excluded.parent_sale_id,
          table_name = excluded.table_name,
          total_amount = excluded.total_amount,
          payment_method = excluded.payment_method,
          items_count = excluded.items_count,
          receipt_token = excluded.receipt_token,
          legal_data = excluded.legal_data,
          loyalty_data = excluded.loyalty_data,
          refund_amount = excluded.refund_amount,
          refund_reason = excluded.refund_reason,
          has_refund = excluded.has_refund,
          payload = excluded.payload;

        delete from public.sale_lines where sale_id = v_entity_id;
        for v_item in select value from jsonb_array_elements(coalesce(v_payload->'items', '[]'::jsonb))
        loop
          insert into public.sale_lines(
            id, sale_id, item_id, ticket_item_id, name, quantity, unit_price,
            total_amount, selected_options, raw_payload
          ) values (
            v_operation_id || '-line-' || coalesce(v_item->>'ticketItemId', gen_random_uuid()::text),
            v_entity_id,
            nullif(v_item->>'id', ''),
            nullif(v_item->>'ticketItemId', ''),
            coalesce(v_item->>'name', 'Articulo'),
            coalesce((v_item->>'qty')::numeric, 0),
            coalesce((v_item->>'price')::numeric, 0),
            coalesce((v_item->>'total')::numeric, 0),
            coalesce(v_item->'selectedOptions', '[]'::jsonb),
            v_item
          ) on conflict (id) do update set raw_payload = excluded.raw_payload;
        end loop;

        delete from public.sale_payments where sale_id = v_entity_id;
        for v_payment in select value from jsonb_array_elements(
          case when jsonb_array_length(coalesce(v_payload->'payments', '[]'::jsonb)) > 0
            then v_payload->'payments'
            else jsonb_build_array(jsonb_build_object(
              'method', v_payload->>'paymentMethod', 'amount', v_payload->>'total'
            )) end
        )
        loop
          insert into public.sale_payments(
            id, sale_id, method, amount, provider, external_ref, raw_payload
          ) values (
            v_operation_id || '-payment-' || coalesce(v_payment->>'id', gen_random_uuid()::text),
            v_entity_id,
            coalesce(v_payment->>'method', v_payload->>'paymentMethod', ''),
            coalesce((v_payment->>'amount')::numeric, 0),
            nullif(v_payment->>'provider', ''),
            nullif(v_payment->>'externalRef', ''),
            v_payment
          ) on conflict (id) do update set raw_payload = excluded.raw_payload;
        end loop;

        v_fiscal := v_payload->'fiscalData';
        if v_fiscal is not null and jsonb_typeof(v_fiscal) = 'object' then
          insert into public.fiscal_documents(
            id, sale_id, document_type, status, series, number, fiscal_number,
            issued_at, total_amount, tax_name, tax_rate, taxable_base, tax_amount,
            legal_data, payload, previous_hash, hash, aeat_status, qr_payload,
            sif_id, incident
          ) values (
            coalesce(v_fiscal->>'id', gen_random_uuid()::text),
            v_entity_id,
            coalesce(v_fiscal->>'type', 'simplified_invoice'),
            coalesce(v_fiscal->>'status', 'issued'),
            v_fiscal->>'series',
            (v_fiscal->>'number')::integer,
            v_fiscal->>'fiscalNumber',
            coalesce((v_fiscal->>'issuedAt')::timestamptz, v_occurred_at),
            coalesce((v_fiscal->>'totalAmount')::numeric, 0),
            coalesce(v_fiscal->>'taxName', 'IGIC'),
            coalesce((v_fiscal->>'taxRate')::numeric, 0),
            coalesce((v_fiscal->>'taxableBase')::numeric, 0),
            coalesce((v_fiscal->>'taxAmount')::numeric, 0),
            coalesce(v_payload->'legalData', '{}'::jsonb),
            v_payload,
            nullif(v_fiscal->>'previousHash', ''),
            v_fiscal->>'hash',
            'pending',
            null,
            coalesce(v_fiscal->>'sifId', 'ESENCIA-OFFLINE-' || p_device_id),
            true
          ) on conflict (sale_id) do nothing;
        end if;

      elsif v_kind = 'closure.upsert' then
        if exists (
          select 1
          from public.sync_operations pending_operation
          where pending_operation.device_id = p_device_id
            and pending_operation.sequence < v_sequence
            and pending_operation.status <> 'synced'
        ) then
          raise exception 'No se puede sincronizar el cierre mientras existan operaciones economicas anteriores pendientes';
        end if;

        insert into public.cash_closures(
          id, business_date, shift_number, shift_start_at, opening_cash,
          expected_cash, counted_cash, cash_difference, expected_card, bbva_total,
          card_difference, total_sales, total_refunds, transactions_count,
          staff_id, staff_name, notes, payload, closed_at
        ) values (
          v_entity_id,
          (v_payload->>'businessDate')::date,
          coalesce((v_payload->>'shiftNumber')::integer, 1),
          nullif(v_payload->>'shiftStartAt', '')::timestamptz,
          coalesce((v_payload->>'openingCash')::numeric, 0),
          coalesce((v_payload->>'expectedCash')::numeric, 0),
          coalesce((v_payload->>'countedCash')::numeric, 0),
          coalesce((v_payload->>'cashDifference')::numeric, 0),
          coalesce((v_payload->>'expectedCard')::numeric, 0),
          coalesce((v_payload->>'bbvaTotal')::numeric, 0),
          coalesce((v_payload->>'cardDifference')::numeric, 0),
          coalesce((v_payload->>'totalSales')::numeric, 0),
          coalesce((v_payload->>'totalRefunds')::numeric, 0),
          coalesce((v_payload->>'transactionsCount')::integer, 0),
          nullif(v_payload#>>'{staff,id}', ''),
          nullif(v_payload#>>'{staff,name}', ''),
          nullif(v_payload->>'notes', ''),
          v_payload,
          coalesce((v_payload->>'closedAt')::timestamptz, v_occurred_at)
        ) on conflict (id) do update set
          counted_cash = excluded.counted_cash,
          cash_difference = excluded.cash_difference,
          bbva_total = excluded.bbva_total,
          card_difference = excluded.card_difference,
          notes = excluded.notes,
          payload = excluded.payload;

      elsif v_kind = 'shared_state.upsert' then
        update public.tpv_state set
          tables = coalesce(v_payload->'tables', tables),
          direct_sale = jsonb_build_object(
            'items', coalesce(v_payload#>'{directSaleTicket,items}', '[]'::jsonb),
            'legal_data', coalesce(v_payload->'legal', '{}'::jsonb),
            'role_permissions', coalesce(v_payload->'rolePermissions', '{}'::jsonb),
            'kds_state', coalesce(v_payload->'kdsState', '{}'::jsonb)
          ),
          legal_data = coalesce(v_payload->'legal', legal_data),
          role_permissions = coalesce(v_payload->'rolePermissions', role_permissions),
          updated_at = clock_timestamp()
        where id = 'global';
      else
        raise exception 'Tipo de operacion no soportado: %', v_kind;
      end if;

      update public.sync_operations set
        status = 'synced',
        result = jsonb_build_object('entity_id', v_entity_id),
        processed_at = clock_timestamp()
      where operation_id = v_operation_id;
    exception when unique_violation then
      v_status := 'conflict';
      v_error := sqlerrm;
      update public.sync_operations set
        status = v_status, error = v_error, processed_at = clock_timestamp()
      where operation_id = v_operation_id;
    when others then
      v_status := 'failed';
      v_error := sqlerrm;
      insert into public.sync_operations(
        operation_id, device_id, session_id, sequence, kind, entity_id,
        payload, status, error, occurred_at, processed_at
      ) values (
        v_operation_id, p_device_id, nullif(p_session_id, ''), v_sequence,
        v_kind, v_entity_id, v_payload, v_status, v_error, v_occurred_at, clock_timestamp()
      ) on conflict (operation_id) do update set
        status = excluded.status,
        error = excluded.error,
        processed_at = excluded.processed_at;
    end;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'operation_id', v_operation_id,
      'status', v_status,
      'error', v_error
    ));
  end loop;

  if p_session_id is not null and btrim(p_session_id) <> '' then
    update public.offline_sessions set
      last_sequence = coalesce((select max((value->>'sequence')::bigint) from jsonb_array_elements(p_operations)), last_sequence),
      updated_at = clock_timestamp()
    where id = p_session_id;
  end if;

  return v_result;
end;
$$;

grant execute on function public.apply_offline_batch(text, text, jsonb) to anon, authenticated;

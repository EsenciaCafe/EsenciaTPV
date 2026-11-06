-- No new payment implementation: guard the existing atomic/fiscal finalizer.
create index if not exists sale_lines_ticket_item_id_idx
on public.sale_lines(ticket_item_id) where ticket_item_id is not null;

create or replace function public.kds_checkout_snapshot(p_items jsonb)
returns jsonb language sql immutable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'ticketItemId', coalesce(i->>'ticketItemId', ''),
    'id', coalesce(i->>'id', ''), 'name', coalesce(i->>'name', ''),
    'qty', coalesce((i->>'qty')::numeric, 0),
    'price', coalesce((i->>'price')::numeric, 0),
    'discountPercent', coalesce((i->>'discountPercent')::numeric, 0),
    'clubPromotion', i->'clubPromotion',
    'selectedOptions', coalesce(nullif(i->'selectedOptions', 'null'::jsonb), '[]'::jsonb)
  ) order by (i->>'ticketItemId') collate "C"), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i;
$$;

create or replace function public.get_kds_checkout_table(p_table_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_table jsonb;
begin
  select t into v_table from public.tpv_state s,
    lateral jsonb_array_elements(s.tables) t
    where s.id = 'global' and t->>'id' = p_table_id;
  if v_table is null or jsonb_array_length(coalesce(v_table->'items', '[]'::jsonb)) = 0 then
    raise exception 'La mesa ya no tiene una cuenta abierta';
  end if;
  if exists (select 1 from jsonb_array_elements(v_table->'items') i
    where coalesce(i->>'ticketItemId', '') = '') then
    raise exception 'La comanda necesita sincronizar sus identificadores antes de cobrar';
  end if;
  if exists (select 1 from public.sale_lines l join public.sales s on s.id = l.sale_id
    where coalesce(s.type, 'sale') <> 'refund' and l.ticket_item_id in
    (select i->>'ticketItemId' from jsonb_array_elements(v_table->'items') i)) then
    raise exception 'Esta comanda ya tiene un cobro registrado. Revisa Transacciones; no vuelvas a cobrar';
  end if;
  return v_table;
end;
$$;

create or replace function public.guard_kds_sale()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_table jsonb; v_guard jsonb := new.payload->'kdsCheckout';
begin
  if coalesce(new.type, 'sale') = 'refund' then return new; end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.fiscal_documents where sale_id = new.id) then
    return new;
  end if;
  -- All online writers take the same lock, including a TPV already open elsewhere.
  perform pg_advisory_xact_lock(72601106);
  if exists (select 1 from public.sale_lines l join public.sales s on s.id = l.sale_id
    where s.id <> new.id and coalesce(s.type, 'sale') <> 'refund'
      and (v_guard is not null or s.payload ? 'kdsCheckout')
      and l.ticket_item_id in (select i->>'ticketItemId'
        from jsonb_array_elements(coalesce(new.payload->'items', '[]'::jsonb)) i)) then
    raise exception 'Esta comanda ya se ha cobrado en otro dispositivo. No repitas el pago';
  end if;
  if v_guard is null then return new; end if;
  -- Acknowledgement retries remain idempotent and keep the original document.
  if exists (select 1 from public.fiscal_documents where sale_id = new.id) then
    return new;
  end if;
  perform 1 from public.tpv_state where id = 'global' for update;
  v_table := public.get_kds_checkout_table(v_guard->>'tableId');
  if public.kds_checkout_snapshot(v_table->'items') <> v_guard->'snapshot'
    or public.kds_checkout_snapshot(new.payload->'items') <> v_guard->'snapshot' then
    raise exception 'La mesa ha cambiado. Revisa la cuenta antes de confirmar el cobro';
  end if;
  return new;
end;
$$;

create or replace function public.close_kds_sale_table()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.payload ? 'kdsCheckout' and coalesce(new.type, 'sale') <> 'refund'
    and not exists (select 1 from public.fiscal_documents where sale_id = new.id) then
    update public.tpv_state set tables = (
      select jsonb_agg(case when t->>'id' = new.payload#>>'{kdsCheckout,tableId}'
        then (t - 'checkoutAttempt' - 'clubContext' - 'loyaltyAwarded')
          || '{"items":[],"status":"available"}'::jsonb else t end order by n)
      from jsonb_array_elements(tables) with ordinality as e(t,n)
    ), updated_at = clock_timestamp() where id = 'global';
  end if;
  return new;
end;
$$;

create trigger guard_kds_sale before insert or update on public.sales
for each row execute function public.guard_kds_sale();
create trigger close_kds_sale_table after insert or update on public.sales
for each row execute function public.close_kds_sale_table();

revoke all on function public.kds_checkout_snapshot(jsonb) from public;
revoke all on function public.get_kds_checkout_table(text) from public;
revoke all on function public.guard_kds_sale() from public;
revoke all on function public.close_kds_sale_table() from public;
grant execute on function public.kds_checkout_snapshot(jsonb), public.get_kds_checkout_table(text) to anon, authenticated;

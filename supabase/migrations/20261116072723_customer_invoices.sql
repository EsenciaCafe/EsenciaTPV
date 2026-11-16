-- Customer PII is private: only the PIN-authenticated backend can access it.
create table tpv_bridge_private.customer_invoice_counters (
  series text primary key,
  next_number integer not null check(next_number > 0)
);
create table tpv_bridge_private.customer_invoices (
  id uuid primary key,
  ordinal bigint generated always as identity unique,
  sale_id text not null unique references public.sales(id) on delete restrict,
  original_document_id text not null references public.fiscal_documents(id) on delete restrict,
  series text not null,
  number integer not null check(number > 0),
  hash text not null unique check(length(hash)=64),
  document jsonb not null,
  created_at timestamptz not null default now(),
  unique(series,number),
  check(document->>'documentType'='replacement_invoice'),
  check(document->>'saleId'=sale_id),
  check(document->>'hash'=hash)
);
alter table tpv_bridge_private.customer_invoice_counters enable row level security;
alter table tpv_bridge_private.customer_invoices enable row level security;
revoke all on tpv_bridge_private.customer_invoice_counters, tpv_bridge_private.customer_invoices from public, anon, authenticated;
revoke all on sequence tpv_bridge_private.customer_invoices_ordinal_seq from public, anon, authenticated;

create function tpv_bridge_private.prevent_customer_invoice_change() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'La factura emitida es inmutable. Requiere un procedimiento de rectificacion.';
end;
$$;
revoke all on function tpv_bridge_private.prevent_customer_invoice_change() from public, anon, authenticated;
create trigger customer_invoice_immutable before update or delete on tpv_bridge_private.customer_invoices
for each row execute function tpv_bridge_private.prevent_customer_invoice_change();

-- Preserve existing PIN sessions and all previous permissions.
update tpv_bridge_private.employees e set permissions = array(
  select distinct p from unnest(e.permissions || array['invoice_get','invoice_issue']) p
);

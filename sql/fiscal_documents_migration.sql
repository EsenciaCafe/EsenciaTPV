-- fiscal_documents_migration.sql - Nucleo fiscal VeriFactu-ready
-- Ejecutar en Supabase SQL Editor antes de activar el uso fiscal real.

create extension if not exists pgcrypto;

create table if not exists fiscal_counters (
  series      text primary key,
  next_number integer not null default 1,
  updated_at  timestamptz not null default now()
);

create table if not exists fiscal_documents (
  id              text primary key default gen_random_uuid()::text,
  sale_id         text not null unique references sales(id) on delete restrict,
  document_type   text not null check (document_type in ('simplified_invoice', 'refund')),
  status          text not null default 'issued' check (status in ('issued', 'cancelled')),
  series          text not null,
  number          integer not null,
  fiscal_number   text not null unique,
  issued_at       timestamptz not null default now(),
  total_amount    numeric(10,2) not null default 0.00,
  tax_name        text not null default 'IGIC',
  tax_rate        numeric(5,2) not null default 0.00,
  taxable_base    numeric(10,2) not null default 0.00,
  tax_amount      numeric(10,2) not null default 0.00,
  legal_data      jsonb not null default '{}',
  payload         jsonb not null default '{}',
  previous_hash   text,
  hash            text not null unique,
  aeat_status     text not null default 'pending' check (aeat_status in ('pending', 'ready', 'sent', 'accepted', 'rejected')),
  aeat_response   jsonb not null default '{}',
  qr_payload      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists fiscal_documents_issued_at_idx on fiscal_documents (issued_at desc);
create index if not exists fiscal_documents_sale_id_idx on fiscal_documents (sale_id);
create index if not exists fiscal_documents_type_idx on fiscal_documents (document_type);

create or replace function public.create_fiscal_document(
  p_sale_id text,
  p_document_type text default null
)
returns fiscal_documents
language plpgsql
as $$
declare
  v_existing fiscal_documents%rowtype;
  v_sale sales%rowtype;
  v_type text;
  v_year text;
  v_series text;
  v_number integer;
  v_fiscal_number text;
  v_legal jsonb;
  v_tax_name text;
  v_tax_rate numeric;
  v_total numeric;
  v_base numeric;
  v_tax numeric;
  v_previous_hash text;
  v_hash_source text;
  v_hash text;
  v_qr_payload text;
  v_doc fiscal_documents%rowtype;
begin
  select * into v_existing
  from fiscal_documents
  where sale_id = p_sale_id;

  if found then
    return v_existing;
  end if;

  select * into v_sale
  from sales
  where id = p_sale_id;

  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  v_type := coalesce(
    p_document_type,
    case when v_sale.type = 'refund' then 'refund' else 'simplified_invoice' end
  );

  if v_type not in ('simplified_invoice', 'refund') then
    raise exception 'Invalid fiscal document type: %', v_type;
  end if;

  -- Evita carreras entre tablets al numerar y encadenar documentos.
  perform pg_advisory_xact_lock(hashtext('esencia-tpv-fiscal-chain'));

  v_year := to_char(coalesce(v_sale.closed_at, now()), 'YYYY');
  v_series := case when v_type = 'refund' then 'R' else 'S' end || v_year;

  insert into fiscal_counters (series, next_number)
  values (v_series, 1)
  on conflict (series) do nothing;

  update fiscal_counters
  set next_number = next_number + 1,
      updated_at = now()
  where series = v_series
  returning next_number - 1 into v_number;

  v_fiscal_number := v_series || '-' || lpad(v_number::text, 6, '0');
  v_legal := coalesce(v_sale.legal_data, '{}'::jsonb);
  v_tax_name := coalesce(nullif(v_legal->>'taxName', ''), 'IGIC');
  v_tax_rate := coalesce(nullif(v_legal->>'taxRate', '')::numeric, 0);
  v_total := coalesce(v_sale.total_amount, 0);
  v_base := case
    when v_tax_rate = 0 then v_total
    else round(v_total / (1 + (v_tax_rate / 100)), 2)
  end;
  v_tax := round(v_total - v_base, 2);

  select hash into v_previous_hash
  from fiscal_documents
  order by issued_at desc, number desc
  limit 1;

  v_qr_payload := jsonb_build_object(
    'issuer_nif', v_legal->>'nif',
    'number', v_fiscal_number,
    'date', to_char(coalesce(v_sale.closed_at, now()), 'YYYY-MM-DD'),
    'total', v_total,
    'tax', v_tax_name,
    'mode', 'verifactu-ready'
  )::text;

  v_hash_source := concat_ws('|',
    coalesce(v_previous_hash, ''),
    v_fiscal_number,
    v_type,
    coalesce(v_sale.closed_at, now())::text,
    v_total::text,
    v_base::text,
    v_tax::text,
    coalesce(v_legal->>'nif', ''),
    coalesce(v_sale.id, '')
  );
  v_hash := encode(digest(v_hash_source, 'sha256'), 'hex');

  insert into fiscal_documents (
    sale_id,
    document_type,
    series,
    number,
    fiscal_number,
    issued_at,
    total_amount,
    tax_name,
    tax_rate,
    taxable_base,
    tax_amount,
    legal_data,
    payload,
    previous_hash,
    hash,
    qr_payload
  )
  values (
    v_sale.id,
    v_type,
    v_series,
    v_number,
    v_fiscal_number,
    coalesce(v_sale.closed_at, now()),
    v_total,
    v_tax_name,
    v_tax_rate,
    v_base,
    v_tax,
    v_legal,
    v_sale.payload,
    v_previous_hash,
    v_hash,
    v_qr_payload
  )
  returning * into v_doc;

  return v_doc;
end;
$$;

grant all on fiscal_counters to anon;
grant all on fiscal_documents to anon;
grant all on fiscal_counters to authenticated;
grant all on fiscal_documents to authenticated;
grant execute on function public.create_fiscal_document(text, text) to anon;
grant execute on function public.create_fiscal_document(text, text) to authenticated;

alter table if exists fiscal_counters disable row level security;
alter table if exists fiscal_documents disable row level security;

-- accounting_app_migration.sql
-- Aplicacion contable para autonomos canarios.
-- Ejecutar despues de sales_migration.sql, fiscal_documents_migration.sql y
-- cash_closures_migration.sql.

create extension if not exists pgcrypto;
create schema if not exists accounting_private;

create table if not exists accounting_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text not null default '',
  nif text not null default '',
  currency text not null default 'EUR',
  timezone text not null default 'Atlantic/Canary',
  tax_name text not null default 'IGIC',
  accounting_regime text not null default 'direct_simplified'
    check (accounting_regime in ('direct_simplified', 'direct_normal')),
  prorata_rate numeric(5,2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  year integer not null,
  regime text not null check (regime in ('direct_simplified', 'direct_normal')),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, year)
);

create table if not exists accounting_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  kind text not null check (kind in ('customer', 'supplier', 'both')),
  name text not null,
  legal_name text not null default '',
  tax_id text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  default_account_code text,
  tags jsonb not null default '[]',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bookkeeping_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  contact_id uuid references accounting_contacts(id) on delete set null,
  source_type text not null default 'manual'
    check (source_type in ('manual', 'tpv', 'drive_json', 'import')),
  source_id text,
  direction text not null check (direction in ('sale', 'purchase')),
  document_type text not null
    check (document_type in ('simplified_invoice', 'invoice', 'credit_note', 'ticket', 'expense', 'payroll', 'asset')),
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'approved', 'partially_paid', 'paid', 'overdue', 'voided', 'rectified')),
  series text not null default '',
  number text not null default '',
  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'EUR',
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  withholding_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  payment_method text,
  category text,
  notes text,
  tags jsonb not null default '[]',
  original_document_id uuid references bookkeeping_documents(id) on delete restrict,
  attachment_url text,
  source_payload jsonb not null default '{}',
  immutable_hash text,
  approved_at timestamptz,
  created_by text not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, source_type, source_id)
);

create unique index if not exists bookkeeping_documents_supplier_number_idx
  on bookkeeping_documents (business_id, direction, contact_id, number, issue_date, total_amount)
  where direction = 'purchase' and number <> '' and status <> 'voided';
create index if not exists bookkeeping_documents_date_idx
  on bookkeeping_documents (business_id, issue_date desc);
create index if not exists bookkeeping_documents_status_idx
  on bookkeeping_documents (business_id, status);

create or replace function public.accounting_protect_document()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.status in ('approved','paid','partially_paid','rectified') then
    raise exception 'Los documentos aprobados no se eliminan; crea una rectificativa';
  end if;
  if tg_op = 'UPDATE' and old.status in ('approved','paid','partially_paid','rectified')
    and (
      new.direction, new.document_type, new.series, new.number, new.issue_date,
      new.subtotal, new.tax_amount, new.withholding_amount, new.total_amount,
      new.immutable_hash
    ) is distinct from (
      old.direction, old.document_type, old.series, old.number, old.issue_date,
      old.subtotal, old.tax_amount, old.withholding_amount, old.total_amount,
      old.immutable_hash
    )
  then
    raise exception 'Documento emitido inalterable; crea una rectificativa';
  end if;
  if exists (
    select 1 from accounting_tax_periods p
    where p.business_id = old.business_id and p.status = 'locked'
      and old.issue_date between p.starts_on and p.ends_on
  ) then
    raise exception 'El periodo fiscal esta bloqueado';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
drop trigger if exists bookkeeping_documents_protect_trigger on bookkeeping_documents;
create trigger bookkeeping_documents_protect_trigger
before update or delete on bookkeeping_documents
for each row execute function public.accounting_protect_document();

create table if not exists bookkeeping_document_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  document_id uuid not null references bookkeeping_documents(id) on delete cascade,
  position integer not null default 1,
  description text not null,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(12,4) not null default 0,
  taxable_base numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 7,
  tax_amount numeric(12,2) not null default 0,
  tax_scope text not null default 'taxable'
    check (tax_scope in ('taxable', 'exempt', 'not_subject')),
  withholding_rate numeric(5,2) not null default 0,
  withholding_amount numeric(12,2) not null default 0,
  account_code text,
  created_at timestamptz not null default now()
);

create table if not exists accounting_due_dates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  document_id uuid not null references bookkeeping_documents(id) on delete cascade,
  due_date date not null,
  amount numeric(12,2) not null,
  paid_amount numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'partial', 'paid', 'overdue')),
  created_at timestamptz not null default now()
);

create table if not exists accounting_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  name text not null,
  iban_last4 text not null default '',
  currency text not null default 'EUR',
  opening_balance numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists accounting_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  bank_account_id uuid references accounting_bank_accounts(id) on delete cascade,
  booked_on date not null,
  value_on date,
  description text not null,
  reference text not null default '',
  amount numeric(12,2) not null,
  balance numeric(12,2),
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending', 'matched', 'ignored')),
  import_batch text,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (business_id, fingerprint)
);

create table if not exists accounting_reconciliations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  bank_transaction_id uuid not null references accounting_bank_transactions(id) on delete cascade,
  document_id uuid references bookkeeping_documents(id) on delete cascade,
  tpv_sale_id text,
  amount numeric(12,2) not null,
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  score numeric(5,2) not null default 0,
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists accounting_reconciliations_match_idx
  on accounting_reconciliations (business_id, bank_transaction_id, document_id);

create table if not exists accounting_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  code text not null,
  name text not null,
  kind text not null check (kind in ('asset', 'liability', 'equity', 'income', 'expense')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, code)
);

create table if not exists accounting_journal_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  entry_number bigint,
  entry_date date not null,
  description text not null,
  source_type text not null default 'manual',
  source_id text,
  status text not null default 'draft' check (status in ('draft', 'posted', 'reversed')),
  reviewed boolean not null default false,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique (business_id, source_type, source_id)
);

create table if not exists accounting_journal_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  entry_id uuid not null references accounting_journal_entries(id) on delete cascade,
  account_id uuid not null references accounting_accounts(id) on delete restrict,
  description text not null default '',
  debit numeric(12,2) not null default 0,
  credit numeric(12,2) not null default 0,
  contact_id uuid references accounting_contacts(id) on delete set null,
  document_id uuid references bookkeeping_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  check (debit >= 0 and credit >= 0 and not (debit > 0 and credit > 0))
);

create or replace function public.accounting_require_balanced_entry()
returns trigger language plpgsql
set search_path = public
as $$
declare
  v_debit numeric;
  v_credit numeric;
begin
  if new.status <> 'posted' then return new; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0)
  into v_debit, v_credit
  from accounting_journal_lines where entry_id=new.id;
  if round(v_debit,2) <> round(v_credit,2) or v_debit = 0 then
    raise exception 'El asiento no esta cuadrado: debe %, haber %', v_debit, v_credit;
  end if;
  return new;
end;
$$;
drop trigger if exists accounting_entries_balance_trigger on accounting_journal_entries;
create trigger accounting_entries_balance_trigger
before update of status on accounting_journal_entries
for each row when (new.status='posted')
execute function public.accounting_require_balanced_entry();

create table if not exists accounting_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  document_id uuid references bookkeeping_documents(id) on delete set null,
  name text not null,
  acquired_on date not null,
  cost numeric(12,2) not null,
  useful_life_months integer not null,
  residual_value numeric(12,2) not null default 0,
  account_code text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists accounting_tax_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  year integer not null,
  quarter integer check (quarter between 1 and 4),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check (status in ('open', 'locked')),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, year, quarter)
);

create table if not exists accounting_tax_drafts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  period_id uuid references accounting_tax_periods(id) on delete cascade,
  model text not null check (model in ('420', '425', '130')),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'exported')),
  totals jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (business_id, period_id, model)
);

create table if not exists accounting_drive_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  source_folder_id text not null default '',
  result_folder_id text not null default '',
  enabled boolean not null default true,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_drive_imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  drive_file_id text not null,
  drive_revision text,
  checksum text,
  schema_version text not null,
  source_file_id text,
  status text not null default 'pending'
    check (status in ('pending', 'imported', 'duplicate', 'invalid', 'error')),
  document_id uuid references bookkeeping_documents(id) on delete set null,
  payload jsonb not null default '{}',
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, drive_file_id, drive_revision)
);

create table if not exists accounting_audit_log (
  id bigint generated always as identity primary key,
  business_id uuid references accounting_businesses(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  actor text not null default 'owner',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists accounting_private.devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  device_key_hash text not null unique,
  name text not null default 'Dispositivo',
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists accounting_private.sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  device_id uuid not null references accounting_private.devices(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists accounting_private.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references accounting_businesses(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists accounting_private.login_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  success boolean not null,
  attempted_at timestamptz not null default now()
);

create or replace function accounting_private.request_ip()
returns text language sql stable
set search_path = accounting_private
as $$
  select coalesce(
    split_part(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ',', 1),
    'unknown'
  )
$$;

create or replace function accounting_private.current_business_id()
returns uuid language sql stable security definer
set search_path = accounting_private, public, extensions
as $$
  select s.business_id
  from accounting_private.sessions s
  join accounting_private.devices d on d.id = s.device_id
  where s.token_hash = encode(digest(
    coalesce(current_setting('request.headers', true)::jsonb->>'x-accounting-session', ''),
    'sha256'
  ), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and d.active
  limit 1
$$;

revoke all on function accounting_private.current_business_id() from public;
grant execute on function accounting_private.current_business_id() to anon, authenticated;

create or replace function public.accounting_create_pairing_code(p_admin_pin text)
returns text
language plpgsql security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business accounting_businesses%rowtype;
  v_code text;
  v_ip text := accounting_private.request_ip();
  v_failures integer;
begin
  select count(*) into v_failures
  from accounting_private.login_attempts
  where ip = v_ip and not success and attempted_at > now() - interval '15 minutes';
  if v_failures >= 5 then raise exception 'Demasiados intentos. Espera 15 minutos.'; end if;

  if not exists (
    select 1 from staff_profiles
    where role = 'admin' and active is not false and pin_code = p_admin_pin
  ) then
    insert into accounting_private.login_attempts(ip, success) values (v_ip, false);
    raise exception 'PIN de administrador no valido';
  end if;

  select * into v_business from accounting_businesses where active order by created_at limit 1;
  if v_business.id is null then
    insert into accounting_businesses(name, legal_name, nif)
    select
      coalesce(nullif(t.direct_sale->'legal'->>'businessName', ''), 'Mi negocio'),
      coalesce(nullif(t.direct_sale->'legal'->>'companyName', ''), ''),
      coalesce(nullif(t.direct_sale->'legal'->>'nif', ''), '')
    from tpv_state t order by updated_at desc limit 1
    returning * into v_business;
    if v_business.id is null then
      insert into accounting_businesses(name) values ('Mi negocio') returning * into v_business;
    end if;
  end if;

  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
  insert into accounting_private.pairing_codes(business_id, code_hash, expires_at)
  values (v_business.id, encode(digest(v_code, 'sha256'), 'hex'), now() + interval '10 minutes');
  insert into accounting_private.login_attempts(ip, success) values (v_ip, true);
  return v_code;
end;
$$;

create or replace function public.accounting_pair_device(
  p_pairing_code text,
  p_device_key text,
  p_device_name text default 'Dispositivo'
)
returns jsonb
language plpgsql security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_pair accounting_private.pairing_codes%rowtype;
  v_device accounting_private.devices%rowtype;
  v_token text;
begin
  select * into v_pair from accounting_private.pairing_codes
  where code_hash = encode(digest(upper(trim(p_pairing_code)), 'sha256'), 'hex')
    and used_at is null and expires_at > now()
  for update;
  if v_pair.id is null then raise exception 'Codigo de vinculacion no valido o caducado'; end if;
  if length(p_device_key) < 32 then raise exception 'Identificador de dispositivo no valido'; end if;

  insert into accounting_private.devices(business_id, device_key_hash, name)
  values (
    v_pair.business_id,
    encode(digest(p_device_key, 'sha256'), 'hex'),
    left(coalesce(nullif(trim(p_device_name), ''), 'Dispositivo'), 80)
  )
  on conflict (device_key_hash) do update
    set active = true, name = excluded.name, last_seen_at = now()
  returning * into v_device;

  update accounting_private.pairing_codes set used_at = now() where id = v_pair.id;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into accounting_private.sessions(business_id, device_id, token_hash, expires_at)
  values (v_pair.business_id, v_device.id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days');
  return jsonb_build_object('token', v_token, 'expires_at', now() + interval '30 days');
end;
$$;

create or replace function public.accounting_resume_device(p_device_key text)
returns jsonb
language plpgsql security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_device accounting_private.devices%rowtype;
  v_token text;
begin
  select * into v_device from accounting_private.devices
  where device_key_hash = encode(digest(p_device_key, 'sha256'), 'hex') and active;
  if v_device.id is null then raise exception 'Dispositivo no vinculado'; end if;
  update accounting_private.devices set last_seen_at = now() where id = v_device.id;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into accounting_private.sessions(business_id, device_id, token_hash, expires_at)
  values (v_device.business_id, v_device.id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days');
  return jsonb_build_object('token', v_token, 'expires_at', now() + interval '30 days');
end;
$$;

create or replace function public.accounting_revoke_current_session()
returns boolean language plpgsql security definer
set search_path = public, accounting_private, extensions
as $$
begin
  update accounting_private.sessions set revoked_at = now()
  where token_hash = encode(digest(
    coalesce(current_setting('request.headers', true)::jsonb->>'x-accounting-session', ''),
    'sha256'
  ), 'hex');
  return found;
end;
$$;

revoke all on function public.accounting_create_pairing_code(text) from public;
revoke all on function public.accounting_pair_device(text, text, text) from public;
revoke all on function public.accounting_resume_device(text) from public;
revoke all on function public.accounting_revoke_current_session() from public;
grant execute on function public.accounting_create_pairing_code(text) to anon, authenticated;
grant execute on function public.accounting_pair_device(text, text, text) to anon, authenticated;
grant execute on function public.accounting_resume_device(text) to anon, authenticated;
grant execute on function public.accounting_revoke_current_session() to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounting_fiscal_years','accounting_contacts',
    'bookkeeping_documents','bookkeeping_document_lines','accounting_due_dates',
    'accounting_bank_accounts','accounting_bank_transactions','accounting_reconciliations',
    'accounting_accounts','accounting_journal_entries','accounting_journal_lines',
    'accounting_assets','accounting_tax_periods','accounting_tax_drafts',
    'accounting_drive_sources','accounting_drive_imports','accounting_audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (business_id = accounting_private.current_business_id()) with check (business_id = accounting_private.current_business_id())',
      t || '_owner', t
    );
  end loop;
end $$;

alter table accounting_businesses enable row level security;
revoke all on accounting_businesses from anon, authenticated;
grant select, update on accounting_businesses to anon, authenticated;
drop policy if exists accounting_businesses_owner on accounting_businesses;
create policy accounting_businesses_owner on accounting_businesses
  for all to anon, authenticated
  using (id = accounting_private.current_business_id())
  with check (id = accounting_private.current_business_id());

grant usage, select on all sequences in schema public to anon, authenticated;

create or replace function public.accounting_sync_tpv_sales()
returns integer language plpgsql security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_count integer;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  insert into bookkeeping_documents(
    business_id, source_type, source_id, direction, document_type, status,
    series, number, issue_date, currency, subtotal, tax_amount, total_amount,
    paid_amount, payment_method, source_payload, immutable_hash, approved_at
  )
  select
    v_business, 'tpv', s.id, 'sale',
    case when s.type = 'refund' then 'credit_note' else 'simplified_invoice' end,
    'paid',
    coalesce(fd.series, case when s.type = 'refund' then 'R' else 'S' end),
    coalesce(fd.fiscal_number, s.id),
    coalesce(s.closed_at, s.created_at)::date,
    'EUR',
    coalesce(fd.taxable_base, s.total_amount),
    coalesce(fd.tax_amount, 0),
    s.total_amount,
    s.total_amount,
    s.payment_method,
    jsonb_build_object('sale', s.payload, 'legal', s.legal_data),
    fd.hash,
    coalesce(fd.issued_at, s.closed_at, s.created_at)
  from sales s
  left join fiscal_documents fd on fd.sale_id = s.id
  on conflict (business_id, source_type, source_id) do update set
    status = excluded.status,
    number = excluded.number,
    subtotal = excluded.subtotal,
    tax_amount = excluded.tax_amount,
    total_amount = excluded.total_amount,
    paid_amount = excluded.paid_amount,
    source_payload = excluded.source_payload,
    immutable_hash = excluded.immutable_hash,
    updated_at = now();
  get diagnostics v_count = row_count;

  insert into bookkeeping_document_lines(
    business_id, document_id, position, description, quantity, unit_price,
    taxable_base, tax_rate, tax_amount, account_code
  )
  select
    v_business, d.id,
    row_number() over (partition by sl.sale_id order by sl.created_at, sl.id),
    sl.name, sl.quantity, sl.unit_price,
    case
      when coalesce(fd.tax_rate,0)=0 then sl.total_amount
      else round(sl.total_amount / (1 + fd.tax_rate/100), 2)
    end,
    coalesce(fd.tax_rate,0),
    case
      when coalesce(fd.tax_rate,0)=0 then 0
      else sl.total_amount - round(sl.total_amount / (1 + fd.tax_rate/100), 2)
    end,
    '700'
  from sale_lines sl
  join bookkeeping_documents d
    on d.business_id = v_business and d.source_type = 'tpv' and d.source_id = sl.sale_id
  left join fiscal_documents fd on fd.sale_id=sl.sale_id
  where not exists (
    select 1 from bookkeeping_document_lines dl
    where dl.document_id = d.id
  );
  return v_count;
end;
$$;

create or replace function public.accounting_post_document(p_document_id uuid)
returns uuid language plpgsql security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_doc bookkeeping_documents%rowtype;
  v_entry uuid;
  v_main_account uuid;
  v_tax_account uuid;
  v_counterpart uuid;
  v_withholding_account uuid;
  v_total numeric;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  select * into v_doc from bookkeeping_documents
  where id = p_document_id and business_id = v_business for update;
  if v_doc.id is null then raise exception 'Documento no encontrado'; end if;
  if v_doc.status in ('voided', 'rectified') then raise exception 'Documento no contabilizable'; end if;
  if exists (
    select 1 from accounting_tax_periods
    where business_id = v_business and status = 'locked'
      and v_doc.issue_date between starts_on and ends_on
  ) then raise exception 'El periodo fiscal esta bloqueado'; end if;

  select id into v_main_account from accounting_accounts
  where business_id = v_business and code = case when v_doc.direction='sale' then '700' else '600' end;
  select id into v_tax_account from accounting_accounts
  where business_id = v_business and code = case when v_doc.direction='sale' then '477' else '472' end;
  select id into v_counterpart from accounting_accounts
  where business_id = v_business and code = case when v_doc.direction='sale' then '430' else '400' end;
  select id into v_withholding_account from accounting_accounts
  where business_id = v_business and code = case when v_doc.direction='sale' then '473' else '4751' end;
  if v_main_account is null or v_tax_account is null or v_counterpart is null then
    raise exception 'Faltan cuentas contables base';
  end if;

  insert into accounting_journal_entries(
    business_id, entry_date, description, source_type, source_id, status, posted_at
  ) values (
    v_business, v_doc.issue_date, concat(v_doc.document_type, ' ', v_doc.number),
    'document', v_doc.id::text, 'draft', null
  )
  on conflict (business_id, source_type, source_id) do update set description=excluded.description
  returning id into v_entry;
  delete from accounting_journal_lines where entry_id = v_entry;
  v_total := v_doc.total_amount;

  if v_doc.direction = 'sale' then
    insert into accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
    values
      (v_business,v_entry,v_counterpart,v_total,0,v_doc.id),
      (v_business,v_entry,v_main_account,0,v_doc.subtotal,v_doc.id),
      (v_business,v_entry,v_tax_account,0,v_doc.tax_amount,v_doc.id);
    if v_doc.withholding_amount > 0 then
      update accounting_journal_lines
      set debit = v_doc.total_amount
      where entry_id=v_entry and account_id=v_counterpart;
      insert into accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
      values(v_business,v_entry,v_withholding_account,v_doc.withholding_amount,0,v_doc.id);
    end if;
  else
    insert into accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
    values
      (v_business,v_entry,v_main_account,v_doc.subtotal,0,v_doc.id),
      (v_business,v_entry,v_tax_account,v_doc.tax_amount,0,v_doc.id),
      (v_business,v_entry,v_counterpart,0,v_total,v_doc.id);
    if v_doc.withholding_amount > 0 then
      insert into accounting_journal_lines(business_id,entry_id,account_id,debit,credit,document_id)
      values(v_business,v_entry,v_withholding_account,0,v_doc.withholding_amount,v_doc.id);
    end if;
  end if;

  update accounting_journal_entries set status='posted', posted_at=now() where id=v_entry;
  update bookkeeping_documents set status='approved', approved_at=now(), updated_at=now()
  where id=v_doc.id;
  insert into accounting_audit_log(business_id,event_type,entity_type,entity_id,metadata)
  values(v_business,'document_posted','document',v_doc.id::text,jsonb_build_object('entry_id',v_entry));
  return v_entry;
end;
$$;

create or replace function public.accounting_generate_tax_draft(
  p_year integer, p_quarter integer, p_model text
)
returns jsonb language plpgsql security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_start date;
  v_end date;
  v_period uuid;
  v_totals jsonb;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  if p_model not in ('420','425','130') then raise exception 'Modelo no soportado'; end if;
  if p_model = '425' then
    v_start := make_date(p_year,1,1); v_end := make_date(p_year,12,31);
  else
    if p_quarter not between 1 and 4 then raise exception 'Trimestre no valido'; end if;
    v_start := make_date(p_year, ((p_quarter-1)*3)+1, 1);
    v_end := (v_start + interval '3 months - 1 day')::date;
  end if;
  select id into v_period from accounting_tax_periods
  where business_id=v_business and year=p_year
    and quarter is not distinct from (case when p_model='425' then null else p_quarter end);
  if v_period is null then
    insert into accounting_tax_periods(business_id,year,quarter,starts_on,ends_on)
    values(v_business,p_year,case when p_model='425' then null else p_quarter end,v_start,v_end)
    returning id into v_period;
  end if;

  select jsonb_build_object(
    'period_start', v_start, 'period_end', v_end,
    'sales_base', coalesce(sum(subtotal) filter(where direction='sale' and status not in ('voided','draft')),0),
    'igic_output', coalesce(sum(tax_amount) filter(where direction='sale' and status not in ('voided','draft')),0),
    'purchases_base', coalesce(sum(subtotal) filter(where direction='purchase' and status not in ('voided','draft')),0),
    'igic_input', coalesce(sum(tax_amount) filter(where direction='purchase' and status not in ('voided','draft')),0),
    'net_result',
      coalesce(sum(tax_amount) filter(where direction='sale' and status not in ('voided','draft')),0)
      - coalesce(sum(tax_amount) filter(where direction='purchase' and status not in ('voided','draft')),0),
    'income', coalesce(sum(total_amount) filter(where direction='sale' and status not in ('voided','draft')),0),
    'expenses', coalesce(sum(subtotal) filter(where direction='purchase' and status not in ('voided','draft')),0)
    ,'estimated_model_130',
      greatest(
        (
          coalesce(sum(subtotal) filter(where direction='sale' and status not in ('voided','draft')),0)
          - coalesce(sum(subtotal) filter(where direction='purchase' and status not in ('voided','draft')),0)
        ) * 0.20,
        0
      )
  ) into v_totals
  from bookkeeping_documents
  where business_id=v_business and issue_date between v_start and v_end;

  insert into accounting_tax_drafts(business_id,period_id,model,totals,generated_at)
  values(v_business,v_period,p_model,v_totals,now())
  on conflict (business_id,period_id,model) do update
    set totals=excluded.totals, generated_at=now(), status='draft';
  return v_totals;
end;
$$;

create or replace function public.accounting_suggest_reconciliations()
returns integer language plpgsql security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_count integer;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  insert into accounting_reconciliations(
    business_id,bank_transaction_id,document_id,amount,status,score,reason
  )
  select
    v_business,b.id,d.id,least(abs(b.amount),abs(d.total_amount-d.paid_amount)),
    'suggested',
    case when b.booked_on=d.issue_date then 100 else 85 end,
    case when b.booked_on=d.issue_date then 'Importe y fecha coinciden' else 'Importe coincide y fecha proxima' end
  from accounting_bank_transactions b
  join bookkeeping_documents d on d.business_id=v_business
    and abs(abs(b.amount)-abs(d.total_amount-d.paid_amount)) < 0.01
    and abs(b.booked_on-d.issue_date) <= 7
    and ((b.amount>0 and d.direction='sale') or (b.amount<0 and d.direction='purchase'))
  where b.business_id=v_business and b.status='pending'
    and d.status in ('approved','partially_paid','overdue')
  on conflict (business_id,bank_transaction_id,document_id) do update
    set score=excluded.score,reason=excluded.reason
  ;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.accounting_sync_tpv_sales() from public;
revoke all on function public.accounting_post_document(uuid) from public;
revoke all on function public.accounting_generate_tax_draft(integer,integer,text) from public;
grant execute on function public.accounting_sync_tpv_sales() to anon, authenticated;
grant execute on function public.accounting_post_document(uuid) to anon, authenticated;
grant execute on function public.accounting_generate_tax_draft(integer,integer,text) to anon, authenticated;
revoke all on function public.accounting_suggest_reconciliations() from public;
grant execute on function public.accounting_suggest_reconciliations() to anon, authenticated;

create or replace function public.accounting_seed_defaults()
returns boolean language plpgsql security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  insert into accounting_accounts(business_id,code,name,kind) values
    (v_business,'400','Proveedores','liability'),
    (v_business,'430','Clientes','asset'),
    (v_business,'472','Hacienda publica, IGIC soportado','asset'),
    (v_business,'477','Hacienda publica, IGIC repercutido','liability'),
    (v_business,'473','Hacienda publica, retenciones y pagos a cuenta','asset'),
    (v_business,'4751','Hacienda publica, acreedora por retenciones','liability'),
    (v_business,'570','Caja','asset'),
    (v_business,'572','Bancos','asset'),
    (v_business,'600','Compras y gastos','expense'),
    (v_business,'700','Ventas','income')
  on conflict (business_id,code) do nothing;
  insert into accounting_fiscal_years(business_id,year,regime,starts_on,ends_on)
  select v_business, extract(year from current_date)::int, accounting_regime,
    date_trunc('year',current_date)::date,
    (date_trunc('year',current_date)+interval '1 year - 1 day')::date
  from accounting_businesses where id=v_business
  on conflict (business_id,year) do nothing;
  return true;
end;
$$;
revoke all on function public.accounting_seed_defaults() from public;
grant execute on function public.accounting_seed_defaults() to anon, authenticated;

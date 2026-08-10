alter table public.accounting_bank_transactions
  add column if not exists review_scope text not null default 'included',
  add column if not exists excluded_at timestamptz,
  add column if not exists exclusion_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'accounting_bank_transactions_review_scope_check'
      and conrelid = 'public.accounting_bank_transactions'::regclass
  ) then
    alter table public.accounting_bank_transactions
      add constraint accounting_bank_transactions_review_scope_check
      check (review_scope in ('included', 'excluded'));
  end if;
end $$;

create index if not exists accounting_bank_transactions_review_scope_idx
  on public.accounting_bank_transactions (business_id, review_scope, booked_on desc);

create table if not exists public.accounting_bank_imports (
  id text primary key,
  business_id uuid not null references public.accounting_businesses(id) on delete cascade,
  bank_account_id uuid references public.accounting_bank_accounts(id) on delete set null,
  file_name text not null default 'Extracto bancario',
  file_size bigint not null default 0,
  file_checksum text not null default '',
  detected_start_on date,
  detected_end_on date,
  selected_start_on date,
  selected_end_on date,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  excluded_count integer not null default 0,
  status text not null default 'active'
    check (status in ('active', 'partially_excluded', 'excluded', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz
);

create index if not exists accounting_bank_imports_business_created_idx
  on public.accounting_bank_imports (business_id, created_at desc);

alter table public.accounting_bank_imports enable row level security;
revoke all on table public.accounting_bank_imports from public, anon, authenticated;
grant select, insert, update on table public.accounting_bank_imports to anon;

drop policy if exists accounting_bank_imports_owner on public.accounting_bank_imports;
create policy accounting_bank_imports_owner
on public.accounting_bank_imports
for all
to anon
using (business_id = (select accounting_private.current_business_id()))
with check (business_id = (select accounting_private.current_business_id()));

insert into public.accounting_bank_imports (
  id, business_id, bank_account_id, file_name,
  detected_start_on, detected_end_on, selected_start_on, selected_end_on,
  row_count, imported_count, excluded_count, status, created_at, updated_at
)
select
  transactions.import_batch,
  transactions.business_id,
  min(transactions.bank_account_id::text)::uuid,
  'Extracto importado anteriormente',
  min(transactions.booked_on),
  max(transactions.booked_on),
  min(transactions.booked_on),
  max(transactions.booked_on),
  count(*)::integer,
  count(*)::integer,
  0,
  'active',
  min(transactions.created_at),
  now()
from public.accounting_bank_transactions transactions
where nullif(transactions.import_batch, '') is not null
group by transactions.import_batch, transactions.business_id
on conflict (id) do nothing;

create or replace function public.accounting_set_bank_import_period(
  p_import_batch text,
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_total integer := 0;
  v_included integer := 0;
  v_excluded integer := 0;
  v_reviewed integer := 0;
  v_status text;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  if nullif(trim(p_import_batch), '') is null then raise exception 'Extracto no valido'; end if;
  if p_start is null or p_end is null or p_start > p_end then
    raise exception 'El periodo seleccionado no es valido';
  end if;

  select count(*)::integer into v_total
  from public.accounting_bank_transactions bank
  where bank.business_id = v_business and bank.import_batch = p_import_batch;
  if v_total = 0 then raise exception 'No se encontraron movimientos para este extracto'; end if;

  select count(*)::integer into v_reviewed
  from public.accounting_bank_transactions bank
  where bank.business_id = v_business
    and bank.import_batch = p_import_batch
    and bank.booked_on not between p_start and p_end
    and (
      bank.status <> 'pending'
      or exists (
        select 1 from public.accounting_reconciliations reconciliation
        where reconciliation.bank_transaction_id = bank.id
          and reconciliation.status = 'confirmed'
      )
      or exists (
        select 1 from public.accounting_bank_reviews review
        where review.bank_transaction_id = bank.id
          and review.status = 'active'
      )
    );

  update public.accounting_bank_transactions bank
  set review_scope = case when bank.booked_on between p_start and p_end then 'included' else 'excluded' end,
      excluded_at = case when bank.booked_on between p_start and p_end then null else now() end,
      exclusion_reason = case when bank.booked_on between p_start and p_end then null else 'Fuera del periodo elegido para el extracto' end
  where bank.business_id = v_business
    and bank.import_batch = p_import_batch;

  select
    count(*) filter (where bank.review_scope = 'included')::integer,
    count(*) filter (where bank.review_scope = 'excluded')::integer
  into v_included, v_excluded
  from public.accounting_bank_transactions bank
  where bank.business_id = v_business and bank.import_batch = p_import_batch;

  v_status := case
    when v_excluded = 0 then 'active'
    when v_included = 0 then 'excluded'
    else 'partially_excluded'
  end;

  insert into public.accounting_bank_imports (
    id, business_id, bank_account_id, file_name,
    detected_start_on, detected_end_on, selected_start_on, selected_end_on,
    row_count, imported_count, excluded_count, status
  )
  select
    p_import_batch, v_business, min(bank.bank_account_id::text)::uuid,
    'Extracto importado anteriormente', min(bank.booked_on), max(bank.booked_on),
    p_start, p_end, count(*)::integer, count(*)::integer, v_excluded, v_status
  from public.accounting_bank_transactions bank
  where bank.business_id = v_business and bank.import_batch = p_import_batch
  on conflict (id) do update set
    selected_start_on = excluded.selected_start_on,
    selected_end_on = excluded.selected_end_on,
    excluded_count = excluded.excluded_count,
    status = excluded.status,
    updated_at = now();

  insert into public.accounting_audit_log (
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business, 'bank_import_period_changed', 'bank_import', null,
    jsonb_build_object(
      'import_batch', p_import_batch,
      'selected_start_on', p_start,
      'selected_end_on', p_end,
      'included_count', v_included,
      'excluded_count', v_excluded,
      'reviewed_outside_count', v_reviewed
    )
  );

  return jsonb_build_object(
    'total_count', v_total,
    'included_count', v_included,
    'excluded_count', v_excluded,
    'reviewed_outside_count', v_reviewed
  );
end;
$$;

create or replace function public.accounting_undo_bank_import(p_import_batch text)
returns jsonb
language plpgsql
security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_total integer := 0;
  v_protected integer := 0;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;

  select count(*)::integer,
         count(*) filter (where bank.status <> 'pending')::integer
  into v_total, v_protected
  from public.accounting_bank_transactions bank
  where bank.business_id = v_business and bank.import_batch = p_import_batch;

  if v_total = 0 then raise exception 'Este extracto ya no contiene movimientos'; end if;
  if v_protected > 0 or exists (
    select 1
    from public.accounting_bank_transactions bank
    join public.accounting_reconciliations reconciliation on reconciliation.bank_transaction_id = bank.id
    where bank.business_id = v_business
      and bank.import_batch = p_import_batch
      and reconciliation.status = 'confirmed'
  ) or exists (
    select 1
    from public.accounting_bank_transactions bank
    join public.accounting_bank_reviews review on review.bank_transaction_id = bank.id
    where bank.business_id = v_business
      and bank.import_batch = p_import_batch
      and review.status = 'active'
  ) then
    raise exception 'No se puede deshacer: el extracto contiene movimientos ya revisados';
  end if;

  insert into public.accounting_audit_log (
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business, 'bank_import_undone', 'bank_import', null,
    jsonb_build_object('import_batch', p_import_batch, 'deleted_count', v_total)
  );

  delete from public.accounting_bank_transactions bank
  where bank.business_id = v_business and bank.import_batch = p_import_batch;

  update public.accounting_bank_imports
  set status = 'removed', removed_at = now(), updated_at = now(), excluded_count = 0
  where id = p_import_batch and business_id = v_business;

  return jsonb_build_object('deleted_count', v_total);
end;
$$;

create or replace function public.accounting_suggest_reconciliations()
returns integer
language plpgsql
security definer
set search_path = public, accounting_private, extensions
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_count integer;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  insert into public.accounting_reconciliations(
    business_id,bank_transaction_id,document_id,amount,status,score,reason
  )
  select
    v_business,b.id,d.id,least(abs(b.amount),abs(d.total_amount-d.paid_amount)),
    'suggested',
    case when b.booked_on=d.issue_date then 100 else 85 end,
    case when b.booked_on=d.issue_date then 'Importe y fecha coinciden' else 'Importe coincide y fecha proxima' end
  from public.accounting_bank_transactions b
  join public.bookkeeping_documents d on d.business_id=v_business
    and abs(abs(b.amount)-abs(d.total_amount-d.paid_amount)) < 0.01
    and abs(b.booked_on-d.issue_date) <= 7
    and ((b.amount>0 and d.direction='sale') or (b.amount<0 and d.direction='purchase'))
  where b.business_id=v_business
    and b.status='pending'
    and b.review_scope='included'
    and d.status in ('approved','partially_paid','overdue')
  on conflict (business_id,bank_transaction_id,document_id) do update
    set score=excluded.score,reason=excluded.reason;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.accounting_set_bank_import_period(text, date, date) from public, authenticated;
revoke all on function public.accounting_undo_bank_import(text) from public, authenticated;
grant execute on function public.accounting_set_bank_import_period(text, date, date) to anon;
grant execute on function public.accounting_undo_bank_import(text) to anon;

revoke all on function public.accounting_suggest_reconciliations() from public, authenticated;
grant execute on function public.accounting_suggest_reconciliations() to anon;

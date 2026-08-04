alter table public.bookkeeping_documents
  drop constraint if exists bookkeeping_documents_source_type_check;
alter table public.bookkeeping_documents
  add constraint bookkeeping_documents_source_type_check
  check (source_type in ('manual', 'tpv', 'drive_json', 'import', 'bank_classification'));

create table if not exists public.accounting_bank_reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.accounting_businesses(id) on delete cascade,
  bank_transaction_id uuid not null references public.accounting_bank_transactions(id) on delete cascade,
  classification text not null check (classification in (
    'tpv_card_settlement', 'cash_deposit', 'owner_contribution', 'owner_withdrawal',
    'tax_payment', 'bank_fee', 'social_security', 'expense_without_invoice',
    'other_income', 'ignore'
  )),
  status text not null default 'active' check (status in ('active', 'reversed')),
  notes text not null default '',
  document_id uuid references public.bookkeeping_documents(id) on delete restrict,
  journal_entry_id uuid references public.accounting_journal_entries(id) on delete restrict,
  reversal_entry_id uuid references public.accounting_journal_entries(id) on delete restrict,
  previous_bank_status text not null default 'pending',
  revision integer not null default 1,
  reviewed_at timestamptz not null default now(),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, bank_transaction_id)
);

alter table public.accounting_bank_reviews enable row level security;
revoke all on public.accounting_bank_reviews from anon, authenticated;
grant select on public.accounting_bank_reviews to anon, authenticated;
drop policy if exists accounting_bank_reviews_owner on public.accounting_bank_reviews;
create policy accounting_bank_reviews_owner
on public.accounting_bank_reviews
for select
to anon, authenticated
using (business_id = (select accounting_private.current_business_id()));

create index if not exists accounting_bank_reviews_business_status_idx
  on public.accounting_bank_reviews (business_id, status, reviewed_at desc);

insert into public.accounting_accounts(business_id, code, name, kind)
select business.id, seed.code, seed.name, seed.kind
from public.accounting_businesses business
cross join (values
  ('551', 'Cuenta corriente con el titular', 'equity'),
  ('555', 'Partidas pendientes de aplicacion', 'liability'),
  ('626', 'Servicios bancarios y similares', 'expense'),
  ('642', 'Seguridad Social a cargo del negocio', 'expense'),
  ('778', 'Ingresos excepcionales', 'income')
) as seed(code, name, kind)
on conflict (business_id, code) do nothing;

create or replace function public.accounting_create_manual_reconciliation(
  p_bank_transaction_id uuid,
  p_document_id uuid,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, accounting_private, pg_catalog
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_bank public.accounting_bank_transactions%rowtype;
  v_document public.bookkeeping_documents%rowtype;
  v_reconciliation_id uuid;
  v_amount numeric(12,2) := round(abs(coalesce(p_amount, 0)), 2);
  v_outstanding numeric(12,2);
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;

  select * into v_bank
  from public.accounting_bank_transactions
  where id = p_bank_transaction_id and business_id = v_business
  for update;
  select * into v_document
  from public.bookkeeping_documents
  where id = p_document_id and business_id = v_business
  for update;

  if v_bank.id is null or v_document.id is null then
    raise exception 'Movimiento o documento no encontrado';
  end if;
  if v_bank.status <> 'pending' then raise exception 'El movimiento ya no esta pendiente'; end if;
  if v_document.status not in ('approved', 'partially_paid', 'overdue') then
    raise exception 'El documento no esta pendiente de cobro o pago';
  end if;
  if (v_bank.amount > 0 and v_document.direction <> 'sale')
     or (v_bank.amount < 0 and v_document.direction <> 'purchase') then
    raise exception 'El signo del movimiento no corresponde al documento';
  end if;
  v_outstanding := greatest(0, v_document.total_amount - v_document.paid_amount);
  if v_amount <= 0
     or abs(v_amount - abs(v_bank.amount)) > 0.01
     or v_amount > v_outstanding + 0.01 then
    raise exception 'El importe no es valido para este movimiento y documento';
  end if;
  if exists (
    select 1 from public.accounting_bank_reviews review
    where review.business_id = v_business
      and review.bank_transaction_id = v_bank.id
      and review.status = 'active'
  ) then
    raise exception 'El movimiento ya tiene una clasificacion activa';
  end if;
  if exists (
    select 1 from public.accounting_reconciliations reconciliation
    where reconciliation.business_id = v_business
      and reconciliation.bank_transaction_id = v_bank.id
      and reconciliation.status in ('suggested', 'confirmed')
  ) then
    raise exception 'El movimiento ya tiene una conciliacion activa';
  end if;

  insert into public.accounting_reconciliations(
    business_id, bank_transaction_id, document_id, amount, status, score, reason
  ) values (
    v_business, v_bank.id, v_document.id, v_amount, 'suggested', 0,
    'Vinculacion manual: revisa banco y documento antes de confirmar'
  )
  on conflict (business_id, bank_transaction_id, document_id)
  do update set
    amount = excluded.amount,
    status = 'suggested',
    score = 0,
    reason = excluded.reason,
    confirmed_at = null,
    rejected_at = null,
    reversed_at = null
  returning id into v_reconciliation_id;

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business, 'manual_reconciliation_created', 'accounting_reconciliation',
    v_reconciliation_id::text,
    jsonb_build_object(
      'bank_transaction_id', v_bank.id,
      'document_id', v_document.id,
      'amount', v_amount
    )
  );

  return v_reconciliation_id;
end;
$$;

create or replace function public.accounting_classify_bank_transaction(
  p_bank_transaction_id uuid,
  p_classification text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, accounting_private, pg_catalog
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_bank public.accounting_bank_transactions%rowtype;
  v_review public.accounting_bank_reviews%rowtype;
  v_classification text := lower(btrim(coalesce(p_classification, '')));
  v_amount numeric(12,2);
  v_revision integer;
  v_source_id text;
  v_label text;
  v_counterpart_code text;
  v_bank_account uuid;
  v_counterpart_account uuid;
  v_document_id uuid;
  v_entry_id uuid;
  v_direction text;
  v_document_type text;
  v_category text;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  if v_classification not in (
    'tpv_card_settlement', 'cash_deposit', 'owner_contribution', 'owner_withdrawal',
    'tax_payment', 'bank_fee', 'social_security', 'expense_without_invoice',
    'other_income', 'ignore'
  ) then raise exception 'Clasificacion bancaria no valida'; end if;

  select * into v_bank
  from public.accounting_bank_transactions
  where id = p_bank_transaction_id and business_id = v_business
  for update;
  if v_bank.id is null then raise exception 'Movimiento bancario no encontrado'; end if;
  if v_bank.status <> 'pending' then raise exception 'El movimiento ya no esta pendiente'; end if;
  if exists (
    select 1 from public.accounting_reconciliations reconciliation
    where reconciliation.business_id = v_business
      and reconciliation.bank_transaction_id = v_bank.id
      and reconciliation.status in ('suggested', 'confirmed')
  ) then raise exception 'El movimiento ya tiene una conciliacion activa'; end if;

  if v_bank.amount > 0 and v_classification not in (
    'tpv_card_settlement', 'cash_deposit', 'owner_contribution', 'other_income', 'ignore'
  ) then raise exception 'La clasificacion elegida corresponde a una salida'; end if;
  if v_bank.amount < 0 and v_classification not in (
    'owner_withdrawal', 'tax_payment', 'bank_fee', 'social_security',
    'expense_without_invoice', 'ignore'
  ) then raise exception 'La clasificacion elegida corresponde a una entrada'; end if;

  select * into v_review
  from public.accounting_bank_reviews
  where business_id = v_business and bank_transaction_id = v_bank.id
  for update;
  if v_review.id is not null and v_review.status = 'active' then
    raise exception 'El movimiento ya esta clasificado';
  end if;

  v_amount := round(abs(v_bank.amount), 2);
  v_revision := coalesce(v_review.revision, 0) + 1;
  v_source_id := concat(v_bank.id::text, ':', v_revision);
  v_label := case v_classification
    when 'tpv_card_settlement' then 'Liquidacion de ventas TPV por tarjeta'
    when 'cash_deposit' then 'Ingreso de efectivo en banco'
    when 'owner_contribution' then 'Aportacion del titular'
    when 'owner_withdrawal' then 'Retirada del titular'
    when 'tax_payment' then 'Pago de impuestos'
    when 'bank_fee' then 'Comision bancaria'
    when 'social_security' then 'Seguridad Social'
    when 'expense_without_invoice' then 'Gasto sin factura justificativa'
    when 'other_income' then 'Otro ingreso no procedente del TPV'
    else 'Movimiento ignorado'
  end;
  v_counterpart_code := case v_classification
    when 'tpv_card_settlement' then '555'
    when 'cash_deposit' then '570'
    when 'owner_contribution' then '551'
    when 'owner_withdrawal' then '551'
    when 'tax_payment' then '473'
    when 'bank_fee' then '626'
    when 'social_security' then '642'
    when 'expense_without_invoice' then '600'
    when 'other_income' then '778'
    else null
  end;

  if v_classification in ('bank_fee', 'social_security', 'expense_without_invoice', 'other_income') then
    v_direction := case when v_bank.amount > 0 then 'sale' else 'purchase' end;
    v_document_type := case when v_bank.amount > 0 then 'invoice' else 'expense' end;
    v_category := v_label;
    insert into public.bookkeeping_documents(
      business_id, source_type, source_id, direction, document_type, status,
      series, number, issue_date, currency, subtotal, tax_amount,
      withholding_amount, total_amount, paid_amount, payment_method,
      category, notes, source_payload, approved_at
    ) values (
      v_business, 'bank_classification', v_source_id, v_direction, v_document_type, 'paid',
      'BANCO', concat('BANCO-', to_char(v_bank.booked_on, 'YYYYMMDD'), '-', v_revision),
      v_bank.booked_on, 'EUR', v_amount, 0, 0, v_amount, v_amount, 'bank',
      v_category, nullif(btrim(coalesce(p_notes, '')), ''),
      jsonb_build_object(
        'bank_transaction_id', v_bank.id,
        'classification', v_classification,
        'original_description', v_bank.description,
        'original_reference', v_bank.reference,
        'no_deductible_igic', true
      ), now()
    ) returning id into v_document_id;

    insert into public.bookkeeping_document_lines(
      business_id, document_id, position, description, quantity, unit_price,
      taxable_base, tax_rate, tax_amount, tax_scope, account_code
    ) values (
      v_business, v_document_id, 1, v_label, 1, v_amount,
      v_amount, 0, 0, 'not_subject', v_counterpart_code
    );

    if v_direction = 'purchase' then
      insert into public.accounting_document_analysis(
        document_id, business_id, category, cost_behavior, notes, updated_at
      ) values (
        v_document_id,
        v_business,
        case v_classification
          when 'bank_fee' then 'bank_fees'
          when 'social_security' then 'staff'
          else 'other'
        end,
        case when v_classification = 'bank_fee' then 'variable' else 'fixed' end,
        'Clasificacion confirmada desde el movimiento bancario',
        now()
      );
    end if;
  end if;

  if v_classification <> 'ignore' then
    select id into v_bank_account from public.accounting_accounts
    where business_id = v_business and code = '572';
    select id into v_counterpart_account from public.accounting_accounts
    where business_id = v_business and code = v_counterpart_code;
    if v_bank_account is null or v_counterpart_account is null then
      raise exception 'Faltan cuentas contables para esta clasificacion';
    end if;

    insert into public.accounting_journal_entries(
      business_id, entry_date, description, source_type, source_id, status, posted_at
    ) values (
      v_business, v_bank.booked_on,
      concat(v_label, ': ', left(v_bank.description, 140)),
      'bank_classification', v_source_id, 'posted', now()
    ) returning id into v_entry_id;

    if v_bank.amount > 0 then
      insert into public.accounting_journal_lines(
        business_id, entry_id, account_id, debit, credit, document_id
      ) values
        (v_business, v_entry_id, v_bank_account, v_amount, 0, v_document_id),
        (v_business, v_entry_id, v_counterpart_account, 0, v_amount, v_document_id);
    else
      insert into public.accounting_journal_lines(
        business_id, entry_id, account_id, debit, credit, document_id
      ) values
        (v_business, v_entry_id, v_counterpart_account, v_amount, 0, v_document_id),
        (v_business, v_entry_id, v_bank_account, 0, v_amount, v_document_id);
    end if;
  end if;

  if v_review.id is null then
    insert into public.accounting_bank_reviews(
      business_id, bank_transaction_id, classification, status, notes,
      document_id, journal_entry_id, previous_bank_status, revision,
      reviewed_at, reversed_at, updated_at
    ) values (
      v_business, v_bank.id, v_classification, 'active',
      btrim(coalesce(p_notes, '')), v_document_id, v_entry_id,
      v_bank.status, v_revision, now(), null, now()
    ) returning * into v_review;
  else
    update public.accounting_bank_reviews
    set classification = v_classification,
        status = 'active',
        notes = btrim(coalesce(p_notes, '')),
        document_id = v_document_id,
        journal_entry_id = v_entry_id,
        reversal_entry_id = null,
        previous_bank_status = v_bank.status,
        revision = v_revision,
        reviewed_at = now(),
        reversed_at = null,
        updated_at = now()
    where id = v_review.id
    returning * into v_review;
  end if;

  update public.accounting_bank_transactions
  set status = case when v_classification = 'ignore' then 'ignored' else 'matched' end
  where id = v_bank.id;

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business, 'bank_transaction_classified', 'bank_transaction', v_bank.id::text,
    jsonb_build_object(
      'review_id', v_review.id,
      'classification', v_classification,
      'amount', v_amount,
      'document_id', v_document_id,
      'journal_entry_id', v_entry_id,
      'revision', v_revision
    )
  );

  return jsonb_build_object(
    'review_id', v_review.id,
    'classification', v_classification,
    'document_id', v_document_id,
    'journal_entry_id', v_entry_id,
    'bank_status', case when v_classification = 'ignore' then 'ignored' else 'matched' end
  );
end;
$$;

create or replace function public.accounting_unclassify_bank_transaction(
  p_bank_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, accounting_private, pg_catalog
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_bank public.accounting_bank_transactions%rowtype;
  v_review public.accounting_bank_reviews%rowtype;
  v_entry public.accounting_journal_entries%rowtype;
  v_reversal_id uuid;
  v_source_id text;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;

  select * into v_bank
  from public.accounting_bank_transactions
  where id = p_bank_transaction_id and business_id = v_business
  for update;
  select * into v_review
  from public.accounting_bank_reviews
  where bank_transaction_id = p_bank_transaction_id
    and business_id = v_business
    and status = 'active'
  for update;
  if v_bank.id is null or v_review.id is null then
    raise exception 'Clasificacion bancaria activa no encontrada';
  end if;
  if v_review.document_id is not null and exists (
    select 1 from public.accounting_tax_periods period
    join public.bookkeeping_documents document on document.id = v_review.document_id
    where period.business_id = v_business
      and period.status = 'locked'
      and document.issue_date between period.starts_on and period.ends_on
  ) then raise exception 'El periodo fiscal esta bloqueado'; end if;

  if v_review.journal_entry_id is not null then
    select * into v_entry
    from public.accounting_journal_entries
    where id = v_review.journal_entry_id and business_id = v_business
    for update;
    if v_entry.id is null or v_entry.status <> 'posted' then
      raise exception 'El asiento original ya no se puede revertir automaticamente';
    end if;
    v_source_id := concat(v_bank.id::text, ':', v_review.revision, ':reversal');
    insert into public.accounting_journal_entries(
      business_id, entry_date, description, source_type, source_id, status, posted_at
    ) values (
      v_business, v_bank.booked_on,
      concat('Reversion: ', v_entry.description),
      'bank_classification_reversal', v_source_id, 'posted', now()
    ) returning id into v_reversal_id;

    insert into public.accounting_journal_lines(
      business_id, entry_id, account_id, debit, credit, contact_id, document_id
    )
    select business_id, v_reversal_id, account_id, credit, debit, contact_id, document_id
    from public.accounting_journal_lines
    where entry_id = v_entry.id;

    update public.accounting_journal_entries
    set status = 'reversed'
    where id = v_entry.id;
  end if;

  if v_review.document_id is not null then
    update public.bookkeeping_documents
    set status = 'voided', updated_at = now()
    where id = v_review.document_id and business_id = v_business;
  end if;

  update public.accounting_bank_transactions
  set status = v_review.previous_bank_status
  where id = v_bank.id;

  update public.accounting_bank_reviews
  set status = 'reversed',
      reversal_entry_id = v_reversal_id,
      reversed_at = now(),
      updated_at = now()
  where id = v_review.id;

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business, 'bank_transaction_classification_reversed', 'bank_transaction',
    v_bank.id::text,
    jsonb_build_object(
      'review_id', v_review.id,
      'classification', v_review.classification,
      'document_id', v_review.document_id,
      'journal_entry_id', v_review.journal_entry_id,
      'reversal_entry_id', v_reversal_id,
      'restored_bank_status', v_review.previous_bank_status
    )
  );

  return jsonb_build_object(
    'review_id', v_review.id,
    'status', 'reversed',
    'bank_status', v_review.previous_bank_status,
    'reversal_entry_id', v_reversal_id
  );
end;
$$;

revoke all on function public.accounting_create_manual_reconciliation(uuid, uuid, numeric) from public;
revoke all on function public.accounting_classify_bank_transaction(uuid, text, text) from public;
revoke all on function public.accounting_unclassify_bank_transaction(uuid) from public;
grant execute on function public.accounting_create_manual_reconciliation(uuid, uuid, numeric) to anon, authenticated;
grant execute on function public.accounting_classify_bank_transaction(uuid, text, text) to anon, authenticated;
grant execute on function public.accounting_unclassify_bank_transaction(uuid) to anon, authenticated;

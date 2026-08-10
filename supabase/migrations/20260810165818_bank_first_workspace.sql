alter table public.accounting_bank_reviews
  drop constraint if exists accounting_bank_reviews_classification_check;
alter table public.accounting_bank_reviews
  add constraint accounting_bank_reviews_classification_check
  check (classification in (
    'tpv_card_settlement', 'cash_deposit', 'owner_contribution', 'owner_withdrawal',
    'internal_transfer', 'loan_payment', 'tax_payment', 'bank_fee',
    'social_security', 'payroll', 'awaiting_document', 'expense_without_invoice',
    'other_income', 'ignore'
  ));

alter table public.accounting_bank_reviews
  drop constraint if exists accounting_bank_reviews_status_check;
alter table public.accounting_bank_reviews
  add constraint accounting_bank_reviews_status_check
  check (status in ('active', 'waiting_document', 'resolved', 'reversed'));

insert into public.accounting_accounts(business_id, code, name, kind)
select business.id, '640', 'Sueldos y salarios', 'expense'
from public.accounting_businesses business
on conflict (business_id, code) do nothing;

create or replace function public.accounting_mark_bank_document_missing(
  p_bank_transaction_id uuid,
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
  v_revision integer;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;

  select * into v_bank
  from public.accounting_bank_transactions
  where id = p_bank_transaction_id and business_id = v_business
  for update;
  if v_bank.id is null then raise exception 'Movimiento bancario no encontrado'; end if;
  if v_bank.status <> 'pending' then raise exception 'El movimiento ya no esta pendiente'; end if;
  if v_bank.amount >= 0 then raise exception 'Solo los pagos pueden quedar pendientes de factura'; end if;
  if exists (
    select 1 from public.accounting_reconciliations reconciliation
    where reconciliation.business_id = v_business
      and reconciliation.bank_transaction_id = v_bank.id
      and reconciliation.status in ('suggested', 'confirmed')
  ) then raise exception 'El movimiento ya tiene una conciliacion activa'; end if;

  select * into v_review
  from public.accounting_bank_reviews
  where business_id = v_business and bank_transaction_id = v_bank.id
  for update;
  if v_review.id is not null and v_review.status = 'active' then
    raise exception 'El movimiento ya tiene una clasificacion activa';
  end if;

  v_revision := coalesce(v_review.revision, 0) + 1;
  if v_review.id is null then
    insert into public.accounting_bank_reviews(
      business_id, bank_transaction_id, classification, status, notes,
      previous_bank_status, revision, reviewed_at, updated_at
    ) values (
      v_business, v_bank.id, 'awaiting_document', 'waiting_document',
      btrim(coalesce(p_notes, '')), v_bank.status, v_revision, now(), now()
    ) returning * into v_review;
  else
    update public.accounting_bank_reviews
    set classification = 'awaiting_document',
        status = 'waiting_document',
        notes = btrim(coalesce(p_notes, '')),
        document_id = null,
        journal_entry_id = null,
        reversal_entry_id = null,
        previous_bank_status = v_bank.status,
        revision = v_revision,
        reviewed_at = now(),
        reversed_at = null,
        updated_at = now()
    where id = v_review.id
    returning * into v_review;
  end if;

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business, 'bank_document_requested', 'bank_transaction', v_bank.id::text,
    jsonb_build_object('review_id', v_review.id, 'notes', v_review.notes)
  );

  return jsonb_build_object(
    'review_id', v_review.id,
    'status', v_review.status,
    'bank_status', v_bank.status
  );
end;
$$;

create or replace function public.accounting_clear_bank_document_missing(
  p_bank_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, accounting_private, pg_catalog
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_review public.accounting_bank_reviews%rowtype;
begin
  if v_business is null then raise exception 'Sesion contable no valida'; end if;
  select * into v_review
  from public.accounting_bank_reviews
  where business_id = v_business
    and bank_transaction_id = p_bank_transaction_id
    and status = 'waiting_document'
  for update;
  if v_review.id is null then raise exception 'Aviso de factura pendiente no encontrado'; end if;

  update public.accounting_bank_reviews
  set status = 'reversed', reversed_at = now(), updated_at = now()
  where id = v_review.id;

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business, 'bank_document_request_cleared', 'bank_transaction',
    p_bank_transaction_id::text, jsonb_build_object('review_id', v_review.id)
  );

  return jsonb_build_object('review_id', v_review.id, 'status', 'reversed');
end;
$$;

create or replace function public.accounting_classify_bank_transaction_v2(
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
begin
  if v_classification not in ('internal_transfer', 'loan_payment', 'payroll') then
    return public.accounting_classify_bank_transaction(
      p_bank_transaction_id, p_classification, p_notes
    );
  end if;
  if v_business is null then raise exception 'Sesion contable no valida'; end if;

  select * into v_bank
  from public.accounting_bank_transactions
  where id = p_bank_transaction_id and business_id = v_business
  for update;
  if v_bank.id is null then raise exception 'Movimiento bancario no encontrado'; end if;
  if v_bank.status <> 'pending' then raise exception 'El movimiento ya no esta pendiente'; end if;
  if v_bank.amount > 0 and v_classification <> 'internal_transfer' then
    raise exception 'La clasificacion elegida corresponde a una salida';
  end if;
  if exists (
    select 1 from public.accounting_reconciliations reconciliation
    where reconciliation.business_id = v_business
      and reconciliation.bank_transaction_id = v_bank.id
      and reconciliation.status in ('suggested', 'confirmed')
  ) then raise exception 'El movimiento ya tiene una conciliacion activa'; end if;

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
    when 'internal_transfer' then 'Traspaso entre cuentas propias'
    when 'loan_payment' then 'Cuota de prestamo pendiente de desglose'
    else 'Nomina o salario'
  end;
  v_counterpart_code := case when v_classification = 'payroll' then '640' else '555' end;

  if v_classification = 'payroll' then
    insert into public.bookkeeping_documents(
      business_id, source_type, source_id, direction, document_type, status,
      series, number, issue_date, currency, subtotal, tax_amount,
      withholding_amount, total_amount, paid_amount, payment_method,
      category, notes, source_payload, approved_at
    ) values (
      v_business, 'bank_classification', v_source_id, 'purchase', 'payroll', 'paid',
      'BANCO', concat('NOMINA-', to_char(v_bank.booked_on, 'YYYYMMDD'), '-', v_revision),
      v_bank.booked_on, 'EUR', v_amount, 0, 0, v_amount, v_amount, 'bank',
      v_label, nullif(btrim(coalesce(p_notes, '')), ''),
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
      v_amount, 0, 0, 'not_subject', '640'
    );

    insert into public.accounting_document_analysis(
      document_id, business_id, category, cost_behavior, notes, updated_at
    ) values (
      v_document_id, v_business, 'staff', 'fixed',
      'Clasificacion confirmada desde el movimiento bancario', now()
    );
  end if;

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

  if v_review.id is null then
    insert into public.accounting_bank_reviews(
      business_id, bank_transaction_id, classification, status, notes,
      document_id, journal_entry_id, previous_bank_status, revision,
      reviewed_at, reversed_at, updated_at
    ) values (
      v_business, v_bank.id, v_classification, 'active', btrim(coalesce(p_notes, '')),
      v_document_id, v_entry_id, v_bank.status, v_revision, now(), null, now()
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

  update public.accounting_bank_transactions set status = 'matched' where id = v_bank.id;
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
    'bank_status', 'matched'
  );
end;
$$;

create or replace function accounting_private.sync_bank_document_request()
returns trigger
language plpgsql
set search_path = public, accounting_private, pg_catalog
as $$
begin
  if new.status in ('suggested', 'confirmed') then
    update public.accounting_bank_reviews
    set status = 'resolved', updated_at = now()
    where business_id = new.business_id
      and bank_transaction_id = new.bank_transaction_id
      and classification = 'awaiting_document'
      and status = 'waiting_document';
  elsif new.status in ('rejected', 'reversed') then
    update public.accounting_bank_reviews
    set status = 'waiting_document', updated_at = now()
    where business_id = new.business_id
      and bank_transaction_id = new.bank_transaction_id
      and classification = 'awaiting_document'
      and status = 'resolved';
  end if;
  return new;
end;
$$;

drop trigger if exists accounting_reconciliation_sync_document_request
  on public.accounting_reconciliations;
create trigger accounting_reconciliation_sync_document_request
after insert or update of status on public.accounting_reconciliations
for each row execute function accounting_private.sync_bank_document_request();

revoke all on function accounting_private.sync_bank_document_request() from public;
revoke all on function public.accounting_mark_bank_document_missing(uuid, text) from public;
revoke all on function public.accounting_clear_bank_document_missing(uuid) from public;
revoke all on function public.accounting_classify_bank_transaction_v2(uuid, text, text) from public;
revoke execute on function public.accounting_mark_bank_document_missing(uuid, text) from authenticated;
revoke execute on function public.accounting_clear_bank_document_missing(uuid) from authenticated;
revoke execute on function public.accounting_classify_bank_transaction_v2(uuid, text, text) from authenticated;
grant execute on function public.accounting_mark_bank_document_missing(uuid, text) to anon;
grant execute on function public.accounting_clear_bank_document_missing(uuid) to anon;
grant execute on function public.accounting_classify_bank_transaction_v2(uuid, text, text) to anon;

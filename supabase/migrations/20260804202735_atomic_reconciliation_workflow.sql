alter table public.accounting_reconciliations
  add column if not exists confirmed_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists reversed_at timestamptz,
  add column if not exists bank_status_before text,
  add column if not exists document_status_before text,
  add column if not exists document_paid_before numeric(12,2);

create unique index if not exists accounting_one_confirmed_bank_transaction_idx
  on public.accounting_reconciliations (business_id, bank_transaction_id)
  where status = 'confirmed';

create or replace function public.accounting_update_reconciliation(
  p_reconciliation_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, accounting_private, pg_catalog
as $$
declare
  v_business uuid := accounting_private.current_business_id();
  v_reconciliation public.accounting_reconciliations%rowtype;
  v_bank public.accounting_bank_transactions%rowtype;
  v_document public.bookkeeping_documents%rowtype;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_amount numeric(12,2);
  v_outstanding numeric(12,2);
  v_new_paid numeric(12,2);
  v_expected_paid numeric(12,2);
begin
  if v_business is null then
    raise exception 'Sesion contable no valida';
  end if;
  if v_action not in ('confirm', 'reject', 'reopen', 'undo') then
    raise exception 'Accion de conciliacion no valida';
  end if;

  select * into v_reconciliation
  from public.accounting_reconciliations
  where id = p_reconciliation_id
    and business_id = v_business
  for update;

  if v_reconciliation.id is null then
    raise exception 'Conciliacion no encontrada';
  end if;

  if v_action = 'reject' then
    if v_reconciliation.status = 'confirmed' then
      raise exception 'Deshaz primero la conciliacion confirmada';
    end if;
    if v_reconciliation.status <> 'rejected' then
      update public.accounting_reconciliations
      set status = 'rejected',
          rejected_at = now()
      where id = v_reconciliation.id;

      insert into public.accounting_audit_log(
        business_id, event_type, entity_type, entity_id, metadata
      ) values (
        v_business, 'reconciliation_rejected', 'accounting_reconciliation',
        v_reconciliation.id::text,
        jsonb_build_object(
          'bank_transaction_id', v_reconciliation.bank_transaction_id,
          'document_id', v_reconciliation.document_id,
          'amount', v_reconciliation.amount
        )
      );
    end if;
    return jsonb_build_object('id', v_reconciliation.id, 'status', 'rejected');
  end if;

  if v_action = 'reopen' and v_reconciliation.status <> 'confirmed' then
    if v_reconciliation.status <> 'suggested' then
      update public.accounting_reconciliations
      set status = 'suggested',
          rejected_at = null
      where id = v_reconciliation.id;

      insert into public.accounting_audit_log(
        business_id, event_type, entity_type, entity_id, metadata
      ) values (
        v_business, 'reconciliation_reopened', 'accounting_reconciliation',
        v_reconciliation.id::text,
        jsonb_build_object(
          'bank_transaction_id', v_reconciliation.bank_transaction_id,
          'document_id', v_reconciliation.document_id,
          'amount', v_reconciliation.amount
        )
      );
    end if;
    return jsonb_build_object('id', v_reconciliation.id, 'status', 'suggested');
  end if;

  if v_reconciliation.document_id is null then
    raise exception 'La propuesta no tiene un documento asociado';
  end if;

  select * into v_bank
  from public.accounting_bank_transactions
  where id = v_reconciliation.bank_transaction_id
    and business_id = v_business
  for update;

  select * into v_document
  from public.bookkeeping_documents
  where id = v_reconciliation.document_id
    and business_id = v_business
  for update;

  if v_bank.id is null or v_document.id is null then
    raise exception 'El movimiento o el documento ya no esta disponible';
  end if;

  v_amount := abs(v_reconciliation.amount);
  v_outstanding := greatest(0, v_document.total_amount - v_document.paid_amount);

  if v_action = 'confirm' then
    if v_reconciliation.status = 'confirmed' then
      return jsonb_build_object('id', v_reconciliation.id, 'status', 'confirmed');
    end if;
    if v_amount <= 0 then
      raise exception 'El importe a conciliar debe ser mayor que cero';
    end if;
    if abs(v_bank.amount) + 0.01 < v_amount then
      raise exception 'El importe supera el movimiento bancario';
    end if;
    if v_outstanding + 0.01 < v_amount then
      raise exception 'El importe supera lo pendiente del documento';
    end if;
    if (v_document.direction = 'purchase' and v_bank.amount >= 0)
       or (v_document.direction = 'sale' and v_bank.amount <= 0) then
      raise exception 'El signo del movimiento no corresponde al tipo de documento';
    end if;
    if v_bank.status <> 'pending' then
      raise exception 'El movimiento bancario ya no esta pendiente';
    end if;
    if exists (
      select 1
      from public.accounting_reconciliations other
      where other.business_id = v_business
        and other.bank_transaction_id = v_bank.id
        and other.status = 'confirmed'
        and other.id <> v_reconciliation.id
    ) then
      raise exception 'El movimiento ya esta conciliado con otro documento';
    end if;

    v_new_paid := least(v_document.total_amount, v_document.paid_amount + v_amount);

    update public.accounting_reconciliations
    set status = 'confirmed',
        confirmed_at = now(),
        rejected_at = null,
        reversed_at = null,
        bank_status_before = v_bank.status,
        document_status_before = v_document.status,
        document_paid_before = v_document.paid_amount
    where id = v_reconciliation.id;

    update public.accounting_bank_transactions
    set status = 'matched'
    where id = v_bank.id;

    update public.bookkeeping_documents
    set paid_amount = v_new_paid,
        status = case
          when v_new_paid + 0.01 >= total_amount then 'paid'
          else 'partially_paid'
        end,
        updated_at = now()
    where id = v_document.id;

    insert into public.accounting_audit_log(
      business_id, event_type, entity_type, entity_id, metadata
    ) values (
      v_business, 'reconciliation_confirmed', 'accounting_reconciliation',
      v_reconciliation.id::text,
      jsonb_build_object(
        'bank_transaction_id', v_bank.id,
        'document_id', v_document.id,
        'amount', v_amount,
        'bank_status_before', v_bank.status,
        'document_status_before', v_document.status,
        'document_paid_before', v_document.paid_amount,
        'document_paid_after', v_new_paid
      )
    );

    return jsonb_build_object('id', v_reconciliation.id, 'status', 'confirmed');
  end if;

  if v_reconciliation.status <> 'confirmed' then
    return jsonb_build_object('id', v_reconciliation.id, 'status', v_reconciliation.status);
  end if;
  if v_reconciliation.bank_status_before is null
     or v_reconciliation.document_status_before is null
     or v_reconciliation.document_paid_before is null then
    raise exception 'Esta conciliacion antigua no puede deshacerse automaticamente';
  end if;

  v_expected_paid := least(
    v_document.total_amount,
    v_reconciliation.document_paid_before + v_amount
  );
  if abs(v_document.paid_amount - v_expected_paid) > 0.01
     or v_bank.status <> 'matched' then
    raise exception 'Hay cambios posteriores; revisa el documento antes de deshacer';
  end if;

  update public.accounting_bank_transactions
  set status = v_reconciliation.bank_status_before
  where id = v_bank.id;

  update public.bookkeeping_documents
  set paid_amount = v_reconciliation.document_paid_before,
      status = v_reconciliation.document_status_before,
      updated_at = now()
  where id = v_document.id;

  update public.accounting_reconciliations
  set status = 'suggested',
      confirmed_at = null,
      rejected_at = null,
      reversed_at = now()
  where id = v_reconciliation.id;

  insert into public.accounting_audit_log(
    business_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_business, 'reconciliation_undone', 'accounting_reconciliation',
    v_reconciliation.id::text,
    jsonb_build_object(
      'bank_transaction_id', v_bank.id,
      'document_id', v_document.id,
      'amount', v_amount,
      'restored_bank_status', v_reconciliation.bank_status_before,
      'restored_document_status', v_reconciliation.document_status_before,
      'restored_document_paid', v_reconciliation.document_paid_before
    )
  );

  return jsonb_build_object('id', v_reconciliation.id, 'status', 'suggested');
end;
$$;

revoke all on function public.accounting_update_reconciliation(uuid, text) from public;
grant execute on function public.accounting_update_reconciliation(uuid, text) to anon, authenticated;

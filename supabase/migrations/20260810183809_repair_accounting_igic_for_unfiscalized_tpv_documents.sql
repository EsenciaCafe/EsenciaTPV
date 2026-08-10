-- Repara exclusivamente el desglose contable de IGIC de ventas TPV que ya
-- existen en contabilidad pero nunca recibieron un documento fiscal. No toca
-- sales, sale_lines, sale_payments, receipt_tickets ni fiscal_documents.

create temporary table accounting_igic_repair_targets on commit drop as
select
  d.id as document_id,
  d.business_id,
  d.source_id as sale_id,
  d.issue_date,
  d.subtotal as previous_subtotal,
  d.tax_amount as previous_tax_amount,
  d.total_amount,
  7::numeric as tax_rate,
  round(d.total_amount / 1.07, 2) as repaired_subtotal,
  round(d.total_amount - round(d.total_amount / 1.07, 2), 2) as repaired_tax_amount
from public.bookkeeping_documents d
join public.sales s
  on s.id = d.source_id
left join public.fiscal_documents f
  on f.sale_id = s.id
where d.source_type = 'tpv'
  and d.direction = 'sale'
  and d.document_type in ('simplified_invoice', 'credit_note')
  and d.tax_amount = 0
  and f.id is null
  and coalesce(nullif(s.legal_data->>'taxRate', '')::numeric, 0) = 7
  and coalesce(s.payload->>'voided', 'false') <> 'true'
  and coalesce(s.closed_at, s.created_at) >= (
    select min(issued_at)
    from public.fiscal_documents
  );

do $$
declare
  v_count integer;
  v_total numeric;
  v_tax numeric;
begin
  select
    count(*),
    round(coalesce(sum(total_amount), 0), 2),
    round(coalesce(sum(repaired_tax_amount), 0), 2)
  into v_count, v_total, v_tax
  from accounting_igic_repair_targets;

  -- Permite aplicar la migracion en bases nuevas o ya reparadas.
  if v_count = 0 then
    return;
  end if;

  -- Protege frente a ampliar accidentalmente el alcance de esta reparacion.
  if v_count <> 197 or v_total <> 3513.80 or v_tax <> 229.87 then
    raise exception
      'Alcance inesperado al reparar IGIC contable: % documentos, total %, IGIC %',
      v_count, v_total, v_tax;
  end if;
end;
$$;

with repaired_lines as (
  select
    line.id,
    round(line.taxable_base / 1.07, 2) as repaired_taxable_base,
    round(line.taxable_base - round(line.taxable_base / 1.07, 2), 2) as repaired_tax_amount
  from public.bookkeeping_document_lines line
  join accounting_igic_repair_targets target
    on target.document_id = line.document_id
)
update public.bookkeeping_document_lines line
set taxable_base = repaired.repaired_taxable_base,
    tax_rate = 7,
    tax_amount = repaired.repaired_tax_amount,
    tax_scope = 'taxable',
    updated_at = now()
from repaired_lines repaired
where repaired.id = line.id;

-- La tabla impide modificar importes de documentos pagados. Esta excepcion de
-- mantenimiento queda limitada a la transaccion de la migracion; ALTER TABLE
-- mantiene un bloqueo exclusivo y un error revierte tambien el DISABLE.
alter table public.bookkeeping_documents
  disable trigger bookkeeping_documents_protect_trigger;

update public.bookkeeping_documents document
set subtotal = target.repaired_subtotal,
    tax_amount = target.repaired_tax_amount,
    notes = concat_ws(
      E'\n',
      nullif(document.notes, ''),
      'IGIC reconstruido en contabilidad desde el total cobrado y el tipo del 7 % guardado en la venta. Pendiente de regularizacion fiscal en el TPV.'
    ),
    source_payload = coalesce(document.source_payload, '{}'::jsonb)
      || jsonb_build_object(
        'accounting_igic_repair',
        jsonb_build_object(
          'version', 'accounting-igic-repair/v1',
          'reason', 'missing_fiscal_document_after_tpv_sync_race',
          'tax_rate', target.tax_rate,
          'previous_subtotal', target.previous_subtotal,
          'previous_tax_amount', target.previous_tax_amount,
          'repaired_subtotal', target.repaired_subtotal,
          'repaired_tax_amount', target.repaired_tax_amount,
          'fiscal_document_created', false,
          'repaired_at', now()
        )
      ),
    updated_at = now()
from accounting_igic_repair_targets target
where document.id = target.document_id;

alter table public.bookkeeping_documents
  enable trigger bookkeeping_documents_protect_trigger;

insert into public.accounting_audit_log(
  business_id,
  event_type,
  entity_type,
  entity_id,
  actor,
  metadata
)
select
  target.business_id,
  'tpv_accounting_igic_repaired',
  'bookkeeping_document',
  target.document_id::text,
  'system_repair',
  jsonb_build_object(
    'version', 'accounting-igic-repair/v1',
    'sale_id', target.sale_id,
    'tax_rate', target.tax_rate,
    'previous_subtotal', target.previous_subtotal,
    'previous_tax_amount', target.previous_tax_amount,
    'repaired_subtotal', target.repaired_subtotal,
    'repaired_tax_amount', target.repaired_tax_amount,
    'fiscal_document_created', false
  )
from accounting_igic_repair_targets target;

with refreshed_drafts as (
  select
    draft.id,
    jsonb_build_object(
      'period_start', period.starts_on,
      'period_end', period.ends_on,
      'sales_base', coalesce(sum(document.subtotal) filter(
        where document.direction = 'sale'
          and document.status not in ('voided', 'draft')
      ), 0),
      'igic_output', coalesce(sum(document.tax_amount) filter(
        where document.direction = 'sale'
          and document.status not in ('voided', 'draft')
      ), 0),
      'purchases_base', coalesce(sum(document.subtotal) filter(
        where document.direction = 'purchase'
          and document.status not in ('voided', 'draft')
      ), 0),
      'igic_input', coalesce(sum(document.tax_amount) filter(
        where document.direction = 'purchase'
          and document.status not in ('voided', 'draft')
      ), 0),
      'net_result',
        coalesce(sum(document.tax_amount) filter(
          where document.direction = 'sale'
            and document.status not in ('voided', 'draft')
        ), 0)
        - coalesce(sum(document.tax_amount) filter(
          where document.direction = 'purchase'
            and document.status not in ('voided', 'draft')
        ), 0),
      'income', coalesce(sum(document.total_amount) filter(
        where document.direction = 'sale'
          and document.status not in ('voided', 'draft')
      ), 0),
      'expenses', coalesce(sum(document.subtotal) filter(
        where document.direction = 'purchase'
          and document.status not in ('voided', 'draft')
      ), 0),
      'estimated_model_130', greatest(
        (
          coalesce(sum(document.subtotal) filter(
            where document.direction = 'sale'
              and document.status not in ('voided', 'draft')
          ), 0)
          - coalesce(sum(document.subtotal) filter(
            where document.direction = 'purchase'
              and document.status not in ('voided', 'draft')
          ), 0)
        ) * 0.20,
        0
      )
    ) as totals
  from public.accounting_tax_drafts draft
  join public.accounting_tax_periods period
    on period.id = draft.period_id
  left join public.bookkeeping_documents document
    on document.business_id = draft.business_id
    and document.issue_date between period.starts_on and period.ends_on
  where draft.status = 'draft'
    and period.status = 'open'
    and exists (
      select 1
      from accounting_igic_repair_targets target
      where target.business_id = draft.business_id
        and target.issue_date between period.starts_on and period.ends_on
    )
  group by draft.id, period.starts_on, period.ends_on
)
update public.accounting_tax_drafts draft
set totals = refreshed.totals,
    generated_at = now()
from refreshed_drafts refreshed
where refreshed.id = draft.id;

insert into public.accounting_audit_log(
  business_id,
  event_type,
  entity_type,
  entity_id,
  actor,
  metadata
)
select
  target.business_id,
  'tpv_accounting_igic_repair_batch_completed',
  'accounting_repair_batch',
  'accounting-igic-repair/v1',
  'system_repair',
  jsonb_build_object(
    'version', 'accounting-igic-repair/v1',
    'documents', count(*),
    'gross_total', round(sum(target.total_amount), 2),
    'repaired_igic', round(sum(target.repaired_tax_amount), 2),
    'fiscal_documents_modified', 0,
    'tpv_tables_modified', 0
  )
from accounting_igic_repair_targets target
group by target.business_id;

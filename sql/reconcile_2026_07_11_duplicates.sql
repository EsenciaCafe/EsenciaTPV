-- Incidencia 2026-07-11: nueve ventas duplicadas por sincronizacion obsoleta.
-- Referencia externa BBVA: 26 cobros, 458.70 EUR.
-- Estado previo en sales: 35 ventas, 611.80 EUR.
-- Ajuste: 9 ventas, 153.10 EUR.

begin;

update public.sales
set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
      'voided', true,
      'voidedAt', now(),
      'voidReason', 'Duplicado tecnico por incidencia de sincronizacion del 11/07/2026',
      'voidedBy', 'reconciliation-2026-07-11'
    )
where id in (
  'TX-1783782498926-SWPH',
  'TX-1783782544443-SN6J',
  'TX-1783782588846-PEJZ',
  'TX-1783782757943-2I04',
  'TX-1783783370899-3XV1',
  'TX-1783783395776-UJ4O',
  'TX-1783783457728-UXZZ',
  'TX-1783783485502-T4Y7',
  'TX-1783783500445-M75K'
);

update public.fiscal_documents
set status = 'cancelled',
    payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
      'cancelled_at', now(),
      'cancellation_reason', 'Duplicado tecnico por incidencia de sincronizacion del 11/07/2026'
    ),
    updated_at = now()
where sale_id in (
  'TX-1783782498926-SWPH',
  'TX-1783782544443-SN6J',
  'TX-1783782588846-PEJZ',
  'TX-1783782757943-2I04',
  'TX-1783783370899-3XV1',
  'TX-1783783395776-UJ4O',
  'TX-1783783457728-UXZZ',
  'TX-1783783485502-T4Y7',
  'TX-1783783500445-M75K'
);

commit;

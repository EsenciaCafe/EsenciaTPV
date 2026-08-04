drop policy if exists accounting_document_analysis_owner
  on public.accounting_document_analysis;

create policy accounting_document_analysis_owner
  on public.accounting_document_analysis
  for all
  to anon, authenticated
  using (business_id = (select accounting_private.current_business_id()))
  with check (
    business_id = (select accounting_private.current_business_id())
    and exists (
      select 1
      from public.bookkeeping_documents source_document
      where source_document.id = accounting_document_analysis.document_id
        and source_document.business_id = accounting_document_analysis.business_id
    )
  );

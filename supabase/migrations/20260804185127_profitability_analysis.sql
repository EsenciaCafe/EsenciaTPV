create table if not exists public.accounting_document_analysis (
  document_id uuid primary key references public.bookkeeping_documents(id) on delete cascade,
  business_id uuid not null references public.accounting_businesses(id) on delete cascade,
  category text not null default 'unclassified'
    check (category in (
      'merchandise', 'packaging', 'staff', 'rent', 'utilities',
      'bank_fees', 'professional_services', 'maintenance', 'taxes',
      'insurance', 'marketing', 'investment', 'other', 'unclassified'
    )),
  cost_behavior text not null default 'unclassified'
    check (cost_behavior in ('variable', 'fixed', 'investment', 'unclassified')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounting_document_analysis_business_idx
  on public.accounting_document_analysis (business_id, cost_behavior, category);

alter table public.accounting_document_analysis enable row level security;

revoke all on table public.accounting_document_analysis from public;
grant select, insert, update, delete on table public.accounting_document_analysis to anon, authenticated;

drop policy if exists accounting_document_analysis_owner on public.accounting_document_analysis;
create policy accounting_document_analysis_owner
  on public.accounting_document_analysis
  for all
  to anon, authenticated
  using (business_id = (select accounting_private.current_business_id()))
  with check (business_id = (select accounting_private.current_business_id()));

create table if not exists public.accounting_recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.accounting_businesses(id) on delete cascade,
  contact_id uuid references public.accounting_contacts(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 160),
  category text not null default 'other'
    check (category in (
      'staff', 'rent', 'utilities', 'bank_fees', 'professional_services',
      'maintenance', 'taxes', 'insurance', 'marketing', 'other'
    )),
  expected_amount numeric(14,2) not null default 0 check (expected_amount >= 0),
  frequency text not null default 'monthly'
    check (frequency in ('monthly', 'quarterly', 'yearly')),
  due_day smallint not null default 1 check (due_day between 1 and 28),
  start_on date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounting_recurring_expenses_business_idx
  on public.accounting_recurring_expenses (business_id, active, start_on);
create index if not exists accounting_recurring_expenses_contact_idx
  on public.accounting_recurring_expenses (contact_id)
  where contact_id is not null;

create table if not exists public.accounting_recurring_expense_occurrences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.accounting_businesses(id) on delete cascade,
  recurring_expense_id uuid not null references public.accounting_recurring_expenses(id) on delete cascade,
  period_key text not null check (period_key ~ '^\d{4}-\d{2}$'),
  expected_on date not null,
  status text not null default 'pending' check (status in ('pending', 'linked', 'skipped')),
  document_id uuid references public.bookkeeping_documents(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recurring_expense_id, period_key)
);

create index if not exists accounting_recurring_occurrences_business_idx
  on public.accounting_recurring_expense_occurrences (business_id, expected_on, status);
create index if not exists accounting_recurring_occurrences_document_idx
  on public.accounting_recurring_expense_occurrences (document_id)
  where document_id is not null;

alter table public.accounting_recurring_expenses enable row level security;
alter table public.accounting_recurring_expense_occurrences enable row level security;

revoke all on table public.accounting_recurring_expenses from public;
revoke all on table public.accounting_recurring_expense_occurrences from public;
revoke all on table public.accounting_recurring_expenses from anon, authenticated;
revoke all on table public.accounting_recurring_expense_occurrences from anon, authenticated;
grant select, insert, update, delete on table public.accounting_recurring_expenses to anon, authenticated;
grant select, insert, update, delete on table public.accounting_recurring_expense_occurrences to anon, authenticated;

drop policy if exists accounting_recurring_expenses_owner
  on public.accounting_recurring_expenses;
create policy accounting_recurring_expenses_owner
  on public.accounting_recurring_expenses
  for all
  to anon, authenticated
  using (business_id = (select accounting_private.current_business_id()))
  with check (
    business_id = (select accounting_private.current_business_id())
    and (
      contact_id is null
      or exists (
        select 1
        from public.accounting_contacts contact
        where contact.id = accounting_recurring_expenses.contact_id
          and contact.business_id = accounting_recurring_expenses.business_id
      )
    )
  );

drop policy if exists accounting_recurring_occurrences_owner
  on public.accounting_recurring_expense_occurrences;
create policy accounting_recurring_occurrences_owner
  on public.accounting_recurring_expense_occurrences
  for all
  to anon, authenticated
  using (business_id = (select accounting_private.current_business_id()))
  with check (
    business_id = (select accounting_private.current_business_id())
    and exists (
      select 1
      from public.accounting_recurring_expenses recurring
      where recurring.id = accounting_recurring_expense_occurrences.recurring_expense_id
        and recurring.business_id = accounting_recurring_expense_occurrences.business_id
    )
    and (
      document_id is null
      or exists (
        select 1
        from public.bookkeeping_documents source_document
        where source_document.id = accounting_recurring_expense_occurrences.document_id
          and source_document.business_id = accounting_recurring_expense_occurrences.business_id
      )
    )
  );

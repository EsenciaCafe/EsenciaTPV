create index if not exists accounting_bank_reviews_bank_transaction_idx
  on public.accounting_bank_reviews (bank_transaction_id);
create index if not exists accounting_bank_reviews_document_idx
  on public.accounting_bank_reviews (document_id)
  where document_id is not null;
create index if not exists accounting_bank_reviews_journal_entry_idx
  on public.accounting_bank_reviews (journal_entry_id)
  where journal_entry_id is not null;
create index if not exists accounting_bank_reviews_reversal_entry_idx
  on public.accounting_bank_reviews (reversal_entry_id)
  where reversal_entry_id is not null;

revoke execute on function public.accounting_create_manual_reconciliation(uuid, uuid, numeric) from authenticated;
revoke execute on function public.accounting_classify_bank_transaction(uuid, text, text) from authenticated;
revoke execute on function public.accounting_unclassify_bank_transaction(uuid) from authenticated;
revoke select on table public.accounting_bank_reviews from authenticated;

drop policy if exists accounting_bank_reviews_owner on public.accounting_bank_reviews;
create policy accounting_bank_reviews_owner
on public.accounting_bank_reviews
for select
to anon
using (business_id = (select accounting_private.current_business_id()));

revoke all on function public.accounting_set_drive_source_folder(text) from authenticated;
revoke all on function public.accounting_lock_drive_result_folder(text, text) from authenticated;
revoke all on function public.accounting_verify_drive_result_folder(text, text, text) from authenticated;

revoke all on public.accounting_drive_sources from authenticated;
revoke all on public.accounting_drive_sources from anon;
grant select, insert, update on public.accounting_drive_sources to anon;

drop policy if exists accounting_drive_sources_owner on public.accounting_drive_sources;
create policy accounting_drive_sources_owner
on public.accounting_drive_sources
for all
to anon
using (business_id = accounting_private.current_business_id())
with check (business_id = accounting_private.current_business_id());

create or replace function accounting_private.prepare_document_line()
returns trigger
language plpgsql
security definer
set search_path = public, accounting_private, pg_catalog
as $$
begin
  if nullif(btrim(new.supplier_item_code), '') is null and new.document_id is not null then
    select nullif(btrim(document.source_payload->'lines'->(new.position - 1)->>'supplier_item_code'), '')
    into new.supplier_item_code
    from public.bookkeeping_documents document
    where document.id = new.document_id
      and document.business_id = new.business_id;
  end if;

  new.item_key := accounting_private.normalize_item_key(
    coalesce(nullif(btrim(new.supplier_item_code), ''), new.description)
  );
  new.updated_at := now();
  return new;
end;
$$;

update public.bookkeeping_document_lines line
set supplier_item_code = nullif(
      btrim(document.source_payload->'lines'->(line.position - 1)->>'supplier_item_code'),
      ''
    ),
    item_key = accounting_private.normalize_item_key(
      coalesce(
        nullif(btrim(document.source_payload->'lines'->(line.position - 1)->>'supplier_item_code'), ''),
        line.description
      )
    )
from public.bookkeeping_documents document
where document.id = line.document_id
  and document.business_id = line.business_id
  and line.supplier_item_code is null
  and nullif(btrim(document.source_payload->'lines'->(line.position - 1)->>'supplier_item_code'), '') is not null;

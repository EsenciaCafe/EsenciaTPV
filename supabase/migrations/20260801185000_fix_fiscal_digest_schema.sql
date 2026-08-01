-- Supabase installs pgcrypto in the extensions schema. Keep the fiscal
-- function's lookup deterministic without recreating its existing body.
alter function public.create_fiscal_document(text, text)
  set search_path = public, extensions;

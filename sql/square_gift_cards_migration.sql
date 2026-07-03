create table if not exists public.square_gift_card_events (
  id uuid primary key default gen_random_uuid(),
  sale_id text references public.sales(id) on delete set null,
  event_type text not null check (event_type in ('lookup', 'redeem', 'refund', 'activate')),
  gift_card_id text,
  gift_card_gan_last4 text,
  square_activity_id text,
  reference_id text,
  amount numeric(10, 2) default 0,
  currency text default 'EUR',
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists square_gift_card_events_sale_id_idx
  on public.square_gift_card_events (sale_id);

create index if not exists square_gift_card_events_reference_id_idx
  on public.square_gift_card_events (reference_id);

alter table public.square_gift_card_events enable row level security;

drop policy if exists "Allow TPV read gift card events" on public.square_gift_card_events;
create policy "Allow TPV read gift card events"
  on public.square_gift_card_events
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Allow TPV insert gift card events" on public.square_gift_card_events;
create policy "Allow TPV insert gift card events"
  on public.square_gift_card_events
  for insert
  to anon, authenticated
  with check (true);

grant select, insert on public.square_gift_card_events to anon, authenticated;
grant select, insert, update, delete on public.square_gift_card_events to service_role;

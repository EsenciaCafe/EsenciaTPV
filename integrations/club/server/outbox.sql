-- Isolated candidate schema, NOT a Supabase deployment migration.
-- No browser role has privileges on this schema. Provision backend grants separately.
create schema if not exists tpv_bridge_private;
create table if not exists tpv_bridge_private.outbox (
 id uuid primary key,
 source text not null,
 business_key text not null,
 body text not null,
 state text not null default 'pending' check(state in ('pending','sending','applied','rejected','review')),
 attempts integer not null default 0,
 next_at timestamptz not null default now(),
 lease_id uuid,
 lease_until timestamptz,
 response jsonb,
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(source,business_key)
);
alter table tpv_bridge_private.outbox enable row level security;
revoke all on schema tpv_bridge_private from public;
revoke all on tpv_bridge_private.outbox from public;

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
-- Local/staging candidate only. Load after outbox.sql. Not deployed.
create table tpv_bridge_private.terminals (
 id text primary key, secret_hash text not null unique, active boolean not null default true,
 attempts integer not null default 0, window_start timestamptz not null default now()
);
create table tpv_bridge_private.employees (
 staff_id text primary key references public.staff_profiles(id),
 actor_id uuid not null default gen_random_uuid(),
 salt text not null, pin_hash text not null, version integer not null default 1,
 permissions text[] not null, active boolean not null default true
);
create table tpv_bridge_private.sessions (
 token_hash text primary key, terminal_id text not null references tpv_bridge_private.terminals(id),
 staff_id text not null references tpv_bridge_private.employees(staff_id),
 credential_version integer not null, expires_at timestamptz not null
);
create table tpv_bridge_private.applications (
 id text primary key, cart_id text not null, member_id uuid not null,
 context jsonb not null, intent jsonb not null, promotion jsonb,
 reservation_id uuid unique, reserve_operation uuid not null references tpv_bridge_private.outbox(id),
 state text not null default 'requested' check(state in ('requested','reserved','commit_pending','release_pending','committed','released','rejected')),
 delivery_id text, resolution_operation uuid references tpv_bridge_private.outbox(id)
);
create table tpv_bridge_private.completed_sales (
 sale_id text primary key references public.sales(id), context jsonb not null, fingerprint text not null,
 award_operation uuid references tpv_bridge_private.outbox(id)
);
create table tpv_bridge_private.clear_events (
 id text primary key, context jsonb not null, payload jsonb not null,
 award_operation uuid references tpv_bridge_private.outbox(id), state text not null default 'prepared' check(state in ('prepared','committed'))
);
create table tpv_bridge_private.member_labels (id uuid primary key,name text not null,updated_at timestamptz not null default now());
alter table tpv_bridge_private.terminals enable row level security;
alter table tpv_bridge_private.employees enable row level security;
alter table tpv_bridge_private.sessions enable row level security;
alter table tpv_bridge_private.applications enable row level security;
alter table tpv_bridge_private.completed_sales enable row level security;
alter table tpv_bridge_private.clear_events enable row level security;
alter table tpv_bridge_private.member_labels enable row level security;
revoke all on all tables in schema tpv_bridge_private from public;

create table tpv_bridge_private.login_limit(id boolean primary key default true check(id),attempts integer not null default 0,window_start timestamptz not null default now());
insert into tpv_bridge_private.login_limit(id) values(true);
create table tpv_bridge_private.runtime_keys(id boolean primary key default true check(id),private_key text not null,public_key text not null,worker_token text not null);
alter table tpv_bridge_private.login_limit enable row level security;
alter table tpv_bridge_private.runtime_keys enable row level security;
revoke all on all tables in schema tpv_bridge_private from public,anon,authenticated;

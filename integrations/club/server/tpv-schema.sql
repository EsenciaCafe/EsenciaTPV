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

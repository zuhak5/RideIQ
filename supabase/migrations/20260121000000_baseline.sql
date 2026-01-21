-- RideShare (Supabase) - Fresh Database Setup
-- Generated: 2026-01-21T06:58:17Z
--
-- How to use:
-- 1) Create a new Supabase project (empty).
-- 2) Open SQL Editor and run this file top-to-bottom.
--
-- Notes:
-- - This file is a concatenation of the repo's migrations in chronological order.
-- - It assumes Supabase's default schemas (auth/storage/realtime) exist.

-- =====================================================================
-- MIGRATION: supabase/migrations/20260119000100_init.sql
-- =====================================================================
-- RideShare baseline schema (Session 0)
-- Clean foundation: explicit states, strict RLS, geo indexing, and server-side matching.

-- Extensions
create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "postgis" with schema extensions;

-- Types
do $$ begin
  create type public.driver_status as enum ('offline','available','on_trip','suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ride_request_status as enum ('requested','matched','accepted','cancelled','no_driver','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ride_status as enum ('assigned','arrived','in_progress','completed','canceled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ride_actor_type as enum ('rider','driver','system');
exception when duplicate_object then null; end $$;

-- Utility: updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Profiles (linked to auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Auto-create profile on signup (Supabase recommended pattern)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', null), new.phone);
  return new;
end;
$$;

-- Trigger on auth.users
-- NOTE: Deploying on an existing project with users requires backfilling profiles first.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Drivers
create table if not exists public.drivers (
  id uuid primary key references public.profiles(id) on delete cascade,
  status public.driver_status not null default 'offline',
  vehicle_type text,
  rating_avg numeric(3,2) not null default 5.00,
  trips_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger drivers_set_updated_at
before update on public.drivers
for each row execute function public.set_updated_at();

alter table public.drivers enable row level security;

create policy "drivers_select_own"
on public.drivers for select
to authenticated
using (auth.uid() = id);

create policy "drivers_insert_self"
on public.drivers for insert
to authenticated
with check (auth.uid() = id);

create policy "drivers_update_own"
on public.drivers for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Driver vehicles
create table if not exists public.driver_vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  make text,
  model text,
  color text,
  plate_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(driver_id)
);

create trigger driver_vehicles_set_updated_at
before update on public.driver_vehicles
for each row execute function public.set_updated_at();

create index if not exists ix_driver_vehicles_driver_id on public.driver_vehicles(driver_id);

alter table public.driver_vehicles enable row level security;

create policy "driver_vehicles_select_own"
on public.driver_vehicles for select
to authenticated
using (auth.uid() = driver_id);

create policy "driver_vehicles_insert_own"
on public.driver_vehicles for insert
to authenticated
with check (auth.uid() = driver_id);

create policy "driver_vehicles_update_own"
on public.driver_vehicles for update
to authenticated
using (auth.uid() = driver_id)
with check (auth.uid() = driver_id);

-- Driver locations (one row per driver)
-- Use lat/lng as the API surface and a generated geography column for indexed geo queries.
create table if not exists public.driver_locations (
  driver_id uuid primary key default auth.uid() references public.drivers(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  loc geography(point, 4326)
    generated always as (
      (st_setsrid(st_makepoint(lng, lat), 4326))::geography
    ) stored,
  heading numeric,
  speed_mps numeric,
  accuracy_m numeric,
  updated_at timestamptz not null default now()
);

create trigger driver_locations_set_updated_at
before update on public.driver_locations
for each row execute function public.set_updated_at();

create index if not exists ix_driver_locations_loc_gist
on public.driver_locations
using gist (loc);

create index if not exists ix_driver_locations_updated_at
on public.driver_locations(updated_at desc);

alter table public.driver_locations enable row level security;

create policy "driver_locations_select_own"
on public.driver_locations for select
to authenticated
using (auth.uid() = driver_id);

create policy "driver_locations_insert_own"
on public.driver_locations for insert
to authenticated
with check (auth.uid() = driver_id);

create policy "driver_locations_update_own"
on public.driver_locations for update
to authenticated
using (auth.uid() = driver_id)
with check (auth.uid() = driver_id);

-- Ride requests
create table if not exists public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,

  pickup_lat double precision not null check (pickup_lat between -90 and 90),
  pickup_lng double precision not null check (pickup_lng between -180 and 180),
  pickup_loc geography(point, 4326)
    generated always as (
      (st_setsrid(st_makepoint(pickup_lng, pickup_lat), 4326))::geography
    ) stored,

  dropoff_lat double precision not null check (dropoff_lat between -90 and 90),
  dropoff_lng double precision not null check (dropoff_lng between -180 and 180),
  dropoff_loc geography(point, 4326)
    generated always as (
      (st_setsrid(st_makepoint(dropoff_lng, dropoff_lat), 4326))::geography
    ) stored,

  pickup_address text,
  dropoff_address text,
  status public.ride_request_status not null default 'requested',
  assigned_driver_id uuid references public.drivers(id) on delete set null,
  match_deadline timestamptz,
  match_attempts integer not null default 0,
  quote_amount_iqd integer,
  currency text not null default 'IQD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ride_requests_set_updated_at
before update on public.ride_requests
for each row execute function public.set_updated_at();

create index if not exists ix_ride_requests_rider_id on public.ride_requests(rider_id);
create index if not exists ix_ride_requests_status on public.ride_requests(status);
create index if not exists ix_ride_requests_assigned_driver_id on public.ride_requests(assigned_driver_id);
create index if not exists ix_ride_requests_created_at on public.ride_requests(created_at desc);

alter table public.ride_requests enable row level security;

create policy "ride_requests_select_own"
on public.ride_requests for select
to authenticated
using (auth.uid() = rider_id);

create policy "ride_requests_insert_own"
on public.ride_requests for insert
to authenticated
with check (auth.uid() = rider_id);

-- Rider can only cancel while not accepted.
create policy "ride_requests_update_own_cancellable_only"
on public.ride_requests for update
to authenticated
using (auth.uid() = rider_id)
with check (
  auth.uid() = rider_id
  and status in ('requested','matched')
);

-- Drivers can see requests assigned to them (but not unassigned demand).
create policy "ride_requests_driver_select_assigned"
on public.ride_requests for select
to authenticated
using (assigned_driver_id = auth.uid());

-- Rides (created when driver accepts)
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.ride_requests(id) on delete cascade,
  rider_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  status public.ride_status not null default 'assigned',
  version integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  fare_amount_iqd integer,
  currency text not null default 'IQD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger rides_set_updated_at
before update on public.rides
for each row execute function public.set_updated_at();

create index if not exists ix_rides_rider_id on public.rides(rider_id);
create index if not exists ix_rides_driver_id on public.rides(driver_id);
create index if not exists ix_rides_status on public.rides(status);

alter table public.rides enable row level security;

create policy "rides_select_participants"
on public.rides for select
to authenticated
using (auth.uid() = rider_id or auth.uid() = driver_id);

-- Ride events
create table if not exists public.ride_events (
  id bigserial primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  actor_id uuid,
  actor_type public.ride_actor_type not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ix_ride_events_ride_id on public.ride_events(ride_id);
create index if not exists ix_ride_events_created_at on public.ride_events(created_at desc);

alter table public.ride_events enable row level security;

create policy "ride_events_select_participants"
on public.ride_events for select
to authenticated
using (
  exists (
    select 1
    from public.rides r
    where r.id = ride_events.ride_id
      and (r.rider_id = auth.uid() or r.driver_id = auth.uid())
  )
);

-- Payments (stub)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  provider text not null,
  provider_ref text,
  status text not null,
  amount_iqd integer not null,
  currency text not null default 'IQD',
  created_at timestamptz not null default now()
);

create index if not exists ix_payments_ride_id on public.payments(ride_id);

alter table public.payments enable row level security;

create policy "payments_select_participants"
on public.payments for select
to authenticated
using (
  exists (
    select 1
    from public.rides r
    where r.id = payments.ride_id
      and (r.rider_id = auth.uid() or r.driver_id = auth.uid())
  )
);

-- Geo helper: find nearby available drivers
-- Called by Edge Functions using the Service Role key.

-- =====================================================================
-- MIGRATION: supabase/migrations/20260119000200_session1.sql
-- =====================================================================
-- Session 1: Driver flow + live matching hardening

-- 1) Add lifecycle timestamps to ride_requests
alter table public.ride_requests
  add column if not exists matched_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists cancelled_at timestamptz;

-- 2) Auto-populate timestamps on status transitions
create or replace function public.ride_requests_set_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status = 'matched' and old.status = 'requested' and new.matched_at is null then
      new.matched_at := now();
    end if;

    if new.status = 'accepted' and old.status = 'matched' and new.accepted_at is null then
      new.accepted_at := now();
    end if;

    if new.status = 'cancelled' and old.status in ('requested','matched') and new.cancelled_at is null then
      new.cancelled_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ride_requests_status_timestamps on public.ride_requests;
create trigger ride_requests_status_timestamps
before update on public.ride_requests
for each row execute function public.ride_requests_set_status_timestamps();

-- 3) Fix rider cancel policy (old policy prevented setting status='cancelled')
drop policy if exists "ride_requests_update_own_cancellable_only" on public.ride_requests;
drop policy if exists "ride_requests_update_own_cancel" on public.ride_requests;

create policy "ride_requests_update_own_cancel"
on public.ride_requests for update
to authenticated
using (auth.uid() = rider_id and status in ('requested','matched'))
with check (auth.uid() = rider_id and status = 'cancelled');
-- =====================================================================
-- MIGRATION: supabase/migrations/20260119000300_session2.sql
-- =====================================================================
-- Session 2: Transactional dispatch (DB RPC), match expiry, and pricing/payment skeleton

-- 0) Extend driver_status with a reserved state (driver matched but not yet on-trip)
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'driver_status'
      and t.typnamespace = 'public'::regnamespace
      and e.enumlabel = 'reserved'
  ) then
    alter type public.driver_status add value 'reserved';
  end if;
end$$;

-- 1) Pricing config (simple MVP)
create table if not exists public.pricing_configs (
  id uuid primary key default gen_random_uuid(),
  currency text not null default 'IQD',
  base_fare_iqd integer not null default 200,
  per_km_iqd integer not null default 80,
  per_min_iqd integer not null default 15,
  minimum_fare_iqd integer not null default 300,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pricing_configs_set_updated_at
before update on public.pricing_configs
for each row execute function public.set_updated_at();

alter table public.pricing_configs enable row level security;

-- Only service role should manage pricing (keep it simple for MVP)
drop policy if exists "pricing_configs_select" on public.pricing_configs;
create policy "pricing_configs_select"
on public.pricing_configs for select
to authenticated
using (false);

-- Seed one active config if none exists
insert into public.pricing_configs (currency, base_fare_iqd, per_km_iqd, per_min_iqd, minimum_fare_iqd, active)
select 'IQD', 200, 80, 15, 300, true
where not exists (select 1 from public.pricing_configs);

-- Estimate quote using straight-line distance (geography distance in meters)
create or replace function public.estimate_ride_quote_iqd(
  _pickup geography,
  _dropoff geography
)
returns integer
language plpgsql
stable
set search_path = 'pg_catalog, extensions'
as $$
declare
  cfg record;
  dist_m double precision;
  dist_km numeric;
  quote integer;
begin
  select currency, base_fare_iqd, per_km_iqd, per_min_iqd, minimum_fare_iqd
    into cfg
  from public.pricing_configs
  where active = true
  order by created_at desc
  limit 1;

  dist_m := st_distance(_pickup, _dropoff);
  dist_km := greatest(0, dist_m / 1000.0);

  -- MVP: base + per_km, ignore duration for now
  quote := (cfg.base_fare_iqd + ceil(dist_km * cfg.per_km_iqd))::integer;
  quote := greatest(quote, cfg.minimum_fare_iqd);
  return quote;
end;
$$;

-- Auto-fill quote and currency on ride request insert
create or replace function public.ride_requests_set_quote()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog, extensions'
as $$
declare
  cfg record;
begin
  select currency
    into cfg
  from public.pricing_configs
  where active = true
  order by created_at desc
  limit 1;

  if new.currency is null then
    new.currency := coalesce(cfg.currency, 'IQD');
  end if;

  if new.quote_amount_iqd is null then
    new.quote_amount_iqd := public.estimate_ride_quote_iqd(new.pickup_loc, new.dropoff_loc);
  end if;

  return new;
end;
$$;

drop trigger if exists ride_requests_set_quote on public.ride_requests;
create trigger ride_requests_set_quote
before insert on public.ride_requests
for each row execute function public.ride_requests_set_quote();

-- 2) Hard invariants on ride_requests: when leaving matched, clear assignment/deadline
create or replace function public.ride_requests_clear_match_fields()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog, extensions'
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status in ('cancelled','expired','no_driver') then
      new.assigned_driver_id := null;
      new.match_deadline := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ride_requests_clear_match_fields on public.ride_requests;
create trigger ride_requests_clear_match_fields
before update on public.ride_requests
for each row execute function public.ride_requests_clear_match_fields();

-- Release reserved driver when a match is cancelled/expired (or set to no_driver)
create or replace function public.ride_requests_release_driver_on_unmatch()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog, extensions'
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'matched'
       and new.status in ('cancelled','expired','no_driver')
       and old.assigned_driver_id is not null then
      update public.drivers
        set status = 'available'
      where id = old.assigned_driver_id
        and status = 'reserved';
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists ride_requests_release_driver_on_unmatch on public.ride_requests;
create trigger ride_requests_release_driver_on_unmatch
after update on public.ride_requests
for each row execute function public.ride_requests_release_driver_on_unmatch();

-- 3) Concurrency constraints
-- One driver should not be matched to multiple requests at the same time
create unique index if not exists ux_ride_requests_driver_matched
on public.ride_requests(assigned_driver_id)
where status = 'matched' and assigned_driver_id is not null;

-- One driver should not have multiple active rides
create unique index if not exists ux_rides_driver_active
on public.rides(driver_id)
where status in ('assigned','arrived','in_progress');

-- 4) Transactional dispatch RPCs (called by Edge Functions with service role)

-- Match request to a driver atomically. Also expires stale matches for this request.

-- Accept request and create ride atomically

-- 5) Expire stale matches (for cron/maintenance)

-- 6) Payment skeleton (provider-agnostic; optional external providers)
do $$ begin
  create type public.payment_intent_status as enum (
    'requires_payment_method',
    'requires_confirmation',
    'requires_capture',
    'succeeded',
    'failed',
    'canceled',
    'refunded'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  provider text not null default 'stub',
  provider_ref text,
  status public.payment_intent_status not null default 'requires_payment_method',
  amount_iqd integer not null,
  currency text not null default 'IQD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payment_intents_set_updated_at
before update on public.payment_intents
for each row execute function public.set_updated_at();

create index if not exists ix_payment_intents_ride_id on public.payment_intents(ride_id);

alter table public.payment_intents enable row level security;

drop policy if exists "payment_intents_select_participants" on public.payment_intents;
create policy "payment_intents_select_participants"
on public.payment_intents for select
to authenticated
using (
  exists (
    select 1
    from public.rides r
    where r.id = payment_intents.ride_id
      and (r.rider_id = auth.uid() or r.driver_id = auth.uid())
  )
);

-- 7) Restrict access to dispatch functions (Edge Functions only)
revoke all on function public.dispatch_match_ride(uuid, uuid, numeric, integer, integer, integer) from public;
revoke all on function public.dispatch_accept_ride(uuid, uuid) from public;

grant execute on function public.dispatch_match_ride(uuid, uuid, numeric, integer, integer, integer) to service_role;
grant execute on function public.dispatch_accept_ride(uuid, uuid) to service_role;

-- =====================================================================
-- MIGRATION: supabase/migrations/20260119000400_session2_fix.sql
-- =====================================================================
-- Session 2 (continuation): fixes
-- - Enforce match TTL in accept flow
-- - Allow rider cancellation from no_driver/expired states

-- 1) Allow rider cancellation from additional pre-accept statuses
-- (requested, matched, no_driver, expired) -> cancelled

drop policy if exists "ride_requests_update_own_cancel" on public.ride_requests;

create policy "ride_requests_update_own_cancel"
on public.ride_requests for update
to authenticated
using (auth.uid() = rider_id and status in ('requested','matched','no_driver','expired'))
with check (auth.uid() = rider_id and status = 'cancelled');

-- 2) Enforce match_deadline when driver accepts

-- Ensure privileges remain
grant execute on function public.dispatch_accept_ride(uuid, uuid) to authenticated, service_role;

-- =====================================================================
-- MIGRATION: supabase/migrations/20260119000500_session4.sql
-- =====================================================================
-- Session 4: Payments, observability, and rate limiting hardening

-- 1) Payment intent: add provider-specific fields + idempotency
alter table public.payment_intents
  add column if not exists idempotency_key text,
  add column if not exists provider_session_id text,
  add column if not exists provider_payment_intent_id text,
  add column if not exists last_error text;

create index if not exists ix_payment_intents_provider_session_id
  on public.payment_intents(provider_session_id);

create index if not exists ix_payment_intents_provider_payment_intent_id
  on public.payment_intents(provider_payment_intent_id);

-- Only one "active" payment attempt per ride at a time.
create unique index if not exists ux_payment_intents_ride_active
  on public.payment_intents(ride_id)
  where status in ('requires_payment_method','requires_confirmation','requires_capture');

-- 2) Ride payment fields
alter table public.rides
  add column if not exists paid_at timestamptz,
  add column if not exists payment_intent_id uuid references public.payment_intents(id) on delete set null;

create index if not exists ix_rides_paid_at
  on public.rides(paid_at desc);

-- Prevent duplicate successful payment rows (webhook retries)
create unique index if not exists ux_payments_ride_succeeded
  on public.payments(ride_id)
  where status = 'succeeded';

create index if not exists ix_app_events_created_at
  on public.app_events(created_at desc);

create index if not exists ix_app_events_event_type
  on public.app_events(event_type);

create index if not exists ix_app_events_ride_id
  on public.app_events(ride_id);

alter table public.app_events enable row level security;

drop policy if exists "app_events_select_none" on public.app_events;
create policy "app_events_select_none"
on public.app_events for select
to authenticated
using (false);

-- 5) API rate limiting (Postgres-backed; edge functions call a single RPC)
create table if not exists public.api_rate_limits (
  key text not null,
  window_start timestamptz not null,
  window_seconds integer not null,
  count integer not null default 0,
  primary key (key, window_start, window_seconds)
);

alter table public.api_rate_limits enable row level security;

drop policy if exists "api_rate_limits_select_none" on public.api_rate_limits;
create policy "api_rate_limits_select_none"
on public.api_rate_limits for select
to authenticated
using (false);

create or replace function public.rate_limit_consume(
  p_key text,
  p_window_seconds integer,
  p_limit integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
declare
  now_ts timestamptz := now();
  epoch bigint := floor(extract(epoch from now_ts));
  start_epoch bigint;
  win_start timestamptz;
  new_count integer;
begin
  if p_window_seconds <= 0 or p_limit <= 0 then
    allowed := true;
    remaining := 0;
    reset_at := now_ts;
    return next;
    return;
  end if;

  start_epoch := (epoch / p_window_seconds) * p_window_seconds;
  win_start := to_timestamp(start_epoch);

  insert into public.api_rate_limits(key, window_start, window_seconds, count)
  values (p_key, win_start, p_window_seconds, 1)
  on conflict (key, window_start, window_seconds)
  do update set count = public.api_rate_limits.count + 1
  returning count into new_count;

  allowed := new_count <= p_limit;
  remaining := greatest(p_limit - new_count, 0);
  reset_at := win_start + make_interval(secs => p_window_seconds);
  return next;
end;
$$;

revoke all on function public.rate_limit_consume(text, integer, integer) from public;
grant execute on function public.rate_limit_consume(text, integer, integer) to service_role;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260119000600_session5.sql
-- =====================================================================

-- Session 5: Payment hardening (failures + refunds), observability levels, and admin reconciliation helpers

-- 1) Payments table hardening (align with webhooks + future providers)
alter table public.payments
  add column if not exists payment_intent_id uuid references public.payment_intents(id) on delete set null,
  add column if not exists provider_payment_intent_id text,
  add column if not exists provider_charge_id text,
  add column if not exists provider_refund_id text,
  add column if not exists method text,
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists refunded_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

create index if not exists ix_payments_payment_intent_id on public.payments(payment_intent_id);
create index if not exists ix_payments_provider_payment_intent_id on public.payments(provider_payment_intent_id);

-- Ensure refund IDs are unique when present (webhook retries)
create unique index if not exists ux_payments_provider_refund_id
  on public.payments(provider_refund_id)
  where provider_refund_id is not null;

-- 2) Payment intents: track charge id when known
alter table public.payment_intents
  add column if not exists provider_charge_id text;

create index if not exists ix_payment_intents_provider_charge_id
  on public.payment_intents(provider_charge_id);

-- 3) Observability levels
alter table public.app_events
  add column if not exists level text not null default 'info';

create index if not exists ix_app_events_level
  on public.app_events(level);

-- 4) Admin reconciliation helpers (service_role only)

-- =====================================================================
-- MIGRATION: supabase/migrations/20260119000700_session6.sql
-- =====================================================================
-- Session 6: Ride history + receipts, mutual ratings, and support/safety incident hooks

-- 0) Helper: updated_at function exists from Session 0 (public.set_updated_at)

-- 1) Party role enum (rider/driver)
do $$ begin
  create type public.party_role as enum ('rider','driver');
exception when duplicate_object then null; end $$;

-- 2) Add rating aggregates
alter table public.drivers
  add column if not exists rating_count integer not null default 0;

alter table public.profiles
  add column if not exists rating_avg numeric(3,2) not null default 5.00,
  add column if not exists rating_count integer not null default 0;

create index if not exists ix_drivers_rating_avg on public.drivers(rating_avg desc);
create index if not exists ix_profiles_rating_avg on public.profiles(rating_avg desc);

-- 3) Ride receipts (generated automatically on successful payment)
create table if not exists public.ride_receipts (
  ride_id uuid primary key references public.rides(id) on delete cascade,
  base_fare_iqd integer,
  tax_iqd integer not null default 0,
  tip_iqd integer not null default 0,
  total_iqd integer not null,
  currency text not null default 'IQD',
  generated_at timestamptz not null default now()
);

create index if not exists ix_ride_receipts_generated_at on public.ride_receipts(generated_at desc);

alter table public.ride_receipts enable row level security;

drop policy if exists "ride_receipts_select_participants" on public.ride_receipts;
create policy "ride_receipts_select_participants"
on public.ride_receipts for select
to authenticated
using (
  exists (
    select 1
    from public.rides r
    where r.id = ride_receipts.ride_id
      and (r.rider_id = auth.uid() or r.driver_id = auth.uid())
  )
);

-- No direct inserts/updates/deletes from clients

create or replace function public.create_receipt_from_payment()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
declare
  v_ride public.rides%rowtype;
  v_base integer;
  v_total integer;
  v_tip integer;
  v_currency text;
begin
  -- Only generate receipt for succeeded payments
  if new.status <> 'succeeded' then
    return new;
  end if;

  select * into v_ride from public.rides where id = new.ride_id;
  if not found then
    return new;
  end if;

  v_currency := coalesce(new.currency, v_ride.currency, 'IQD');
  v_total := greatest(new.amount_iqd, 0);
  v_base := coalesce(v_ride.fare_amount_iqd, v_total);
  v_tip := greatest(v_total - v_base, 0);

  insert into public.ride_receipts (ride_id, base_fare_iqd, tax_iqd, tip_iqd, total_iqd, currency)
  values (new.ride_id, v_base, 0, v_tip, v_total, v_currency)
  on conflict (ride_id) do update
    set base_fare_iqd = excluded.base_fare_iqd,
        tax_iqd = excluded.tax_iqd,
        tip_iqd = excluded.tip_iqd,
        total_iqd = excluded.total_iqd,
        currency = excluded.currency,
        generated_at = now();

  return new;
end;
$$;

-- Trigger on payment insert (idempotent via upsert)
do $$ begin
  create trigger payments_generate_receipt
  after insert on public.payments
  for each row execute function public.create_receipt_from_payment();
exception when duplicate_object then null; end $$;

-- 4) Mutual ratings
create table if not exists public.ride_ratings (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  rater_id uuid not null references public.profiles(id) on delete cascade,
  ratee_id uuid not null references public.profiles(id) on delete cascade,
  rater_role public.party_role not null,
  ratee_role public.party_role not null,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_ride_ratings_ride_rater on public.ride_ratings(ride_id, rater_id);
create index if not exists ix_ride_ratings_ride_id on public.ride_ratings(ride_id);
create index if not exists ix_ride_ratings_ratee_id on public.ride_ratings(ratee_id);

alter table public.ride_ratings enable row level security;

drop policy if exists "ride_ratings_select_participants" on public.ride_ratings;
create policy "ride_ratings_select_participants"
on public.ride_ratings for select
to authenticated
using (
  exists (
    select 1
    from public.rides r
    where r.id = ride_ratings.ride_id
      and (r.rider_id = auth.uid() or r.driver_id = auth.uid())
  )
);

-- Clients should not insert directly; use the RPC below

create or replace function public.submit_ride_rating(
  p_ride_id uuid,
  p_rating smallint,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
declare
  v_uid uuid;
  v_ride public.rides%rowtype;
  v_rater_role public.party_role;
  v_ratee_role public.party_role;
  v_ratee_id uuid;
  v_rating_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
    and status = 'completed'
    and (rider_id = v_uid or driver_id = v_uid);

  if not found then
    raise exception 'not_allowed';
  end if;

  if v_ride.rider_id = v_uid then
    v_rater_role := 'rider';
    v_ratee_role := 'driver';
    v_ratee_id := v_ride.driver_id;
  else
    v_rater_role := 'driver';
    v_ratee_role := 'rider';
    v_ratee_id := v_ride.rider_id;
  end if;

  insert into public.ride_ratings (ride_id, rater_id, ratee_id, rater_role, ratee_role, rating, comment)
  values (p_ride_id, v_uid, v_ratee_id, v_rater_role, v_ratee_role, p_rating, p_comment)
  on conflict (ride_id, rater_id) do nothing;

  select id into v_rating_id
  from public.ride_ratings
  where ride_id = p_ride_id and rater_id = v_uid;

  return v_rating_id;
end;
$$;

revoke all on function public.submit_ride_rating(uuid, smallint, text) from public;
grant execute on function public.submit_ride_rating(uuid, smallint, text) to authenticated;

-- Apply rating aggregates (incremental average)
create or replace function public.apply_rating_aggregate()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
begin
  if new.ratee_role = 'driver' then
    update public.drivers
      set rating_avg = ((rating_avg * rating_count) + new.rating)::numeric / (rating_count + 1),
          rating_count = rating_count + 1
      where id = new.ratee_id;
  elsif new.ratee_role = 'rider' then
    update public.profiles
      set rating_avg = ((rating_avg * rating_count) + new.rating)::numeric / (rating_count + 1),
          rating_count = rating_count + 1
      where id = new.ratee_id;
  end if;
  return new;
end;
$$;

do $$ begin
  create trigger ride_ratings_apply_aggregate
  after insert on public.ride_ratings
  for each row execute function public.apply_rating_aggregate();
exception when duplicate_object then null; end $$;

-- 5) Support / safety incidents (participants can file; service_role can triage)
do $$ begin
  create type public.incident_severity as enum ('low','medium','high','critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.incident_status as enum ('open','triaging','resolved','closed');
exception when duplicate_object then null; end $$;

create table if not exists public.ride_incidents (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  severity public.incident_severity not null default 'low',
  status public.incident_status not null default 'open',
  category text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ride_incidents_set_updated_at
before update on public.ride_incidents
for each row execute function public.set_updated_at();

create index if not exists ix_ride_incidents_ride_id on public.ride_incidents(ride_id);
create index if not exists ix_ride_incidents_reporter_id on public.ride_incidents(reporter_id);
create index if not exists ix_ride_incidents_status on public.ride_incidents(status);
create index if not exists ix_ride_incidents_created_at on public.ride_incidents(created_at desc);

alter table public.ride_incidents enable row level security;

drop policy if exists "ride_incidents_select_reporter_or_participant" on public.ride_incidents;
create policy "ride_incidents_select_reporter_or_participant"
on public.ride_incidents for select
to authenticated
using (
  reporter_id = auth.uid()
  or exists (
    select 1
    from public.rides r
    where r.id = ride_incidents.ride_id
      and (r.rider_id = auth.uid() or r.driver_id = auth.uid())
  )
);

-- Use RPC for creation to validate participant and centralize logic
create or replace function public.create_ride_incident(
  p_ride_id uuid,
  p_category text,
  p_description text,
  p_severity public.incident_severity default 'low'
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
declare
  v_uid uuid;
  v_ok boolean;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select exists(
    select 1 from public.rides r
    where r.id = p_ride_id and (r.rider_id = v_uid or r.driver_id = v_uid)
  ) into v_ok;

  if not v_ok then
    raise exception 'not_allowed';
  end if;

  insert into public.ride_incidents (ride_id, reporter_id, category, description, severity)
  values (p_ride_id, v_uid, left(coalesce(p_category,''), 120), nullif(p_description,''), p_severity)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_ride_incident(uuid, text, text, public.incident_severity) from public;
grant execute on function public.create_ride_incident(uuid, text, text, public.incident_severity) to authenticated;

-- 6) RLS performance hints: indexes are added above for columns used in EXISTS predicates
-- (See Supabase RLS performance best practices)
-- =====================================================================
-- MIGRATION: supabase/migrations/20260119000800_session7.sql
-- =====================================================================
-- Session 7: Admin incidents inbox + history pagination support + refund-aware receipts

-- 1) Admin flag on profiles
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Helper for RLS: table owner function can bypass RLS checks on profiles (unless FORCE RLS).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Allow admins to read profiles (needed for admin tooling).
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

-- 2) Incidents: add admin workflow fields
alter table public.ride_incidents
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists resolution_note text;

create index if not exists ix_ride_incidents_assigned_to on public.ride_incidents(assigned_to);
create index if not exists ix_ride_incidents_severity on public.ride_incidents(severity);

-- Extend select policy to admins; add admin update policy
drop policy if exists "ride_incidents_select_reporter_or_participant" on public.ride_incidents;
create policy "ride_incidents_select_reporter_participant_or_admin"
on public.ride_incidents for select
to authenticated
using (
  public.is_admin()
  or reporter_id = auth.uid()
  or exists (
    select 1
    from public.rides r
    where r.id = ride_incidents.ride_id
      and (r.rider_id = auth.uid() or r.driver_id = auth.uid())
  )
);

drop policy if exists "ride_incidents_admin_update" on public.ride_incidents;
create policy "ride_incidents_admin_update"
on public.ride_incidents for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Admin RPC to update incidents with validation + consistent timestamps
create or replace function public.admin_update_ride_incident(
  p_incident_id uuid,
  p_status public.incident_status default null,
  p_assigned_to uuid default null,
  p_resolution_note text default null
)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;

  update public.ride_incidents
  set
    status = coalesce(p_status, status),
    assigned_to = coalesce(p_assigned_to, assigned_to),
    resolution_note = coalesce(p_resolution_note, resolution_note),
    reviewed_at = case when p_status is null then reviewed_at else now() end
  where id = p_incident_id;

  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.admin_update_ride_incident(uuid, public.incident_status, uuid, text) from public;
grant execute on function public.admin_update_ride_incident(uuid, public.incident_status, uuid, text) to authenticated;

-- 3) Refund-aware receipts
alter table public.payments
  add column if not exists refund_amount_iqd integer;

alter table public.ride_receipts
  add column if not exists refunded_iqd integer not null default 0,
  add column if not exists refunded_at timestamptz,
  add column if not exists receipt_status text not null default 'paid';

create or replace function public.update_receipt_on_refund()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
declare
  v_total integer;
  v_refund integer;
begin
  -- Only act when a refund is recorded/updated
  if new.refunded_at is null and new.provider_refund_id is null then
    return new;
  end if;

  select rr.total_iqd into v_total
  from public.ride_receipts rr
  where rr.ride_id = new.ride_id;

  if v_total is null then
    return new;
  end if;

  v_refund := greatest(coalesce(new.refund_amount_iqd, 0), 0);

  update public.ride_receipts
  set
    refunded_iqd = greatest(refunded_iqd, v_refund),
    refunded_at = coalesce(new.refunded_at, refunded_at, now()),
    receipt_status = case
      when v_refund >= v_total then 'refunded'
      when v_refund > 0 then 'partially_refunded'
      else receipt_status
    end
  where ride_id = new.ride_id;

  return new;
end;
$$;

do $$ begin
  create trigger payments_update_receipt_on_refund
  after update on public.payments
  for each row
  execute function public.update_receipt_on_refund();
exception when duplicate_object then null; end $$;

-- 4) Helpful indexes for paging
create index if not exists ix_rides_created_at on public.rides(created_at desc);
create index if not exists ix_rides_rider_created_at on public.rides(rider_id, created_at desc);
create index if not exists ix_rides_driver_created_at on public.rides(driver_id, created_at desc);
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120000100_session12_wallet.sql
-- =====================================================================
-- Session 12: Wallet (IQD) foundation + top-up intents + holds
--
-- Adds primitives needed for:
-- - Balance
-- - Transaction history
-- - Top-up history
-- - Holds breakdown

-- Enums
DO $$ BEGIN
  CREATE TYPE public.payment_provider_kind AS ENUM ('zaincash','asiapay','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.topup_status AS ENUM ('created','pending','succeeded','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wallet_hold_status AS ENUM ('active','captured','released');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wallet_entry_kind AS ENUM ('topup','ride_fare','adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Wallet accounts (one row per user)
CREATE TABLE IF NOT EXISTS public.wallet_accounts (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance_iqd bigint NOT NULL DEFAULT 0 CHECK (balance_iqd >= 0),
  held_iqd bigint NOT NULL DEFAULT 0 CHECK (held_iqd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS wallet_accounts_set_updated_at ON public.wallet_accounts;
CREATE TRIGGER wallet_accounts_set_updated_at
BEFORE UPDATE ON public.wallet_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_accounts_select_own" ON public.wallet_accounts;
CREATE POLICY "wallet_accounts_select_own"
ON public.wallet_accounts FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "wallet_accounts_insert_own" ON public.wallet_accounts;
CREATE POLICY "wallet_accounts_insert_own"
ON public.wallet_accounts FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Wallet entries (ledger of balance-affecting movements)
CREATE TABLE IF NOT EXISTS public.wallet_entries (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind public.wallet_entry_kind NOT NULL,
  delta_iqd bigint NOT NULL,
  memo text,
  source_type text,
  source_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_wallet_entries_user_created
  ON public.wallet_entries(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_entries_user_idempotency
  ON public.wallet_entries(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.wallet_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_entries_select_own" ON public.wallet_entries;
CREATE POLICY "wallet_entries_select_own"
ON public.wallet_entries FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Wallet holds (reserved funds)
CREATE TABLE IF NOT EXISTS public.wallet_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  amount_iqd bigint NOT NULL CHECK (amount_iqd > 0),
  status public.wallet_hold_status NOT NULL DEFAULT 'active',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  captured_at timestamptz,
  released_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_wallet_holds_user_created
  ON public.wallet_holds(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_wallet_holds_ride_id
  ON public.wallet_holds(ride_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_holds_active_per_ride
  ON public.wallet_holds(ride_id)
  WHERE ride_id IS NOT NULL AND status = 'active';

ALTER TABLE public.wallet_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_holds_select_own" ON public.wallet_holds;
CREATE POLICY "wallet_holds_select_own"
ON public.wallet_holds FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Payment providers (admin-managed)
CREATE TABLE IF NOT EXISTS public.payment_providers (
  code text PRIMARY KEY,
  name text NOT NULL,
  kind public.payment_provider_kind NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS payment_providers_set_updated_at ON public.payment_providers;
CREATE TRIGGER payment_providers_set_updated_at
BEFORE UPDATE ON public.payment_providers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_providers_select_authenticated" ON public.payment_providers;
CREATE POLICY "payment_providers_select_authenticated"
ON public.payment_providers FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "payment_providers_admin_insert" ON public.payment_providers;
CREATE POLICY "payment_providers_admin_insert"
ON public.payment_providers FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "payment_providers_admin_update" ON public.payment_providers;
CREATE POLICY "payment_providers_admin_update"
ON public.payment_providers FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "payment_providers_admin_delete" ON public.payment_providers;
CREATE POLICY "payment_providers_admin_delete"
ON public.payment_providers FOR DELETE
TO authenticated
USING (public.is_admin());

-- Top-up packages (admin-managed)
CREATE TABLE IF NOT EXISTS public.topup_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  amount_iqd bigint NOT NULL CHECK (amount_iqd > 0),
  bonus_iqd bigint NOT NULL DEFAULT 0 CHECK (bonus_iqd >= 0),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_topup_packages_label
  ON public.topup_packages(label);

DROP TRIGGER IF EXISTS topup_packages_set_updated_at ON public.topup_packages;
CREATE TRIGGER topup_packages_set_updated_at
BEFORE UPDATE ON public.topup_packages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.topup_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "topup_packages_select_active_or_admin" ON public.topup_packages;
CREATE POLICY "topup_packages_select_active_or_admin"
ON public.topup_packages FOR SELECT
TO authenticated
USING (active OR public.is_admin());

DROP POLICY IF EXISTS "topup_packages_admin_insert" ON public.topup_packages;
CREATE POLICY "topup_packages_admin_insert"
ON public.topup_packages FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "topup_packages_admin_update" ON public.topup_packages;
CREATE POLICY "topup_packages_admin_update"
ON public.topup_packages FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "topup_packages_admin_delete" ON public.topup_packages;
CREATE POLICY "topup_packages_admin_delete"
ON public.topup_packages FOR DELETE
TO authenticated
USING (public.is_admin());

-- Top-up intents (user-owned)
CREATE TABLE IF NOT EXISTS public.topup_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_code text NOT NULL REFERENCES public.payment_providers(code),
  package_id uuid REFERENCES public.topup_packages(id),
  amount_iqd bigint NOT NULL CHECK (amount_iqd > 0),
  bonus_iqd bigint NOT NULL DEFAULT 0 CHECK (bonus_iqd >= 0),
  status public.topup_status NOT NULL DEFAULT 'created',
  idempotency_key text,
  provider_tx_id text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

DROP TRIGGER IF EXISTS topup_intents_set_updated_at ON public.topup_intents;
CREATE TRIGGER topup_intents_set_updated_at
BEFORE UPDATE ON public.topup_intents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS ix_topup_intents_user_created
  ON public.topup_intents(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_topup_intents_status
  ON public.topup_intents(status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_topup_intents_user_idempotency
  ON public.topup_intents(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.topup_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "topup_intents_select_own_or_admin" ON public.topup_intents;
CREATE POLICY "topup_intents_select_own_or_admin"
ON public.topup_intents FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

-- Allow users to insert their own intent row in 'created' state (optional; Edge Function may also insert via service role).
DROP POLICY IF EXISTS "topup_intents_insert_own" ON public.topup_intents;
CREATE POLICY "topup_intents_insert_own"
ON public.topup_intents FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND status = 'created');

-- Admin support updates only (users cannot update).
DROP POLICY IF EXISTS "topup_intents_admin_update" ON public.topup_intents;
CREATE POLICY "topup_intents_admin_update"
ON public.topup_intents FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Provider events (admin-only visibility)
CREATE TABLE IF NOT EXISTS public.provider_events (
  id bigserial PRIMARY KEY,
  provider_code text NOT NULL REFERENCES public.payment_providers(code),
  provider_event_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_events_provider_event
  ON public.provider_events(provider_code, provider_event_id);

ALTER TABLE public.provider_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_events_admin_select" ON public.provider_events;
CREATE POLICY "provider_events_admin_select"
ON public.provider_events FOR SELECT
TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "provider_events_admin_insert" ON public.provider_events;
CREATE POLICY "provider_events_admin_insert"
ON public.provider_events FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- Auto-create wallet account when profile is created
CREATE OR REPLACE FUNCTION public.ensure_wallet_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog'
AS $$
BEGIN
  INSERT INTO public.wallet_accounts(user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_ensure_wallet_account ON public.profiles;
CREATE TRIGGER profiles_ensure_wallet_account
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_wallet_account();

-- RPC: initialize wallet (idempotent)

-- RPC: fetch wallet account (idempotent init if missing)
CREATE OR REPLACE FUNCTION public.wallet_get_my_account()
RETURNS public.wallet_accounts
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.wallet_accounts(user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN (SELECT wa FROM public.wallet_accounts wa WHERE wa.user_id = v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_get_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_get_my_account() TO authenticated;

-- Service RPC: finalize a successful top-up (idempotent)

REVOKE ALL ON FUNCTION public.wallet_finalize_topup(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_finalize_topup(uuid, text, jsonb) TO service_role;

-- Service RPC: mark a top-up failed (idempotent)
CREATE OR REPLACE FUNCTION public.wallet_fail_topup(
  p_intent_id uuid,
  p_failure_reason text,
  p_provider_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS public.topup_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog'
AS $$
DECLARE
  v_intent public.topup_intents;
BEGIN
  SELECT * INTO v_intent
  FROM public.topup_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'topup_intent_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_intent.status IN ('failed','succeeded') THEN
    RETURN v_intent;
  END IF;

  UPDATE public.topup_intents
  SET
    status = 'failed',
    failure_reason = p_failure_reason,
    provider_payload = COALESCE(p_provider_payload, provider_payload),
    completed_at = now(),
    updated_at = now()
  WHERE id = p_intent_id;

  RETURN (SELECT ti FROM public.topup_intents ti WHERE ti.id = p_intent_id);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_fail_topup(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_fail_topup(uuid, text, jsonb) TO service_role;

-- Seed defaults (safe/idempotent)
INSERT INTO public.payment_providers(code, name, kind, enabled, sort_order)
VALUES
  ('zaincash', 'ZainCash', 'zaincash', false, 10),
  ('asiapay', 'AsiaPay', 'asiapay', false, 20),
  ('manual', 'Manual', 'manual', false, 999)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.topup_packages(label, amount_iqd, bonus_iqd, active, sort_order)
VALUES
  ('10,000 IQD', 10000, 0, true, 10),
  ('25,000 IQD (+1,000 bonus)', 25000, 1000, true, 20),
  ('50,000 IQD (+3,000 bonus)', 50000, 3000, true, 30)
ON CONFLICT (label) DO NOTHING;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120000200_session12_wallet_rides.sql
-- =====================================================================
-- Session 12 (part 2): Wallet holds for rides + atomic ride transitions

-- 1) Link rides to wallet holds
alter table public.rides
  add column if not exists wallet_hold_id uuid references public.wallet_holds(id) on delete set null;

create index if not exists ix_rides_wallet_hold_id
  on public.rides(wallet_hold_id);

-- 2) Reserve funds (hold) for a ride
create or replace function public.wallet_hold_upsert_for_ride(
  p_user_id uuid,
  p_ride_id uuid,
  p_amount_iqd bigint
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog, extensions'
as $$
declare
  v_hold_id uuid;
  v_balance bigint;
  v_held bigint;
  v_available bigint;
  v_inserted boolean := false;
begin
  if p_amount_iqd <= 0 then
    raise exception 'invalid_amount';
  end if;

  -- Ensure wallet exists
  insert into public.wallet_accounts(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- Lock wallet row
  select balance_iqd, held_iqd
    into v_balance, v_held
  from public.wallet_accounts
  where user_id = p_user_id
  for update;

  v_available := coalesce(v_balance,0) - coalesce(v_held,0);
  if v_available < p_amount_iqd then
    raise exception 'insufficient_wallet_balance';
  end if;

  -- If already active hold exists, return it.
  select id into v_hold_id
  from public.wallet_holds
  where ride_id = p_ride_id and status = 'active'
  for update;

  if v_hold_id is null then
    begin
      insert into public.wallet_holds(user_id, ride_id, amount_iqd, status)
      values (p_user_id, p_ride_id, p_amount_iqd, 'active')
      returning id into v_hold_id;
      v_inserted := true;
    exception when unique_violation then
      select id into v_hold_id
      from public.wallet_holds
      where ride_id = p_ride_id and status = 'active'
      for update;
      v_inserted := false;
    end;
  end if;

  -- Only adjust held_iqd when we created the hold.
  if v_inserted then
    update public.wallet_accounts
      set held_iqd = held_iqd + p_amount_iqd,
          updated_at = now()
    where user_id = p_user_id;

    update public.rides
      set wallet_hold_id = v_hold_id
    where id = p_ride_id;
  end if;

  return v_hold_id;
end;
$$;

grant execute on function public.wallet_hold_upsert_for_ride(uuid, uuid, bigint) to service_role;
revoke execute on function public.wallet_hold_upsert_for_ride(uuid, uuid, bigint) from authenticated;

-- 3) Release a hold (cancellation)
create or replace function public.wallet_release_ride_hold(
  p_ride_id uuid
)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog, extensions'
as $$
declare
  h record;
begin
  select * into h
  from public.wallet_holds
  where ride_id = p_ride_id and status = 'active'
  for update;

  if not found then
    return;
  end if;

  update public.wallet_holds
    set status = 'released', released_at = now(), updated_at = now()
  where id = h.id and status = 'active';

  update public.wallet_accounts
    set held_iqd = greatest(0, held_iqd - h.amount_iqd),
        updated_at = now()
  where user_id = h.user_id;
end;
$$;

grant execute on function public.wallet_release_ride_hold(uuid) to service_role;
revoke execute on function public.wallet_release_ride_hold(uuid) from authenticated;

-- 4) Capture a hold (completion)

grant execute on function public.wallet_capture_ride_hold(uuid) to service_role;
revoke execute on function public.wallet_capture_ride_hold(uuid) from authenticated;

-- 5) Patch dispatch_accept_ride to reserve funds on accept
create or replace function public.dispatch_accept_ride(
  p_request_id uuid,
  p_driver_id uuid
)
returns table (
  id uuid,
  request_id uuid,
  rider_id uuid,
  driver_id uuid,
  status public.ride_status,
  version integer,
  created_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  fare_amount_iqd integer,
  currency text
)
language plpgsql
security definer
set search_path = 'pg_catalog, extensions'
as $$
declare
  rr record;
  r record;
  d_status public.driver_status;
  v_hold_id uuid;
begin
  -- Lock request row
  select * into rr
  from public.ride_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'ride_request_not_found';
  end if;

  -- If already accepted, return the ride (idempotent) + ensure a hold exists.
  if rr.status = 'accepted' then
    select * into r from public.rides where request_id = rr.id;
    if r.wallet_hold_id is null then
      v_hold_id := public.wallet_hold_upsert_for_ride(r.rider_id, r.id, r.fare_amount_iqd::bigint);
    end if;
    return query select r.id, r.request_id, r.rider_id, r.driver_id, r.status, r.version, r.created_at, r.started_at, r.completed_at, r.fare_amount_iqd, r.currency;
    return;
  end if;

  if rr.status <> 'matched' then
    raise exception 'request_not_matched';
  end if;

  if rr.assigned_driver_id is null or rr.assigned_driver_id <> p_driver_id then
    raise exception 'forbidden';
  end if;

  -- Enforce TTL (driver must accept before match_deadline)
  if rr.match_deadline is not null and rr.match_deadline <= now() then
    -- Mark expired (release trigger will make driver available and clear match fields)
    update public.ride_requests
      set status = 'expired'
    where id = rr.id and status = 'matched';

    raise exception 'match_expired';
  end if;

  -- Ensure driver is currently reserved
  select status into d_status
  from public.drivers
  where id = p_driver_id
  for update;

  if d_status is distinct from 'reserved' then
    raise exception 'driver_not_reserved';
  end if;

  -- Mark accepted
  update public.ride_requests
    set status = 'accepted'
  where id = rr.id and status = 'matched';

  -- Create ride (idempotent)
  insert into public.rides (request_id, rider_id, driver_id, status, version, started_at, completed_at, fare_amount_iqd, currency)
  values (rr.id, rr.rider_id, p_driver_id, 'assigned', 0, null, null, rr.quote_amount_iqd, rr.currency)
  on conflict (request_id) do update
    set driver_id = excluded.driver_id
  returning * into r;

  -- Reserve fare amount from rider wallet (hold)
  v_hold_id := public.wallet_hold_upsert_for_ride(r.rider_id, r.id, r.fare_amount_iqd::bigint);

  -- Driver is now on-trip
  update public.drivers
    set status = 'on_trip'
  where id = p_driver_id;

  -- Event log
  insert into public.ride_events (ride_id, actor_id, actor_type, event_type, payload)
  values (r.id, p_driver_id, 'driver', 'driver_accepted', jsonb_build_object('request_id', rr.id, 'wallet_hold_id', v_hold_id));

  return query select r.id, r.request_id, r.rider_id, r.driver_id, r.status, r.version, r.created_at, r.started_at, r.completed_at, r.fare_amount_iqd, r.currency;
end;
$$;

revoke execute on function public.dispatch_accept_ride(uuid, uuid) from authenticated;
grant execute on function public.dispatch_accept_ride(uuid, uuid) to service_role;

-- 6) Atomic transition: status update + driver availability + wallet settlement
create or replace function public.transition_ride_v2(
  p_ride_id uuid,
  p_to_status public.ride_status,
  p_actor_id uuid,
  p_actor_type public.ride_actor_type,
  p_expected_version integer
)
returns public.rides
language plpgsql
security definer
set search_path = 'pg_catalog, extensions'
as $$
declare
  r public.rides;
  v_from public.ride_status;
begin
  select * into r from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'ride_not_found';
  end if;

  if r.version <> p_expected_version then
    raise exception 'version_mismatch';
  end if;

  v_from := r.status;

  -- Allowed transitions
  if not (
    (v_from = 'assigned' and p_to_status in ('arrived','canceled')) or
    (v_from = 'arrived' and p_to_status in ('in_progress','canceled')) or
    (v_from = 'in_progress' and p_to_status in ('completed','canceled'))
  ) then
    raise exception 'invalid_transition';
  end if;

  update public.rides
    set status = p_to_status,
        version = version + 1,
        started_at = case when p_to_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
        completed_at = case when p_to_status = 'completed' then coalesce(completed_at, now()) else completed_at end
  where id = r.id
  returning * into r;

  insert into public.ride_events (ride_id, actor_id, actor_type, event_type, payload)
  values (r.id, p_actor_id, p_actor_type, 'ride_status_changed',
          jsonb_build_object('from', v_from, 'to', p_to_status));

  if p_to_status in ('completed','canceled') then
    update public.drivers
      set status = 'available'
    where id = r.driver_id;
  end if;

  if p_to_status = 'completed' then
    perform public.wallet_capture_ride_hold(r.id);
  elsif p_to_status = 'canceled' then
    perform public.wallet_release_ride_hold(r.id);
  end if;

  return r;
end;
$$;

revoke execute on function public.transition_ride_v2(uuid, public.ride_status, uuid, public.ride_actor_type, integer)
  from authenticated;
grant execute on function public.transition_ride_v2(uuid, public.ride_status, uuid, public.ride_actor_type, integer)
  to service_role;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120000300_session12_wallet_fixes.sql
-- =====================================================================
-- Session 12 fixes: wallet holds updated_at + idempotency + payments uniqueness

-- 1) wallet_holds: add updated_at (used by settlement functions + UI)
alter table public.wallet_holds
  add column if not exists updated_at timestamptz not null default now();

update public.wallet_holds
set updated_at = coalesce(updated_at, created_at)
where updated_at is null;

drop trigger if exists wallet_holds_set_updated_at on public.wallet_holds;
create trigger wallet_holds_set_updated_at
before update on public.wallet_holds
for each row execute function public.set_updated_at();

-- 2) Ensure payments can store metadata (used by wallet capture)
alter table public.payments
  add column if not exists metadata jsonb not null default {}::jsonb;

-- 3) Ensure a single succeeded payment per ride (used by wallet_capture_ride_hold idempotency)
create unique index if not exists ux_payments_ride_succeeded
  on public.payments(ride_id)
  where status = 'succeeded';

-- 3) Fix idempotent ledger insert for top-ups (wallet_entries has a PARTIAL unique index)
create or replace function public.wallet_finalize_topup(
  p_intent_id uuid,
  p_provider_tx_id text,
  p_provider_payload jsonb DEFAULT '{}'::jsonb
)
returns public.topup_intents
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
declare
  v_intent public.topup_intents;
  v_total_iqd bigint;
begin
  select * into v_intent
  from public.topup_intents
  where id = p_intent_id
  for update;

  if not found then
    raise exception 'topup_intent_not_found' using errcode = 'P0002';
  end if;

  if v_intent.status = 'succeeded' then
    return v_intent;
  end if;

  v_total_iqd := v_intent.amount_iqd + v_intent.bonus_iqd;

  update public.topup_intents
  set
    status = 'succeeded',
    provider_tx_id = coalesce(p_provider_tx_id, provider_tx_id),
    provider_payload = coalesce(p_provider_payload, provider_payload),
    completed_at = now(),
    updated_at = now()
  where id = p_intent_id;

  insert into public.wallet_accounts(user_id)
  values (v_intent.user_id)
  on conflict (user_id) do nothing;

  update public.wallet_accounts
  set
    balance_iqd = balance_iqd + v_total_iqd,
    updated_at = now()
  where user_id = v_intent.user_id;

  insert into public.wallet_entries(
    user_id,
    kind,
    delta_iqd,
    memo,
    source_type,
    source_id,
    metadata,
    idempotency_key
  )
  values (
    v_intent.user_id,
    'topup',
    v_total_iqd,
    'Top-up',
    'topup_intent',
    v_intent.id,
    jsonb_build_object('provider', v_intent.provider_code, 'provider_tx_id', p_provider_tx_id),
    'topup:' || v_intent.id::text
  )
  on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing;

  return (select ti from public.topup_intents ti where ti.id = p_intent_id);
end;
$$;

-- 4) Fix idempotent ledger insert for ride capture (wallet_entries has a PARTIAL unique index)

revoke all on function public.wallet_capture_ride_hold(uuid) from public;
grant execute on function public.wallet_capture_ride_hold(uuid) to service_role;
revoke execute on function public.wallet_capture_ride_hold(uuid) from authenticated;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120000400_session12_pricing_iqd.sql
-- =====================================================================
-- Session 12: switch default pricing + display to IQD (1 wallet point = 1 IQD)

-- Payments default currency
alter table public.payments
  alter column currency set default 'IQD';

-- If the only active config is the original USD seed, convert it to an IQD config.
update public.pricing_configs
set
  currency = 'IQD',
  base_fare_iqd = 2000,
  per_km_iqd = 700,
  per_min_iqd = 0,
  minimum_fare_iqd = 2500,
  updated_at = now()
where active = true
  and currency = 'IQD'
  and base_fare_iqd = 200
  and per_km_iqd = 80
  and per_min_iqd = 15
  and minimum_fare_iqd = 300;

-- If there is still no active config, seed one.
insert into public.pricing_configs (currency, base_fare_iqd, per_km_iqd, per_min_iqd, minimum_fare_iqd, active)
select 'IQD', 2000, 700, 0, 2500, true
where not exists (select 1 from public.pricing_configs where active = true);

-- Best-effort backfill for existing rows (safe if tables are empty)
update public.ride_requests
set currency = 'IQD'
where currency is null;

update public.rides
set currency = 'IQD'
where currency is null;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120000500_session12_wallet_provider_enable.sql
-- =====================================================================
-- Session 12 (part 5): Enable ZainCash provider by default for development/testing.
-- Safe to run multiple times.

update public.payment_providers
set enabled = true
where code = 'zaincash' and enabled is distinct from true;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120000600_session14_qicard_provider.sql
-- =====================================================================
-- Session 14: Add QiCard payment provider kind + seed provider row

DO $$
BEGIN
  BEGIN
    ALTER TYPE public.payment_provider_kind ADD VALUE 'qicard';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END$$;

-- Seed a QiCard provider row (disabled by default). Update config values in prod.
INSERT INTO public.payment_providers (code, kind, name, enabled, config)
VALUES (
  'qicard',
  'qicard',
  'QiCard',
  false,
  jsonb_build_object(
    'base_url', '',
    'create_path', '/api/payments',
    'status_path', '',
    'currency', 'IQD',
    'bearer_token', '',
    'webhook_secret', '',
    'return_url', ''
  )
)
ON CONFLICT (code) DO NOTHING;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120000700_session14_asiapay_provider_defaults.sql
-- =====================================================================
-- Session 14: Provide a safe default config template for AsiaPay/PayDollar.
-- Only applies if the existing config is empty.

update public.payment_providers
set config = jsonb_build_object(
  'payment_url', 'https://www.paydollar.com/b2c2/eng/dPayment/payComp.jsp',
  'merchant_id', '',
  'secure_hash_secret', '',
  'curr_code', '368',
  'pay_type', 'N',
  'lang', 'E',
  'secure_hash_type', 'sha1'
)
where code = 'asiapay'
  and (config is null or config = '{}'::jsonb);
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120000800_session15_realtime_wallet_publication.sql
-- =====================================================================
-- Session 15: enable Realtime (Postgres Changes) for wallet + topup tables.
--
-- Supabase Realtime uses the `supabase_realtime` publication. To receive Postgres
-- change events for a table, it must be added to the publication.

do $$
begin
  -- Wallet tables
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wallet_accounts'
  ) then
    execute 'alter publication supabase_realtime add table public.wallet_accounts';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wallet_entries'
  ) then
    execute 'alter publication supabase_realtime add table public.wallet_entries';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wallet_holds'
  ) then
    execute 'alter publication supabase_realtime add table public.wallet_holds';
  end if;

  -- Top-ups
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'topup_intents'
  ) then
    execute 'alter publication supabase_realtime add table public.topup_intents';
  end if;
end
$$;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120000900_session16_ride_wallet_hardening.sql
-- =====================================================================
-- Session 16: Ride ↔ Wallet hardening
--
-- Goals
--  - Best-effort funds check at match time (avoid reserving a driver for a rider who cannot pay).
--  - Stronger invariants at capture time (ensure held_iqd covers the hold amount).

-- 1) Prevent matching rides the rider cannot afford (best-effort check).
--    The authoritative check still happens on accept via wallet_hold_upsert_for_ride.
create or replace function public.dispatch_match_ride(
  p_request_id uuid,
  p_rider_id uuid,
  p_radius_m numeric default 5000,
  p_limit_n integer default 20,
  p_match_ttl_seconds integer default 120,
  p_stale_after_seconds integer default 30
)
returns table (
  id uuid,
  status public.ride_request_status,
  assigned_driver_id uuid,
  match_deadline timestamptz,
  match_attempts integer,
  matched_at timestamptz
)
language plpgsql
security definer
set search_path = 'pg_catalog, extensions'
as $$
declare
  rr record;
  candidate uuid;
  updated record;
  tried uuid[] := '{}'::uuid[];
  v_balance bigint;
  v_held bigint;
  v_available bigint;
  v_quote bigint;
begin
  -- Lock the request row
  select * into rr
  from public.ride_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'ride_request_not_found';
  end if;

  if rr.rider_id <> p_rider_id then
    raise exception 'forbidden';
  end if;

  -- Idempotency: if accepted, return current state
  if rr.status = 'accepted' then
    return query select rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
    return;
  end if;

  -- Expire stale match on this request (best-effort release)
  if rr.status = 'matched' and rr.match_deadline is not null and rr.match_deadline <= now() then
    update public.drivers
      set status = 'available'
    where id = rr.assigned_driver_id
      and status = 'reserved';

    update public.ride_requests
      set status = 'expired'
    where id = rr.id
      and status = 'matched';

    rr.status := 'expired';
  end if;

  -- If still matched and valid, return
  if rr.status = 'matched' and (rr.match_deadline is null or rr.match_deadline > now()) then
    return query select rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
    return;
  end if;

  -- Normalize re-matchable states
  if rr.status in ('no_driver','expired') then
    update public.ride_requests
      set status = 'requested'
    where id = rr.id and status in ('no_driver','expired');
    rr.status := 'requested';
  end if;

  if rr.status <> 'requested' then
    return query select rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
    return;
  end if;

  -- Best-effort funds check: ensure rider has enough available funds to cover quote.
  -- NOTE: The authoritative (locked) funds check happens on accept when we place the hold.
  v_quote := coalesce(rr.quote_amount_iqd, 0)::bigint;
  if v_quote <= 0 then
    -- Defensive: estimate quote if missing.
    v_quote := public.estimate_ride_quote_iqd(rr.pickup_loc, rr.dropoff_loc)::bigint;
    if v_quote <= 0 then
      raise exception 'invalid_quote';
    end if;
  end if;

  insert into public.wallet_accounts(user_id)
  values (rr.rider_id)
  on conflict (user_id) do nothing;

  select balance_iqd, held_iqd
    into v_balance, v_held
  from public.wallet_accounts
  where user_id = rr.rider_id;

  v_available := coalesce(v_balance,0) - coalesce(v_held,0);
  if v_available < v_quote then
    raise exception 'insufficient_wallet_balance';
  end if;

  -- Try a few times in case of rare races / unique violations
  for i in 1..3 loop
    candidate := null;

    with pickup as (
      select rr.pickup_loc as pickup
    ), candidates as (
      select d.id as driver_id
      from public.drivers d
      join public.driver_locations dl on dl.driver_id = d.id
      cross join pickup
      where d.status = 'available'
        and (array_length(tried, 1) is null or d.id <> all(tried))
        and dl.updated_at >= now() - make_interval(secs => p_stale_after_seconds)
        and st_dwithin(dl.loc, pickup.pickup, p_radius_m)
        and not exists (
          select 1 from public.rides r
          where r.driver_id = d.id
            and r.status in ('assigned','arrived','in_progress')
        )
      order by (dl.loc::geometry <-> pickup.pickup::geometry)
      limit p_limit_n
    ), locked as (
      select c.driver_id
      from candidates c
      join public.drivers d on d.id = c.driver_id
      where d.status = 'available'
      for update of d skip locked
      limit 1
    )
    select driver_id into candidate from locked;

    exit when candidate is null;

    update public.drivers
      set status = 'reserved'
    where id = candidate and status = 'available';

    if not found then
      tried := array_append(tried, candidate);
      continue;
    end if;

    begin
      update public.ride_requests
        set status = 'matched',
            assigned_driver_id = candidate,
            match_attempts = rr.match_attempts + 1,
            match_deadline = now() + make_interval(secs => p_match_ttl_seconds)
      where id = rr.id
        and status = 'requested'
        and assigned_driver_id is null
      returning id, status, assigned_driver_id, match_deadline, match_attempts, matched_at
        into updated;

      if found then
        return query select updated.id, updated.status, updated.assigned_driver_id, updated.match_deadline, updated.match_attempts, updated.matched_at;
        return;
      end if;
    exception when unique_violation then
      update public.drivers
        set status = 'available'
      where id = candidate and status = 'reserved';

      tried := array_append(tried, candidate);
      continue;
    end;

    -- If assignment didn't happen, release and retry
    update public.drivers
      set status = 'available'
    where id = candidate and status = 'reserved';

    tried := array_append(tried, candidate);
  end loop;

  -- No driver found
  update public.ride_requests
    set status = 'no_driver',
        match_attempts = rr.match_attempts + 1
  where id = rr.id and status = 'requested';

  select * into rr from public.ride_requests where id = rr.id;
  return query select rr.id, rr.status, rr.assigned_driver_id, rr.match_deadline, rr.match_attempts, rr.matched_at;
end;
$$;

revoke execute on function public.dispatch_match_ride(uuid, uuid, numeric, integer, integer, integer) from authenticated;
grant execute on function public.dispatch_match_ride(uuid, uuid, numeric, integer, integer, integer) to service_role;

-- 2) Safer capture: ensure held_iqd covers the hold amount (avoid masking inconsistencies).
create or replace function public.wallet_capture_ride_hold(
  p_ride_id uuid
)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog, extensions'
as $$
declare
  r record;
  h record;
  v_amount bigint;
  v_balance bigint;
  v_held bigint;
begin
  -- Lock ride
  select * into r
  from public.rides
  where id = p_ride_id
  for update;

  if not found then
    raise exception 'ride_not_found';
  end if;

  -- Lock hold
  select * into h
  from public.wallet_holds
  where ride_id = p_ride_id
  for update;

  if not found then
    raise exception 'hold_not_found';
  end if;

  if h.status = 'captured' then
    -- Idempotent.
    return;
  end if;

  if h.status <> 'active' then
    raise exception 'hold_not_active';
  end if;

  v_amount := h.amount_iqd;
  if v_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  -- Validate wallet state (strong invariant): held_iqd must cover the hold.
  select balance_iqd, held_iqd
    into v_balance, v_held
  from public.wallet_accounts
  where user_id = r.rider_id
  for update;

  if not found then
    raise exception 'wallet_missing';
  end if;

  if coalesce(v_held,0) < v_amount then
    raise exception 'wallet_insufficient_held';
  end if;

  if coalesce(v_balance,0) < v_amount then
    raise exception 'wallet_insufficient_balance';
  end if;

  -- Debit rider
  update public.wallet_accounts
    set held_iqd = held_iqd - v_amount,
        balance_iqd = balance_iqd - v_amount,
        updated_at = now()
  where user_id = r.rider_id;

  insert into public.wallet_entries (user_id, delta_iqd, kind, memo, source_type, source_id, metadata, idempotency_key)
  values (r.rider_id, -v_amount, 'ride_fare', 'Ride fare', 'ride', r.id,
          jsonb_build_object('ride_id', r.id, 'driver_id', r.driver_id),
          'ride:' || r.id::text || ':rider_debit')
  on conflict (idempotency_key) do nothing;

  -- Credit driver
  insert into public.wallet_accounts(user_id)
  values (r.driver_id)
  on conflict (user_id) do nothing;

  update public.wallet_accounts
    set balance_iqd = balance_iqd + v_amount,
        updated_at = now()
  where user_id = r.driver_id;

  insert into public.wallet_entries (user_id, delta_iqd, kind, memo, source_type, source_id, metadata, idempotency_key)
  values (r.driver_id, v_amount, 'ride_fare', 'Ride payout', 'ride', r.id,
          jsonb_build_object('ride_id', r.id, 'rider_id', r.rider_id),
          'ride:' || r.id::text || ':driver_credit')
  on conflict (idempotency_key) do nothing;

  -- Mark hold captured
  update public.wallet_holds
    set status = 'captured', captured_at = now(), updated_at = now()
  where id = h.id and status = 'active';

  -- Create a synthetic payment row for existing receipt automation.
  insert into public.payments (ride_id, provider, provider_ref, amount_iqd, currency, status)
  values (r.id, 'wallet', h.id::text, v_amount::integer, 'IQD', 'succeeded')
  on conflict (ride_id) where status = 'succeeded' do nothing;

  update public.rides
    set paid_at = coalesce(paid_at, now()),
        payment_intent_id = null
  where id = r.id;
end;
$$;

grant execute on function public.wallet_capture_ride_hold(uuid) to service_role;
revoke execute on function public.wallet_capture_ride_hold(uuid) from authenticated;

-- =====================================================================
-- MIGRATION: supabase/migrations/20260120001000_session17_wallet_integrity.sql
-- =====================================================================
-- Session 17: Admin wallet integrity snapshot + invariant checks.
--
-- This provides a single RPC call that the Admin UI can use to quickly diagnose
-- wallet/ride/top-up inconsistencies. It is SECURITY DEFINER so it can read all
-- rows even when RLS is enabled, but it is protected by public.is_admin().

create or replace function public.admin_wallet_integrity_snapshot(
  p_limit integer default 50,
  p_hold_age_seconds integer default 3600,
  p_topup_age_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_hold_age interval := make_interval(secs => greatest(60, least(coalesce(p_hold_age_seconds, 3600), 30 * 24 * 3600)));
  v_topup_age interval := make_interval(secs => greatest(30, least(coalesce(p_topup_age_seconds, 600), 7 * 24 * 3600)));
  v_now timestamptz := now();

  v_accounts_count bigint;
  v_balance_sum bigint;
  v_held_sum bigint;
  v_active_holds_sum bigint;

  v_active_holds_old jsonb;
  v_active_holds_terminal_ride jsonb;
  v_completed_rides_missing_entries jsonb;
  v_held_mismatch jsonb;
  v_topup_succeeded_missing_entry jsonb;
  v_topup_stuck_pending jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;

  select
    count(*)::bigint,
    coalesce(sum(balance_iqd), 0)::bigint,
    coalesce(sum(held_iqd), 0)::bigint
  into v_accounts_count, v_balance_sum, v_held_sum
  from public.wallet_accounts;

  select coalesce(sum(amount_iqd), 0)::bigint
  into v_active_holds_sum
  from public.wallet_holds
  where status = 'active';

  -- 1) Active holds that are older than a threshold
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_active_holds_old
  from (
    select
      h.id as hold_id,
      h.user_id,
      h.ride_id,
      h.amount_iqd,
      h.created_at,
      h.updated_at
    from public.wallet_holds h
    where h.status = 'active'
      and h.created_at < (v_now - v_hold_age)
    order by h.created_at asc
    limit v_limit
  ) t;

  -- 2) Active holds where the related ride is already terminal (should have been captured/released)
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_active_holds_terminal_ride
  from (
    select
      h.id as hold_id,
      h.user_id,
      h.ride_id,
      h.amount_iqd,
      h.created_at,
      r.status as ride_status,
      r.updated_at as ride_updated_at
    from public.wallet_holds h
    join public.rides r on r.id = h.ride_id
    where h.status = 'active'
      and r.status in ('completed','canceled')
    order by r.updated_at desc
    limit v_limit
  ) t;

  -- 3) Completed rides missing either the rider debit or driver credit entry
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_completed_rides_missing_entries
  from (
    select
      r.id as ride_id,
      r.rider_id,
      r.driver_id,
      r.status,
      r.completed_at,
      r.updated_at,
      not exists(
        select 1
        from public.wallet_entries we
        where we.user_id = r.rider_id
          and we.idempotency_key = ('ride:' || r.id::text || ':rider_debit')
      ) as missing_rider_debit,
      not exists(
        select 1
        from public.wallet_entries we
        where we.user_id = r.driver_id
          and we.idempotency_key = ('ride:' || r.id::text || ':driver_credit')
      ) as missing_driver_credit,
      (
        select h.id
        from public.wallet_holds h
        where h.ride_id = r.id
        order by h.created_at desc
        limit 1
      ) as hold_id
    from public.rides r
    where r.status = 'completed'
      and r.completed_at is not null
      and r.completed_at >= (v_now - interval '30 days')
      and (
        not exists(
          select 1
          from public.wallet_entries we
          where we.user_id = r.rider_id
            and we.idempotency_key = ('ride:' || r.id::text || ':rider_debit')
        )
        or not exists(
          select 1
          from public.wallet_entries we
          where we.user_id = r.driver_id
            and we.idempotency_key = ('ride:' || r.id::text || ':driver_credit')
        )
      )
    order by r.completed_at desc
    limit v_limit
  ) t;

  -- 4) held_iqd mismatch vs active holds sum per user (tolerate small drift by requiring exact match)
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_held_mismatch
  from (
    with holds as (
      select user_id, coalesce(sum(amount_iqd), 0)::bigint as holds_active
      from public.wallet_holds
      where status = 'active'
      group by user_id
    )
    select
      wa.user_id,
      wa.held_iqd,
      coalesce(h.holds_active, 0) as holds_active,
      (wa.held_iqd - coalesce(h.holds_active, 0)) as diff
    from public.wallet_accounts wa
    left join holds h on h.user_id = wa.user_id
    where wa.held_iqd <> coalesce(h.holds_active, 0)
    order by abs(wa.held_iqd - coalesce(h.holds_active, 0)) desc
    limit v_limit
  ) t;

  -- 5) Succeeded top-ups missing their wallet entry
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_topup_succeeded_missing_entry
  from (
    select
      ti.id as intent_id,
      ti.user_id,
      ti.provider_code,
      ti.provider_tx_id,
      ti.amount_iqd,
      ti.bonus_iqd,
      ti.completed_at,
      ti.updated_at
    from public.topup_intents ti
    where ti.status = 'succeeded'
      and not exists (
        select 1
        from public.wallet_entries we
        where we.user_id = ti.user_id
          and we.idempotency_key = ('topup:' || ti.id::text)
      )
    order by ti.updated_at desc
    limit v_limit
  ) t;

  -- 6) Top-ups stuck in created/pending beyond a threshold
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_topup_stuck_pending
  from (
    select
      ti.id as intent_id,
      ti.user_id,
      ti.provider_code,
      ti.status,
      ti.provider_tx_id,
      ti.created_at,
      ti.updated_at
    from public.topup_intents ti
    where ti.status in ('created','pending')
      and ti.created_at < (v_now - v_topup_age)
    order by ti.created_at asc
    limit v_limit
  ) t;

  return jsonb_build_object(
    'ok', true,
    'generated_at', v_now,
    'params', jsonb_build_object(
      'limit', v_limit,
      'hold_age_seconds', extract(epoch from v_hold_age)::int,
      'topup_age_seconds', extract(epoch from v_topup_age)::int
    ),
    'summary', jsonb_build_object(
      'accounts_count', v_accounts_count,
      'balance_iqd_sum', v_balance_sum,
      'held_iqd_sum', v_held_sum,
      'active_holds_iqd_sum', v_active_holds_sum,
      'held_minus_active_holds', (v_held_sum - v_active_holds_sum)
    ),
    'issues', jsonb_build_object(
      'active_holds_old', v_active_holds_old,
      'active_holds_terminal_ride', v_active_holds_terminal_ride,
      'completed_rides_missing_entries', v_completed_rides_missing_entries,
      'held_iqd_mismatch', v_held_mismatch,
      'topup_succeeded_missing_entry', v_topup_succeeded_missing_entry,
      'topup_stuck_pending', v_topup_stuck_pending
    )
  );
end;
$$;

revoke all on function public.admin_wallet_integrity_snapshot(integer, integer, integer) from public;
grant execute on function public.admin_wallet_integrity_snapshot(integer, integer, integer) to authenticated;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260120001100_session17_cron_schedules.sql
-- =====================================================================
-- Session 17: Optional database cron schedules for maintenance Edge Functions.
--
-- Supabase hosted Postgres supports pg_cron and pg_net, which can be combined
-- to invoke Edge Functions on a schedule. Supabase recommends storing tokens
-- securely in Vault (see docs linked in README).
--
-- This migration is *safe to apply* even when pg_cron / Vault are not available
-- (e.g., in local dev). If Vault secrets are missing, it will skip scheduling.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Helper: read a Vault secret by name if Vault is available.
-- Uses dynamic SQL so the function can exist even when the vault schema is not.
create or replace function public.try_get_vault_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
declare
  v text;
begin
  begin
    execute format('select decrypted_secret from vault.decrypted_secrets where name = %L limit 1', p_name)
      into v;
  exception when undefined_table or invalid_schema_name then
    return null;
  end;
  return v;
end;
$$;

revoke all on function public.try_get_vault_secret(text) from public;
grant execute on function public.try_get_vault_secret(text) to service_role;

do $$
declare
  v_project_url text;
  v_cron_secret text;
  v_jobid integer;
begin
  -- Expected Vault secrets:
  --  - project_url: e.g. https://<project-ref>.supabase.co
  --  - cron_secret: matches Edge Function CRON_SECRET
  v_project_url := public.try_get_vault_secret('project_url');
  v_cron_secret := public.try_get_vault_secret('cron_secret');

  if v_project_url is null or v_cron_secret is null then
    raise notice 'Skipping Edge Function scheduling (missing Vault secrets project_url/cron_secret).';
    return;
  end if;

  -- Best-effort idempotency: unschedule if a job with the same name exists.
  select j.jobid into v_jobid from cron.job j where j.jobname = 'rides-expire-every-2m' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  select j.jobid into v_jobid from cron.job j where j.jobname = 'topup-reconcile-every-5m' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'rides-expire-every-2m',
    '*/2 * * * *',
    format($fmt$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/expire-rides',
        headers := jsonb_build_object(
          'Content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := '{}'::jsonb
      ) as request_id;
    $fmt$)
  );

  -- NOTE: GitHub Actions scheduler minimum interval is usually 5 minutes.
  -- If you need <5m intervals, prefer pg_cron or Supabase Scheduled Functions.
  perform cron.schedule(
    'topup-reconcile-every-5m',
    '*/5 * * * *',
    format($fmt$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/topup-reconcile',
        headers := jsonb_build_object(
          'Content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := '{}'::jsonb
      ) as request_id;
    $fmt$)
  );
end
$$;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260121000100_session18_withdrawals.sql
-- =====================================================================
-- Session 18: Driver withdrawals (payout workflow)
--
-- Adds:
--  - wallet_withdraw_requests (driver payout requests)
--  - wallet_holds.kind + withdraw linkage
--  - admin payout workflow functions
--
-- Notes:
--  - Withdrawals are processed by admins; payout execution to QiCard/AsiaPay/ZainCash can be manual or automated later.
--  - Holds reserve funds until paid/rejected/cancelled.

-- 1) Types
DO $$ BEGIN
  CREATE TYPE public.withdraw_request_status AS ENUM ('requested','approved','rejected','paid','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.withdraw_payout_kind AS ENUM ('qicard','asiapay','zaincash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wallet_hold_kind AS ENUM ('ride','withdraw');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  BEGIN
    ALTER TYPE public.wallet_entry_kind ADD VALUE 'withdrawal';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END$$;

-- 2) Withdrawal requests table
CREATE TABLE IF NOT EXISTS public.wallet_withdraw_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_iqd bigint NOT NULL CHECK (amount_iqd > 0),
  payout_kind public.withdraw_payout_kind NOT NULL,
  destination jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.withdraw_request_status NOT NULL DEFAULT 'requested',
  note text,
  payout_reference text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  rejected_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_withdraw_requests_user_created
  ON public.wallet_withdraw_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_withdraw_requests_status_created
  ON public.wallet_withdraw_requests(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_withdraw_requests_idempotency
  ON public.wallet_withdraw_requests(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- updated_at trigger
DROP TRIGGER IF EXISTS wallet_withdraw_requests_set_updated_at ON public.wallet_withdraw_requests;
CREATE TRIGGER wallet_withdraw_requests_set_updated_at
BEFORE UPDATE ON public.wallet_withdraw_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Link holds to withdrawals and classify holds
ALTER TABLE public.wallet_holds
  ADD COLUMN IF NOT EXISTS kind public.wallet_hold_kind NOT NULL DEFAULT 'ride',
  ADD COLUMN IF NOT EXISTS withdraw_request_id uuid REFERENCES public.wallet_withdraw_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_wallet_holds_withdraw_request
  ON public.wallet_holds(withdraw_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_holds_active_per_withdraw
  ON public.wallet_holds(withdraw_request_id)
  WHERE withdraw_request_id IS NOT NULL AND status = 'active';

-- 4) RLS
ALTER TABLE public.wallet_withdraw_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdraw_select_own_or_admin" ON public.wallet_withdraw_requests;
CREATE POLICY "withdraw_select_own_or_admin"
  ON public.wallet_withdraw_requests
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "withdraw_insert_own" ON public.wallet_withdraw_requests;
CREATE POLICY "withdraw_insert_own"
  ON public.wallet_withdraw_requests
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "withdraw_update_admin_or_cancel_own" ON public.wallet_withdraw_requests;
CREATE POLICY "withdraw_update_admin_or_cancel_own"
  ON public.wallet_withdraw_requests
  FOR UPDATE
  USING (
    public.is_admin()
    OR (user_id = auth.uid() AND status = 'requested')
  )
  WITH CHECK (
    public.is_admin()
    OR (user_id = auth.uid() AND status IN ('requested','cancelled'))
  );

-- 5) RPC: Driver creates a withdrawal request (creates a hold)

REVOKE ALL ON FUNCTION public.wallet_request_withdraw(bigint, public.withdraw_payout_kind, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_request_withdraw(bigint, public.withdraw_payout_kind, jsonb, text) TO authenticated;

-- 6) RPC: Driver cancels a withdrawal request (releases hold)

REVOKE ALL ON FUNCTION public.wallet_cancel_withdraw(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_cancel_withdraw(uuid) TO authenticated;

-- 7) Admin workflow: approve / reject / mark paid

REVOKE ALL ON FUNCTION public.admin_withdraw_approve(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_approve(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_withdraw_reject(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_reject(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_withdraw_mark_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_mark_paid(uuid, text) TO authenticated;
-- =====================================================================
-- MIGRATION: supabase/migrations/20260121000200_session19_withdrawal_controls.sql
-- =====================================================================
-- Session 19: Withdrawal limits, destination validation, notifications, payout method toggles
--
-- Adds:
--  - profile_kyc (admin-managed KYC status used by compliance rules)
--  - wallet_withdrawal_policy (min/max + daily caps + eligibility rules)
--  - wallet_withdraw_payout_methods (enable/disable payout kinds)
--  - user_notifications (in-app notifications)
--  - stronger validation + caps enforcement in withdrawal RPCs
--  - notifications on approval/rejection/paid/cancel
--  - Realtime publication entries for withdrawals + notifications

-- 1) KYC
DO $$ BEGIN
  CREATE TYPE public.kyc_status AS ENUM ('unverified','pending','verified','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.profile_kyc (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.kyc_status NOT NULL DEFAULT 'unverified',
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS profile_kyc_set_updated_at ON public.profile_kyc;
CREATE TRIGGER profile_kyc_set_updated_at
BEFORE UPDATE ON public.profile_kyc
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profile_kyc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_kyc_select_own_or_admin" ON public.profile_kyc;
CREATE POLICY "profile_kyc_select_own_or_admin"
  ON public.profile_kyc
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profile_kyc_admin_write" ON public.profile_kyc;
CREATE POLICY "profile_kyc_admin_write"
  ON public.profile_kyc
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Ensure every profile gets a KYC row.
CREATE OR REPLACE FUNCTION public.profile_kyc_init()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $$
BEGIN
  INSERT INTO public.profile_kyc (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profile_kyc_init() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_kyc_init() TO authenticated;

DROP TRIGGER IF EXISTS profiles_after_insert_profile_kyc ON public.profiles;
CREATE TRIGGER profiles_after_insert_profile_kyc
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profile_kyc_init();

-- Backfill existing profiles.
INSERT INTO public.profile_kyc (user_id)
SELECT p.id
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

-- 2) Withdrawal policy + payout toggles
CREATE TABLE IF NOT EXISTS public.wallet_withdrawal_policy (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_amount_iqd bigint NOT NULL DEFAULT 5000,
  max_amount_iqd bigint NOT NULL DEFAULT 2000000,
  daily_cap_amount_iqd bigint NOT NULL DEFAULT 5000000,
  daily_cap_count integer NOT NULL DEFAULT 5,
  require_kyc boolean NOT NULL DEFAULT false,
  require_driver_not_suspended boolean NOT NULL DEFAULT true,
  min_trips_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS wallet_withdrawal_policy_set_updated_at ON public.wallet_withdrawal_policy;
CREATE TRIGGER wallet_withdrawal_policy_set_updated_at
BEFORE UPDATE ON public.wallet_withdrawal_policy
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.wallet_withdrawal_policy (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.wallet_withdrawal_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdraw_policy_select" ON public.wallet_withdrawal_policy;
CREATE POLICY "withdraw_policy_select"
  ON public.wallet_withdrawal_policy
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "withdraw_policy_admin_update" ON public.wallet_withdrawal_policy;
CREATE POLICY "withdraw_policy_admin_update"
  ON public.wallet_withdrawal_policy
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.wallet_withdraw_payout_methods (
  payout_kind public.withdraw_payout_kind PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS wallet_withdraw_payout_methods_set_updated_at ON public.wallet_withdraw_payout_methods;
CREATE TRIGGER wallet_withdraw_payout_methods_set_updated_at
BEFORE UPDATE ON public.wallet_withdraw_payout_methods
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.wallet_withdraw_payout_methods (payout_kind, enabled)
VALUES
  ('qicard', true),
  ('asiapay', true),
  ('zaincash', true)
ON CONFLICT (payout_kind) DO NOTHING;

ALTER TABLE public.wallet_withdraw_payout_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdraw_payout_methods_select" ON public.wallet_withdraw_payout_methods;
CREATE POLICY "withdraw_payout_methods_select"
  ON public.wallet_withdraw_payout_methods
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "withdraw_payout_methods_admin_update" ON public.wallet_withdraw_payout_methods;
CREATE POLICY "withdraw_payout_methods_admin_update"
  ON public.wallet_withdraw_payout_methods
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3) Notifications
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_user_notifications_user_created
  ON public.user_notifications(user_id, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_notifications_select_own_or_admin" ON public.user_notifications;
CREATE POLICY "user_notifications_select_own_or_admin"
  ON public.user_notifications
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "user_notifications_update_own" ON public.user_notifications;
CREATE POLICY "user_notifications_update_own"
  ON public.user_notifications
  FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- No direct inserts from clients; use notify_user()

CREATE OR REPLACE FUNCTION public.notify_user(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, extensions'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.user_notifications (user_id, kind, title, body, data)
  VALUES (p_user_id, p_kind, p_title, p_body, COALESCE(p_data, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_notifications_mark_read(
  p_notification_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.user_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND user_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.user_notifications_mark_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_notifications_mark_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_notifications_mark_all_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.user_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE user_id = v_uid AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.user_notifications_mark_all_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_notifications_mark_all_read() TO authenticated;

-- 4) Validation helpers
CREATE OR REPLACE FUNCTION public.wallet_validate_withdraw_destination(
  p_payout_kind public.withdraw_payout_kind,
  p_destination jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $$
DECLARE
  v_wallet text;
  v_card text;
  v_account text;
BEGIN
  IF p_payout_kind = 'zaincash' THEN
    v_wallet := trim(coalesce(p_destination->>'wallet_number', ''));
    IF v_wallet = '' THEN
      RAISE EXCEPTION 'missing_destination_wallet_number';
    END IF;
    -- Iraq mobile format: allow 07XXXXXXXXX, 7XXXXXXXXX, 9647XXXXXXXXX, +9647XXXXXXXXX
    IF v_wallet !~ '^(\+?964)?0?7\d{9}$' THEN
      RAISE EXCEPTION 'invalid_wallet_number_format';
    END IF;
  ELSIF p_payout_kind = 'qicard' THEN
    v_card := regexp_replace(trim(coalesce(p_destination->>'card_number', '')), '\s+', '', 'g');
    IF v_card = '' THEN
      RAISE EXCEPTION 'missing_destination_card_number';
    END IF;
    -- QiCard numbers vary by issuer; enforce digits-only with a safe length range.
    IF v_card !~ '^\d{12,19}$' THEN
      RAISE EXCEPTION 'invalid_card_number_format';
    END IF;
  ELSIF p_payout_kind = 'asiapay' THEN
    v_account := trim(coalesce(p_destination->>'account', coalesce(p_destination->>'wallet_number', '')));
    IF v_account = '' THEN
      RAISE EXCEPTION 'missing_destination_account';
    END IF;
    IF length(v_account) < 3 OR length(v_account) > 64 THEN
      RAISE EXCEPTION 'invalid_account_format';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_payout_kind';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_validate_withdraw_destination(public.withdraw_payout_kind, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_validate_withdraw_destination(public.withdraw_payout_kind, jsonb) TO authenticated;

-- 5) Update withdrawal RPCs: enforce policy + toggles + notify

CREATE OR REPLACE FUNCTION public.wallet_request_withdraw(
  p_amount_iqd bigint,
  p_payout_kind public.withdraw_payout_kind,
  p_destination jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, extensions'
AS $$
DECLARE
  v_uid uuid;
  v_req_id uuid;
  v_available bigint;
  v_policy record;
  v_today date;
  v_day_sum bigint;
  v_day_count integer;
  v_driver record;
  v_kyc public.kyc_status;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- payout method enabled?
  IF NOT EXISTS (
    SELECT 1 FROM public.wallet_withdraw_payout_methods m
    WHERE m.payout_kind = p_payout_kind AND m.enabled = true
  ) THEN
    RAISE EXCEPTION 'payout_method_disabled';
  END IF;

  -- policy (single row)
  SELECT * INTO v_policy FROM public.wallet_withdrawal_policy WHERE id = 1;

  IF p_amount_iqd IS NULL OR p_amount_iqd <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  IF p_amount_iqd < v_policy.min_amount_iqd THEN
    RAISE EXCEPTION 'below_min_withdrawal';
  END IF;
  IF p_amount_iqd > v_policy.max_amount_iqd THEN
    RAISE EXCEPTION 'above_max_withdrawal';
  END IF;

  -- only drivers can withdraw + eligibility rules
  SELECT d.status, d.trips_count INTO v_driver
  FROM public.drivers d
  WHERE d.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_driver';
  END IF;

  IF v_policy.require_driver_not_suspended AND v_driver.status = 'suspended' THEN
    RAISE EXCEPTION 'driver_suspended';
  END IF;

  IF v_driver.trips_count < v_policy.min_trips_count THEN
    RAISE EXCEPTION 'driver_not_eligible_trips';
  END IF;

  IF v_policy.require_kyc THEN
    SELECT pk.status INTO v_kyc
    FROM public.profile_kyc pk
    WHERE pk.user_id = v_uid;
    IF coalesce(v_kyc, 'unverified') <> 'verified' THEN
      RAISE EXCEPTION 'kyc_required';
    END IF;
  END IF;

  -- destination validation
  PERFORM public.wallet_validate_withdraw_destination(p_payout_kind, COALESCE(p_destination, '{}'::jsonb));

  -- daily caps (based on Asia/Baghdad day boundary)
  v_today := (timezone('Asia/Baghdad', now()))::date;
  SELECT
    COALESCE(sum(w.amount_iqd), 0)::bigint,
    COALESCE(count(*), 0)::int
  INTO v_day_sum, v_day_count
  FROM public.wallet_withdraw_requests w
  WHERE w.user_id = v_uid
    AND w.status NOT IN ('rejected','cancelled')
    AND (timezone('Asia/Baghdad', w.created_at))::date = v_today;

  IF (v_day_count + 1) > v_policy.daily_cap_count THEN
    RAISE EXCEPTION 'daily_withdraw_count_cap';
  END IF;
  IF (v_day_sum + p_amount_iqd) > v_policy.daily_cap_amount_iqd THEN
    RAISE EXCEPTION 'daily_withdraw_amount_cap';
  END IF;

  -- lock wallet account row
  PERFORM 1 FROM public.wallet_accounts wa WHERE wa.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallet_accounts (user_id, balance_iqd, held_iqd)
    VALUES (v_uid, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  SELECT (wa.balance_iqd - wa.held_iqd) INTO v_available
  FROM public.wallet_accounts wa
  WHERE wa.user_id = v_uid
  FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'wallet_account_missing';
  END IF;

  IF v_available < p_amount_iqd THEN
    RAISE EXCEPTION 'insufficient_wallet_balance';
  END IF;

  -- idempotency
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_req_id
    FROM public.wallet_withdraw_requests
    WHERE user_id = v_uid AND idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_req_id IS NOT NULL THEN
      RETURN v_req_id;
    END IF;
  END IF;

  INSERT INTO public.wallet_withdraw_requests (user_id, amount_iqd, payout_kind, destination, idempotency_key)
  VALUES (v_uid, p_amount_iqd, p_payout_kind, COALESCE(p_destination, '{}'::jsonb), p_idempotency_key)
  RETURNING id INTO v_req_id;

  -- create hold
  INSERT INTO public.wallet_holds (user_id, kind, withdraw_request_id, amount_iqd, status, reason, created_at, updated_at)
  VALUES (v_uid, 'withdraw', v_req_id, p_amount_iqd, 'active', 'Withdraw request', now(), now());

  UPDATE public.wallet_accounts
  SET held_iqd = held_iqd + p_amount_iqd,
      updated_at = now()
  WHERE user_id = v_uid;

  RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_request_withdraw(bigint, public.withdraw_payout_kind, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_request_withdraw(bigint, public.withdraw_payout_kind, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wallet_cancel_withdraw(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, extensions'
AS $$
DECLARE
  v_uid uuid;
  r record;
  h record;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found';
  END IF;

  IF r.user_id <> v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF r.status <> 'requested' THEN
    RAISE EXCEPTION 'withdraw_not_cancellable';
  END IF;

  SELECT * INTO h
  FROM public.wallet_holds
  WHERE withdraw_request_id = r.id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  UPDATE public.wallet_holds
  SET status = 'released', released_at = now(), updated_at = now()
  WHERE id = h.id AND status = 'active';

  UPDATE public.wallet_accounts
  SET held_iqd = GREATEST(held_iqd - r.amount_iqd, 0),
      updated_at = now()
  WHERE user_id = v_uid;

  UPDATE public.wallet_withdraw_requests
  SET status = 'cancelled', cancelled_at = now(), updated_at = now()
  WHERE id = r.id;

  PERFORM public.notify_user(v_uid, 'withdraw_cancelled', 'Withdrawal cancelled',
    'Your withdrawal request was cancelled and funds were released.',
    jsonb_build_object('request_id', r.id, 'amount_iqd', r.amount_iqd, 'payout_kind', r.payout_kind)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_cancel_withdraw(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_cancel_withdraw(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_withdraw_approve(
  p_request_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, extensions'
AS $$
DECLARE
  r record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found';
  END IF;

  IF r.status <> 'requested' THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  UPDATE public.wallet_withdraw_requests
  SET status = 'approved',
      note = COALESCE(p_note, note),
      approved_at = now(),
      updated_at = now()
  WHERE id = r.id;

  PERFORM public.notify_user(r.user_id, 'withdraw_approved', 'Withdrawal approved',
    'Your withdrawal request was approved and will be paid soon.',
    jsonb_build_object('request_id', r.id, 'amount_iqd', r.amount_iqd, 'payout_kind', r.payout_kind)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_withdraw_approve(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_approve(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_withdraw_reject(
  p_request_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, extensions'
AS $$
DECLARE
  r record;
  h record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found';
  END IF;

  IF r.status NOT IN ('requested','approved') THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  SELECT * INTO h
  FROM public.wallet_holds
  WHERE withdraw_request_id = r.id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  UPDATE public.wallet_holds
  SET status = 'released', released_at = now(), updated_at = now()
  WHERE id = h.id AND status = 'active';

  UPDATE public.wallet_accounts
  SET held_iqd = GREATEST(held_iqd - r.amount_iqd, 0),
      updated_at = now()
  WHERE user_id = r.user_id;

  UPDATE public.wallet_withdraw_requests
  SET status = 'rejected',
      note = COALESCE(p_note, note),
      rejected_at = now(),
      updated_at = now()
  WHERE id = r.id;

  PERFORM public.notify_user(r.user_id, 'withdraw_rejected', 'Withdrawal rejected',
    COALESCE(p_note, 'Your withdrawal request was rejected and funds were released.'),
    jsonb_build_object('request_id', r.id, 'amount_iqd', r.amount_iqd, 'payout_kind', r.payout_kind)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_withdraw_reject(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_reject(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_withdraw_mark_paid(
  p_request_id uuid,
  p_payout_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, extensions'
AS $$
DECLARE
  r record;
  h record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO r
  FROM public.wallet_withdraw_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_request_not_found';
  END IF;

  IF r.status <> 'approved' THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  -- lock active hold
  SELECT * INTO h
  FROM public.wallet_holds
  WHERE withdraw_request_id = r.id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- lock wallet account
  PERFORM 1 FROM public.wallet_accounts wa WHERE wa.user_id = r.user_id FOR UPDATE;

  UPDATE public.wallet_accounts
  SET held_iqd = GREATEST(held_iqd - r.amount_iqd, 0),
      balance_iqd = balance_iqd - r.amount_iqd,
      updated_at = now()
  WHERE user_id = r.user_id;

  -- ledger entry
  INSERT INTO public.wallet_entries (user_id, delta_iqd, kind, memo, source_type, source_id, metadata, idempotency_key)
  VALUES (
    r.user_id,
    -r.amount_iqd,
    'withdrawal',
    'Driver withdrawal',
    'withdraw',
    r.id,
    jsonb_build_object(
      'payout_kind', r.payout_kind,
      'destination', r.destination,
      'payout_reference', p_payout_reference
    ),
    'withdraw:' || r.id::text
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE public.wallet_holds
  SET status = 'captured', captured_at = now(), updated_at = now()
  WHERE id = h.id AND status = 'active';

  UPDATE public.wallet_withdraw_requests
  SET status = 'paid',
      payout_reference = COALESCE(p_payout_reference, payout_reference),
      paid_at = now(),
      updated_at = now()
  WHERE id = r.id;

  PERFORM public.notify_user(r.user_id, 'withdraw_paid', 'Withdrawal paid',
    CASE WHEN p_payout_reference IS NULL OR p_payout_reference = '' THEN 'Your withdrawal has been paid.'
      ELSE 'Your withdrawal has been paid. Reference: ' || p_payout_reference END,
    jsonb_build_object('request_id', r.id, 'amount_iqd', r.amount_iqd, 'payout_kind', r.payout_kind, 'payout_reference', p_payout_reference)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_withdraw_mark_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_withdraw_mark_paid(uuid, text) TO authenticated;

-- 5b) Indexes for withdrawals (idempotency + common queries)
CREATE INDEX IF NOT EXISTS ix_wallet_withdraw_requests_user_created
  ON public.wallet_withdraw_requests(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_withdraw_requests_user_idempotency
  ON public.wallet_withdraw_requests(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_wallet_withdraw_requests_status_created
  ON public.wallet_withdraw_requests(status, created_at DESC);

-- 6) Realtime publication (withdrawals + notifications)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wallet_withdraw_requests'
  ) THEN
    EXECUTE 'alter publication supabase_realtime add table public.wallet_withdraw_requests';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications'
  ) THEN
    EXECUTE 'alter publication supabase_realtime add table public.user_notifications';
  END IF;
END
$$;

-- =====================================================================
-- MIGRATION: supabase/migrations/20260121010000_session20_admin_record_refund.sql
-- =====================================================================
-- Session 20: Admin "record refund" RPC (manual refunds)
--
-- This does NOT call any payment-provider API. It records a refund against the latest succeeded payment
-- and relies on the existing "update_receipt_on_refund" trigger to update ride_receipts.*

create or replace function public.admin_record_ride_refund(
  p_ride_id uuid,
  p_refund_amount_iqd integer default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog, public'
as $$
declare
  v_receipt public.ride_receipts%rowtype;
  v_payment public.payments%rowtype;
  v_total integer;
  v_prev_refunded integer;
  v_add integer;
  v_new_total integer;
  v_ref_id text;
begin
  -- authz
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  -- lock receipt
  select * into v_receipt
  from public.ride_receipts
  where ride_id = p_ride_id
  for update;

  if not found then
    raise exception 'receipt_not_found' using errcode = 'P0002';
  end if;

  v_total := coalesce(v_receipt.total_iqd, 0);
  v_prev_refunded := coalesce(v_receipt.refunded_iqd, 0);

  if p_refund_amount_iqd is null then
    v_add := greatest(v_total - v_prev_refunded, 0);
  else
    v_add := greatest(least(p_refund_amount_iqd, v_total - v_prev_refunded), 0);
  end if;

  if v_add <= 0 then
    return jsonb_build_object(
      'ride_id', p_ride_id,
      'refunded_iqd', v_prev_refunded,
      'added_iqd', 0,
      'status', 'no_op',
      'reason', p_reason
    );
  end if;

  v_new_total := v_prev_refunded + v_add;

  -- lock latest succeeded payment
  select * into v_payment
  from public.payments
  where ride_id = p_ride_id and status = 'succeeded'
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;

  v_ref_id := coalesce(v_payment.provider_refund_id, 'manual_refund:' || gen_random_uuid()::text);

  update public.payments
  set provider_refund_id = v_ref_id,
      refunded_at = now(),
      refund_amount_iqd = v_new_total,
      updated_at = now()
  where id = v_payment.id;

  return jsonb_build_object(
    'ride_id', p_ride_id,
    'payment_id', v_payment.id,
    'provider_refund_id', v_ref_id,
    'added_iqd', v_add,
    'refunded_iqd', v_new_total,
    'reason', p_reason
  );
end;
$$;

revoke all on function public.admin_record_ride_refund(uuid, integer, text) from public;
grant execute on function public.admin_record_ride_refund(uuid, integer, text) to authenticated;
grant execute on function public.admin_record_ride_refund(uuid, integer, text) to service_role;

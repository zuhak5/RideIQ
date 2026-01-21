begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Users
insert into auth.users (id, email) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'rider@test.com'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'driver@test.com');

-- Driver profile
insert into public.drivers (id, status, vehicle_type)
values ('bbbbbbbb-2222-2222-2222-222222222222', 'reserved', 'sedan');

-- Seed rider wallet balance
insert into public.wallet_accounts (user_id, balance_iqd, held_iqd)
values ('aaaaaaaa-1111-1111-1111-111111111111', 5000, 0)
on conflict (user_id) do update set balance_iqd = excluded.balance_iqd, held_iqd = excluded.held_iqd;

-- Matched request
insert into public.ride_requests (
  id, rider_id,
  pickup_lat, pickup_lng,
  dropoff_lat, dropoff_lng,
  pickup_loc, dropoff_loc,
  status, assigned_driver_id,
  quote_amount_iqd, currency,
  match_deadline
) values (
  'rrrrrrrr-0000-0000-0000-000000000001',
  'aaaaaaaa-1111-1111-1111-111111111111',
  33.3152, 44.3661,
  33.3000, 44.4000,
  st_setsrid(st_makepoint(44.3661, 33.3152), 4326)::geography,
  st_setsrid(st_makepoint(44.4000, 33.3000), 4326)::geography,
  'matched',
  'bbbbbbbb-2222-2222-2222-222222222222',
  1200,
  'IQD',
  now() + interval '5 minutes'
);

-- Accept ride as server (security definer RPC); should create ride + hold
reset role;
select ok(
  (select (public.dispatch_accept_ride('rrrrrrrr-0000-0000-0000-000000000001', 'bbbbbbbb-2222-2222-2222-222222222222')).id is not null),
  'dispatch_accept_ride creates ride'
);

select results_eq(
  $$ select status from public.ride_requests where id = 'rrrrrrrr-0000-0000-0000-000000000001' $$,
  array['accepted'::public.ride_request_status],
  'Request moves to accepted'
);

select results_eq(
  $$ select status from public.drivers where id = 'bbbbbbbb-2222-2222-2222-222222222222' $$,
  array['on_trip'::public.driver_status],
  'Driver becomes on_trip'
);

select results_eq(
  $$ select held_iqd from public.wallet_accounts where user_id = 'aaaaaaaa-1111-1111-1111-111111111111' $$,
  array[1200::bigint],
  'Rider held_iqd reflects hold'
);

select results_eq(
  $$ select count(*) from public.wallet_holds where ride_id = (select id from public.rides where request_id='rrrrrrrr-0000-0000-0000-000000000001') and status='active' $$,
  array[1::bigint],
  'Active hold exists for the ride'
);

-- Transition ride to completion (arrived -> in_progress -> completed)
select ok(
  (select public.transition_ride_v2((select id from public.rides where request_id='rrrrrrrr-0000-0000-0000-000000000001'), 'arrived', '00000000-0000-0000-0000-000000000000', 'system', 0) is not null),
  'Transition to arrived'
);

select ok(
  (select public.transition_ride_v2((select id from public.rides where request_id='rrrrrrrr-0000-0000-0000-000000000001'), 'in_progress', '00000000-0000-0000-0000-000000000000', 'system', 1) is not null),
  'Transition to in_progress'
);

select ok(
  (select public.transition_ride_v2((select id from public.rides where request_id='rrrrrrrr-0000-0000-0000-000000000001'), 'completed', '00000000-0000-0000-0000-000000000000', 'system', 2) is not null),
  'Transition to completed'
);

-- Wallet settlement
select results_eq(
  $$ select balance_iqd, held_iqd from public.wallet_accounts where user_id='aaaaaaaa-1111-1111-1111-111111111111' $$,
  array[3800::bigint, 0::bigint],
  'Rider balance debited, hold released'
);

select results_eq(
  $$ select balance_iqd from public.wallet_accounts where user_id='bbbbbbbb-2222-2222-2222-222222222222' $$,
  array[1200::bigint],
  'Driver credited'
);

select results_eq(
  $$ select status from public.wallet_holds where ride_id=(select id from public.rides where request_id='rrrrrrrr-0000-0000-0000-000000000001') $$,
  array['captured'::public.wallet_hold_status],
  'Hold captured'
);

select results_eq(
  $$ select count(*) from public.wallet_entries where source_type='ride' and source_id=(select id from public.rides where request_id='rrrrrrrr-0000-0000-0000-000000000001') $$,
  array[2::bigint],
  'Two ledger entries (debit + credit)'
);

select results_eq(
  $$ select count(*) from public.payments where ride_id=(select id from public.rides where request_id='rrrrrrrr-0000-0000-0000-000000000001') and provider='wallet' and status='succeeded' $$,
  array[1::bigint],
  'Synthetic wallet payment row exists'
);

-- Idempotent capture (should not double charge)
select ok(
  (select (public.wallet_capture_ride_hold((select id from public.rides where request_id='rrrrrrrr-0000-0000-0000-000000000001'))) is null),
  'Second capture is idempotent'
);

select results_eq(
  $$ select balance_iqd from public.wallet_accounts where user_id='aaaaaaaa-1111-1111-1111-111111111111' $$,
  array[3800::bigint],
  'Rider balance unchanged after second capture'
);

-- Matching should fail when rider cannot afford
insert into auth.users (id, email) values
  ('cccccccc-3333-3333-3333-333333333333', 'poor@test.com');

insert into public.wallet_accounts (user_id, balance_iqd, held_iqd)
values ('cccccccc-3333-3333-3333-333333333333', 100, 0)
on conflict (user_id) do update set balance_iqd=excluded.balance_iqd, held_iqd=excluded.held_iqd;

insert into public.ride_requests (
  id, rider_id,
  pickup_lat, pickup_lng,
  dropoff_lat, dropoff_lng,
  pickup_loc, dropoff_loc,
  status,
  quote_amount_iqd, currency
) values (
  'rrrrrrrr-0000-0000-0000-000000000002',
  'cccccccc-3333-3333-3333-333333333333',
  33.3152, 44.3661,
  33.3000, 44.4000,
  st_setsrid(st_makepoint(44.3661, 33.3152), 4326)::geography,
  st_setsrid(st_makepoint(44.4000, 33.3000), 4326)::geography,
  'requested',
  5000,
  'IQD'
);

select throws_ok(
  $$ select * from public.dispatch_match_ride('rrrrrrrr-0000-0000-0000-000000000002','cccccccc-3333-3333-3333-333333333333',5000,5,60,30) $$,
  'insufficient_wallet_balance',
  'Match is blocked by insufficient wallet balance'
);

select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444', 'rider@test.com'),
  ('55555555-5555-5555-5555-555555555555', 'driver@test.com'),
  ('66666666-6666-6666-6666-666666666666', 'other@test.com');

insert into public.drivers (id, status, vehicle_type)
values ('55555555-5555-5555-5555-555555555555', 'available', 'sedan');

insert into public.ride_requests (
  id, rider_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, assigned_driver_id
) values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '44444444-4444-4444-4444-444444444444',
  33.3152, 44.3661,
  33.3000, 44.4000,
  'accepted',
  '55555555-5555-5555-5555-555555555555'
);

insert into public.rides (
  id, request_id, rider_id, driver_id, status, completed_at, fare_amount_iqd, currency
) values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  'completed',
  now(),
  1000,
  'IQD'
);

-- Rider submits a rating (idempotent)
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

create temp table tmp_ids(val uuid);
insert into tmp_ids(val) select public.submit_ride_rating('dddddddd-dddd-dddd-dddd-dddddddddddd', 4, 'ok');
insert into tmp_ids(val) select public.submit_ride_rating('dddddddd-dddd-dddd-dddd-dddddddddddd', 4, 'ok again');

select results_eq(
  'select count(distinct val) from tmp_ids',
  array[1::bigint],
  'submit_ride_rating is idempotent per (ride_id,rater_id)'
);

select results_eq(
  $$ select count(*) from public.ride_ratings where ride_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  array[1::bigint],
  'Only one rating row exists'
);

select results_eq(
  $$ select rating_count from public.drivers where id = '55555555-5555-5555-5555-555555555555' $$,
  array[1::int],
  'Driver rating_count incremented once'
);

select results_eq(
  $$ select rating_avg from public.drivers where id = '55555555-5555-5555-5555-555555555555' $$,
  array[4.00::numeric],
  'Driver rating_avg updated'
);

-- Non participant cannot rate
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select throws_ok(
  $$ select public.submit_ride_rating('dddddddd-dddd-dddd-dddd-dddddddddddd', 5, 'hack') $$,
  'not_allowed',
  'Non participant cannot rate'
);

-- Driver can rate rider too
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select ok(
  (select public.submit_ride_rating('dddddddd-dddd-dddd-dddd-dddddddddddd', 5, 'great') is not null),
  'Driver can submit rating'
);

select * from finish();
rollback;

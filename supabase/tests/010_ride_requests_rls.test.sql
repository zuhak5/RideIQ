begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

-- Setup test users (triggers create profiles)
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'rider1@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'rider2@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'driver1@test.com');

-- Driver profile
insert into public.drivers (id, status, vehicle_type)
values ('33333333-3333-3333-3333-333333333333', 'available', 'sedan');

-- A ride request owned by rider1 and assigned to driver1
insert into public.ride_requests (
  id, rider_id,
  pickup_lat, pickup_lng,
  dropoff_lat, dropoff_lng,
  status, assigned_driver_id
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  33.3152, 44.3661,
  33.3000, 44.4000,
  'matched',
  '33333333-3333-3333-3333-333333333333'
);

-- Another request for rider1 that is *unassigned* (driver should NOT see)
insert into public.ride_requests (
  id, rider_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, assigned_driver_id
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '11111111-1111-1111-1111-111111111111',
  33.3152, 44.3661,
  33.3000, 44.4000,
  'requested',
  null
);

-- As rider1
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  'select count(*) from public.ride_requests',
  array[2::bigint],
  'Rider1 can see their own ride requests (assigned + unassigned)'
);

-- As rider2
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select results_eq(
  'select count(*) from public.ride_requests',
  array[0::bigint],
  'Rider2 cannot see Rider1 requests'
);

select results_eq(
  $$ update public.ride_requests
     set status = 'cancelled'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     returning 1 $$,
  array[]::integer[],
  'Rider2 cannot cancel Rider1 request (0 rows affected)'
);

-- Back to rider1: status unchanged
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select results_eq(
  $$ select status from public.ride_requests where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  array['matched'::public.ride_request_status],
  'Request remains matched'
);

-- As assigned driver1
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select results_eq(
  'select count(*) from public.ride_requests',
  array[1::bigint],
  'Assigned driver can see assigned request'
);
select results_eq(
  'select count(*) from public.ride_requests',
  array[1::bigint],
  'Driver still only sees assigned request (not unassigned demand)'
);

select * from finish();
rollback;

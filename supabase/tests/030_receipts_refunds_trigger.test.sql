begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'rider@test.com'),
  ('88888888-8888-8888-8888-888888888888', 'driver@test.com');

insert into public.drivers (id, status, vehicle_type)
values ('88888888-8888-8888-8888-888888888888', 'available', 'sedan');

insert into public.ride_requests (
  id, rider_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, assigned_driver_id
) values (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '77777777-7777-7777-7777-777777777777',
  33.3152, 44.3661,
  33.3000, 44.4000,
  'accepted',
  '88888888-8888-8888-8888-888888888888'
);

insert into public.rides (
  id, request_id, rider_id, driver_id, status, completed_at, fare_amount_iqd, currency
) values (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '77777777-7777-7777-7777-777777777777',
  '88888888-8888-8888-8888-888888888888',
  'completed',
  now(),
  1200,
  'IQD'
);

-- Insert succeeded payment -> receipt should be generated
insert into public.payments (id, ride_id, provider, status, amount_iqd, currency)
values (
  '99999999-9999-9999-9999-999999999999',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'wallet',
  'succeeded',
  1200,
  'IQD'
);

set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';

select results_eq(
  $$ select total_iqd from public.ride_receipts where ride_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' $$,
  array[1200::int],
  'Receipt generated with correct total'
);

-- Apply refunds as postgres (no update policy for authenticated on payments)
reset role;

update public.payments
set provider_refund_id = 're_1', refunded_at = now(), refund_amount_iqd = 500
where id = '99999999-9999-9999-9999-999999999999';

set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';

select results_eq(
  $$ select refunded_iqd from public.ride_receipts where ride_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' $$,
  array[500::int],
  'Receipt refunded_iqd updated'
);

select results_eq(
  $$ select receipt_status from public.ride_receipts where ride_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' $$,
  array['partially_refunded'::text],
  'Receipt status shows partial refund'
);

-- Full refund updates status (apply as postgres)
reset role;

update public.payments
set refund_amount_iqd = 1200
where id = '99999999-9999-9999-9999-999999999999';

set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';

select results_eq(
  $$ select receipt_status from public.ride_receipts where ride_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' $$,
  array['refunded'::text],
  'Receipt status shows full refund'
);

-- RLS: rider can read their receipt row
select results_eq(
  $$ select count(*) from public.ride_receipts $$,
  array[1::bigint],
  'Rider can read receipt via participant policy'
);

select * from finish();
rollback;

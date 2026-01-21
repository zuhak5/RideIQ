begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email) values
  ('aaaaaaaa-bbbb-cccc-dddd-000000000001', 'rider@test.com'),
  ('aaaaaaaa-bbbb-cccc-dddd-000000000002', 'driver@test.com'),
  ('aaaaaaaa-bbbb-cccc-dddd-000000000003', 'admin@test.com');

insert into public.drivers (id, status, vehicle_type)
values ('aaaaaaaa-bbbb-cccc-dddd-000000000002', 'available', 'sedan');

-- mark admin
update public.profiles set is_admin = true where id = 'aaaaaaaa-bbbb-cccc-dddd-000000000003';

insert into public.ride_requests (
  id, rider_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, assigned_driver_id
) values (
  'aaaaaaaa-bbbb-cccc-dddd-000000000010',
  'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  33.3152, 44.3661,
  33.3000, 44.4000,
  'accepted',
  'aaaaaaaa-bbbb-cccc-dddd-000000000002'
);

insert into public.rides (
  id, request_id, rider_id, driver_id, status, completed_at
) values (
  'aaaaaaaa-bbbb-cccc-dddd-000000000020',
  'aaaaaaaa-bbbb-cccc-dddd-000000000010',
  'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  'aaaaaaaa-bbbb-cccc-dddd-000000000002',
  'completed',
  now()
);

-- Rider creates incident
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';

create temp table tmp_incident(id uuid);
insert into tmp_incident(id)
select public.create_ride_incident('aaaaaaaa-bbbb-cccc-dddd-000000000020', 'safety', 'issue', 'high');

select ok(
  (select count(*) from tmp_incident) = 1,
  'Incident created'
);

-- Non-admin cannot use admin_update_ride_incident
set local request.jwt.claim.sub = 'aaaaaaaa-bbbb-cccc-dddd-000000000002';
select throws_ok(
  $$ select public.admin_update_ride_incident((select id from tmp_incident), 'triaging', null, 'review') $$,
  'not_allowed',
  'Non-admin cannot triage'
);

-- Admin can triage and assign
set local request.jwt.claim.sub = 'aaaaaaaa-bbbb-cccc-dddd-000000000003';
select lives_ok(
  $$ select public.admin_update_ride_incident((select id from tmp_incident), 'triaging', 'aaaaaaaa-bbbb-cccc-dddd-000000000003', 'reviewing') $$,
  'Admin can triage incident'
);

select results_eq(
  $$ select status from public.ride_incidents where id = (select id from tmp_incident) $$,
  array['triaging'::public.incident_status],
  'Incident status updated'
);

select results_eq(
  $$ select assigned_to from public.ride_incidents where id = (select id from tmp_incident) $$,
  array['aaaaaaaa-bbbb-cccc-dddd-000000000003'::uuid],
  'Incident assigned'
);

select results_eq(
  $$ select resolution_note from public.ride_incidents where id = (select id from tmp_incident) $$,
  array['reviewing'::text],
  'Resolution note stored'
);

select * from finish();
rollback;

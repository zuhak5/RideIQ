# Architecture (baseline)

## Domains

- **Identity:** `profiles` (one per auth.user)
- **Supply:** `drivers`, `driver_vehicles`, `driver_locations`
- **Demand:** `ride_requests`
- **Trips:** `rides`, `ride_events`
- **Payments (stub):** `payments`

## Data ownership & access

- Clients access data via PostgREST with strict **RLS**.
- Sensitive operations (matching, accepting, state transitions) run in **Edge Functions** using the **Service Role** key.

## Geo strategy

- Driver location is stored in `driver_locations.loc` as `geography(Point, 4326)`.
- Matching uses `ST_DWithin` / `ST_Distance` and a **GiST** index.

## Realtime

- Rider subscribes to updates for their own `ride_requests` / `rides`.
- Driver subscribes to their assigned `ride_requests` / `rides`.

## Reliability principles

- State changes are **idempotent** and **monotonic** (can’t jump backwards).
- Each ride has an integer `version` for optimistic concurrency.


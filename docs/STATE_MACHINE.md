# Trip state machine

This system uses **two related** state machines:

1) `ride_requests.status` — from rider intent to matched driver
2) `rides.status` — from driver acceptance through trip completion

## 1) ride_requests.status

| Status | Who sets | Next statuses | Notes |
|---|---|---|---|
| `requested` | rider | `matched`, `cancelled`, `no_driver`, `expired` | Created by rider. |
| `matched` | system | `accepted`, `cancelled`, `expired` | Driver is assigned but not yet accepted. |
| `accepted` | system/driver | (immutable) | Ride row is created. |
| `cancelled` | rider | (terminal) | Rider cancelled before acceptance (or during matching). |
| `no_driver` | system | (terminal) | No suitable drivers found within constraints. |
| `expired` | system | (terminal) | Match window exceeded. |

## 2) rides.status

| Status | Actor | Next statuses |
|---|---|---|
| `assigned` | driver/system | `arrived`, `canceled` |
| `arrived` | driver | `in_progress`, `canceled` |
| `in_progress` | driver/system | `completed`, `canceled` |
| `completed` | system | (terminal) |
| `canceled` | rider/driver/system | (terminal) |

## Invariants

- A `ride_request` can have **at most one** `ride` (`rides.request_id` is unique).
- `rides.version` increments on every transition.
- Only rider/driver involved in a ride can read its events.

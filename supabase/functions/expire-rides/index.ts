import { handleOptions } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { logAppEvent } from '../_shared/log.ts';

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

// System actor used for automatic state transitions.
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

function clampInt(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function parseBool(v: string | null) {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorJson('Method not allowed', 405);
  }

  // Protect internal scheduled endpoint (do not expose service_role actions publicly)
  if (CRON_SECRET) {
    const got = req.headers.get('x-cron-secret') ?? '';
    if (got !== CRON_SECRET) {
      return errorJson('Unauthorized', 401, 'UNAUTHORIZED');
    }
  }

  try {
    const url = new URL(req.url);

    // Safety: allow running in read-only mode.
    const dryRun = parseBool(url.searchParams.get('dry_run')) || parseBool(req.headers.get('x-dry-run'));

    // Defaults: cancel rides that are stuck
    // - assigned > 15 min
    // - arrived > 60 min
    const assignedAfterSeconds = clampInt(Number(url.searchParams.get('assigned_after_seconds') ?? '900'), 60, 24 * 3600);
    const arrivedAfterSeconds = clampInt(Number(url.searchParams.get('arrived_after_seconds') ?? '3600'), 60, 7 * 24 * 3600);
    const limit = clampInt(Number(url.searchParams.get('limit') ?? '200'), 1, 500);

    const service = createServiceClient();

    const cutoffAssigned = new Date(Date.now() - assignedAfterSeconds * 1000).toISOString();
    const cutoffArrived = new Date(Date.now() - arrivedAfterSeconds * 1000).toISOString();

    // Query stuck rides (best effort; we'll re-check version at RPC time).
    const { data: assignedRides, error: q1Err } = await service
      .from('rides')
      .select('id,status,version,updated_at')
      .eq('status', 'assigned')
      .lt('updated_at', cutoffAssigned)
      .order('updated_at', { ascending: true })
      .limit(limit);

    if (q1Err) return errorJson(q1Err.message ?? 'Query failed', 500, 'QUERY_FAILED');

    const remaining = Math.max(0, limit - (assignedRides?.length ?? 0));

    const { data: arrivedRides, error: q2Err } = remaining > 0
      ? await service
        .from('rides')
        .select('id,status,version,updated_at')
        .eq('status', 'arrived')
        .lt('updated_at', cutoffArrived)
        .order('updated_at', { ascending: true })
        .limit(remaining)
      : { data: [], error: null };

    if (q2Err) return errorJson(q2Err.message ?? 'Query failed', 500, 'QUERY_FAILED');

    const rides = [...(assignedRides ?? []), ...(arrivedRides ?? [])] as Array<{ id: string; status: string; version: number; updated_at: string }>;

    const results: Array<Record<string, unknown>> = [];

    for (const r of rides) {
      if (dryRun) {
        results.push({ ride_id: r.id, from: r.status, action: 'would_cancel', updated_at: r.updated_at });
        continue;
      }

      const { error: upErr } = await service.rpc('transition_ride_v2', {
        p_ride_id: r.id,
        p_to_status: 'canceled',
        p_actor_id: SYSTEM_ACTOR_ID,
        p_actor_type: 'system',
        p_expected_version: r.version,
      });

      if (upErr) {
        results.push({ ride_id: r.id, from: r.status, action: 'skip', error: upErr.message });
        continue;
      }

      results.push({ ride_id: r.id, from: r.status, action: 'canceled' });
    }

    await logAppEvent({
      event_type: 'expire_rides',
      actor_type: 'system',
      payload: { dry_run: dryRun, assigned_after_seconds: assignedAfterSeconds, arrived_after_seconds: arrivedAfterSeconds, processed: results.length, results },
    });

    return json({ ok: true, dry_run: dryRun, processed: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logAppEvent({ event_type: 'expire_rides_error', actor_type: 'system', payload: { message: msg } });
    return errorJson(msg, 500, 'INTERNAL');
  }
});

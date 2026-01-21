import { handleOptions } from '../_shared/cors.ts';
import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { logAppEvent } from '../_shared/log.ts';

type Body = {
  ride_id: string;
  to_status: 'arrived' | 'in_progress' | 'completed' | 'canceled';
};

const allowed: Record<string, Set<string>> = {
  assigned: new Set(['arrived', 'canceled']),
  arrived: new Set(['in_progress', 'canceled']),
  in_progress: new Set(['completed', 'canceled']),
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'POST') {
      return errorJson('Method not allowed', 405);
    }

    const { user, error: authError } = await requireUser(req);
    if (!user) {
      return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED');
    }

    const ip = getClientIp(req);
    const rl = await consumeRateLimit({
      key: `transition:${user.id}:${ip ?? 'noip'}`,
      windowSeconds: 60,
      limit: 60,
    });
    if (!rl.allowed) {
      return json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
        429,
        { 'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))) },
      );
    }

    const body = (await req.json()) as Body;
    if (!body?.ride_id || !body?.to_status) {
      return errorJson('ride_id and to_status are required', 400, 'VALIDATION_ERROR');
    }

    const service = createServiceClient();

    const { data: ride, error: rideErr } = await service
      .from('rides')
      .select('id,rider_id,driver_id,status,version,started_at,completed_at')
      .eq('id', body.ride_id)
      .single();

    if (rideErr || !ride) {
      return errorJson(rideErr?.message ?? 'Ride not found', 404, 'NOT_FOUND');
    }

    const isRider = ride.rider_id === user.id;
    const isDriver = ride.driver_id === user.id;
    if (!isRider && !isDriver) {
      return errorJson('Forbidden', 403, 'FORBIDDEN');
    }

    const current = ride.status as string;
    const target = body.to_status as string;

    if (current === target) {
      return json({ ok: true, ride, idempotent: true, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } });
    }

    if (!allowed[current] || !allowed[current].has(target)) {
      return errorJson(`Invalid transition ${current} -> ${target}`, 409, 'INVALID_TRANSITION');
    }

    // Actor constraints (simple MVP rules)
    if (target === 'arrived' && !isDriver) {
      return errorJson('Only driver can mark arrived', 403, 'FORBIDDEN');
    }

    if ((target === 'in_progress' || target === 'completed') && !isDriver) {
      return errorJson('Only driver can progress trip', 403, 'FORBIDDEN');
    }

    const actorType = (isDriver ? 'driver' : 'rider') as 'driver' | 'rider';

    const { data: updated, error: upErr } = await service.rpc('transition_ride_v2', {
      p_ride_id: ride.id,
      p_to_status: target,
      p_actor_id: user.id,
      p_actor_type: actorType,
      p_expected_version: ride.version,
    });

    if (upErr) {
      const msg = upErr.message ?? 'Transition failed';
      const code = msg.includes('version_mismatch') ? 'VERSION_MISMATCH'
        : msg.includes('invalid_transition') ? 'INVALID_TRANSITION'
          : msg.includes('ride_not_found') ? 'NOT_FOUND'
            : 'TRANSITION_FAILED';
      const status = code === 'NOT_FOUND' ? 404 : 409;

      await logAppEvent({
        event_type: 'ride_transition_error',
        actor_id: user.id,
        actor_type: actorType,
        ride_id: ride.id,
        payload: { message: msg, from: current, to: target },
      });

      return errorJson(msg, status, code, code === 'VERSION_MISMATCH' ? { hint: 'Ride was updated elsewhere. Refresh and retry.' } : undefined);
    }

    await logAppEvent({
      event_type: 'ride_transition',
      actor_id: user.id,
      actor_type: actorType,
      ride_id: (updated as any)?.id ?? ride.id,
      payload: { from: current, to: target },
    });

    return json({ ok: true, ride: updated, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
});

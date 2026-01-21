import { handleOptions } from '../_shared/cors.ts';
import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { logAppEvent } from '../_shared/log.ts';

type MatchRideBody = {
  request_id?: string;
  radius_m?: number;
  limit_n?: number;
  match_ttl_seconds?: number;
  stale_after_seconds?: number;
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorJson('Method not allowed', 405);
  }

  const { user, error: authError } = await requireUser(req);
  if (!user) {
    return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED');
  }

  // Rate limit: matching is expensive (geo + locks)
  const ip = getClientIp(req);
  const rl = await consumeRateLimit({
    key: `match:${user.id}:${ip ?? 'noip'}`,
    windowSeconds: 60,
    limit: 10,
  });
  if (!rl.allowed) {
    return json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
      429,
      { 'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))) },
    );
  }

  const body: MatchRideBody = await req.json().catch(() => ({}));
  const requestId = body.request_id;
  if (!requestId) {
    return errorJson('request_id is required', 400, 'VALIDATION_ERROR');
  }

  const service = createServiceClient();

  const { data, error } = await service.rpc('dispatch_match_ride', {
    p_request_id: requestId,
    p_rider_id: user.id,
    p_radius_m: body.radius_m ?? 5000,
    p_limit_n: body.limit_n ?? 20,
    p_match_ttl_seconds: body.match_ttl_seconds ?? 120,
    p_stale_after_seconds: body.stale_after_seconds ?? 30,
  });

  if (error) {
    if (error.message?.includes("insufficient_wallet_balance")) {
      return errorJson("Insufficient wallet balance. Please top up and try again.", 409, "INSUFFICIENT_FUNDS");
    }
    await logAppEvent({
      event_type: 'dispatch_match_ride_error',
      actor_id: user.id,
      actor_type: 'rider',
      request_id: requestId,
      payload: { message: error.message },
    });
    return errorJson(error.message, 400, 'DISPATCH_ERROR');
  }

  const row = Array.isArray(data) ? data[0] : data;

  await logAppEvent({
    event_type: 'dispatch_match_ride',
    actor_id: user.id,
    actor_type: 'rider',
    request_id: requestId,
    payload: { status: row?.status, assigned_driver_id: row?.assigned_driver_id },
  });

  return json({ request: row, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } });
});

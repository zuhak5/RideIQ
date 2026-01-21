import { handleOptions } from '../_shared/cors.ts';
import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { logAppEvent } from '../_shared/log.ts';

type DriverAcceptBody = {
  request_id?: string;
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

  // Rate limit: accepting should be bounded too
  const ip = getClientIp(req);
  const rl = await consumeRateLimit({
    key: `accept:${user.id}:${ip ?? 'noip'}`,
    windowSeconds: 60,
    limit: 20,
  });
  if (!rl.allowed) {
    return json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
      429,
      { 'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))) },
    );
  }

  const body: DriverAcceptBody = await req.json().catch(() => ({}));
  const requestId = body.request_id;
  if (!requestId) {
    return errorJson('request_id is required', 400, 'VALIDATION_ERROR');
  }

  const service = createServiceClient();

  const { data, error } = await service.rpc('dispatch_accept_ride', {
    p_request_id: requestId,
    p_driver_id: user.id,
  });

  if (error) {
    if (error.message?.includes('insufficient_wallet_balance')) {
      return errorJson('Rider has insufficient wallet balance for this ride.', 409, 'INSUFFICIENT_FUNDS');
    }
    await logAppEvent({
      event_type: 'dispatch_accept_ride_error',
      actor_id: user.id,
      actor_type: 'driver',
      request_id: requestId,
      payload: { message: error.message },
    });
    return errorJson(error.message, 400, 'DISPATCH_ERROR');
  }

  const row = Array.isArray(data) ? data[0] : data;

  await logAppEvent({
    event_type: 'dispatch_accept_ride',
    actor_id: user.id,
    actor_type: 'driver',
    request_id: requestId,
    ride_id: row?.id,
    payload: { status: row?.status },
  });

  return json({ ride: row, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } });
});

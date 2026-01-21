import { handleOptions } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { verifyJwtHS256 } from '../_shared/crypto.ts';

const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, '');
const ZAINCASH_SECRET = Deno.env.get('ZAINCASH_SECRET') ?? '';

// (JWT verification + JSON parsing moved to _shared/crypto.ts)

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function redirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
  });
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'GET') return errorJson('Method not allowed', 405);

    if (!ZAINCASH_SECRET) return errorJson('Missing ZAINCASH_SECRET', 500, 'MISCONFIGURED');

    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? '';
    if (!token) return errorJson('Missing token', 400, 'VALIDATION_ERROR');

    const payload = await verifyJwtHS256(token, ZAINCASH_SECRET);
    if (!payload) return errorJson('Invalid token', 400, 'INVALID_TOKEN');

    const statusRaw = String(payload.status ?? '').toLowerCase();
    const orderId = String(payload.orderid ?? payload.orderId ?? '');
    const txId = String(payload.id ?? '');

    const service = createServiceClient();

    // Best-effort provider event logging (idempotent via unique constraint).
    const eventId = txId || `jwt:${token.slice(0, 24)}`;
    try {
      await service.from('provider_events').insert({
        provider_code: 'zaincash',
        provider_event_id: eventId,
        payload,
      });
    } catch {
      // ignore duplicates
    }

    if (!orderId || !isUuid(orderId)) {
      return errorJson('Invalid orderId', 400, 'VALIDATION_ERROR');
    }

    if (statusRaw === 'success' || statusRaw === 'completed') {
      const { error } = await service.rpc('wallet_finalize_topup', {
        p_intent_id: orderId,
        p_provider_tx_id: txId || null,
        p_provider_payload: payload,
      });
      if (error) {
        return errorJson(error.message ?? 'Finalize failed', 500, 'FINALIZE_FAILED');
      }
    } else if (statusRaw === 'failed') {
      const { error } = await service.rpc('wallet_fail_topup', {
        p_intent_id: orderId,
        p_failure_reason: 'zaincash_failed',
        p_provider_payload: payload,
      });
      if (error) {
        return errorJson(error.message ?? 'Fail failed', 500, 'FAIL_FAILED');
      }
    } else {
      // pending/unknown: just store payload and keep pending.
      await service
        .from('topup_intents')
        .update({ status: 'pending', provider_tx_id: txId || null, provider_payload: payload })
        .eq('id', orderId);
    }

    const dest = APP_BASE_URL
      ? `${APP_BASE_URL}/wallet?tab=topups&intent_id=${encodeURIComponent(orderId)}&status=${encodeURIComponent(statusRaw || 'unknown')}`
      : '';

    if (dest) return redirect(dest);

    return json({ ok: true, status: statusRaw, intent_id: orderId, provider_tx_id: txId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
});

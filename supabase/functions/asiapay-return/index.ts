import { handleOptions } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { shaHex, timingSafeEqual } from '../_shared/crypto.ts';

const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, '');

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

// (SHA helper moved to _shared/crypto.ts)

function redirectToWallet(intentId: string | null, status: string | null, verified: boolean | null) {
  if (!APP_BASE_URL) return null;
  const url = new URL(`${APP_BASE_URL}/wallet`);
  url.searchParams.set('tab', 'topups');
  if (intentId) url.searchParams.set('intent_id', intentId);
  if (status) url.searchParams.set('status', status);
  if (verified !== null) url.searchParams.set('verified', verified ? '1' : '0');
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'GET' && req.method !== 'POST') return errorJson('Method not allowed', 405);

    const service = createServiceClient();

    // Return URL may be called via GET or POST.
    let params: URLSearchParams;
    if (req.method === 'GET') {
      const u = new URL(req.url);
      params = u.searchParams;
    } else {
      const text = await req.text();
      // PayDollar typically posts x-www-form-urlencoded.
      params = new URLSearchParams(text);
      if (params.toString() === '' && text) {
        // Fallback: try JSON.
        try {
          const obj = JSON.parse(text) as Record<string, unknown>;
          params = new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, String(v ?? '')]));
        } catch {
          // keep empty
        }
      }
    }

    const src = params.get('src') ?? params.get('Src') ?? '';
    const prc = params.get('prc') ?? params.get('Prc') ?? '';
    const successCode = params.get('successcode') ?? params.get('SuccessCode') ?? params.get('successCode') ?? '';

    // Merchant reference / order reference.
    const ref =
      params.get('Ref') ??
      params.get('ref') ??
      params.get('orderRef') ??
      params.get('OrderRef') ??
      params.get('MerchantRef') ??
      '';

    const payRef = params.get('PayRef') ?? params.get('payRef') ?? params.get('payref') ?? '';
    const curr = params.get('Curr') ?? params.get('curr') ?? params.get('currCode') ?? params.get('CurrCode') ?? '';
    const amt = params.get('Amt') ?? params.get('amt') ?? params.get('amount') ?? params.get('Amount') ?? '';
    const payerAuth = params.get('payerAuth') ?? params.get('PayerAuth') ?? params.get('payerauth') ?? '';

    const secureHash = (params.get('secureHash') ?? params.get('SecureHash') ?? '').trim();
    const secureHashType = (params.get('secureHashType') ?? params.get('SecureHashType') ?? 'sha1').toLowerCase();

    // Log raw provider event (idempotent best effort).
    try {
      const eventId = `return:${ref}:${payRef || prc || ''}:${successCode || 'unknown'}`;
      await service.from('provider_events').insert({
        provider_code: 'asiapay',
        provider_event_id: eventId,
        payload: Object.fromEntries(params.entries()),
      });
    } catch {
      // ignore duplicates
    }

    // Load provider config for secure hash verification.
    const { data: provider, error: provErr } = await service
      .from('payment_providers')
      .select('enabled,config')
      .eq('code', 'asiapay')
      .maybeSingle();
    if (provErr || !provider) return errorJson('Provider not found', 404, 'NOT_FOUND');

    if (!(provider as any).enabled) {
      const r = redirectToWallet(ref && isUuid(ref) ? ref : null, 'pending', null);
      if (r) return r;
      return json({ ok: true, ignored: true, reason: 'provider_disabled' });
    }

    const cfg = ((provider as any).config ?? {}) as Record<string, unknown>;
    const secret = String(cfg.secure_hash_secret ?? '');

    let verified: boolean | null = null;
    if (secret) {
      verified = false;
      if (secureHash) {
        const algo = secureHashType === 'sha256' ? ('SHA-256' as const) : ('SHA-1' as const);
        // Verify data string = Src|Prc|SuccessCode|MerchantRef|PayRef|Curr|Amt|payerAuth|Secret
        const verifyStr = `${src}|${prc}|${successCode}|${ref}|${payRef}|${curr}|${amt}|${payerAuth}|${secret}`;
        const expected = await shaHex(algo, verifyStr);
        verified = timingSafeEqual(expected.toLowerCase(), secureHash.toLowerCase());
      }
    }

    const isSuccess = String(successCode).trim() === '0' || String(successCode).toLowerCase() === 'success';

    // IMPORTANT: do NOT update wallet balance from the return URL.
    // Use the server-to-server datafeed (asiapay-notify) as the source of truth.
    if (ref && isUuid(ref)) {
      const r = redirectToWallet(ref, isSuccess ? 'succeeded' : 'failed', verified);
      if (r) return r;
      return json({ ok: true, intent_id: ref, status: isSuccess ? 'succeeded' : 'failed', verified, note: 'return_only' });
    }

    // Unknown ref — still redirect to wallet.
    const r = redirectToWallet(null, isSuccess ? 'succeeded' : 'failed', verified);
    if (r) return r;

    return json({ ok: true, ignored: true, status: isSuccess ? 'succeeded' : 'failed', verified });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
});

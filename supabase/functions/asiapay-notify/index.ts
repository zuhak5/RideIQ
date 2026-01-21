import { handleOptions } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { shaHex, timingSafeEqual } from '../_shared/crypto.ts';

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

// (SHA helper moved to _shared/crypto.ts)

/**
 * PayDollar/AsiaPay datafeed:
 * - We verify SecureHash if configured for the merchant account.
 * - We expect Merchant Reference Number (ref) to be our topup_intents.id (uuid).
 */
Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405);

    const service = createServiceClient();

    // PayDollar datafeed is typically form-urlencoded.
    const bodyText = await req.text();
    const params = new URLSearchParams(bodyText);

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
      const eventId = `datafeed:${ref}:${payRef || prc || ''}:${successCode || 'unknown'}`;
      await service.from('provider_events').insert({
        provider_code: 'asiapay',
        provider_event_id: eventId,
        payload: Object.fromEntries(params.entries()),
      });
    } catch {
      // ignore duplicates
    }

    const { data: provider, error: provErr } = await service
      .from('payment_providers')
      .select('code,enabled,config')
      .eq('code', 'asiapay')
      .maybeSingle();
    if (provErr || !provider) return errorJson('Provider not found', 404, 'NOT_FOUND');
    if (!provider.enabled) return errorJson('Provider disabled', 409, 'PROVIDER_DISABLED');

    const cfg = ((provider as any).config ?? {}) as Record<string, unknown>;
    const secret = String(cfg.secure_hash_secret ?? '');

    // Verify SecureHash if secret is configured.
    if (secret) {
      if (!secureHash) return errorJson('Missing secureHash', 401, 'UNAUTHORIZED');

      const algo = secureHashType === 'sha256' ? ('SHA-256' as const) : ('SHA-1' as const);

      // Verify data string = Src|Prc|SuccessCode|MerchantRef|PayRef|Curr|Amt|payerAuth|Secret
      const verifyStr = `${src}|${prc}|${successCode}|${ref}|${payRef}|${curr}|${amt}|${payerAuth}|${secret}`;
      const expected = await shaHex(algo, verifyStr);

      if (!timingSafeEqual(expected.toLowerCase(), secureHash.toLowerCase())) {
        return errorJson('Invalid secureHash', 401, 'UNAUTHORIZED');
      }
    }

    if (!ref || !isUuid(ref)) {
      // Always return 200 OK so the gateway doesn't keep retrying for invalid/missing refs.
      return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }

    const isSuccess = String(successCode).trim() === '0' || String(successCode).toLowerCase() === 'success';

    // Defensive validation: confirm intent exists and amount/currency match what we created.
    const { data: intent } = await service
      .from('topup_intents')
      .select('id,provider_code,amount_iqd,status,provider_payload')
      .eq('id', ref)
      .maybeSingle();

    if (!intent) {
      return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }

    if (String(intent.provider_code) !== 'asiapay') {
      return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }

    const amtNum = Number(amt);
    const amtIqd = Number.isFinite(amtNum) ? Math.trunc(amtNum) : NaN;
    const cfgCurr = String((cfg.curr_code ?? cfg.currCode ?? '') || '').trim();
    const currOk = !cfgCurr || !curr || String(curr).trim() === cfgCurr || String(curr).trim().toUpperCase() === 'IQD';
    const amtOk = Number.isFinite(amtIqd) && amtIqd > 0 && amtIqd === Number(intent.amount_iqd);

    if (!currOk || !amtOk) {
      // Do NOT auto-fail (user may have paid); keep pending and attach validation flags for admin review.
      try {
        const merged = {
          ...(typeof intent.provider_payload === 'object' && intent.provider_payload ? (intent.provider_payload as Record<string, unknown>) : {}),
          validation: {
            ...(typeof (intent.provider_payload as any)?.validation === 'object' ? (intent.provider_payload as any).validation : {}),
            asiapay: {
              curr_ok: currOk,
              amt_ok: amtOk,
              expected_amount_iqd: intent.amount_iqd,
              got_amount: amt,
              expected_curr_code: cfgCurr || null,
              got_curr: curr || null,
              at: new Date().toISOString(),
            },
          },
          last_datafeed: Object.fromEntries(params.entries()),
        };
        await service
          .from('topup_intents')
          .update({ status: 'pending', provider_tx_id: payRef || null, provider_payload: merged })
          .eq('id', ref);
      } catch {
        // ignore
      }
      return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }

    if (isSuccess) {
      const { error } = await service.rpc('wallet_finalize_topup', {
        p_intent_id: ref,
        p_provider_tx_id: payRef || null,
        p_provider_payload: Object.fromEntries(params.entries()),
      });
      if (error) return errorJson(error.message ?? 'Finalize failed', 500, 'FINALIZE_FAILED');
      return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }

    const { error } = await service.rpc('wallet_fail_topup', {
      p_intent_id: ref,
      p_failure_reason: `asiapay_failed:${successCode || 'failed'}`,
      p_provider_payload: Object.fromEntries(params.entries()),
    });
    if (error) return errorJson(error.message ?? 'Fail failed', 500, 'FAIL_FAILED');
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
});

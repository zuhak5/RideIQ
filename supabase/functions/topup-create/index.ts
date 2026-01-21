import { handleOptions } from '../_shared/cors.ts';
import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { logAppEvent } from '../_shared/log.ts';
import { SUPABASE_URL } from '../_shared/config.ts';
import { shaHex, signJwtHS256 } from '../_shared/crypto.ts';

type Body = {
  provider_code?: string;
  package_id?: string;
  idempotency_key?: string;
};

const APP_SERVICE_TYPE = Deno.env.get('TOPUP_SERVICE_TYPE') ?? 'Ride top-up';
const ZAINCASH_BASE_URL = (Deno.env.get('ZAINCASH_BASE_URL') ?? 'https://test.zaincash.iq').replace(/\/$/, '');
const ZAINCASH_MERCHANT_ID = Deno.env.get('ZAINCASH_MERCHANT_ID') ?? '';
const ZAINCASH_SECRET = Deno.env.get('ZAINCASH_SECRET') ?? '';
const ZAINCASH_MSISDN = Deno.env.get('ZAINCASH_MSISDN') ?? '';
const ZAINCASH_LANG = Deno.env.get('ZAINCASH_LANG') ?? 'en';

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

// (JWT signing + SHA helpers moved to _shared/crypto.ts)

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405);

    const { user, error: authError } = await requireUser(req);
    if (!user) return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED');

    const ip = getClientIp(req);
    const rl = await consumeRateLimit({ key: `topup:${user.id}:${ip ?? 'noip'}`, windowSeconds: 60, limit: 10 });
    if (!rl.allowed) {
      return json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
        429,
        { 'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))) },
      );
    }

    const body: Body = await req.json().catch(() => ({}));
    const providerCode = (body.provider_code ?? '').trim().toLowerCase();
    const packageId = (body.package_id ?? '').trim();
    const idempotencyKey = (body.idempotency_key ?? '').trim() || null;

    if (!providerCode) return errorJson('provider_code is required', 400, 'VALIDATION_ERROR');
    if (!packageId || !isUuid(packageId)) return errorJson('package_id is required', 400, 'VALIDATION_ERROR');

    const service = createServiceClient();

    const { data: provider, error: provErr } = await service
      .from('payment_providers')
      .select('code,kind,enabled,config,name')
      .eq('code', providerCode)
      .maybeSingle();
    if (provErr || !provider) return errorJson('Payment provider not found', 404, 'NOT_FOUND');
    if (!provider.enabled) return errorJson('Payment provider is disabled', 409, 'PROVIDER_DISABLED');

    const { data: pkg, error: pkgErr } = await service
      .from('topup_packages')
      .select('id,label,amount_iqd,bonus_iqd,active')
      .eq('id', packageId)
      .eq('active', true)
      .maybeSingle();
    if (pkgErr || !pkg) return errorJson('Top-up package not found', 404, 'NOT_FOUND');

    const amountIqd = Number(pkg.amount_iqd ?? 0);
    const bonusIqd = Number(pkg.bonus_iqd ?? 0);
    if (!Number.isFinite(amountIqd) || amountIqd <= 0) return errorJson('Invalid package amount', 400, 'VALIDATION_ERROR');

    // Insert intent. If the user passes an idempotency_key and it already exists, return existing intent.
    let intentId: string | null = null;
    {
      const { data: ins, error: insErr } = await service
        .from('topup_intents')
        .insert({
          user_id: user.id,
          provider_code: provider.code,
          package_id: pkg.id,
          amount_iqd: amountIqd,
          bonus_iqd: bonusIqd,
          status: 'created',
          idempotency_key: idempotencyKey,
        })
        .select('id')
        .single();

      if (insErr) {
        const msg = insErr.message ?? '';
        if (idempotencyKey && (msg.includes('duplicate') || msg.includes('23505') || msg.includes('unique'))) {
          const { data: existing, error: exErr } = await service
            .from('topup_intents')
            .select('id')
            .eq('user_id', user.id)
            .eq('idempotency_key', idempotencyKey)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (exErr || !existing) return errorJson('Failed to create top-up intent', 500, 'INTENT_CREATE_FAILED');
          intentId = existing.id as string;
        } else {
          await logAppEvent({
            event_type: 'topup_intent_create_error',
            actor_id: user.id,
            actor_type: 'rider',
            payload: { message: msg, provider: provider.code, package_id: packageId },
          });
          return errorJson('Failed to create top-up intent', 500, 'INTENT_CREATE_FAILED');
        }
      } else {
        intentId = (ins as any)?.id ?? null;
      }
    }

    if (!intentId) return errorJson('Failed to create top-up intent', 500, 'INTENT_CREATE_FAILED');

    const providerKind = String((provider as any).kind ?? '').toLowerCase();
    const providerCfg = ((provider as any).config ?? {}) as Record<string, unknown>;

    // Provider-specific init.
    if (providerKind === 'zaincash') {
      if (!ZAINCASH_MERCHANT_ID || !ZAINCASH_SECRET || !ZAINCASH_MSISDN) {
        return errorJson('ZainCash is not configured. Set ZAINCASH_MERCHANT_ID, ZAINCASH_SECRET, ZAINCASH_MSISDN.', 500, 'MISCONFIGURED');
      }

      // ZainCash amount is IQD integer, min 250.
      if (amountIqd < 250) return errorJson('Minimum top-up is 250 IQD.', 400, 'VALIDATION_ERROR');

      const redirectUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/zaincash-return`;

      const jwt = await signJwtHS256(
        {
          amount: Math.trunc(amountIqd),
          serviceType: APP_SERVICE_TYPE,
          msisdn: Number(ZAINCASH_MSISDN),
          orderId: intentId,
          redirectUrl,
        },
        ZAINCASH_SECRET,
        60 * 60,
      );

      const form = new URLSearchParams();
      form.set('token', jwt);
      form.set('merchantId', ZAINCASH_MERCHANT_ID);
      if (ZAINCASH_LANG) form.set('lang', ZAINCASH_LANG);

      const initRes = await fetch(`${ZAINCASH_BASE_URL}/transaction/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });

      const initText = await initRes.text();
      let initJson: any = null;
      try {
        initJson = JSON.parse(initText);
      } catch {
        initJson = null;
      }

      const txId = initJson?.id as string | undefined;
      if (!initRes.ok || !txId) {
        await service
          .from('topup_intents')
          .update({ status: 'failed', failure_reason: `zaincash_init_failed:${initRes.status}`, provider_payload: { init: initJson ?? initText } })
          .eq('id', intentId);
        return errorJson('Failed to initialize ZainCash payment.', 502, 'PROVIDER_ERROR');
      }

      await service
        .from('topup_intents')
        .update({ status: 'pending', provider_tx_id: txId, provider_payload: { init: initJson, order_id: intentId } })
        .eq('id', intentId);

      await logAppEvent({
        event_type: 'topup_intent_created',
        actor_id: user.id,
        actor_type: 'rider',
        payload: { intent_id: intentId, provider: 'zaincash', provider_tx_id: txId, amount: amountIqd },
      });

      const payUrl = `${ZAINCASH_BASE_URL}/transaction/pay?id=${encodeURIComponent(txId)}`;
      return json({ ok: true, intent_id: intentId, redirect_url: payUrl, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } });
    }



    if (providerKind === 'asiapay') {
      const paymentUrl = String(providerCfg.payment_url ?? providerCfg.paymentUrl ?? '').trim();
      const merchantId = String(providerCfg.merchant_id ?? providerCfg.merchantId ?? '').trim();
      const secret = String(providerCfg.secure_hash_secret ?? providerCfg.secureHashSecret ?? '').trim();
      const currCode = String(providerCfg.curr_code ?? providerCfg.currCode ?? '368').trim();
      const payType = String(providerCfg.pay_type ?? providerCfg.payType ?? 'N').trim() || 'N';
      const lang = String(providerCfg.lang ?? 'E').trim() || 'E';
      const hashTypeRaw = String(providerCfg.secure_hash_type ?? providerCfg.secureHashType ?? providerCfg.hash_alg ?? 'sha1').toLowerCase();
      const secureHashType = hashTypeRaw === 'sha256' ? 'sha256' : 'sha1';

      if (!paymentUrl || !merchantId || !secret) {
        await service
          .from('topup_intents')
          .update({ status: 'failed', failure_reason: 'asiapay_missing_config' })
          .eq('id', intentId);
        return errorJson(
          'AsiaPay is not configured. Set payment_url, merchant_id and secure_hash_secret in provider config.',
          500,
          'MISCONFIGURED',
        );
      }

      const returnUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/asiapay-return`;

      // Amount for PayDollar is numeric (often supports decimals). We send IQD integer string.
      const amountStr = String(Math.trunc(amountIqd));

      // Signing data string = Merchant ID|Merchant Reference (orderRef)|Currency Code|Amount|Payment Type|Secure Hash Secret
      const signing = `${merchantId}|${intentId}|${currCode}|${amountStr}|${payType}|${secret}`;
      const algo = secureHashType === 'sha256' ? ('SHA-256' as const) : ('SHA-1' as const);
      const secureHash = await shaHex(algo, signing);

      const postFields: Record<string, string> = {
        merchantId,
        orderRef: intentId,
        amount: amountStr,
        currCode,
        payType,
        successUrl: returnUrl,
        failUrl: returnUrl,
        errorUrl: returnUrl,
        lang,
        secureHash,
      };
      // Some merchant accounts require explicit secureHashType parameter.
      postFields.secureHashType = secureHashType;

      // Best-effort provider event logging.
      try {
        await service.from('provider_events').insert({
          provider_code: provider.code,
          provider_event_id: `init:${intentId}`,
          payload: { post_url: paymentUrl, post_fields: postFields },
        });
      } catch {
        // ignore duplicates
      }

      await service
        .from('topup_intents')
        .update({
          status: 'pending',
          provider_tx_id: null,
          provider_payload: { init: { post_url: paymentUrl, post_fields: postFields } },
        })
        .eq('id', intentId);

      await logAppEvent({
        event_type: 'topup_intent_created',
        actor_id: user.id,
        actor_type: 'rider',
        payload: { intent_id: intentId, provider: 'asiapay', amount: amountIqd },
      });

      return json({
        ok: true,
        intent_id: intentId,
        post_url: paymentUrl,
        post_fields: postFields,
        rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt },
      });
    }

    if (providerKind === 'qicard') {
      const baseUrl = String(providerCfg.base_url ?? '').replace(/\/$/, '');
      const createPath = String(providerCfg.create_path ?? '/api/payments');
      const apiKey = String(providerCfg.api_key ?? '');
      const bearerToken = String(providerCfg.bearer_token ?? apiKey);
      const currency = String(providerCfg.currency ?? 'IQD');

      if (!baseUrl) {
        await service.from('topup_intents').update({ status: 'failed', failure_reason: 'qicard_missing_base_url' }).eq('id', intentId);
        return errorJson('QiCard is not configured (missing base_url in provider config).', 500, 'MISCONFIGURED');
      }

      const notifyUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/qicard-notify`;
      const returnUrl = String(providerCfg.return_url ?? (Deno.env.get('APP_BASE_URL') ? `${(Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, '')}/wallet?tab=topups&intent_id=${encodeURIComponent(intentId)}` : ''));

      const payload: Record<string, unknown> = {
        amount: Math.trunc(amountIqd),
        currency,
        description: `${APP_SERVICE_TYPE} (${pkg.label})`,
        reference: intentId,
        callbackUrl: notifyUrl,
        returnUrl,
        metadata: { intent_id: intentId, user_id: user.id, provider: provider.code },
      };

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

      const res = await fetch(`${baseUrl}${createPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let out: any = null;
      try {
        out = JSON.parse(text);
      } catch {
        out = null;
      }

      const redirectUrl = String(out?.formUrl ?? out?.form_url ?? out?.checkoutUrl ?? out?.url ?? out?.redirect_url ?? '');
      const providerTxId = String(out?.id ?? out?.paymentId ?? out?.payment_id ?? out?.txId ?? out?.transactionId ?? '');

      // Log response for debugging/idempotency.
      try {
        await service.from('provider_events').insert({
          provider_code: provider.code,
          provider_event_id: providerTxId || `init:${intentId}`,
          payload: { request: payload, response: out ?? text, status: res.status },
        });
      } catch {
        // ignore duplicates
      }

      if (!res.ok || !redirectUrl) {
        await service
          .from('topup_intents')
          .update({ status: 'failed', failure_reason: `qicard_init_failed:${res.status}`, provider_payload: { init: out ?? text } })
          .eq('id', intentId);
        return errorJson('Failed to initialize QiCard payment.', 502, 'PROVIDER_ERROR');
      }

      await service
        .from('topup_intents')
        .update({ status: 'pending', provider_tx_id: providerTxId || null, provider_payload: { init: out ?? {}, request: payload } })
        .eq('id', intentId);

      await logAppEvent({
        event_type: 'topup_intent_created',
        actor_id: user.id,
        actor_type: 'rider',
        payload: { intent_id: intentId, provider: 'qicard', provider_tx_id: providerTxId || null, amount: amountIqd },
      });

      return json({ ok: true, intent_id: intentId, redirect_url: redirectUrl, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } });
    }

    return errorJson('This payment provider is not yet supported in the current app build.', 400, 'NOT_IMPLEMENTED');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
});

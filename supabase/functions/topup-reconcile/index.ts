import { handleOptions } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { signJwtHS256 } from '../_shared/crypto.ts';

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const ZAINCASH_BASE_URL = (Deno.env.get('ZAINCASH_BASE_URL') ?? 'https://test.zaincash.iq').replace(/\/$/, '');
const ZAINCASH_MERCHANT_ID = Deno.env.get('ZAINCASH_MERCHANT_ID') ?? '';
const ZAINCASH_SECRET = Deno.env.get('ZAINCASH_SECRET') ?? '';
const ZAINCASH_MSISDN = Deno.env.get('ZAINCASH_MSISDN') ?? '';

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function parseBool(v: string | null) {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function mapStatus(s: string) {
  const v = (s ?? '').toLowerCase();
  const succeeded = ['success', 'succeeded', 'paid', 'completed', 'captured', 'done'].includes(v);
  const failed = ['failed', 'canceled', 'cancelled', 'declined', 'rejected', 'error', 'expired'].includes(v);
  if (succeeded) return 'succeeded' as const;
  if (failed) return 'failed' as const;
  return 'pending' as const;
}

async function checkZainCash(txId: string) {
  if (!ZAINCASH_MERCHANT_ID || !ZAINCASH_SECRET || !ZAINCASH_MSISDN) {
    throw new Error('ZainCash not configured');
  }

  const jwt = await signJwtHS256(
    {
      id: txId,
      msisdn: Number(ZAINCASH_MSISDN),
    },
    ZAINCASH_SECRET,
    60 * 10,
  );

  const form = new URLSearchParams();
  form.set('token', jwt);
  form.set('merchantId', ZAINCASH_MERCHANT_ID);

  const res = await fetch(`${ZAINCASH_BASE_URL}/transaction/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });

  const text = await res.text();
  let out: any = null;
  try {
    out = JSON.parse(text);
  } catch {
    out = null;
  }

  const statusRaw = String(out?.status ?? out?.data?.status ?? '').toLowerCase();
  return { ok: res.ok, statusRaw, payload: out ?? { raw: text, http_status: res.status } };
}

async function checkQiCard(providerCfg: Record<string, unknown>, providerTxId: string, intentId: string) {
  // QiCard developer docs are not publicly accessible in our environment, so the endpoint and response
  // shape are driven by payment_providers.config.
  const baseUrl = String(providerCfg.base_url ?? '').replace(/\/$/, '');
  const statusPath = String(providerCfg.status_path ?? ''); // e.g. /api/payments/{id}
  const apiKey = String(providerCfg.api_key ?? '');
  const bearerToken = String(providerCfg.bearer_token ?? apiKey);
  if (!baseUrl || !statusPath) {
    return { ok: false, statusRaw: 'pending', payload: { error: 'qicard_missing_status_path', intentId } };
  }

  const url = `${baseUrl}${statusPath}`.replace('{id}', encodeURIComponent(providerTxId)).replace('{intent_id}', encodeURIComponent(intentId));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let out: any = null;
  try {
    out = JSON.parse(text);
  } catch {
    out = null;
  }

  const statusRaw = String(out?.status ?? out?.paymentStatus ?? out?.state ?? '').toLowerCase();
  return { ok: res.ok, statusRaw, payload: out ?? { raw: text, http_status: res.status } };
}

async function checkAsiaPayFromEvents(service: ReturnType<typeof createServiceClient>, intentId: string) {
  // PayDollar/AsiaPay recommends using server-to-server datafeed as the source of truth.
  // We reconcile by looking for the latest datafeed event for this intent.
  const { data } = await service
    .from('provider_events')
    .select('provider_event_id,payload,received_at')
    .eq('provider_code', 'asiapay')
    .like('provider_event_id', `datafeed:${intentId}%`)
    .order('received_at', { ascending: false })
    .limit(1);

  const row = (data ?? [])[0] as any;
  if (!row) {
    return { ok: false, statusRaw: 'pending', payload: { reason: 'no_datafeed_event', intentId } as any, providerTxId: null as string | null };
  }

  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const successCode = String((payload as any).successcode ?? (payload as any).SuccessCode ?? (payload as any).successCode ?? '').trim();
  const payRef = String((payload as any).PayRef ?? (payload as any).payRef ?? (payload as any).payref ?? '').trim();

  const isSuccess = successCode === '0' || successCode.toLowerCase() === 'success';
  const statusRaw = isSuccess ? 'success' : 'failed';
  return { ok: true, statusRaw, payload: payload as any, providerTxId: payRef || null };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    // This function is intended for server-side cron usage.
    const provided = req.headers.get('x-cron-secret') ?? '';
    if (!CRON_SECRET || provided !== CRON_SECRET) {
      return errorJson('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const url = new URL(req.url);
    const dryRun = parseBool(url.searchParams.get('dry_run')) || parseBool(req.headers.get('x-dry-run'));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? '50')));
    const providerCodeFilter = (url.searchParams.get('provider_code') ?? '').trim().toLowerCase() || null;
    const intentIdFilter = (url.searchParams.get('intent_id') ?? '').trim() || null;
    const minAgeSeconds = Math.min(3600, Math.max(0, Number(url.searchParams.get('min_age_seconds') ?? '120')));

    if (intentIdFilter && !isUuid(intentIdFilter)) return errorJson('Invalid intent_id', 400, 'VALIDATION_ERROR');

    const service = createServiceClient();

    let q = service
      .from('topup_intents')
      .select('id,user_id,provider_code,provider_tx_id,status,created_at,provider_payload')
      .in('status', ['created', 'pending'])
      .order('created_at', { ascending: true })
      .limit(limit);

    if (providerCodeFilter) q = q.eq('provider_code', providerCodeFilter);
    if (intentIdFilter) q = q.eq('id', intentIdFilter);

    const { data: intents, error } = await q;
    if (error) return errorJson(error.message ?? 'Query failed', 500, 'QUERY_FAILED');

    const now = Date.now();
    const results: Array<Record<string, unknown>> = [];

    for (const intent of intents ?? []) {
      const createdAt = new Date(String((intent as any).created_at ?? '')).getTime();
      if (Number.isFinite(createdAt) && now - createdAt < minAgeSeconds * 1000) continue;

      const intentId = String((intent as any).id);
      const providerCode = String((intent as any).provider_code ?? '').toLowerCase();
      const providerTxId = String((intent as any).provider_tx_id ?? '') || null;

      const { data: provider, error: provErr } = await service
        .from('payment_providers')
        .select('code,kind,enabled,config')
        .eq('code', providerCode)
        .maybeSingle();
      if (provErr || !provider || !(provider as any).enabled) {
        results.push({ intent_id: intentId, provider_code: providerCode, action: 'skipped', reason: 'provider_missing_or_disabled' });
        continue;
      }

      const kind = String((provider as any).kind ?? '').toLowerCase();
      const cfg = ((provider as any).config ?? {}) as Record<string, unknown>;

      let check: { ok: boolean; statusRaw: string; payload: unknown; providerTxId?: string | null };
      let providerTxIdForFinalize: string | null = providerTxId;
      if (kind === 'zaincash') {
        if (!providerTxId) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'skipped', reason: 'missing_provider_tx_id' });
          continue;
        }
        check = await checkZainCash(providerTxId);
      } else if (kind === 'qicard') {
        if (!providerTxId) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'skipped', reason: 'missing_provider_tx_id' });
          continue;
        }
        check = await checkQiCard(cfg, providerTxId, intentId);
      } else if (kind === 'asiapay') {
        check = await checkAsiaPayFromEvents(service, intentId);
        providerTxIdForFinalize = (check as any).providerTxId ?? providerTxIdForFinalize;
      } else {
        results.push({ intent_id: intentId, provider_code: providerCode, action: 'skipped', reason: 'unsupported_provider_kind' });
        continue;
      }

      // Log provider check event (best effort). In dry-run we avoid writes.
      if (!dryRun) {
        try {
          await service.from('provider_events').insert({
            provider_code: providerCode,
            provider_event_id: `${providerTxIdForFinalize ?? intentId}:reconcile`,
            payload: { check: check.payload, ok: check.ok, statusRaw: check.statusRaw },
          });
        } catch {
          // ignore duplicates
        }
      }

      const mapped = mapStatus(check.statusRaw);
      if (mapped === 'succeeded') {
        if (dryRun) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'would_finalize', provider_tx_id: providerTxIdForFinalize });
          continue;
        }
        const { error: finErr } = await service.rpc('wallet_finalize_topup', {
          p_intent_id: intentId,
          p_provider_tx_id: providerTxIdForFinalize,
          p_provider_payload: check.payload as any,
        });
        if (finErr) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'error', error: finErr.message });
        } else {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'finalized' });
        }
      } else if (mapped === 'failed') {
        if (dryRun) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'would_fail', reason: `${providerCode}_failed:${check.statusRaw || 'failed'}` });
          continue;
        }
        const { error: failErr } = await service.rpc('wallet_fail_topup', {
          p_intent_id: intentId,
          p_failure_reason: `${providerCode}_failed:${check.statusRaw || 'failed'}`,
          p_provider_payload: check.payload as any,
        });
        if (failErr) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'error', error: failErr.message });
        } else {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'failed' });
        }
      } else {
        if (dryRun) {
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'would_mark_pending' });
        } else {
          await service
            .from('topup_intents')
            .update({ status: 'pending', provider_payload: check.payload as any })
            .eq('id', intentId);
          results.push({ intent_id: intentId, provider_code: providerCode, action: 'pending' });
        }
      }
    }

    return json({ ok: true, dry_run: dryRun, processed: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
});

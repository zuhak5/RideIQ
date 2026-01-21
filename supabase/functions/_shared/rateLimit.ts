import { createServiceClient } from './supabase.ts';

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
};

export async function consumeRateLimit(params: {
  key: string;
  windowSeconds: number;
  limit: number;
}): Promise<RateLimitResult> {
  const service = createServiceClient();

  const { data, error } = await service.rpc('rate_limit_consume', {
    p_key: params.key,
    p_window_seconds: params.windowSeconds,
    p_limit: params.limit,
  });

  if (error) {
    // Fail open: rate limiting must never take down core flows.
    return { allowed: true, remaining: 0, resetAt: new Date(Date.now() + params.windowSeconds * 1000).toISOString() };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    remaining: Number(row?.remaining ?? 0),
    resetAt: String(row?.reset_at ?? new Date(Date.now() + params.windowSeconds * 1000).toISOString()),
  };
}

export function getClientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    return first || null;
  }
  return null;
}

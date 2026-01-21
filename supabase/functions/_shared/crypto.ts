/**
 * Minimal crypto helpers shared across edge functions.
 *
 * - HMAC-SHA256 via WebCrypto (Deno)
 * - JWT HS256 signing/verification (for ZainCash)
 * - timingSafeEqual for webhook signature checks
 */

export function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * SHA digest as lowercase hex.
 *
 * Used for PayDollar/AsiaPay Secure Hash (SHA-1 / SHA-256).
 */
export async function shaHex(algo: 'SHA-1' | 'SHA-256', input: string) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function b64url(bytes: Uint8Array) {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function b64urlToBytes(input: string) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function hmacSha256Bytes(secret: string, input: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return new Uint8Array(sig);
}

export async function signJwtHS256(payload: Record<string, unknown>, secret: string, expiresSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload = { ...payload, iat: now, exp: now + expiresSeconds };
  const head = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const body = b64url(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const msg = `${head}.${body}`;
  const sig = b64url(await hmacSha256Bytes(secret, msg));
  return `${msg}.${sig}`;
}

export async function verifyJwtHS256(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const msg = `${h}.${p}`;
  const expected = b64url(await hmacSha256Bytes(secret, msg));
  if (!timingSafeEqual(expected, s)) return null;

  const payloadText = new TextDecoder().decode(b64urlToBytes(p));
  const payload = safeJsonParse(payloadText);
  if (!payload) return null;

  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  if (exp && Math.floor(Date.now() / 1000) > exp + 60) return null;
  return payload;
}

/**
 * Constant-time comparison for same-length strings.
 * If lengths differ, returns false (still does a small amount of work).
 */
export function timingSafeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(aa.length, bb.length);
  let out = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    out |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return out === 0;
}

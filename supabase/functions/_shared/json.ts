import { corsHeaders } from './cors.ts';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders, ...headers },
  });
}

export function errorJson(
  message: string,
  status = 400,
  code?: string,
  extra?: Record<string, unknown>,
) {
  const body: Record<string, unknown> = { error: message };
  if (code) body.code = code;
  if (extra) Object.assign(body, extra);
  return json(body, status);
}

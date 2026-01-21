// Centralized error-to-string conversion.
//
// We intentionally take `unknown` because JavaScript can throw *anything*.
// This keeps code compatible with strict lint rules like
// `@typescript-eslint/no-explicit-any` and TS's `useUnknownInCatchVariables`.

type ErrorLike = {
  message?: unknown;
  error_description?: unknown;
  details?: unknown;
  hint?: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;

  if (isRecord(err)) {
    const e = err as ErrorLike;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.error_description === 'string') return e.error_description;
    if (typeof e.details === 'string') return e.details;
    if (typeof e.hint === 'string') return e.hint;

    // Best-effort stringification for debugging.
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }

  return 'Unknown error';
}

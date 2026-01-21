import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// In GitHub Pages + Vite, env vars are injected at build time.
// We expose this flag so the UI can show a clear setup message instead of failing at runtime.
export const isSupabaseConfigured = Boolean(url && anon);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. The app cannot connect to Supabase.');
}

// Use a harmless placeholder when env is missing; the UI should prevent calls in that case.
export const supabase = createClient(url ?? 'https://example.supabase.co', anon ?? 'public-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

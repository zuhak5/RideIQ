import React from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = React.useState(true);
  const [session, setSession] = React.useState<Session | null>(null);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [mode, setMode] = React.useState<'signIn' | 'signUp'>('signIn');
  const [error, setError] = React.useState<string | null>(null);

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="card w-full max-w-md p-6">
          <div className="text-lg font-semibold">Supabase not configured</div>
          <div className="text-sm text-gray-600 mt-2">
            This build is missing <span className="font-mono">VITE_SUPABASE_URL</span> or{' '}
            <span className="font-mono">VITE_SUPABASE_ANON_KEY</span>.
          </div>
          <div className="text-xs text-gray-500 mt-3 space-y-1">
            <div>• Local dev: create <span className="font-mono">apps/web/.env</span> with those variables.</div>
            <div>• GitHub Pages: set repository secrets used by the workflow (same variable names).</div>
          </div>
        </div>
      </div>
    );
  }

  React.useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="card w-full max-w-md p-6">
          <div className="text-lg font-semibold">Welcome</div>
          <div className="text-sm text-gray-500 mt-1">Sign in to test the rider/driver flows.</div>

          <form
            className="mt-6 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);

              // IMPORTANT: Don't detach auth methods (they rely on `this`).
              // Calling them as standalone functions breaks the internal context and can crash.
              const res =
                mode === 'signIn'
                  ? await supabase.auth.signInWithPassword({ email, password })
                  : await supabase.auth.signUp({ email, password });

              if (res.error) setError(res.error.message);
            }}
          >
            <div>
              <div className="label">Email</div>
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <div className="label">Password</div>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                required
              />
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <button className="btn btn-primary w-full" type="submit">
              {mode === 'signIn' ? 'Sign in' : 'Create account'}
            </button>

            <button
              className="btn w-full"
              type="button"
              onClick={() => setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'))}
            >
              {mode === 'signIn' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
            </button>

            <div className="text-xs text-gray-500">
              For production you will likely use phone OTP and stricter onboarding for drivers.
            </div>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

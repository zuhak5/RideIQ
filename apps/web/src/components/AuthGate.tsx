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

          <div className="mt-6 space-y-3">
            <div>
              <div className="label">Email</div>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <div className="label">Password</div>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <button
              className="btn btn-primary w-full"
              onClick={async () => {
                setError(null);
                const fn = mode === 'signIn' ? supabase.auth.signInWithPassword : supabase.auth.signUp;
                const { error } = await fn({ email, password });
                if (error) setError(error.message);
              }}
            >
              {mode === 'signIn' ? 'Sign in' : 'Create account'}
            </button>

            <button
              className="btn w-full"
              onClick={() => setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'))}
            >
              {mode === 'signIn' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
            </button>

            <div className="text-xs text-gray-500">
              For production you will likely use phone OTP and stricter onboarding for drivers.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

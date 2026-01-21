import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [isAdmin, setIsAdmin] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      const { data, error } = await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle();
      if (!alive) return;
      if (error) {
        setIsAdmin(false);
        return;
      }
      setIsAdmin(!!data?.is_admin);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-black text-white flex items-center justify-center font-semibold">R</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">RideShare</div>
              <div className="text-xs text-gray-500">Wallet + payouts (QiCard / AsiaPay / ZainCash)</div>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <Tab to="/rider" active={loc.pathname.startsWith('/rider')}>Rider</Tab>
            <Tab to="/driver" active={loc.pathname.startsWith('/driver')}>Driver</Tab>
            <Tab to="/wallet" active={loc.pathname.startsWith('/wallet')}>Wallet</Tab>
            <Tab to="/history" active={loc.pathname.startsWith('/history')}>History</Tab>
            {isAdmin ? (
              <Tab to="/admin/payments" active={loc.pathname.startsWith('/admin')}>Admin</Tab>
            ) : null}
            <button
              className="btn"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }}
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}

function Tab({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={
        active
          ? 'btn btn-primary'
          : 'btn'
      }
    >
      {children}
    </Link>
  );
}

import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export default function AdminNav() {
  const loc = useLocation();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-sm font-semibold">Admin</div>
          <div className="text-xs text-gray-500">Payments, incidents, and provider activity</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Pill to="/admin/payments" active={loc.pathname.startsWith('/admin/payments')}>Payments</Pill>
          <Pill to="/admin/incidents" active={loc.pathname.startsWith('/admin/incidents')}>Incidents</Pill>
          <Pill to="/admin/integrity" active={loc.pathname.startsWith('/admin/integrity')}>Integrity</Pill>
        </div>
      </div>
    </div>
  );
}

function Pill({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={
        active
          ? 'px-3 py-2 rounded-xl bg-gray-900 text-white text-sm'
          : 'px-3 py-2 rounded-xl border border-gray-200 text-sm hover:bg-gray-50'
      }
    >
      {children}
    </Link>
  );
}

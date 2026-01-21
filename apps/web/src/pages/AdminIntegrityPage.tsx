import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';
import { formatIQD } from '../lib/money';

type Snapshot = {
  ok: boolean;
  generated_at: string;
  params: {
    limit: number;
    hold_age_seconds: number;
    topup_age_seconds: number;
  };
  summary: {
    accounts_count: number;
    balance_iqd_sum: number;
    held_iqd_sum: number;
    active_holds_iqd_sum: number;
    held_minus_active_holds: number;
  };
  issues: Record<string, any[]>;
};

async function fetchSnapshot(args: { limit: number; holdAgeSeconds: number; topupAgeSeconds: number }): Promise<Snapshot> {
  const { data, error } = await supabase.rpc('admin_wallet_integrity_snapshot', {
    p_limit: args.limit,
    p_hold_age_seconds: args.holdAgeSeconds,
    p_topup_age_seconds: args.topupAgeSeconds,
  });
  if (error) throw error;
  const out = data as unknown as Snapshot;
  if (!out?.ok) throw new Error('Snapshot failed');
  return out;
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="text-xs text-gray-500">{subtitle}</div> : null}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-sm text-gray-600">{text}</div>;
}

function JsonTable({ rows, keys }: { rows: any[]; keys: string[] }) {
  if (!rows || rows.length === 0) return <EmptyState text="No issues found." />;
  return (
    <div className="overflow-auto rounded-xl border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600">
          <tr>
            {keys.map((k) => (
              <th key={k} className="px-3 py-2 text-left font-medium whitespace-nowrap">{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, idx) => (
            <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {keys.map((k) => (
                <td key={k} className="px-3 py-2 align-top whitespace-nowrap">
                  <Cell value={(r as any)?.[k]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-gray-400">—</span>;
  if (typeof value === 'boolean') return <span>{value ? 'true' : 'false'}</span>;
  if (typeof value === 'number') return <span>{String(value)}</span>;
  if (typeof value === 'string') return <span className="font-mono text-xs">{value}</span>;
  return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
}

export default function AdminIntegrityPage() {
  const adminQ = useQuery({ queryKey: ['is_admin'], queryFn: getIsAdmin });

  const [limit, setLimit] = React.useState(50);
  const [holdAgeSeconds, setHoldAgeSeconds] = React.useState(3600);
  const [topupAgeSeconds, setTopupAgeSeconds] = React.useState(600);

  const snapshotQ = useQuery({
    queryKey: ['admin_wallet_integrity_snapshot', { limit, holdAgeSeconds, topupAgeSeconds }],
    queryFn: () => fetchSnapshot({ limit, holdAgeSeconds, topupAgeSeconds }),
    enabled: adminQ.data === true,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const snap = snapshotQ.data;
  const err = snapshotQ.error ? errorText(snapshotQ.error) : null;

  const issues = snap?.issues ?? {};
  const activeHoldsOld = issues.active_holds_old ?? [];
  const activeHoldsTerminalRide = issues.active_holds_terminal_ride ?? [];
  const completedMissingEntries = issues.completed_rides_missing_entries ?? [];
  const heldMismatch = issues.held_iqd_mismatch ?? [];
  const topupSucceededMissing = issues.topup_succeeded_missing_entry ?? [];
  const topupStuckPending = issues.topup_stuck_pending ?? [];

  return (
    <div className="space-y-4">
      <AdminNav />

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-semibold">Wallet Integrity</div>
            <div className="text-xs text-gray-500">Detect and diagnose wallet / rides / top-ups inconsistencies.</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-600">
              Limit
              <input
                className="ml-2 w-20 rounded-xl border border-gray-200 px-2 py-1 text-sm"
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(200, Number(e.target.value) || 50)))}
                type="number"
                min={1}
                max={200}
              />
            </label>
            <label className="text-xs text-gray-600">
              Hold age (sec)
              <input
                className="ml-2 w-28 rounded-xl border border-gray-200 px-2 py-1 text-sm"
                value={holdAgeSeconds}
                onChange={(e) => setHoldAgeSeconds(Math.max(60, Number(e.target.value) || 3600))}
                type="number"
                min={60}
              />
            </label>
            <label className="text-xs text-gray-600">
              Top-up age (sec)
              <input
                className="ml-2 w-28 rounded-xl border border-gray-200 px-2 py-1 text-sm"
                value={topupAgeSeconds}
                onChange={(e) => setTopupAgeSeconds(Math.max(30, Number(e.target.value) || 600))}
                type="number"
                min={30}
              />
            </label>
            <button
              className="rounded-xl bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-60"
              onClick={() => void snapshotQ.refetch()}
              type="button"
              disabled={snapshotQ.isFetching}
            >
              {snapshotQ.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {adminQ.isLoading ? <div className="mt-3 text-sm text-gray-600">Checking admin…</div> : null}
        {adminQ.data === false ? <div className="mt-3 text-sm text-red-700">Admin access required.</div> : null}
        {err ? <div className="mt-3 text-sm text-red-700">{err}</div> : null}
        {snap ? <div className="mt-2 text-xs text-gray-500">Generated: {new Date(snap.generated_at).toLocaleString()}</div> : null}
      </div>

      {snap ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatCard label="Wallet accounts" value={snap.summary.accounts_count} />
          <StatCard label="Total balance" value={formatIQD(snap.summary.balance_iqd_sum)} />
          <StatCard label="Total held" value={formatIQD(snap.summary.held_iqd_sum)} />
          <StatCard label="Active holds sum" value={formatIQD(snap.summary.active_holds_iqd_sum)} />
          <StatCard label="Held − active holds" value={formatIQD(snap.summary.held_minus_active_holds)} />
          <StatCard
            label="Issues (total)"
            value={
              activeHoldsOld.length +
              activeHoldsTerminalRide.length +
              completedMissingEntries.length +
              heldMismatch.length +
              topupSucceededMissing.length +
              topupStuckPending.length
            }
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4">
        <Section title={`Active holds older than threshold (${activeHoldsOld.length})`} subtitle="Usually indicates a stuck ride flow, webhook drift, or missing release/capture.">
          <JsonTable rows={activeHoldsOld} keys={['hold_id', 'user_id', 'ride_id', 'amount_iqd', 'created_at', 'updated_at']} />
        </Section>

        <Section title={`Active holds on terminal rides (${activeHoldsTerminalRide.length})`} subtitle="Rides already completed/canceled but hold is still active.">
          <JsonTable rows={activeHoldsTerminalRide} keys={['hold_id', 'user_id', 'ride_id', 'amount_iqd', 'ride_status', 'ride_updated_at', 'created_at']} />
        </Section>

        <Section title={`Completed rides missing ledger entries (${completedMissingEntries.length})`} subtitle="Missing rider debit and/or driver credit wallet_entries for completed rides.">
          <JsonTable rows={completedMissingEntries} keys={['ride_id', 'rider_id', 'driver_id', 'completed_at', 'missing_rider_debit', 'missing_driver_credit', 'hold_id']} />
        </Section>

        <Section title={`Held amount mismatch (${heldMismatch.length})`} subtitle="wallet_accounts.held_iqd should match sum(active holds) for each user.">
          <JsonTable rows={heldMismatch} keys={['user_id', 'held_iqd', 'holds_active', 'diff']} />
        </Section>

        <Section title={`Succeeded top-ups missing ledger entry (${topupSucceededMissing.length})`} subtitle="Top-up intent succeeded but wallet_entries idempotency key is missing.">
          <JsonTable rows={topupSucceededMissing} keys={['intent_id', 'user_id', 'provider_code', 'provider_tx_id', 'amount_iqd', 'bonus_iqd', 'completed_at']} />
        </Section>

        <Section title={`Stuck top-ups (${topupStuckPending.length})`} subtitle="Top-ups stuck in created/pending beyond threshold.">
          <JsonTable rows={topupStuckPending} keys={['intent_id', 'user_id', 'provider_code', 'status', 'provider_tx_id', 'created_at', 'updated_at']} />
        </Section>
      </div>
    </div>
  );
}

import React from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { getIsAdmin } from '../lib/admin';
import { errorText } from '../lib/errors';
import AdminNav from '../components/AdminNav';
import { formatIQD } from '../lib/money';

type ProviderRow = {
  code: string;
  name: string;
  kind: 'zaincash' | 'asiapay' | 'manual' | 'qicard';
  enabled: boolean;
  sort_order: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type PackageRow = {
  id: string;
  label: string;
  amount_iqd: number;
  bonus_iqd: number;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type TopupIntentRow = {
  id: string;
  user_id: string;
  provider_code: string;
  package_id: string | null;
  amount_iqd: number;
  bonus_iqd: number;
  status: 'created' | 'pending' | 'succeeded' | 'failed';
  provider_tx_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ProviderEventRow = {
  id: number;
  provider_code: string;
  provider_event_id: string;
  payload: Record<string, unknown>;
  received_at: string;
};

type WithdrawRequestRow = {
  id: string;
  user_id: string;
  amount_iqd: number;
  payout_kind: 'qicard' | 'asiapay' | 'zaincash';
  destination: any;
  status: string;
  note: string | null;
  payout_reference: string | null;
  created_at: string;
  approved_at?: string | null;
  paid_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
};

type WithdrawPolicyRow = {
  id: number;
  min_amount_iqd: number;
  max_amount_iqd: number;
  daily_cap_amount_iqd: number;
  daily_cap_count: number;
  require_kyc: boolean;
  require_driver_not_suspended: boolean;
  min_trips_count: number;
};

type WithdrawPayoutMethodRow = {
  payout_kind: 'qicard' | 'asiapay' | 'zaincash';
  enabled: boolean;
  updated_at?: string;
};

function statusPill(status: string) {
  const base = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs';
  const s = (status ?? '').toLowerCase();
  if (['succeeded', 'captured', 'paid', 'approved', 'completed'].includes(s)) return `${base} border-green-200 bg-green-50 text-green-800`;
  if (['failed', 'released', 'rejected', 'cancelled', 'canceled'].includes(s)) return `${base} border-red-200 bg-red-50 text-red-800`;
  if (['pending', 'created', 'requested', 'active'].includes(s)) return `${base} border-amber-200 bg-amber-50 text-amber-900`;
  return `${base} border-gray-200 bg-gray-50 text-gray-700`;
}

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function Section({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="text-xs text-gray-500">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

async function fetchProviders(): Promise<ProviderRow[]> {
  const { data, error } = await supabase
    .from('payment_providers')
    .select('code,name,kind,enabled,sort_order,config,created_at,updated_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data as unknown as ProviderRow[]) ?? [];
}

async function fetchPackages(): Promise<PackageRow[]> {
  const { data, error } = await supabase
    .from('topup_packages')
    .select('id,label,amount_iqd,bonus_iqd,active,sort_order,created_at,updated_at')
    .order('sort_order', { ascending: true })
    .order('amount_iqd', { ascending: true });
  if (error) throw error;
  return (data as unknown as PackageRow[]) ?? [];
}

async function fetchProviderEvents(): Promise<ProviderEventRow[]> {
  const { data, error } = await supabase
    .from('provider_events')
    .select('id,provider_code,provider_event_id,payload,received_at')
    .order('received_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as unknown as ProviderEventRow[]) ?? [];
}

async function fetchTopups(args: { page: number; pageSize: number; status: string; provider: string; userId: string }): Promise<{ rows: TopupIntentRow[]; count: number }> {
  let q = supabase
    .from('topup_intents')
    .select('id,user_id,provider_code,package_id,amount_iqd,bonus_iqd,status,provider_tx_id,failure_reason,created_at,updated_at,completed_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(args.page * args.pageSize, args.page * args.pageSize + args.pageSize - 1);

  if (args.status && args.status !== 'all') q = q.eq('status', args.status);
  if (args.provider && args.provider !== 'all') q = q.eq('provider_code', args.provider);
  if (args.userId?.trim()) q = q.eq('user_id', args.userId.trim());

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data as unknown as TopupIntentRow[]) ?? [], count: count ?? 0 };
}

async function fetchWithdrawRequests(args: { status: string }): Promise<WithdrawRequestRow[]> {
  let q = supabase
    .from('wallet_withdraw_requests')
    .select('id,user_id,amount_iqd,payout_kind,destination,status,note,payout_reference,created_at,approved_at,paid_at,rejected_at,cancelled_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (args.status !== 'all') q = q.eq('status', args.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as WithdrawRequestRow[]) ?? [];
}

async function fetchWithdrawPolicy(): Promise<WithdrawPolicyRow> {
  const { data, error } = await supabase.from('wallet_withdrawal_policy').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('withdrawal policy not found');
  return data as unknown as WithdrawPolicyRow;
}

async function fetchWithdrawPayoutMethods(): Promise<WithdrawPayoutMethodRow[]> {
  const { data, error } = await supabase
    .from('wallet_withdraw_payout_methods')
    .select('payout_kind,enabled,updated_at')
    .order('payout_kind', { ascending: true });
  if (error) throw error;
  return (data as unknown as WithdrawPayoutMethodRow[]) ?? [];
}

export default function AdminPaymentsPage() {
  const qc = useQueryClient();
  const adminQ = useQuery({ queryKey: ['is_admin'], queryFn: getIsAdmin });

  const [toast, setToast] = React.useState<string | null>(null);

  const providersQ = useQuery({ queryKey: ['admin_payment_providers'], queryFn: fetchProviders, enabled: adminQ.data === true });
  const packagesQ = useQuery({ queryKey: ['admin_topup_packages'], queryFn: fetchPackages, enabled: adminQ.data === true });
  const eventsQ = useQuery({ queryKey: ['admin_provider_events'], queryFn: fetchProviderEvents, enabled: adminQ.data === true });

  const [topupsPage, setTopupsPage] = React.useState(0);
  const [topupsPageSize] = React.useState(25);
  const [topupsStatus, setTopupsStatus] = React.useState('all');
  const [topupsProvider, setTopupsProvider] = React.useState('all');
  const [topupsUserId, setTopupsUserId] = React.useState('');

  const topupsQ = useQuery({
    queryKey: ['admin_topups', { topupsPage, topupsPageSize, topupsStatus, topupsProvider, topupsUserId }],
    queryFn: () => fetchTopups({ page: topupsPage, pageSize: topupsPageSize, status: topupsStatus, provider: topupsProvider, userId: topupsUserId }),
    enabled: adminQ.data === true,
    placeholderData: keepPreviousData,
  });

  const [withdrawStatus, setWithdrawStatus] = React.useState<'all' | 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled'>('requested');
  const withdrawsQ = useQuery({
    queryKey: ['admin_withdraw_requests', { withdrawStatus }],
    queryFn: () => fetchWithdrawRequests({ status: withdrawStatus }),
    enabled: adminQ.data === true,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });

  const withdrawPolicyQ = useQuery({ queryKey: ['admin_withdraw_policy'], queryFn: fetchWithdrawPolicy, enabled: adminQ.data === true });
  const withdrawMethodsQ = useQuery({ queryKey: ['admin_withdraw_methods'], queryFn: fetchWithdrawPayoutMethods, enabled: adminQ.data === true });

  const [configModal, setConfigModal] = React.useState<{ code: string; name: string; json: string } | null>(null);
  const [newPkgOpen, setNewPkgOpen] = React.useState(false);

  const providers = providersQ.data ?? [];
  const packages = packagesQ.data ?? [];
  const events = eventsQ.data ?? [];
  const withdrawPolicy = withdrawPolicyQ.data ?? null;
  const withdrawMethods = withdrawMethodsQ.data ?? [];

  async function updateProvider(code: string, patch: Partial<Pick<ProviderRow, 'enabled' | 'sort_order' | 'name' | 'config'>>) {
    const { error } = await supabase.from('payment_providers').update(patch).eq('code', code);
    if (error) throw error;
  }

  async function updatePackage(id: string, patch: Partial<Pick<PackageRow, 'label' | 'amount_iqd' | 'bonus_iqd' | 'active' | 'sort_order'>>) {
    const { error } = await supabase.from('topup_packages').update(patch).eq('id', id);
    if (error) throw error;
  }

  async function createPackage(pkg: Pick<PackageRow, 'label' | 'amount_iqd' | 'bonus_iqd' | 'active' | 'sort_order'>) {
    const { error } = await supabase.from('topup_packages').insert(pkg);
    if (error) throw error;
  }

  async function approveWithdraw(id: string) {
    try {
      const note = window.prompt('Approval note (optional):') ?? null;
      const { error } = await supabase.rpc('admin_withdraw_approve', { p_request_id: id, p_note: note });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ['admin_withdraw_requests'] });
      setToast('Approved withdrawal.');
      setTimeout(() => setToast(null), 1500);
    } catch (err: unknown) {
      setToast(errorText(err));
      setTimeout(() => setToast(null), 2500);
    }
  }

  async function rejectWithdraw(id: string) {
    try {
      const note = window.prompt('Rejection note (optional):') ?? null;
      const { error } = await supabase.rpc('admin_withdraw_reject', { p_request_id: id, p_note: note });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ['admin_withdraw_requests'] });
      setToast('Rejected withdrawal.');
      setTimeout(() => setToast(null), 1500);
    } catch (err: unknown) {
      setToast(errorText(err));
      setTimeout(() => setToast(null), 2500);
    }
  }

  async function markWithdrawPaid(id: string) {
    try {
      const ref = window.prompt('Payout reference (optional):') ?? null;
      const { error } = await supabase.rpc('admin_withdraw_mark_paid', { p_request_id: id, p_payout_reference: ref });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ['admin_withdraw_requests'] });
      setToast('Marked as paid.');
      setTimeout(() => setToast(null), 1500);
    } catch (err: unknown) {
      setToast(errorText(err));
      setTimeout(() => setToast(null), 2500);
    }
  }

  async function updateWithdrawPolicy(patch: Partial<WithdrawPolicyRow>) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const { error } = await supabase
      .from('wallet_withdrawal_policy')
      .update({ ...patch, updated_by: uid })
      .eq('id', 1);
    if (error) throw error;
  }

  async function setPayoutMethodEnabled(kind: WithdrawPayoutMethodRow['payout_kind'], enabled: boolean) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const { error } = await supabase
      .from('wallet_withdraw_payout_methods')
      .update({ enabled, updated_by: uid })
      .eq('payout_kind', kind);
    if (error) throw error;
  }

  if (adminQ.isLoading) {
    return (
      <div className="space-y-4">
        <AdminNav />
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-sm text-gray-600">Loading…</div>
      </div>
    );
  }

  if (adminQ.data !== true) {
    return (
      <div className="space-y-4">
        <AdminNav />
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold">Admin Payments</div>
          <div className="text-xs text-gray-500 mt-1">You don’t have access to this page.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AdminNav />

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-semibold">Payments & Wallet Ops</div>
            <div className="text-xs text-gray-500">Manage providers, packages, top-ups, and driver withdrawals.</div>
          </div>
          {toast ? <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">{toast}</div> : null}
        </div>
      </div>

      <Section
        title="Withdrawal settings"
        subtitle="Controls: enable/disable payout methods + min/max + daily caps + eligibility rules."
        actions={
          <>
            <button className="btn" onClick={() => void qc.invalidateQueries({ queryKey: ['admin_withdraw_policy'] })} disabled={withdrawPolicyQ.isLoading}>Refresh</button>
          </>
        }
      >
        {(withdrawMethodsQ.isLoading || withdrawPolicyQ.isLoading) ? <div className="text-sm text-gray-600">Loading…</div> : null}
        {(withdrawMethodsQ.error || withdrawPolicyQ.error) ? <div className="text-sm text-red-600">{errorText(withdrawMethodsQ.error ?? withdrawPolicyQ.error)}</div> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="text-xs text-gray-500 mb-2">Payout methods</div>
            <div className="space-y-2">
              {(['qicard', 'asiapay', 'zaincash'] as const).map((k) => {
                const row = withdrawMethods.find((m) => m.payout_kind === k);
                const enabled = row?.enabled ?? false;
                return (
                  <label key={k} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3">
                    <div>
                      <div className="text-sm font-medium">{k.toUpperCase()}</div>
                      <div className="text-xs text-gray-500">{enabled ? 'Enabled' : 'Disabled'} for new withdrawal requests.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={async (e) => {
                        try {
                          await setPayoutMethodEnabled(k, e.target.checked);
                          await qc.invalidateQueries({ queryKey: ['admin_withdraw_methods'] });
                        } catch (err: unknown) {
                          setToast(errorText(err));
                          setTimeout(() => setToast(null), 2500);
                        }
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-2">Limits & eligibility</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs">
                <div className="text-gray-500 mb-1">Min (IQD)</div>
                <input
                  className="input w-full"
                  type="number"
                  defaultValue={withdrawPolicy?.min_amount_iqd ?? 0}
                  onBlur={async (e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 0) return;
                    try {
                      await updateWithdrawPolicy({ min_amount_iqd: v });
                      await qc.invalidateQueries({ queryKey: ['admin_withdraw_policy'] });
                    } catch (err: unknown) {
                      setToast(errorText(err));
                      setTimeout(() => setToast(null), 2500);
                    }
                  }}
                />
                <div className="text-[11px] text-gray-500 mt-1">{formatIQD(withdrawPolicy?.min_amount_iqd ?? 0)}</div>
              </label>

              <label className="text-xs">
                <div className="text-gray-500 mb-1">Max (IQD)</div>
                <input
                  className="input w-full"
                  type="number"
                  defaultValue={withdrawPolicy?.max_amount_iqd ?? 0}
                  onBlur={async (e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v <= 0) return;
                    try {
                      await updateWithdrawPolicy({ max_amount_iqd: v });
                      await qc.invalidateQueries({ queryKey: ['admin_withdraw_policy'] });
                    } catch (err: unknown) {
                      setToast(errorText(err));
                      setTimeout(() => setToast(null), 2500);
                    }
                  }}
                />
                <div className="text-[11px] text-gray-500 mt-1">{formatIQD(withdrawPolicy?.max_amount_iqd ?? 0)}</div>
              </label>

              <label className="text-xs">
                <div className="text-gray-500 mb-1">Daily cap (amount)</div>
                <input
                  className="input w-full"
                  type="number"
                  defaultValue={withdrawPolicy?.daily_cap_amount_iqd ?? 0}
                  onBlur={async (e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 0) return;
                    try {
                      await updateWithdrawPolicy({ daily_cap_amount_iqd: v });
                      await qc.invalidateQueries({ queryKey: ['admin_withdraw_policy'] });
                    } catch (err: unknown) {
                      setToast(errorText(err));
                      setTimeout(() => setToast(null), 2500);
                    }
                  }}
                />
                <div className="text-[11px] text-gray-500 mt-1">{formatIQD(withdrawPolicy?.daily_cap_amount_iqd ?? 0)}</div>
              </label>

              <label className="text-xs">
                <div className="text-gray-500 mb-1">Daily cap (count)</div>
                <input
                  className="input w-full"
                  type="number"
                  defaultValue={withdrawPolicy?.daily_cap_count ?? 0}
                  onBlur={async (e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 0) return;
                    try {
                      await updateWithdrawPolicy({ daily_cap_count: v });
                      await qc.invalidateQueries({ queryKey: ['admin_withdraw_policy'] });
                    } catch (err: unknown) {
                      setToast(errorText(err));
                      setTimeout(() => setToast(null), 2500);
                    }
                  }}
                />
              </label>
            </div>

            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  defaultChecked={!!withdrawPolicy?.require_kyc}
                  onChange={async (e) => {
                    try {
                      await updateWithdrawPolicy({ require_kyc: e.target.checked });
                      await qc.invalidateQueries({ queryKey: ['admin_withdraw_policy'] });
                    } catch (err: unknown) {
                      setToast(errorText(err));
                      setTimeout(() => setToast(null), 2500);
                    }
                  }}
                />
                Require KYC (profile_kyc.status = verified)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  defaultChecked={!!withdrawPolicy?.require_driver_not_suspended}
                  onChange={async (e) => {
                    try {
                      await updateWithdrawPolicy({ require_driver_not_suspended: e.target.checked });
                      await qc.invalidateQueries({ queryKey: ['admin_withdraw_policy'] });
                    } catch (err: unknown) {
                      setToast(errorText(err));
                      setTimeout(() => setToast(null), 2500);
                    }
                  }}
                />
                Require driver not suspended
              </label>
              <label className="text-xs">
                <div className="text-gray-500 mb-1">Min trips completed</div>
                <input
                  className="input w-40"
                  type="number"
                  defaultValue={withdrawPolicy?.min_trips_count ?? 0}
                  onBlur={async (e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 0) return;
                    try {
                      await updateWithdrawPolicy({ min_trips_count: v });
                      await qc.invalidateQueries({ queryKey: ['admin_withdraw_policy'] });
                    } catch (err: unknown) {
                      setToast(errorText(err));
                      setTimeout(() => setToast(null), 2500);
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Withdrawal requests"
        subtitle="Approve/reject requests and mark paid (captures hold + ledger debit)."
        actions={
          <>
            <label className="text-xs text-gray-600">
              Status
              <select className="input ml-2" value={withdrawStatus} onChange={(e) => setWithdrawStatus(e.target.value as any)}>
                {(['all', 'requested', 'approved', 'paid', 'rejected', 'cancelled'] as const).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <button className="btn" onClick={() => void qc.invalidateQueries({ queryKey: ['admin_withdraw_requests'] })} disabled={withdrawsQ.isLoading}>Refresh</button>
          </>
        }
      >
        {withdrawsQ.isLoading ? <div className="text-sm text-gray-600">Loading withdrawals…</div> : null}
        {withdrawsQ.error ? <div className="text-sm text-red-600">{errorText(withdrawsQ.error)}</div> : null}

        {(withdrawsQ.data ?? []).length === 0 && !withdrawsQ.isLoading ? <div className="text-sm text-gray-600">No withdrawal requests.</div> : null}

        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">User</th>
                <th className="px-3 py-2 text-left font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Method</th>
                <th className="px-3 py-2 text-left font-medium">Destination</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(withdrawsQ.data ?? []).map((w, idx) => {
                const dest = w.payout_kind === 'zaincash' ? w.destination?.wallet_number : w.payout_kind === 'qicard' ? w.destination?.card_number : w.destination?.account;
                return (
                  <tr key={w.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(w.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{shortId(w.user_id)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatIQD(w.amount_iqd)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{w.payout_kind.toUpperCase()}</td>
                    <td className="px-3 py-2 max-w-[320px] truncate font-mono text-xs" title={dest ? String(dest) : ''}>{dest ? String(dest) : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className={statusPill(w.status)}>{w.status}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {w.status === 'requested' ? (
                          <>
                            <button className="btn" onClick={() => void approveWithdraw(w.id)}>Approve</button>
                            <button className="btn" onClick={() => void rejectWithdraw(w.id)}>Reject</button>
                          </>
                        ) : null}
                        {w.status === 'approved' ? (
                          <>
                            <button className="btn" onClick={() => void markWithdrawPaid(w.id)}>Mark paid</button>
                            <button className="btn" onClick={() => void rejectWithdraw(w.id)}>Reject</button>
                          </>
                        ) : null}
                        {w.payout_reference ? <span className="text-xs text-gray-500">Ref: {w.payout_reference}</span> : null}
                      </div>
                      {w.note ? <div className="text-[11px] text-gray-600 mt-1">{w.note}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Payment providers"
        subtitle="Enable/disable providers and adjust ordering. Edit provider config JSON used by edge functions."
        actions={<button className="btn" onClick={() => void qc.invalidateQueries({ queryKey: ['admin_payment_providers'] })} disabled={providersQ.isLoading}>Refresh</button>}
      >
        {providersQ.isLoading ? <div className="text-sm text-gray-600">Loading providers…</div> : null}
        {providersQ.error ? <div className="text-sm text-red-600">{errorText(providersQ.error)}</div> : null}

        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Code</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Enabled</th>
                <th className="px-3 py-2 text-left font-medium">Sort</th>
                <th className="px-3 py-2 text-left font-medium">Config</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p, idx) => (
                <tr key={p.code} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                  <td className="px-3 py-2">
                    <input
                      className="input w-full"
                      defaultValue={p.name}
                      onBlur={async (e) => {
                        const v = e.target.value.trim();
                        if (!v || v === p.name) return;
                        try {
                          await updateProvider(p.code, { name: v });
                          await qc.invalidateQueries({ queryKey: ['admin_payment_providers'] });
                        } catch (err: unknown) {
                          setToast(errorText(err));
                          setTimeout(() => setToast(null), 2500);
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!p.enabled}
                        onChange={async (e) => {
                          try {
                            await updateProvider(p.code, { enabled: e.target.checked });
                            await qc.invalidateQueries({ queryKey: ['admin_payment_providers'] });
                          } catch (err: unknown) {
                            setToast(errorText(err));
                            setTimeout(() => setToast(null), 2500);
                          }
                        }}
                      />
                      <span className="text-xs text-gray-600">{p.enabled ? 'On' : 'Off'}</span>
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input w-24"
                      type="number"
                      defaultValue={p.sort_order}
                      onBlur={async (e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v === p.sort_order) return;
                        try {
                          await updateProvider(p.code, { sort_order: v });
                          await qc.invalidateQueries({ queryKey: ['admin_payment_providers'] });
                        } catch (err: unknown) {
                          setToast(errorText(err));
                          setTimeout(() => setToast(null), 2500);
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className="btn"
                      onClick={() => {
                        const json = JSON.stringify(p.config ?? {}, null, 2);
                        setConfigModal({ code: p.code, name: p.name, json });
                      }}
                    >
                      Edit JSON
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Top-up packages"
        subtitle="Manage wallet top-up offers (1 point = 1 IQD)."
        actions={
          <>
            <button className="btn" onClick={() => setNewPkgOpen(true)}>New package</button>
            <button className="btn" onClick={() => void qc.invalidateQueries({ queryKey: ['admin_topup_packages'] })} disabled={packagesQ.isLoading}>Refresh</button>
          </>
        }
      >
        {packagesQ.isLoading ? <div className="text-sm text-gray-600">Loading packages…</div> : null}
        {packagesQ.error ? <div className="text-sm text-red-600">{errorText(packagesQ.error)}</div> : null}

        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Label</th>
                <th className="px-3 py-2 text-left font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Bonus</th>
                <th className="px-3 py-2 text-left font-medium">Active</th>
                <th className="px-3 py-2 text-left font-medium">Sort</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg, idx) => (
                <tr key={pkg.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2">
                    <input
                      className="input w-full"
                      defaultValue={pkg.label}
                      onBlur={async (e) => {
                        const v = e.target.value.trim();
                        if (!v || v === pkg.label) return;
                        try {
                          await updatePackage(pkg.id, { label: v });
                          await qc.invalidateQueries({ queryKey: ['admin_topup_packages'] });
                        } catch (err: unknown) {
                          setToast(errorText(err));
                          setTimeout(() => setToast(null), 2500);
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input w-32"
                      type="number"
                      defaultValue={pkg.amount_iqd}
                      onBlur={async (e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v <= 0 || v === pkg.amount_iqd) return;
                        try {
                          await updatePackage(pkg.id, { amount_iqd: v });
                          await qc.invalidateQueries({ queryKey: ['admin_topup_packages'] });
                        } catch (err: unknown) {
                          setToast(errorText(err));
                          setTimeout(() => setToast(null), 2500);
                        }
                      }}
                    />
                    <div className="text-[11px] text-gray-500 mt-1">{formatIQD(pkg.amount_iqd)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input w-28"
                      type="number"
                      defaultValue={pkg.bonus_iqd}
                      onBlur={async (e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v < 0 || v === pkg.bonus_iqd) return;
                        try {
                          await updatePackage(pkg.id, { bonus_iqd: v });
                          await qc.invalidateQueries({ queryKey: ['admin_topup_packages'] });
                        } catch (err: unknown) {
                          setToast(errorText(err));
                          setTimeout(() => setToast(null), 2500);
                        }
                      }}
                    />
                    <div className="text-[11px] text-gray-500 mt-1">{formatIQD(pkg.bonus_iqd)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!pkg.active}
                        onChange={async (e) => {
                          try {
                            await updatePackage(pkg.id, { active: e.target.checked });
                            await qc.invalidateQueries({ queryKey: ['admin_topup_packages'] });
                          } catch (err: unknown) {
                            setToast(errorText(err));
                            setTimeout(() => setToast(null), 2500);
                          }
                        }}
                      />
                      <span className="text-xs text-gray-600">{pkg.active ? 'On' : 'Off'}</span>
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input w-24"
                      type="number"
                      defaultValue={pkg.sort_order}
                      onBlur={async (e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v === pkg.sort_order) return;
                        try {
                          await updatePackage(pkg.id, { sort_order: v });
                          await qc.invalidateQueries({ queryKey: ['admin_topup_packages'] });
                        } catch (err: unknown) {
                          setToast(errorText(err));
                          setTimeout(() => setToast(null), 2500);
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Top-up intents" subtitle="Operational view of recent top-ups. (Read-only)">
        <div className="flex gap-3 flex-wrap items-end">
          <label className="text-xs">
            <div className="text-gray-500 mb-1">Status</div>
            <select className="input" value={topupsStatus} onChange={(e) => { setTopupsPage(0); setTopupsStatus(e.target.value); }}>
              {['all', 'created', 'pending', 'succeeded', 'failed'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <div className="text-gray-500 mb-1">Provider</div>
            <select className="input" value={topupsProvider} onChange={(e) => { setTopupsPage(0); setTopupsProvider(e.target.value); }}>
              <option value="all">all</option>
              {providers.map((p) => (
                <option key={p.code} value={p.code}>{p.code}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <div className="text-gray-500 mb-1">User ID (exact)</div>
            <input className="input" value={topupsUserId} onChange={(e) => { setTopupsPage(0); setTopupsUserId(e.target.value); }} placeholder="uuid" />
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn" onClick={() => setTopupsPage((p) => Math.max(0, p - 1))} disabled={topupsPage === 0 || topupsQ.isLoading}>Prev</button>
            <button className="btn" onClick={() => setTopupsPage((p) => p + 1)} disabled={topupsQ.isLoading || (topupsQ.data && (topupsPage + 1) * topupsPageSize >= topupsQ.data.count)}>Next</button>
            <button className="btn" onClick={() => void qc.invalidateQueries({ queryKey: ['admin_topups'] })} disabled={topupsQ.isLoading}>Refresh</button>
          </div>
        </div>

        {topupsQ.isLoading ? <div className="text-sm text-gray-600 mt-3">Loading…</div> : null}
        {topupsQ.error ? <div className="text-sm text-red-600 mt-3">{errorText(topupsQ.error)}</div> : null}

        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">User</th>
                <th className="px-3 py-2 text-left font-medium">Provider</th>
                <th className="px-3 py-2 text-left font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {(topupsQ.data?.rows ?? []).map((t, idx) => {
                const total = (t.amount_iqd ?? 0) + (t.bonus_iqd ?? 0);
                return (
                  <tr key={t.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{shortId(t.user_id)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{t.provider_code.toUpperCase()}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatIQD(total)}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className={statusPill(t.status)}>{t.status}</span></td>
                    <td className="px-3 py-2 max-w-[420px] truncate text-xs" title={t.failure_reason ?? ''}>
                      {t.provider_tx_id ? <span className="text-gray-700">tx: {t.provider_tx_id}</span> : <span className="text-gray-400">—</span>}
                      {t.failure_reason ? <span className="text-red-700"> • {t.failure_reason}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Provider events" subtitle="Recent provider events stored in provider_events.">
        {eventsQ.isLoading ? <div className="text-sm text-gray-600">Loading events…</div> : null}
        {eventsQ.error ? <div className="text-sm text-red-600">{errorText(eventsQ.error)}</div> : null}

        {(events ?? []).length === 0 && !eventsQ.isLoading ? <div className="text-sm text-gray-600">No events.</div> : null}

        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Provider</th>
                <th className="px-3 py-2 text-left font-medium">Event ID</th>
                <th className="px-3 py-2 text-left font-medium">Payload</th>
              </tr>
            </thead>
            <tbody>
              {(events ?? []).slice(0, 100).map((ev, idx) => (
                <tr key={ev.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(ev.received_at).toLocaleString()}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{ev.provider_code.toUpperCase()}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{ev.provider_event_id}</td>
                  <td className="px-3 py-2">
                    <details>
                      <summary className="cursor-pointer text-xs text-gray-700">View JSON</summary>
                      <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 overflow-auto max-h-[240px]">{JSON.stringify(ev.payload ?? {}, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {configModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfigModal(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Edit config — {configModal.name}</div>
                <div className="text-xs text-gray-500">Provider code: <span className="font-mono">{configModal.code}</span></div>
              </div>
              <button className="btn" onClick={() => setConfigModal(null)}>Close</button>
            </div>
            <textarea
              className="mt-3 w-full rounded-xl border border-gray-200 p-3 font-mono text-xs h-[360px]"
              value={configModal.json}
              onChange={(e) => setConfigModal((m) => (m ? { ...m, json: e.target.value } : m))}
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const parsed = JSON.parse(configModal.json || '{}');
                    await updateProvider(configModal.code, { config: parsed });
                    await qc.invalidateQueries({ queryKey: ['admin_payment_providers'] });
                    setToast('Saved provider config.');
                    setTimeout(() => setToast(null), 1500);
                    setConfigModal(null);
                  } catch (err: unknown) {
                    setToast(errorText(err));
                    setTimeout(() => setToast(null), 2500);
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {newPkgOpen ? (
        <NewPackageModal
          onClose={() => setNewPkgOpen(false)}
          onCreate={async (pkg) => {
            try {
              await createPackage(pkg);
              await qc.invalidateQueries({ queryKey: ['admin_topup_packages'] });
              setToast('Created package.');
              setTimeout(() => setToast(null), 1500);
              setNewPkgOpen(false);
            } catch (err: unknown) {
              setToast(errorText(err));
              setTimeout(() => setToast(null), 2500);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function NewPackageModal({ onClose, onCreate }: { onClose: () => void; onCreate: (pkg: { label: string; amount_iqd: number; bonus_iqd: number; active: boolean; sort_order: number }) => void }) {
  const [label, setLabel] = React.useState('');
  const [amount, setAmount] = React.useState('10000');
  const [bonus, setBonus] = React.useState('0');
  const [sort, setSort] = React.useState('0');
  const [active, setActive] = React.useState(true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">New top-up package</div>
            <div className="text-xs text-gray-500">Create a new offer (1 point = 1 IQD).</div>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            <div className="text-gray-500 mb-1">Label</div>
            <input className="input w-full" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g., Starter" />
          </label>
          <label className="text-xs">
            <div className="text-gray-500 mb-1">Sort order</div>
            <input className="input w-full" type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
          </label>
          <label className="text-xs">
            <div className="text-gray-500 mb-1">Amount (IQD)</div>
            <input className="input w-full" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="text-xs">
            <div className="text-gray-500 mb-1">Bonus (IQD)</div>
            <input className="input w-full" type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} />
          </label>
          <label className="text-xs flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              const a = Number(amount);
              const b = Number(bonus);
              const s = Number(sort);
              if (!label.trim()) {
                alert('Label required');
                return;
              }
              if (!Number.isFinite(a) || a <= 0) {
                alert('Amount must be > 0');
                return;
              }
              if (!Number.isFinite(b) || b < 0) {
                alert('Bonus must be >= 0');
                return;
              }
              if (!Number.isFinite(s)) {
                alert('Sort order is invalid');
                return;
              }
              onCreate({ label: label.trim(), amount_iqd: a, bonus_iqd: b, active, sort_order: s });
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

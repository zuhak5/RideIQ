import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';
import { formatIQD, formatSignedIQD } from '../lib/money';

type WalletAccountRow = {
  user_id: string;
  balance_iqd: number;
  held_iqd: number;
  created_at: string;
  updated_at: string;
};

type WalletEntryRow = {
  id: number;
  user_id: string;
  kind: 'topup' | 'ride_fare' | 'adjustment' | 'withdrawal';
  delta_iqd: number;
  memo: string | null;
  source_type: string | null;
  source_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type WalletHoldRow = {
  id: string;
  user_id: string;
  ride_id: string | null;
  amount_iqd: number;
  status: 'active' | 'captured' | 'released';
  reason: string | null;
  created_at: string;
  updated_at?: string;
  captured_at: string | null;
  released_at: string | null;
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

type WithdrawRequestRow = {
  id: string;
  user_id: string;
  amount_iqd: number;
  payout_kind: 'qicard' | 'asiapay' | 'zaincash';
  destination: any;
  status: 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled' | string;
  note: string | null;
  payout_reference: string | null;
  created_at: string;
  approved_at?: string | null;
  paid_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
};

type ProviderRow = {
  code: string;
  name: string;
  enabled: boolean;
  sort_order: number;
};

type PackageRow = {
  id: string;
  label: string;
  amount_iqd: number;
  bonus_iqd: number;
  active: boolean;
  sort_order: number;
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
};

type UserNotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
};

type TabKey = 'balance' | 'holds' | 'transactions' | 'topups' | 'withdrawals' | 'notifications';

function submitPost(url: string, fields: Record<string, string>) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = url;
  form.style.display = 'none';

  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  setTimeout(() => form.remove(), 1000);
}

function statusPill(status: string) {
  const base = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs';
  const s = (status ?? '').toLowerCase();
  if (['succeeded', 'captured', 'paid', 'approved', 'completed'].includes(s)) return `${base} border-green-200 bg-green-50 text-green-800`;
  if (['failed', 'released', 'rejected', 'cancelled', 'canceled'].includes(s)) return `${base} border-red-200 bg-red-50 text-red-800`;
  if (['pending', 'active', 'created', 'requested', 'matched'].includes(s)) return `${base} border-amber-200 bg-amber-50 text-amber-900`;
  return `${base} border-gray-200 bg-gray-50 text-gray-700`;
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'px-3 py-2 rounded-xl bg-gray-900 text-white text-sm'
          : 'px-3 py-2 rounded-xl border border-gray-200 text-sm hover:bg-gray-50'
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function shortId(id: string | null | undefined) {
  if (!id) return '';
  return id.length > 10 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function normalizeIraqMobile(input: string): string {
  const raw = input.trim().replace(/\s+/g, '');
  // Keep server-side validation as the source of truth.
  // This normalization is for UX only.
  if (raw.startsWith('+964')) return raw;
  if (raw.startsWith('964')) return `+${raw}`;
  if (/^07\d{9}$/.test(raw)) return `+964${raw.slice(1)}`;
  if (/^7\d{9}$/.test(raw)) return `+964${raw}`;
  return raw;
}

async function fetchWalletAccount(): Promise<WalletAccountRow> {
  const { data, error } = await supabase.rpc('wallet_get_my_account');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Wallet account not found');
  return row as WalletAccountRow;
}

async function fetchEntries(): Promise<WalletEntryRow[]> {
  const { data, error } = await supabase
    .from('wallet_entries')
    .select('id,user_id,kind,delta_iqd,memo,source_type,source_id,metadata,created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data as unknown as WalletEntryRow[]) ?? [];
}

async function fetchHolds(): Promise<WalletHoldRow[]> {
  const { data, error } = await supabase
    .from('wallet_holds')
    .select('id,user_id,ride_id,amount_iqd,status,reason,created_at,updated_at,captured_at,released_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data as unknown as WalletHoldRow[]) ?? [];
}

async function fetchTopups(): Promise<TopupIntentRow[]> {
  const { data, error } = await supabase
    .from('topup_intents')
    .select('id,user_id,provider_code,package_id,amount_iqd,bonus_iqd,status,provider_tx_id,failure_reason,created_at,updated_at,completed_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data as unknown as TopupIntentRow[]) ?? [];
}

async function fetchProviders(): Promise<ProviderRow[]> {
  const { data, error } = await supabase
    .from('payment_providers')
    .select('code,name,enabled,sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data as unknown as ProviderRow[]) ?? [];
}

async function fetchPackages(): Promise<PackageRow[]> {
  const { data, error } = await supabase
    .from('topup_packages')
    .select('id,label,amount_iqd,bonus_iqd,active,sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('amount_iqd', { ascending: true });
  if (error) throw error;
  return (data as unknown as PackageRow[]) ?? [];
}

async function fetchWithdrawRequests(): Promise<WithdrawRequestRow[]> {
  const { data, error } = await supabase
    .from('wallet_withdraw_requests')
    .select('id,user_id,amount_iqd,payout_kind,destination,status,note,payout_reference,created_at,approved_at,paid_at,rejected_at,cancelled_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as unknown as WithdrawRequestRow[]) ?? [];
}

async function fetchWithdrawPolicy(): Promise<WithdrawPolicyRow> {
  const { data, error } = await supabase.from('wallet_withdrawal_policy').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as WithdrawPolicyRow;
}

async function fetchWithdrawPayoutMethods(): Promise<WithdrawPayoutMethodRow[]> {
  const { data, error } = await supabase
    .from('wallet_withdraw_payout_methods')
    .select('payout_kind,enabled')
    .order('payout_kind', { ascending: true });
  if (error) throw error;
  return (data as unknown as WithdrawPayoutMethodRow[]) ?? [];
}

async function fetchMyNotifications(): Promise<UserNotificationRow[]> {
  const { data, error } = await supabase
    .from('user_notifications')
    .select('id,user_id,kind,title,body,data,created_at,read_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as unknown as UserNotificationRow[]) ?? [];
}

export default function WalletPage() {
  const qc = useQueryClient();

  const [tab, setTab] = React.useState<TabKey>('balance');
  const [providerCode, setProviderCode] = React.useState('');
  const [packageId, setPackageId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const [withdrawKind, setWithdrawKind] = React.useState<'qicard' | 'asiapay' | 'zaincash'>('zaincash');
  const [withdrawDestination, setWithdrawDestination] = React.useState('');
  const [withdrawAmount, setWithdrawAmount] = React.useState('');
  const [withdrawBusy, setWithdrawBusy] = React.useState(false);
  const [withdrawErr, setWithdrawErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get('tab');
    if (t === 'balance' || t === 'holds' || t === 'transactions' || t === 'topups' || t === 'withdrawals' || t === 'notifications') {
      setTab(t);
    }

    const status = sp.get('status');
    const intentId = sp.get('intent_id');
    if (status && intentId) {
      setToast(`Top-up ${status} (intent ${shortId(intentId)})`);
      void qc.invalidateQueries({ queryKey: ['topup_intents'] });
      void qc.invalidateQueries({ queryKey: ['wallet_account'] });
    }
  }, [qc]);

  const walletQ = useQuery({
    queryKey: ['wallet_account'],
    queryFn: fetchWalletAccount,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const providersQ = useQuery({ queryKey: ['payment_providers'], queryFn: fetchProviders });
  const packagesQ = useQuery({ queryKey: ['topup_packages'], queryFn: fetchPackages });

  const entriesQ = useQuery({ queryKey: ['wallet_entries'], queryFn: fetchEntries, enabled: tab === 'transactions' });
  const topupsQ = useQuery({ queryKey: ['topup_intents'], queryFn: fetchTopups, enabled: tab === 'topups' });
  const holdsQ = useQuery({ queryKey: ['wallet_holds'], queryFn: fetchHolds, enabled: tab === 'holds' });
  const withdrawsQ = useQuery({ queryKey: ['wallet_withdraw_requests'], queryFn: fetchWithdrawRequests, enabled: tab === 'withdrawals' });
  const withdrawPolicyQ = useQuery({ queryKey: ['wallet_withdrawal_policy'], queryFn: fetchWithdrawPolicy });
  const withdrawMethodsQ = useQuery({ queryKey: ['wallet_withdraw_payout_methods'], queryFn: fetchWithdrawPayoutMethods });
  const notificationsQ = useQuery({ queryKey: ['user_notifications'], queryFn: fetchMyNotifications, enabled: tab === 'notifications' });

  // Realtime subscriptions for live wallet + withdraw + notifications updates.
  React.useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    async function setup() {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user || cancelled) return;

      const uid = user.id;
      channel = supabase
        .channel(`wallet:${uid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_accounts', filter: `user_id=eq.${uid}` }, () => {
          void qc.invalidateQueries({ queryKey: ['wallet_account'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_entries', filter: `user_id=eq.${uid}` }, () => {
          void qc.invalidateQueries({ queryKey: ['wallet_entries'] });
          void qc.invalidateQueries({ queryKey: ['wallet_account'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_holds', filter: `user_id=eq.${uid}` }, () => {
          void qc.invalidateQueries({ queryKey: ['wallet_holds'] });
          void qc.invalidateQueries({ queryKey: ['wallet_account'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'topup_intents', filter: `user_id=eq.${uid}` }, () => {
          void qc.invalidateQueries({ queryKey: ['topup_intents'] });
          void qc.invalidateQueries({ queryKey: ['wallet_account'] });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_withdraw_requests', filter: `user_id=eq.${uid}` }, (payload: any) => {
          void qc.invalidateQueries({ queryKey: ['wallet_withdraw_requests'] });
          void qc.invalidateQueries({ queryKey: ['wallet_account'] });
          void qc.invalidateQueries({ queryKey: ['wallet_holds'] });

          if (payload?.eventType === 'UPDATE') {
            const oldStatus = payload?.old?.status;
            const newStatus = payload?.new?.status;
            if (oldStatus && newStatus && oldStatus !== newStatus) {
              setToast(`Withdrawal ${String(newStatus)}`);
              setTimeout(() => setToast(null), 2000);
            }
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${uid}` }, (payload: any) => {
          void qc.invalidateQueries({ queryKey: ['user_notifications'] });
          const title = payload?.new?.title;
          if (title) {
            setToast(String(title));
            setTimeout(() => setToast(null), 2500);
          }
        });

      channel.subscribe();
    }

    void setup();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [qc]);

  const holdsSummary = React.useMemo(() => {
    const holds = holdsQ.data ?? [];
    let active = 0;
    let captured = 0;
    let released = 0;
    for (const h of holds) {
      const amt = Number(h.amount_iqd) || 0;
      if (h.status === 'active') active += amt;
      else if (h.status === 'captured') captured += amt;
      else if (h.status === 'released') released += amt;
    }
    return { active, captured, released, count: holds.length };
  }, [holdsQ.data]);

  const enabledProviders = (providersQ.data ?? []).filter((p) => p.enabled);
  React.useEffect(() => {
    if (!providerCode && enabledProviders.length > 0) setProviderCode(enabledProviders[0].code);
  }, [providerCode, enabledProviders]);

  React.useEffect(() => {
    if (!packageId && (packagesQ.data?.length ?? 0) > 0) setPackageId(packagesQ.data![0].id);
  }, [packageId, packagesQ.data]);

  const enabledWithdrawMethods = React.useMemo(
    () => (withdrawMethodsQ.data ?? []).filter((m) => m.enabled),
    [withdrawMethodsQ.data],
  );

  React.useEffect(() => {
    if (enabledWithdrawMethods.length > 0 && !enabledWithdrawMethods.some((m) => m.payout_kind === withdrawKind)) {
      setWithdrawKind(enabledWithdrawMethods[0].payout_kind);
    }
  }, [enabledWithdrawMethods, withdrawKind]);

  const selectedPackage = (packagesQ.data ?? []).find((p) => p.id === packageId) ?? null;
  const totalPoints = selectedPackage ? (selectedPackage.amount_iqd ?? 0) + (selectedPackage.bonus_iqd ?? 0) : 0;

  const acct = walletQ.data;
  const available = acct ? Math.max(0, (acct.balance_iqd ?? 0) - (acct.held_iqd ?? 0)) : 0;

  async function doTopup() {
    if (!providerCode) return setToast('Pick a payment method.');
    if (!packageId) return setToast('Pick a top-up package.');

    setBusy(true);
    setToast(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke('topup-create', {
        body: { provider_code: providerCode, package_id: packageId, idempotency_key: idempotencyKey },
      });
      if (error) throw error;

      const payload = data as unknown as {
        ok?: boolean;
        redirect_url?: string;
        post_url?: string;
        post_fields?: Record<string, string>;
        intent_id?: string;
        message?: string;
      };
      if (!payload?.ok) throw new Error(payload?.message ?? 'Top-up creation failed');

      await Promise.all([qc.invalidateQueries({ queryKey: ['topup_intents'] }), qc.invalidateQueries({ queryKey: ['wallet_account'] })]);

      if (payload.redirect_url) {
        window.location.href = payload.redirect_url;
        return;
      }
      if (payload.post_url && payload.post_fields) {
        submitPost(payload.post_url, payload.post_fields);
        return;
      }
      setToast(`Top-up intent created: ${payload.intent_id ?? ''}`);
    } catch (e: unknown) {
      setToast(`Error: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function makeIdempotencyKey() {
    try {
      return crypto.randomUUID();
    } catch {
      return `withdraw:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    }
  }

  async function doWithdraw() {
    setWithdrawErr(null);
    const amt = Number.parseInt(withdrawAmount, 10);
    if (!Number.isFinite(amt) || amt <= 0) return setWithdrawErr('Enter a valid amount.');
    const destValueRaw = withdrawDestination.trim();
    if (!destValueRaw) return setWithdrawErr('Enter destination details.');

    const policy = withdrawPolicyQ.data;
    if (policy) {
      if (amt < policy.min_amount_iqd) return setWithdrawErr(`Minimum withdrawal is ${formatIQD(policy.min_amount_iqd)}.`);
      if (amt > policy.max_amount_iqd) return setWithdrawErr(`Maximum withdrawal is ${formatIQD(policy.max_amount_iqd)}.`);
    }

    const destValue = withdrawKind === 'zaincash' ? normalizeIraqMobile(destValueRaw) : destValueRaw;

    const destination =
      withdrawKind === 'zaincash' ? { wallet_number: destValue } : withdrawKind === 'qicard' ? { card_number: destValue } : { account: destValue };

    setWithdrawBusy(true);
    try {
      const { error } = await supabase.rpc('wallet_request_withdraw', {
        p_amount_iqd: amt,
        p_payout_kind: withdrawKind,
        p_destination: destination,
        p_idempotency_key: makeIdempotencyKey(),
      });
      if (error) throw error;

      setToast('Withdrawal requested.');
      setWithdrawAmount('');
      setWithdrawDestination('');

      void qc.invalidateQueries({ queryKey: ['wallet_account'] });
      void qc.invalidateQueries({ queryKey: ['wallet_holds'] });
      void qc.invalidateQueries({ queryKey: ['wallet_withdraw_requests'] });
    } catch (e) {
      setWithdrawErr(errorText(e));
    } finally {
      setWithdrawBusy(false);
    }
  }

  async function doCancelWithdraw(id: string) {
    setWithdrawErr(null);
    setWithdrawBusy(true);
    try {
      const { error } = await supabase.rpc('wallet_cancel_withdraw', { p_request_id: id });
      if (error) throw error;

      setToast('Withdrawal cancelled.');
      void qc.invalidateQueries({ queryKey: ['wallet_account'] });
      void qc.invalidateQueries({ queryKey: ['wallet_holds'] });
      void qc.invalidateQueries({ queryKey: ['wallet_withdraw_requests'] });
    } catch (e) {
      setWithdrawErr(errorText(e));
    } finally {
      setWithdrawBusy(false);
    }
  }

  async function markNotificationRead(id: string) {
    try {
      const { error } = await supabase.rpc('user_notifications_mark_read', { p_notification_id: id });
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ['user_notifications'] });
    } catch (e) {
      setToast(errorText(e));
      setTimeout(() => setToast(null), 2500);
    }
  }

  async function markAllNotificationsRead() {
    try {
      const { error } = await supabase.rpc('user_notifications_mark_all_read');
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ['user_notifications'] });
    } catch (e) {
      setToast(errorText(e));
      setTimeout(() => setToast(null), 2500);
    }
  }

  const unreadCount = React.useMemo(() => (notificationsQ.data ?? []).filter((n) => !n.read_at).length, [notificationsQ.data]);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Wallet</div>
            <div className="text-sm text-gray-500 mt-1">Points-only credits (1 point = 1 IQD). All balance changes are recorded in the ledger.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <TabButton active={tab === 'balance'} onClick={() => setTab('balance')}>Balance</TabButton>
            <TabButton active={tab === 'holds'} onClick={() => setTab('holds')}>Holds</TabButton>
            <TabButton active={tab === 'transactions'} onClick={() => setTab('transactions')}>Transactions</TabButton>
            <TabButton active={tab === 'topups'} onClick={() => setTab('topups')}>Top-ups</TabButton>
            <TabButton active={tab === 'withdrawals'} onClick={() => setTab('withdrawals')}>Withdrawals</TabButton>
            <TabButton active={tab === 'notifications'} onClick={() => setTab('notifications')}>
              Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
            </TabButton>
          </div>
        </div>

        {toast ? <div className="mt-3 text-sm rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">{toast}</div> : null}
      </div>

      {tab === 'balance' ? (
        <div className="card p-5 space-y-4">
          {walletQ.isLoading ? <div className="text-sm text-gray-500">Loading wallet…</div> : null}
          {walletQ.error ? <div className="text-sm text-red-700">{errorText(walletQ.error)}</div> : null}

          {acct ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="text-xs text-gray-500">Total</div>
                <div className="text-xl font-semibold mt-1">{formatIQD(acct.balance_iqd)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="text-xs text-gray-500">Held</div>
                <div className="text-xl font-semibold mt-1">{formatIQD(acct.held_iqd)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="text-xs text-gray-500">Available</div>
                <div className="text-xl font-semibold mt-1">{formatIQD(available)}</div>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-gray-200 p-4">
            <div className="font-semibold">Top up</div>
            <div className="text-sm text-gray-500 mt-1">Choose a payment method and a package. You will be redirected to complete payment.</div>

            {providersQ.isLoading ? <div className="text-sm text-gray-500 mt-3">Loading providers…</div> : null}
            {providersQ.error ? <div className="text-sm text-red-700 mt-3">{errorText(providersQ.error)}</div> : null}

            {enabledProviders.length === 0 ? (
              <div className="mt-3 text-sm rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                No payment providers are enabled yet. An admin must enable providers in <span className="font-mono">payment_providers</span>.
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3 mt-3">
              <label className="text-sm">
                <div className="text-xs text-gray-500">Payment method</div>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
                  value={providerCode}
                  onChange={(e) => setProviderCode(e.target.value)}
                >
                  {enabledProviders.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm sm:col-span-2">
                <div className="text-xs text-gray-500">Package</div>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
                  value={packageId}
                  onChange={(e) => setPackageId(e.target.value)}
                >
                  {(packagesQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedPackage ? (
              <div className="mt-3 text-sm text-gray-700">
                Amount: <span className="font-semibold">{formatIQD(selectedPackage.amount_iqd)}</span>
                {selectedPackage.bonus_iqd > 0 ? (
                  <> + Bonus: <span className="font-semibold">{formatIQD(selectedPackage.bonus_iqd)}</span></>
                ) : null}
                {' '}= Total credited: <span className="font-semibold">{formatIQD(totalPoints)}</span>
              </div>
            ) : null}

            <div className="mt-4">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !providerCode || !packageId || enabledProviders.length === 0}
                onClick={() => void doTopup()}
              >
                {busy ? 'Redirecting…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'transactions' ? (
        <div className="card p-5 space-y-3">
          <div className="font-semibold">Transactions</div>
          {entriesQ.isLoading ? <div className="text-sm text-gray-500">Loading…</div> : null}
          {entriesQ.error ? <div className="text-sm text-red-700">{errorText(entriesQ.error)}</div> : null}

          {(entriesQ.data ?? []).length === 0 && !entriesQ.isLoading ? <div className="text-sm text-gray-500">No transactions yet.</div> : null}

          <div className="divide-y">
            {(entriesQ.data ?? []).map((e) => (
              <div key={e.id} className="py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{e.kind}{e.memo ? ` — ${e.memo}` : ''}</div>
                  <div className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString()}</div>
                  {e.source_type || e.source_id ? (
                    <div className="text-xs text-gray-500">Source: {e.source_type ?? '—'} {e.source_id ? `(${shortId(e.source_id)})` : ''}</div>
                  ) : null}
                </div>
                <div className={e.delta_iqd >= 0 ? 'text-sm font-semibold text-green-700' : 'text-sm font-semibold text-red-700'}>
                  {formatSignedIQD(e.delta_iqd)} ({formatIQD(e.delta_iqd)})
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'topups' ? (
        <div className="card p-5 space-y-3">
          <div className="font-semibold">Top-up history</div>
          {topupsQ.isLoading ? <div className="text-sm text-gray-500">Loading…</div> : null}
          {topupsQ.error ? <div className="text-sm text-red-700">{errorText(topupsQ.error)}</div> : null}

          {(topupsQ.data ?? []).length === 0 && !topupsQ.isLoading ? <div className="text-sm text-gray-500">No top-ups yet.</div> : null}

          <div className="divide-y">
            {(topupsQ.data ?? []).map((t) => {
              const total = (t.amount_iqd ?? 0) + (t.bonus_iqd ?? 0);
              return (
                <div key={t.id} className="py-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{t.provider_code.toUpperCase()} — {formatIQD(total)}</div>
                    <div className="text-xs text-gray-500">Intent {shortId(t.id)} • {new Date(t.created_at).toLocaleString()}</div>
                    {t.provider_tx_id ? <div className="text-xs text-gray-500">Provider tx: {t.provider_tx_id}</div> : null}
                    {t.failure_reason ? <div className="text-xs text-red-700">{t.failure_reason}</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={statusPill(t.status)}>{t.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === 'holds' ? (
        <div className="card p-5 space-y-3">
          <div className="font-semibold">Holds breakdown</div>
          {holdsQ.isLoading ? <div className="text-sm text-gray-500">Loading…</div> : null}
          {holdsQ.error ? <div className="text-sm text-red-700">{errorText(holdsQ.error)}</div> : null}

          {(holdsQ.data ?? []).length === 0 && !holdsQ.isLoading ? <div className="text-sm text-gray-500">No holds yet.</div> : null}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Active holds</div>
              <div className="text-sm font-semibold">{formatIQD(holdsSummary.active)}</div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Captured</div>
              <div className="text-sm font-semibold">{formatIQD(holdsSummary.captured)}</div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Released</div>
              <div className="text-sm font-semibold">{formatIQD(holdsSummary.released)}</div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Count</div>
              <div className="text-sm font-semibold">{holdsSummary.count}</div>
            </div>
          </div>

          <div className="divide-y">
            {(holdsQ.data ?? []).map((h) => (
              <div key={h.id} className="py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{formatIQD(h.amount_iqd)} {h.reason ? `— ${h.reason}` : ''}</div>
                  <div className="text-xs text-gray-500">Hold {shortId(h.id)} • {new Date(h.created_at).toLocaleString()}</div>
                  {h.ride_id ? <div className="text-xs text-gray-500">Ride: {shortId(h.ride_id)}</div> : null}
                  {h.captured_at ? <div className="text-xs text-gray-500">Captured: {new Date(h.captured_at).toLocaleString()}</div> : null}
                  {h.released_at ? <div className="text-xs text-gray-500">Released: {new Date(h.released_at).toLocaleString()}</div> : null}
                </div>
                <div>
                  <span className={statusPill(h.status)}>{h.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'withdrawals' ? (
        <div className="card p-5 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-semibold">Withdrawals</div>
              <div className="text-xs text-gray-500">Request a driver payout (admins review and mark as paid).</div>
            </div>
            {withdrawPolicyQ.data ? (
              <div className="text-xs text-gray-500">
                Limits: {formatIQD(withdrawPolicyQ.data.min_amount_iqd)} – {formatIQD(withdrawPolicyQ.data.max_amount_iqd)} • Daily cap: {formatIQD(withdrawPolicyQ.data.daily_cap_amount_iqd)} / {withdrawPolicyQ.data.daily_cap_count} requests
              </div>
            ) : null}
          </div>

          {withdrawMethodsQ.isLoading ? <div className="text-sm text-gray-500">Loading payout methods…</div> : null}
          {withdrawMethodsQ.error ? <div className="text-sm text-red-700">{errorText(withdrawMethodsQ.error)}</div> : null}

          {enabledWithdrawMethods.length === 0 && !withdrawMethodsQ.isLoading ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              No withdrawal payout methods are enabled right now.
            </div>
          ) : null}

          {withdrawErr ? <div className="text-sm text-red-700">{withdrawErr}</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <div className="text-xs text-gray-500">Amount (IQD)</div>
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                inputMode="numeric"
                placeholder="e.g., 15000"
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs text-gray-500">Payout method</div>
              <select
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
                value={withdrawKind}
                onChange={(e) => setWithdrawKind(e.target.value as any)}
                disabled={enabledWithdrawMethods.length === 0}
              >
                {enabledWithdrawMethods.map((m) => (
                  <option key={m.payout_kind} value={m.payout_kind}>
                    {m.payout_kind === 'zaincash' ? 'ZainCash' : m.payout_kind === 'qicard' ? 'QiCard' : 'AsiaPay'}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-gray-500">
                Destination {withdrawKind === 'zaincash' ? '(wallet number)' : withdrawKind === 'qicard' ? '(card number)' : '(account / reference)'}
              </div>
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={withdrawDestination}
                onChange={(e) => setWithdrawDestination(e.target.value)}
                placeholder={withdrawKind === 'zaincash' ? '+9647xxxxxxxxx or 07xxxxxxxxx' : withdrawKind === 'qicard' ? 'Digits only' : 'Account / reference'}
              />
              {withdrawKind === 'zaincash' ? <div className="text-xs text-gray-500">Tip: you can type 07xxxxxxxxx and it will normalize to +964…</div> : null}
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              className="btn btn-primary"
              disabled={withdrawBusy || enabledWithdrawMethods.length === 0}
              onClick={() => void doWithdraw()}
            >
              {withdrawBusy ? 'Submitting…' : 'Request withdrawal'}
            </button>
          </div>

          <div className="pt-2">
            <div className="font-medium">History</div>
            {withdrawsQ.isLoading ? <div className="text-sm text-gray-500">Loading…</div> : null}
            {withdrawsQ.error ? <div className="text-sm text-red-700">{errorText(withdrawsQ.error)}</div> : null}

            {(withdrawsQ.data ?? []).length === 0 && !withdrawsQ.isLoading ? <div className="text-sm text-gray-500">No withdrawal requests yet.</div> : null}

            <div className="divide-y">
              {(withdrawsQ.data ?? []).map((w) => {
                const dest =
                  w.payout_kind === 'zaincash'
                    ? w.destination?.wallet_number
                    : w.payout_kind === 'qicard'
                      ? w.destination?.card_number
                      : w.destination?.account ?? w.destination?.wallet_number;

                return (
                  <div key={w.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium">{formatIQD(w.amount_iqd)}</div>
                        <span className={statusPill(w.status)}>{w.status}</span>
                        <div className="text-xs text-gray-500">{new Date(w.created_at).toLocaleString()}</div>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {w.payout_kind.toUpperCase()} • {dest ? String(dest) : '—'}
                        {w.payout_reference ? ` • Ref: ${w.payout_reference}` : ''}
                      </div>
                      {w.note ? <div className="text-xs text-gray-600 mt-1">{w.note}</div> : null}
                    </div>

                    {w.status === 'requested' ? (
                      <button type="button" className="btn" onClick={() => void doCancelWithdraw(w.id)} disabled={withdrawBusy}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'notifications' ? (
        <div className="card p-5 space-y-3">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="font-semibold">Notifications</div>
              <div className="text-xs text-gray-500">Status updates for withdrawals (and future system messages).</div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => void qc.invalidateQueries({ queryKey: ['user_notifications'] })} disabled={notificationsQ.isLoading}>Refresh</button>
              <button className="btn" onClick={() => void markAllNotificationsRead()} disabled={notificationsQ.isLoading || unreadCount === 0}>Mark all read</button>
            </div>
          </div>

          {notificationsQ.isLoading ? <div className="text-sm text-gray-500">Loading…</div> : null}
          {notificationsQ.error ? <div className="text-sm text-red-700">{errorText(notificationsQ.error)}</div> : null}

          {(notificationsQ.data ?? []).length === 0 && !notificationsQ.isLoading ? <div className="text-sm text-gray-500">No notifications.</div> : null}

          <div className="divide-y">
            {(notificationsQ.data ?? []).map((n) => (
              <div key={n.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.body ? <div className="text-xs text-gray-600 mt-1">{n.body}</div> : null}
                  <div className="text-xs text-gray-500 mt-1">{new Date(n.created_at).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!n.read_at ? <span className="text-xs rounded-full border border-amber-200 bg-amber-50 text-amber-900 px-2 py-0.5">new</span> : null}
                  {!n.read_at ? (
                    <button className="btn" onClick={() => void markNotificationRead(n.id)}>Mark read</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

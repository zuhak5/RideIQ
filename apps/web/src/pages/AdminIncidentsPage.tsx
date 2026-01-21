import React from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';
import { getIsAdmin } from '../lib/admin';
import AdminNav from '../components/AdminNav';

type IncidentRow = {
  id: string;
  ride_id: string;
  reporter_id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'triaging' | 'resolved' | 'closed';
  category: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  resolution_note: string | null;
  reviewed_at: string | null;
};

async function fetchIncidents(params: {
  page: number;
  pageSize: number;
  status: string;
  severity: string;
}): Promise<{ rows: IncidentRow[]; count: number }> {
  const from = params.page * params.pageSize;
  const to = from + params.pageSize - 1;

  let q = supabase
    .from('ride_incidents')
    .select('id,ride_id,reporter_id,severity,status,category,description,created_at,updated_at,assigned_to,resolution_note,reviewed_at', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (params.status !== 'all') q = q.eq('status', params.status);
  if (params.severity !== 'all') q = q.eq('severity', params.severity);

  const { data, error, count } = await q.range(from, to);
  if (error) throw error;
  return { rows: (data as unknown as IncidentRow[]) ?? [], count: count ?? 0 };
}

async function adminUpdateIncident(args: {
  incident_id: string;
  status?: IncidentRow['status'];
  assigned_to?: string | null;
  resolution_note?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_update_ride_incident', {
    p_incident_id: args.incident_id,
    p_status: args.status ?? null,
    p_assigned_to: args.assigned_to ?? null,
    p_resolution_note: args.resolution_note ?? null,
  });
  if (error) throw error;
}

async function adminRecordRideRefund(rideId: string, amountCents?: number, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_record_ride_refund', {
    p_ride_id: rideId,
    p_refund_amount_iqd: amountCents ?? null,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export default function AdminIncidentsPage() {
  const qc = useQueryClient();
  const [toast, setToast] = React.useState<string | null>(null);

  const adminQ = useQuery({ queryKey: ['is_admin'], queryFn: getIsAdmin });

  const [page, setPage] = React.useState(0);
  const pageSize = 20;
  const [status, setStatus] = React.useState<string>('all');
  const [severity, setSeverity] = React.useState<string>('all');

  const incidentsQ = useQuery({
    queryKey: ['incidents_admin', { page, pageSize, status, severity }],
    queryFn: () => fetchIncidents({ page, pageSize, status, severity }),
    enabled: adminQ.data === true,
    placeholderData: keepPreviousData,
  });

  const [refundRideId, setRefundRideId] = React.useState<string | null>(null);
  const [refundAmount, setRefundAmount] = React.useState<string>('');
  const [refundReason, setRefundReason] = React.useState<string>('');

  if (adminQ.isLoading) return <div className="text-sm text-gray-600">Loading…</div>;
  if (!adminQ.data) return <div className="text-sm text-gray-600">Not authorized.</div>;

  return (
    <div className="space-y-4">
      <AdminNav />
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="flex gap-3 flex-wrap items-end">
            <label className="text-xs">
              <div className="text-gray-500 mb-1">Status</div>
              <select className="input" value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }}>
                {['all','open','triaging','resolved','closed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <div className="text-gray-500 mb-1">Severity</div>
              <select className="input" value={severity} onChange={(e) => { setPage(0); setSeverity(e.target.value); }}>
                {['all','low','medium','high','critical'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="text-xs text-gray-500">
            {incidentsQ.data ? (
              <span>Page {page + 1} · Showing {Math.min((page + 1) * pageSize, incidentsQ.data.count)} of {incidentsQ.data.count}</span>
            ) : null}
          </div>
        </div>
      </div>

      {toast ? <div className="rounded-xl bg-black text-white px-3 py-2 text-sm">{toast}</div> : null}

      {incidentsQ.isLoading ? (
        <div className="text-sm text-gray-600">Loading incidents…</div>
      ) : incidentsQ.isError ? (
        <div className="text-sm text-red-600">{errorText(incidentsQ.error)}</div>
      ) : (
        <div className="grid gap-3">
          {(incidentsQ.data?.rows ?? []).map((i) => (
            <div key={i.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-semibold">{i.category} <span className="text-gray-500 font-normal">· {i.severity}</span></div>
                  <div className="text-xs text-gray-500 mt-1">Ride: {i.ride_id}</div>
                  <div className="text-xs text-gray-500">Reporter: {i.reporter_id}</div>
                </div>

                <div className="flex gap-2 items-center flex-wrap">
                  <select
                    className="input"
                    value={i.status}
                    onChange={async (e) => {
                      try {
                        await adminUpdateIncident({ incident_id: i.id, status: e.target.value as IncidentRow['status'] });
                        await qc.invalidateQueries({ queryKey: ['incidents_admin'] });
                      } catch (err: unknown) {
                        setToast(errorText(err));
                        setTimeout(() => setToast(null), 2500);
                      }
                    }}
                  >
                    {(['open','triaging','resolved','closed'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>

                  <button
                    className="btn"
                    onClick={async () => {
                      try {
                        const { data: sess } = await supabase.auth.getSession();
                        const uid = sess.session?.user.id;
                        if (!uid) throw new Error('Not authenticated');
                        await adminUpdateIncident({ incident_id: i.id, assigned_to: uid });
                        await qc.invalidateQueries({ queryKey: ['incidents_admin'] });
                      } catch (err: unknown) {
                        setToast(errorText(err));
                        setTimeout(() => setToast(null), 2500);
                      }
                    }}
                  >
                    Assign to me
                  </button>

                  <button className="btn" onClick={() => setRefundRideId(i.ride_id)}>Refund</button>
                </div>
              </div>

              {i.description ? <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{i.description}</div> : null}

              <div className="mt-3">
                <label className="text-xs text-gray-500">Resolution note</label>
                <textarea
                  className="input mt-1"
                  rows={2}
                  defaultValue={i.resolution_note ?? ''}
                  placeholder="Add internal note…"
                  onBlur={async (e) => {
                    const v = e.target.value.trim();
                    try {
                      await adminUpdateIncident({ incident_id: i.id, resolution_note: v || null });
                    } catch (err: unknown) {
                      setToast(errorText(err));
                      setTimeout(() => setToast(null), 2500);
                    }
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button className="btn" disabled={page === 0 || incidentsQ.isLoading} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button>
        <button
          className="btn"
          disabled={incidentsQ.isLoading || !incidentsQ.data || (page + 1) * pageSize >= (incidentsQ.data?.count ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>

      {refundRideId ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl border border-gray-200">
            <div className="text-sm font-semibold mb-2">Create refund</div>
            <div className="text-xs text-gray-500 mb-3">Ride: {refundRideId}</div>

            <label className="text-xs text-gray-500">Amount (IQD, optional)</label>
            <input className="input mt-1" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="Leave blank for full refund" />

            <label className="text-xs text-gray-500 mt-3 block">Reason (optional)</label>
            <input className="input mt-1" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="e.g. service_issue" />

            <div className="mt-4 flex gap-2 justify-end">
              <button className="btn" onClick={() => { setRefundRideId(null); setRefundAmount(''); setRefundReason(''); }}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const amount = refundAmount.trim() ? Number(refundAmount.trim()) : undefined;
                    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) throw new Error('Invalid amount');
                    await adminRecordRideRefund(refundRideId, amount, refundReason.trim() || undefined);
                    setRefundRideId(null);
                    setRefundAmount('');
                    setRefundReason('');
                    setToast('Refund recorded');
                    setTimeout(() => setToast(null), 2500);
                    void qc.invalidateQueries({ queryKey: ['incidents_admin'] });
                  } catch (err: unknown) {
                    setToast(errorText(err));
                    setTimeout(() => setToast(null), 2500);
                  }
                }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

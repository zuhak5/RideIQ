import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';
import { formatIQD } from '../lib/money';

type RideRow = {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  paid_at: string | null;
  fare_amount_iqd: number;
  currency: string;
  rider_id: string;
  driver_id: string | null;
  ride_requests: { pickup_address: string | null; dropoff_address: string | null } | null;
  ride_receipts:
    | {
        base_fare_iqd: number;
        tax_iqd: number;
        tip_iqd: number;
        total_iqd: number;
        currency: string;
        generated_at: string;
        receipt_status: string;
        refunded_iqd: number;
        refunded_at: string | null;
      }
    | null;
};

type RatingRow = {
  ride_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

async function fetchRideHistory(): Promise<RideRow[]> {
  const { data: sess, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) throw sessErr;
  const uid = sess.session?.user.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('rides')
    .select(
      [
        'id,status,created_at,completed_at,paid_at,fare_amount_iqd,currency,rider_id,driver_id',
        'ride_requests(pickup_address,dropoff_address)',
        'ride_receipts(base_fare_iqd,tax_iqd,tip_iqd,total_iqd,currency,generated_at,receipt_status,refunded_iqd,refunded_at)',
      ].join(',')
    )
    .or(`rider_id.eq.${uid},driver_id.eq.${uid}`)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data as unknown as RideRow[]) ?? [];
}

async function fetchMyRatings(rideIds: string[]): Promise<Record<string, RatingRow>> {
  if (!rideIds.length) return {};
  const { data, error } = await supabase
    .from('ride_ratings')
    .select('ride_id,rating,comment,created_at')
    .in('ride_id', rideIds);
  if (error) throw error;

  const byId: Record<string, RatingRow> = {};
  for (const r of (data as unknown as RatingRow[]) ?? []) byId[r.ride_id] = r;
  return byId;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-green-50 text-green-700 border-green-200',
    in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
    arrived: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    assigned: 'bg-amber-50 text-amber-700 border-amber-200',
    canceled: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  const cls = map[status] ?? 'bg-gray-50 text-gray-700 border-gray-200';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>{status}</span>;
}

function RatingStars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={`h-8 w-8 rounded-lg border text-sm ${n <= value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200'}`}
          onClick={() => onChange(n)}
          type="button"
          aria-label={`${n} star`}
        >
          ★
        </button>
      ))}
    </div>
  );
}


export default function HistoryPage() {
  const qc = useQueryClient();
  const [toast, setToast] = React.useState<string | null>(null);

  const ridesQ = useQuery({ queryKey: ['ride_history'], queryFn: fetchRideHistory, staleTime: 10_000 });

  const rideIds = (ridesQ.data ?? []).map((r) => r.id);
  const ratingsQ = useQuery({
    queryKey: ['ride_ratings_my', rideIds.join(',')],
    queryFn: () => fetchMyRatings(rideIds),
    enabled: rideIds.length > 0,
    staleTime: 30_000,
  });

  const [rateRideId, setRateRideId] = React.useState<string | null>(null);
  const [ratingValue, setRatingValue] = React.useState<number>(5);
  const [ratingComment, setRatingComment] = React.useState<string>('');

  const [incidentRideId, setIncidentRideId] = React.useState<string | null>(null);
  const [incidentSeverity, setIncidentSeverity] = React.useState<'low' | 'medium' | 'high' | 'critical'>('low');
  const [incidentCategory, setIncidentCategory] = React.useState<string>('service');
  const [incidentDescription, setIncidentDescription] = React.useState<string>('');

  const closeToastSoon = () => setTimeout(() => setToast(null), 2500);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">History</div>
        <div className="text-xs text-gray-500">Your recent rides, receipts, ratings, and incidents.</div>
      </div>

      {toast ? <div className="rounded-2xl border border-gray-200 bg-white p-3 text-sm">{toast}</div> : null}

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        {ridesQ.isLoading ? <div className="text-sm text-gray-600">Loading…</div> : null}
        {ridesQ.error ? <div className="text-sm text-red-600">{errorText(ridesQ.error)}</div> : null}

        <div className="space-y-3">
          {(ridesQ.data ?? []).map((r) => {
            const rr = r.ride_receipts;
            const req = r.ride_requests;
            const myRating = ratingsQ.data?.[r.id];
            const title = `${req?.pickup_address ?? 'Pickup'} → ${req?.dropoff_address ?? 'Dropoff'}`;

            return (
              <div key={r.id} className="rounded-2xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">Ride: {r.id}</div>
                    <div className="text-xs text-gray-500">Created: {new Date(r.created_at).toLocaleString()}</div>
                    {r.completed_at ? <div className="text-xs text-gray-500">Completed: {new Date(r.completed_at).toLocaleString()}</div> : null}
                    {r.paid_at ? <div className="text-xs text-gray-500">Paid: {new Date(r.paid_at).toLocaleString()}</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={r.status} />
                    <div className="text-sm font-semibold">{formatIQD(r.fare_amount_iqd)}</div>
                  </div>
                </div>

                {rr ? (
                  <div className="mt-3 rounded-xl bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700">
                      <div>
                        <span className="text-gray-500">Receipt:</span> {rr.receipt_status}
                      </div>
                      <div>
                        <span className="text-gray-500">Total:</span> {formatIQD(rr.total_iqd)}
                      </div>
                      <div>
                        <span className="text-gray-500">Fare:</span> {formatIQD(rr.base_fare_iqd)}
                      </div>
                      <div>
                        <span className="text-gray-500">Tax:</span> {formatIQD(rr.tax_iqd)}
                      </div>
                      <div>
                        <span className="text-gray-500">Tip:</span> {formatIQD(rr.tip_iqd)}
                      </div>
                      {rr.generated_at ? (
                        <div>
                          <span className="text-gray-500">Generated:</span> {new Date(rr.generated_at).toLocaleString()}
                        </div>
                      ) : null}
                      {rr.refunded_iqd > 0 ? (
                        <div>
                          <span className="text-gray-500">Refunded:</span> {formatIQD(rr.refunded_iqd)}
                          {rr.refunded_at ? ` (${new Date(rr.refunded_at).toLocaleString()})` : ''}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn"
                    onClick={() => {
                      setRateRideId(r.id);
                      setRatingValue(myRating?.rating ?? 5);
                      setRatingComment(myRating?.comment ?? '');
                    }}
                  >
                    {myRating ? 'Edit rating' : 'Rate ride'}
                  </button>

                  <button
                    className="btn"
                    onClick={() => {
                      setIncidentRideId(r.id);
                      setIncidentSeverity('low');
                      setIncidentCategory('service');
                      setIncidentDescription('');
                    }}
                  >
                    Report incident
                  </button>
                </div>
              </div>
            );
          })}

          {!ridesQ.isLoading && (ridesQ.data?.length ?? 0) === 0 ? (
            <div className="text-sm text-gray-600">No rides yet.</div>
          ) : null}
        </div>
      </div>

      {/* Rating modal */}
      {rateRideId ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl border border-gray-200">
            <div className="text-sm font-semibold">Rate ride</div>
            <div className="text-xs text-gray-500 mb-3">Ride: {rateRideId}</div>

            <RatingStars value={ratingValue} onChange={setRatingValue} />

            <label className="text-xs text-gray-500 mt-3 block">Comment (optional)</label>
            <textarea className="input mt-1" rows={3} value={ratingComment} onChange={(e) => setRatingComment(e.target.value)} />

            <div className="mt-4 flex gap-2 justify-end">
              <button className="btn" onClick={() => setRateRideId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const { error } = await supabase.rpc('submit_ride_rating', {
                      p_ride_id: rateRideId,
                      p_rating: ratingValue,
                      p_comment: ratingComment.trim() || null,
                    });
                    if (error) throw error;
                    setToast('Rating saved');
                    closeToastSoon();
                    setRateRideId(null);
                    void qc.invalidateQueries({ queryKey: ['ride_ratings_my'] });
                  } catch (err: unknown) {
                    setToast(errorText(err));
                    closeToastSoon();
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Incident modal */}
      {incidentRideId ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl border border-gray-200">
            <div className="text-sm font-semibold">Report incident</div>
            <div className="text-xs text-gray-500 mb-3">Ride: {incidentRideId}</div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                <div className="text-gray-500 mb-1">Severity</div>
                <select className="input" value={incidentSeverity} onChange={(e) => setIncidentSeverity(e.target.value as any)}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </label>
              <label className="text-xs">
                <div className="text-gray-500 mb-1">Category</div>
                <input className="input" value={incidentCategory} onChange={(e) => setIncidentCategory(e.target.value)} />
              </label>
            </div>

            <label className="text-xs text-gray-500 mt-3 block">Description (optional)</label>
            <textarea className="input mt-1" rows={4} value={incidentDescription} onChange={(e) => setIncidentDescription(e.target.value)} />

            <div className="mt-4 flex gap-2 justify-end">
              <button className="btn" onClick={() => setIncidentRideId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const { error } = await supabase.rpc('create_ride_incident', {
                      p_ride_id: incidentRideId,
                      p_severity: incidentSeverity,
                      p_category: incidentCategory.trim() || 'service',
                      p_description: incidentDescription.trim() || null,
                    });
                    if (error) throw error;
                    setToast('Incident submitted');
                    closeToastSoon();
                    setIncidentRideId(null);
                  } catch (err: unknown) {
                    setToast(errorText(err));
                    closeToastSoon();
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

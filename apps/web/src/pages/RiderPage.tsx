import React from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';
import { formatIQD } from '../lib/money';

type RideRequestRow = {
  id: string;
  status: string;
  assigned_driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  created_at: string;
  matched_at: string | null;
  match_deadline: string | null;
  accepted_at: string | null;
  cancelled_at: string | null;
  quote_amount_iqd: number | null;
  currency: string | null;
};

type RideRow = {
  id: string;
  request_id: string;
  status: string;
  version: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  fare_amount_iqd: number | null;
  currency: string | null;
  paid_at: string | null;
};

async function getUid(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error('Not signed in');
  return data.user.id;
}

async function fetchRequests(): Promise<RideRequestRow[]> {
  const { data, error } = await supabase
    .from('ride_requests')
    .select(
      'id,status,assigned_driver_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,created_at,matched_at,match_deadline,accepted_at,cancelled_at,quote_amount_iqd,currency',
    )
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data as RideRequestRow[];
}

async function fetchRides(): Promise<RideRow[]> {
  const { data, error } = await supabase
    .from('rides')
    .select('id,request_id,status,version,created_at,started_at,completed_at,fare_amount_iqd,currency,paid_at')
    .neq('status', 'completed')
    .neq('status', 'canceled')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as RideRow[]) ?? [];
}

export default function RiderPage() {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const { data: requests, error, isLoading } = useQuery({
    queryKey: ['ride_requests'],
    queryFn: fetchRequests,
  });

  const rides = useQuery({
    queryKey: ['rides_rider'],
    queryFn: fetchRides,
  });

  const [pickupLat, setPickupLat] = React.useState('33.3152');
  const [pickupLng, setPickupLng] = React.useState('44.3661');
  const [dropoffLat, setDropoffLat] = React.useState('33.3120');
  const [dropoffLng, setDropoffLng] = React.useState('44.3770');
  const [pickupAddress, setPickupAddress] = React.useState('Pickup');
  const [dropoffAddress, setDropoffAddress] = React.useState('Dropoff');

  React.useEffect(() => {
    let reqSub: RealtimeChannel | null = null;
    let rideSub: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      try {
        const uid = await getUid();
        if (cancelled) return;

        // Only subscribe to rows belonging to this rider.
        reqSub = supabase
          .channel('rider-ride-requests')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'ride_requests', filter: `rider_id=eq.${uid}` },
            () => qc.invalidateQueries({ queryKey: ['ride_requests'] }),
          )
          .subscribe();

        rideSub = supabase
          .channel('rider-rides')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'rides', filter: `rider_id=eq.${uid}` },
            () => qc.invalidateQueries({ queryKey: ['rides_rider'] }),
          )
          .subscribe();
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
      if (reqSub) supabase.removeChannel(reqSub);
      if (rideSub) supabase.removeChannel(rideSub);
    };
  }, [qc]);

  const activeRide = (rides.data ?? [])[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Request a ride</div>
            <div className="text-sm text-gray-500 mt-1">Create a request, then trigger matching.</div>
          </div>

          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              if (!navigator.geolocation) {
                setToast('Geolocation not available in this browser.');
                return;
              }
              setBusy(true);
              setToast(null);
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  setPickupLat(String(pos.coords.latitude));
                  setPickupLng(String(pos.coords.longitude));
                  setToast('Pickup set to your current location.');
                  setBusy(false);
                },
                (err) => {
                  setToast(`Geolocation error: ${err.message}`);
                  setBusy(false);
                },
                { enableHighAccuracy: true, timeout: 10000 },
              );
            }}
          >
            Use my pickup
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Pickup address" value={pickupAddress} onChange={setPickupAddress} />
          <Field label="Dropoff address" value={dropoffAddress} onChange={setDropoffAddress} />

          <Field label="Pickup lat" value={pickupLat} onChange={setPickupLat} />
          <Field label="Pickup lng" value={pickupLng} onChange={setPickupLng} />

          <Field label="Dropoff lat" value={dropoffLat} onChange={setDropoffLat} />
          <Field label="Dropoff lng" value={dropoffLng} onChange={setDropoffLng} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setToast(null);
              try {
                const { data: u } = await supabase.auth.getUser();
                const uid = u.user?.id;
                if (!uid) throw new Error('Not authenticated');
                const { error } = await supabase.from('ride_requests').insert({
                  rider_id: uid,
                  pickup_address: pickupAddress,
                  dropoff_address: dropoffAddress,
                  pickup_lat: Number(pickupLat),
                  pickup_lng: Number(pickupLng),
                  dropoff_lat: Number(dropoffLat),
                  dropoff_lng: Number(dropoffLng),
                  currency: 'IQD',
                });
                if (error) throw error;
                setToast('Ride request created.');
                qc.invalidateQueries({ queryKey: ['ride_requests'] });
              } catch (e: unknown) {
                setToast(`Error: ${errorText(e)}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create request
          </button>
        </div>

        {toast && <div className="mt-3 text-sm text-gray-700">{toast}</div>}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Your requests</div>
            <div className="text-sm text-gray-500 mt-1">Matching + cancellation are per request.</div>
          </div>
          <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ['ride_requests'] })}>
            Refresh
          </button>
        </div>

        {isLoading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
        {error && <div className="mt-4 text-sm text-red-600">{errorText(error)}</div>}

		<div className="mt-4 space-y-3">
		  {(requests ?? []).map((rr) => {
		    const deadlineMs = rr.match_deadline ? new Date(rr.match_deadline).getTime() : null;
		    const secondsLeft = deadlineMs ? Math.max(0, Math.floor((deadlineMs - nowMs) / 1000)) : null;
		    const expiresLabel =
		      secondsLeft === null ? null : secondsLeft > 0 ? `expires in ${secondsLeft}s` : 'expired';
		    const matchActive = rr.status === 'matched' && secondsLeft !== null && secondsLeft > 0;
		    const canMatch =
		      rr.status === 'requested' ||
		      rr.status === 'no_driver' ||
		      rr.status === 'expired' ||
		      (rr.status === 'matched' && !matchActive);
		    const canCancel = ['requested', 'matched', 'no_driver', 'expired'].includes(rr.status);
		
		    return (
		      <div key={rr.id} className="border border-gray-200 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  {rr.pickup_address ?? 'Pickup'} → {rr.dropoff_address ?? 'Dropoff'}
                </div>
                <div className="text-xs text-gray-500">{new Date(rr.created_at).toLocaleString()}</div>
              </div>

		      <div className="mt-2 flex flex-wrap gap-2 items-center">
		        <Pill label={`status: ${rr.status}`} />
		        {typeof rr.quote_amount_iqd === 'number' && (
		          <Pill label={`quote: ${formatIQD(rr.quote_amount_iqd)}`} />
		        )}
		        {rr.assigned_driver_id && <Pill label={`driver: ${rr.assigned_driver_id.slice(0, 8)}…`} />}
		        {rr.matched_at && <Pill label={`matched: ${new Date(rr.matched_at).toLocaleTimeString()}`} />}
		        {expiresLabel && rr.status !== 'requested' && <Pill label={expiresLabel} />}
		        {rr.accepted_at && <Pill label={`accepted: ${new Date(rr.accepted_at).toLocaleTimeString()}`} />}
		      </div>

		      <div className="mt-3 flex flex-wrap gap-2">
		        <button
		          className="btn btn-primary"
		          disabled={busy || !canMatch}
		          title={matchActive ? 'A driver is already matched. Wait for acceptance or expiry.' : undefined}
                  onClick={async () => {
                    setBusy(true);
                    setToast(null);
                    try {
                      const { data, error } = await supabase.functions.invoke('match-ride', {
                        body: { request_id: rr.id, radius_m: 5000, limit_n: 20 },
                      });
                      if (error) throw error;
                      setToast(`Match result: ${JSON.stringify(data)}`);
                      qc.invalidateQueries({ queryKey: ['ride_requests'] });
                    } catch (e: unknown) {
                      setToast(`Error: ${errorText(e)}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
		        >
		          {matchActive ? 'Matched' : 'Find driver'}
		        </button>

		        <button
		          className="btn"
		          disabled={busy || !canCancel}
                  onClick={async () => {
                    setBusy(true);
                    setToast(null);
                    try {
                      const { error } = await supabase
                        .from('ride_requests')
                        .update({ status: 'cancelled' })
                        .eq('id', rr.id);
                      if (error) throw error;
                      setToast('Cancelled.');
                      qc.invalidateQueries({ queryKey: ['ride_requests'] });
                    } catch (e: unknown) {
                      setToast(`Error: ${errorText(e)}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
		        >
		          Cancel
		        </button>
		      </div>
		    </div>
		  );
		})}

          {(requests ?? []).length === 0 && !isLoading && <div className="text-sm text-gray-500">No requests yet.</div>}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Your rides</div>
            <div className="text-sm text-gray-500 mt-1">Updates live when a driver accepts or progresses the trip.</div>
          </div>
          <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ['rides_rider'] })}>
            Refresh
          </button>
        </div>

        {rides.isLoading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
        {rides.error && <div className="mt-4 text-sm text-red-600">{errorText(rides.error)}</div>}

        {activeRide ? (
          <div className="mt-4 border border-gray-200 rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Ride {activeRide.id.slice(0, 8)}…</div>
              <div className="flex items-center gap-2">
                <Pill label={`status: ${activeRide.status}`} />
                <Pill label={`v${activeRide.version}`} />
              </div>
            </div>
	            <div className="mt-2 text-xs text-gray-500">Created {new Date(activeRide.created_at).toLocaleString()}</div>
	            <div className="mt-2 text-xs text-gray-500">
	              {activeRide.started_at ? `started: ${new Date(activeRide.started_at).toLocaleTimeString()} ` : ''}
	              {activeRide.completed_at ? `completed: ${new Date(activeRide.completed_at).toLocaleTimeString()}` : ''}
	              {activeRide.fare_amount_iqd != null
	                ? ` • fare: ${formatIQD(activeRide.fare_amount_iqd)}`
	                : ''}
	              {activeRide.paid_at ? ` • paid: ${new Date(activeRide.paid_at).toLocaleTimeString()}` : ''}
	            </div>

            
{activeRide.status === 'completed' ? (
  <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
    <div className="text-sm font-semibold">Payment</div>
    <div className="text-xs text-gray-600 mt-1">
      Completed rides are settled automatically from your wallet balance.
      You can view the ledger in <span className="font-semibold">Wallet → Transactions</span>.
    </div>
    {!activeRide.paid_at ? (
      <div className="text-xs text-amber-800 mt-2">
        Settlement is pending. If this persists, refresh and check your wallet balance.
      </div>
    ) : (
      <div className="text-xs text-gray-600 mt-2">Paid at {new Date(activeRide.paid_at).toLocaleString()}</div>
    )}
  </div>
) : null}

            <div className="mt-3 text-sm text-gray-700">
              Rider UI is read-only for status progression in this MVP (driver progresses the trip).
            </div>
          </div>
        ) : (
          <div className="mt-4 text-sm text-gray-500">No rides yet.</div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return <div className="text-xs rounded-full bg-gray-100 border border-gray-200 px-2 py-1">{label}</div>;
}


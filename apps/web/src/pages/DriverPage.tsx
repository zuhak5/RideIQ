import React from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { errorText } from '../lib/errors';
import { formatIQD } from '../lib/money';

type DriverRow = {
  id: string;
  status: 'offline' | 'available' | 'reserved' | 'on_trip' | 'suspended';
  vehicle_type: string | null;
  rating_avg: number;
  trips_count: number;
};

type DriverVehicleRow = {
  id: string;
  driver_id: string;
  make: string | null;
  model: string | null;
  color: string | null;
  plate_number: string | null;
};

type RideRequestRow = {
  id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  created_at: string;
  matched_at: string | null;
  match_deadline: string | null;
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
};

async function getUid(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error('Not signed in');
  return data.user.id;
}

async function fetchDriver(): Promise<DriverRow | null> {
  const { data, error } = await supabase
    .from('drivers')
    .select('id,status,vehicle_type,rating_avg,trips_count')
    .maybeSingle();
  if (error) throw error;
  return (data as DriverRow) ?? null;
}

async function fetchVehicle(): Promise<DriverVehicleRow | null> {
  const { data, error } = await supabase
    .from('driver_vehicles')
    .select('id,driver_id,make,model,color,plate_number')
    .maybeSingle();
  if (error) throw error;
  return (data as DriverVehicleRow) ?? null;
}

async function fetchAssignedRequests(): Promise<RideRequestRow[]> {
  const uid = await getUid();
  const { data, error } = await supabase
    .from('ride_requests')
    .select('id,status,pickup_address,dropoff_address,created_at,matched_at,match_deadline')
    .eq('assigned_driver_id', uid)
    .eq('status', 'matched')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as RideRequestRow[];
}

async function fetchRides(): Promise<RideRow[]> {
  const uid = await getUid();
  const { data, error } = await supabase
    .from('rides')
    .select('id,request_id,status,version,created_at,started_at,completed_at,fare_amount_iqd,currency')
    .eq('driver_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as RideRow[];
}

type GeoState = {
  tracking: boolean;
  lastFixAt: number | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  error: string | null;
};

const allowedTransitions: Record<string, Set<string>> = {
  assigned: new Set(['arrived', 'canceled']),
  arrived: new Set(['in_progress', 'canceled']),
  in_progress: new Set(['completed', 'canceled']),
};

export default function DriverPage() {
  const qc = useQueryClient();
  const [toast, setToast] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  const driver = useQuery({ queryKey: ['driver'], queryFn: fetchDriver });
  const vehicle = useQuery({ queryKey: ['driver_vehicle'], queryFn: fetchVehicle, enabled: !!driver.data });
  const assigned = useQuery({ queryKey: ['assigned_requests'], queryFn: fetchAssignedRequests, enabled: !!driver.data });
  const rides = useQuery({ queryKey: ['rides_driver'], queryFn: fetchRides, enabled: !!driver.data });

  const [vehicleType, setVehicleType] = React.useState('car');
  const [make, setMake] = React.useState('');
  const [model, setModel] = React.useState('');
  const [color, setColor] = React.useState('');
  const [plate, setPlate] = React.useState('');

  const [geo, setGeo] = React.useState<GeoState>({
    tracking: false,
    lastFixAt: null,
    lat: null,
    lng: null,
    accuracyM: null,
    error: null,
  });

  React.useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Realtime updates for assigned requests + rides
  React.useEffect(() => {
    let reqSub: RealtimeChannel | null = null;
    let rideSub: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      try {
        const uid = await getUid();
        if (cancelled) return;

        reqSub = supabase
          .channel('driver-assigned-requests')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'ride_requests', filter: `assigned_driver_id=eq.${uid}` },
            () => qc.invalidateQueries({ queryKey: ['assigned_requests'] }),
          )
          .subscribe();

        rideSub = supabase
          .channel('driver-rides')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'rides', filter: `driver_id=eq.${uid}` },
            () => qc.invalidateQueries({ queryKey: ['rides_driver'] }),
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

  // Location tracking (throttled)
  React.useEffect(() => {
    if (!geo.tracking) return;
    if (!navigator.geolocation) {
      setGeo((s) => ({ ...s, tracking: false, error: 'Geolocation not supported by this browser.' }));
      return;
    }

    let watchId: number | null = null;
    let lastSentAt = 0;
    let stopped = false;

    const start = async () => {
      try {
        const uid = await getUid();
        if (stopped) return;

        watchId = navigator.geolocation.watchPosition(
          async (pos) => {
            const now = Date.now();
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const acc = pos.coords.accuracy ?? null;

            setGeo((s) => ({
              ...s,
              lat,
              lng,
              accuracyM: acc,
              lastFixAt: now,
              error: null,
            }));

            // Throttle writes (every 5s) to avoid hammering the DB.
            if (now - lastSentAt < 5000) return;
            lastSentAt = now;

            try {
              const { error } = await supabase.from('driver_locations').upsert({
                driver_id: uid,
                lat,
                lng,
                accuracy_m: acc ?? undefined,
                heading: pos.coords.heading ?? undefined,
                speed_mps: pos.coords.speed ?? undefined,
              });
              if (error) throw error;
            } catch (e: unknown) {
              // Don't stop tracking for transient errors, but surface a hint.
              setGeo((s) => ({ ...s, error: errorText(e) }));
            }
          },
          (err) => {
            setGeo((s) => ({ ...s, error: err.message }));
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
        );
      } catch (e: unknown) {
        setGeo((s) => ({ ...s, error: errorText(e), tracking: false }));
      }
    };

    start();

    return () => {
      stopped = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [geo.tracking]);

  const status = driver.data?.status ?? null;
  const isOnline = status === 'available' || status === 'reserved' || status === 'on_trip';
  const canToggleOnline = status === 'offline' || status === 'available';
  const toggleLabel =
    status === 'offline'
      ? 'Go online'
      : status === 'available'
        ? 'Go offline'
        : status === 'reserved'
          ? 'Reserved (matched)'
          : status === 'on_trip'
            ? 'On trip'
            : status === 'suspended'
              ? 'Suspended'
              : 'Status';

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="text-base font-semibold">Driver console</div>
        <div className="text-sm text-gray-500 mt-1">Onboard once, go online, track location, accept requests.</div>

        {driver.isLoading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
        {driver.error && <div className="mt-4 text-sm text-red-600">{errorText(driver.error)}</div>}

        {!driver.isLoading && driver.data === null && (
          <div className="mt-4">
            <div className="text-sm font-semibold">Become a driver</div>
            <div className="text-sm text-gray-500 mt-1">Add your vehicle details (MVP; expand with verification later).</div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Vehicle type" value={vehicleType} onChange={setVehicleType} />
              <Field label="Make" value={make} onChange={setMake} placeholder="Toyota" />
              <Field label="Model" value={model} onChange={setModel} placeholder="Camry" />
              <Field label="Color" value={color} onChange={setColor} placeholder="White" />
              <Field label="Plate" value={plate} onChange={setPlate} placeholder="123-ABC" />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setToast(null);
                  try {
                    const uid = await getUid();

                    const { error: dErr } = await supabase.from('drivers').insert({
                      id: uid,
                      status: 'offline',
                      vehicle_type: vehicleType,
                    });
                    if (dErr) throw dErr;

                    const { error: vErr } = await supabase.from('driver_vehicles').insert({
                      driver_id: uid,
                      make: make || null,
                      model: model || null,
                      color: color || null,
                      plate_number: plate || null,
                    });
                    if (vErr) throw vErr;

                    setToast('Driver profile created.');
                    qc.invalidateQueries({ queryKey: ['driver'] });
                    qc.invalidateQueries({ queryKey: ['driver_vehicle'] });
			  } catch (e: unknown) {
			    setToast(`Error: ${errorText(e)}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Create driver profile
              </button>
            </div>

            {toast && <div className="mt-3 text-sm text-gray-700">{toast}</div>}
          </div>
        )}

        {driver.data && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={`status: ${driver.data.status}`} />
              <Pill label={`rating: ${Number(driver.data.rating_avg).toFixed(2)}`} />
              <Pill label={`trips: ${driver.data.trips_count}`} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className={status === 'offline' ? 'btn btn-primary' : 'btn'}
                disabled={busy || !canToggleOnline}
                title={!canToggleOnline ? 'You cannot change availability while reserved / on trip.' : undefined}
                onClick={async () => {
                  setBusy(true);
                  setToast(null);
                  try {
                    const next = status === 'offline' ? 'available' : 'offline';
				    const { error } = await supabase.from('drivers').update({ status: next }).eq('id', driver.data!.id);
                    if (error) throw error;
                    setToast(next === 'available' ? 'You are online.' : 'You are offline.');
                    qc.invalidateQueries({ queryKey: ['driver'] });
			  } catch (e: unknown) {
			    setToast(`Error: ${errorText(e)}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {toggleLabel}
              </button>

              <button
                className="btn"
                disabled={!isOnline}
                onClick={() => setGeo((s) => ({ ...s, tracking: !s.tracking, error: null }))}
                title={!isOnline ? 'Go online first' : undefined}
              >
                {geo.tracking ? 'Stop location' : 'Start location'}
              </button>

              <div className="text-sm text-gray-500">
                {geo.lastFixAt ? (
                  <span>
                    last fix: {new Date(geo.lastFixAt).toLocaleTimeString()} {geo.accuracyM ? `(±${Math.round(geo.accuracyM)}m)` : ''}
                  </span>
                ) : (
                  <span>no location yet</span>
                )}
              </div>
            </div>

            {vehicle.data && (
              <div className="text-sm text-gray-600">
                Vehicle: {driver.data.vehicle_type ?? 'car'}
                {vehicle.data.make ? `, ${vehicle.data.make}` : ''}
                {vehicle.data.model ? ` ${vehicle.data.model}` : ''}
                {vehicle.data.color ? `, ${vehicle.data.color}` : ''}
                {vehicle.data.plate_number ? ` (${vehicle.data.plate_number})` : ''}
              </div>
            )}

            {geo.error && <div className="text-sm text-red-600">{geo.error}</div>}
            {toast && <div className="text-sm text-gray-700">{toast}</div>}
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="text-base font-semibold">Assigned ride requests</div>
        <div className="text-sm text-gray-500 mt-1">Requests matched to you (press Accept to start the trip).</div>

        {assigned.isLoading && driver.data && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
        {assigned.error && <div className="mt-4 text-sm text-red-600">{errorText(assigned.error)}</div>}

        <div className="mt-4 space-y-3">
		  {(assigned.data ?? []).map((rr) => {
		    const deadlineMs = rr.match_deadline ? new Date(rr.match_deadline).getTime() : null;
		    const secondsLeft = deadlineMs ? Math.max(0, Math.floor((deadlineMs - nowMs) / 1000)) : null;
		    const expiresLabel =
		      secondsLeft === null ? null : secondsLeft > 0 ? `expires in ${secondsLeft}s` : 'expired';

		    return (
		      <div key={rr.id} className="border border-gray-200 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  {rr.pickup_address ?? 'Pickup'} → {rr.dropoff_address ?? 'Dropoff'}
                </div>
			        <div className="flex items-center gap-2">
			          <Pill label={rr.status} />
			          {rr.matched_at && <Pill label={`matched: ${new Date(rr.matched_at).toLocaleTimeString()}`} />}
			          {expiresLabel && <Pill label={expiresLabel} />}
			        </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  className="btn btn-primary"
                  disabled={busy || rr.status !== 'matched' || (secondsLeft !== null && secondsLeft <= 0)}
                  onClick={async () => {
                    setBusy(true);
                    setToast(null);
                    try {
                      const { data, error } = await supabase.functions.invoke('driver-accept', { body: { request_id: rr.id } });
                      if (error) throw error;
                      setToast(`Accepted: ${JSON.stringify(data)}`);
                      qc.invalidateQueries({ queryKey: ['assigned_requests'] });
                      qc.invalidateQueries({ queryKey: ['rides_driver'] });
                      qc.invalidateQueries({ queryKey: ['driver'] });
                    } catch (e: unknown) {
                      setToast(`Error: ${errorText(e)}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Accept
                </button>
              </div>
		    </div>
		  );
		})}

          {(assigned.data ?? []).length === 0 && driver.data && !assigned.isLoading && (
            <div className="text-sm text-gray-500">No assigned requests.</div>
          )}

          {!driver.data && <div className="text-sm text-gray-500">Create a driver profile first.</div>}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Your rides</div>
            <div className="text-sm text-gray-500 mt-1">Update state (arrived → in_progress → completed).</div>
          </div>
          <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ['rides_driver'] })}>
            Refresh
          </button>
        </div>

        {rides.isLoading && driver.data && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
        {rides.error && <div className="mt-4 text-sm text-red-600">{errorText(rides.error)}</div>}

        <div className="mt-4 space-y-3">
          {(rides.data ?? []).map((r) => (
            <div key={r.id} className="border border-gray-200 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Ride {r.id.slice(0, 8)}…</div>
                <div className="flex items-center gap-2">
                  <Pill label={`status: ${r.status}`} />
                  <Pill label={`v${r.version}`} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {['arrived', 'in_progress', 'completed', 'canceled'].map((to) => {
                  const ok = allowedTransitions[r.status]?.has(to) ?? false;
                  return (
                    <button
                      key={to}
                      className="btn"
                      disabled={busy || !ok}
                      title={!ok ? `Not allowed from ${r.status}` : undefined}
                      onClick={async () => {
                        setBusy(true);
                        setToast(null);
                        try {
                          const { data, error } = await supabase.functions.invoke('ride-transition', {
                            body: { ride_id: r.id, to_status: to },
                          });
                          if (error) throw error;
                          setToast(`Transitioned: ${JSON.stringify(data)}`);
                          qc.invalidateQueries({ queryKey: ['rides_driver'] });
                          qc.invalidateQueries({ queryKey: ['driver'] });
                        } catch (e: unknown) {
                          setToast(`Error: ${errorText(e)}`);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {to}
                    </button>
                  );
                })}
              </div>

			  <div className="mt-2 text-xs text-gray-500">
                {r.started_at ? `started: ${new Date(r.started_at).toLocaleTimeString()} ` : ''}
                {r.completed_at ? `completed: ${new Date(r.completed_at).toLocaleTimeString()}` : ''}
                {typeof r.fare_amount_iqd === 'number' ? ` • fare: ${formatIQD(r.fare_amount_iqd)}` : ''}
              </div>

              {toast && <div className="mt-2 text-sm text-gray-700">{toast}</div>}
            </div>
          ))}

          {(rides.data ?? []).length === 0 && driver.data && !rides.isLoading && <div className="text-sm text-gray-500">No rides yet.</div>}
          {!driver.data && <div className="text-sm text-gray-500">Create a driver profile first.</div>}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return <div className="text-xs rounded-full bg-gray-100 border border-gray-200 px-2 py-1">{label}</div>;
}


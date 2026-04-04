import { useEffect, useRef, useState } from 'react';

import type { BusLocation, DeviationAlert, SOSEvent } from '@shieldtrack/types';
import { upsertAlert } from '../lib/alertsCache';
import { supabase } from '../lib/supabase';

const SPEED_HISTORY_SIZE = 5;

export interface ETAResult {
  /** Estimated minutes remaining. null if speed is 0 or unknown. */
  etaMinutes: number | null;
  /** Formatted ETA clock string e.g. "08:45 AM". null if not calculable. */
  etaTime: string | null;
}

export interface BusRealtimeState {
  /** Latest GPS coordinate of the bus. null = not yet received. */
  location: Pick<BusLocation, 'lat' | 'lng' | 'speed_kmh' | 'recorded_at'> | null;
  /** Whether at least one location has been received (bus is online). */
  busOnline: boolean;
  /** Computed ETA from rolling speed average. */
  eta: ETAResult;
  /** Latest SOS event received in this session. null = none. */
  sosEvent: SOSEvent | null;
  /** Latest deviation alert received in this session. null = none. */
  deviationAlert: DeviationAlert | null;
  /** Whether the Supabase Realtime channel is connected. */
  connected: boolean;
}

interface UseBusRealtimeOptions {
  /** The bus ID to subscribe to. Pass null to skip subscription. */
  busId: string | null;
  /**
   * Straight-line distance in metres from the student's stop to the school
   * (or the destination stop). Used for client-side ETA calculation.
   * Pass null to disable ETA.
   */
  distanceMetres: number | null;
}

/** Rolling average of the last N speed readings. */
function rollingAvg(speeds: number[]): number {
  if (speeds.length === 0) return 0;
  return speeds.reduce((s, v) => s + v, 0) / speeds.length;
}

/** Format a Date as "HH:MM AM/PM". */
function formatTime(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function computeETA(avgSpeedKmh: number, distanceMetres: number | null): ETAResult {
  if (distanceMetres === null || avgSpeedKmh <= 0) {
    return { etaMinutes: null, etaTime: null };
  }
  const etaMinutes = Math.round((distanceMetres / 1000 / avgSpeedKmh) * 60);
  const arrival = new Date(Date.now() + etaMinutes * 60 * 1000);
  return { etaMinutes, etaTime: formatTime(arrival) };
}

export function useBusRealtime({
  busId,
  distanceMetres,
}: UseBusRealtimeOptions): BusRealtimeState {
  const [location, setLocation] = useState<BusRealtimeState['location']>(null);
  const [busOnline, setBusOnline] = useState(false);
  const [eta, setEta] = useState<ETAResult>({ etaMinutes: null, etaTime: null });
  const [sosEvent, setSosEvent] = useState<SOSEvent | null>(null);
  const [deviationAlert, setDeviationAlert] = useState<DeviationAlert | null>(null);
  const [connected, setConnected] = useState(false);

  // Mutable speed history — doesn't need to trigger re-renders on its own.
  const speedHistory = useRef<number[]>([]);

  useEffect(() => {
    if (!busId) return;

    const seedLatestLocation = async () => {
      const { data, error } = await supabase
        .from('bus_locations')
        .select('lat, lng, speed_kmh, recorded_at')
        .eq('bus_id', busId)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return;

      speedHistory.current = [data.speed_kmh];
      setLocation({
        lat: data.lat,
        lng: data.lng,
        speed_kmh: data.speed_kmh,
        recorded_at: data.recorded_at,
      });
      setBusOnline(true);
      setEta(computeETA(data.speed_kmh, distanceMetres));
    };

    void seedLatestLocation();

    const channelName = `parent-bus-${busId}`;

    const channel = supabase
      .channel(channelName)
      // ── bus_locations INSERT → move pin & update ETA ───────────────────────
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bus_locations',
          filter: `bus_id=eq.${busId}`,
        },
        (payload) => {
          const row = payload.new as BusLocation;

          // Update speed history (rolling window).
          speedHistory.current = [
            ...speedHistory.current.slice(-(SPEED_HISTORY_SIZE - 1)),
            row.speed_kmh,
          ];

          const avg = rollingAvg(speedHistory.current);

          setLocation({
            lat: row.lat,
            lng: row.lng,
            speed_kmh: row.speed_kmh,
            recorded_at: row.recorded_at,
          });
          setBusOnline(true);
          setEta(computeETA(avg, distanceMetres));
        },
      )
      // ── sos_events INSERT → surface SOS alert ─────────────────────────────
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sos_events',
          filter: `bus_id=eq.${busId}`,
        },
        (payload) => {
          const event = payload.new as SOSEvent;
          setSosEvent(event);
          upsertAlert({ kind: 'sos', data: event });
        },
      )
      // ── deviation_alerts INSERT → surface deviation alert ─────────────────
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'deviation_alerts',
          filter: `bus_id=eq.${busId}`,
        },
        (payload) => {
          const event = payload.new as DeviationAlert;
          setDeviationAlert(event);
          upsertAlert({ kind: 'deviation', data: event });
        },
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
      speedHistory.current = [];
      setConnected(false);
    };
  }, [busId, distanceMetres]);

  return { location, busOnline, eta, sosEvent, deviationAlert, connected };
}

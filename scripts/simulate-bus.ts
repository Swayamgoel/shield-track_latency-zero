import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

type LatLng = {
  lat: number;
  lng: number;
};

type DemoBusConfig = {
  label: string;
  busId: string;
  tripId: string;
  tenantId: string;
  nominalStops: number;
  polyline: LatLng[];
};

type DemoConfig = {
  tickIntervalMs: number;
  routePredictionIntervalMs: number;
  mlServerBaseUrl: string;
  buses: DemoBusConfig[];
};

type RuntimeBusState = {
  config: DemoBusConfig;
  waypointIndex: number;
  current: LatLng;
  speedKmh: number;
  speedHistory: number[];
  routeTotalKm: number;
};

type EtaPrediction = {
  eta_minutes: number;
  confidence_pct: number;
};

type RoutePrediction = {
  routes?: Array<{
    route_id: string;
    estimated_minutes: number;
    congestion_level: string;
    is_recommended: boolean;
  }>;
};

const PHAGWARA_ROUTE_A: LatLng[] = [
  { lat: 31.22256, lng: 75.77013 },
  { lat: 31.22328, lng: 75.76892 },
  { lat: 31.22406, lng: 75.76741 },
  { lat: 31.22478, lng: 75.76591 },
  { lat: 31.22551, lng: 75.76439 },
  { lat: 31.22625, lng: 75.76288 },
  { lat: 31.22698, lng: 75.76142 },
  { lat: 31.22773, lng: 75.75995 },
  { lat: 31.22842, lng: 75.75852 },
  { lat: 31.22918, lng: 75.75703 },
  { lat: 31.22993, lng: 75.75552 },
  { lat: 31.23062, lng: 75.75402 },
  { lat: 31.23118, lng: 75.75256 },
  { lat: 31.23179, lng: 75.75105 },
  { lat: 31.23244, lng: 75.74963 },
  { lat: 31.2331, lng: 75.7482 },
];

const PHAGWARA_ROUTE_B: LatLng[] = [
  { lat: 31.2484, lng: 75.70015 },
  { lat: 31.24765, lng: 75.7016 },
  { lat: 31.24686, lng: 75.70306 },
  { lat: 31.24602, lng: 75.70458 },
  { lat: 31.24519, lng: 75.7061 },
  { lat: 31.2444, lng: 75.70765 },
  { lat: 31.24358, lng: 75.70918 },
  { lat: 31.24276, lng: 75.71074 },
  { lat: 31.24195, lng: 75.71227 },
  { lat: 31.24112, lng: 75.71386 },
  { lat: 31.2403, lng: 75.71542 },
  { lat: 31.23944, lng: 75.71697 },
  { lat: 31.23862, lng: 75.71855 },
  { lat: 31.23779, lng: 75.72011 },
  { lat: 31.23695, lng: 75.72166 },
  { lat: 31.2361, lng: 75.7232 },
];

const JALANDHAR_ROUTE_A: LatLng[] = [
  { lat: 31.30942, lng: 75.57684 },
  { lat: 31.31058, lng: 75.5791 },
  { lat: 31.31176, lng: 75.58141 },
  { lat: 31.31294, lng: 75.5837 },
  { lat: 31.31412, lng: 75.58597 },
  { lat: 31.3153, lng: 75.58824 },
  { lat: 31.31648, lng: 75.59053 },
  { lat: 31.31762, lng: 75.59281 },
  { lat: 31.31878, lng: 75.59508 },
  { lat: 31.31995, lng: 75.59734 },
  { lat: 31.32112, lng: 75.59961 },
  { lat: 31.32224, lng: 75.60187 },
  { lat: 31.3234, lng: 75.60415 },
  { lat: 31.32455, lng: 75.60639 },
  { lat: 31.3257, lng: 75.60864 },
  { lat: 31.32682, lng: 75.6109 },
];

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT:", err.message);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// DEMO_CONFIG: only edit IDs below for your own Supabase tenant/trips/buses.
// ---------------------------------------------------------------------------
const DEMO_CONFIG: DemoConfig = {
  tickIntervalMs: 7_000,
  routePredictionIntervalMs: 30_000,
  mlServerBaseUrl: "http://localhost:8000",
  buses: [
    {
      label: "Phagwara North Loop",
      busId: "b1c2d3e4-0001-4000-8000-000000000001",
      tripId: "c1d2e3f4-0001-4000-8000-000000000001",
      tenantId: "7828934e-939a-4a61-8cae-8f3c3cc7b501",
      nominalStops: 6,
      polyline: PHAGWARA_ROUTE_A,
    },
    {
      label: "Phagwara Campus Link",
      busId: "b1c2d3e4-0002-4000-8000-000000000002",
      tripId: "c1d2e3f4-0002-4000-8000-000000000002",
      tenantId: "7828934e-939a-4a61-8cae-8f3c3cc7b501",
      nominalStops: 5,
      polyline: PHAGWARA_ROUTE_B,
    },
    {
      label: "Jalandhar East Arc",
      busId: "b1c2d3e4-0003-4000-8000-000000000003",
      tripId: "c1d2e3f4-0003-4000-8000-000000000003",
      tenantId: "7828934e-939a-4a61-8cae-8f3c3cc7b501",
      nominalStops: 7,
      polyline: JALANDHAR_ROUTE_A,
    },
  ],
};

loadEnv({ path: "../.env" });

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    "Missing SUPABASE_URL and/or SUPABASE_SERVICE_KEY in root .env. " +
      "Please configure them before running the simulation.",
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

const haversineKm = (a: LatLng, b: LatLng): number => {
  const radiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * radiusKm * Math.asin(Math.sqrt(h));
};

const polylineDistanceKm = (
  points: LatLng[],
  startIndex = 0,
  endIndex = points.length - 1,
): number => {
  if (points.length < 2 || startIndex >= endIndex) {
    return 0;
  }

  let distance = 0;
  for (let i = startIndex; i < endIndex; i += 1) {
    distance += haversineKm(points[i], points[i + 1]);
  }
  return distance;
};

const randomBetween = (min: number, max: number): number =>
  min + Math.random() * (max - min);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const isPeakHour = (hour: number): boolean => {
  return (hour >= 7 && hour < 9) || (hour >= 15 && hour < 17);
};

const ensureValidConfig = (config: DemoConfig): void => {
  if (config.buses.length < 2 || config.buses.length > 3) {
    throw new Error("DEMO_CONFIG.buses must contain 2 or 3 buses.");
  }

  for (const bus of config.buses) {
    if (!UUID_REGEX.test(bus.busId)) {
      throw new Error(
        `Invalid busId for ${bus.label}. Replace DEMO_CONFIG UUID placeholders with real Supabase IDs.`,
      );
    }
    if (!UUID_REGEX.test(bus.tripId)) {
      throw new Error(
        `Invalid tripId for ${bus.label}. Replace DEMO_CONFIG UUID placeholders with real active trip IDs.`,
      );
    }
    if (!UUID_REGEX.test(bus.tenantId)) {
      throw new Error(
        `Invalid tenantId for ${bus.label}. Replace DEMO_CONFIG tenant UUID placeholders.`,
      );
    }
    if (bus.polyline.length < 15) {
      throw new Error(`${bus.label} must define at least 15 GPS waypoints.`);
    }
  }
};

const buildRuntimeBusState = (bus: DemoBusConfig): RuntimeBusState => {
  const nowHour = new Date().getHours();
  const peak = isPeakHour(nowHour);
  const initialSpeed = randomBetween(peak ? 25 : 30, peak ? 38 : 45);

  return {
    config: bus,
    waypointIndex: 0,
    current: bus.polyline[0],
    speedKmh: round(initialSpeed, 2),
    speedHistory: [round(initialSpeed, 2)],
    routeTotalKm: round(polylineDistanceKm(bus.polyline), 3),
  };
};

const moveBusOneStep = (bus: RuntimeBusState, now: Date): void => {
  const nextIndex = (bus.waypointIndex + 1) % bus.config.polyline.length;
  bus.waypointIndex = nextIndex;
  bus.current = bus.config.polyline[nextIndex];

  const peak = isPeakHour(now.getHours());
  const minSpeed = peak ? 25 : 30;
  const maxSpeed = peak ? 38 : 45;
  const jitter = randomBetween(-2.5, 2.5);

  bus.speedKmh = round(clamp(bus.speedKmh + jitter, minSpeed, maxSpeed), 2);
  bus.speedHistory.push(bus.speedKmh);
  if (bus.speedHistory.length > 5) {
    bus.speedHistory.shift();
  }
};

const getBusMetrics = (
  bus: RuntimeBusState,
): {
  speedAvg5Min: number;
  distanceCoveredKm: number;
  distanceRemainingKm: number;
  tripProgressPct: number;
  stopsRemaining: number;
  destination: LatLng;
} => {
  const destination = bus.config.polyline[bus.config.polyline.length - 1];
  const distanceCoveredKm = polylineDistanceKm(
    bus.config.polyline,
    0,
    bus.waypointIndex,
  );
  const remainingRaw = bus.routeTotalKm - distanceCoveredKm;
  const distanceRemainingKm = round(Math.max(remainingRaw, 0.01), 3);
  const tripProgressPct = round(
    clamp((distanceCoveredKm / bus.routeTotalKm) * 100, 0, 100),
    2,
  );

  const stopsRemaining = Math.max(
    0,
    Math.round((1 - tripProgressPct / 100) * bus.config.nominalStops),
  );

  return {
    speedAvg5Min: round(average(bus.speedHistory), 2),
    distanceCoveredKm: round(distanceCoveredKm, 3),
    distanceRemainingKm,
    tripProgressPct,
    stopsRemaining,
    destination,
  };
};

const insertBusLocation = async (
  bus: RuntimeBusState,
  nowIso: string,
): Promise<void> => {
  const { error } = await supabase.from("bus_locations").insert({
    trip_id: bus.config.tripId,
    bus_id: bus.config.busId,
    tenant_id: bus.config.tenantId,
    lat: bus.current.lat,
    lng: bus.current.lng,
    speed_kmh: bus.speedKmh,
    recorded_at: nowIso,
  });

  if (error) {
    console.error(
      `[supabase] bus_locations insert failed for ${bus.config.label} (${bus.config.busId}): ${error.message}`,
    );
  }
};

const callEtaPrediction = async (
  bus: RuntimeBusState,
  now: Date,
): Promise<EtaPrediction | null> => {
  const metrics = getBusMetrics(bus);

  try {
    const response = await fetch(`${DEMO_CONFIG.mlServerBaseUrl}/predict/eta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bus_id: bus.config.busId,
        speed_current_kmh: bus.speedKmh,
        speed_avg_5min_kmh: metrics.speedAvg5Min,
        distance_remaining_km: metrics.distanceRemainingKm,
        stops_remaining: metrics.stopsRemaining,
        hour_of_day: now.getHours(),
        day_of_week: now.getDay(),
        route_total_km: bus.routeTotalKm,
        trip_progress_pct: metrics.tripProgressPct,
        origin_lat: bus.current.lat,
        origin_lng: bus.current.lng,
        dest_lat: metrics.destination.lat,
        dest_lng: metrics.destination.lng,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn(
        `[ml] /predict/eta failed for ${bus.config.busId}: HTTP ${response.status} ${body}`,
      );
      return null;
    }

    const payload = (await response.json()) as Partial<EtaPrediction>;
    if (
      typeof payload.eta_minutes !== "number" ||
      typeof payload.confidence_pct !== "number"
    ) {
      console.warn(
        `[ml] /predict/eta returned unexpected payload for ${bus.config.busId}.`,
      );
      return null;
    }

    return {
      eta_minutes: payload.eta_minutes,
      confidence_pct: payload.confidence_pct,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[ml] ETA prediction unavailable for ${bus.config.busId}. Simulation continues. Reason: ${message}`,
    );
    return null;
  }
};

const callRoutePrediction = async (bus: RuntimeBusState): Promise<void> => {
  const destination = bus.config.polyline[bus.config.polyline.length - 1];
  const now = new Date();

  try {
    const response = await fetch(
      `${DEMO_CONFIG.mlServerBaseUrl}/predict/route`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bus_id: bus.config.busId,
          origin_lat: bus.current.lat,
          origin_lng: bus.current.lng,
          dest_lat: destination.lat,
          dest_lng: destination.lng,
          hour_of_day: now.getHours(),
          num_stops: bus.config.nominalStops,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      console.warn(
        `[ml] /predict/route failed for ${bus.config.busId}: HTTP ${response.status} ${body}`,
      );
      return;
    }

    const payload = (await response.json()) as RoutePrediction;
    const recommended = payload.routes?.find((route) => route.is_recommended);

    if (!recommended) {
      console.log(
        `[route] ${bus.config.label} | ${bus.config.busId} | no recommendation returned`,
      );
      return;
    }

    console.log(
      `[route] ${bus.config.label} | ${bus.config.busId} | route=${recommended.route_id} | eta=${round(recommended.estimated_minutes, 1)}m | congestion=${recommended.congestion_level}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[ml] Route recommendation unavailable for ${bus.config.busId}. Simulation continues. Reason: ${message}`,
    );
  }
};

const logTick = (
  tickNumber: number,
  bus: RuntimeBusState,
  etaPrediction: EtaPrediction | null,
): void => {
  const etaText = etaPrediction
    ? `${round(etaPrediction.eta_minutes, 1)}m`
    : "n/a";
  const confidenceText = etaPrediction
    ? `${round(etaPrediction.confidence_pct, 1)}%`
    : "n/a";

  console.log(
    `[tick ${tickNumber}] ${bus.config.label} | bus=${bus.config.busId} | lat=${bus.current.lat.toFixed(5)} lng=${bus.current.lng.toFixed(5)} | speed=${bus.speedKmh.toFixed(1)} km/h | ETA=${etaText} | confidence=${confidenceText}`,
  );
};

const startSimulation = async (): Promise<void> => {
  ensureValidConfig(DEMO_CONFIG);

  const runtimeBuses = DEMO_CONFIG.buses.map(buildRuntimeBusState);

  console.log("ShieldTrack bus simulation started.");
  console.log(
    `Buses=${runtimeBuses.length}, GPS tick=${DEMO_CONFIG.tickIntervalMs}ms, route prediction cadence=${DEMO_CONFIG.routePredictionIntervalMs}ms`,
  );
  console.log(
    "Using Supabase service role key for direct bus_locations inserts.",
  );

  let tickNumber = 0;
  let tickInProgress = false;
  let routeInProgress = false;

  const runTick = async (): Promise<void> => {
    if (tickInProgress) {
      console.warn(
        "[tick] Previous tick is still running; skipping this cycle.",
      );
      return;
    }

    tickInProgress = true;
    tickNumber += 1;
    const now = new Date();
    const nowIso = now.toISOString();

    try {
      await Promise.all(
        runtimeBuses.map(async (bus) => {
          moveBusOneStep(bus, now);
          await insertBusLocation(bus, nowIso);
          const etaPrediction = await callEtaPrediction(bus, now);
          logTick(tickNumber, bus, etaPrediction);
        }),
      );
    } finally {
      tickInProgress = false;
    }
  };

  const runRoutePredictions = async (): Promise<void> => {
    if (routeInProgress) {
      console.warn(
        "[route] Previous route prediction batch is still running; skipping this cycle.",
      );
      return;
    }

    routeInProgress = true;
    try {
      await Promise.all(runtimeBuses.map((bus) => callRoutePrediction(bus)));
    } finally {
      routeInProgress = false;
    }
  };

  // Run one immediate cycle so the admin portal map starts moving right away.
  await runTick();
  await runRoutePredictions();

  const tickInterval = setInterval(() => {
    void runTick();
  }, DEMO_CONFIG.tickIntervalMs);

  const routeInterval = setInterval(() => {
    void runRoutePredictions();
  }, DEMO_CONFIG.routePredictionIntervalMs);

  const stopSimulation = (): void => {
    clearInterval(tickInterval);
    clearInterval(routeInterval);
    console.log("Simulation stopped.");
  };

  process.on("SIGINT", () => {
    stopSimulation();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    stopSimulation();
    process.exit(0);
  });
};

startSimulation().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fatal] ${message}`);
  process.exit(1);
});

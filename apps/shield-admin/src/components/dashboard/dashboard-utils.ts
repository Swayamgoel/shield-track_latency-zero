import type { Route } from "../../supabase";
import type { ApprovedReroute } from "./LiveInsightsPanel";

export const MAP_STORAGE_KEY = "shieldtrack_map_view";
export const APPROVED_REROUTES_STORAGE_KEY = "shieldtrack_approved_reroutes_v1";

export interface SavedMapView {
  lat: number;
  lng: number;
  zoom: number;
}

function isSavedMapView(value: unknown): value is SavedMapView {
  if (typeof value !== "object" || value == null) return false;

  const candidate = value as Partial<SavedMapView>;
  return (
    typeof candidate.lat === "number" &&
    Number.isFinite(candidate.lat) &&
    typeof candidate.lng === "number" &&
    Number.isFinite(candidate.lng) &&
    typeof candidate.zoom === "number" &&
    Number.isFinite(candidate.zoom)
  );
}

export interface ConfidenceMeta {
  label: string;
  badgeClass: string;
}

function isApprovedReroute(value: unknown): value is ApprovedReroute {
  if (typeof value !== "object" || value == null) return false;

  const candidate = value as Partial<ApprovedReroute>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.busId === "string" &&
    candidate.busId.length > 0 &&
    typeof candidate.busLabel === "string" &&
    candidate.busLabel.length > 0 &&
    typeof candidate.routeId === "string" &&
    candidate.routeId.length > 0 &&
    typeof candidate.estimatedMinutes === "number" &&
    Number.isFinite(candidate.estimatedMinutes) &&
    typeof candidate.approvedAt === "string" &&
    candidate.approvedAt.length > 0 &&
    (candidate.note === undefined || typeof candidate.note === "string")
  );
}

export function getSavedMapView(): SavedMapView | null {
  try {
    const raw = localStorage.getItem(MAP_STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return isSavedMapView(parsed) ? parsed : null;
  } catch {
    // noop
  }
  return null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getConfidenceMeta(
  confidencePct: number | null,
): ConfidenceMeta {
  if (confidencePct == null) {
    return {
      label: "No estimate yet",
      badgeClass: "bg-gray-100 text-gray-600",
    };
  }
  if (confidencePct >= 80) {
    return {
      label: "High confidence",
      badgeClass: "bg-emerald-100 text-emerald-700",
    };
  }
  if (confidencePct >= 60) {
    return {
      label: "Medium confidence",
      badgeClass: "bg-amber-100 text-amber-700",
    };
  }
  return { label: "Low confidence", badgeClass: "bg-rose-100 text-rose-700" };
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function loadApprovedReroutes(
  storageKey: string = APPROVED_REROUTES_STORAGE_KEY,
): ApprovedReroute[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed.filter(isApprovedReroute) as ApprovedReroute[])
      : [];
  } catch {
    return [];
  }
}

export function isNewerRecord(
  currentTs: string | null | undefined,
  incomingTs: string | null | undefined,
) {
  const current = Date.parse(currentTs ?? "");
  const incoming = Date.parse(incomingTs ?? "");
  if (Number.isNaN(incoming)) return false;
  if (Number.isNaN(current)) return true;
  return incoming >= current;
}

export function extractRouteDestination(route: Route | undefined): {
  lat: number;
  lng: number;
  numStops: number;
} | null {
  if (!route) return null;

  const stops = Array.isArray(route.stops)
    ? [...route.stops].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  if (stops.length > 0) {
    const lastStop = stops[stops.length - 1];
    if (typeof lastStop.lat === "number" && typeof lastStop.lng === "number") {
      return { lat: lastStop.lat, lng: lastStop.lng, numStops: stops.length };
    }
  }

  const polyline = Array.isArray(route.polyline)
    ? (route.polyline as Array<[number, number] | { lat: number; lng: number }>)
    : [];

  if (polyline.length === 0) return null;

  const lastPoint = polyline[polyline.length - 1];
  if (Array.isArray(lastPoint) && lastPoint.length >= 2) {
    const lat = Number(lastPoint[0]);
    const lng = Number(lastPoint[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng, numStops: Math.max(stops.length, 1) };
    }
  }

  if (
    typeof lastPoint === "object" &&
    lastPoint &&
    "lat" in lastPoint &&
    "lng" in lastPoint
  ) {
    const lat = Number(lastPoint.lat);
    const lng = Number(lastPoint.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng, numStops: Math.max(stops.length, 1) };
    }
  }

  return null;
}

export function extractRouteOrigin(route: Route | undefined): {
  lat: number;
  lng: number;
} | null {
  if (!route) return null;

  const stops = Array.isArray(route.stops)
    ? [...route.stops].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  if (stops.length > 0) {
    const firstStop = stops[0];
    if (
      typeof firstStop.lat === "number" &&
      Number.isFinite(firstStop.lat) &&
      typeof firstStop.lng === "number" &&
      Number.isFinite(firstStop.lng)
    ) {
      return { lat: firstStop.lat, lng: firstStop.lng };
    }
  }

  const polyline = Array.isArray(route.polyline)
    ? (route.polyline as Array<[number, number] | { lat: number; lng: number }>)
    : [];

  if (polyline.length === 0) return null;

  const firstPoint = polyline[0];
  if (Array.isArray(firstPoint) && firstPoint.length >= 2) {
    const lat = Number(firstPoint[0]);
    const lng = Number(firstPoint[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  if (
    typeof firstPoint === "object" &&
    firstPoint &&
    "lat" in firstPoint &&
    "lng" in firstPoint
  ) {
    const lat = Number(firstPoint.lat);
    const lng = Number(firstPoint.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  return null;
}

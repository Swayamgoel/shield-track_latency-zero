import { createClient } from "@supabase/supabase-js";

// --- 🔑 SUPABASE CONFIGURATION ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. " +
    "Please check your .env file."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- 📄 TYPESCRIPT INTERFACES FROM SCHEMA ---

/**
 * Represents any valid JSON value.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

/**
 * Represents a geographic coordinate [latitude, longitude].
 */
export type LatLngTuple = [number, number];

/**
 * Represents a route's geometry as a series of coordinates.
 */
export type GeoPolyline = LatLngTuple[];

/**
 * Represents a scheduled stop along a route.
 */
export interface RouteStop {
  name: string;
  lat: number;
  lng: number;
  arrival_time?: string;
}

/**
 * Represents a recommended route option from the ML backend.
 */
export interface RouteOption {
  route_id: string;
  waypoints: string[];
  distance_km: number;
  estimated_minutes: number;
  congestion_level: "low" | "medium" | "high";
  is_recommended: boolean;
  notes: string;
}

export interface Tenant {
  id: string; // uuid
  name: string;
  institute_code: string;
  created_at: string;
}

export interface Bus {
  id: string; // uuid
  tenant_id: string; // uuid
  plate_number: string; // unique per tenant (case-insensitive)
  capacity: number;
  created_at: string;
}

export interface Route {
  id: string; // uuid
  tenant_id: string; // uuid
  name: string;
  polyline: GeoPolyline; // jsonb (array of coordinates)
  stops: RouteStop[]; // jsonb (array of stop objects)
  created_at: string;
}

export interface Student {
  id: string; // uuid
  tenant_id: string; // uuid
  name: string;
  route_id: string | null; // uuid
  registration_no: string; // human-readable ID shared with parents for login
  created_at: string;
}

export interface BusLocation {
  id: string; // uuid
  trip_id: string; // uuid
  bus_id: string; // uuid
  tenant_id: string; // uuid
  lat: number;
  lng: number;
  speed_kmh: number;
  recorded_at: string;
}

export interface Trip {
  id: string; // uuid
  tenant_id: string; // uuid
  assignment_id: string; // uuid
  bus_id: string; // uuid
  route_id: string; // uuid
  driver_id: string; // uuid
  status: string;
  started_at: string;
  ended_at: string | null;
}

export interface TripAssignment {
  id: string; // uuid
  tenant_id: string; // uuid
  bus_id: string; // uuid
  route_id: string; // uuid
  driver_id: string; // uuid
  assigned_date: string;
  created_at: string;
}

export interface User {
  id: string; // uuid
  tenant_id: string; // uuid
  email: string | null;
  role: string;
  device_id: string | null;
  student_id: string | null; // uuid
  created_at: string;
}

export interface BusEtaPrediction {
  id: string; // uuid
  bus_id: string; // uuid
  eta_minutes: number;
  confidence_pct: number;
  predicted_at: string;
  features_json: Record<string, JsonValue> | null; // jsonb
}

export interface BusRouteRecommendation {
  id: string; // uuid
  bus_id: string; // uuid
  recommended_at: string;
  routes_json: RouteOption[]; // jsonb
}

export interface DeviationAlert {
  id: string; // uuid
  trip_id: string; // uuid
  bus_id: string; // uuid
  tenant_id: string; // uuid
  lat: number;
  lng: number;
  distance_m: number;
  triggered_at: string;
}

export interface SosEvent {
  id: string; // uuid
  trip_id: string; // uuid
  bus_id: string; // uuid
  tenant_id: string; // uuid
  lat: number;
  lng: number;
  triggered_at: string;
  resolved_at: string | null;
  notes: string | null;
}

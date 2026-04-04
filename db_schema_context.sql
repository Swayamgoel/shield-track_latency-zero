-- WARNING: This schema is for context only and is not meant to be run directly.
-- Table order and constraints may not be valid for full execution.
-- For incremental changes, see the ALTER TABLE migration block at the bottom of this file.

CREATE TABLE public.bus_eta_predictions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bus_id uuid NOT NULL,
  eta_minutes numeric NOT NULL,
  confidence_pct numeric NOT NULL,
  predicted_at timestamp with time zone DEFAULT now(),
  features_json jsonb,
  CONSTRAINT bus_eta_predictions_pkey PRIMARY KEY (id),
  CONSTRAINT bus_eta_predictions_bus_id_fkey FOREIGN KEY (bus_id) REFERENCES public.buses(id)
);
CREATE TABLE public.bus_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  bus_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed_kmh double precision NOT NULL DEFAULT 0,
  recorded_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bus_locations_pkey PRIMARY KEY (id),
  CONSTRAINT bus_locations_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id),
  CONSTRAINT bus_locations_bus_id_fkey FOREIGN KEY (bus_id) REFERENCES public.buses(id),
  CONSTRAINT bus_locations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.bus_route_recommendations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bus_id uuid NOT NULL,
  recommended_at timestamp with time zone DEFAULT now(),
  routes_json jsonb NOT NULL,
  CONSTRAINT bus_route_recommendations_pkey PRIMARY KEY (id),
  CONSTRAINT bus_route_recommendations_bus_id_fkey FOREIGN KEY (bus_id) REFERENCES public.buses(id)
);
CREATE TABLE public.buses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  plate_number text NOT NULL,
  capacity integer NOT NULL DEFAULT 40,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT buses_pkey PRIMARY KEY (id),
  CONSTRAINT buses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE UNIQUE INDEX buses_tenant_plate_unique ON public.buses (tenant_id, upper(plate_number));
CREATE TABLE public.deviation_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  bus_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  distance_m double precision NOT NULL,
  triggered_at timestamp with time zone DEFAULT now(),
  CONSTRAINT deviation_alerts_pkey PRIMARY KEY (id),
  CONSTRAINT deviation_alerts_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id),
  CONSTRAINT deviation_alerts_bus_id_fkey FOREIGN KEY (bus_id) REFERENCES public.buses(id),
  CONSTRAINT deviation_alerts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.routes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  polyline jsonb NOT NULL DEFAULT '[]'::jsonb,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT routes_pkey PRIMARY KEY (id),
  CONSTRAINT routes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.sos_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  bus_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  triggered_at timestamp with time zone DEFAULT now(),
  resolved_at timestamp with time zone,
  notes text,
  CONSTRAINT sos_events_pkey PRIMARY KEY (id),
  CONSTRAINT sos_events_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id),
  CONSTRAINT sos_events_bus_id_fkey FOREIGN KEY (bus_id) REFERENCES public.buses(id),
  CONSTRAINT sos_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.students (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  registration_no text NOT NULL DEFAULT '',
  route_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT students_pkey PRIMARY KEY (id),
  CONSTRAINT students_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT students_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id)
);
CREATE UNIQUE INDEX students_tenant_regno_unique
  ON public.students (tenant_id, registration_no);
CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  institute_code text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tenants_pkey PRIMARY KEY (id)
);
CREATE TABLE public.trip_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bus_id uuid NOT NULL,
  route_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  assigned_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT trip_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT trip_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT trip_assignments_bus_id_fkey FOREIGN KEY (bus_id) REFERENCES public.buses(id),
  CONSTRAINT trip_assignments_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id),
  CONSTRAINT trip_assignments_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id)
);
CREATE TABLE public.trips (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  bus_id uuid NOT NULL,
  route_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'active'::trip_status,
  started_at timestamp with time zone DEFAULT now(),
  ended_at timestamp with time zone,
  CONSTRAINT trips_pkey PRIMARY KEY (id),
  CONSTRAINT trips_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT trips_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.trip_assignments(id),
  CONSTRAINT trips_bus_id_fkey FOREIGN KEY (bus_id) REFERENCES public.buses(id),
  CONSTRAINT trips_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id),
  CONSTRAINT trips_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  email text UNIQUE,
  role USER-DEFINED NOT NULL,
  device_id text,
  student_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

-- --- 📊 OPTIMIZED VIEWS ---

-- View to get only the most recent location row for each bus.
-- Used by Admin Dashboard to scale fleet monitoring.
CREATE OR REPLACE VIEW public.latest_bus_locations AS
SELECT DISTINCT ON (bus_id)
  id,
  trip_id,
  bus_id,
  tenant_id,
  lat,
  lng,
  speed_kmh,
  recorded_at
FROM
  public.bus_locations
ORDER BY
  bus_id,
  recorded_at DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 📦 MIGRATION: Apply these in Supabase SQL Editor for incremental changes
-- Run this block once against an existing database (tables already created).
-- ─────────────────────────────────────────────────────────────────────────────

-- Migration: Add registration_no to students (parent login identifier)
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS registration_no text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS students_tenant_regno_unique
  ON public.students (tenant_id, registration_no);

# ShieldTrack — Complete Development Reference

> **Team Latency Zero · Eclipse 6.0 · Open Innovation Track · EC603**

![42%](https://progress-bar.xyz/42/?title=Project%20completed)

**Stack:** Turborepo · Expo (mobile) · React/Vite (admin) · Node.js (API) · Supabase

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [User Flows](#2-user-flows)
3. [Database Schema](#3-database-schema)
4. [REST API Reference](#4-rest-api-reference)
5. [Realtime Architecture](#5-realtime-architecture)
6. [Shared Utilities](#6-shared-utilities)
7. [Development Phases](#7-development-phases)
8. [Team Assignment & Tracking](#8-team-assignment--tracking)

---

## 1. System Overview

ShieldTrack is a multi-tenant, real-time school bus tracking and fleet management system.

### Three-actor architecture

| Actor           | Platform         | Primary function                       |
| --------------- | ---------------- | -------------------------------------- |
| Institute Admin | React web (Vite) | Fleet oversight, CRUD, live monitoring |
| Driver          | Expo mobile app  | GPS broadcast, SOS alerts              |
| Parent          | Expo mobile app  | Read-only live tracking, ETA, alerts   |

### Core technical decisions

| Decision       | Choice                                      | Reason                                     |
| -------------- | ------------------------------------------- | ------------------------------------------ |
| Real-time GPS  | Supabase Realtime (direct insert)           | Eliminates Redis + Socket.io               |
| Backend        | Node.js REST only                           | Thin, focused — no WebSocket server needed |
| Geofencing     | Supabase DB trigger (server-side Haversine) | Always runs, independent of client state   |
| GPS interval   | 7 seconds                                   | Matches PPT spec                           |
| Parent login   | Institute Code + Student ID                 | Zero-setup for parents                     |
| Data isolation | Supabase RLS at DB level                    | Security enforced before data leaves DB    |
| ETA calc       | Rolling 5-heartbeat avg, client-side        | Fast, no extra API call                    |
| Mobile         | Single Expo app, role-based navigation      | One codebase, two experiences              |
| Monorepo       | Turborepo                                   | Shared types + utils across all apps       |

---

## 2. User Flows

### 2.1 Admin flow

```mermaid
Open browser → /login
    │
    ▼
Email + Password
    │
    ▼
JWT issued { role: 'admin', tenantId }
    │
    ▼
Dashboard
    ├── Fleet Map (live bus pins via Supabase Realtime)
    ├── Buses      → CRUD: add/edit/delete buses
    ├── Routes     → CRUD: define routes with GPS polyline + stops
    ├── Drivers    → Invite driver accounts (device_id enrolled on first login)
    ├── Students   → Add students, link to route, link to parent accounts
    ├── Assignments→ Assign driver + bus + route for a date
    └── Reports    → Trip history · SOS log · Deviation log

**Initial state hydration (on dashboard load):**
- Fetch from `latest_bus_locations` view (one row per active bus)
- Renders initial fleet pins without pulling historical GPS history
```

**Live monitoring loop (continuous while dashboard is open):**

```mermaid
Supabase Realtime subscription (tenant channel)
    │
    ├── bus_locations INSERT → update bus pin on map
    ├── deviation_alerts INSERT → turn pin orange + show alert banner
    └── sos_events INSERT → turn pin red + open SOS modal
```

---

### 2.2 Driver flow

```mermaid
Open mobile app
    │
    ▼
Login screen
    Email + Password
    Device ID captured (expo-device)
    │
    ├── First login: device_id stored against user in DB
    └── Subsequent: device_id compared → mismatch = rejected
    │
    ▼
Role = 'driver' → DriverStack
    │
    ▼
Trip screen
    ├── Shows today's assignment (bus + route)
    └── "Go Online" button
            │
            ▼
        POST /trips/start → receives trip_id
            │
            ▼
        expo-location background task starts
        Every 7 seconds:
            │
            ├── Get { lat, lng, speed } from GPS
            ├── INSERT into bus_locations { trip_id, bus_id, tenant_id, lat, lng, speed_kmh }
            └── Supabase DB trigger fires → checks deviation → inserts alert if >200m off route
            │
            ▼
        Screen shows: ONLINE status · live speed · SOS button
            │
            ├── SOS tapped
            │       │
            │       ▼
            │   Confirmation modal
            │       │
            │       ▼
            │   POST /sos { trip_id, lat, lng }
            │       │
            │       ▼
            │   FCM push → all admins + affected parents
            │
            └── "End Route" tapped
                    │
                    ▼
                POST /trips/:id/end
                    │
                    ▼
                Background GPS task stops
                    │
                    ▼
                Screen resets to OFFLINE state
```

---

### 2.3 Parent flow

```mermaid
Open mobile app
    │
    ▼
Login screen
    Institute Code + Student ID (no email needed)
    │
    ▼
API resolves: student → route → active trip → bus_id
JWT issued { role: 'parent', tenantId, busId, studentId }
    │
    ▼
Role = 'parent' → ParentStack
    │
    ▼
Tracker screen
    │
    ├── Supabase Realtime subscribes to bus_locations (RLS: this bus only)
    │       │
    │       └── Every 7s: bus pin moves on map
    │                     speed history updated (last 5 readings)
    │                     ETA recalculated: distance / avg_speed
    │
    ├── Bus ONLINE  → pin visible, ETA card shows minutes + arrival time
    ├── Bus OFFLINE → "Bus not yet started" state
    └── SOS/Deviation received via FCM push
            │
            └── Banner shown on tracker screen
    │
    ▼
Notifications screen
    └── History: SOS alerts + deviation alerts for this student's bus
```

---

### 2.4 GPS heartbeat pipeline (every 7 seconds)

```mermaid
Driver device (expo-location background task)
    │
    INSERT bus_locations { trip_id, bus_id, tenant_id, lat, lng, speed_kmh, recorded_at }
    │
    ├── Supabase Realtime broadcasts INSERT event
    │       ├── Admin fleet channel → all admin subscribers update pin
    │       └── Parent bus channel  → parent subscriber updates pin + recalcs ETA
    │
    └── DB trigger: check_route_deviation() fires
            │
            ├── Haversine(current_pos, each_route_point) → min_distance
            │
            ├── min_distance ≤ 200m → no action
            │
            └── min_distance > 200m
                    │
                    INSERT deviation_alerts { trip_id, bus_id, tenant_id, lat, lng, distance_m }
                    │
                    Supabase Realtime broadcasts deviation_alerts INSERT
                    │
                    ├── Admin receives → orange pin + alert banner
                    └── POST /alerts/notify → FCM push to parents of students on this bus
```

---

### 2.5 SOS pipeline

```mermaid
Driver taps SOS button
    │
    ▼
Confirmation modal (prevent accidental trigger)
    │
    ▼
POST /sos { trip_id, lat, lng }
    │
    ├── INSERT sos_events { trip_id, bus_id, tenant_id, lat, lng, triggered_at }
    │
    ├── FCM push → all admin users of tenant
    │       └── Payload: { type: 'sos', busId, lat, lng, driverName }
    │
    └── FCM push → all parents whose students are on this bus
            └── Payload: { type: 'sos', busName, studentName }
    │
    ▼
Supabase Realtime broadcasts sos_events INSERT
    │
    ├── Admin → SOS modal auto-opens, pin turns red, pulsing indicator
    └── Parent → alert banner on tracker screen
```

---

## 3. Database Schema

### 3.1 Migrations (run in order)

#### 001_tenants.sql

```sql
CREATE TABLE tenants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  institute_code TEXT UNIQUE NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
```

---

#### 002_users.sql

```sql
CREATE TYPE user_role AS ENUM ('admin', 'driver', 'parent');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT UNIQUE,
  role          user_role NOT NULL,
  device_id     TEXT,            -- drivers only: locked to one phone
  student_id    UUID,            -- parents only: linked after student created
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_role   ON users(role);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_read_own" ON users FOR SELECT USING (id = auth.uid());
```

---

#### 003_buses_routes.sql

```sql
CREATE TABLE buses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plate_number TEXT NOT NULL,
  capacity    INT NOT NULL DEFAULT 40,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX buses_tenant_plate_unique ON buses (tenant_id, upper(plate_number));

CREATE TABLE routes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  polyline  JSONB NOT NULL DEFAULT '[]', -- [{ lat, lng }, ...]
  stops     JSONB NOT NULL DEFAULT '[]', -- [{ name, lat, lng, order }, ...]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE students (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  route_id  UUID REFERENCES routes(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trip_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bus_id      UUID NOT NULL REFERENCES buses(id),
  route_id    UUID NOT NULL REFERENCES routes(id),
  driver_id   UUID NOT NULL REFERENCES users(id),
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(driver_id, assigned_date)
);

ALTER TABLE buses ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_assignments ENABLE ROW LEVEL SECURITY;

-- Admins can query all assets within their tenant
CREATE POLICY "admin_all_buses" ON buses FOR ALL USING (
  EXISTS (SELECT 1 FROM users AS admin_check WHERE admin_check.id = auth.uid() AND admin_check.role = 'admin' AND admin_check.tenant_id = buses.tenant_id)
);
CREATE POLICY "admin_all_routes" ON routes FOR ALL USING (
  EXISTS (SELECT 1 FROM users AS admin_check WHERE admin_check.id = auth.uid() AND admin_check.role = 'admin' AND admin_check.tenant_id = routes.tenant_id)
);
CREATE POLICY "admin_all_students" ON students FOR ALL USING (
  EXISTS (SELECT 1 FROM users AS admin_check WHERE admin_check.id = auth.uid() AND admin_check.role = 'admin' AND admin_check.tenant_id = students.tenant_id)
);
CREATE POLICY "admin_all_trip_assignments" ON trip_assignments FOR ALL USING (
  EXISTS (SELECT 1 FROM users AS admin_check WHERE admin_check.id = auth.uid() AND admin_check.role = 'admin' AND admin_check.tenant_id = trip_assignments.tenant_id)
);
```

---

#### 004_trips.sql

```sql
CREATE TYPE trip_status AS ENUM ('active', 'completed');

CREATE TABLE trips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES trip_assignments(id),
  bus_id        UUID NOT NULL REFERENCES buses(id),
  route_id      UUID NOT NULL REFERENCES routes(id),
  driver_id     UUID NOT NULL REFERENCES users(id),
  status        trip_status NOT NULL DEFAULT 'active',
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  ended_at      TIMESTAMPTZ
);

CREATE INDEX idx_trips_tenant_status ON trips(tenant_id, status);
CREATE INDEX idx_trips_driver        ON trips(driver_id);

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
```

---

#### 005_bus_locations.sql

```sql
CREATE TABLE bus_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  bus_id      UUID NOT NULL REFERENCES buses(id),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  speed_kmh   DOUBLE PRECISION NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bus_locations_trip   ON bus_locations(trip_id, recorded_at DESC);
CREATE INDEX idx_bus_locations_tenant ON bus_locations(tenant_id, recorded_at DESC);

ALTER TABLE bus_locations ENABLE ROW LEVEL SECURITY;

-- Admins can view all fleet locations within their tenant
CREATE POLICY "admin_all_bus_locations" ON bus_locations FOR ALL USING (
  EXISTS (SELECT 1 FROM users AS admin_check WHERE admin_check.id = auth.uid() AND admin_check.role = 'admin' AND admin_check.tenant_id = bus_locations.tenant_id)
);

-- Parents can only see locations for their assigned bus
CREATE POLICY bus_locations_parent ON bus_locations
  FOR SELECT USING (
    bus_id = (
      SELECT ta.bus_id FROM trips t
      JOIN trip_assignments ta ON ta.id = t.assignment_id
      JOIN students s ON s.route_id = ta.route_id
      JOIN users u ON u.student_id = s.id
      WHERE u.id = auth.uid() AND t.status = 'active'
      LIMIT 1
    )
  );

```

---

#### 010_latest_locations_view.sql

```sql
-- Optimized fleet view: get only the latest location ping for each bus
CREATE OR REPLACE VIEW latest_bus_locations AS
SELECT DISTINCT ON (bus_id)
  id, trip_id, bus_id, tenant_id, lat, lng, speed_kmh, recorded_at
FROM
  bus_locations
ORDER BY
  bus_id,
  recorded_at DESC;
```

---

#### 006_sos_events.sql

```sql
CREATE TABLE sos_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID NOT NULL REFERENCES trips(id),
  bus_id       UUID NOT NULL REFERENCES buses(id),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  notes        TEXT
);

ALTER TABLE sos_events ENABLE ROW LEVEL SECURITY;
```

---

#### 007_deviation_alerts.sql

```sql
CREATE TABLE deviation_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID NOT NULL REFERENCES trips(id),
  bus_id       UUID NOT NULL REFERENCES buses(id),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  distance_m   DOUBLE PRECISION NOT NULL,
  triggered_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE deviation_alerts ENABLE ROW LEVEL SECURITY;
```

---

#### 008_geofence_trigger.sql

```sql
CREATE OR REPLACE FUNCTION check_route_deviation()
RETURNS TRIGGER AS $$
DECLARE
  route_poly    JSONB;
  pt            JSONB;
  min_dist      FLOAT := 999999;
  dist          FLOAT;
  R             FLOAT := 6371000;
  lat1          FLOAT; lng1 FLOAT;
  lat2          FLOAT; lng2 FLOAT;
  dlat          FLOAT; dlng FLOAT;
BEGIN
  -- Fetch route polyline for this trip
  SELECT r.polyline INTO route_poly
  FROM trips t
  JOIN trip_assignments ta ON ta.id = t.assignment_id
  JOIN routes r ON r.id = ta.route_id
  WHERE t.id = NEW.trip_id;

  IF route_poly IS NULL THEN RETURN NEW; END IF;

  -- Haversine: find minimum distance to any polyline point
  FOR pt IN SELECT * FROM jsonb_array_elements(route_poly) LOOP
    lat1 := NEW.lat * PI() / 180;
    lng1 := NEW.lng * PI() / 180;
    lat2 := (pt->>'lat')::FLOAT * PI() / 180;
    lng2 := (pt->>'lng')::FLOAT * PI() / 180;
    dlat := lat2 - lat1;
    dlng := lng2 - lng1;
    dist := 2 * R * ASIN(SQRT(
      SIN(dlat/2)^2 + COS(lat1) * COS(lat2) * SIN(dlng/2)^2
    ));
    IF dist < min_dist THEN min_dist := dist; END IF;
  END LOOP;

  -- Insert deviation alert if beyond threshold
  IF min_dist > 200 THEN
    INSERT INTO deviation_alerts (
      trip_id, bus_id, tenant_id, lat, lng, distance_m, triggered_at
    ) VALUES (
      NEW.trip_id, NEW.bus_id, NEW.tenant_id,
      NEW.lat, NEW.lng, min_dist, NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_location_insert
  AFTER INSERT ON bus_locations
  FOR EACH ROW EXECUTE FUNCTION check_route_deviation();
```

---

#### 009_ml_predictions.sql

```sql
CREATE TABLE bus_eta_predictions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id         UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  eta_minutes    NUMERIC NOT NULL,
  confidence_pct NUMERIC NOT NULL,
  predicted_at   TIMESTAMPTZ DEFAULT now(),
  features_json  JSONB
);

CREATE INDEX idx_eta_bus_id ON bus_eta_predictions(bus_id);
CREATE INDEX idx_eta_predicted_at ON bus_eta_predictions(predicted_at DESC);

CREATE TABLE bus_route_recommendations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id         UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  recommended_at TIMESTAMPTZ DEFAULT now(),
  routes_json    JSONB NOT NULL
);

CREATE INDEX idx_route_bus_id ON bus_route_recommendations(bus_id);

ALTER TABLE bus_eta_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_route_recommendations ENABLE ROW LEVEL SECURITY;

-- Admins can view all ETAs within their tenant
CREATE POLICY "Admins can view tenant ETAs"
  ON bus_eta_predictions FOR SELECT TO authenticated USING (
    bus_id IN (
      SELECT b.id FROM buses b
      JOIN users u ON u.tenant_id = b.tenant_id
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Parents can only view the ETA for their child's active bus
CREATE POLICY "Parents view assigned bus ETA"
  ON bus_eta_predictions FOR SELECT TO authenticated USING (
    bus_id IN (
      SELECT ta.bus_id FROM trips t
      JOIN trip_assignments ta ON ta.id = t.assignment_id
      JOIN students s ON s.route_id = ta.route_id
      JOIN users u ON u.student_id = s.id
      WHERE u.id = auth.uid() AND t.status = 'active' AND u.role = 'parent'
    )
  );

-- Admins can read route recommendations
CREATE POLICY "Admins can read route recommendations"
  ON bus_route_recommendations FOR SELECT TO authenticated USING (
    bus_id IN (
      SELECT b.id FROM buses b
      JOIN users u ON u.tenant_id = b.tenant_id
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );
```

---

### 3.2 Entity relationship summary

```mermaid
tenants
  └── users          (tenant_id FK) — role: admin | driver | parent
  └── buses          (tenant_id FK)
       └── bus_eta_predictions       (bus_id FK) — ml eta, confidence
       └── bus_route_recommendations (bus_id FK) — ml route variants
  └── routes         (tenant_id FK) — polyline JSONB, stops JSONB
  └── students       (tenant_id FK) — route_id FK
       └── users.student_id → parent linked here

trip_assignments     (tenant, bus, route, driver, date)
  └── trips          (assignment_id FK) — status: active | completed
       └── bus_locations   (trip_id FK) — lat, lng, speed, ts
       └── sos_events      (trip_id FK)
       └── deviation_alerts(trip_id FK)
```

---

## 4. REST API Reference

**Base URL:** `http://localhost:3001` (dev) | `https://api.shieldtrack.app` (prod)
**Auth:** All protected routes require `Authorization: Bearer <jwt>`

---

### 4.1 Auth routes

#### POST /auth/login

No auth required.

**Request:**

```json
{
  "email": "driver@school.com",
  "password": "secret",
  "device_id": "abc123xyz"
}
```

For parents use `institute_code` + `student_id` instead of email:

```json
{
  "institute_code": "DEMO01",
  "student_id": "uuid-here"
}
```

**Response 200:**

```json
{
  "token": "eyJ...",
  "user": {
    "id": "uuid",
    "role": "driver",
    "tenant_id": "uuid",
    "name": "Ravi Kumar"
  }
}
```

**Response 401 (device mismatch):**

```json
{
  "error": "DEVICE_MISMATCH",
  "message": "This account is locked to another device."
}
```

---

#### POST /auth/logout

Auth required.

**Response 200:**

```json
{ "success": true }
```

---

### 4.2 Fleet routes (Admin only)

#### GET /fleet/buses

Returns all buses for the authenticated admin's tenant.

**Response 200:**

```json
[
  {
    "id": "uuid",
    "plate_number": "PB-65-1234",
    "capacity": 40,
    "active_trip": {
      "id": "uuid",
      "driver_name": "Ravi Kumar",
      "status": "active",
      "last_location": {
        "lat": 30.901,
        "lng": 75.8573,
        "speed_kmh": 42,
        "recorded_at": "..."
      }
    }
  }
]
```

---

#### POST /fleet/buses

**Request:**

```json
{ "plate_number": "PB-65-5678", "capacity": 40 }
```

**Response 201:**

```json
{ "id": "uuid", "plate_number": "PB-65-5678", "capacity": 40 }
```

---

#### DELETE /fleet/buses/:id

**Response 200:**

```json
{ "success": true }
```

---

#### GET /fleet/routes

**Response 200:**

```json
[
  {
    "id": "uuid",
    "name": "Route A — North Campus",
    "stops": [
      { "name": "Main Gate", "lat": 30.901, "lng": 75.857, "order": 1 },
      { "name": "Sector 12", "lat": 30.912, "lng": 75.861, "order": 2 }
    ],
    "polyline": [{ "lat": 30.901, "lng": 75.857 }, "..."]
  }
]
```

---

#### POST /fleet/routes

**Request:**

```json
{
  "name": "Route B — South Campus",
  "stops": [{ "name": "Gate 2", "lat": 30.895, "lng": 75.85, "order": 1 }],
  "polyline": [
    { "lat": 30.895, "lng": 75.85 },
    { "lat": 30.897, "lng": 75.853 }
  ]
}
```

**Response 201:**

```json
{ "id": "uuid", "name": "Route B — South Campus" }
```

---

#### DELETE /fleet/routes/:id

**Response 200:**

```json
{ "success": true }
```

---

#### GET /fleet/drivers

**Response 200:**

```json
[
  {
    "id": "uuid",
    "name": "Ravi Kumar",
    "email": "ravi@school.com",
    "device_id": "abc123"
  }
]
```

---

#### POST /fleet/students

**Request:**

```json
{ "name": "Arjun Singh", "route_id": "uuid" }
```

**Response 201:**

```json
{ "id": "uuid", "name": "Arjun Singh", "route_id": "uuid" }
```

---

#### POST /fleet/students/:id/link-parent

**Request:**

```json
{ "parent_id": "uuid" }
```

**Response 200:**

```json
{ "success": true }
```

---

### 4.3 User management (Admin only)

#### POST /users/invite

Creates a driver or parent account.

**Request (driver):**

```json
{
  "name": "Ravi Kumar",
  "email": "ravi@school.com",
  "password": "temp1234",
  "role": "driver"
}
```

**Request (parent):**

```json
{
  "name": "Gurpreet Singh",
  "role": "parent",
  "student_id": "uuid"
}
```

**Response 201:**

```json
{
  "id": "uuid",
  "role": "parent",
  "institute_code": "DEMO01",
  "student_id": "uuid",
  "login_hint": "Use institute code DEMO01 and student ID uuid to log in."
}
```

---

### 4.4 Assignment routes (Admin only)

#### POST /assignments

**Request:**

```json
{
  "bus_id": "uuid",
  "route_id": "uuid",
  "driver_id": "uuid",
  "assigned_date": "2025-04-01"
}
```

**Response 201:**

```json
{
  "id": "uuid",
  "bus_id": "uuid",
  "route_id": "uuid",
  "driver_id": "uuid",
  "assigned_date": "2025-04-01"
}
```

---

#### GET /assignments/today

Returns today's assignment for the authenticated driver.

**Response 200:**

```json
{
  "id": "uuid",
  "bus": { "id": "uuid", "plate_number": "PB-65-1234" },
  "route": {
    "id": "uuid",
    "name": "Route A",
    "stops": [{ "name": "Main Gate", "lat": 30.901, "lng": 75.857, "order": 1 }]
  },
  "assigned_date": "2025-04-01"
}
```

**Response 404:**

```json
{ "error": "NO_ASSIGNMENT", "message": "No assignment found for today." }
```

---

### 4.5 Trip routes

#### POST /trips/start

Driver only.

**Request:**

```json
{ "assignment_id": "uuid" }
```

**Response 201:**

```json
{
  "trip_id": "uuid",
  "bus_id": "uuid",
  "route_id": "uuid",
  "started_at": "2025-04-01T08:00:00Z"
}
```

---

#### POST /trips/:id/end

Driver only.

**Response 200:**

```json
{ "trip_id": "uuid", "status": "completed", "ended_at": "2025-04-01T09:15:00Z" }
```

---

#### GET /trips/active

Admin only. Returns all currently active trips for the tenant.

**Response 200:**

```json
[
  {
    "trip_id": "uuid",
    "bus": { "id": "uuid", "plate_number": "PB-65-1234" },
    "driver": { "id": "uuid", "name": "Ravi Kumar" },
    "route": { "id": "uuid", "name": "Route A" },
    "started_at": "2025-04-01T08:00:00Z",
    "last_location": {
      "lat": 30.901,
      "lng": 75.857,
      "speed_kmh": 38,
      "recorded_at": "..."
    }
  }
]
```

---

#### GET /trips/current

Parent only. Returns the active trip for the parent's assigned bus.

**Response 200:**

```json
{
  "trip_id": "uuid",
  "bus_id": "uuid",
  "status": "active",
  "started_at": "2025-04-01T08:00:00Z",
  "last_location": {
    "lat": 30.901,
    "lng": 75.857,
    "speed_kmh": 38,
    "recorded_at": "..."
  }
}
```

**Response 404:**

```json
{ "error": "NO_ACTIVE_TRIP", "message": "Bus has not started yet." }
```

---

### 4.6 SOS routes

#### POST /sos

Driver only.

**Request:**

```json
{ "trip_id": "uuid", "lat": 30.901, "lng": 75.857 }
```

**Response 201:**

```json
{ "sos_id": "uuid", "triggered_at": "2025-04-01T08:32:00Z" }
```

**Side effects:**

- Inserts row in `sos_events`
- Sends FCM push to all admins in tenant
- Sends FCM push to all parents whose students are on this bus

---

#### PATCH /sos/:id/resolve

Admin only.

**Request:**

```json
{ "notes": "Driver called — minor road blockage, no emergency." }
```

**Response 200:**

```json
{ "sos_id": "uuid", "resolved_at": "2025-04-01T08:45:00Z" }
```

---

### 4.7 Reports routes (Admin only)

#### GET /reports/trips

**Query params:** `?from=2025-03-01&to=2025-03-31`

**Response 200:**

```json
[
  {
    "trip_id": "uuid",
    "bus_plate": "PB-65-1234",
    "driver_name": "Ravi Kumar",
    "route_name": "Route A",
    "started_at": "2025-03-28T08:00:00Z",
    "ended_at": "2025-03-28T09:10:00Z",
    "duration_minutes": 70
  }
]
```

---

#### GET /reports/sos

**Query params:** `?from=&to=`

**Response 200:**

```json
[
  {
    "sos_id": "uuid",
    "bus_plate": "PB-65-1234",
    "driver_name": "Ravi Kumar",
    "lat": 30.901,
    "lng": 75.857,
    "triggered_at": "2025-03-28T08:32:00Z",
    "resolved_at": "2025-03-28T08:45:00Z",
    "notes": "Minor road blockage."
  }
]
```

---

#### GET /reports/deviations

**Query params:** `?from=&to=`

**Response 200:**

```json
[
  {
    "alert_id": "uuid",
    "bus_plate": "PB-65-1234",
    "route_name": "Route A",
    "lat": 30.901,
    "lng": 75.857,
    "distance_m": 340,
    "triggered_at": "2025-03-28T08:22:00Z"
  }
]
```

---

## 5. Realtime Architecture

GPS and alerts flow through Supabase Realtime — no WebSocket server needed.

### 5.1 Driver writes GPS (mobile app)

```ts
// apps/mobile/tasks/gpsTask.ts
await supabase.from("bus_locations").insert({
  trip_id,
  bus_id,
  tenant_id,
  lat: location.coords.latitude,
  lng: location.coords.longitude,
  speed_kmh: (location.coords.speed ?? 0) * 3.6,
  recorded_at: new Date().toISOString(),
});
```

---

### 5.2 Admin subscribes (all buses in tenant)

```ts
// apps/shield-admin/src/hooks/useFleetRealtime.ts
const channel = supabase
  .channel(`fleet-${tenantId}`)
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "bus_locations",
      filter: `tenant_id=eq.${tenantId}`,
    },
    (payload) => updateBusPin(payload.new),
  )
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "deviation_alerts",
      filter: `tenant_id=eq.${tenantId}`,
    },
    (payload) => showDeviationAlert(payload.new),
  )
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "sos_events",
      filter: `tenant_id=eq.${tenantId}`,
    },
    (payload) => showSOSModal(payload.new),
  )
  .subscribe();
```

---

### 5.3 Parent subscribes (single bus, RLS enforced)

```ts
// apps/mobile/hooks/useBusRealtime.ts
const channel = supabase
  .channel(`bus-${busId}`)
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "bus_locations",
      filter: `bus_id=eq.${busId}`,
    },
    (payload) => {
      updateBusPin(payload.new);
      addSpeedReading(payload.new.speed_kmh);
    },
  )
  .subscribe();
```

RLS on `bus_locations` ensures the parent cannot subscribe to any other bus even if they manually change the `busId`.

---

## 6. Shared Utilities

Located in `packages/utils/index.ts`. Imported by mobile + admin.

### 6.1 Haversine distance

```ts
export const haversine = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const R = 6371000,
    r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)); // metres
};
```

### 6.3 Shared TypeScript interfaces (`packages/types/index.ts`)

```ts
export interface Tenant {
  id: string;
  name: string;
  institute_code: string;
}
export interface User {
  id: string;
  tenant_id: string;
  email?: string;
  role: "admin" | "driver" | "parent";
  device_id?: string;
  student_id?: string;
}
export interface Bus {
  id: string;
  tenant_id: string;
  plate_number: string;
  capacity: number;
}
export interface Stop {
  name: string;
  lat: number;
  lng: number;
  order: number;
}
export interface Route {
  id: string;
  tenant_id: string;
  name: string;
  polyline: { lat: number; lng: number }[];
  stops: Stop[];
}
export interface Student {
  id: string;
  tenant_id: string;
  name: string;
  route_id: string;
}
export interface TripAssignment {
  id: string;
  bus_id: string;
  route_id: string;
  driver_id: string;
  assigned_date: string;
}
export interface Trip {
  id: string;
  tenant_id: string;
  assignment_id: string;
  bus_id: string;
  route_id: string;
  driver_id: string;
  status: "active" | "completed";
  started_at: string;
  ended_at?: string;
}
export interface BusLocation {
  id: string;
  trip_id: string;
  bus_id: string;
  tenant_id: string;
  lat: number;
  lng: number;
  speed_kmh: number;
  recorded_at: string;
}
export interface SOSEvent {
  id: string;
  trip_id: string;
  bus_id: string;
  tenant_id: string;
  lat: number;
  lng: number;
  triggered_at: string;
  resolved_at?: string;
  notes?: string;
}
export interface DeviationAlert {
  id: string;
  trip_id: string;
  bus_id: string;
  tenant_id: string;
  lat: number;
  lng: number;
  distance_m: number;
  triggered_at: string;
}
```

---

## 7. Development Phases

### Legend

| Symbol | Meaning                                |
| ------ | -------------------------------------- |
| `[ ]`  | Not started                            |
| `[~]`  | In progress                            |
| `[x]`  | Complete                               |
| 🔴     | Blocker — nothing downstream can start |
| 🟡     | High priority                          |
| 🟢     | Parallel / lower risk                  |

---

### Phase 0 — Foundation

> **Target: Hours 0–4. Must be 100% done before feature work.**

**Module 0.1 — Monorepo Setup** 🔴

- [x] Turborepo root initialised
- [~] `apps/mobile`, `apps/shield-admin`, `apps/api` in place
- [x] `packages/types`, `packages/utils` in place
- [x] Root `package.json` workspaces verified
- [x] `turbo.json` pipeline configured
- [x] `npm install` from root passes
- [ ] All three apps start independently

**Module 0.2 — Supabase Project** 🔴

- [x] Supabase project created, URL + anon key saved
- [x] Migration 001 — tenants
- [x] Migration 002 — users
- [x] Migration 003 — buses, routes, students, assignments
- [x] Migration 004 — trips
- [x] Migration 005 — bus_locations + RLS policy
- [x] Migration 006 — sos_events
- [x] Migration 007 — deviation_alerts
- [x] Migration 008 — geofence trigger deployed and tested
- [x] Migration 009 — ML prediction tables
- [x] Migration 010 — latest_bus_locations optimization view
- [x] Supabase Realtime enabled: `bus_locations`, `deviation_alerts`, `sos_events`, `bus_eta_predictions`, `bus_route_recommendations`

**Module 0.3 — Shared Packages** 🔴

- [x] `packages/types/index.ts` — all interfaces
- [x] `packages/utils/index.ts` — `haversine()`
- [x] Both importable as `@shieldtrack/types` and `@shieldtrack/utils`

**Module 0.4 — Supabase Clients** 🔴

- [ ] `apps/mobile/lib/supabase.ts` — AsyncStorage auth
- [ ] `apps/api/src/lib/supabase.ts` — service role client
- [ ] `apps/shield-admin/src/lib/supabase.ts` — anon client
- [x] Central `.env` root file configured for all apps

**Module 0.5 — Seed Data** 🟡

- [ ] 1 tenant (`institute_code: "DEMO01"`)
- [ ] 1 admin, 2 drivers, 3 parents
- [ ] 3 buses, 2 routes with real GPS polylines
- [ ] Students linked to parents and routes
- [ ] Today's trip assignments pre-created
- [ ] `npm run seed` works from `apps/api`

---

### Phase 1 — Authentication

> **Target: Hours 4–8. Parallel: 1A+1B one person, 1C another.**

**Module 1A — API Auth** 🔴

- [ ] `POST /auth/login` — email/password flow
- [ ] `POST /auth/login` — institute code + student ID flow (parent)
- [ ] Device ID check for drivers on every login
- [ ] JWT issued with `{ userId, tenantId, role, studentId? }`
- [ ] `verifyToken` middleware
- [ ] `requireRole(role)` middleware
- [ ] `injectTenant` middleware
- [ ] `POST /auth/logout`

**Module 1B — Mobile Auth** 🔴

- [ ] `apps/mobile/app/login.tsx` — UI for both driver and parent login
- [ ] Role detection from JWT, session persisted via AsyncStorage
- [ ] `apps/mobile/app/_layout.tsx` — role fork on app load
- [ ] Redirect to `/(driver)/trip` or `/(parent)/tracker` based on role
- [ ] Device ID captured via `expo-device` on driver login
- [ ] Device mismatch error shown

**Module 1C — Admin Auth** 🟢

- [x] `apps/shield-admin/src/components/LoginScreen.tsx` — Email + Password form
- [x] Supabase Session handling (automatic persistence)
- [x] Conditional rendering in `App.tsx` (replaces `ProtectedRoute`)
- [x] Immediate state hydration on session detection

---

### Phase 2 — Core GPS Pipeline

> **Target: Hours 8–16. Highest risk. Build and TEST on real device before anything else.**

**Module 2A — Driver GPS Broadcast** 🔴

- [ ] `apps/mobile/tasks/gpsTask.ts` — expo-task-manager background task registered
- [ ] `expo-location startLocationUpdatesAsync` configured (7s interval, high accuracy)
- [ ] Foreground service notification enabled (Android keep-alive)
- [ ] GPS fires correctly with screen locked — verified on physical Android device
- [ ] Each heartbeat inserts row to `bus_locations` via Supabase client
- [ ] `speed_kmh` calculated from `location.coords.speed * 3.6`
- [ ] `useGPSBroadcast` hook: `startBroadcast(tripId)` + `stopBroadcast()`
- [ ] Graceful offline retry if insert fails

**Module 2B — Driver Trip Screen** 🟡

- [ ] `apps/mobile/app/(driver)/trip.tsx` UI complete
- [ ] Shows today's assignment (bus plate + route name)
- [ ] "Go Online" button → `POST /trips/start` → starts GPS task
- [ ] Live speed display on screen
- [ ] ONLINE / OFFLINE status indicator
- [ ] "End Route" button → `POST /trips/:id/end` → stops GPS task
- [ ] `apps/mobile/app/(driver)/sos-confirm.tsx` — confirmation modal

**Module 2C — Admin Fleet Map** 🟡

- [x] `useFleetRealtime` hook — Supabase channel for tenant
- [x] Listens to `bus_locations`, `deviation_alerts`, `sos_events` INSERTs
- [x] `apps/shield-admin/src/components/MainDashboard.tsx` with Leaflet.js
- [x] Optimized initial load using `latest_bus_locations` view (replaces client-side reduction)
- [x] Bus pins render and update position in real time
- [ ] Tooltip: plate, driver name, speed, last update time
- [ ] Offline bus shown as greyed-out pin

**Module 2D — Parent Live Map** 🟡

- [ ] `useBusRealtime` hook — single bus channel, speed history array maintained
- [ ] `apps/mobile/app/(parent)/tracker.tsx` — react-native-maps
- [ ] Bus pin animates to new position on each heartbeat
- [ ] ETA card: minutes remaining + estimated arrival time
- [ ] "Bus not started" empty state

**Module 2E — ML Backend Integration** 🟡

- [x] Python backend set up and running locally
- [x] Synthetic data generated and ETA model trained
- [ ] Active GPS simulate script updated to call `POST /predict/eta`
- [ ] Parent app updated to subscribe to `bus_eta_predictions` table via Realtime
- [ ] Admin panel updated to display alternative `bus_route_recommendations`

---

### Phase 3 — SOS & Deviation Alerts

> **Target: Hours 16–20. Parallel: 3A and 3B can be split.**

**Module 3A — SOS Flow** 🔴

- [ ] `POST /sos` endpoint complete (inserts + triggers FCM)
- [ ] Firebase Admin SDK configured in `apps/api`
- [ ] FCM push to all admin users of tenant on SOS
- [ ] FCM push to all parents whose students are on the bus
- [ ] SOS button on driver trip screen (large, prominent)
- [ ] Confirmation modal before trigger
- [ ] 30-second lock after SOS fires (anti-spam)
- [ ] Haptic feedback on SOS trigger
- [ ] `PATCH /sos/:id/resolve` — admin resolves event

**Module 3B — SOS Alert — Admin** 🟡

- [ ] Supabase Realtime receives `sos_events` INSERT
- [ ] SOS modal auto-opens on fleet map
- [ ] Affected bus pin turns red with pulse animation
- [ ] SOS alert log panel shows all events
- [ ] Resolve button calls `PATCH /sos/:id/resolve`

**Module 3C — SOS Alert — Parent** 🟡

- [ ] FCM notification received on parent device
- [ ] Tap opens app at tracker screen
- [ ] "Emergency Alert" banner on tracker
- [ ] `apps/mobile/app/(parent)/notifications.tsx` shows alert history

**Module 3D — Route Deviation** 🟡

- [ ] DB trigger confirmed firing correctly (tested with off-route coordinates)
- [ ] `deviation_alerts` rows visible in Supabase dashboard
- [ ] Admin receives deviation via Realtime → pin turns orange
- [ ] Admin alert panel distinguishes deviation (orange) vs SOS (red)
- [ ] Parent receives deviation banner: "Bus is 340m off route"

---

### Phase 4 — Admin Fleet Management (CRUD)

> **Target: Hours 20–28. Pure CRUD — distribute freely across team.**

**Module 4A — Bus Management** 🟢

- [ ] `GET /fleet/buses` + `POST /fleet/buses` + `DELETE /fleet/buses/:id`
- [ ] Admin UI: buses table + add form + delete

**Module 4B — Route Management** 🟢

- [ ] `GET /fleet/routes` + `POST /fleet/routes` + `DELETE /fleet/routes/:id`
- [ ] Admin UI: routes list + form (polyline as JSON textarea for MVP)

**Module 4C — Driver Management** 🟢

- [ ] `GET /fleet/drivers` + `POST /users/invite` (driver)
- [ ] Admin UI: drivers table + invite form

**Module 4D — Student & Parent Management** 🟢

- [ ] `GET /students` + `POST /fleet/students` + `POST /fleet/students/:id/link-parent`
- [ ] `POST /users/invite` (parent) — returns institute code + student ID
- [ ] Admin UI: students table + parent link modal

**Module 4E — Trip Assignment** 🟡

- [ ] `POST /assignments` + `GET /assignments/today`
- [ ] Admin UI: assignment form (driver + bus + route + date)
- [ ] Driver trip screen reads today's assignment on load

---

### Phase 5 — Reports

> **Target: Hours 28–32. Can be cut if behind on Phase 3.**

**Module 5A — Reports API** 🟢

- [ ] `GET /reports/trips?from=&to=`
- [ ] `GET /reports/sos?from=&to=`
- [ ] `GET /reports/deviations?from=&to=`

**Module 5B — Reports UI** 🟢

- [ ] Trips table with date range filter
- [ ] SOS events table with resolved status
- [ ] Deviation events table
- [ ] All tables sortable by date

---

### Phase 6 — Polish & Demo Prep

> **Start only after Phase 0–3 are all green.**

**Module 6A — Stability** 🟡

- [ ] Offline GPS queuing (retry failed inserts)
- [ ] Session expiry → auto logout + redirect
- [ ] Loading skeletons on all data-fetch screens
- [ ] Empty states on all list views
- [ ] Error boundaries on admin web app

**Module 6B — Demo Data** 🔴

- [ ] Route polyline follows a real road (extract from Google Maps)
- [ ] Pre-seeded trip history (last 7 days)
- [ ] At least 1 SOS event in history
- [ ] At least 1 deviation event in history
- [ ] Credentials doc: login details for all three roles ready for judges

**Module 6C — Demo Flow Rehearsal** 🔴

- [ ] Admin logs in → fleet dashboard shows (no buses online)
- [ ] Driver logs in on phone → taps "Go Online"
- [ ] Admin sees bus pin appear and move on map
- [ ] Parent app shows pin move + ETA counting down
- [ ] Driver taps SOS → admin gets modal, parent gets notification
- [ ] Driver taps "End Route" → bus goes offline on all screens
- [ ] Admin shows trip history + SOS log
- [ ] Full rehearsal timed: target under 3 minutes

---

## 8. Team Assignment & Tracking

### Dependency order

```mermaid
Phase 0 (Foundation)
    └── Phase 1 (Auth)
            ├── Phase 2 (GPS Pipeline)      ← critical path
            │       └── Phase 3 (SOS/Alerts)
            │               └── Phase 5 (Reports)
            └── Phase 4 (Fleet CRUD)        ← fully parallel to Phase 2
                        └── Phase 5 (Reports)

Phase 6 (Polish) — after Phase 0–3 are complete
```

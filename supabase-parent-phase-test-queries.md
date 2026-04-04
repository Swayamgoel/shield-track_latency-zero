# Supabase Manual Test Queries (Parent Phases)

Use this guide in Supabase SQL Editor.

## 1) Collect Required Info First

Run these queries top-to-bottom and copy values you need for the data setup section.

### 1.1 Tenants

```sql
SELECT id, name, institute_code, created_at
FROM public.tenants
ORDER BY created_at DESC;
```

### 1.2 Buses (for one tenant)

Replace `YOUR_TENANT_ID`.

```sql
SELECT id, tenant_id, plate_number, capacity, created_at
FROM public.buses
WHERE tenant_id = 'YOUR_TENANT_ID'
ORDER BY created_at DESC;
```

### 1.3 Routes (for one tenant)

Replace `YOUR_TENANT_ID`.

```sql
SELECT id, tenant_id, name, created_at
FROM public.routes
WHERE tenant_id = 'YOUR_TENANT_ID'
ORDER BY created_at DESC;
```

### 1.4 Drivers (for one tenant)

Replace `YOUR_TENANT_ID`.

```sql
SELECT id, tenant_id, email, role, created_at
FROM public.users
WHERE tenant_id = 'YOUR_TENANT_ID'
  AND role = 'driver'
ORDER BY created_at DESC;
```

### 1.5 Students (for one tenant)

Replace `YOUR_TENANT_ID`.

```sql
SELECT id, tenant_id, name, registration_no, route_id, created_at
FROM public.students
WHERE tenant_id = 'YOUR_TENANT_ID'
ORDER BY created_at DESC;
```

### 1.6 Optional: Existing assignments/trips for a bus

Replace `YOUR_BUS_ID`.

```sql
SELECT id, tenant_id, bus_id, route_id, driver_id, assigned_date, created_at
FROM public.trip_assignments
WHERE bus_id = 'YOUR_BUS_ID'
ORDER BY created_at DESC;

SELECT id, tenant_id, assignment_id, bus_id, route_id, driver_id, status, started_at, ended_at
FROM public.trips
WHERE bus_id = 'YOUR_BUS_ID'
ORDER BY started_at DESC;
```

---

## 2) Fill These Values From Step 1

Before running setup queries below, replace placeholders:

- `d9d73bac-a482-4c19-98c4-7956f7d31e55`- `TENANT_ID`
- `1a61f882-0cfe-4914-8d36-b5a08b145a31`- `BUS_ID`
- `23e386e4-42e7-4c28-83c0-55feb4bb7ad8`- `ROUTE_ID`
- `9e195574-fc55-4cb0-8325-e11211a2d2bb`- `DRIVER_ID`
- student registration numbers (`ST-001`, `ST-002`)

---

## 3) Delete Old Bus Trip/Test Data

This clears previous trip-related rows for one bus, then removes assignments/trips for a clean test state.

```sql
BEGIN;

-- 1) Child tables first
DELETE FROM public.bus_locations
WHERE bus_id = 'BUS_ID';

DELETE FROM public.sos_events
WHERE bus_id = 'BUS_ID';

DELETE FROM public.deviation_alerts
WHERE bus_id = 'BUS_ID';

-- 2) Parent tables
DELETE FROM public.trips
WHERE bus_id = 'BUS_ID';

DELETE FROM public.trip_assignments
WHERE bus_id = 'BUS_ID';

COMMIT;
```

---

## 4) Attach Students to the Route (for Parent Testing)

Use registration numbers for students you want to test with.

```sql
UPDATE public.students
SET route_id = 'ROUTE_ID'
WHERE tenant_id = 'TENANT_ID'
  AND registration_no IN ('REG001', 'REG002', 'REG003');
```

Check updated students:

```sql
SELECT id, name, registration_no, route_id
FROM public.students
WHERE tenant_id = 'TENANT_ID'
  AND registration_no IN ('REG001', 'REG002', 'REG003')
ORDER BY registration_no;
```

---

## 5) Create New Assignment + Active Trip

```sql
BEGIN;

WITH new_assignment AS (
  INSERT INTO public.trip_assignments (
    tenant_id, bus_id, route_id, driver_id, assigned_date
  )
  VALUES (
    'TENANT_ID', 'BUS_ID', 'ROUTE_ID', 'DRIVER_ID', CURRENT_DATE
  )
  RETURNING id, tenant_id, bus_id, route_id, driver_id
)
INSERT INTO public.trips (
  tenant_id, assignment_id, bus_id, route_id, driver_id, status, started_at, ended_at
)
SELECT
  tenant_id,
  id,
  bus_id,
  route_id,
  driver_id,
  'active',
  now(),
  NULL
FROM new_assignment;

COMMIT;
```

---

## 6) Insert Test Realtime Data (Optional but Useful)

This helps validate parent tracker and alerts UI.

### 6.1 Get latest active trip for the bus

```sql
SELECT id, tenant_id, bus_id, route_id, driver_id, status, started_at
FROM public.trips
WHERE bus_id = 'BUS_ID' AND status = 'active'
ORDER BY started_at DESC
LIMIT 1;
```

Copy `TRIP_ID - 1357ead5-0fe5-49c2-86af-61388fd72654` from result.

### 6.2 Insert a bus location ping

```sql
INSERT INTO public.bus_locations (
  trip_id, bus_id, tenant_id, lat, lng, speed_kmh, recorded_at
)
VALUES (
  'TRIP_ID', 'BUS_ID', 'TENANT_ID', 20.5937, 78.9629, 32, now()
);
```

### 6.3 Insert a route deviation alert

```sql
INSERT INTO public.deviation_alerts (
  trip_id, bus_id, tenant_id, lat, lng, distance_m, triggered_at
)
VALUES (
  'TRIP_ID', 'BUS_ID', 'TENANT_ID', 20.5942, 78.9635, 410, now()
);
```

### 6.4 Insert an SOS event

```sql
INSERT INTO public.sos_events (
  trip_id, bus_id, tenant_id, lat, lng, triggered_at, notes
)
VALUES (
  'TRIP_ID', 'BUS_ID', 'TENANT_ID', 20.5944, 78.9638, now(), 'Manual parent-phase test SOS'
);
```

---

## 7) Verify Results Quickly

```sql
SELECT id, bus_id, status, started_at, ended_at
FROM public.trips
WHERE bus_id = 'BUS_ID'
ORDER BY started_at DESC
LIMIT 5;

SELECT id, bus_id, triggered_at, notes
FROM public.sos_events
WHERE bus_id = 'BUS_ID'
ORDER BY triggered_at DESC
LIMIT 5;

SELECT id, bus_id, distance_m, triggered_at
FROM public.deviation_alerts
WHERE bus_id = 'BUS_ID'
ORDER BY triggered_at DESC
LIMIT 5;
```

---

## Notes

- Run in SQL Editor manually with your own IDs.
- If any delete fails due to constraints in your live DB, delete child rows first (as shown), then parent rows.
- Keep one active trip for clean parent-app testing.

# ShieldTrack — Project Context

## Overview
ShieldTrack is a school bus safety & tracking platform built as a multi-tenant monorepo (pnpm + Turborepo). It connects three roles: **Admins**, **Drivers**, and **Parents**, backed by Supabase (PostgreSQL + Auth) and a Python ML service.

---

## Monorepo Structure
```
ShieldTrack/
├── apps/
│   ├── mobile/          # React Native (Expo 54) — Driver & Parent app
│   ├── api/             # Node.js (Express + TypeScript) — Custom REST backend
│   └── shield-admin/    # React (Vite) — Admin dashboard
├── backend/             # Python (FastAPI) — ML backend (ETA prediction, route optimizer)
├── packages/
│   ├── types/           # Shared TypeScript types across all apps
│   ├── utils/           # Shared utility helpers
│   ├── eslint-config/   # Shared ESLint config
│   └── typescript-config/
└── db_schema_context.sql  # Reference Supabase schema (not runnable directly)
```

---

## Apps

### Mobile (`apps/mobile`) — Expo + React Native
- Single login screen with a **Driver / Parent toggle**
- **Driver login**: email + `institute_code` → Node.js REST API (`/auth/driver-login`) → custom JWT (7-day expiry)
- **Parent login**: `institute_code` + `registration_no` → Node.js REST API (`/auth/login`) → custom JWT (7-day expiry)
- Post-login routing: drivers → `/trip`, parents → `/tracker`
- Session stored in `AsyncStorage` (`shieldtrack.session.v1`), typed as `DriverSession | ParentSession`
- Mock mode available via `EXPO_PUBLIC_USE_MOCKS=1`
- **All env vars are read from the root `.env`** — no separate mobile `.env` in use

### API (`apps/api`) — Express + TypeScript
- Custom REST backend for operations Supabase Auth cannot handle natively
- `/auth/login` (POST): validates `institute_code` → `tenants` table, then `registration_no` → `students` table, mints a custom JWT (7-day expiry) using `SUPABASE_JWT_SECRET`
- Runs on **port 3001**; mobile reads base URL from `EXPO_PUBLIC_API_BASE_URL`
- Uses Supabase **service role client** (bypasses RLS) for admin DB queries
- Other route stubs: `/fleet`, `/sos`, `/trips` (in progress)

### Shield Admin (`apps/shield-admin`) — React + Vite
- Admin dashboard for fleet monitoring (real-time bus locations via Supabase subscriptions)
- Connects to Supabase with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- Manages: Tenants, Buses, Routes, Students, Trips, SOS Events, Deviation Alerts

### ML Backend (`backend/`) — FastAPI + Python
- `POST /predict/eta` — ML model (scikit-learn pickle) predicts bus arrival time
- `POST /predict/route` — Graph-based route optimizer returns ranked route options
- `POST /predict/batch-eta` — Batch ETA for all buses (useful for simulation)
- Results are persisted to Supabase asynchronously (non-blocking background task)
- Optional Google Maps integration for live traffic delay; falls back to simulated congestion

---

## Database (Supabase / PostgreSQL)
Key tables (all PKs are `uuid DEFAULT gen_random_uuid()`):
- `tenants` — schools/institutes; has unique `institute_code`
- `users` — drivers + admins; custom-managed (for drivers); has `role`, `tenant_id`, `device_id`
- `students` — student records; has `registration_no` (unique per tenant, used for parent login), linked to `tenant_id` and optional `route_id`
- `buses` — fleet vehicles per tenant
- `routes` — polyline + stops per tenant
- `trip_assignments` — daily bus-driver-route assignments
- `trips` — active/completed trips with status enum (`active`, `completed`)
- `bus_locations` — real-time GPS pings per trip
- `sos_events` / `deviation_alerts` — safety event logs
- `bus_eta_predictions` / `bus_route_recommendations` — ML output storage
- View: `latest_bus_locations` — most recent ping per bus (used by admin dashboard)

---

## Key Environment Variables
> All apps read from the **single root `.env`** file. Do not create per-app `.env` files.

| Variable | Used By | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Mobile | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Mobile | Public anon key |
| `EXPO_PUBLIC_API_BASE_URL` | Mobile | Node API base URL — use LAN IP on physical devices |
| `EXPO_PUBLIC_USE_MOCKS` | Mobile | Set to `1` to bypass backend for UI testing |
| `VITE_SUPABASE_URL` | Shield Admin | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Shield Admin | Public anon key |
| `SUPABASE_URL` | API (Node), ML (Python) | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | API (Node), ML (Python) | Service role key — never expose publicly |
| `SUPABASE_JWT_SECRET` | API (Node) | Signs parent session JWTs |
| `GOOGLE_MAPS_API_KEY` | ML Backend | Optional; defaults to `mock` |

---

## Mobile App — Styling Rules (CRITICAL — READ BEFORE WRITING ANY UI)

The mobile app uses **NativeWind v4** with the following `babel.config.js`:
```js
["babel-preset-expo", { jsxImportSource: "nativewind" }],
"nativewind/babel",
```

`jsxImportSource: "nativewind"` means NativeWind **replaces the JSX factory for every element in every file**, including third-party components. This creates hard rules you must follow:

### Rule 1 — NEVER mix `className` and `style` on `Animated.View` / `Animated.Text`

**Why it crashes:** When `Animated.View` has both `className` and `style`, NativeWind's interop merges them. During the merge it processes the `style` array — which includes `Animated.Value` references (e.g. `transform: [{ scale: pulseAnim }]`). NativeWind converts the `Animated.Value` to a plain value and forwards it to the native Fabric component setter. Fabric receives a `String` type where it expects a Fabric-typed animated prop → **`java.lang.String cannot be cast to java.lang.Boolean`** crash at `setProperty → preallocateView`.

**Fix:** On any `Animated.View` or `Animated.Text`, use **only** the `style` prop. No `className` allowed.

```tsx
// ✅ CORRECT — all styles in the style prop
<Animated.View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: '#0d1a33', transform: [{ scale: pulseAnim }] }}>

// ❌ WRONG — mixes className + style with Animated.Value
<Animated.View className="w-[88px] h-[88px] rounded-full" style={{ transform: [{ scale: pulseAnim }] }}>
```

### Rule 2 — NEVER use 8-digit hex color values in any `style` prop

**Why it crashes:** Android's native color parser (used by React Native Bridge and Fabric) does **not** support CSS-style 8-digit hex (`#RRGGBBAA`). It is iOS/CSS-only. Using it causes a type mismatch in the native `setProperty` setter.

```tsx
// ✅ CORRECT
style={{ backgroundColor: 'rgba(21, 21, 26, 0.95)' }}
style={{ backgroundColor: '#ff3b3033' }}  // NO — this is 8-digit hex

// ❌ WRONG
style={{ backgroundColor: '#15151af0' }}
style={{ backgroundColor: `${color}22` }}  // string concat creates 8-digit hex

// ✅ Use rgba() instead of hex+alpha
style={{ backgroundColor: 'rgba(255, 59, 48, 0.2)' }}
```

### Rule 3 — NEVER pass `userInterfaceStyle` to `<MapView>` on Android

`userInterfaceStyle` is an iOS-only prop. On Android, the native `MapView` prop setter receives a `String` and tries to cast it to `Boolean` → crash. Simply omit the prop.

### Rule 4 — Parent layout must use `<Slot>` (not `<Tabs>`)

During Phase 2D development, switching `(parent)/_layout.tsx` from `<Slot />` to Expo Router's `<Tabs>` component caused persistent crashes on Android with New Architecture. The exact native component incompatibility was not fully isolated, but the `<Tabs>` component from `@react-navigation/bottom-tabs` v7.x interacts adversely with the project's current React Native 0.81.5 + NativeWind v4 setup.

**The established pattern for both driver and parent layouts is `<Slot>` with a session guard.** Tab-like navigation in the parent app is implemented via a custom `TabBar` component (plain `View` + `Pressable`) inside `tracker.tsx` with `activeTab` state.

### Rule 5 — `isParentSession` must accept `bus_id: string | null`

`ParentSession.bus_id` is typed as `string | null` — `null` is valid when the student has no active bus assignment yet. The validator must reflect this:
```ts
// ✅ CORRECT
(typeof session.bus_id === 'string' || session.bus_id === null)

// ❌ WRONG — rejects real sessions where bus hasn't started
typeof session.bus_id === 'string'
```

---

## Mobile App — Architecture Decisions

### Parent App Navigation
The parent's "Live Tracker" and "Alerts" tabs are **NOT** implemented as separate Expo Router screens with a tab navigator. Instead:
- `(parent)/_layout.tsx` → `<Slot />` with session guard (same pattern as driver)
- `(parent)/tracker.tsx` → Single screen that owns the full parent UI
- `(parent)/NotificationsPanel.tsx` → Reusable component rendered inside `tracker.tsx` when the Alerts tab is active
- `(parent)/notifications.tsx` → Simple `<Redirect href="/tracker" />` stub

This avoids the React Navigation native tab bar while preserving the two-panel UX.

### Styling in screens that use `react-native-maps` or `Animated`
Use **plain inline `style` objects** (not `className`) for any component that is:
1. An `Animated.*` component
2. A `MapView` or `Marker` from `react-native-maps`
3. Inside a component tree where prop types must be precisely controlled

Use `className` freely on static `View`, `Text`, `Pressable` and `ScrollView` components.

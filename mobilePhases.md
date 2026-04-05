# Mobile Pending Phases Tracker

This file tracks pending mobile-side items and current progress based on implemented code.

## Summary

- Total pending tracks: 8
- Implemented now: Driver Login Device Binding
- Last updated: 2026-04-05

## 1) Driver Login Device Binding

- Scope: Capture device ID on mobile driver login, bind first login device in backend, reject mismatched devices.
- Progress: 95%
- Done:
  - Device ID captured in mobile login using a persisted local token in AsyncStorage.
  - Driver login request now sends `device_id` along with existing credentials.
  - API validates `device_id` is present.
  - API checks stored `users.device_id` and rejects mismatch (`DEVICE_MISMATCH`).
  - API binds `users.device_id` when logging in first time.
- Remaining:
  - End-to-end verification on real driver device and one mismatch-device negative test.

## 2) Driver GPS Broadcast Contract (7s + resilience)

- Scope: Match heartbeat spec and support retries.
- Progress: 92%
- Done:
  - Background location task implemented and integrated from app root.
  - GPS heartbeat configured to target ~7 seconds.
  - Foreground service notification present.
  - API insertion path for location updates is working.
  - Retry queue implemented for failed location inserts and auto-flushed on next successful ticks.
  - Replay throttle added to smooth retry burst load.
  - Telemetry counters added for live/replay success-failure and queue pressure tracking.
- Remaining:
  - Validate lock-screen behavior on physical Android.
  - Tune queue retention strategy (currently queue is cleared when trip stops).

## 3) Parent Push Notifications (FCM receive/open flow)

- Scope: Parent device receives SOS/deviation push and tap opens tracker.
- Progress: 20%
- Done:
  - `expo-notifications` dependency present.
  - In-app realtime banners and notifications history screen implemented.
- Remaining:
  - Register push token and listeners in mobile app.
  - Handle notification tap routing to tracker screen.
  - Verify payload handling for SOS and deviation.

## 4) SOS Anti-Spam Lock (30s)

- Scope: Prevent repeated SOS trigger bursts.
- Progress: 35%
- Done:
  - SOS confirmation flow with countdown exists.
  - Haptics integrated on trigger/success.
- Remaining:
  - Add 30-second lock after SOS send.
  - Persist lock state while screen remains active (and optionally across reloads).

## 5) Parent ETA Prediction Subscription (ML table)

- Scope: Parent app uses `bus_eta_predictions` realtime feed.
- Progress: 15%
- Done:
  - Client-side rolling ETA exists as fallback.
- Remaining:
  - Subscribe to `bus_eta_predictions` for parent bus.
  - Merge/override ETA card display with predicted ETA when available.
  - Add fallback order and stale prediction handling.

## 6) GPS Module Structure Alignment

- Scope: Align code paths with expected docs and phase ownership.
- Progress: 40%
- Done:
  - Functional GPS task exists in `apps/mobile/lib/locationTask.ts`.
- Remaining:
  - Move/alias implementation to `apps/mobile/tasks/gpsTask.ts` and `hooks/useGPSBroadcast.ts`, or
  - Update documentation to accepted architecture and ownership.

## 7) Notifications UX Consolidation

- Scope: Use one canonical parent alerts surface for consistency.
- Progress: 70%
- Done:
  - Full alerts history screen implemented.
  - Inline alerts panel still present in tracker tab.
- Remaining:
  - Decide single canonical flow (embedded panel vs dedicated route).
  - Remove duplication and keep shared rendering logic in one place.

## 8) Parent Bus Tracking Map

- Scope: Show live bus tracking map experience for parents with clear online/offline transitions.
- Progress: 93%
- Done:
  - Parent tracker screen renders map with bus marker.
  - Realtime subscription updates parent bus location.
  - Initial location snapshot is loaded to avoid blank map until next INSERT.
  - Offline UX now includes trip context with a disabled trip card and status badge.
  - Active route polyline rendering added when route shape is available.
  - Route name overlay chip added for map context.
- Remaining:
  - Validate smooth marker motion on low-end devices and throttled GPS replay bursts.
  - Add QA checklist for map permissions/background state edge cases.

## Acceptance Checklist for Item 1 (Device Binding)

- [ ] Driver login from Device A (first time) succeeds and stores device ID.
- [ ] Driver login from Device A again succeeds.
- [ ] Driver login from Device B fails with `DEVICE_MISMATCH`.
- [ ] Parent login behavior unchanged.
- [ ] Existing credentials format unchanged (driver: email + institute code; parent: institute code + registration no).

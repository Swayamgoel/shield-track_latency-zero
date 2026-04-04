/**
 * locationTask.ts — Background GPS broadcast task
 *
 * Uses expo-task-manager + expo-location to stream the driver's GPS
 * coordinates to the Supabase bus_locations table every ~5 seconds
 * while a trip is active, even when the app is backgrounded.
 *
 * IMPORTANT: TaskManager.defineTask() MUST be called at module load time
 * (top level), not inside a component. This file is imported in the root
 * _layout.tsx to ensure it's registered on app start.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { apiClient } from './api';

export const LOCATION_TASK_NAME = 'shieldtrack-gps-broadcast';

// ─── Active trip context ──────────────────────────────────────────────────────
// Stored in module scope so the background task can access it across renders.
let _activeTripId: string | null = null;
let _activeBusId: string | null = null;
let _activeTenantId: string | null = null;

export const setActiveTripContext = (tripId: string, busId: string, tenantId: string) => {
	_activeTripId = tripId;
	_activeBusId = busId;
	_activeTenantId = tenantId;
};

export const clearActiveTripContext = () => {
	_activeTripId = null;
	_activeBusId = null;
	_activeTenantId = null;
};

// ─── Task Definition ──────────────────────────────────────────────────────────
// This runs on every location update (background + foreground).
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
	if (error) {
		console.error('[GPS Task] Error:', error.message);
		return;
	}

	const locations = (data as any)?.locations as Location.LocationObject[] | undefined;
	if (!locations?.length) return;

	const loc = locations[locations.length - 1]; // use most recent fix

	const trip_id = _activeTripId;
	const bus_id = _activeBusId;
	const tenant_id = _activeTenantId;

	if (!trip_id || !bus_id || !tenant_id) {
		// Task is registered but no active trip — skip silently
		return;
	}

	const speed_kmh = Math.max(0, (loc.coords.speed ?? 0) * 3.6); // m/s → km/h

	const result = await apiClient.updateLocation(trip_id, {
		bus_id,
		lat: loc.coords.latitude,
		lng: loc.coords.longitude,
		speed_kmh,
		recorded_at: new Date(loc.timestamp).toISOString(),
	});

	if (!result.ok) {
		console.error('[GPS Task] Insert failed:', result.error.error.message);
	}
});

// ─── Control Functions ────────────────────────────────────────────────────────

/**
 * startLocationBroadcast
 * Requests permissions and starts the background GPS task.
 * Must be called after a trip is created (tripId is known).
 */
export const startLocationBroadcast = async (
	tripId: string,
	busId: string,
	tenantId: string
): Promise<void> => {
	setActiveTripContext(tripId, busId, tenantId);

	// Request foreground permission first (required before background)
	const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
	if (fgStatus !== 'granted') {
		clearActiveTripContext();
		throw new Error('Location permission denied. Please enable location access in Settings.');
	}

	// Request background permission (Android requires separate prompt)
	const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
	if (bgStatus !== 'granted') {
		console.warn('[GPS] Background permission denied — GPS will only work while app is open');
	}

	// Avoid double-starting
	const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
	if (alreadyRunning) {
		console.log('[GPS] Task already running — skipping start');
		return;
	}

	await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
		accuracy: Location.Accuracy.High,
		timeInterval: 30000,     // every 30 seconds minimum
		distanceInterval: 50,    // or every 50 meters — whichever fires first
		pausesUpdatesAutomatically: false,
		foregroundService: {
			notificationTitle: 'ShieldTrack — Trip Active',
			notificationBody: 'GPS is broadcasting live to parents.',
			notificationColor: '#2574ff',
		},
	});

	console.log(`[GPS] Started broadcast for trip ${tripId}`);
};

/**
 * stopLocationBroadcast
 * Stops the GPS background task and clears the active trip context.
 */
export const stopLocationBroadcast = async (): Promise<void> => {
	clearActiveTripContext();
	const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
	if (running) {
		await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
		console.log('[GPS] Broadcast stopped');
	}
};

/**
 * locationTask.ts — Background GPS broadcast task
 *
 * Uses expo-task-manager + expo-location to stream the driver's GPS
 * coordinates to the Supabase bus_locations table every ~7 seconds
 * while a trip is active, even when the app is backgrounded.
 *
 * IMPORTANT: TaskManager.defineTask() MUST be called at module load time
 * (top level), not inside a component. This file is imported in the root
 * _layout.tsx to ensure it's registered on app start.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from './api';

export const LOCATION_TASK_NAME = 'shieldtrack-gps-broadcast';
const LOCATION_RETRY_QUEUE_KEY = 'shieldtrack.gps.retry.queue.v1';
const MAX_RETRY_QUEUE_SIZE = 60;
const REPLAY_THROTTLE_MS = 180;

interface GpsTelemetryCounters {
	liveSendSuccess: number;
	liveSendFailure: number;
	replaySendSuccess: number;
	replaySendFailure: number;
	queuedForRetry: number;
	queueDroppedByCap: number;
	flushRuns: number;
	lastQueueSize: number;
}

const telemetry: GpsTelemetryCounters = {
	liveSendSuccess: 0,
	liveSendFailure: 0,
	replaySendSuccess: 0,
	replaySendFailure: 0,
	queuedForRetry: 0,
	queueDroppedByCap: 0,
	flushRuns: 0,
	lastQueueSize: 0,
};

interface QueuedLocationUpdate {
	trip_id: string;
	bus_id: string;
	tenant_id: string;
	lat: number;
	lng: number;
	speed_kmh: number;
	recorded_at: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Active trip context ──────────────────────────────────────────────────────
// Stored in module scope so the background task can access it across renders.
let _activeTripId: string | null = null;
let _activeBusId: string | null = null;
let _activeTenantId: string | null = null;
let _foregroundSubscription: Location.LocationSubscription | null = null;

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

const readRetryQueue = async (): Promise<QueuedLocationUpdate[]> => {
	try {
		const raw = await AsyncStorage.getItem(LOCATION_RETRY_QUEUE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed as QueuedLocationUpdate[];
	} catch {
		return [];
	}
};

const saveRetryQueue = async (queue: QueuedLocationUpdate[]): Promise<void> => {
	await AsyncStorage.setItem(LOCATION_RETRY_QUEUE_KEY, JSON.stringify(queue));
};

const clearRetryQueue = async (): Promise<void> => {
	await AsyncStorage.removeItem(LOCATION_RETRY_QUEUE_KEY);
};

const enqueueRetryUpdate = async (update: QueuedLocationUpdate): Promise<void> => {
	const queue = await readRetryQueue();
	const next = [...queue, update].slice(-MAX_RETRY_QUEUE_SIZE);
	const droppedCount = Math.max(0, queue.length + 1 - next.length);
	telemetry.queueDroppedByCap += droppedCount;
	telemetry.queuedForRetry += 1;
	telemetry.lastQueueSize = next.length;
	await saveRetryQueue(next);
};

const flushRetryQueue = async (): Promise<boolean> => {
	const queue = await readRetryQueue();
	telemetry.flushRuns += 1;
	telemetry.lastQueueSize = queue.length;
	if (queue.length === 0) return true;

	for (let i = 0; i < queue.length; i += 1) {
		const item = queue[i];
		const result = await apiClient.updateLocation(item.trip_id, {
			bus_id: item.bus_id,
			lat: item.lat,
			lng: item.lng,
			speed_kmh: item.speed_kmh,
			recorded_at: item.recorded_at,
		});

		if (!result.ok) {
			telemetry.replaySendFailure += 1;
			await saveRetryQueue(queue.slice(i));
			telemetry.lastQueueSize = queue.length - i;
			return false;
		}

		telemetry.replaySendSuccess += 1;

		if (i < queue.length - 1) {
			// Throttle replay burst to avoid hammering API/Realtime in one spike.
			await sleep(REPLAY_THROTTLE_MS);
		}
	}

	await clearRetryQueue();
	telemetry.lastQueueSize = 0;
	return true;
};

const sendLocationUpdate = async (update: QueuedLocationUpdate): Promise<void> => {
	await flushRetryQueue();

	const result = await apiClient.updateLocation(update.trip_id, {
		bus_id: update.bus_id,
		lat: update.lat,
		lng: update.lng,
		speed_kmh: update.speed_kmh,
		recorded_at: update.recorded_at,
	});

	if (!result.ok) {
		telemetry.liveSendFailure += 1;
		console.error('[GPS Task] Insert failed:', result.error.error.message);
		await enqueueRetryUpdate(update);
		console.log('[GPS Task] telemetry', getGpsTaskTelemetry());
		return;
	}

	telemetry.liveSendSuccess += 1;
	if (telemetry.liveSendSuccess % 10 === 0) {
		console.log('[GPS Task] telemetry', getGpsTaskTelemetry());
	}
};

const isExpoGo = (): boolean => Constants.appOwnership === 'expo';

export const getGpsTaskTelemetry = (): GpsTelemetryCounters => ({ ...telemetry });

export const resetGpsTaskTelemetry = (): void => {
	telemetry.liveSendSuccess = 0;
	telemetry.liveSendFailure = 0;
	telemetry.replaySendSuccess = 0;
	telemetry.replaySendFailure = 0;
	telemetry.queuedForRetry = 0;
	telemetry.queueDroppedByCap = 0;
	telemetry.flushRuns = 0;
	telemetry.lastQueueSize = 0;
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
	const update: QueuedLocationUpdate = {
		trip_id,
		bus_id,
		tenant_id,
		lat: loc.coords.latitude,
		lng: loc.coords.longitude,
		speed_kmh,
		recorded_at: new Date(loc.timestamp).toISOString(),
	};
	await sendLocationUpdate(update);
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

	if (isExpoGo()) {
		console.warn('[GPS] Expo Go detected: falling back to foreground-only GPS. Use a development build for true background tracking.');

		if (_foregroundSubscription) {
			_foregroundSubscription.remove();
			_foregroundSubscription = null;
		}

		_foregroundSubscription = await Location.watchPositionAsync(
			{
				accuracy: Location.Accuracy.High,
				timeInterval: 7000,
				distanceInterval: 0,
			},
			(location) => {
				const trip_id = _activeTripId;
				const bus_id = _activeBusId;
				const tenant_id = _activeTenantId;
				if (!trip_id || !bus_id || !tenant_id) return;

				const update: QueuedLocationUpdate = {
					trip_id,
					bus_id,
					tenant_id,
					lat: location.coords.latitude,
					lng: location.coords.longitude,
					speed_kmh: Math.max(0, (location.coords.speed ?? 0) * 3.6),
					recorded_at: new Date(location.timestamp).toISOString(),
				};

				void sendLocationUpdate(update);
			},
		);

		console.log(`[GPS] Started foreground broadcast for trip ${tripId}`);
		return;
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
		timeInterval: 7000,      // target: every 7 seconds
		distanceInterval: 0,
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
	if (_foregroundSubscription) {
		_foregroundSubscription.remove();
		_foregroundSubscription = null;
		console.log('[GPS] Foreground broadcast stopped');
	}
	const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
	if (running) {
		await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
		console.log('[GPS] Broadcast stopped');
	}
	await clearRetryQueue();
};

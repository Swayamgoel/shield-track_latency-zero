import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /driver/assignment/today
// Returns today's trip assignment for the authenticated driver,
// including joined bus plate + route name, and the active trip_id if any.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/assignment/today', async (req, res) => {
	const { driver_id, tenant_id } = req.driver!;
	const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

	console.log(`[trips] ── GET /assignment/today`);
	console.log(`         driver_id  = ${driver_id}`);
	console.log(`         tenant_id  = ${tenant_id || '(not in JWT)'}`);
	console.log(`         date       = ${today}`);

	try {
		// ── Step 1: flat query on trip_assignments (no FK joins) ─────────────────
		let query = supabaseAdmin
			.from('trip_assignments')
			.select('id, bus_id, route_id, driver_id, assigned_date, tenant_id')
			.eq('driver_id', driver_id)
			.eq('assigned_date', today);

		if (tenant_id) {
			query = query.eq('tenant_id', tenant_id) as typeof query;
		}

		const { data: assignment, error: assignError } = await query.single();

		if (assignError || !assignment) {
			console.error('[trips] ❌ Assignment not found.');
			console.error('         Supabase error:', JSON.stringify(assignError));
			console.error('         Hint: check driver_id matches public.users.id AND assigned_date format');
			return res.status(404).json({ error: { message: 'No assignment found for today' } });
		}

		console.log(`[trips] ✅ Assignment found: ${assignment.id}`);

		// ── Step 2: get bus plate (separate query, no FK join required) ──────────
		const { data: bus, error: busError } = await supabaseAdmin
			.from('buses')
			.select('plate_number')
			.eq('id', assignment.bus_id)
			.maybeSingle();
		if (busError) console.warn('[trips] bus lookup error:', busError.message);

		// ── Step 3: get route name (separate query) ───────────────────────────────
		const { data: route, error: routeError } = await supabaseAdmin
			.from('routes')
			.select('name')
			.eq('id', assignment.route_id)
			.maybeSingle();
		if (routeError) console.warn('[trips] route lookup error:', routeError.message);

		// ── Step 4: check for existing trip ───────────────────────────────────────
		const { data: trip } = await supabaseAdmin
			.from('trips')
			.select('id, status')
			.eq('assignment_id', assignment.id)
			.order('started_at', { ascending: false })
			.limit(1)
			.maybeSingle();

		let status: 'assigned' | 'in_progress' | 'completed' = 'assigned';
		if (trip?.status === 'active') status = 'in_progress';
		else if (trip?.status === 'completed') status = 'completed';

		return res.status(200).json({
			assignment_id: assignment.id,
			trip_id: trip?.id ?? null,
			tenant_id: assignment.tenant_id,
			bus_id: assignment.bus_id,
			bus_plate: bus?.plate_number ?? 'Unknown Bus',
			route_id: assignment.route_id,
			route_name: route?.name ?? 'Unknown Route',
			driver_id: assignment.driver_id,
			status,
		});
	} catch (err: any) {
		console.error('[trips] 💥 Unexpected error in GET /assignment/today:', err);
		return res.status(500).json({ error: { message: 'Internal Server Error' } });
	}
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /driver/trips/start
// Body: { assignment_id: string }
// Creates a new trips row for the given assignment and sets it active.
// Returns the created trip.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/trips/start', async (req, res) => {
	const { driver_id, tenant_id } = req.driver!;
	const { assignment_id } = req.body as { assignment_id?: string };

	if (!assignment_id) {
		return res.status(400).json({ error: { message: 'assignment_id is required' } });
	}

	try {
		// Verify assignment belongs to this driver
		const { data: assignment, error: assignError } = await supabaseAdmin
			.from('trip_assignments')
			.select('id, bus_id, route_id')
			.eq('id', assignment_id)
			.eq('driver_id', driver_id)
			.eq('tenant_id', tenant_id)
			.single();

		if (assignError || !assignment) {
			return res.status(403).json({ error: { message: 'Assignment not found or unauthorized' } });
		}

		// Prevent duplicate active trips
		const { data: existing } = await supabaseAdmin
			.from('trips')
			.select('id, status')
			.eq('assignment_id', assignment_id)
			.eq('status', 'active')
			.maybeSingle();

		if (existing) {
			// Already active — return it so the mobile can sync
			return res.status(200).json({ trip: existing });
		}

		// Create and activate the trip
		const { data: trip, error: tripError } = await supabaseAdmin
			.from('trips')
			.insert({
				tenant_id,
				assignment_id,
				bus_id: assignment.bus_id,
				route_id: assignment.route_id,
				driver_id,
				status: 'active',
				started_at: new Date().toISOString(),
			})
			.select()
			.single();

		if (tripError || !trip) {
			console.error('[POST /driver/trips/start] Insert error:', tripError);
			return res.status(500).json({ error: { message: 'Failed to start trip' } });
		}

		console.log(`[trips] Driver ${driver_id} started trip ${trip.id}`);
		return res.status(200).json({ trip });
	} catch (err: any) {
		console.error('[POST /driver/trips/start]', err);
		return res.status(500).json({ error: { message: 'Internal Server Error' } });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /driver/trips/:tripId/end
// Marks an active trip as completed.
// Returns the updated trip.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/trips/:tripId/end', async (req, res) => {
	const { driver_id, tenant_id } = req.driver!;
	const { tripId } = req.params;

	try {
		// Ensure trip belongs to this driver
		const { data: trip, error: findError } = await supabaseAdmin
			.from('trips')
			.select('id, status')
			.eq('id', tripId)
			.eq('driver_id', driver_id)
			.eq('tenant_id', tenant_id)
			.single();

		if (findError || !trip) {
			return res.status(404).json({ error: { message: 'Trip not found or unauthorized' } });
		}

		if (trip.status !== 'active') {
			return res.status(400).json({ error: { message: 'Trip is not active' } });
		}

		// Mark as completed
		const { data: updated, error: updateError } = await supabaseAdmin
			.from('trips')
			.update({ status: 'completed', ended_at: new Date().toISOString() })
			.eq('id', tripId)
			.select()
			.single();

		if (updateError || !updated) {
			console.error('[POST /driver/trips/:tripId/end] Update error:', updateError);
			return res.status(500).json({ error: { message: 'Failed to end trip' } });
		}

		console.log(`[trips] Driver ${driver_id} ended trip ${tripId}`);
		return res.status(200).json({ trip: updated });
	} catch (err: any) {
		console.error('[POST /driver/trips/:tripId/end]', err);
		return res.status(500).json({ error: { message: 'Internal Server Error' } });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /driver/trips/:tripId/location
// Body: { bus_id: string, lat: number, lng: number, speed_kmh: number, recorded_at: string }
// Logs a GPS ping into bus_locations 
// ─────────────────────────────────────────────────────────────────────────────
router.post('/trips/:tripId/location', async (req, res) => {
	const { tenant_id } = req.driver!;
	const { tripId } = req.params;
	const { bus_id, lat, lng, speed_kmh, recorded_at } = req.body;

	if (!bus_id || lat == null || lng == null) {
		return res.status(400).json({ error: { message: 'Missing required location data' } });
	}

	try {
		const { error: insertError } = await supabaseAdmin.from('bus_locations').insert({
			trip_id: tripId,
			bus_id,
			tenant_id,
			lat,
			lng,
			speed_kmh: speed_kmh || 0,
			recorded_at: recorded_at || new Date().toISOString(),
		});

		if (insertError) {
			console.error(`[location] Insert failed for trip ${tripId}:`, insertError.message);
			return res.status(500).json({ error: { message: 'Failed to insert location' } });
		}

		return res.status(200).json({ success: true });
	} catch (err: any) {
		console.error('[location] Unexpected error:', err);
		return res.status(500).json({ error: { message: 'Internal Server Error' } });
	}
});

export default router;

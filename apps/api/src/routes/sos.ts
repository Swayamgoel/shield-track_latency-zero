import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /sos
// Body: { trip_id, bus_id, lat, lng }
// Inserts an SOS event into the sos_events table.
// Requires driver auth (tenant_id extracted from JWT via requireDriver).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
	const { driver_id, tenant_id } = req.driver!;
	const { trip_id, bus_id, lat, lng } = req.body as {
		trip_id?: string;
		bus_id?: string;
		lat?: number;
		lng?: number;
	};

	if (!trip_id || !bus_id || lat == null || lng == null) {
		return res.status(400).json({
			error: { message: 'trip_id, bus_id, lat, and lng are all required' },
		});
	}

	try {
		const { data, error } = await supabaseAdmin
			.from('sos_events')
			.insert({
				trip_id,
				bus_id,
				tenant_id,
				lat,
				lng,
				triggered_at: new Date().toISOString(),
			})
			.select('id, triggered_at')
			.single();

		if (error || !data) {
			console.error('[POST /sos] Insert error:', error);
			return res.status(500).json({ error: { message: 'Failed to create SOS event' } });
		}

		console.log(`🚨 SOS triggered by driver ${driver_id} on trip ${trip_id} at [${lat}, ${lng}]`);
		return res.status(200).json({ sos_id: data.id, triggered_at: data.triggered_at });
	} catch (err: any) {
		console.error('[POST /sos]', err);
		return res.status(500).json({ error: { message: 'Internal Server Error' } });
	}
});

export default router;

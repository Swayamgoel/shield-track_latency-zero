import { Router } from 'express';
import { ParentLoginRequest, DriverLoginRequest, LoginResponse } from '@shieldtrack/types';
import { supabaseAdmin } from '../lib/supabase';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'development-shieldtrack-secret';

router.post('/login', async (req, res) => {
	const payload: ParentLoginRequest = req.body;

	if (!payload.institute_code || !payload.registration_no) {
		return res.status(400).json({ error: { message: 'Institute code and Registration Number are required' } });
	}

	try {
		// 1. Verify Institute Code
		const { data: tenant, error: tenantError } = await supabaseAdmin
			.from('tenants')
			.select('id')
			.eq('institute_code', payload.institute_code)
			.single();

		if (tenantError || !tenant) {
			return res.status(401).json({ error: { message: 'Invalid Institute Code' } });
		}

		// 2. Verify Student ID belongs to that Tenant
		const { data: student, error: studentError } = await supabaseAdmin
			.from('students')
			.select('id, name, registration_no, route_id')
			.eq('registration_no', payload.registration_no)
			.eq('tenant_id', tenant.id)
			.single();

		if (studentError || !student) {
			return res.status(401).json({ error: { message: 'Invalid Registration Number for this Institute' } });
		}

		// 3. Resolve the student's current bus from active trip first, then today's assignment.
		let resolvedBusId: string | null = null;

		if (student.route_id) {
			const { data: activeTrip } = await supabaseAdmin
				.from('trips')
				.select('bus_id, started_at')
				.eq('tenant_id', tenant.id)
				.eq('route_id', student.route_id)
				.eq('status', 'active')
				.order('started_at', { ascending: false })
				.limit(1)
				.maybeSingle();

			if (activeTrip?.bus_id) {
				resolvedBusId = activeTrip.bus_id as string;
			} else {
				const today = new Date().toISOString().slice(0, 10);
				const { data: assignment } = await supabaseAdmin
					.from('trip_assignments')
					.select('bus_id, assigned_date, created_at')
					.eq('tenant_id', tenant.id)
					.eq('route_id', student.route_id)
					.eq('assigned_date', today)
					.order('created_at', { ascending: false })
					.limit(1)
					.maybeSingle();

				if (assignment?.bus_id) {
					resolvedBusId = assignment.bus_id as string;
				}
			}
		}

		// 4. Generate a JWT representing the Parent session
		const tokenPayload = {
			sub: student.id,
			role: 'parent',
			tenant_id: tenant.id,
			student_id: student.id,
		};
		const access_token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

		const response: LoginResponse = {
			session: {
				user_id: `parent_${student.id}`,
				tenant_id: tenant.id,
				student_id: student.id,
				bus_id: resolvedBusId,
				role: 'parent',
				access_token: access_token,
				expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
			}
		};

		return res.status(200).json(response);
	} catch (err: any) {
		console.error('Auth route error:', err);
		return res.status(500).json({ error: { message: 'Internal Server Error' } });
	}
});

// POST /auth/driver-login
router.post('/driver-login', async (req, res) => {
	const payload: DriverLoginRequest = req.body;
	const { email, institute_code } = payload;

	// 1. Validate inputs
	if (!email || !institute_code) {
		return res.status(400).json({ error: { message: 'Email and Institute Code are required' } });
	}

	try {
		// 2. Verify institute_code → tenant
		const { data: tenant, error: tenantError } = await supabaseAdmin
			.from('tenants')
			.select('id')
			.eq('institute_code', institute_code)
			.single();

		if (tenantError || !tenant) {
			return res.status(401).json({ error: { message: 'Invalid Institute Code' } });
		}

		// 3. Verify driver exists in users table for this tenant
		const { data: driver, error: driverError } = await supabaseAdmin
			.from('users')
			.select('id, email, tenant_id')
			.eq('email', email.toLowerCase())
			.eq('tenant_id', tenant.id)
			.eq('role', 'driver')
			.single();

		if (driverError || !driver) {
			return res.status(401).json({ error: { message: 'No driver found with this email' } });
		}

		// 4. Mint JWT
		const tokenPayload = {
			sub: driver.id,
			role: 'driver',
			tenant_id: tenant.id,
			driver_id: driver.id,
		};
		const access_token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

		// 5. Return session
		const response: LoginResponse = {
			session: {
				user_id: driver.id,
				tenant_id: tenant.id,
				driver_id: driver.id,
				role: 'driver',
				access_token: access_token,
				expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
			}
		};

		return res.status(200).json(response);
	} catch (err: any) {
		console.error('Driver Auth route error:', err);
		return res.status(500).json({ error: { message: 'Internal Server Error' } });
	}
});

export default router;

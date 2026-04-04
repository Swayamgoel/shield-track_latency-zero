import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// ─── Driver context attached to every authenticated request ──────────────────
export interface DriverContext {
	user_id: string;
	driver_id: string;
	tenant_id: string;
}

// Extend Express Request to carry driver context after auth
declare global {
	namespace Express {
		interface Request {
			driver?: DriverContext;
		}
	}
}

// ─── Middleware ───────────────────────────────────────────────────────────────
/**
 * requireDriver
 * Verifies the Supabase JWT in the Authorization header and injects
 * driver context (user_id, driver_id, tenant_id) into req.driver.
 *
 * Usage: router.use(requireDriver) or route-level: router.get('/...', requireDriver, handler)
 */
export function requireDriver(req: Request, res: Response, next: NextFunction) {
	const authHeader = req.headers.authorization;

	if (!authHeader?.startsWith('Bearer ')) {
		return res.status(401).json({
			error: { message: 'Missing or malformed Authorization header. Expected: Bearer <token>' },
		});
	}

	const token = authHeader.slice(7);

	try {
		const secret = process.env.SUPABASE_JWT_SECRET;
		if (!secret) {
			console.error('[requireDriver] SUPABASE_JWT_SECRET is not set');
			return res.status(500).json({ error: { message: 'Server misconfiguration' } });
		}

		const payload = jwt.verify(token, secret) as Record<string, any>;

		// For custom JWTs, claims are at the root level.
		req.driver = {
			user_id: payload.sub as string,
			driver_id: (payload.driver_id || payload.sub) as string,
			tenant_id: (payload.tenant_id || '') as string,
		};

		console.log(`[auth] Driver ${req.driver.driver_id} | Tenant ${req.driver.tenant_id || 'MISSING'}`);

		next();
	} catch (err: any) {
		const message = err?.name === 'TokenExpiredError'
			? 'Token has expired. Please log in again.'
			: 'Invalid token.';
		return res.status(401).json({ error: { message } });
	}
}

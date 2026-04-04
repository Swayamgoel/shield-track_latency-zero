import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';

// Catch silent crashes so we can see WHERE the server dies
process.on('uncaughtException', (err) => {
	console.error('\n[CRASH] uncaughtException:', err.message);
	console.error(err.stack);
	process.exit(1);
});

process.on('unhandledRejection', (reason) => {
	console.error('\n[CRASH] unhandledRejection:', reason);
	process.exit(1);
});

// Load root .env (monorepo single source of truth)
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

import authRouter from './routes/auth';
import tripsRouter from './routes/trips';
import sosRouter from './routes/sos';
import fleetRouter from './routes/fleet';
import { requireDriver } from './lib/jwtMiddleware';

const app = express();

app.use(cors());
app.use(express.json());

// ─── Public routes (no auth required) ────────────────────────────────────────
app.use('/auth', authRouter);

// ─── Protected routes (Supabase JWT required) ─────────────────────────────────
// All /driver/* routes require a valid driver JWT
app.use('/driver', requireDriver, tripsRouter);

// SOS requires auth to extract tenant_id from token
app.use('/sos', requireDriver, sosRouter);

// Fleet routes (future expansion)
app.use('/fleet', fleetRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
	res.json({ status: 'ok', service: 'ShieldTrack API', port: 3001 });
});

const server = http.createServer(app);

server.on('error', (err) => console.error('[server] error:', err.message));
server.on('close', () => console.error('[server] ⚠️  SERVER CLOSED — event loop draining'));

server.listen(3001, () => {
	console.log('✅ ShieldTrack API running on :3001');
	console.log(`   PID ${process.pid} — press Ctrl+C to stop`);
});
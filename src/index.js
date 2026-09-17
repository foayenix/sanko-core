require('dotenv').config();
const express = require('express');
const log = require('./utils/log');
const { handleWebhook, verifyWebhook } = require('./router');
const adminRouter = require('./admin');
const dashboardRouter = require('./dashboard');
const simulatorRouter = require('./simulator');
const db = require('./services/supabase');

const app = express();

// Scoped to /webhook rather than mounted globally: it captures the raw body for
// Meta's X-Hub-Signature-256 HMAC, and its default 100 KB cap is right for Meta's
// small JSON envelopes but far too small for the simulator, which posts voice
// notes and photos inline. Routers that need a parser bring their own.
app.get('/webhook', verifyWebhook);
app.post('/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }), handleWebhook);

// Admin dashboard (PRD §6.4) — HTTP Basic Auth, read-only
app.use('/admin', adminRouter);

// Institutional dashboard (PRD §11) — public, aggregate counts only
app.use('/dashboard', dashboardRouter);

// Browser stand-in for WhatsApp — same agent path, Basic Auth like /admin
app.use('/simulator', simulatorRouter);

app.get('/', (_req, res) => {
	res.json({
		service: 'sanko-core',
		status: 'ok',
		endpoints: ['/webhook', '/simulator', '/admin', '/dashboard', '/health']
	});
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	log.info('server.listening', { port: PORT, env: process.env.NODE_ENV || 'development', alerting: log.alertingConfigured() });
	db.deleteExpiredPatientInvites().catch(err => log.warn('patient.invite_cleanup_failed', { error: err.message }));
	db.pruneProcessedMessages().catch(err => log.warn('dedup.prune_failed', { error: err.message }));
});

// Pending invitations contain a name and phone number but no clinical record.
// Sweep hourly so the seven-day expiry does not depend on somebody messaging
// the bot. unref() lets tests and graceful shutdowns exit normally.
const patientInviteCleanup = setInterval(
	() => {
		db.deleteExpiredPatientInvites().catch(err => log.warn('patient.invite_cleanup_failed', { error: err.message }));
		// Meta stops retrying long before a day; the table only needs to stay small.
		db.pruneProcessedMessages({ olderThanHours: 24 }).catch(err => log.warn('dedup.prune_failed', { error: err.message }));
	},
	60 * 60 * 1000
);
patientInviteCleanup.unref();

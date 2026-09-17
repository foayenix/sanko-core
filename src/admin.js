// Private Sanko control room at /admin.
//
// The current Basic Authentication remains an interim gate. Sensitive actions in
// the control room are intentionally presented as review workflows, not wired
// mutations, until allowlisted admin accounts and step-up authentication exist.

const express = require('express');
const log = require('./utils/log');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./utils/basicAuth');
// Held as a namespace, not destructured: the test suite swaps functions on this
// shared module object to run the whole room against an in-memory store, and a
// destructured reference would keep pointing at the real one.
const db = require('./services/supabase');
const { renderAdminPage } = require('./adminPage');
const governance = require('./services/governance');
const { BACKUP_DIR } = require('../scripts/backup');
const { promptVersion } = require('./agent/prompt');

const router = express.Router();
const auth = requireAuth('Sanko Control Room');

router.use('/assets', express.static(path.join(__dirname, '..', 'sanko-landing page', 'public', 'fonts'), {
  immutable: true,
  maxAge: '7d',
}));

router.get('/', auth, async (req, res) => {
  try {
    const [counts, practitioners, formulations, flagged, usage, corrections, quality, transcripts] = await Promise.all([
      db.adminGetCounts(),
      db.adminGetPractitioners(),
      db.adminGetFormulations(),
      db.adminGetFlagged(),
      db.adminGetUsageStats(),
      db.correctionStats({ sinceDays: 30 }),
      // 010 may not be applied yet. A pending migration should cost the room one
      // panel, not the whole page — every other measure here still works without it.
      db.modelQualityStats({ sinceDays: 30 }).catch(err => {
        log.warn('admin.quality_stats_unavailable', { error: err.message, hint: 'apply supabase/010' });
        return null;
      }),
      db.adminGetTranscriptQueue({ limit: 50 }).catch(err => {
        log.warn('admin.transcript_queue_unavailable', { error: err.message, hint: 'apply supabase/011' });
        return [];
      }),
    ]);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(renderAdminPage({
      counts,
      practitioners,
      formulations,
      flagged,
      usage,
      corrections,
      quality,
      transcripts,
      evaluation: latestEvalResult(),
      backup: backupStatus(),
      governance: await governanceStatus(),
      operator: req.operator ?? null,
      runtime: _runtimeStatus(),
    }));
  } catch (err) {
    log.error('admin.page_failed', { error: err.message });
    res.status(500).send('<main><h1>Control room unavailable</h1><p>Sanko could not load the operational snapshot. Check the server log and try again.</p></main>');
  }
});

// ─── write endpoints ──────────────────────────────────────────────────────────
//
// These are the first mutating routes in the control room. Two guards beyond the
// Basic Auth already on the router:
//
//   · a required custom header, so a cross-origin form post cannot reach them —
//     any origin that wants to send it must first pass a CORS preflight, which
//     this server never answers. Basic Auth alone would not stop that, because
//     the browser attaches cached credentials to a cross-site request.
//   · a pseudonymous reviewer reference on every write, held to the same rule as
//     an eval reviewer: never a name, phone number, email or account id.

const json = express.json({ limit: '64kb' });

function guard(req, res, next) {
  if (req.get('X-Sanko-Admin') !== '1') return res.status(400).json({ error: 'Missing X-Sanko-Admin header.' });

  // The reviewer reference comes from the authenticated operator, never from the
  // body. A reference the caller can type attributes nothing: it was the reason
  // every correction and plant confirmation was unfalsifiable the moment a second
  // person had the password.
  if (!req.operator?.ref) return res.status(401).json({ error: 'No authenticated operator on this request.' });
  if (req.body && 'reviewer_ref' in req.body && req.body.reviewer_ref !== req.operator.ref) {
    return res.status(400).json({
      error: 'reviewer_ref is taken from your account, not from the request. Remove it.',
    });
  }
  next();
}

const REVIEWABLE_FIELDS = ['condition_local', 'condition_std', 'plants', 'preparation', 'dosage', 'notes'];

// Records a proposed correction. It deliberately does not change the record —
// see recordAdminReview for why.
router.post('/api/review/correction', auth, json, guard, async (req, res) => {
  const { short_code, field, after_value, note } = req.body ?? {};
  const reviewer_ref = req.operator.ref;
  if (!REVIEWABLE_FIELDS.includes(field)) {
    return res.status(400).json({ error: `field must be one of ${REVIEWABLE_FIELDS.join(', ')}` });
  }
  if (after_value === undefined || after_value === null || after_value === '') {
    return res.status(400).json({ error: 'after_value is required.' });
  }
  try {
    const result = await db.recordAdminReview({ short_code, field, after: after_value, reviewer_ref, note: note || null });
    res.json({ ok: true, ...result, recorded: 'proposal', note: 'The practitioner record was not changed.' });
  } catch (err) {
    log.warn('admin.review_rejected', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/review/transcript', auth, json, guard, async (req, res) => {
  const { media_id, transcript, note } = req.body ?? {};
  const reviewer_ref = req.operator.ref;
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: 'transcript is required.' });
  }
  try {
    const result = await db.recordTranscriptReview({ media_id, transcript: transcript.trim(), reviewer_ref, note: note || null });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.warn('admin.transcript_review_rejected', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// A short-lived signed URL for one voice note or one photographed page. Neither
// ever becomes public: the bucket stays private and the link expires in five
// minutes. A page needs this at least as much as audio does — correcting a
// reading without seeing the page is just rewriting it from imagination.
//
// The id is resolved through the review queue rather than by path, so this
// cannot be turned into a reader for arbitrary storage paths.
router.get('/api/media/:id/source', auth, async (req, res) => {
  try {
    const queue = await db.adminGetTranscriptQueue({ limit: 200 });
    const row = queue.find(item => item.id === req.params.id);
    if (!row?.storage_path) return res.status(404).json({ error: 'No archived source for that media id.' });
    res.json({ url: await db.getSignedMediaUrl(row.storage_path, 300), kind: row.kind ?? 'voice', expires_in_seconds: 300 });
  } catch (err) {
    log.warn('admin.media_source_failed', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// The route this replaced. Kept because a control room open in a tab across a
// deploy would otherwise silently lose its audio player.
router.get('/api/media/:id/audio', auth, (req, res, next) => {
  req.url = `/api/media/${encodeURIComponent(req.params.id)}/source`;
  router.handle(req, res, next);
});

// ─── backup and governance evidence ───────────────────────────────────────────

// Reads the backup manifest rather than asserting anything. "Not reported" was
// honest when nothing produced a report; now something does, and an unverified
// or stale backup should say so where it will be seen.
function backupStatus() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'manifest.json'), 'utf8'));
    const newest = manifest.backups?.at(-1);
    if (!newest) return null;
    return {
      created_at: newest.created_at,
      bytes: newest.bytes,
      rows: Object.values(newest.row_counts ?? {}).reduce((a, b) => a + b, 0),
      verified_at: newest.verified_at,
      count: manifest.backups.length,
      age_hours: Math.round((Date.now() - Date.parse(newest.created_at)) / 3_600_000),
    };
  } catch {
    return null;
  }
}

async function governanceStatus() {
  try {
    const terms = governance.currentTerms();
    const [stats, uses] = await Promise.all([
      db.contributorTermsStats(terms.hash),
      db.listKnowledgeUses({ limit: 20 }),
    ]);
    return { terms: { version: terms.version, hash: terms.hash, in_force: terms.in_force }, stats, uses };
  } catch (err) {
    log.warn('admin.governance_unavailable', { error: err.message, hint: 'apply supabase/013' });
    return null;
  }
}

// ─── evaluation evidence ──────────────────────────────────────────────────────

// The newest eval scorecard on disk, so the promotion gate can show a real
// result instead of "Not attached". Results are gitignored, so a deployment that
// has never run an eval simply has nothing here.
function latestEvalResult() {
  try {
    const dir = path.join(__dirname, '..', 'evals', 'results');
    const file = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().pop();
    if (!file) return null;
    const result = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    return {
      file,
      ran_at: result.ran_at,
      model: result.model,
      provider: result.provider,
      summary: result.summary ?? null,
      practitioner_reviewed: result.case_set?.practitioner_reviewed ?? 0,
    };
  } catch {
    return null;
  }
}

function _runtimeStatus() {
  return {
    llmProvider: process.env.LLM_PROVIDER || 'ollama',
    llmModel: process.env.OLLAMA_MODEL || process.env.AGENT_MODEL || 'Not configured',
    whisperBackend: process.env.WHISPER_BACKEND || 'cli',
    whisperModel: process.env.WHISPER_CLI_MODEL || process.env.WHISPER_MODEL || 'Not configured',
    // Reading the prompt hash here means the room reports the prompt this
    // process actually loaded, not one inferred from the file on disk later.
    promptVersion: promptVersion(),
    nodeEnv: process.env.NODE_ENV || 'development',
    configured: {
      database: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      whatsapp: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID),
      webhookSigning: Boolean(process.env.META_APP_SECRET),
      adminPassword: Boolean(process.env.ADMIN_PASSWORD),
      hostedWhisper: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  };
}

module.exports = router;
module.exports.requireAuth = auth;
module.exports._renderPage = renderAdminPage;
module.exports._runtimeStatus = _runtimeStatus;
module.exports._latestEvalResult = latestEvalResult;

// Local-only visual fixture for the private control room.
// Run with `node scripts/preview-admin.js`; no database or credentials required.

const express = require('express');
const path = require('path');
const { renderAdminPage } = require('../src/adminPage');

const app = express();
const now = Date.now();
const ago = minutes => new Date(now - minutes * 60_000).toISOString();
const practitioner = { id: 'p-1', display_name: 'A. Okafor', phone_number: '+2348012345678', preferred_language: 'ig', region: 'Enugu', years_practising: 31, tradition: 'Igbo herbal medicine', registered_at: ago(40_000), contributor_terms_version: 'v1-draft', contributor_terms_accepted_at: ago(39_000), contributor_terms_declined_at: null, created_at: ago(40_000), last_active_at: ago(9) };

const fixture = {
  counts: { practitioners: 18, registered: 16, formulations: 247, patients: 91, treatments: 163, flagged: 7 },
  // Three registration states on purpose: the row that finished, the row that
  // said no to the terms, and the row still mid-onboarding. All three are things
  // the room has to show without editorialising.
  practitioners: [
    practitioner,
    { id: 'p-2', display_name: 'M. Adeyemi', phone_number: '+2348098765432', preferred_language: 'yo', region: 'Ogun State', years_practising: null, tradition: null, registered_at: ago(30_000), contributor_terms_version: null, contributor_terms_accepted_at: null, contributor_terms_declined_at: ago(29_000), created_at: ago(30_000), last_active_at: ago(87) },
    { id: 'p-3', display_name: 'H. Bello', phone_number: '+2347055512345', preferred_language: 'ha', region: null, years_practising: null, tradition: null, registered_at: null, contributor_terms_version: null, contributor_terms_accepted_at: null, contributor_terms_declined_at: null, created_at: ago(20_000), last_active_at: ago(1440) },
  ],
  formulations: [
    { id: 'f-1', short_code: 'FM-00247', condition_std: 'Fever', confidence_score: 0.91, created_at: ago(7), practitioner_id: 'p-1', practitioners: practitioner },
    { id: 'f-2', short_code: 'FM-00246', condition_local: 'Body heat', confidence_score: 0.68, created_at: ago(43), practitioner_id: 'p-2', practitioners: { display_name: 'M. Adeyemi' } },
    { id: 'f-3', short_code: 'FM-00245', condition_std: 'Cough', confidence_score: 0.58, created_at: ago(183), practitioner_id: 'p-3', practitioners: { display_name: 'H. Bello' } },
  ],
  flagged: {
    lowConf: [
      { short_code: 'FM-00245', condition_std: 'Cough', confidence_score: 0.58, created_at: ago(183), practitioners: { display_name: 'H. Bello' } },
      { short_code: 'FM-00246', condition_local: 'Body heat', confidence_score: 0.68, created_at: ago(43), practitioners: { display_name: 'M. Adeyemi' } },
    ],
    events: [
      { id: 'e-1', event_type: 'unknown_plant_flagged', payload: { short_code: 'FM-00247', plants: ['agbo-igi', 'ewe ina'] }, created_at: ago(28), practitioners: { display_name: 'A. Okafor' } },
      { id: 'e-2', event_type: 'error', payload: { step: 'photo_processing', error: 'Photo could not be decoded' }, created_at: ago(76), practitioners: { display_name: 'M. Adeyemi' } },
      { id: 'e-3', event_type: 'unknown_plant_flagged', payload: { short_code: 'FM-00245', plants: ['ganyen kura'] }, created_at: ago(310), practitioners: { display_name: 'H. Bello' } },
    ],
  },
  usage: {
    last7: { whisper: 12, claudeText: 0, claudeVision: 0, localCalls: 209, formulations: 38, errors: 1, estimatedUSD: '0.11' },
    last30: { whisper: 29, claudeText: 0, claudeVision: 0, localCalls: 782, formulations: 112, errors: 3, estimatedUSD: '0.26' },
    byDay: [],
  },
  corrections: { total: 23, byField: { plants: 11, condition_std: 7, preparation: 5 }, byModel: {} },
  quality: {
    sinceDays: 30,
    totalSaves: 112,
    totalCorrections: 23,
    attributedSaves: 96,
    correctionsPer100: 20.5,
    byModel: {
      'qwen2.5:32b-instruct-q4_K_M': { saves: 71, corrections: 19, correctionsPer100: 26.8, fields: { plants: 9, condition_std: 6, preparation: 4 }, providers: ['ollama'], promptVersions: ['agent-1125f43e'] },
      'sanko-extract-01': { saves: 25, corrections: 4, correctionsPer100: 16, fields: { plants: 2, dosage: 2 }, providers: ['ollama'], promptVersions: ['agent-1125f43e'] },
      unattributed: { saves: 16, corrections: 0, correctionsPer100: 0, fields: {}, providers: [], promptVersions: [] },
    },
  },
  runtime: {
    llmProvider: 'ollama', llmModel: 'qwen2.5:32b-instruct-q4_K_M', whisperBackend: 'cli', whisperModel: 'medium', nodeEnv: 'preview', promptVersion: 'agent-1125f43e',
    preview: true,
    configured: { database: true, whatsapp: true, webhookSigning: true, adminPassword: true, hostedWhisper: false, anthropic: false },
  },
};

// D — a reading queue for the preview: voice notes and photographed pages side
// by side, since that is what the queue actually holds. Synthetic content only.
fixture.transcripts = [
  { id: 'm-4', kind: 'photo', practitioner_id: 'p-1', storage_path: 'photos/p-1/1.jpg', transcript: 'AGBO IBA\n1. Ewe dongoyaro — 2 handful\n2. Ewe [?] — small\n3. Epo igi mango\nBoil 20 mins. Drink 1 cup morning + night, 3 days.', transcript_model: 'qwen2.5vl:7b', transcript_provider: 'ollama', transcript_confidence: 0.62, created_at: ago(14), practitioners: { display_name: 'A. Okafor' }, reviewed_at: null, reviewed_by: null },
  { id: 'm-1', kind: 'voice', practitioner_id: 'p-1', storage_path: 'voice/p-1/1.ogg', duration_seconds: 34, transcript: '[voice note transcript] i am using bitter leaf and scent leaf for the fever, boil for twenty minutes', transcript_model: 'large-v3', transcript_provider: 'cli', transcript_confidence: 0.88, created_at: ago(28), practitioners: { display_name: 'A. Okafor' }, reviewed_at: null, reviewed_by: null },
  { id: 'm-5', kind: 'photo', practitioner_id: 'p-2', storage_path: 'photos/p-2/1.jpg', transcript: 'Ògùn inú ríru\nEwé bàbà, ata ìjòsì\nLọ̀ pọ̀, fi omi gbígbóná', transcript_model: 'qwen2.5vl:7b', transcript_provider: 'ollama', transcript_confidence: 0.97, created_at: ago(52), practitioners: { display_name: 'M. Adeyemi' }, reviewed_at: ago(30), reviewed_by: 'OP-4C21' },
  { id: 'm-2', kind: 'voice', practitioner_id: 'p-2', storage_path: 'voice/p-2/1.ogg', duration_seconds: 12, transcript: 'Mo fi ewe dongoyaro se agbo fun iba', transcript_model: 'large-v3', transcript_provider: 'cli', transcript_confidence: 0.93, created_at: ago(96), practitioners: { display_name: 'M. Adeyemi' }, reviewed_at: ago(60), reviewed_by: 'RT-A1B2' },
  { id: 'm-6', kind: 'photo', practitioner_id: 'p-3', storage_path: 'photos/p-3/1.jpg', transcript: null, transcript_model: 'qwen2.5vl:7b', transcript_provider: 'ollama', transcript_confidence: null, created_at: ago(210), practitioners: { display_name: 'H. Bello' }, reviewed_at: null, reviewed_by: null },
  { id: 'm-3', kind: 'voice', practitioner_id: 'p-3', storage_path: 'voice/p-3/1.ogg', duration_seconds: 51, transcript: '[voice note transcript] um the cough one you boil it', transcript_model: 'medium', transcript_provider: 'cli', transcript_confidence: 0.41, created_at: ago(300), practitioners: { display_name: 'H. Bello' }, reviewed_at: null, reviewed_by: null },
];

// F — a scorecard so the promotion gate shows a real verdict.
fixture.evaluation = {
  file: '2026-09-03T09-12-00-000Z__sanko-extract-01.json',
  ran_at: ago(1200),
  model: 'sanko-extract-01',
  provider: 'ollama',
  summary: { cases: 50, errored: 0, mean_score: 0.8912, passed: 46, hallucinated: 0, wrong_tool: 4 },
  practitioner_reviewed: 38,
};

// Backup and governance fixtures for the preview.
fixture.backup = {
  created_at: ago(300), bytes: 4_812_004, rows: 12_884,
  verified_at: ago(300), count: 14, age_hours: 5,
};
fixture.governance = {
  terms: { version: 'v1-draft', hash: '3be6b781b46d7414', in_force: false },
  stats: { total: 18, accepted: 12, current: 11, stale: 1 },
  uses: [
    {
      id: 'ku-1', created_at: ago(20_000), use_type: 'research_access',
      counterparty: 'University of Ibadan, Dept. of Pharmacognosy',
      purpose: 'Comparative study of antimalarial preparations in southwest Nigeria',
      benefit_terms: 'Named co-authorship; copy of findings in Yoruba',
      knowledge_use_contributors: [{ practitioner_id: 'p-1' }, { practitioner_id: 'p-2' }],
    },
  ],
};
fixture.operator = { username: 'felix', ref: 'OP-4C21', legacy: false };

app.use('/admin/assets', express.static(path.join(__dirname, '..', 'sanko-landing page', 'public', 'fonts')));
app.get('/admin', (_req, res) => res.type('html').send(renderAdminPage(fixture)));

// The reading editor asks for the archived source. In the preview there is no
// bucket, so it gets a drawn stand-in — a page-shaped image is the point of the
// panel, and a permanently broken <img> would hide the layout it is there to show.
app.get('/admin/api/media/:id/source', (req, res) => {
  const row = fixture.transcripts.find(item => item.id === req.params.id);
  res.json({ url: `/admin/preview/${row?.kind === 'photo' ? 'page.svg' : 'voice.ogg'}`, kind: row?.kind ?? 'voice', expires_in_seconds: 300 });
});

app.get('/admin/preview/page.svg', (_req, res) => {
  const lines = ['AGBO IBA', '', '1. Ewe dongoyaro — 2 handful', '2. Ewe ??? — small', '3. Epo igi mango', '', 'Boil 20 mins.', 'Drink 1 cup morning + night,', '3 days.'];
  res.type('svg').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 560" width="420" height="560">
    <rect width="420" height="560" fill="#fdfaf1"/>
    ${Array.from({ length: 18 }, (_, i) => `<line x1="24" y1="${52 + i * 28}" x2="396" y2="${52 + i * 28}" stroke="#cfd8e3" stroke-width="1"/>`).join('')}
    <line x1="60" y1="0" x2="60" y2="560" stroke="#e3b7b7" stroke-width="1"/>
    ${lines.map((line, i) => `<text x="72" y="${46 + i * 28}" font-family="Bradley Hand, Segoe Script, cursive" font-size="19" fill="#243050">${line}</text>`).join('')}
  </svg>`);
});
app.get('/simulator', (_req, res) => res.type('html').send('<p>Sanko simulator preview</p>'));

const port = Number(process.env.ADMIN_PREVIEW_PORT || process.env.PORT || 4174);
app.listen(port, '127.0.0.1', () => console.log(`Admin preview: http://127.0.0.1:${port}/admin`));

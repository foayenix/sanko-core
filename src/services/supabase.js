const { createClient } = require('@supabase/supabase-js');
const log = require('../utils/log');

let _client;

function getClient() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _client;
}

async function logEvent({ practitioner_id, event_type, payload }) {
  const { error } = await getClient()
    .from('events')
    .insert({ practitioner_id, event_type, payload });
  if (error) log.error('db.log_event_failed', { event_type, error: error.message });
}

async function getPractitioner(phoneNumber) {
  const { data, error } = await getClient()
    .from('practitioners')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();
  if (error && error.code !== 'PGRST116') log.error('db.get_practitioner_failed', { error: error.message });
  return data ?? null;
}

async function createPractitioner({ phone_number, display_name, preferred_language }) {
  const { data, error } = await getClient()
    .from('practitioners')
    .insert({ phone_number, display_name, preferred_language })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function updatePractitioner(id, fields) {
  const { data, error } = await getClient()
    .from('practitioners')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// The `sessions` table backed the retired step machine. Conversation state now
// lives in agent_messages (see the agent memory section below); the table is
// kept by migration 004 only so the change is non-destructive.

async function updateLastActive(practitioner_id) {
  const { error } = await getClient()
    .from('practitioners')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', practitioner_id);
  if (error) log.warn('db.update_last_active_failed', { practitioner_id, error: error.message });
}

async function setPendingSourceMedia(practitioner_id, media_id) {
  const { error } = await getClient()
    .from('practitioners')
    .update({ pending_source_media_id: media_id, pending_source_media_at: new Date().toISOString() })
    .eq('id', practitioner_id);
  if (error) throw new Error(error.message);
}

async function clearPendingSourceMedia(practitioner_id) {
  const { error } = await getClient()
    .from('practitioners')
    .update({ pending_source_media_id: null, pending_source_media_at: null })
    .eq('id', practitioner_id);
  if (error) throw new Error(error.message);
}

// The provenance columns (015) are written at insert time rather than derived
// later from the environment: which model read a page is a fact about that row,
// and a deployment that swaps VISION_MODEL next week must not retroactively
// rewrite what produced last week's readings.
async function saveMedia({ practitioner_id, kind, storage_path, duration_seconds, transcript, transcript_model = null, transcript_provider = null, transcript_confidence = null }) {
  const { data, error } = await getClient()
    .from('media')
    .insert({ practitioner_id, kind, storage_path, duration_seconds, transcript, transcript_model, transcript_provider, transcript_confidence })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function uploadVoiceNote(practitioner_id, buffer, mimeType) {
  const ext = mimeType.includes('ogg') ? 'ogg' : 'mp4';
  const path = `voice/${practitioner_id}/${Date.now()}.${ext}`;
  const { error } = await getClient()
    .storage
    .from('sanko-media')
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

async function saveFormulation({ practitioner_id, source_media_id, structured, original_text, original_language, model, provider, prompt_version, plant_data_version }) {
  const row = {
    practitioner_id,
    source_media_id: source_media_id ?? null,
    condition_local:   structured.condition?.local_name ?? null,
    condition_std:     structured.condition?.standardised ?? null,
    icd_11_code:       structured.condition?.icd_11_code ?? null,
    plants:            structured.plants ?? [],
    preparation:       structured.preparation ?? null,
    dosage:            structured.dosage ?? null,
    notes:             structured.notes ?? null,
    original_text:     original_text ?? null,
    original_language: original_language ?? structured.metadata?.original_language ?? null,
    confidence_score:  structured.metadata?.confidence_score ?? null,
    // 010 — the denominator for every quality measure. Null is honest for a
    // caller that does not know; it must never be filled in with the currently
    // configured model, which would attribute old records to a new adapter.
    model:             model ?? null,
    provider:          provider ?? null,
    prompt_version:    prompt_version ?? null,
    plant_data_version: plant_data_version ?? null,
    status:            'active',
  };
  const { data, error } = await getClient()
    .from('formulations')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Returns the 10 most recent active formulations for a practitioner (PRD §5.4)
async function listFormulations(practitioner_id, limit = 10) {
  const { data, error } = await getClient()
    .from('formulations')
    .select('id, short_code, condition_local, condition_std, created_at, source_media_id')
    .eq('practitioner_id', practitioner_id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Returns one full formulation row plus its source media (for voice replay)
async function getFormulation(id) {
  const { data, error } = await getClient()
    .from('formulations')
    .select('*, media:source_media_id(storage_path, transcript)')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data ?? null;
}

// Creates a signed URL (1-hour expiry) for a voice note stored in Supabase Storage
// The bytes of one archived item. Used by the vision training export, which
// needs the page itself and not a link to it: a signed URL expires, and a
// training set that depends on one stops being reproducible the same afternoon.
async function downloadMedia(storagePath) {
  const { data, error } = await getClient().storage.from('sanko-media').download(storagePath);
  if (error) throw new Error(`Could not download ${storagePath}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function getSignedMediaUrl(storagePath, expiresIn = 3600) {
  const { data, error } = await getClient()
    .storage
    .from('sanko-media')
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Returns a single formulation by its human-readable short_code for a given practitioner
async function getFormulationByShortCode(short_code, practitioner_id) {
  const { data, error } = await getClient()
    .from('formulations')
    .select('*')
    .eq('short_code', short_code.toUpperCase())
    .eq('practitioner_id', practitioner_id)
    .eq('status', 'active')
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data ?? null;
}

// Overwrites a single JSONB or text field on a formulation row.
// field must be one of: 'plants', 'preparation', 'dosage', 'notes'
async function updateFormulationField(id, field, value) {
  const ALLOWED = new Set(['plants', 'preparation', 'dosage', 'notes', 'condition_local', 'condition_std', 'icd_11_code']);
  if (!ALLOWED.has(field)) throw new Error(`updateFormulationField: unknown field '${field}'`);
  const { data, error } = await getClient()
    .from('formulations')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ─── patients (004) ───────────────────────────────────────────────────────────

async function createPatient({ practitioner_id, display_name, age_years, sex, phone_number, notes, status, consent_status, consent_method, consent_recorded_at, consent_expires_at }) {
  const { data, error } = await getClient()
    .from('patients')
    .insert({
      practitioner_id,
      display_name,
      age_years: age_years ?? null,
      sex: sex ?? null,
      phone_number: phone_number ?? null,
      notes: notes ?? null,
      status: status ?? 'pending_consent',
      consent_status: consent_status ?? 'pending',
      consent_method: consent_method ?? null,
      consent_recorded_at: consent_recorded_at ?? null,
      consent_expires_at: consent_expires_at ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function listPatients(practitioner_id, limit = 20) {
  const { data, error } = await getClient()
    .from('patients')
    .select('id, short_code, display_name, age_years, sex, status, consent_status, created_at')
    .eq('practitioner_id', practitioner_id)
    .in('status', ['active', 'pending_consent'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function findPatientByPhone(phone_number, practitioner_id) {
  const { data, error } = await getClient()
    .from('patients')
    .select('*')
    .eq('phone_number', phone_number)
    .eq('practitioner_id', practitioner_id)
    .in('status', ['active', 'pending_consent'])
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function markPatientConsentInvited(id, practitioner_id) {
  const { data, error } = await getClient()
    .from('patients')
    .update({ consent_invited_at: new Date().toISOString() })
    .eq('id', id)
    .eq('practitioner_id', practitioner_id)
    .eq('status', 'pending_consent')
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function deletePendingPatient(id, practitioner_id) {
  const { error } = await getClient()
    .from('patients')
    .delete()
    .eq('id', id)
    .eq('practitioner_id', practitioner_id)
    .eq('status', 'pending_consent');
  if (error) throw new Error(error.message);
}

async function getPendingPatientConsent(id, phone_number) {
  const { data, error } = await getClient()
    .from('patients')
    .select('*, practitioners(id, display_name, phone_number)')
    .eq('id', id)
    .eq('phone_number', phone_number)
    .eq('status', 'pending_consent')
    .eq('consent_status', 'pending')
    .gt('consent_expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function acceptPatientConsent(id, phone_number, response_message_id) {
  const now = new Date().toISOString();
  const { data, error } = await getClient()
    .from('patients')
    .update({
      status: 'active',
      consent_status: 'granted',
      consent_method: 'whatsapp',
      consent_recorded_at: now,
      consent_response_message_id: response_message_id ?? null,
    })
    .eq('id', id)
    .eq('phone_number', phone_number)
    .eq('status', 'pending_consent')
    .eq('consent_status', 'pending')
    .gt('consent_expires_at', now)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function declinePatientConsent(id, phone_number) {
  const { data, error } = await getClient()
    .from('patients')
    .delete()
    .eq('id', id)
    .eq('phone_number', phone_number)
    .eq('status', 'pending_consent')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function deleteExpiredPatientInvites() {
  const { error } = await getClient()
    .from('patients')
    .delete()
    .eq('status', 'pending_consent')
    .lt('consent_expires_at', new Date().toISOString());
  if (error) log.warn('patient.expired_consent_cleanup_failed', { error: error.message });
}

// Resolves an active or consent-pending patient by short_code (PT-00007) for one practitioner. Scoping every
// lookup to practitioner_id is what keeps one practitioner's agent from reading
// another's patients if the model ever guesses a code.
async function getPatientByShortCode(short_code, practitioner_id) {
  const { data, error } = await getClient()
    .from('patients')
    .select('*')
    .eq('short_code', short_code.toUpperCase())
    .eq('practitioner_id', practitioner_id)
    .in('status', ['active', 'pending_consent'])
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data ?? null;
}

// Case-insensitive partial name match, so the agent can resolve "Amina" without
// the practitioner remembering a code.
async function findPatientsByName(name, practitioner_id, limit = 5) {
  const { data, error } = await getClient()
    .from('patients')
    .select('id, short_code, display_name, age_years, sex, status, consent_status')
    .eq('practitioner_id', practitioner_id)
    .in('status', ['active', 'pending_consent'])
    .ilike('display_name', `%${name}%`)
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function updatePatient(id, fields) {
  const ALLOWED = new Set(['display_name', 'age_years', 'sex', 'phone_number', 'notes', 'status']);
  const patch = {};
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED.has(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) throw new Error('updatePatient: no updatable fields supplied');
  const { data, error } = await getClient()
    .from('patients')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ─── treatments (004) ─────────────────────────────────────────────────────────

async function createTreatment({ practitioner_id, patient_id, formulation_id, condition_reported, started_on, follow_up_on, outcome_notes }) {
  const row = {
    practitioner_id,
    patient_id,
    formulation_id: formulation_id ?? null,
    condition_reported: condition_reported ?? null,
    outcome_notes: outcome_notes ?? null,
    follow_up_on: follow_up_on ?? null,
  };
  if (started_on) row.started_on = started_on;
  const { data, error } = await getClient()
    .from('treatments')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Treatment history for one patient, newest first, with the formulation joined
// so the agent can say "FM-00012 — malaria" rather than a bare uuid.
async function listTreatmentsForPatient(patient_id, practitioner_id, limit = 20) {
  const { data, error } = await getClient()
    .from('treatments')
    .select('id, short_code, condition_reported, started_on, outcome, outcome_notes, follow_up_on, formulations(short_code, condition_std, condition_local)')
    .eq('patient_id', patient_id)
    .eq('practitioner_id', practitioner_id)
    .eq('status', 'active')
    .order('started_on', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function getTreatmentByShortCode(short_code, practitioner_id) {
  const { data, error } = await getClient()
    .from('treatments')
    .select('*, patients(short_code, display_name)')
    .eq('short_code', short_code.toUpperCase())
    .eq('practitioner_id', practitioner_id)
    .eq('status', 'active')
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data ?? null;
}

async function updateTreatment(id, fields) {
  const ALLOWED = new Set(['outcome', 'outcome_notes', 'follow_up_on', 'condition_reported', 'formulation_id', 'status']);
  const patch = {};
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED.has(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) throw new Error('updateTreatment: no updatable fields supplied');
  const { data, error } = await getClient()
    .from('treatments')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Treatments whose follow-up date has arrived (or passed) and that are still
// open — what the agent answers "who should I check on?" with.
async function listDueFollowUps(practitioner_id, limit = 20) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await getClient()
    .from('treatments')
    .select('short_code, condition_reported, follow_up_on, outcome, patients(short_code, display_name)')
    .eq('practitioner_id', practitioner_id)
    .eq('status', 'active')
    .eq('outcome', 'ongoing')
    .not('follow_up_on', 'is', null)
    .lte('follow_up_on', today)
    .order('follow_up_on', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ─── unknown plants — the other flywheel ──────────────────────────────────────

// Every local name the agent could not place botanically, with the words the
// practitioner actually used around it.
//
// A name confirmed once here fixes every future conversation that mentions it,
// with no training run and no model change — which makes this the cheapest
// quality lever in the system. The transcript comes back with the event because
// a reviewer cannot identify "ewe ina" from the name alone; they need to see it
// in use. It therefore carries practitioner speech and must not be written
// anywhere the repository can pick it up (see scripts/plant-review.js).
async function listUnknownPlantEvents({ sinceDays = 180, limit = 1000 } = {}) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: events, error } = await getClient()
    .from('events')
    .select('id, practitioner_id, payload, created_at')
    .eq('event_type', 'unknown_plant_flagged')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  // The event records the short_code, not the formulation id, so the context
  // has to be fetched separately. One batched read rather than one per event.
  const shortCodes = [...new Set((events ?? []).map(event => event.payload?.short_code).filter(Boolean))];
  let byShortCode = new Map();
  if (shortCodes.length) {
    const { data: formulations, error: formulationsError } = await getClient()
      .from('formulations')
      .select('short_code, original_text, original_language, plants, created_at')
      .in('short_code', shortCodes);
    if (formulationsError) throw new Error(formulationsError.message);
    byShortCode = new Map((formulations ?? []).map(row => [row.short_code, row]));
  }

  return (events ?? []).map(event => ({
    ...event,
    formulation: byShortCode.get(event.payload?.short_code) ?? null,
  }));
}

// ─── specimens (018) ──────────────────────────────────────────────────────────

// A photographed plant, named by the practitioner who sent it.
//
// `botanical` is resolved by the caller from the runtime plant index and passed
// in already decided; this function will not look anything up and will not
// accept a binomial without the provenance that says where it came from. The
// database enforces the same thing (specimens_botanical_has_provenance), which
// is deliberate duplication — a name that arrived without provenance has to fail
// on the way in, not be found later by an audit.
async function saveSpecimen({
  practitioner_id, media_id, local_name, local_name_normalised, language = null,
  part_used = null, familiarity = null, notes = null,
  botanical = null, botanical_source = null, plant_data_version = null, region = null,
}) {
  if (botanical && !(botanical_source && plant_data_version)) {
    throw new Error('a botanical name cannot be stored without its source and index version');
  }

  const { data, error } = await getClient()
    .from('specimens')
    .insert({
      practitioner_id, media_id, local_name, local_name_normalised, language,
      part_used, familiarity, notes, botanical, botanical_source, plant_data_version, region,
    })
    .select()
    .single();

  // The same photograph named the same way twice is the model repeating itself,
  // not the practitioner saying it again. Return the row that already exists so
  // the caller can report a save rather than an error the practitioner would
  // have to hear about.
  if (error) {
    if (/duplicate key|already exists/i.test(error.message)) {
      const existing = await getSpecimenByMediaAndName(media_id, local_name_normalised);
      if (existing) return { ...existing, duplicate: true };
    }
    throw new Error(error.message);
  }
  return data;
}

async function getSpecimenByMediaAndName(media_id, local_name_normalised) {
  const { data, error } = await getClient()
    .from('specimens')
    .select('*')
    .eq('media_id', media_id)
    .eq('local_name_normalised', local_name_normalised)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function listSpecimens(practitioner_id, limit = 10) {
  const { data, error } = await getClient()
    .from('specimens')
    .select('short_code, local_name, botanical, part_used, familiarity, status, created_at')
    .eq('practitioner_id', practitioner_id)
    .neq('status', 'withdrawn')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// The active-learning queue, in the only form this slice can honestly produce:
// specimens whose local name the index could not place. These are the rows where
// a reviewer's hour buys the most, because each one closes a name the agent is
// currently unable to resolve for anybody.
async function listUnresolvedSpecimens({ limit = 200 } = {}) {
  const { data, error } = await getClient()
    .from('specimens')
    .select('id, short_code, practitioner_id, media_id, local_name, local_name_normalised, language, part_used, familiarity, region, notes, created_at')
    .is('botanical', null)
    .neq('status', 'withdrawn')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ─── contributor terms and knowledge use (013) ────────────────────────────────

async function getPractitionerById(id) {
  const { data, error } = await getClient().from('practitioners').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') log.error('db.get_practitioner_by_id_failed', { error: error.message });
  return data ?? null;
}

async function createKnowledgeUse(row) {
  const { data, error } = await getClient().from('knowledge_use').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function addKnowledgeUseContributors(knowledge_use_id, contributors) {
  const rows = contributors.map(entry => ({
    knowledge_use_id,
    practitioner_id: entry.practitioner_id,
    record_count: entry.record_count ?? 0,
    terms_version: entry.terms_version ?? null,
  }));
  const { error } = await getClient().from('knowledge_use_contributors').insert(rows);
  if (error) throw new Error(error.message);
}

async function listKnowledgeUsesForPractitioner(practitioner_id) {
  const { data, error } = await getClient()
    .from('knowledge_use_contributors')
    .select('record_count, terms_version, knowledge_use(id, use_type, counterparty, purpose, benefit_terms, agreed_at, created_at)')
    .eq('practitioner_id', practitioner_id);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function listKnowledgeUses({ limit = 100 } = {}) {
  const { data, error } = await getClient()
    .from('knowledge_use')
    .select('*, knowledge_use_contributors(practitioner_id, record_count, terms_version)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// How many practitioners have accepted the current terms, for the control room.
async function contributorTermsStats(currentHash) {
  const { data, error } = await getClient()
    .from('practitioners')
    .select('contributor_terms_version, contributor_terms_hash, contributor_terms_accepted_at');
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  return {
    total: rows.length,
    accepted: rows.filter(row => row.contributor_terms_accepted_at).length,
    current: rows.filter(row => row.contributor_terms_hash === currentHash).length,
    stale: rows.filter(row => row.contributor_terms_accepted_at && row.contributor_terms_hash !== currentHash).length,
  };
}

// ─── durable runtime state (012) ──────────────────────────────────────────────

// True the first time this message id is seen, false every time after.
//
// Meta retries a delivery with the same id until it is acknowledged, so this is
// the difference between one formulation and three. It replaces an in-process
// set that a restart emptied and a second instance never shared.
//
// Fails OPEN: if the database is unreachable the message is processed rather
// than dropped. Duplicate processing is recoverable — the practitioner sees a
// repeated reply and can delete a record; silently discarding what they said is
// not.
// The claim carries the message (019), so that what was accepted survives the
// process that accepted it. Without the payload a claim records only that
// something arrived, which is enough to avoid doing the work twice and no help
// at all in doing it once.
async function claimMessage(message_id, transport = 'meta', { payload = null } = {}) {
  if (!message_id) return true;
  const { error } = await getClient()
    .from('processed_messages')
    .insert({ message_id, transport, payload, attempts: 1 });

  if (!error) return true;
  // 23505 — unique violation. Someone (or some earlier delivery) got there first.
  if (error.code === '23505') return false;

  log.warn('dedup.unavailable', { error: error.message, effect: 'processing without duplicate protection' });
  return true;
}

// Marks the work done and drops the practitioner's message.
//
// Called whether the turn succeeded or failed visibly: both mean nobody is left
// waiting on a reply that never comes, which is the only thing recovery exists
// to prevent. A process that dies mid-turn never reaches here, and that is
// exactly the row the sweep is looking for.
async function completeMessage(message_id) {
  if (!message_id) return;
  const { error } = await getClient()
    .from('processed_messages')
    .update({ completed_at: new Date().toISOString(), payload: null })
    .eq('message_id', message_id);
  // Worth a warning, not a throw: the turn has already happened. The cost of a
  // failed completion is that the sweep runs it again, which is the direction
  // this whole mechanism errs in anyway.
  if (error) log.warn('dedup.complete_failed', { message_id, error: error.message });
}

// Inbound messages that were accepted and never finished.
//
// `olderThanSeconds` must exceed the longest legitimate turn, or the sweep will
// pick up work that is still running and hand a second copy to the agent. The
// turn lease (012) would stop the two from interleaving, but the practitioner
// would still get their message answered twice.
//
// Rows written before 019 carry no payload. They are closed rather than left
// alone: there is nothing to re-enqueue, and a row that is permanently pending
// is one the prune will never remove and the sweep will re-read forever.
//
// `transport` is not optional in practice. The Meta webhook and the Baileys
// adapter are separate processes against one database, and each can only replay
// its own messages: the webhook has no socket to the linked phone, and Baileys
// has no wamid it could answer. A sweep that ignored the column would have each
// of them burn the other's attempts and abandon its messages for it.
async function recoverPendingMessages({ transport = null, olderThanSeconds = 900, maxAttempts = 3, limit = 100 } = {}) {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
  let query = getClient()
    .from('processed_messages')
    .select('message_id, transport, payload, attempts, first_seen_at')
    .is('completed_at', null)
    .lt('first_seen_at', cutoff);
  if (transport) query = query.eq('transport', transport);

  const { data, error } = await query
    .order('first_seen_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const pending = [];
  const abandoned = [];
  const unreplayable = [];
  for (const row of data ?? []) {
    // Nothing to replay — a claim from before 019. Closed quietly; it is not a
    // message that went missing on this deployment's watch.
    if (!row.payload) { unreplayable.push(row); continue; }
    // The attempt that is about to happen would be number attempts + 1. Past the
    // cap, stop: a message that takes the process down with it must not take it
    // down again on every boot until someone notices.
    if (row.attempts >= maxAttempts) { abandoned.push(row); continue; }
    pending.push(row);
  }

  const closed = [...abandoned, ...unreplayable];
  if (closed.length) {
    await getClient()
      .from('processed_messages')
      .update({ completed_at: new Date().toISOString(), payload: null })
      .in('message_id', closed.map(row => row.message_id));
  }

  if (pending.length) {
    // Counted before the work, not after. A crash during the retry must still
    // spend the attempt, or the cap never binds on the failure mode it exists for.
    for (const row of pending) {
      await getClient()
        .from('processed_messages')
        .update({ attempts: row.attempts + 1 })
        .eq('message_id', row.message_id);
    }
  }

  return { pending, abandoned };
}

// Gives a claim back. Called when the delivery that took it is not going to be
// processed after all — the webhook withholds its acknowledgement in that case,
// and a retry deduplicated against a claim for work nobody started would be a
// message silently dropped.
async function releaseMessageClaim(message_id) {
  if (!message_id) return;
  const { error } = await getClient()
    .from('processed_messages')
    .delete()
    .eq('message_id', message_id);
  if (error) log.warn('dedup.release_failed', { message_id, error: error.message });
}

// Keeps the table small. Meta stops retrying long before the cutoff, so a
// completed row past it is dead weight.
//
// Only completed rows (019). Deleting an outstanding one would throw away a
// message the sweep has not recovered yet — the prune runs hourly and the sweep
// every few minutes, so in practice it never races, but "in practice" is the
// wrong standard for the table that exists to stop messages going missing.
// Rows predating 019 have no completed_at and no payload, so they are swept to
// completion by recoverPendingMessages' abandon path and pruned on the next run.
async function pruneProcessedMessages({ olderThanHours = 24 } = {}) {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000).toISOString();
  const { error } = await getClient()
    .from('processed_messages')
    .delete()
    .lt('first_seen_at', cutoff)
    .not('completed_at', 'is', null);
  if (error) log.warn('dedup.prune_failed', { error: error.message });
}

// One agent turn per practitioner at a time, across every instance.
//
// A lease rather than a lock: a process that dies mid-turn must not wedge that
// practitioner's Vault until someone notices, so it expires. ttlSeconds should
// exceed the longest legitimate turn — on a 32B local model that is minutes, not
// seconds.
async function acquireTurnLock(practitioner_id, holder, ttlSeconds) {
  const { data, error } = await getClient().rpc('acquire_turn_lock', {
    p_practitioner_id: practitioner_id,
    p_holder: holder,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) {
    // Fails open for the same reason as dedup: refusing to answer a practitioner
    // because a lock table is unavailable is the worse failure.
    log.warn('turn_lock.unavailable', { error: error.message, effect: 'proceeding without cross-instance serialisation' });
    return true;
  }
  return data === true;
}

async function releaseTurnLock(practitioner_id, holder) {
  const { error } = await getClient().rpc('release_turn_lock', {
    p_practitioner_id: practitioner_id,
    p_holder: holder,
  });
  if (error) log.warn('turn_lock.release_failed', { practitioner_id, error: error.message });
}

// ─── corrections (005) — the training flywheel ────────────────────────────────

// Best-effort: a failure to record a training example must never block the
// practitioner's edit from landing.
async function recordCorrection({ practitioner_id, formulation_id, media_id, field, before, after, source = 'practitioner_edit', reviewer_ref = null, note = null }) {
  const llm = require('./llm');
  const { error } = await getClient().from('corrections').insert({
    practitioner_id,
    formulation_id: formulation_id ?? null,
    media_id: media_id ?? null,
    field,
    before_value: before ?? null,
    after_value: after ?? null,
    source,
    reviewer_ref,
    note,
    model: llm.modelName(),
    provider: llm.providerName(),
  });
  if (error) log.warn('db.record_correction_failed', { field, error: error.message });
}

// ─── admin review (011) ───────────────────────────────────────────────────────

// A reviewer proposing a correction records the proposal; it does not rewrite
// the practitioner's record. The Vault is theirs, and an archive that quietly
// changes under review is not an archive. The proposal is a training example and
// an audit entry — a practitioner can still make the edit themselves, and that
// edit is captured separately as a practitioner_edit.
//
// Unlike recordCorrection this throws: a reviewer pressing a button must be told
// their work was not saved, where a background training-signal write should never
// interrupt a practitioner mid-conversation.
async function recordAdminReview({ short_code, field, after, reviewer_ref, note = null }) {
  const { data: formulation, error } = await getClient()
    .from('formulations')
    .select('id, practitioner_id, short_code, model, ' + field)
    .eq('short_code', short_code)
    .single();
  if (error) throw new Error(`No formulation ${short_code}: ${error.message}`);

  const llm = require('./llm');
  const { error: insertError } = await getClient().from('corrections').insert({
    practitioner_id: formulation.practitioner_id,
    formulation_id: formulation.id,
    field,
    before_value: formulation[field] ?? null,
    after_value: after,
    source: 'admin_review',
    reviewer_ref,
    note,
    // The model that made the mistake, read off the record (010) rather than
    // taken from the currently configured one.
    model: formulation.model ?? llm.modelName(),
    provider: llm.providerName(),
  });
  if (insertError) throw new Error(insertError.message);

  await logEvent({
    practitioner_id: formulation.practitioner_id,
    event_type: 'admin_review_proposed',
    payload: { short_code, field, reviewer_ref },
  });
  return { short_code, field, before: formulation[field] ?? null, after };
}

// ─── transcript and page review (011, 015) ───────────────────────────────────

// A machine reading and the field its correction is filed under. Audio and pages
// are the same workflow and must not become the same dataset: correcting a voice
// note produces a paired audio/text example for a Whisper fine-tune, correcting a
// page produces a paired image/text example for the vision model. Pool them and
// each model is trained on the other's failures.
const REVIEW_FIELD_BY_KIND = { voice: 'transcript', photo: 'page_transcript' };
const REVIEW_FIELDS = Object.values(REVIEW_FIELD_BY_KIND);

// Voice notes and photographed pages with what a machine made of them, newest
// first, flagged with whether a human has been through them.
//
// Reading the primary source is the largest quality gap on this stack in both
// directions: off-the-shelf Whisper handles Yorùbá, Igbo and Hausa poorly, and
// no vision model has seen much Nigerian traditional-medicine handwriting at all.
// Every downstream error starts here, and fixing these is also the only way to
// build the paired sets those two fine-tunes need.
async function adminGetTranscriptQueue({ limit = 50, kind = null } = {}) {
  let mediaQuery = getClient()
    .from('media')
    // The foreign key is named explicitly because two relationships exist
    // between these tables — media.practitioner_id, and the pending-media
    // pointer that runs the other way (007). PostgREST refuses to guess, and
    // the failure only appears against a real database.
    .select('id, practitioner_id, kind, storage_path, duration_seconds, transcript, transcript_model, transcript_provider, transcript_confidence, created_at, practitioners!media_practitioner_id_fkey(display_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  mediaQuery = kind ? mediaQuery.eq('kind', kind) : mediaQuery.in('kind', ['voice', 'photo']);

  const [{ data: media, error }, { data: reviewed, error: reviewedError }] = await Promise.all([
    mediaQuery,
    getClient()
      .from('corrections')
      .select('media_id, field, reviewer_ref, created_at')
      .in('field', REVIEW_FIELDS)
      .not('media_id', 'is', null),
  ]);
  if (error) throw new Error(error.message);
  if (reviewedError) throw new Error(reviewedError.message);

  const reviews = new Map();
  for (const row of reviewed ?? []) reviews.set(row.media_id, row);

  return (media ?? []).map(row => ({
    ...row,
    reviewed_at: reviews.get(row.id)?.created_at ?? null,
    reviewed_by: reviews.get(row.id)?.reviewer_ref ?? null,
  }));
}

// A corrected reading replaces the stored one — unlike a formulation, this is a
// machine artefact, not the practitioner's own record. Nothing is lost: the
// original machine output is preserved as the correction's before_value, which is
// exactly the pair a fine-tune needs.
//
// What it deliberately does not do is rewrite the formulations that were
// extracted from the old reading. Those are the practitioner's records, and the
// control room proposes changes to those rather than making them. The ones now
// resting on a reading known to be wrong come back in `affected` so the reviewer
// can go and look at them.
async function recordTranscriptReview({ media_id, transcript, reviewer_ref, note = null }) {
  const { data: media, error } = await getClient()
    .from('media')
    .select('id, practitioner_id, kind, transcript, transcript_model, transcript_provider')
    .eq('id', media_id)
    .single();
  if (error) throw new Error(`No media ${media_id}: ${error.message}`);

  const field = REVIEW_FIELD_BY_KIND[media.kind];
  if (!field) throw new Error(`Media ${media_id} is a ${media.kind}; only voice notes and photos carry a reading to correct.`);
  if ((media.transcript ?? '') === transcript) return { media_id, kind: media.kind, field, changed: false };

  // Attribute the mistake to the model that actually made it, as recorded on the
  // row (015). Falling back to the environment is only for rows that predate
  // that column, and it is a guess — which is why new rows carry their own.
  const model = media.transcript_model
    ?? (media.kind === 'voice' ? (process.env.WHISPER_CLI_MODEL || process.env.WHISPER_MODEL || null) : null);
  const provider = media.transcript_provider
    ?? (media.kind === 'voice' ? (process.env.WHISPER_BACKEND || 'cli') : null);

  const { error: insertError } = await getClient().from('corrections').insert({
    practitioner_id: media.practitioner_id,
    media_id: media.id,
    field,
    before_value: media.transcript ?? null,
    after_value: transcript,
    source: 'admin_review',
    reviewer_ref,
    note,
    model,
    provider,
  });
  if (insertError) throw new Error(insertError.message);

  const { error: updateError } = await getClient()
    .from('media')
    .update({ transcript })
    .eq('id', media_id);
  if (updateError) throw new Error(updateError.message);

  const affected = await _formulationsFromMedia(media.id);

  await logEvent({
    practitioner_id: media.practitioner_id,
    event_type: media.kind === 'photo' ? 'page_transcript_reviewed' : 'transcript_reviewed',
    payload: { media_id, reviewer_ref, field, affected_formulations: affected.map(f => f.short_code) },
  });
  return { media_id, kind: media.kind, field, changed: true, affected };
}

// Records that rest on this reading. A corrected page does not make them wrong,
// but it does mean nobody has checked them against what the page actually says.
async function _formulationsFromMedia(media_id) {
  const { data, error } = await getClient()
    .from('formulations')
    .select('short_code, condition_local, condition_std')
    .eq('source_media_id', media_id);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Reviewed pages as image/text pairs — the training set for the vision model,
// assembled from the only source of truth there is for this handwriting: a human
// who read the page. `after_value` is that reading; `before_value` is what the
// model produced and is kept for the audit sidecar, never as a target.
//
// Held-out rows are excluded here for the same reason as everywhere else: a model
// graded on an example it was trained on is not being graded.
async function listPageCorrectionsForExport({ onlyUnexported = true, limit = 5000 } = {}) {
  let query = getClient()
    .from('corrections')
    .select('id, practitioner_id, media_id, before_value, after_value, model, provider, note, created_at, media:media_id(storage_path, kind, transcript_model, transcript_provider)')
    .eq('field', 'page_transcript')
    .not('media_id', 'is', null)
    .is('held_out_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (onlyUnexported) query = query.is('exported_at', null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ─── eval hold-out (011) ──────────────────────────────────────────────────────

// Corrections eligible to become evaluation cases: not already held out, and
// carrying the source text the case needs as input.
async function listCorrectionsForEvalDrafting({ limit = 500 } = {}) {
  const { data, error } = await getClient()
    .from('corrections')
    .select('id, field, before_value, after_value, source, model, created_at, media_id, formulations(short_code, original_text, original_language, condition_local, condition_std, plants, preparation, dosage)')
    .is('held_out_at', null)
    .not('formulation_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function markCorrectionsHeldOut(entries) {
  if (!entries.length) return;
  const now = new Date().toISOString();
  for (const { id, case_id } of entries) {
    const { error } = await getClient()
      .from('corrections')
      .update({ held_out_at: now, held_out_case_id: case_id })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
}

// Releases a hold-out so the correction can train again — used when a drafted
// case was discarded rather than reviewed. Without this, abandoning a draft would
// silently retire a real training example for good.
async function releaseHeldOutCorrections(ids) {
  if (!ids.length) return;
  const { error } = await getClient()
    .from('corrections')
    .update({ held_out_at: null, held_out_case_id: null })
    .in('id', ids);
  if (error) throw new Error(error.message);
}

async function listHeldOutCorrections() {
  const { data, error } = await getClient()
    .from('corrections')
    .select('id, held_out_case_id, held_out_at')
    .not('held_out_at', 'is', null);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Corrections joined to the source transcript that produced them — everything
// the export script needs to build one training example per row.
async function listCorrectionsForExport({ onlyUnexported = true, limit = 5000 } = {}) {
  let query = getClient()
    .from('corrections')
    // practitioner_id is not decoration: the export splits train/valid/test by
    // it, and checks each practitioner's contributor terms with it. Selected
    // without it, every row arrived with practitioner_id undefined, the split
    // silently fell back to bucketing by correction id — putting one
    // practitioner's phrasing in both train and test — and no consent check had
    // anyone to ask about.
    .select('id, practitioner_id, field, before_value, after_value, source, model, created_at, formulations(short_code, original_text, original_language, condition_local, condition_std, plants, preparation, dosage)')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (onlyUnexported) query = query.is('exported_at', null);
  // Never train on an example the model is graded against (011). This is the
  // query that enforces it — not a convention anyone has to remember.
  query = query.is('held_out_at', null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function markCorrectionsExported(ids) {
  if (!ids.length) return;
  const { error } = await getClient()
    .from('corrections')
    .update({ exported_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw new Error(error.message);
}

// Per-field correction counts — the cheapest read on whether a newly promoted
// adapter is actually making fewer mistakes than the one before it.
async function correctionStats({ sinceDays = 30 } = {}) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getClient()
    .from('corrections')
    .select('field, model, created_at')
    .gte('created_at', since);
  if (error) throw new Error(error.message);

  const byField = {};
  const byModel = {};
  for (const row of data ?? []) {
    byField[row.field] = (byField[row.field] ?? 0) + 1;
    if (row.model) byModel[row.model] = (byModel[row.model] ?? 0) + 1;
  }
  return { total: (data ?? []).length, byField, byModel };
}

// Corrections per 100 saves, per producing model — the measure correctionStats
// cannot give on its own, because it has only a numerator.
//
// Attribution comes from formulations.model (010), not corrections.model. Those
// two disagree exactly when it matters: a correction recorded today carries
// today's configured model, but the mistake being corrected was made by whatever
// model wrote the record, possibly the adapter you just replaced. Counting by
// the correcting model would credit a new adapter with its predecessor's errors.
//
// Saves are counted in the window; corrections are counted against records saved
// in that same window, so both sides describe the same population. A record
// corrected long after it was saved therefore falls outside the window with its
// save — deliberately, because including it would push the rate above 100%.
async function modelQualityStats({ sinceDays = 30 } = {}) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: saves, error: savesError }, { data: corrections, error: correctionsError }] = await Promise.all([
    getClient()
      .from('formulations')
      .select('id, model, provider, prompt_version')
      .gte('created_at', since),
    getClient()
      .from('corrections')
      .select('id, field, formulation_id, formulations!inner(model, created_at)')
      .gte('formulations.created_at', since),
  ]);
  if (savesError) throw new Error(savesError.message);
  if (correctionsError) throw new Error(correctionsError.message);

  return summariseModelQuality(saves ?? [], corrections ?? [], { sinceDays });
}

// Pure so it can be unit-tested without a database, and so the same shape can be
// built from a fixture for the admin preview.
function summariseModelQuality(saves, corrections, { sinceDays = 30 } = {}) {
  const UNATTRIBUTED = 'unattributed';
  const byModel = {};
  const bucket = name => (byModel[name] ??= { saves: 0, corrections: 0, correctionsPer100: null, fields: {}, providers: [], promptVersions: [] });

  for (const save of saves) {
    const entry = bucket(save.model || UNATTRIBUTED);
    entry.saves += 1;
    if (save.provider && !entry.providers.includes(save.provider)) entry.providers.push(save.provider);
    if (save.prompt_version && !entry.promptVersions.includes(save.prompt_version)) entry.promptVersions.push(save.prompt_version);
  }

  for (const correction of corrections) {
    const entry = bucket(correction.formulations?.model || UNATTRIBUTED);
    entry.corrections += 1;
    if (correction.field) entry.fields[correction.field] = (entry.fields[correction.field] ?? 0) + 1;
  }

  for (const entry of Object.values(byModel)) {
    // A model with corrections but no saves in the window has no meaningful
    // rate — leaving it null says "not enough evidence" rather than implying
    // an infinite error rate.
    entry.correctionsPer100 = entry.saves ? Number(((entry.corrections / entry.saves) * 100).toFixed(1)) : null;
    entry.providers.sort();
    entry.promptVersions.sort();
  }

  const totalSaves = saves.length;
  const totalCorrections = corrections.length;
  return {
    sinceDays,
    totalSaves,
    totalCorrections,
    attributedSaves: saves.filter(save => save.model).length,
    correctionsPer100: totalSaves ? Number(((totalCorrections / totalSaves) * 100).toFixed(1)) : null,
    byModel,
  };
}

// ─── agent conversation memory (004) ──────────────────────────────────────────

async function appendAgentMessages(practitioner_id, messages) {
  if (!messages.length) return;
  const rows = messages.map(m => ({
    practitioner_id,
    role: m.role,
    content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content,
  }));
  const { error } = await getClient().from('agent_messages').insert(rows);
  if (error) log.error('db.append_agent_messages_failed', { practitioner_id, error: error.message });
}

// Loads the tail of the conversation, oldest-first, for replay as Claude context.
// Anything older than maxAgeHours is dropped so a practitioner returning after a
// week starts fresh rather than resuming a half-finished formulation.
async function loadAgentMessages(practitioner_id, { limit = 40, maxAgeHours = 24 } = {}) {
  const since = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
  // Ordered by seq, not created_at: a turn is one multi-row insert and shares a
  // single now(), so created_at cannot tell the practitioner's message from the
  // reply to it (see 006). Until that migration is applied the column does not
  // exist, and losing the conversation entirely would be a worse failure than
  // the tie-ordering bug — so fall back rather than returning nothing.
  const ordered = orderBy => getClient()
    .from('agent_messages')
    .select(`role, content, ${orderBy}`)
    .eq('practitioner_id', practitioner_id)
    .gte('created_at', since)
    .order(orderBy, { ascending: false })
    .limit(limit);

  let { data, error } = await ordered('seq');

  if (error?.message?.includes('seq')) {
    log.warn('db.migration_missing', { migration: '006', effect: 'agent message ordering is unstable' });
    ({ data, error } = await ordered('created_at'));
  }

  if (error) {
    log.error('db.load_agent_messages_failed', { practitioner_id, error: error.message });
    return [];
  }
  return (data ?? []).reverse().map(r => ({ role: r.role, content: r.content }));
}

async function clearAgentMessages(practitioner_id) {
  const { error } = await getClient()
    .from('agent_messages')
    .delete()
    .eq('practitioner_id', practitioner_id);
  if (error) log.error('db.clear_agent_messages_failed', { practitioner_id, error: error.message });
}

// ─── data-subject rights and governance audit (007) ──────────────────────────

async function writeAuditEvent({ subject_id, actor_id = null, action, resource_type, resource_id = null, metadata = {} }) {
  const { error } = await getClient().from('data_access_audit').insert({
    subject_id,
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
  });
  // Unlike product analytics, a governance audit is not best-effort: a read or
  // destructive action must not proceed invisibly when its audit trail is down.
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

async function exportAccount(practitioner_id) {
  const tables = [
    ['practitioner', 'practitioners', query => query.eq('id', practitioner_id)],
    ['formulations', 'formulations', query => query.eq('practitioner_id', practitioner_id)],
    ['media', 'media', query => query.eq('practitioner_id', practitioner_id)],
    ['specimens', 'specimens', query => query.eq('practitioner_id', practitioner_id)],
    ['patients', 'patients', query => query.eq('practitioner_id', practitioner_id)],
    ['treatments', 'treatments', query => query.eq('practitioner_id', practitioner_id)],
    ['conversations', 'agent_messages', query => query.eq('practitioner_id', practitioner_id)],
    ['events', 'events', query => query.eq('practitioner_id', practitioner_id)],
    ['corrections', 'corrections', query => query.eq('practitioner_id', practitioner_id)],
    ['audit', 'data_access_audit', query => query.eq('subject_id', practitioner_id)],
  ];

  const account = {};
  for (const [key, table, scope] of tables) {
    const { data, error } = await scope(getClient().from(table).select('*'));
    if (error) throw new Error(`account export failed for ${table}: ${error.message}`);
    account[key] = key === 'practitioner' ? (data?.[0] ?? null) : (data ?? []);
  }
  return account;
}

async function createAccountExport(practitioner_id) {
  const account = await exportAccount(practitioner_id);
  const storagePath = `exports/${practitioner_id}/${Date.now()}.json`;
  const body = Buffer.from(JSON.stringify({ exported_at: new Date().toISOString(), account }, null, 2));
  const { error: uploadError } = await getClient()
    .storage
    .from('sanko-media')
    .upload(storagePath, body, { contentType: 'application/json', upsert: false });
  if (uploadError) throw new Error(`account export upload failed: ${uploadError.message}`);

  // Track the export in the same private-media inventory so account deletion
  // removes it along with voice notes and photos.
  await saveMedia({ practitioner_id, kind: 'text', storage_path: storagePath });
  const download_url = await getSignedMediaUrl(storagePath, 3600);
  return { download_url, expires_in_seconds: 3600 };
}

async function deleteAccount(practitioner_id) {
  await writeAuditEvent({
    subject_id: practitioner_id,
    actor_id: practitioner_id,
    action: 'delete_requested',
    resource_type: 'account',
  });

  const { data: mediaRows, error: mediaError } = await getClient()
    .from('media')
    .select('storage_path')
    .eq('practitioner_id', practitioner_id)
    .not('storage_path', 'is', null);
  if (mediaError) throw new Error(`account deletion could not enumerate media: ${mediaError.message}`);

  const storagePaths = (mediaRows ?? []).map(row => row.storage_path).filter(Boolean);
  if (storagePaths.length) {
    const { error } = await getClient().storage.from('sanko-media').remove(storagePaths);
    if (error) throw new Error(`account deletion could not remove archived media: ${error.message}`);
  }

  // events.practitioner_id uses ON DELETE SET NULL so operational incidents can
  // survive an ordinary row removal. A data-subject deletion is different: its
  // practitioner-linked event payloads are personal data and must be erased.
  const { error: eventsError } = await getClient()
    .from('events')
    .delete()
    .eq('practitioner_id', practitioner_id);
  if (eventsError) throw new Error(`account deletion could not remove event history: ${eventsError.message}`);

  const { data, error } = await getClient()
    .from('practitioners')
    .delete()
    .eq('id', practitioner_id)
    .select('id');
  if (error) throw new Error(`account deletion failed: ${error.message}`);
  if (!data?.length) throw new Error('account deletion failed: practitioner not found');

  // subject_id is intentionally not a foreign key: this minimal tombstone is
  // the evidence that a deletion completed after the account itself is gone.
  await writeAuditEvent({
    subject_id: practitioner_id,
    actor_id: null,
    action: 'delete_completed',
    resource_type: 'account',
    metadata: { storage_objects_deleted: storagePaths.length },
  });
}

// ─── admin queries ────────────────────────────────────────────────────────────

const PRACTITIONER_ADMIN_COLUMNS = 'id, display_name, phone_number, preferred_language, created_at, last_active_at';
const PRACTITIONER_REGISTRATION_COLUMNS =
  `${PRACTITIONER_ADMIN_COLUMNS}, region, years_practising, tradition, registered_at, ` +
  'contributor_terms_version, contributor_terms_accepted_at, contributor_terms_declined_at';

async function adminGetPractitioners() {
  // 014 may not be applied yet, and an unknown column fails the whole select.
  // The control room should lose the registration columns in that case, not the
  // practitioner list — the same bargain 010 and 011 already make.
  for (const columns of [PRACTITIONER_REGISTRATION_COLUMNS, PRACTITIONER_ADMIN_COLUMNS]) {
    const { data, error } = await getClient()
      .from('practitioners')
      .select(columns)
      .order('created_at', { ascending: false });
    if (!error) return data ?? [];
    if (columns === PRACTITIONER_ADMIN_COLUMNS) throw new Error(error.message);
    log.warn('db.practitioner_registration_columns_missing', { error: error.message, hint: 'apply supabase/014' });
  }
  return [];
}

async function adminGetFormulations() {
  const { data, error } = await getClient()
    .from('formulations')
    .select('id, short_code, condition_std, condition_local, confidence_score, status, created_at, practitioner_id, practitioners(display_name)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Returns low-confidence formulations + unknown-plant and error events
async function adminGetFlagged() {
  const [{ data: lowConf }, { data: events }] = await Promise.all([
    getClient()
      .from('formulations')
      .select('short_code, condition_std, condition_local, confidence_score, created_at, practitioner_id, practitioners(display_name)')
      .lt('confidence_score', 0.75)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    getClient()
      .from('events')
      .select('id, event_type, payload, created_at, practitioner_id, practitioners(display_name)')
      .in('event_type', ['unknown_plant_flagged', 'error'])
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  return { lowConf: lowConf ?? [], events: events ?? [] };
}

async function adminGetCounts() {
  const [{ count: practCount }, { count: formCount }, { count: flagCount }, { count: patientCount }, { count: treatmentCount }, registeredCount] = await Promise.all([
    getClient().from('practitioners').select('*', { count: 'exact', head: true }),
    getClient().from('formulations').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    getClient().from('formulations').select('*', { count: 'exact', head: true }).lt('confidence_score', 0.75).eq('status', 'active'),
    getClient().from('patients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    getClient().from('treatments').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    // Null rather than 0 when 014 has not been applied: "none registered" and
    // "this deployment cannot say" are different facts and the room should not
    // print the second as the first.
    getClient().from('practitioners').select('*', { count: 'exact', head: true }).not('registered_at', 'is', null)
      .then(({ count, error }) => (error ? null : count ?? 0), () => null),
  ]);
  return {
    practitioners: practCount ?? 0,
    registered: registeredCount,
    formulations: formCount ?? 0,
    flagged: flagCount ?? 0,
    patients: patientCount ?? 0,
    treatments: treatmentCount ?? 0,
  };
}

// PRD §11 — institutional dashboard. Aggregate-only (no PII, no transcripts) so it
// can be served on a public route for grant reviewers and visa endorsers.
async function dashboardGetStats() {
  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [practitionersResult, formulationsResult, recentResult] = await Promise.all([
    getClient().from('practitioners').select('*', { count: 'exact', head: true }),
    getClient().from('formulations').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    getClient()
      .from('formulations')
      .select('created_at')
      .eq('status', 'active')
      .gte('created_at', since30),
  ]);

  _throwOnDashboardQueryError([practitionersResult, formulationsResult, recentResult]);

  return {
    practitioners: practitionersResult.count ?? 0,
    formulations: formulationsResult.count ?? 0,
    byDay: _bucketByDay(recentResult.data ?? [], 30),
    updated_at: new Date().toISOString(),
  };
}

function _throwOnDashboardQueryError(results) {
  const failed = results.find(result => result?.error);
  if (!failed) return;

  throw new Error(`Dashboard aggregate query failed: ${failed.error.message || 'unknown database error'}`);
}

// Builds an array of {day, count} for the last `days` days (oldest first), filling
// empty days with zero so the sparkline shows real gaps rather than a compressed line.
function _bucketByDay(rows, days) {
  const counts = {};
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, count: counts[key] ?? 0 });
  }
  return out;
}

// Returns 7-day and 30-day API-cost event counts plus a 14-day daily breakdown.
// Estimates USD cost using fixed per-call rates (Whisper ~$0.009, Claude text ~$0.003, Claude vision ~$0.010).
async function adminGetUsageStats() {
  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await getClient()
    .from('events')
    .select('event_type, payload, created_at')
    .gte('created_at', since30)
    .order('created_at', { ascending: false });

  const rows = data ?? [];
  const since7ms = now - 7 * 24 * 60 * 60 * 1000;

  // Local calls are free. Only work billed to a third party is costed, so the
  // estimate reads $0.00 on a fully local stack — which is the point of running one.
  const isLocalCall    = r => r.payload?.provider === 'ollama' || r.payload?.local === true;
  const isWhisper      = r => r.event_type === 'whisper_call';
  const isHostedWhisper = r => isWhisper(r) && !isLocalCall(r);
  const isLlmCall      = r => r.event_type === 'llm_call' || r.event_type === 'claude_call';
  const isHostedText   = r => isLlmCall(r) && !isLocalCall(r) && r.payload?.type !== 'vision';
  const isHostedVision = r => isLlmCall(r) && !isLocalCall(r) && r.payload?.type === 'vision';
  const isFormulation  = r => r.event_type === 'formulation_saved';
  const isError        = r => r.event_type === 'error';

  function tally(subset) {
    const whisper      = subset.filter(isHostedWhisper).length;
    const claudeText   = subset.filter(isHostedText).length;
    const claudeVision = subset.filter(isHostedVision).length;
    return {
      whisper, claudeText, claudeVision,
      localCalls:   subset.filter(r => (isLlmCall(r) || isWhisper(r)) && isLocalCall(r)).length,
      formulations: subset.filter(isFormulation).length,
      errors:       subset.filter(isError).length,
      estimatedUSD: (whisper * 0.009 + claudeText * 0.003 + claudeVision * 0.010).toFixed(2),
    };
  }

  const last7  = rows.filter(r => new Date(r.created_at).getTime() >= since7ms);
  const since14ms = now - 14 * 24 * 60 * 60 * 1000;
  const recent14  = rows.filter(r => new Date(r.created_at).getTime() >= since14ms);

  // Group recent 14 days by calendar date
  const dayMap = {};
  for (const r of recent14) {
    const day = r.created_at.slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { day, whisper: 0, claudeText: 0, claudeVision: 0, formulations: 0 };
    if (isHostedWhisper(r))  dayMap[day].whisper++;
    if (isHostedText(r))     dayMap[day].claudeText++;
    if (isHostedVision(r))   dayMap[day].claudeVision++;
    if (isFormulation(r))    dayMap[day].formulations++;
  }
  const byDay = Object.values(dayMap).sort((a, b) => b.day.localeCompare(a.day));

  return { last7: tally(last7), last30: tally(rows), byDay };
}

async function uploadPhoto(practitioner_id, buffer, mimeType) {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `photos/${practitioner_id}/${Date.now()}.${ext}`;
  const { error } = await getClient()
    .storage
    .from('sanko-media')
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(error.message);
  return storagePath;
}

module.exports = {
  getClient,
  logEvent,
  listUnknownPlantEvents,
  saveSpecimen,
  getSpecimenByMediaAndName,
  listSpecimens,
  listUnresolvedSpecimens,
  getPractitionerById,
  createKnowledgeUse,
  addKnowledgeUseContributors,
  listKnowledgeUsesForPractitioner,
  listKnowledgeUses,
  contributorTermsStats,
  claimMessage,
  completeMessage,
  recoverPendingMessages,
  releaseMessageClaim,
  pruneProcessedMessages,
  acquireTurnLock,
  releaseTurnLock,
  getPractitioner,
  createPractitioner,
  updatePractitioner,
  updateLastActive,
  setPendingSourceMedia,
  clearPendingSourceMedia,
  saveMedia,
  uploadVoiceNote,
  uploadPhoto,
  saveFormulation,
  listFormulations,
  getFormulation,
  getFormulationByShortCode,
  getSignedMediaUrl,
  downloadMedia,
  updateFormulationField,
  createPatient,
  findPatientByPhone,
  markPatientConsentInvited,
  deletePendingPatient,
  getPendingPatientConsent,
  acceptPatientConsent,
  declinePatientConsent,
  deleteExpiredPatientInvites,
  listPatients,
  getPatientByShortCode,
  findPatientsByName,
  updatePatient,
  createTreatment,
  listTreatmentsForPatient,
  getTreatmentByShortCode,
  updateTreatment,
  listDueFollowUps,
  recordCorrection,
  recordAdminReview,
  adminGetTranscriptQueue,
  recordTranscriptReview,
  listPageCorrectionsForExport,
  REVIEW_FIELD_BY_KIND,
  listCorrectionsForEvalDrafting,
  markCorrectionsHeldOut,
  releaseHeldOutCorrections,
  listHeldOutCorrections,
  listCorrectionsForExport,
  markCorrectionsExported,
  correctionStats,
  modelQualityStats,
  summariseModelQuality,
  appendAgentMessages,
  loadAgentMessages,
  clearAgentMessages,
  writeAuditEvent,
  exportAccount,
  createAccountExport,
  deleteAccount,
  adminGetPractitioners,
  adminGetFormulations,
  adminGetFlagged,
  adminGetCounts,
  adminGetUsageStats,
  dashboardGetStats,
  _throwOnDashboardQueryError,
};

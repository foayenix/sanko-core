// In-memory stand-in for the Supabase service.
//
// The agent, tools, router and practitioner modules all hold the service as a
// namespace (`const db = require('../services/supabase')`) and call through it,
// so swapping the functions on that shared object is enough to run the whole
// agent offline — no network, no keys, no mocking framework.

const real = require('../../src/services/supabase');

function installFakeDb() {
  const originals = { ...real };

  const store = {
    practitioners: [],
    formulations: [],
    patients: [],
    treatments: [],
    events: [],
    agentMessages: [],
    corrections: [],
    audit: [],
    media: [],
    specimens: [],
    uploads: [],
    processedMessages: new Map(),
    turnLocks: new Map(),
    knowledgeUse: [],
    knowledgeUseContributors: [],
  };
  const seq = { fm: 0, pt: 0, tx: 0, sp: 0, id: 0 };
  const uid = () => `id-${++seq.id}`;
  const pad = n => String(n).padStart(5, '0');
  const now = () => new Date().toISOString();

  Object.assign(real, {
    // ── contributor terms and knowledge use (013) ──
    async getPractitionerById(id) {
      return store.practitioners.find(row => row.id === id) ?? null;
    },
    async createKnowledgeUse(row) {
      const record = { id: uid(), created_at: now(), ...row };
      store.knowledgeUse.push(record);
      return record;
    },
    async addKnowledgeUseContributors(knowledge_use_id, contributors) {
      for (const entry of contributors) {
        store.knowledgeUseContributors.push({
          knowledge_use_id,
          practitioner_id: entry.practitioner_id,
          record_count: entry.record_count ?? 0,
          terms_version: entry.terms_version ?? null,
        });
      }
    },
    async listKnowledgeUsesForPractitioner(practitioner_id) {
      return store.knowledgeUseContributors
        .filter(row => row.practitioner_id === practitioner_id)
        .map(row => ({ ...row, knowledge_use: store.knowledgeUse.find(u => u.id === row.knowledge_use_id) ?? null }));
    },
    async listKnowledgeUses({ limit = 100 } = {}) {
      return store.knowledgeUse.slice(0, limit).map(row => ({
        ...row,
        knowledge_use_contributors: store.knowledgeUseContributors.filter(c => c.knowledge_use_id === row.id),
      }));
    },
    async contributorTermsStats(currentHash) {
      const rows = store.practitioners;
      return {
        total: rows.length,
        accepted: rows.filter(r => r.contributor_terms_accepted_at).length,
        current: rows.filter(r => r.contributor_terms_hash === currentHash).length,
        stale: rows.filter(r => r.contributor_terms_accepted_at && r.contributor_terms_hash !== currentHash).length,
      };
    },

    // ── durable runtime state (012) ──
    async claimMessage(message_id, transport = 'meta', { payload = null } = {}) {
      if (!message_id) return true;
      if (store.processedMessages.has(message_id)) return false;
      store.processedMessages.set(message_id, {
        message_id, transport, payload, attempts: 1, completed_at: null, first_seen_at: now(),
      });
      return true;
    },
    async completeMessage(message_id) {
      const row = store.processedMessages.get(message_id);
      if (row) Object.assign(row, { completed_at: now(), payload: null });
    },
    async recoverPendingMessages({ transport = null, olderThanSeconds = 900, maxAttempts = 3, limit = 100 } = {}) {
      const cutoff = Date.now() - olderThanSeconds * 1000;
      const pending = [];
      const abandoned = [];
      const closed = [];
      const candidates = [...store.processedMessages.values()]
        .filter(row => !row.completed_at && Date.parse(row.first_seen_at) < cutoff)
        .filter(row => !transport || row.transport === transport)
        .sort((a, b) => Date.parse(a.first_seen_at) - Date.parse(b.first_seen_at))
        .slice(0, limit);

      for (const row of candidates) {
        if (!row.payload) { closed.push(row); continue; }
        if (row.attempts >= maxAttempts) { abandoned.push(row); closed.push(row); continue; }
        pending.push({ ...row });
      }
      for (const row of closed) Object.assign(row, { completed_at: now(), payload: null });
      for (const row of pending) store.processedMessages.get(row.message_id).attempts = row.attempts + 1;
      return { pending, abandoned };
    },
    async releaseMessageClaim(message_id) {
      store.processedMessages.delete(message_id);
    },
    async pruneProcessedMessages({ olderThanHours = 24 } = {}) {
      const cutoff = Date.now() - olderThanHours * 3_600_000;
      for (const [id, row] of store.processedMessages) {
        if (row.completed_at && Date.parse(row.first_seen_at) < cutoff) store.processedMessages.delete(id);
      }
    },
    async acquireTurnLock(practitioner_id, holder, ttlSeconds) {
      const held = store.turnLocks.get(practitioner_id);
      if (held && held.expires_at > Date.now()) return false;
      store.turnLocks.set(practitioner_id, { holder, expires_at: Date.now() + ttlSeconds * 1000 });
      return true;
    },
    async releaseTurnLock(practitioner_id, holder) {
      if (store.turnLocks.get(practitioner_id)?.holder === holder) store.turnLocks.delete(practitioner_id);
    },

    // ── events ──
    async logEvent({ practitioner_id, event_type, payload }) {
      store.events.push({ practitioner_id, event_type, payload, created_at: now() });
    },

    // ── practitioners ──
    async getPractitioner(phone_number) {
      return store.practitioners.find(p => p.phone_number === phone_number) ?? null;
    },
    async createPractitioner({ phone_number, display_name, preferred_language }) {
      if (store.practitioners.some(p => p.phone_number === phone_number)) {
        throw new Error('duplicate key value violates unique constraint');
      }
      const row = {
        id: uid(), phone_number,
        display_name: display_name ?? null,
        preferred_language: preferred_language ?? null,
        created_at: now(), last_active_at: now(),
      };
      store.practitioners.push(row);
      return row;
    },
    async updatePractitioner(id, fields) {
      const row = store.practitioners.find(p => p.id === id);
      if (!row) throw new Error('practitioner not found');
      Object.assign(row, fields);
      return row;
    },
    async updateLastActive(id) {
      const row = store.practitioners.find(p => p.id === id);
      if (row) row.last_active_at = now();
    },
    async setPendingSourceMedia(id, media_id) {
      const row = store.practitioners.find(p => p.id === id);
      if (!row) throw new Error('practitioner not found');
      row.pending_source_media_id = media_id;
      row.pending_source_media_at = now();
    },
    async clearPendingSourceMedia(id) {
      const row = store.practitioners.find(p => p.id === id);
      if (!row) throw new Error('practitioner not found');
      row.pending_source_media_id = null;
      row.pending_source_media_at = null;
    },

    // ── formulations ──
    async saveFormulation({ practitioner_id, source_media_id, structured, original_text, original_language, model, provider, prompt_version, plant_data_version }) {
      const row = {
        id: uid(),
        practitioner_id,
        source_media_id: source_media_id ?? null,
        short_code: `FM-${pad(++seq.fm)}`,
        condition_local: structured.condition?.local_name ?? null,
        condition_std: structured.condition?.standardised ?? null,
        icd_11_code: structured.condition?.icd_11_code ?? null,
        plants: structured.plants ?? [],
        preparation: structured.preparation ?? null,
        dosage: structured.dosage ?? null,
        notes: structured.notes ?? null,
        original_text: original_text ?? null,
        original_language: original_language ?? null,
        confidence_score: structured.metadata?.confidence_score ?? null,
        model: model ?? null,
        provider: provider ?? null,
        prompt_version: prompt_version ?? null,
        plant_data_version: plant_data_version ?? null,
        status: 'active',
        created_at: now(),
      };
      store.formulations.push(row);
      const practitioner = store.practitioners.find(p => p.id === practitioner_id);
      if (practitioner?.pending_source_media_id === source_media_id) {
        practitioner.pending_source_media_id = null;
        practitioner.pending_source_media_at = null;
      }
      return row;
    },
    async listFormulations(practitioner_id, limit = 10) {
      return store.formulations
        .filter(f => f.practitioner_id === practitioner_id && f.status === 'active')
        .slice(-limit)
        .reverse();
    },
    async getFormulationByShortCode(short_code, practitioner_id) {
      return store.formulations.find(
        f => f.short_code === String(short_code).toUpperCase() &&
             f.practitioner_id === practitioner_id &&
             f.status === 'active'
      ) ?? null;
    },
    async updateFormulationField(id, field, value) {
      const row = store.formulations.find(f => f.id === id);
      if (!row) throw new Error('formulation not found');
      row[field] = value;
      return row;
    },

    // ── patients ──
    async createPatient({ practitioner_id, display_name, age_years, sex, phone_number, notes, status, consent_status, consent_method, consent_recorded_at, consent_expires_at }) {
      const row = {
        id: uid(), practitioner_id,
        short_code: `PT-${pad(++seq.pt)}`,
        display_name, age_years: age_years ?? null, sex: sex ?? null,
        phone_number: phone_number ?? null, notes: notes ?? null,
        consent_status: consent_status ?? 'pending', consent_method: consent_method ?? null,
        consent_recorded_at: consent_recorded_at ?? null,
        consent_expires_at: consent_expires_at ?? null,
        consent_invited_at: null,
        consent_response_message_id: null,
        status: status ?? 'pending_consent', created_at: now(),
      };
      store.patients.push(row);
      return row;
    },
    async findPatientByPhone(phone_number, practitioner_id) {
      return store.patients.find(p => p.phone_number === phone_number &&
        p.practitioner_id === practitioner_id && ['active', 'pending_consent'].includes(p.status)) ?? null;
    },
    async markPatientConsentInvited(id, practitioner_id) {
      const row = store.patients.find(p => p.id === id && p.practitioner_id === practitioner_id && p.status === 'pending_consent');
      if (!row) throw new Error('pending patient not found');
      row.consent_invited_at = now();
      return row;
    },
    async deletePendingPatient(id, practitioner_id) {
      store.patients = store.patients.filter(p => !(p.id === id && p.practitioner_id === practitioner_id && p.status === 'pending_consent'));
    },
    async getPendingPatientConsent(id, phone_number) {
      const row = store.patients.find(p => p.id === id && p.phone_number === phone_number &&
        p.status === 'pending_consent' && p.consent_status === 'pending' && p.consent_expires_at > now());
      if (!row) return null;
      return { ...row, practitioners: store.practitioners.find(p => p.id === row.practitioner_id) ?? null };
    },
    async acceptPatientConsent(id, phone_number, response_message_id) {
      const row = store.patients.find(p => p.id === id && p.phone_number === phone_number &&
        p.status === 'pending_consent' && p.consent_status === 'pending' && p.consent_expires_at > now());
      if (!row) return null;
      Object.assign(row, {
        status: 'active', consent_status: 'granted', consent_method: 'whatsapp',
        consent_recorded_at: now(), consent_response_message_id: response_message_id ?? null,
      });
      return row;
    },
    async declinePatientConsent(id, phone_number) {
      const before = store.patients.length;
      store.patients = store.patients.filter(p => !(p.id === id && p.phone_number === phone_number && p.status === 'pending_consent'));
      return store.patients.length < before;
    },
    async deleteExpiredPatientInvites() {
      store.patients = store.patients.filter(p => p.status !== 'pending_consent' || p.consent_expires_at > now());
    },
    async listPatients(practitioner_id, limit = 20) {
      return store.patients
        .filter(p => p.practitioner_id === practitioner_id && ['active', 'pending_consent'].includes(p.status))
        .slice(-limit)
        .reverse();
    },
    async getPatientByShortCode(short_code, practitioner_id) {
      return store.patients.find(
        p => p.short_code === String(short_code).toUpperCase() &&
             p.practitioner_id === practitioner_id &&
             ['active', 'pending_consent'].includes(p.status)
      ) ?? null;
    },
    async findPatientsByName(name, practitioner_id, limit = 5) {
      const needle = name.toLowerCase();
      return store.patients
        .filter(p => p.practitioner_id === practitioner_id && ['active', 'pending_consent'].includes(p.status) &&
                     p.display_name.toLowerCase().includes(needle))
        .slice(0, limit);
    },
    async updatePatient(id, fields) {
      const row = store.patients.find(p => p.id === id);
      if (!row) throw new Error('patient not found');
      Object.assign(row, fields);
      return row;
    },

    // ── treatments ──
    async createTreatment({ practitioner_id, patient_id, formulation_id, condition_reported, started_on, follow_up_on, outcome_notes }) {
      const patient = store.patients.find(p => p.id === patient_id && p.practitioner_id === practitioner_id);
      if (!patient || patient.status !== 'active' || patient.consent_status !== 'granted') {
        throw new Error('treatment requires an active patient with recorded consent');
      }
      const row = {
        id: uid(), practitioner_id, patient_id,
        formulation_id: formulation_id ?? null,
        short_code: `TX-${pad(++seq.tx)}`,
        condition_reported: condition_reported ?? null,
        started_on: started_on ?? now().slice(0, 10),
        outcome: 'ongoing', outcome_notes: outcome_notes ?? null,
        follow_up_on: follow_up_on ?? null,
        status: 'active', created_at: now(),
      };
      store.treatments.push(row);
      return row;
    },
    async listTreatmentsForPatient(patient_id, practitioner_id) {
      return store.treatments
        .filter(t => t.patient_id === patient_id && t.practitioner_id === practitioner_id && t.status === 'active')
        .map(t => ({
          ...t,
          formulations: t.formulation_id
            ? store.formulations.find(f => f.id === t.formulation_id) ?? null
            : null,
        }))
        .reverse();
    },
    async getTreatmentByShortCode(short_code, practitioner_id) {
      return store.treatments.find(
        t => t.short_code === String(short_code).toUpperCase() &&
             t.practitioner_id === practitioner_id &&
             t.status === 'active'
      ) ?? null;
    },
    async updateTreatment(id, fields) {
      const row = store.treatments.find(t => t.id === id);
      if (!row) throw new Error('treatment not found');
      Object.assign(row, fields);
      return row;
    },
    async listDueFollowUps(practitioner_id) {
      const today = now().slice(0, 10);
      return store.treatments
        .filter(t => t.practitioner_id === practitioner_id && t.status === 'active' &&
                     t.outcome === 'ongoing' && t.follow_up_on && t.follow_up_on <= today)
        .map(t => ({ ...t, patients: store.patients.find(p => p.id === t.patient_id) ?? null }));
    },

    // ── agent memory ──
    async appendAgentMessages(practitioner_id, messages) {
      for (const m of messages) {
        store.agentMessages.push({
          practitioner_id,
          role: m.role,
          content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content,
          created_at: now(),
        });
      }
    },
    async loadAgentMessages(practitioner_id, { limit = 40 } = {}) {
      return store.agentMessages
        .filter(m => m.practitioner_id === practitioner_id)
        .slice(-limit)
        .map(m => ({ role: m.role, content: m.content }));
    },
    async clearAgentMessages(practitioner_id) {
      store.agentMessages = store.agentMessages.filter(m => m.practitioner_id !== practitioner_id);
    },

    // ── account rights / governance audit ──
    async writeAuditEvent(row) {
      store.audit.push({ id: uid(), ...row, created_at: now() });
    },
    async exportAccount(practitioner_id) {
      return {
        practitioner: store.practitioners.find(p => p.id === practitioner_id) ?? null,
        formulations: store.formulations.filter(r => r.practitioner_id === practitioner_id),
        media: store.media.filter(r => r.practitioner_id === practitioner_id),
        specimens: store.specimens.filter(r => r.practitioner_id === practitioner_id),
        patients: store.patients.filter(r => r.practitioner_id === practitioner_id),
        treatments: store.treatments.filter(r => r.practitioner_id === practitioner_id),
        conversations: store.agentMessages.filter(r => r.practitioner_id === practitioner_id),
        events: store.events.filter(r => r.practitioner_id === practitioner_id),
        corrections: store.corrections.filter(r => r.practitioner_id === practitioner_id),
        audit: store.audit.filter(r => r.subject_id === practitioner_id),
      };
    },
    async createAccountExport(practitioner_id) {
      const account = await real.exportAccount(practitioner_id);
      const path = `exports/${practitioner_id}/${store.uploads.length}.json`;
      store.uploads.push({ path, bytes: JSON.stringify(account).length, mimeType: 'application/json' });
      store.media.push({ id: uid(), practitioner_id, kind: 'text', storage_path: path, created_at: now() });
      return { download_url: `https://example.test/signed/${path}`, expires_in_seconds: 3600 };
    },
    async deleteAccount(practitioner_id) {
      await real.writeAuditEvent({ subject_id: practitioner_id, actor_id: practitioner_id, action: 'delete_requested', resource_type: 'account' });
      store.uploads = store.uploads.filter(upload => !upload.path.includes(`/${practitioner_id}/`));
      for (const key of ['formulations', 'patients', 'treatments', 'agentMessages', 'corrections', 'media', 'events']) {
        store[key] = store[key].filter(row => row.practitioner_id !== practitioner_id);
      }
      store.practitioners = store.practitioners.filter(row => row.id !== practitioner_id);
      await real.writeAuditEvent({ subject_id: practitioner_id, actor_id: null, action: 'delete_completed', resource_type: 'account' });
    },

    // ── corrections (005) ──
    async recordCorrection({ practitioner_id, formulation_id, media_id, field, before, after, source = 'practitioner_edit', reviewer_ref = null, note = null }) {
      store.corrections.push({
        id: uid(), practitioner_id, formulation_id: formulation_id ?? null, media_id: media_id ?? null,
        field, before_value: before ?? null, after_value: after ?? null,
        source, reviewer_ref, note, model: 'fake-model', provider: 'fake',
        exported_at: null, held_out_at: null, held_out_case_id: null, created_at: now(),
      });
    },

    // ── review capture (011) ──
    async recordAdminReview({ short_code, field, after, reviewer_ref, note = null }) {
      const formulation = store.formulations.find(row => row.short_code === short_code);
      if (!formulation) throw new Error(`No formulation ${short_code}`);
      store.corrections.push({
        id: uid(), practitioner_id: formulation.practitioner_id, formulation_id: formulation.id, media_id: null,
        field, before_value: formulation[field] ?? null, after_value: after,
        source: 'admin_review', reviewer_ref, note, model: formulation.model ?? 'fake-model', provider: 'fake',
        exported_at: null, held_out_at: null, held_out_case_id: null, created_at: now(),
      });
      store.events.push({ practitioner_id: formulation.practitioner_id, event_type: 'admin_review_proposed', payload: { short_code, field, reviewer_ref }, created_at: now() });
      return { short_code, field, before: formulation[field] ?? null, after };
    },
    async adminGetTranscriptQueue({ limit = 50, kind = null } = {}) {
      const kinds = kind ? [kind] : ['voice', 'photo'];
      return store.media.filter(row => kinds.includes(row.kind)).slice(0, limit).map(row => {
        const field = real.REVIEW_FIELD_BY_KIND[row.kind];
        const review = store.corrections.find(c => c.field === field && c.media_id === row.id);
        return { ...row, reviewed_at: review?.created_at ?? null, reviewed_by: review?.reviewer_ref ?? null };
      });
    },
    async recordTranscriptReview({ media_id, transcript, reviewer_ref, note = null }) {
      const media = store.media.find(row => row.id === media_id);
      if (!media) throw new Error(`No media ${media_id}`);
      const field = real.REVIEW_FIELD_BY_KIND[media.kind];
      if (!field) throw new Error(`Media ${media_id} is a ${media.kind}; only voice notes and photos carry a reading to correct.`);
      if ((media.transcript ?? '') === transcript) return { media_id, kind: media.kind, field, changed: false };
      store.corrections.push({
        id: uid(), practitioner_id: media.practitioner_id, formulation_id: null, media_id,
        field, before_value: media.transcript ?? null, after_value: transcript,
        source: 'admin_review', reviewer_ref, note,
        model: media.transcript_model ?? (media.kind === 'voice' ? 'fake-whisper' : null),
        provider: media.transcript_provider ?? (media.kind === 'voice' ? 'fake' : null),
        exported_at: null, held_out_at: null, held_out_case_id: null, created_at: now(),
      });
      media.transcript = transcript;
      const affected = store.formulations
        .filter(f => f.source_media_id === media_id)
        .map(f => ({ short_code: f.short_code, condition_local: f.condition_local ?? null, condition_std: f.condition_std ?? null }));
      store.events.push({
        practitioner_id: media.practitioner_id,
        event_type: media.kind === 'photo' ? 'page_transcript_reviewed' : 'transcript_reviewed',
        payload: { media_id, reviewer_ref, field, affected_formulations: affected.map(f => f.short_code) },
        created_at: now(),
      });
      return { media_id, kind: media.kind, field, changed: true, affected };
    },
    async listPageCorrectionsForExport({ onlyUnexported = true, limit = 5000 } = {}) {
      return store.corrections
        .filter(c => c.field === 'page_transcript' && c.media_id && c.held_out_at === null && (!onlyUnexported || !c.exported_at))
        .slice(0, limit)
        .map(c => ({ ...c, media: store.media.find(m => m.id === c.media_id) ?? null }));
    },
    async downloadMedia(storage_path) {
      const upload = store.uploads.find(row => row.path === storage_path);
      if (!upload) throw new Error(`Could not download ${storage_path}: not in the fake store`);
      return Buffer.alloc(upload.bytes, 1);
    },
    async listCorrectionsForEvalDrafting({ limit = 500 } = {}) {
      return store.corrections
        .filter(c => c.held_out_at === null && c.formulation_id)
        .slice(0, limit)
        .map(c => ({ ...c, formulations: store.formulations.find(f => f.id === c.formulation_id) ?? null }));
    },
    async markCorrectionsHeldOut(entries) {
      for (const { id, case_id } of entries) {
        const row = store.corrections.find(c => c.id === id);
        if (row) { row.held_out_at = now(); row.held_out_case_id = case_id; }
      }
    },
    async releaseHeldOutCorrections(ids) {
      for (const row of store.corrections) {
        if (ids.includes(row.id)) { row.held_out_at = null; row.held_out_case_id = null; }
      }
    },
    async listHeldOutCorrections() {
      return store.corrections.filter(c => c.held_out_at).map(c => ({ id: c.id, held_out_case_id: c.held_out_case_id, held_out_at: c.held_out_at }));
    },
    async listCorrectionsForExport({ onlyUnexported = true, limit = 5000 } = {}) {
      return store.corrections
        .filter(c => c.held_out_at === null)
        .filter(c => !onlyUnexported || c.exported_at === null)
        .slice(0, limit)
        .map(c => ({
          ...c,
          formulations: store.formulations.find(f => f.id === c.formulation_id) ?? null,
        }));
    },
    async modelQualityStats({ sinceDays = 30 } = {}) {
      const corrections = store.corrections
        .map(c => ({ ...c, formulations: store.formulations.find(f => f.id === c.formulation_id) ?? null }))
        .filter(c => c.formulations);
      return real.summariseModelQuality(store.formulations, corrections, { sinceDays });
    },
    async markCorrectionsExported(ids) {
      for (const c of store.corrections) {
        if (ids.includes(c.id)) c.exported_at = now();
      }
    },
    async correctionStats() {
      const byField = {};
      for (const c of store.corrections) byField[c.field] = (byField[c.field] ?? 0) + 1;
      return { total: store.corrections.length, byField, byModel: {} };
    },

    // ── admin / dashboard queries ──
    async adminGetCounts() {
      return {
        practitioners: store.practitioners.length,
        formulations: store.formulations.filter(f => f.status === 'active').length,
        flagged: store.formulations.filter(f => f.status === 'active' && f.confidence_score < 0.75).length,
        patients: store.patients.filter(p => p.status === 'active').length,
        treatments: store.treatments.filter(t => t.status === 'active').length,
      };
    },
    async adminGetPractitioners() {
      return store.practitioners.slice().reverse();
    },
    async adminGetFormulations() {
      return store.formulations
        .filter(f => f.status === 'active')
        .map(f => ({ ...f, practitioners: store.practitioners.find(p => p.id === f.practitioner_id) ?? null }))
        .reverse();
    },
    async adminGetFlagged() {
      return {
        lowConf: store.formulations.filter(f => f.status === 'active' && f.confidence_score < 0.75),
        events: store.events.filter(e => ['unknown_plant_flagged', 'error'].includes(e.event_type)),
      };
    },
    async adminGetUsageStats() {
      const empty = { whisper: 0, claudeText: 0, claudeVision: 0, formulations: 0, errors: 0, estimatedUSD: '0.00' };
      return { last7: { ...empty }, last30: { ...empty }, byDay: [] };
    },
    async dashboardGetStats() {
      return {
        practitioners: store.practitioners.length,
        formulations: store.formulations.filter(f => f.status === 'active').length,
        byDay: [],
        updated_at: now(),
      };
    },

    // ── media ──
    async saveMedia(row) {
      store.media.push({ id: uid(), ...row });
      return store.media[store.media.length - 1];
    },
    async uploadVoiceNote(practitioner_id, buffer, mimeType) {
      const path = `voice/${practitioner_id}/${store.uploads.length}.ogg`;
      store.uploads.push({ path, bytes: buffer.length, mimeType });
      return path;
    },
    // ── specimens (018) ──
    async saveSpecimen(row) {
      if (row.botanical && !(row.botanical_source && row.plant_data_version)) {
        throw new Error('a botanical name cannot be stored without its source and index version');
      }
      // The unique index on (media_id, local_name_normalised): the same photo
      // named the same way twice returns the row that already exists.
      const existing = store.specimens.find(
        s => s.media_id === row.media_id && s.local_name_normalised === row.local_name_normalised
      );
      if (existing) return { ...existing, duplicate: true };

      const record = {
        id: uid(),
        short_code: `SP-${pad(++seq.sp)}`,
        status: 'practitioner_named',
        created_at: now(),
        ...row,
      };
      store.specimens.push(record);
      return record;
    },
    async getSpecimenByMediaAndName(media_id, local_name_normalised) {
      return store.specimens.find(
        s => s.media_id === media_id && s.local_name_normalised === local_name_normalised
      ) ?? null;
    },
    async listSpecimens(practitioner_id, limit = 10) {
      return store.specimens
        .filter(s => s.practitioner_id === practitioner_id && s.status !== 'withdrawn')
        .slice()
        .reverse()
        .slice(0, limit);
    },
    async listUnresolvedSpecimens({ limit = 200 } = {}) {
      return store.specimens
        .filter(s => !s.botanical && s.status !== 'withdrawn')
        .slice()
        .reverse()
        .slice(0, limit);
    },
    async uploadPhoto(practitioner_id, buffer, mimeType) {
      const path = `photos/${practitioner_id}/${store.uploads.length}.jpg`;
      store.uploads.push({ path, bytes: buffer.length, mimeType });
      return path;
    },
  });

  // Convenience: seed a practitioner past registration, which is what almost
  // every case wants — it is testing the Vault, not the way in. Pass
  // { region: null, registered_at: null } to get someone mid-onboarding.
  store.seedPractitioner = (overrides = {}) => {
    const row = {
      id: uid(),
      phone_number: '+2348000000000',
      display_name: 'Baba Ade',
      preferred_language: 'yo',
      region: 'Ibadan',
      years_practising: 22,
      tradition: 'Yoruba herbal medicine',
      created_at: now(),
      last_active_at: now(),
      ...overrides,
    };
    // Derived rather than defaulted, so a fixture that clears the name or the
    // region cannot end up claiming a registration it does not have — an
    // incoherent row would make the gate look broken in exactly the cases that
    // are testing it.
    if (!('registered_at' in overrides)) {
      row.registered_at = row.display_name && row.region ? now() : null;
    }
    store.practitioners.push(row);
    return row;
  };
  store.eventsOfType = type => store.events.filter(e => e.event_type === type);

  // Convenience: pre-populate a formulation so a case can refer to FM-00001
  // without walking the agent through documenting it first.
  store.seedFormulation = (practitioner_id, overrides = {}) => {
    seq.fm++;
    const row = {
      id: uid(), practitioner_id,
      short_code: `FM-${pad(seq.fm)}`,
      condition_local: null, condition_std: null, icd_11_code: null,
      plants: [], preparation: null, dosage: null, notes: null,
      original_text: null, original_language: null, confidence_score: 0.9,
      status: 'active', created_at: now(),
      ...overrides,
    };
    store.formulations.push(row);
    return row;
  };

  return { store, restore: () => Object.assign(real, originals) };
}

// Scripted Anthropic client. `script` is an array of API responses returned in
// order; the last one repeats if the agent asks for more turns than scripted.
function fakeClient(script) {
  const calls = [];
  let index = 0;
  return {
    calls,
    messages: {
      async create(params) {
        // The agent mutates its `messages` array in place across iterations, so
        // snapshot it — otherwise every recorded call aliases the final state.
        calls.push({ ...params, messages: params.messages.slice() });
        const response = script[Math.min(index, script.length - 1)];
        index++;
        return response;
      },
    },
  };
}

const textResponse = text => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
});

const toolResponse = (name, input, { id = 'toolu_1', text = null } = {}) => ({
  content: [
    ...(text ? [{ type: 'text', text }] : []),
    { type: 'tool_use', id, name, input },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 10, output_tokens: 5 },
});

module.exports = { installFakeDb, fakeClient, textResponse, toolResponse };

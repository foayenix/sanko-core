// Tool definitions and executors for the Sanko agent.
//
// Every tool is scoped to the calling practitioner: the executor takes the
// practitioner from the runtime context, never from model-supplied input. A
// short_code the model invents therefore resolves to "not found" rather than to
// another practitioner's record.
//
// Executors return plain objects. The agent loop JSON-stringifies them into
// tool_result blocks, so keep them small and human-readable — the model reads
// these back and often quotes them to the practitioner.

const db = require('../services/supabase');
const log = require('../utils/log');
const plantLookup = require('../utils/plantLookup');
const llm = require('../services/llm');
const { formatCard } = require('../utils/format');
const { promptVersion } = require('./prompt');
const { validate } = require('./validate');
const registration = require('./registration');
const governance = require('../services/governance');

const LANGUAGE_CODES = ['en', 'yo', 'ig', 'ha'];
const SHORT_CODE = '^[A-Z]{2}-[0-9]{5}$';
const DELETE_CONFIRMATION = 'DELETE MY SANKO ACCOUNT';

// ─── shared input schemas ─────────────────────────────────────────────────────

// The binomial is not an input, for the same reason it is not one on
// save_specimen: a botanical name the model supplies is a claim nobody checked,
// attached to a real practitioner's remedy. Sanko resolves it from the index in
// code and reports what it found. A model that sends `botanical` anyway is
// rejected by validate() with "is not permitted" — the whitelist is the schema,
// enforced deterministically before any executor runs.
const PLANT_SCHEMA = {
  type: 'object',
  properties: {
    local_name:          { type: 'string', minLength: 1, maxLength: 200, description: 'The name the practitioner used, verbatim. Sanko resolves the botanical name from this itself.' },
    quantity_raw:        { type: ['string', 'null'], description: 'Quantity as spoken, e.g. "two handfuls".' },
    quantity_normalised: { type: ['string', 'null'], description: 'Best-effort standard measure, e.g. "~60 g".' },
    part_used:           { type: ['string', 'null'], description: 'leaves | bark | root | seeds | whole plant …' },
  },
  required: ['local_name'],
};

const PREPARATION_SCHEMA = {
  type: ['object', 'null'],
  properties: {
    method:           { type: ['string', 'null'], description: 'decoction | infusion | maceration | powder | poultice …' },
    duration_minutes: { type: ['number', 'null'], minimum: 0, maximum: 10080 },
    medium:           { type: ['string', 'null'], description: 'water, palm wine, honey, gin …' },
  },
};

const DOSAGE_SCHEMA = {
  type: ['object', 'null'],
  properties: {
    amount:        { type: ['string', 'null'], description: 'e.g. "one cup"' },
    frequency:     { type: ['string', 'null'], description: 'e.g. "twice daily"' },
    duration_days: { type: ['number', 'null'], minimum: 0, maximum: 36500 },
  },
};

// ─── tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'set_profile',
    description:
      "Record or update the practitioner's own name and preferred language. Call this " +
      'the moment they tell you their name, in the same turn — saying "Noted, X" in ' +
      'text does not record anything, and a name you do not save is a name you have to ' +
      'ask for again. Call it again if they ask to change either field. Omit ' +
      'preferred_language unless they named exactly one language; never wait for a ' +
      'language answer before saving the name.',
    input_schema: {
      type: 'object',
      properties: {
        display_name:       { type: 'string', minLength: 1, maxLength: 200, description: 'How they want to be addressed. Required — save it as soon as you learn it.' },
        preferred_language: {
          type: 'string',
          enum: LANGUAGE_CODES,
          description:
            'ISO 639-1: en, yo, ig, ha. Optional, and omitting it is meaningful: it records ' +
            '"not stated", which lets their voice notes be transcribed by detecting what was ' +
            'actually spoken. Set it only if they named exactly one language. If they named ' +
            'several ("both Yoruba and English"), said they mix, or said nothing about ' +
            'language, leave this out entirely rather than guessing.',
        },
      },
      required: ['display_name'],
    },
  },
  {
    name: 'set_practice_details',
    description:
      'Record where the practitioner practises, and optionally how long they have practised and ' +
      'what tradition they work in. Call it as soon as they say where they are, in the same turn. ' +
      'The region is what makes a formulation checkable later — the same local plant name means ' +
      'different plants in different places — so it is asked of everyone, once. Years and tradition ' +
      'are context: pass them if they were offered, never hold the region back waiting for them, ' +
      'and do not ask a second time if they were not answered.',
    input_schema: {
      type: 'object',
      properties: {
        region: {
          type: 'string', minLength: 1, maxLength: 200,
          description: 'Where they practise, in their own words — a state, a town, a district. Record what they say; do not translate it or tidy it into an official name.',
        },
        years_practising: {
          type: ['number', 'null'], minimum: 0, maximum: 100,
          description: 'Whole years, if they said. Omit rather than estimating from "a long time".',
        },
        tradition: {
          type: ['string', 'null'], maxLength: 200,
          description: 'The tradition or specialisation they name — how they describe their own practice, not a category you assign.',
        },
      },
      required: ['region'],
    },
  },
  {
    name: 'accept_contributor_terms',
    description:
      'Record the practitioner\'s answer on the contributor terms — whether what they document may ' +
      'ever be used beyond their own Vault. Only call this after you have put the terms to them and ' +
      'they have answered. Both answers are recorded and neither is asked again. Declining costs ' +
      'them nothing: everything in Sanko keeps working either way, and you must say so before asking.',
    input_schema: {
      type: 'object',
      properties: {
        accepted: {
          type: 'boolean',
          description: 'true only if they clearly agreed. Silence, a change of subject, or "I will think about it" is not agreement — do not call this at all in that case.',
        },
      },
      required: ['accepted'],
    },
  },
  {
    name: 'save_formulation',
    description:
      'Save a herbal formulation to the practitioner\'s Vault. Only call this after ' +
      'showing them the details and getting their agreement. Leave fields null rather ' +
      'than guessing — a partial record is fine, an invented one is not.',
    input_schema: {
      type: 'object',
      properties: {
        condition_local:   { type: ['string', 'null'], description: 'Condition in the practitioner\'s own words.' },
        condition_std:     { type: ['string', 'null'], description: 'Standardised biomedical name, if confident.' },
        icd_11_code:       { type: ['string', 'null'] },
        plants:            { type: 'array', minItems: 1, maxItems: 100, items: PLANT_SCHEMA },
        preparation:       PREPARATION_SCHEMA,
        dosage:            DOSAGE_SCHEMA,
        notes:             { type: ['string', 'null'], description: 'Contraindications, taboos, seasonal notes.' },
        original_text:     { type: ['string', 'null'], description: 'The practitioner\'s description verbatim (or the voice transcript).' },
        original_language: { type: ['string', 'null'], enum: [...LANGUAGE_CODES, null], description: 'ISO 639-1 code of the original description.' },
        confidence_score:  { type: 'number', minimum: 0, maximum: 1, description: '0–1. Below 0.75 flags the record for human review.' },
      },
      required: ['plants', 'confidence_score'],
    },
  },
  {
    name: 'list_formulations',
    description: 'List the practitioner\'s most recent saved formulations, newest first.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', minimum: 1, maximum: 25, description: 'Default 10, max 25.' } },
    },
  },
  {
    name: 'get_formulation',
    description: 'Retrieve one saved formulation in full by its short code, e.g. FM-00042.',
    input_schema: {
      type: 'object',
      properties: { short_code: { type: 'string', pattern: SHORT_CODE } },
      required: ['short_code'],
    },
  },
  {
    name: 'update_formulation',
    description:
      'Change fields on an already-saved formulation, once the practitioner has agreed ' +
      'to the change. Tell them what the record says now and what it would say instead, ' +
      'and wait for their answer before calling this — an edit is filed as their own ' +
      'correction, so an unagreed one misrepresents them. Supply only the fields being ' +
      'changed. Arrays and objects replace the stored value wholesale, so pass the ' +
      'complete new plants list, not just the added plant. Returns the values it ' +
      'replaced, so you can say what changed.',
    input_schema: {
      type: 'object',
      properties: {
        short_code:      { type: 'string', pattern: SHORT_CODE },
        condition_local: { type: 'string' },
        condition_std:   { type: 'string' },
        plants:          { type: 'array', minItems: 1, maxItems: 100, items: PLANT_SCHEMA },
        preparation:     PREPARATION_SCHEMA,
        dosage:          DOSAGE_SCHEMA,
        notes:           { type: 'string' },
      },
      required: ['short_code'],
    },
  },
  {
    name: 'save_specimen',
    description:
      'Record a plant the practitioner has just photographed, under the name they call it. ' +
      'Call this when they have sent a photo of a plant, a leaf, a bark, a root or dried ' +
      'material AND have told you what it is. ' +
      'Use their exact words for local_name — their spelling, their language, no tidying, ' +
      'no translation. Never supply a name they did not say, and never pass a botanical ' +
      'name: you cannot identify a plant from a photograph and this tool will not accept ' +
      'one. Sanko looks the botanical name up itself and tells you what it found. ' +
      'If they have not said what the plant is, ask — do not call this tool yet.',
    input_schema: {
      type: 'object',
      properties: {
        local_name:  { type: 'string', minLength: 1, maxLength: 200, description: 'What they called the plant, verbatim.' },
        language:    { type: ['string', 'null'], enum: [...LANGUAGE_CODES, null], description: 'ISO 639-1 code of the name they used.' },
        part_used:   { type: ['string', 'null'], description: 'What is in the photo: leaves | bark | root | seeds | fruit | whole plant | dried material …' },
        familiarity: { type: ['string', 'null'], enum: ['frequently', 'occasionally', 'never', null], description: 'How often they say they work with this plant. Only if they said; never inferred.' },
        notes:       { type: ['string', 'null'], maxLength: 2000, description: 'Anything else they said about this specimen — where it grows, when it is gathered, what it is for.' },
      },
      required: ['local_name'],
    },
  },
  {
    name: 'lookup_plant',
    description:
      'Ask Sanko what botanical name its plant index holds for a local name. ' +
      'Use it when the practitioner names a plant and you want to tell them what Sanko has ' +
      'on record, or to check before answering a question about a name. ' +
      'You do not need to call this before save_formulation or save_specimen — both resolve ' +
      'the botanical name themselves from the same index. ' +
      'If it returns found: false, the name is simply not in the index. Say so plainly and ' +
      'do not supply a botanical name from your own knowledge: an unplaceable local name is ' +
      'useful signal for the research team, and a guessed binomial is a false claim about ' +
      'their medicine.',
    input_schema: {
      type: 'object',
      properties: {
        local_name: { type: 'string', minLength: 1, maxLength: 200, description: 'The plant name as the practitioner said it.' },
      },
      required: ['local_name'],
    },
  },
  {
    name: 'list_specimens',
    description: 'List the plants this practitioner has photographed and named, newest first.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', minimum: 1, maximum: 25, description: 'Default 10, max 25.' } },
    },
  },
  {
    name: 'create_patient',
    description:
      'Invite a patient to consent to tracking. The practitioner supplies the patient name ' +
      'and phone number; the patient remains pending and cannot have treatments recorded ' +
      'until they accept Sanko\'s WhatsApp consent request. Call find_patient first.',
    input_schema: {
      type: 'object',
      properties: {
        display_name: { type: 'string', minLength: 1, maxLength: 100, description: 'The patient name supplied by the practitioner.' },
        phone_number: { type: 'string', minLength: 8, maxLength: 24, description: 'Patient WhatsApp number. Nigerian local 0... or E.164 +... format.' },
        age_years:    { type: ['number', 'null'], integer: true, minimum: 0, maximum: 130 },
        sex:          { type: ['string', 'null'], enum: ['male', 'female', 'other', null] },
      },
      required: ['display_name', 'phone_number'],
    },
  },
  {
    name: 'find_patient',
    description:
      'Look up patients by short code (PT-00007) or by part of a name. Returns every ' +
      'match, so disambiguate with the practitioner if more than one comes back.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'list_patients',
    description: 'List the practitioner\'s patients, newest first. Only when they ask.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', minimum: 1, maximum: 50, description: 'Default 20, max 50.' } },
    },
  },
  {
    name: 'get_patient',
    description: 'Retrieve one patient with their full treatment history, by short code.',
    input_schema: {
      type: 'object',
      properties: { short_code: { type: 'string', pattern: SHORT_CODE } },
      required: ['short_code'],
    },
  },
  {
    name: 'log_treatment',
    description:
      'Record that a formulation was given to a patient. The outcome starts as ' +
      '"ongoing"; use update_treatment when the practitioner reports back. Set ' +
      'follow_up_on if they say when they will check in.',
    input_schema: {
      type: 'object',
      properties: {
        patient_short_code:     { type: 'string', description: 'e.g. PT-00007' },
        formulation_short_code: { type: ['string', 'null'], description: 'e.g. FM-00042. Null if not documented yet.' },
        condition_reported:     { type: ['string', 'null'], description: 'What the patient presented with.' },
        started_on:             { type: ['string', 'null'], format: 'date', description: 'YYYY-MM-DD. Defaults to today.' },
        follow_up_on:           { type: ['string', 'null'], format: 'date', description: 'YYYY-MM-DD.' },
        outcome_notes:          { type: ['string', 'null'] },
      },
      required: ['patient_short_code'],
    },
  },
  {
    name: 'update_treatment',
    description: 'Update how a treatment is going — its outcome, notes, or follow-up date.',
    input_schema: {
      type: 'object',
      properties: {
        short_code:             { type: 'string', description: 'e.g. TX-00012' },
        outcome:                { type: 'string', enum: ['ongoing', 'improved', 'resolved', 'no_change', 'worse', 'unknown'] },
        outcome_notes:          { type: 'string' },
        follow_up_on:           { type: ['string', 'null'], format: 'date', description: 'YYYY-MM-DD, or null to clear.' },
        formulation_short_code: { type: 'string', description: 'Attach a formulation documented after the fact.' },
      },
      required: ['short_code'],
    },
  },
  {
    name: 'list_due_follow_ups',
    description:
      'List ongoing treatments whose follow-up date has arrived or passed. Use this ' +
      'when the practitioner asks who they should check on.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'export_account',
    description: 'Export all data held for the calling practitioner. Only call when they explicitly ask for their data export.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_account',
    description:
      `Permanently delete the calling practitioner's account, archived media, and associated records. ` +
      `Only call when their current message is exactly "${DELETE_CONFIRMATION}".`,
    input_schema: {
      type: 'object',
      properties: { confirmation: { type: 'string', enum: [DELETE_CONFIRMATION] } },
      required: ['confirmation'],
    },
  },
];

// ─── executors ────────────────────────────────────────────────────────────────

const EXECUTORS = {
  async set_profile(input, { practitioner }) {
    // Read this before the update: the row we are handed may be the same object
    // the update writes through, in which case checking afterwards always sees
    // a name and onboarding is never recorded.
    const wasAnonymous = !practitioner.display_name;

    const fields = { display_name: input.display_name };
    if (input.preferred_language) fields.preferred_language = input.preferred_language;
    const updated = await db.updatePractitioner(practitioner.id, fields);

    // First time we learn a name is the moment onboarding is complete.
    if (wasAnonymous) {
      await db.logEvent({
        practitioner_id: practitioner.id,
        event_type: 'practitioner_onboarded',
        payload: { display_name: updated.display_name, preferred_language: updated.preferred_language },
      });
    }
    // Keep the in-flight context current so the rest of this turn sees the name.
    practitioner.display_name = updated.display_name;
    practitioner.preferred_language = updated.preferred_language;
    await _completeRegistrationIfReady(practitioner);

    return {
      ok: true,
      display_name: updated.display_name,
      preferred_language: updated.preferred_language,
      registered: Boolean(practitioner.registered_at),
    };
  },

  async set_practice_details(input, { practitioner }) {
    const fields = { region: input.region };
    if (input.years_practising != null) fields.years_practising = Math.trunc(input.years_practising);
    if (input.tradition) fields.tradition = input.tradition;

    const updated = await db.updatePractitioner(practitioner.id, fields);
    Object.assign(practitioner, {
      region: updated.region,
      years_practising: updated.years_practising,
      tradition: updated.tradition,
    });
    await _completeRegistrationIfReady(practitioner);

    return {
      ok: true,
      region: practitioner.region,
      years_practising: practitioner.years_practising ?? null,
      tradition: practitioner.tradition ?? null,
      registered: Boolean(practitioner.registered_at),
    };
  },

  async accept_contributor_terms(input, { practitioner }) {
    const terms = governance.currentTerms();
    if (!terms.in_force) {
      // Reachable only if the model calls a tool it was not offered. The answer
      // is the same as governance.assertInForce()'s, phrased for the model.
      return {
        ok: false,
        error: 'The contributor terms are not in force in this deployment. Do not raise them with the practitioner at all.',
      };
    }

    if (input.accepted) {
      const recorded = await governance.recordAcceptance({ practitioner_id: practitioner.id, method: 'whatsapp_reply' });
      Object.assign(practitioner, {
        contributor_terms_version: recorded.version,
        contributor_terms_hash: recorded.hash,
        contributor_terms_accepted_at: new Date().toISOString(),
        contributor_terms_method: 'whatsapp_reply',
      });
      return { ok: true, accepted: true, version: recorded.version };
    }

    const declined_at = new Date().toISOString();
    await db.updatePractitioner(practitioner.id, { contributor_terms_declined_at: declined_at });
    practitioner.contributor_terms_declined_at = declined_at;
    await db.logEvent({
      practitioner_id: practitioner.id,
      event_type: 'contributor_terms_declined',
      payload: { version: terms.version, hash: terms.hash },
    });
    // Said plainly for the model's benefit: a declined answer is a complete
    // outcome, not a problem to work on.
    return { ok: true, accepted: false, note: 'Recorded. Nothing changes for them and it will not be raised again.' };
  },

  async save_formulation(input, { practitioner, sourceMediaId = null }) {
    // Botanical names are resolved here, from the index, or not at all — the
    // same rule save_specimen has always had. Before this the model supplied
    // them from a copy of the index pasted into its prompt, which asked it to
    // recall 442 mappings from context and write the answer into a permanent
    // record. A name it half-remembered was indistinguishable, in the stored
    // row, from one it read correctly.
    const plants = input.plants.map(resolveBotanical);
    const pendingIsFresh = practitioner.pending_source_media_id &&
      practitioner.pending_source_media_at &&
      Date.now() - new Date(practitioner.pending_source_media_at).getTime() <= 24 * 60 * 60 * 1000;
    const trustedSourceMediaId = sourceMediaId ?? (pendingIsFresh ? practitioner.pending_source_media_id : null);

    // saveFormulation expects the nested PRD §4.3 shape; the tool takes a flatter
    // one because nested-object tool inputs are noticeably error-prone for models.
    const structured = {
      condition: {
        local_name:  input.condition_local ?? null,
        standardised: input.condition_std ?? null,
        icd_11_code: input.icd_11_code ?? null,
      },
      plants,
      preparation: input.preparation ?? null,
      dosage: input.dosage ?? null,
      notes: input.notes ?? null,
      metadata: { confidence_score: input.confidence_score ?? null },
    };

    const saved = await db.saveFormulation({
      practitioner_id: practitioner.id,
      // Provenance comes from the trusted inbound-media runtime, never from a
      // model-supplied UUID. The pending value survives clarification/consent
      // turns, which commonly separate a voice note from the actual save call.
      source_media_id: trustedSourceMediaId,
      structured,
      original_text: input.original_text ?? null,
      original_language: input.original_language ?? practitioner.preferred_language ?? null,
      // Which model, backend and prompt produced this record (010). Stamped
      // here rather than inferred later: the configured model changes, and a
      // record read back next month must still say what wrote it.
      model: llm.modelName(),
      provider: llm.providerName(),
      prompt_version: promptVersion(),
      // The third input to the extraction, alongside the model and the prompt:
      // the plant index interpolated into that prompt (012).
      plant_data_version: plantLookup.dataVersion(),
    });

    if (trustedSourceMediaId) {
      // Migration 007 clears the durable pending pointer in the same database
      // transaction as the insert. Keep this in-flight object consistent too.
      practitioner.pending_source_media_id = null;
      practitioner.pending_source_media_at = null;
    }

    await db.logEvent({
      practitioner_id: practitioner.id,
      event_type: 'formulation_saved',
      payload: { short_code: saved.short_code, confidence: input.confidence_score ?? null, plant_count: plants.length },
    });

    // Plants the model could not place botanically are the research team's queue.
    const unknown = plants.filter(p => !p.botanical).map(p => p.local_name);
    if (unknown.length) {
      await db.logEvent({
        practitioner_id: practitioner.id,
        event_type: 'unknown_plant_flagged',
        payload: { short_code: saved.short_code, plants: unknown },
      });
    }

    return {
      ok: true,
      short_code: saved.short_code,
      // What the index actually resolved, so the model can tell the practitioner
      // accurately rather than repeating what it thought it sent. This is also
      // the record the eval harness scores botanicals against.
      plants: plants.map(p => ({
        local_name: p.local_name,
        botanical: p.botanical,
        common_english: p.common_english,
        botanical_source: p.botanical_source,
      })),
      unknown_plants: unknown,
      card: formatCard(structured),
    };
  },

  async list_formulations(input, { practitioner }) {
    const limit = _clamp(input.limit, 10, 1, 25);
    const rows = await db.listFormulations(practitioner.id, limit);
    await db.writeAuditEvent({ subject_id: practitioner.id, actor_id: practitioner.id, action: 'read', resource_type: 'formulations', metadata: { count: rows.length } });
    return {
      count: rows.length,
      formulations: rows.map(r => ({
        short_code: r.short_code,
        condition: r.condition_std || r.condition_local || 'unspecified',
        saved_on: _day(r.created_at),
      })),
    };
  },

  async get_formulation(input, { practitioner }) {
    const row = await db.getFormulationByShortCode(input.short_code, practitioner.id);
    if (!row) return { ok: false, error: `No formulation ${input.short_code} in this Vault.` };
    await db.writeAuditEvent({ subject_id: practitioner.id, actor_id: practitioner.id, action: 'read', resource_type: 'formulation', resource_id: row.id });
    return {
      ok: true,
      short_code: row.short_code,
      condition_local: row.condition_local,
      condition_std: row.condition_std,
      plants: row.plants,
      preparation: row.preparation,
      dosage: row.dosage,
      notes: row.notes,
      confidence_score: row.confidence_score,
      saved_on: _day(row.created_at),
    };
  },

  async update_formulation(input, { practitioner, readRecords }) {
    const row = await db.getFormulationByShortCode(input.short_code, practitioner.id);
    if (!row) return { ok: false, error: `No formulation ${input.short_code} in this Vault.` };

    // Read-before-write, enforced rather than requested.
    //
    // The prompt asks the agent to show the practitioner what is about to be
    // overwritten, and on a local model that instruction does not hold: it fills
    // the current value in from what the practitioner just said instead of from
    // the record, so they approve a change against a value nobody checked. A
    // yes to a question the agent invented is not consent to an overwrite.
    //
    // Evidence is a get_formulation earlier in this conversation — see
    // recordsRead() in ./index.js. Missing evidence is treated as none, so a
    // caller that does not supply it gets the refusal rather than a silent
    // bypass; the gate is only useful if it cannot be forgotten.
    const readCodes = readRecords ?? new Set();
    if (!readCodes.has(String(input.short_code).toUpperCase())) {
      // Written as the next action to take rather than as an explanation of a
      // failure. Measured 2026-09-10 on qwen2.5:32b: this wording did NOT change
      // what the model does — it still answers the practitioner first and reads
      // the record only on the following turn, so they are asked the same
      // question twice. Kept because it states the intended sequence for a model
      // that can follow it; do not assume it buys anything on the local one.
      return {
        ok: false,
        error:
          `You have not read ${input.short_code}, so you do not know what this would overwrite. ` +
          'Do not reply to the practitioner yet. Call get_formulation for ' +
          `${input.short_code} now, in this same turn. Then tell them in one message what the ` +
          'record says now and what you would put in its place, ask whether to change it, and ' +
          'call this tool again once they have agreed.',
      };
    }

    const FIELDS = ['condition_local', 'condition_std', 'plants', 'preparation', 'dosage', 'notes'];
    // An edited plants list is resolved the same way a new one is. Writing
    // input.plants through unchanged would strip the botanical names off a
    // record every time a practitioner corrected a quantity, because the model
    // no longer supplies them.
    if (input.plants !== undefined) input.plants = input.plants.map(resolveBotanical);
    const changed = [];
    // What each field held before this call. Handed back to the agent so it can
    // tell the practitioner what it wrote over in the words of the old record —
    // and so an edit made without asking is at least visible in the next
    // message, where they can catch it, rather than silent.
    const replaced = {};
    for (const field of FIELDS) {
      if (input[field] === undefined) continue;

      // Record the before/after before overwriting. A practitioner correcting
      // what the model wrote down is the highest-quality training signal this
      // system produces — it is a human expert labelling a specific mistake.
      await db.recordCorrection({
        practitioner_id: practitioner.id,
        formulation_id: row.id,
        field,
        before: row[field] ?? null,
        after: input[field],
        source: 'practitioner_edit',
      });

      // Cloned, and read before the write: `row` is the stored object itself on
      // some db layers, so both the timing and the copy matter — without them
      // this reports the value that was just written instead of the one it
      // replaced.
      replaced[field] = structuredClone(row[field] ?? null);

      await db.updateFormulationField(row.id, field, input[field]);
      changed.push(field);
    }
    if (!changed.length) {
      return { ok: false, error: 'No fields supplied to change.' };
    }

    await db.logEvent({
      practitioner_id: practitioner.id,
      event_type: 'formulation_edited',
      payload: { short_code: row.short_code, fields: changed },
    });
    return { ok: true, short_code: row.short_code, updated_fields: changed, replaced };
  },

  async create_patient(input, { practitioner, sendPatientConsent }) {
    if (typeof sendPatientConsent !== 'function') {
      return { ok: false, error: 'Patient consent invitations are unavailable on this channel.' };
    }
    const phoneNumber = _normalisePatientPhone(input.phone_number);
    if (!phoneNumber) {
      return { ok: false, error: 'The patient phone number is invalid. Ask for a WhatsApp number with country code, or a Nigerian 0-prefixed number.' };
    }
    if (phoneNumber === practitioner.phone_number) {
      return { ok: false, error: 'The patient WhatsApp number cannot be the practitioner’s own number.' };
    }
    const existing = await db.findPatientByPhone(phoneNumber, practitioner.id);
    if (existing) {
      return {
        ok: false,
        error: existing.status === 'pending_consent'
          ? `${existing.display_name} already has a consent invitation pending.`
          : `${existing.display_name} is already in this patient list.`,
        short_code: existing.short_code,
        consent_status: existing.consent_status,
      };
    }
    const patient = await db.createPatient({
      practitioner_id: practitioner.id,
      display_name: input.display_name,
      age_years: input.age_years ?? null,
      sex: input.sex ?? null,
      phone_number: phoneNumber,
      notes: null,
      status: 'pending_consent',
      consent_status: 'pending',
      consent_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    let delivered = false;
    try {
      delivered = await sendPatientConsent({
        patient_id: patient.id,
        patient_name: patient.display_name,
        patient_phone: patient.phone_number,
        practitioner_name: practitioner.display_name ?? 'your practitioner',
      });
    } catch (error) {
      log.warn('patient.consent_invitation_failed', { error: error.message });
    }
    if (!delivered) {
      await db.deletePendingPatient(patient.id, practitioner.id);
      return { ok: false, error: 'The consent request could not be delivered, so no patient record was retained. Check the WhatsApp number and try again.' };
    }
    await db.markPatientConsentInvited(patient.id, practitioner.id)
      .catch(error => log.warn('patient.consent_timestamp_failed', { error: error.message }));
    await db.logEvent({
      practitioner_id: practitioner.id,
      event_type: 'patient_consent_invited',
      payload: { short_code: patient.short_code },
    });
    return {
      ok: true,
      short_code: patient.short_code,
      display_name: patient.display_name,
      consent_status: 'pending',
      tracking_started: false,
      message: 'Consent request sent. Do not record treatment until the patient accepts.',
    };
  },

  async find_patient(input, { practitioner }) {
    const query = String(input.query ?? '').trim();
    if (!query) return { count: 0, patients: [] };

    // A short code is an exact identifier; anything else is a name fragment.
    if (/^pt-?\d+$/i.test(query)) {
      const code = query.toUpperCase().replace(/^PT-?/, 'PT-');
      const patient = await db.getPatientByShortCode(code, practitioner.id);
      await db.writeAuditEvent({ subject_id: practitioner.id, actor_id: practitioner.id, action: 'read', resource_type: 'patients', metadata: { lookup: 'short_code', found: Boolean(patient) } });
      return patient
        ? { count: 1, patients: [_patientSummary(patient)] }
        : { count: 0, patients: [], error: `No patient ${code} in this Vault.` };
    }

    const rows = await db.findPatientsByName(query, practitioner.id);
    await db.writeAuditEvent({ subject_id: practitioner.id, actor_id: practitioner.id, action: 'read', resource_type: 'patients', metadata: { lookup: 'pseudonym', count: rows.length } });
    return { count: rows.length, patients: rows.map(_patientSummary) };
  },

  async list_patients(input, { practitioner }) {
    const limit = _clamp(input.limit, 20, 1, 50);
    const rows = await db.listPatients(practitioner.id, limit);
    await db.writeAuditEvent({ subject_id: practitioner.id, actor_id: practitioner.id, action: 'read', resource_type: 'patients', metadata: { count: rows.length } });
    return { count: rows.length, patients: rows.map(_patientSummary) };
  },

  async get_patient(input, { practitioner }) {
    const patient = await db.getPatientByShortCode(input.short_code, practitioner.id);
    if (!patient) return { ok: false, error: `No patient ${input.short_code} in this Vault.` };

    const treatments = await db.listTreatmentsForPatient(patient.id, practitioner.id);
    await db.writeAuditEvent({ subject_id: practitioner.id, actor_id: practitioner.id, action: 'read', resource_type: 'patient', resource_id: patient.id });
    return {
      ok: true,
      ..._patientSummary(patient),
      treatments: treatments.map(_treatmentSummary),
    };
  },

  async log_treatment(input, { practitioner }) {
    const patient = await db.getPatientByShortCode(input.patient_short_code, practitioner.id);
    if (!patient) return { ok: false, error: `No patient ${input.patient_short_code} in this Vault.` };
    if (patient.status !== 'active' || patient.consent_status !== 'granted') {
      return { ok: false, error: `${patient.display_name} has not accepted patient tracking yet. No treatment can be recorded.` };
    }

    let formulation_id = null;
    if (input.formulation_short_code) {
      const formulation = await db.getFormulationByShortCode(input.formulation_short_code, practitioner.id);
      if (!formulation) {
        return { ok: false, error: `No formulation ${input.formulation_short_code} in this Vault. Document it first, or log the treatment without one.` };
      }
      formulation_id = formulation.id;
    }

    const treatment = await db.createTreatment({
      practitioner_id: practitioner.id,
      patient_id: patient.id,
      formulation_id,
      condition_reported: input.condition_reported ?? null,
      started_on: input.started_on ?? null,
      follow_up_on: input.follow_up_on ?? null,
      outcome_notes: input.outcome_notes ?? null,
    });

    await db.logEvent({
      practitioner_id: practitioner.id,
      event_type: 'treatment_logged',
      payload: { short_code: treatment.short_code, patient: patient.short_code, formulation: input.formulation_short_code ?? null },
    });

    return {
      ok: true,
      short_code: treatment.short_code,
      patient: patient.display_name,
      started_on: treatment.started_on,
      follow_up_on: treatment.follow_up_on,
    };
  },

  async update_treatment(input, { practitioner }) {
    const treatment = await db.getTreatmentByShortCode(input.short_code, practitioner.id);
    if (!treatment) return { ok: false, error: `No treatment ${input.short_code} in this Vault.` };

    const fields = {};
    if (input.outcome !== undefined)       fields.outcome = input.outcome;
    if (input.outcome_notes !== undefined) fields.outcome_notes = input.outcome_notes;
    if (input.follow_up_on !== undefined)  fields.follow_up_on = input.follow_up_on;

    if (input.formulation_short_code) {
      const formulation = await db.getFormulationByShortCode(input.formulation_short_code, practitioner.id);
      if (!formulation) return { ok: false, error: `No formulation ${input.formulation_short_code} in this Vault.` };
      fields.formulation_id = formulation.id;
    }

    if (Object.keys(fields).length === 0) return { ok: false, error: 'No fields supplied to change.' };

    const updated = await db.updateTreatment(treatment.id, fields);
    await db.logEvent({
      practitioner_id: practitioner.id,
      event_type: 'treatment_updated',
      payload: { short_code: treatment.short_code, fields: Object.keys(fields) },
    });
    return { ok: true, short_code: updated.short_code, outcome: updated.outcome, follow_up_on: updated.follow_up_on };
  },

  async list_due_follow_ups(_input, { practitioner }) {
    const rows = await db.listDueFollowUps(practitioner.id);
    await db.writeAuditEvent({ subject_id: practitioner.id, actor_id: practitioner.id, action: 'read', resource_type: 'follow_ups', metadata: { count: rows.length } });
    return {
      count: rows.length,
      follow_ups: rows.map(r => ({
        treatment: r.short_code,
        patient: r.patients?.display_name ?? null,
        patient_code: r.patients?.short_code ?? null,
        condition: r.condition_reported,
        due_on: r.follow_up_on,
      })),
    };
  },

  async export_account(_input, { practitioner }) {
    const exported = await db.createAccountExport(practitioner.id);
    await db.writeAuditEvent({ subject_id: practitioner.id, actor_id: practitioner.id, action: 'export', resource_type: 'account' });
    return { ok: true, exported_at: new Date().toISOString(), ...exported };
  },

  async delete_account(input, { practitioner, currentUserText = '' }) {
    if (input.confirmation !== DELETE_CONFIRMATION || currentUserText.trim().toUpperCase() !== DELETE_CONFIRMATION) {
      return {
        ok: false,
        error: `Deletion was not authorised. Ask the practitioner to send exactly: ${DELETE_CONFIRMATION}`,
      };
    }
    await db.deleteAccount(practitioner.id);
    return { ok: true, account_deleted: true };
  },

  // Recording a photographed plant under the name its practitioner gave it.
  //
  // Two things are enforced here that the prompt above asks for and cannot
  // guarantee. Both exist because sequencing and abstention are precisely the
  // rules that do not hold on this stack's local model (measured; see the note
  // in registration.js about where rules have to live).
  //
  //   1. The name has to have been said. `local_name` must appear in the
  //      practitioner's own message this turn. Without this the model is free to
  //      look at a green leaf and offer "bitter leaf" as though it had been told,
  //      and the archive fills with the model's guesses wearing a practitioner's
  //      attribution — which is the one corruption this dataset could not be
  //      cleaned of afterwards, because nothing would mark which rows were which.
  //
  //   2. The binomial is not an input. There is no botanical field on the
  //      schema; it is resolved here, from the same index the prompt already
  //      carries, and it stays null when that index cannot place the name. A
  //      null binomial is a question for a reviewer. A guessed one is a lie with
  //      a species name on it.
  async save_specimen(input, { practitioner, sourceMediaId = null, currentUserText = '' }) {
    const pendingIsFresh = practitioner.pending_source_media_id &&
      practitioner.pending_source_media_at &&
      Date.now() - new Date(practitioner.pending_source_media_at).getTime() <= 24 * 60 * 60 * 1000;
    const mediaId = sourceMediaId ?? (pendingIsFresh ? practitioner.pending_source_media_id : null);
    if (!mediaId) {
      return {
        ok: false,
        error:
          'There is no recent photo to attach this to. A specimen is a photograph plus a name — ' +
          'ask them to send the picture of the plant, and record it once it arrives.',
      };
    }

    if (!_saidByPractitioner(input.local_name, currentUserText)) {
      return {
        ok: false,
        error:
          `You have not been told this plant is called "${input.local_name}". Ask them what they ` +
          'call it and use their answer word for word. Do not offer them a name to agree to — ' +
          'naming the plant for them is how a guess becomes their record.',
      };
    }

    const local_name = input.local_name.trim();
    const normalised = plantLookup.normalizeLocalName(local_name);
    // Resolved in code, from the index, or not at all.
    const entry = plantLookup.lookup(local_name);
    const botanical = entry?.botanical ?? null;

    const specimen = await db.saveSpecimen({
      practitioner_id: practitioner.id,
      media_id: mediaId,
      local_name,
      local_name_normalised: normalised,
      language: input.language ?? practitioner.preferred_language ?? null,
      part_used: input.part_used ?? null,
      familiarity: input.familiarity ?? null,
      notes: input.notes ?? null,
      botanical,
      botanical_source: botanical ? 'plant_index' : null,
      plant_data_version: botanical ? plantLookup.dataVersion() : null,
      // Their stated region, never the photograph's coordinates.
      region: practitioner.region ?? null,
    });

    // Not raised again for a name already on this photo: the queue counts
    // occurrences to decide what a reviewer should look at first, and a model
    // repeating itself is not a second practitioner saying the same thing.
    if (!botanical && specimen.duplicate !== true) {
      // The same event the formulation path raises for a name it could not
      // place, so an unplaceable specimen reaches the review queue by the route
      // that already exists rather than a second one nobody is watching.
      await db.logEvent({
        practitioner_id: practitioner.id,
        event_type: 'unknown_plant_flagged',
        payload: { short_code: specimen.short_code, plants: [local_name], source: 'specimen' },
      }).catch(() => {});
    }

    log.info('specimen.saved', {
      practitioner_id: practitioner.id,
      short_code: specimen.short_code,
      resolved: Boolean(botanical),
      ambiguous: Boolean(entry && !entry.botanical),
    });

    // What the model is told about the result decides what the practitioner
    // hears, so the three outcomes are named rather than collapsed into a
    // botanical field that is sometimes null.
    return {
      ok: true,
      short_code: specimen.short_code,
      local_name: specimen.local_name,
      part_used: specimen.part_used ?? null,
      botanical,
      common_english: entry?.common_english ?? null,
      already_recorded: specimen.duplicate === true,
      identification: botanical
        ? 'matched'
        : entry
          ? 'ambiguous'
          : 'unknown',
      note: botanical
        ? `Recorded. Sanko's index maps "${local_name}" to ${botanical}. That mapping comes from published sources, not from the photo — say it as what the name usually means, not as what this plant is.`
        : entry
          ? `Recorded. "${local_name}" is a name used for more than one plant, so Sanko cannot say which this is and neither can you. Thank them; do not pick a species.`
          : `Recorded, and this is the valuable kind: "${local_name}" is not in Sanko's index at all. Thank them and say it has been kept for a reviewer to place. Do not guess at a botanical name.`,
    };
  },

  // The index, as a tool rather than as 4,330 tokens of prompt.
  //
  // It used to be pasted into the system prompt on every call, which asked the
  // model to hold 442 mappings in context and recall the right one. Reading the
  // answer from a tool result is a different and much easier task than recalling
  // it, and the record no longer depends on getting it right either way —
  // save_formulation and save_specimen resolve from the same index in code.
  async lookup_plant(input) {
    const entry = plantLookup.lookup(input.local_name);
    if (!entry) {
      return {
        ok: true,
        found: false,
        local_name: input.local_name,
        note:
          `"${input.local_name}" is not in Sanko's plant index. Tell them it has been recorded ` +
          'under their name and not yet matched to a botanical one. Do not supply a botanical ' +
          'name yourself.',
      };
    }
    // An entry with no botanical is a name the index holds but could not place
    // to one species — usually because it is used for several. That is a
    // different answer from "not found", and the practitioner deserves the
    // difference.
    if (!entry.botanical) {
      return {
        ok: true,
        found: true,
        ambiguous: true,
        local_name: input.local_name,
        botanical: null,
        note: `Sanko's index holds "${input.local_name}" but maps it to more than one plant, so it has no single botanical name. Say that rather than choosing one.`,
      };
    }
    return {
      ok: true,
      found: true,
      ambiguous: false,
      local_name: input.local_name,
      botanical: entry.botanical,
      common_english: entry.common_english ?? null,
      note: `Sanko's index maps "${input.local_name}" to ${entry.botanical}. That comes from published sources — say it as what the name usually means, not as a certainty about their plant.`,
    };
  },

  async list_specimens(input, { practitioner }) {
    const limit = _clamp(input.limit, 10, 1, 25);
    const rows = await db.listSpecimens(practitioner.id, limit);
    return {
      ok: true,
      count: rows.length,
      specimens: rows.map(row => ({
        short_code: row.short_code,
        local_name: row.local_name,
        botanical: row.botanical ?? null,
        part_used: row.part_used ?? null,
        status: row.status,
        recorded_on: _day(row.created_at),
      })),
    };
  },
};

// ─── tool selection ───────────────────────────────────────────────────────────

// Tool-calling accuracy on small local models degrades as the tool list grows —
// a 7B model handed eleven schemas picks the wrong one far more often than one
// handed five. AGENT_TOOLS=vault trims the agent to documentation only, which is
// the profile to run while a smaller model is being evaluated or fine-tuned.
const VAULT_ONLY = new Set([
  'set_profile', 'set_practice_details', 'save_formulation', 'list_formulations', 'get_formulation',
  'update_formulation', 'save_specimen', 'list_specimens', 'lookup_plant', 'export_account', 'delete_account',
]);

// Offered only where the terms are in force. A tool the model cannot see is a
// question it cannot ask, which is the behaviour an unreviewed draft needs.
const TERMS_TOOLS = new Set(['accept_contributor_terms']);
const PATIENT_TOOLS = new Set([
  'create_patient', 'find_patient', 'list_patients', 'get_patient',
  'log_treatment', 'update_treatment', 'list_due_follow_ups',
]);

function selectTools(profile = process.env.AGENT_TOOLS ?? 'vault') {
  const requested = String(profile).toLowerCase();
  const patientsEnabled = process.env.PATIENT_TRACKING_ENABLED === 'true';
  const termsInForce = governance.currentTerms().in_force;
  const available = TOOLS.filter(t => !TERMS_TOOLS.has(t.name) || termsInForce);
  if ((requested === 'full' || requested === 'patient') && patientsEnabled) return available;
  return available.filter(t => VAULT_ONLY.has(t.name) || TERMS_TOOLS.has(t.name));
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// One plant as the model sent it, plus whatever the index says about it.
//
// The model contributes the local name and the quantities — what it was told.
// Everything botanical comes from here, so `botanical_source` is either
// 'plant_index' or nothing at all; there is no path that writes a binomial the
// index did not supply.
function resolveBotanical(plant) {
  const entry = plantLookup.lookup(plant.local_name);
  const botanical = entry?.botanical ?? null;
  return {
    ...plant,
    botanical,
    common_english: entry?.common_english ?? null,
    botanical_source: botanical ? 'plant_index' : null,
  };
}

// Registration completes the moment the last required answer lands, whichever
// tool brought it in. Stamping it here rather than in either executor means the
// two cannot disagree about what counts as registered, and re-stamping is
// impossible: registered_at is written once and then guards itself.
async function _completeRegistrationIfReady(practitioner) {
  if (practitioner.registered_at) return false;
  if (!registration.state(practitioner).complete) return false;

  const registered_at = new Date().toISOString();
  await db.updatePractitioner(practitioner.id, { registered_at });
  practitioner.registered_at = registered_at;
  await db.logEvent({
    practitioner_id: practitioner.id,
    event_type: 'practitioner_registered',
    payload: {
      region: practitioner.region,
      years_practising: practitioner.years_practising ?? null,
      tradition: practitioner.tradition ?? null,
      preferred_language: practitioner.preferred_language ?? null,
    },
  });
  log.info('practitioner.registered', { practitioner_id: practitioner.id });
  return true;
}

function _clamp(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function _normalisePatientPhone(value) {
  const compact = String(value ?? '').trim().replace(/[\s().-]/g, '');
  if (/^0\d{9,10}$/.test(compact)) return `+234${compact.slice(1)}`;
  if (/^234\d{10}$/.test(compact)) return `+${compact}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

function _day(timestamp) {
  return typeof timestamp === 'string' ? timestamp.slice(0, 10) : null;
}

function _patientSummary(p) {
  return {
    short_code: p.short_code,
    display_name: p.display_name,
    age_years: p.age_years ?? null,
    sex: p.sex ?? null,
    consent_status: p.consent_status ?? (p.status === 'active' ? 'granted' : 'pending'),
  };
}

function _treatmentSummary(t) {
  return {
    short_code: t.short_code,
    condition: t.condition_reported,
    formulation: t.formulations?.short_code ?? null,
    started_on: t.started_on,
    outcome: t.outcome,
    outcome_notes: t.outcome_notes,
    follow_up_on: t.follow_up_on,
  };
}

// Did the practitioner actually say this name, in this turn?
//
// Compared under the same normalisation the plant index uses, so an accent the
// model dropped or added does not make a name they plainly said look invented,
// and "Ewe Àbámodá" matches "ewe abamoda". A substring test rather than an exact
// one: the name arrives inside a sentence, or inside a voice transcript.
//
// The text this checks against is everything in the practitioner's turn, which
// for a specimen photo is their caption and their words. A photographed page
// would also put its transcription in scope — but a page has writing on it and
// so is never routed to the specimen flow in the first place.
function _saidByPractitioner(name, text) {
  const said = plantLookup.normalizeLocalName(String(text ?? ''));
  const claimed = plantLookup.normalizeLocalName(String(name ?? ''));
  if (!claimed || !said) return false;
  return said.includes(claimed);
}

// The marker services/vision.js writes where the page was illegible. It is the
// one token in a reading that must never reach a stored record: everything else
// is at worst a misreading a practitioner can correct, while this is an explicit
// blank that would harden into a plant name, a dose or a preparation step.
const UNREAD_MARKER = '[?]';

function _unreadMarkers(input, path = 'input', found = []) {
  if (typeof input === 'string') {
    if (input.includes(UNREAD_MARKER)) found.push(path);
  } else if (Array.isArray(input)) {
    input.forEach((item, index) => _unreadMarkers(item, `${path}[${index}]`, found));
  } else if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) _unreadMarkers(value, `${path}.${key}`, found);
  }
  return found;
}

// Runs one tool call. Tool failures are returned to the model as an error
// payload rather than thrown, so a bad short code becomes something the agent
// can apologise for and retry — not a dead conversation.
async function executeTool(name, input, context = {}) {
  const executor = EXECUTORS[name];
  if (!executor) return { ok: false, error: `Unknown tool '${name}'.` };
  if (PATIENT_TOOLS.has(name) && process.env.PATIENT_TRACKING_ENABLED !== 'true') {
    return { ok: false, error: 'Patient tracking is disabled. This deployment is formulation-only.' };
  }
  // Registration is enforced here and nowhere else. The prompt asks the agent to
  // finish it; this is what makes finishing it non-optional.
  const blocked = context.practitioner ? registration.gate(name, context.practitioner) : null;
  if (blocked) {
    log.info('registration.tool_blocked', { practitioner_id: context.practitioner.id, tool: name });
    return blocked;
  }
  // An illegible word carried out of a page reading and into a record. The
  // prompt asks the agent not to do this; small local models comply
  // inconsistently, and a rule that only holds sometimes is not a rule — so the
  // refusal lives here, where compliance is not optional.
  const unread = _unreadMarkers(input);
  if (unread.length) {
    return {
      ok: false,
      error: `${UNREAD_MARKER} marks a word nobody could read on the page, and it is still in ${unread.join(' and ')}. Ask the practitioner what that word says and use their answer. Never store the marker, and never fill it in yourself.`,
    };
  }

  const definition = TOOLS.find(tool => tool.name === name);
  const errors = validate(definition?.input_schema, input ?? {});
  if (errors.length) {
    if (name === 'save_formulation' && errors.some(error => error.startsWith('input.plants must contain at least'))) {
      return { ok: false, error: 'A formulation needs at least one plant. Ask which plants are used, then try again.' };
    }
    return { ok: false, error: `Invalid ${name} input: ${errors.join('; ')}` };
  }
  try {
    return await executor(input ?? {}, context);
  } catch (err) {
    log.error('agent.tool_failed', { tool: name, error: err.message });
    return { ok: false, error: `The ${name} step failed: ${err.message}` };
  }
}

module.exports = { TOOLS, EXECUTORS, executeTool, selectTools, VAULT_ONLY, PATIENT_TOOLS, DELETE_CONFIRMATION, UNREAD_MARKER, _unreadMarkers, _saidByPractitioner };

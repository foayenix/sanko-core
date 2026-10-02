'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const { execFileSync } = require('node:child_process');
const { sql, rpc, seed, literal } = require('../helpers/carePostgres');
const store = require('../../src/care/store');
const service = require('../../src/care/service');
const { hash } = require('../../src/care/auth');
const { createRouter } = require('../../src/care/routes');
const channel = require('../../src/care/channel');
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

test('R0/R1 acceptance on disposable PostgreSQL and real HTTP', async t => {
  Object.assign(process.env, {
    CARE_PATIENT_ACCESS_ENABLED: 'true',
    CARE_ENCOUNTERS_ENABLED: 'true',
    CARE_SYNTHETIC_ONLY: 'true',
    PORTAL_RATE_LIMIT_KEY: crypto.randomBytes(32).toString('hex'),
    PATIENT_TRACKING_ENABLED: 'true',
    AGENT_TOOLS: 'full',
  });
  store.rpc = rpc;
  const { ids, sessions } = await seed();
  const ctx = (name, subject = null, practice = null) => ({
    ...sessions[name],
    role: name.includes('Practitioner') || name === 'practitioner' ? 'practitioner' : 'patient',
    subject,
    practice,
  });
  async function act(c, action, data = {}, extra = {}) {
    return service.act(c.token, c.csrf, {
      role: c.role,
      subject: c.subject,
      practice: c.practice,
      action,
      data,
      key: uuid(),
      ...extra,
    });
  }
  async function confirmed(c, action, data, extra = {}) {
    const preview = await act(c, 'prepare', { action, data });
    return act(c, action, data, { confirmation: preview.confirmation, ...extra });
  }
  await t.test(
    'WhatsApp entry returns a generic sign-in destination before patient enrolment',
    async () => {
      process.env.CARE_WHATSAPP_HANDOFF_ENABLED = 'true';
      process.env.CARE_ORIGIN = 'https://care.example.invalid';
      const messages = [
        {
          id: uuid(),
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          text: { body: 'My care' },
        },
      ];
      const replies = [];
      const transport = { sendButtonMessage: async (_, body) => replies.push(body) };
      const mode = await channel.resolve('+447700900098', messages, false);
      assert.equal(mode, 'patient');
      await channel.reply(mode, '+447700900098', transport, messages);
      assert.match(replies[0], /https:\/\/care.example.invalid\/care\//);
      assert.equal(await sql('select count(*) from care_subjects'), '0');
      assert.equal(await sql('select count(*) from practitioners'), '2');
      process.env.CARE_ENCOUNTERS_ENABLED = 'false';
      try {
        assert.equal((await act(ctx('practitioner'), 'me')).capabilities.encounters, false);
        await assert.rejects(
          act(ctx('practitioner', null, ids.practice), 'review_queue'),
          /FEATURE_DISABLED/,
        );
      } finally {
        process.env.CARE_ENCOUNTERS_ENABLED = 'true';
      }
    },
  );
  const p = await act(ctx('patient'), 'onboard', { display_name: 'Synthetic Alex' });
  const p2 = await act(ctx('otherPatient'), 'onboard', { display_name: 'Synthetic Alex' });
  const patient = ctx('patient', p.id, ids.practice);
  const practitioner = ctx('practitioner', p.id, ids.practice);
  let encounter, note, signed, follow, observation;

  await t.test(
    'AT03/04/30: same demographics do not merge identities or authorise shared contacts',
    async () => {
      assert.notEqual(p.id, p2.id);
      assert.notEqual(p.reference, p2.reference);
      await sql(
        `insert into care_contacts(actor_id,channel,address,verified_at) ` +
          `values('${ids.patient}','whatsapp','+447700900099',now()),('${ids.otherPatient}','whatsapp','+447700900099',now())`,
      );
      await assert.rejects(act(ctx('otherPatient', p.id), 'timeline'), /NOT_FOUND/);
      assert.equal((await act(ctx('patient'), 'me')).subjects.length, 1);
      const same = await act(ctx('patient'), 'onboard', { display_name: 'Another name' });
      assert.equal(same.id, p.id);
    },
  );
  await t.test('AT01/02/32: SQL routing isolates roles and refuses stale envelopes', async () => {
    const route = (mode, time, existing = false) =>
      rpc('care_channel_route', {
        p_contact: 'synthetic-contact',
        p_mode: mode,
        p_message: uuid(),
        p_time: time,
        p_existing: existing,
      });
    assert.equal(await route(null, '2026-09-30T10:00:00Z'), 'choose');
    assert.equal(await route('patient', '2026-09-30T11:00:00Z', true), 'patient');
    assert.equal(await route(null, '2026-09-30T11:00:00Z', true), 'clarify');
    assert.equal(await route(null, '2026-09-30T11:00:01Z', true), 'patient');
    assert.equal(await route('practitioner', '2026-09-30T10:59:00Z', true), 'clarify');
  });
  await t.test('AT05/06: invitation recipient binding, expiry and decline', async () => {
    await act(ctx('practitioner', null, ids.practice), 'invite', { reference: p.reference });
    const [invite] = await act(patient, 'invitations');
    await assert.rejects(
      confirmed(ctx('otherPatient', p2.id, ids.practice), 'accept_invite', { id: invite.id }),
      /NOT_FOUND/,
    );
    await confirmed(patient, 'accept_invite', { id: invite.id });
    await assert.rejects(confirmed(patient, 'accept_invite', { id: invite.id }), /NOT_FOUND/);
    await act(ctx('otherPractitioner', null, ids.otherPractice), 'invite', {
      reference: p2.reference,
    });
    const other = ctx('otherPatient', p2.id, ids.otherPractice);
    const [decline] = await act(other, 'invitations');
    await confirmed(other, 'decline_invite', { id: decline.id });
    assert.equal(await sql(`select count(*) from care_invites where id='${decline.id}'`), '0');
    await act(ctx('otherPractitioner', null, ids.otherPractice), 'invite', {
      reference: p2.reference,
    });
    const [expire] = await act(other, 'invitations');
    await sql(
      `update care_invites set expires_at=now()-interval '1 second' where id='${expire.id}'`,
    );
    await assert.rejects(confirmed(other, 'accept_invite', { id: expire.id }), /NOT_FOUND/);
    assert.deepEqual(await act(other, 'invitations'), []);
    assert.equal(
      await sql(`select count(*) from care_relationships where subject_id='${p2.id}'`),
      '0',
    );
  });
  await t.test('AT07/09/10: walk-in, concurrent duplicate check-in and replay', async () => {
    const data = { visit_key: uuid(), occurred_at: now() };
    const previews = await Promise.all([
      act(practitioner, 'prepare', { action: 'arrive', data }),
      act(practitioner, 'prepare', { action: 'arrive', data }),
    ]);
    const key = uuid();
    const [a, b] = await Promise.all(
      previews.map(preview =>
        act(practitioner, 'arrive', data, { confirmation: preview.confirmation, key }),
      ),
    );
    assert.equal(a.id, b.id);
    encounter = a;
    assert.equal(
      (await act(practitioner, 'arrive', data, { key })).id,
      a.id,
      'replay works after consumed confirmation',
    );
    await assert.rejects(
      act(practitioner, 'arrive', { ...data, visit_key: uuid() }, { key }),
      /IDEMPOTENCY_CONFLICT/,
    );
    assert.equal(await sql(`select count(*) from care_encounters where subject_id='${p.id}'`), '1');
  });
  let formula;
  await t.test(
    'AT12/15: supported source only, exact revisions and stale confirmations',
    async () => {
      formula = JSON.parse(
        await sql(`insert into formulations(practitioner_id,condition_local,plants,preparation,confidence_score,original_text)
      values('${ids.legacy}','Synthetic condition','[{"local_name":"synthetic leaf"}]','{"method":"recorded preparation"}',0.8,'Synthetic source') returning row_to_json(formulations)`),
      );
      const data = {
        encounter_id: encounter.id,
        expected_revision: 1,
        source_text: 'Synthetic visit. Synthetic tea. Reported one cup.',
        summary: 'Synthetic visit.',
        preparations: [
          {
            label: 'Synthetic tea',
            formulation_code: formula.short_code,
            formulation_updated_at: formula.updated_at,
            reported_use: 'one cup',
            disclose_composition: false,
          },
        ],
      };
      await assert.rejects(
        act(practitioner, 'draft', {
          ...data,
          preparations: [{ label: 'Synthetic tea', reported_use: 'invented dose' }],
        }),
        /UNSUPPORTED_SOURCE/,
      );
      const saved = await act(practitioner, 'draft', data);
      note = saved.note;
      await assert.rejects(act(practitioner, 'draft', data), /REVISION_CONFLICT/);
      assert.equal(
        (await act(practitioner, 'draft_detail', { encounter_id: encounter.id, note_id: note.id }))
          .source_text,
        data.source_text,
      );
      await assert.rejects(
        act(patient, 'draft_detail', { encounter_id: encounter.id, note_id: note.id }),
        /NOT_FOUND/,
      );
      const sign = {
        encounter_id: encounter.id,
        note_id: note.id,
        note_revision: 1,
        expected_revision: 2,
      };
      const preview = await act(practitioner, 'prepare', { action: 'sign', data: sign });
      await assert.rejects(
        act(
          practitioner,
          'sign',
          { ...sign, note_revision: 2 },
          { confirmation: preview.confirmation },
        ),
        /CONFIRMATION_REQUIRED/,
      );
      await assert.rejects(
        act(patient, 'sign', sign, { confirmation: preview.confirmation }),
        /CONFIRMATION_REQUIRED/,
      );
      signed = await act(practitioner, 'sign', sign, { confirmation: preview.confirmation });
      assert.equal(signed.note_revision, 2);
    },
  );
  await t.test(
    'AT13/14: immutable signed notes and snapshots; patient sees only released summary',
    async () => {
      await assert.rejects(
        sql(`update care_notes set source_text='overwritten' where id='${note.id}'`),
        /IMMUTABLE/,
      );
      const snapshot = await sql(
        `select snapshot from care_preparations where note_id='${note.id}'`,
      );
      await sql(
        `update formulations set plants='[{"local_name":"changed later"}]' where ` +
          `id='${formula.id}'`,
      );
      assert.equal(
        await sql(`select snapshot from care_preparations where note_id='${note.id}'`),
        snapshot,
      );
      assert.equal((await act(patient, 'timeline')).encounters.length, 0);
      await confirmed(practitioner, 'release', {
        encounter_id: encounter.id,
        note_id: note.id,
        note_revision: 2,
      });
      const timeline = await act(patient, 'timeline');
      assert.equal(timeline.encounters[0].notes[0].summary, 'Synthetic visit.');
      assert.equal(
        (await act(practitioner, 'note_source', { encounter_id: encounter.id, note_id: note.id }))
          .source_text,
        note.source_text,
      );
      await assert.rejects(
        act(patient, 'note_source', { encounter_id: encounter.id, note_id: note.id }),
        /NOT_FOUND/,
      );
      assert.equal(timeline.encounters[0].notes[0].preparations[0].composition_status, 'withheld');
      assert.doesNotMatch(
        JSON.stringify(timeline),
        /synthetic leaf|original_text|source_text|storage_path/,
      );
      await confirmed(practitioner, 'transition', {
        encounter_id: encounter.id,
        expected_revision: 3,
        status: 'completed',
      });
    },
  );
  await t.test(
    'AT16/20/21/23: scoped reads/exports, fresh membership and audit failure',
    async () => {
      await assert.rejects(
        act(ctx('otherPractitioner', p.id, ids.otherPractice), 'timeline'),
        /NOT_FOUND/,
      );
      await assert.rejects(act(ctx('otherPatient', p.id), 'export'), /NOT_FOUND/);
      const exported = await confirmed(patient, 'export', {});
      assert.equal((await confirmed(practitioner, 'export', {})).encounters.length, 1);
      assert.equal(exported.encounters.length, 1);
      assert.doesNotMatch(JSON.stringify(exported), /changed later|synthetic leaf/);
      await sql(
        `update care_memberships set status='suspended' where actor_id='${ids.practitioner}'`,
      );
      await assert.rejects(act(practitioner, 'timeline'), /NOT_FOUND/);
      await sql(`update care_memberships set status='active' where actor_id='${ids.practitioner}';
      create function test_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_DOWN'; end $$;
      create trigger test_audit_failure before insert on care_audit for each row execute function test_audit_failure()`);
      await assert.rejects(act(patient, 'timeline'), /AUDIT_DOWN/);
      await assert.rejects(
        act(practitioner, 'prepare', {
          action: 'sign',
          data: {
            encounter_id: encounter.id,
            note_id: note.id,
            note_revision: 2,
            expected_revision: 4,
          },
        }),
        /AUDIT_DOWN/,
      );
      await assert.rejects(confirmed(patient, 'export', {}), /AUDIT_DOWN/);
      await sql(
        'drop trigger test_audit_failure on care_audit; drop function test_audit_failure()',
      );
    },
  );
  await t.test('AT19/25: opted-in replay-safe follow-up; no response stays missing', async () => {
    await assert.rejects(
      act(practitioner, 'schedule', { encounter_id: encounter.id, due_at: now() }),
      /CONSENT_REQUIRED/,
    );
    await confirmed(patient, 'preferences', {
      purpose: 'messaging',
      granted: true,
      expected_revision: 1,
    });
    follow = await act(practitioner, 'schedule', {
      encounter_id: encounter.id,
      due_at: '2026-09-30T08:00:00Z',
    });
    assert.equal(await rpc('care_dispatch_synthetic', { p_now: '2026-09-30T12:00:00Z' }), 1);
    assert.equal(await rpc('care_dispatch_synthetic', { p_now: '2026-09-30T12:01:00Z' }), 0);
    assert.equal(
      await sql(`select count(*) from care_observations where follow_up_id='${follow.id}'`),
      '0',
    );
    const pending = (await act(patient, 'timeline')).follow_ups[0];
    assert.equal(pending.status, 'submitted');
    assert.match(pending.escalation_text, /No clinical monitoring/);
    observation = await confirmed(patient, 'respond', {
      id: follow.id,
      expected_revision: 2,
      report: 'Synthetic report: no change.',
      observed_at: now(),
    });
  });
  await t.test(
    'R1: practitioner review then later retrieval retains patient attribution',
    async () => {
      assert.equal((await act(ctx('practitioner', null, ids.practice), 'today')).updates.length, 1);
      const queue = await act(ctx('practitioner', null, ids.practice), 'review_queue');
      assert.equal(queue.length, 1);
      assert.equal(queue[0].id, observation.id);
      assert.equal(queue[0].subject_id, p.id);
      assert.equal(queue[0].report, 'Synthetic report: no change.');
      assert.equal(queue[0].reference, p.reference);
      assert.deepEqual(
        await act(ctx('otherPractitioner', null, ids.otherPractice), 'review_queue'),
        [],
      );
      await assert.rejects(
        act(ctx('otherPractitioner', null, ids.practice), 'review_queue'),
        /NOT_FOUND/,
      );
      await assert.rejects(act(ctx('patient', null, ids.practice), 'review_queue'), /NOT_FOUND/);
      await assert.rejects(
        service.act(sessions.practitioner.token, sessions.patient.csrf, {
          action: 'review_queue',
          role: 'practitioner',
          practice: ids.practice,
        }),
        /CSRF_REQUIRED/,
      );
      await confirmed(practitioner, 'review', {
        id: queue[0].id,
        expected_revision: queue[0].follow_up_revision,
        next_steps: 'Synthetic review acknowledged. No clinical advice.',
      });
      assert.deepEqual(await act(ctx('practitioner', null, ids.practice), 'review_queue'), []);
      const timeline = await act(patient, 'timeline');
      assert.equal(timeline.observations[0].source_type, 'patient_reported');
      assert.equal(timeline.observations[0].review.author_id, ids.practitioner);
      assert.equal(timeline.follow_ups[0].status, 'reviewed');
      assert.ok((await act(patient, 'access_history')).length > 0);
    },
  );
  await t.test(
    'AT11/14: patient correction/past visit stays an assertion; signed amendment retains original',
    async () => {
      await confirmed(patient, 'patient_report', {
        kind: 'correction',
        encounter_id: encounter.id,
        report: 'Synthetic correction request.',
        observed_at: now(),
      });
      await confirmed(patient, 'patient_report', {
        kind: 'past_visit',
        report: 'Synthetic earlier visit, unverified.',
        observed_at: now(),
      });
      assert.equal(
        await sql(`select count(*) from care_encounters where subject_id='${p.id}'`),
        '1',
      );
      const amendment = await act(practitioner, 'draft', {
        encounter_id: encounter.id,
        expected_revision: 4,
        source_text: 'Synthetic correction recorded.',
        summary: 'Synthetic correction recorded.',
        preparations: [],
        amends_id: note.id,
        reason: 'Patient requested correction',
      });
      await confirmed(practitioner, 'sign', {
        encounter_id: encounter.id,
        expected_revision: 5,
        note_id: amendment.note.id,
        note_revision: 1,
      });
      assert.equal(
        await sql(
          `select count(*) from care_notes where encounter_id='${encounter.id}' and ` +
            `status='signed'`,
        ),
        '2',
      );
    },
  );
  await t.test(
    'AT07/09/15: two staff, competing edits, no-treatment visit and worker consent race',
    async () => {
      await sql(
        `insert into care_memberships(practice_id,actor_id,role) ` +
          `values('${ids.practice}','${ids.otherPractitioner}','practitioner')`,
      );
      const colleague = ctx('otherPractitioner', p.id, ids.practice);
      const data = { visit_key: uuid(), occurred_at: now() };
      const arrivals = await Promise.all([
        confirmed(practitioner, 'arrive', data),
        confirmed(colleague, 'arrive', data),
      ]);
      assert.equal(arrivals[0].id, arrivals[1].id);
      const draft = {
        encounter_id: arrivals[0].id,
        expected_revision: 1,
        source_text: 'Synthetic visit with no preparation.',
        summary: 'Synthetic visit with no preparation.',
        preparations: [],
      };
      const contenders = await Promise.allSettled([
        act(practitioner, 'draft', draft),
        act(colleague, 'draft', draft),
      ]);
      assert.equal(contenders.filter(r => r.status === 'fulfilled').length, 1);
      assert.match(
        contenders.find(r => r.status === 'rejected').reason.message,
        /REVISION_CONFLICT/,
      );
      const winner = contenders[0].status === 'fulfilled' ? practitioner : colleague;
      const saved = contenders.find(r => r.status === 'fulfilled').value;
      await confirmed(winner, 'sign', {
        encounter_id: arrivals[0].id,
        note_id: saved.note.id,
        note_revision: 1,
        expected_revision: 2,
      });
      assert.equal(
        await sql(`select count(*) from care_preparations where note_id='${saved.note.id}'`),
        '0',
      );
      const pending = await act(practitioner, 'schedule', {
        encounter_id: encounter.id,
        due_at: '2026-09-30T09:01:00Z',
      });
      const preference = { purpose: 'messaging', granted: false, expected_revision: 2 };
      const preview = await act(patient, 'prepare', { action: 'preferences', data: preference });
      await Promise.all([
        act(patient, 'preferences', preference, { confirmation: preview.confirmation }),
        rpc('care_dispatch_synthetic', { p_now: '2026-09-30T12:00:00Z' }),
      ]);
      assert.equal(
        await sql(`select status from care_follow_ups where id='${pending.id}'`),
        'cancelled',
      );
      await confirmed(patient, 'preferences', {
        purpose: 'messaging',
        granted: true,
        expected_revision: 3,
      });
    },
  );
  await t.test('AT19: withdrawal cancels queued work and prevents new collection', async () => {
    const queued = await act(practitioner, 'schedule', {
      encounter_id: encounter.id,
      due_at: '2026-09-30T09:00:00Z',
    });
    await confirmed(patient, 'preferences', {
      purpose: 'tracking',
      granted: false,
      expected_revision: 4,
    });
    assert.equal(await rpc('care_dispatch_synthetic', { p_now: '2026-09-30T12:02:00Z' }), 0);
    assert.equal(
      await sql(`select status from care_follow_ups where id='${queued.id}'`),
      'cancelled',
    );
    assert.deepEqual(await act(ctx('practitioner', null, ids.practice), 'review_queue'), []);
    await assert.rejects(
      confirmed(patient, 'patient_report', {
        kind: 'past_visit',
        report: 'No collection',
        observed_at: now(),
      }),
      /CONSENT_REQUIRED/,
    );
    await assert.rejects(
      confirmed(practitioner, 'arrive', { visit_key: uuid(), occurred_at: now() }),
      /NOT_FOUND/,
    );
    const deletion = await confirmed(patient, 'rights', { kind: 'deletion' });
    assert.equal(deletion.status, 'pending_policy_review');
  });
  await t.test(
    'AT22/36: legacy codes, consent guard and deletion do not cascade continuity history',
    async () => {
      const legacyPatient = JSON.parse(
        await sql(`insert into patients(practitioner_id,display_name,phone_number,status,consent_status,consent_expires_at)
      values('${ids.legacy}','Synthetic legacy','+447700900010','pending_consent','pending',now()+interval '7 days') returning row_to_json(patients)`),
      );
      assert.match(legacyPatient.short_code, /^PT-/);
      await assert.rejects(
        sql(
          `insert into treatments(practitioner_id,patient_id) ` +
            `values('${ids.legacy}','${legacyPatient.id}')`,
        ),
        /consent/,
      );
      await rpc('care_backfill_identity', {});
      const first = await sql(
        `select subject_id from care_identity_links where legacy_patient_id='${legacyPatient.id}'`,
      );
      await rpc('care_backfill_identity', {});
      assert.equal(
        await sql(
          `select subject_id from care_identity_links where ` +
            `legacy_patient_id='${legacyPatient.id}'`,
        ),
        first,
      );
      assert.equal(
        await sql(
          `select state from care_identity_links where legacy_patient_id='${legacyPatient.id}'`,
        ),
        'unlinked',
      );
      await sql(
        `update patients set ` +
          `status='active',consent_status='granted',consent_method='whatsapp',consent_recorded_at=now() ` +
          `where id='${legacyPatient.id}'`,
      );
      const code = await sql(
        `insert into treatments(practitioner_id,patient_id) ` +
          `values('${ids.legacy}','${legacyPatient.id}') returning short_code`,
      );
      assert.match(code, /^TX-/);
      await sql(`delete from practitioners where id='${ids.legacy}'`);
      assert.equal(
        await sql(`select count(*) from care_notes where encounter_id='${encounter.id}'`),
        '2',
      );
      assert.equal(await sql(`select count(*) from care_subjects where id='${p.id}'`), '1');
      assert.equal(
        await sql(
          `select count(*) from care_preparations where note_id='${note.id}' and ` +
            `formulation_id is null`,
        ),
        '1',
      );
    },
  );
  await t.test('direct anonymous/authenticated table and RPC access remains denied', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(
        sql(`set role ${role}; select * from care_subjects`),
        /permission denied/,
      );
      await assert.rejects(
        sql(`set role ${role}; select care_session_actor('guess')`),
        /permission denied/,
      );
      await assert.rejects(
        sql(`set role ${role}; select care_review_queue('guess','guess','${ids.practice}')`),
        /permission denied/,
      );
    }
    await assert.rejects(sql(`update care_audit set action='overwritten'`), /append-only/);
  });
  await t.test(
    'stable timeline cursor retrieves all reports with identical timestamps',
    async () => {
      await sql(`insert into care_observations(subject_id,practice_id,actor_id,kind,source_ref,report,observed_at)
      select '${p.id}','${ids.practice}','${ids.patient}','past_visit',gen_random_uuid(),'Pagination fixture '||n,now() from generate_series(1,55) n`);
      const seen = new Set();
      let cursor;
      do {
        const page = await act(patient, 'timeline', cursor ? { cursor } : {});
        for (const row of page.observations) {
          assert.equal(seen.has(row.id), false);
          seen.add(row.id);
        }
        cursor = page.next_cursor;
      } while (cursor);
      assert.equal(
        seen.size,
        Number(await sql(`select count(*) from care_observations where subject_id='${p.id}'`)),
      );
    },
  );
  await t.test(
    'review queue retains old actionable reports and fails closed on revoked membership or ' +
      'audit failure',
    async () => {
      // Re-grant through the same authenticated, confirmed preference workflow.
      await confirmed(patient, 'preferences', {
        purpose: 'tracking',
        granted: true,
        expected_revision: 5,
      });
      const queueContext = ctx('practitioner', null, ids.practice);
      const page = await act(practitioner, 'timeline');
      const queue = await act(queueContext, 'review_queue');
      assert.equal(queue.length, 50);
      assert.equal(
        page.observations.some(row => row.id === queue[0].id),
        false,
        'oldest pending report is beyond the first timeline page',
      );
      assert.equal(queue[0].follow_up_revision, null);
      await confirmed(practitioner, 'review', {
        id: queue[0].id,
        expected_revision: null,
        next_steps: 'Synthetic old report acknowledged.',
      });
      assert.equal(
        (await act(queueContext, 'review_queue')).some(row => row.id === queue[0].id),
        false,
      );
      await sql(
        `update care_memberships set status='suspended' where actor_id='${ids.practitioner}';`,
      );
      await assert.rejects(act(queueContext, 'review_queue'), /NOT_FOUND/);
      await sql(`update care_memberships set status='active' where actor_id='${ids.practitioner}';
      create function test_queue_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_DOWN'; end $$;
      create trigger test_queue_audit_failure before insert on care_audit for each row execute function test_queue_audit_failure()`);
      try {
        await assert.rejects(act(queueContext, 'review_queue'), /AUDIT_DOWN/);
      } finally {
        await sql(
          'drop trigger test_queue_audit_failure on care_audit; drop function ' +
            'test_queue_audit_failure()',
        );
      }
    },
  );
  await t.test('AT35: actual HTTP session, CSRF, no-store, logout and forged tools', async () => {
    const app = express();
    const login = async (email, password) => {
      if (email !== 'synthetic@example.invalid' || password !== 'synthetic-test-only')
        throw new Error('UNAUTHENTICATED');
      return sessions.patient;
    };
    app.use('/care', createRouter({ login }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    process.env.CARE_ORIGIN = origin;
    const post = (path, body, headers = {}) =>
      fetch(origin + '/care/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
        body: JSON.stringify(body),
      });
    try {
      assert.equal((await post('action', { action: 'me' })).status, 401);
      const res = await post('login', {
        email: 'synthetic@example.invalid',
        password: 'synthetic-test-only',
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('cache-control'), /no-store/);
      const cookie = res.headers.get('set-cookie').split(';')[0];
      assert.match(res.headers.get('set-cookie'), /HttpOnly/);
      const { csrf } = await res.json();
      const headers = { cookie, 'x-sanko-csrf': csrf };
      assert.equal(
        (await post('action', { action: 'me', role: 'patient' }, { cookie })).status,
        403,
      );
      assert.equal(
        (
          await post(
            'action',
            { action: 'me', role: 'patient' },
            { ...headers, Origin: 'https://other.invalid' },
          )
        ).status,
        403,
      );
      assert.equal((await post('action', { action: 'me', role: 'patient' }, headers)).status, 200);
      assert.equal(
        (await post('action', { action: 'timeline', role: 'patient', subject: p2.id }, headers))
          .status,
        404,
      );
      assert.equal(
        (
          await post(
            'action',
            { action: 'me', role: 'patient', actor_id: ids.practitioner },
            headers,
          )
        ).status,
        400,
      );
      await post('action', { action: 'logout', role: 'patient' }, headers);
      assert.equal((await post('action', { action: 'me', role: 'patient' }, headers)).status, 401);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  await t.test('AT33: dump/restore preserves synthetic records and migration ledger', async () => {
    const url = process.env.CARE_TEST_DB_URL;
    const restored = new URL(url);
    restored.pathname += '_restore';
    const dbname = restored.pathname.slice(1);
    execFileSync('psql', [url, '-c', `create database ${dbname}`]);
    try {
      const dump = execFileSync('pg_dump', ['--no-owner', url], { maxBuffer: 10 * 1024 * 1024 });
      execFileSync('psql', [restored.href, '-v', 'ON_ERROR_STOP=1', '-q'], {
        input: dump,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const count = execFileSync(
        'psql',
        [
          restored.href,
          '-Atc',
          `select count(*) from care_notes where encounter_id=${literal(encounter.id)}`,
        ],
        { encoding: 'utf8' },
      ).trim();
      assert.equal(count, '2');
      const ledger = execFileSync(
        'psql',
        [restored.href, '-Atc', 'select count(*) from schema_migrations'],
        { encoding: 'utf8' },
      ).trim();
      assert.equal(ledger, String(require('../../scripts/migrate').migrationFiles().length));
      assert.throws(
        () =>
          execFileSync(
            'psql',
            [
              restored.href,
              '-v',
              'ON_ERROR_STOP=1',
              '-Atc',
              'set role anon; select * from care_notes',
            ],
            { stdio: 'pipe' },
          ),
        /failed/,
      );
      const permitted = execFileSync(
        'psql',
        [
          restored.href,
          '-Atc',
          "select has_function_privilege('service_role','care_dispatch_synthetic(timestamp " +
            "with time zone)','execute')",
        ],
        { encoding: 'utf8' },
      ).trim();
      assert.equal(permitted, 't');
    } finally {
      execFileSync('psql', [url, '-c', `drop database ${dbname} with (force)`]);
    }
  });
  await t.test(
    'fresh authentication required for exports; suspended actors cannot retain sessions',
    async () => {
      await sql(
        `update care_sessions set authenticated_at=now()-interval '11 minutes' where ` +
          `token_hash='${hash(sessions.otherPatient.token)}'`,
      );
      await assert.rejects(confirmed(ctx('otherPatient', p2.id), 'export', {}), /REAUTHENTICATE/);
      await sql(`update care_actors set status='suspended' where id='${ids.otherPatient}'`);
      await assert.rejects(act(ctx('otherPatient'), 'me'), /UNAUTHENTICATED/);
    },
  );
});

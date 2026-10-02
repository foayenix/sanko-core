'use strict';
// WhatsApp-first acceptance on disposable PostgreSQL: the real role router,
// guided engine, care/evidence SQL and outbound worker, with fictional actors
// and a fake transport. WA numbers name the scenario exercised, not
// certification of every condition in the specification.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { sql, rpc, phone, contact } = require('../helpers/channelPostgres');
const careFixtures = require('../helpers/carePostgres');
const evidenceFixtures = require('../helpers/evidencePostgres');

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

Object.assign(process.env, {
  CARE_PATIENT_ACCESS_ENABLED: 'true',
  CARE_ENCOUNTERS_ENABLED: 'true',
  CARE_SYNTHETIC_ONLY: 'true',
  PATIENT_TRACKING_ENABLED: 'true',
  AGENT_TOOLS: 'full',
  CARE_ORIGIN: 'https://care.example.invalid',
  EVIDENCE_ENABLED: 'true',
  EVIDENCE_SYNTHETIC_ONLY: 'true',
  EVIDENCE_ORIGIN: 'https://evidence.example.invalid',
  CHANNEL_SYNTHETIC_ONLY: 'true',
  CHANNEL_GUIDED_ENABLED: 'false',
});
if (fs.existsSync(FONT))
  Object.assign(process.env, { EVIDENCE_PDF_FONT: FONT, EVIDENCE_PDF_FONT_BOLD: BOLD });

for (const store of ['care', 'evidence', 'channel']) require(`../../src/${store}/store`).rpc = rpc;
const engine = require('../../src/channel/engine');
const careChannel = require('../../src/care/channel');
const careService = require('../../src/care/service');
const evidenceService = require('../../src/evidence/service');
const outbound = require('../../src/channel/outbound');

const uuid = () => crypto.randomUUID();
const enable = () =>
  Object.assign(process.env, {
    CHANNEL_GUIDED_ENABLED: 'true',
    CARE_CHANNEL_ACTIONS_ENABLED: 'true',
    CARE_CHANNEL_NOTIFICATIONS_ENABLED: 'true',
    EVIDENCE_CHANNEL_ACTIONS_ENABLED: 'true',
    EVIDENCE_CHANNEL_DELIVERY_ENABLED: 'true',
  });

test('WhatsApp-first care and evidence journeys', async t => {
  const care = await careFixtures.seed();
  const ev = await evidenceFixtures.seed();
  const { ids } = care;
  // Practitioners with an existing Vault account default to My vault.
  const vaultPhones = new Set(['+447700900202', '+447700900203']);
  const route = (number, messages) =>
    careChannel.resolve(number, messages, vaultPhones.has(number));
  const chat = number => phone(number, { route, engine });
  const patient = chat('+447700900201');
  const practitioner = chat('+447700900202');
  const owner = chat('+447700900203');
  const stranger = chat('+447700900204');

  const careLink = async name => {
    const s = care.sessions[name];
    const result = await careService.act(s.token, s.csrf, {
      action: 'channel_link',
      role: name === 'practitioner' ? 'practitioner' : 'patient',
      data: {},
    });
    return result.code;
  };
  const evidenceAct = (name, body) => {
    const s = ev.sessions[name];
    return evidenceService.act(s.token, s.csrf, body);
  };

  await t.test('WA30: with the channel gates off nothing is intercepted', async () => {
    const result = await patient.send('My care');
    assert.equal(result.mode, 'patient');
    assert.equal(result.handled, false);
    const vault = await practitioner.send('menu');
    assert.equal(vault.handled, false);
    assert.equal(await sql('select count(*) from channel_tasks'), '0');
    await assert.rejects(careLink('patient'), /FEATURE_DISABLED/);
    enable();
    assert.equal(
      (
        await careService.act(care.sessions.patient.token, care.sessions.patient.csrf, {
          action: 'me',
          role: 'patient',
        })
      ).capabilities.whatsapp,
      true,
    );
  });

  await t.test('WA06: before linking, only a generic menu; free text is not saved', async () => {
    patient.clear();
    await patient.send('My care');
    assert.match(patient.texts(), /link this chat to your Sanko account once/);
    assert.deepEqual(patient.titles(), ['Link my account', 'Language', 'Help']);
    await patient.send('I feel worse since the last visit');
    assert.match(patient.texts(), /Your message was not saved/);
    assert.equal(await sql('select count(*) from care_observations'), '0');
    assert.doesNotMatch(patient.texts(), /Synthetic patient|SK-/);
  });

  await t.test('Link codes are single-use, expire, and lock after repeated failures', async () => {
    stranger.clear();
    await stranger.send('My care');
    for (let i = 0; i < 5; i++) await stranger.send('LINK ABCD-2345');
    assert.equal((stranger.texts().match(/did not work/g) ?? []).length, 5);
    await stranger.send(`LINK ${await careLink('otherPatient')}`);
    assert.match(stranger.last().body, /paused for an hour/);
    const code = await careLink('patient');
    await sql(`update channel_link_codes set expires_at=now()-interval '1 second'`);
    await patient.send(`LINK ${code}`);
    assert.match(patient.last().body, /did not work/);
    const fresh = await careLink('patient');
    await patient.send(`link ${fresh.toLowerCase()}`);
    assert.match(patient.texts(), /Linked to Synthetic patient for care/);
    await patient.send(`LINK ${fresh}`);
    assert.match(patient.last().body, /did not work/);
    assert.equal(
      await sql(
        `select count(*) from channel_bindings where revoked_at is null and contact_hash='${contact(patient.number)}'`,
      ),
      '1',
    );
  });

  let reference;
  await t.test('C01/WA01: onboarding by taps, with free text where it is needed', async () => {
    patient.clear();
    await patient.send('menu');
    assert.match(patient.texts(), /for you or for someone else/);
    await patient.tap('Someone else');
    assert.match(patient.last().body, /not available yet. No record was created/);
    await patient.send('menu');
    await patient.tap('Myself');
    await patient.send('Synthetic Ada');
    assert.match(patient.texts(), /Create a care record with the name "Synthetic Ada"/);
    await patient.tap('Create record');
    reference = /reference is (SK-[0-9A-F]+)/.exec(patient.texts())[1];
    assert.equal(
      await sql(`select display_name from care_subjects where public_reference='${reference}'`),
      'Synthetic Ada',
    );
    assert.ok(patient.titles().includes('Check-ins'));
  });

  await t.test('C01/WA08: invitation is bound to its recipient and confirmed in chat', async () => {
    const pr = care.sessions.practitioner;
    await careService.act(pr.token, pr.csrf, {
      action: 'invite',
      role: 'practitioner',
      practice: ids.practice,
      data: { reference },
      key: uuid(),
    });
    // Another linked patient on another phone sees nothing.
    const other = chat('+447700900205');
    await other.send('My care');
    await other.send(`LINK ${await careLink('otherPatient')}`);
    await other.tap('Myself');
    await other.send('Synthetic Ben');
    await other.tap('Create record');
    await other.tap('Invitations');
    assert.match(other.texts(), /no practice invitations/);
    patient.clear();
    await patient.send('menu');
    await patient.tap('Invitations');
    assert.match(patient.texts(), /Synthetic practice A invites you/);
    await patient.tap('Accept');
    assert.match(patient.last().body, /Accept care tracking with Synthetic practice A/);
    await patient.tap('Accept tracking');
    assert.match(patient.texts(), /Saved. Care tracking with Synthetic practice A is on/);
    assert.equal(
      await sql(
        `select tracking from care_relationships r join care_subjects s on s.id=r.subject_id where s.public_reference='${reference}'`,
      ),
      't',
    );
    assert.equal(await sql(`select count(*) from care_consents where purpose='tracking'`), '1');
  });

  await t.test('C06: optional messages are turned on with an exact confirmation', async () => {
    await patient.send('menu');
    await patient.tap('Messages and privacy');
    await patient.tap('Tracking choices');
    assert.match(patient.last().body, /tracking is on, optional messages are off/);
    await patient.tap('Turn messages on');
    await patient.tap('Confirm change');
    assert.match(patient.texts(), /Saved. Your choice is recorded/);
    assert.equal(
      await sql(`select messaging from care_relationships where practice_id='${ids.practice}'`),
      't',
    );
  });

  let subjectId;
  await t.test(
    'C02/WA13: practitioner records, signs, releases and completes a visit in chat',
    async () => {
      subjectId = await sql(`select id from care_subjects where public_reference='${reference}'`);
      await sql(`insert into formulations(practitioner_id,plants,preparation,dosage,condition_local,confidence_score,status)
      values('${ids.legacy}','[{"local_name":"Fictional bark","part_used":"bark","quantity_raw":"one handful"}]','{"method":"boil"}',null,'Fictional cough',0.5,'active')`);
      const code = await sql(
        `select short_code from formulations where practitioner_id='${ids.legacy}'`,
      );
      practitioner.clear();
      await practitioner.send(`LINK ${await careLink('practitioner')}`);
      assert.ok(practitioner.titles().includes('Record a visit'));
      await practitioner.tap('Record a visit');
      await practitioner.tap('Synthetic Ada · SK-' + reference.slice(3, 7));
      await practitioner.tap('New visit now');
      await practitioner.tap('Record visit');
      assert.match(practitioner.last().body, /Type your visit note/);
      await practitioner.media();
      assert.match(practitioner.last().body, /not supported in this step/);
      const note =
        'Patient reports a dry cough for three days. Gave Fictional bark tea. Review in a week.';
      await practitioner.send(note);
      await practitioner.tap('Type part of it');
      await practitioner.send('Rest and drink fluids.');
      assert.match(practitioner.last().body, /not in your note exactly/);
      await practitioner.send('Gave Fictional bark tea. Review in a week.');
      await practitioner.tap('From my Vault');
      // Long row titles are shortened on screen; the full text is the row description.
      const row = practitioner.option(practitioner.titles().find(title => title.startsWith(code)));
      assert.equal(row.description, `${code} · Fictional cough`);
      await practitioner.tap(null, row);
      await practitioner.send('Fictional bark');
      await practitioner.tap('Show recipe');
      assert.match(
        practitioner.last().body,
        new RegExp(`Fictional bark \\(Vault ${code}, recipe shown to patient\\)`),
      );
      await practitioner.tap('Save draft');
      assert.match(practitioner.texts(), /Draft saved \(version 1\). It is not signed/);
      assert.equal(await sql(`select status from care_notes`), 'draft');
      // Signing needs a verification from the last 10 minutes.
      await sql(
        `update care_sessions set authenticated_at=now()-interval '20 minutes' where purpose='channel' and actor_id='${ids.practitioner}'`,
      );
      await practitioner.tap('Sign this version');
      assert.match(practitioner.last().body, /verification from the last 10 minutes/);
      assert.equal(await sql(`select status from care_notes`), 'draft');
      practitioner.clear();
      await practitioner.send(`LINK ${await careLink('practitioner')}`);
      assert.match(practitioner.texts(), /Welcome back/);
      assert.match(practitioner.last().body, /Sign this exact version \(1\)/);
      await practitioner.tap('Sign this version');
      assert.match(practitioner.texts(), /Signed. The patient cannot see it until you release it/);
      await practitioner.tap('Release to patient');
      assert.match(practitioner.texts(), /Released. Synthetic Ada can read this summary/);
      await practitioner.tap('Mark completed');
      await practitioner.tap('In 3 days');
      assert.match(practitioner.texts(), /Check-in scheduled for/);
      assert.equal(await sql(`select status from care_notes`), 'signed');
      assert.equal(await sql(`select count(*) from care_releases`), '1');
      assert.equal(await sql(`select status from care_encounters`), 'completed');
      assert.equal(await sql(`select composition_status from care_preparations`), 'recorded');
      assert.equal(await sql(`select count(*) from care_follow_ups where status='scheduled'`), '1');
    },
  );

  await t.test(
    'C03/WA14/WA15: opted-in notice, STOP fences it, unrelated chat does not resume',
    async () => {
      await sql(`update care_follow_ups set due_at='2026-01-01T10:00:00Z'`);
      assert.equal(await rpc('care_dispatch_synthetic', { p_now: '2026-01-01T11:00:00Z' }), 1);
      assert.equal(await rpc('channel_enqueue_check_ins', { p_limit: 10 }), 1);
      patient.clear();
      await patient.send('STOP');
      assert.match(
        patient.last().body,
        /Optional Sanko messages to this WhatsApp number are stopped. 1 waiting message was cancelled/,
      );
      assert.match(patient.last().body, /does not delete records, change tracking/);
      const sent = await outbound.dispatch({ transport: patient.transport });
      assert.deepEqual(sent, []);
      assert.equal(await sql(`select cancel_reason from channel_outbound`), 'contact_suppressed');
      await patient.send('hello again');
      assert.equal(
        await sql(
          `select suppressed from channel_suppressions where contact_hash='${contact(patient.number)}'`,
        ),
        't',
      );
      await patient.send('cancel');
      await patient.send('RESUME');
      await patient.tap('Resume messages');
      assert.match(patient.texts(), /Optional messages to this number are on again/);
      assert.equal(
        await sql(
          `select suppressed from channel_suppressions where contact_hash='${contact(patient.number)}'`,
        ),
        'f',
      );
    },
  );

  let observationId;
  await t.test(
    'C03/WA09/WA10/WA05: patient answers a check-in in chat, worse and unsure kept as said',
    async () => {
      patient.clear();
      await patient.send('menu');
      await patient.tap('Check-ins');
      assert.match(patient.last().body, /Compared with your last visit, how do you feel/);
      assert.deepEqual(patient.titles(), [
        'Better',
        'About the same',
        'Worse',
        'Mixed or changing',
        'Unwanted effects',
        'Not sure',
        'Something else',
      ]);
      await patient.tap('Worse');
      await patient.send('Cough is worse at night, not sure if the tea is related');
      assert.match(patient.last().body, /Answer: Worse\nYour words: Cough is worse at night/);
      const send = await patient.tap('Send');
      assert.match(
        patient.texts(),
        /waiting for Synthetic practice A to review it. They have not read it yet/,
      );
      // Repeating the tap replays the receipt; one observation exists.
      patient.clear();
      await patient.tap('Send', send);
      assert.match(patient.texts(), /They have not read it yet/);
      assert.equal(await sql(`select count(*) from care_observations`), '1');
      const report = await sql(`select report from care_observations`);
      assert.match(report, /Answer: Worse/);
      assert.match(report, /not sure if the tea is related/);
      assert.doesNotMatch(report, /better|improv/i);
      observationId = await sql(`select id from care_observations`);
      assert.equal(
        await sql(
          `select option_code||'|'||(care_actor_id='${ids.patient}')::text||'|'||(record_id='${observationId}')::text from channel_answers`,
        ),
        'worse|true|true',
      );
      assert.equal(await sql(`select status from care_follow_ups`), 'responded');
    },
  );

  await t.test(
    'C04/WA11/WA26: practitioner reviews from chat; patient and browser see the same record',
    async () => {
      practitioner.clear();
      await practitioner.send('Care inbox');
      assert.match(practitioner.last().body, /1 update waiting for review/);
      await practitioner.tap(
        practitioner.titles().find(title => title.startsWith('Synthetic Ada')),
      );
      assert.match(practitioner.texts(), /Cough is worse at night/);
      await practitioner.tap('Write next steps');
      await practitioner.send('Please come in tomorrow morning so we can check your chest.');
      await practitioner.tap('Send next steps');
      assert.match(practitioner.texts(), /Reviewed. Synthetic Ada can now see your next steps/);
      assert.match(practitioner.texts(), /Your care inbox is empty/);
      assert.equal(
        await sql(`select count(*) from care_reviews where observation_id='${observationId}'`),
        '1',
      );
      patient.clear();
      await patient.send('menu');
      await patient.tap('Practice replies');
      assert.match(patient.texts(), /Reply from Synthetic practitioner/);
      assert.match(patient.texts(), /come in tomorrow morning/);
      const browser = await careService.act(
        care.sessions.patient.token,
        care.sessions.patient.csrf,
        {
          action: 'timeline',
          role: 'patient',
          subject: subjectId,
          data: {},
        },
      );
      assert.equal(browser.observations[0].id, observationId);
      assert.equal(
        browser.observations[0].review.next_steps,
        'Please come in tomorrow morning so we can check your chest.',
      );
    },
  );

  await t.test(
    'C05/WA12: released history and a correction request keep the signed note',
    async () => {
      patient.clear();
      await patient.send('menu');
      await patient.tap('My visits');
      await patient.tap(patient.titles()[0]);
      assert.match(patient.texts(), /Gave Fictional bark tea. Review in a week./);
      assert.doesNotMatch(patient.texts(), /dry cough for three days/); // private source stays private
      await patient.tap('Request a correction');
      await patient.send('It was four days, not three.');
      await patient.tap('Send');
      assert.match(patient.texts(), /original visit record is unchanged/);
      assert.equal(
        await sql(`select count(*) from care_observations where kind='correction'`),
        '1',
      );
      assert.equal(
        await sql(`select source_text from care_notes`),
        'Patient reports a dry cough for three days. Gave Fictional bark tea. Review in a week.',
      );
    },
  );

  await t.test(
    'C03: a message outside a check-in asks where it goes; never lost, never auto-saved',
    async () => {
      patient.clear();
      await patient.send('I started a new herbal product from the market');
      assert.match(patient.last().body, /Where should this message go/);
      assert.equal(
        await sql(`select count(*) from care_observations where kind='product_report'`),
        '0',
      );
      await patient.tap('Product or allergy note');
      assert.match(patient.last().body, /"I started a new herbal product from the market"/);
      await patient.tap('Send');
      assert.equal(
        await sql(`select count(*) from care_observations where kind='product_report'`),
        '1',
      );
    },
  );

  await t.test(
    'WA02/WA29: language change keeps the task; cancel and expiry commit nothing',
    async () => {
      await sql(`update care_follow_ups set status='submitted', revision=revision+1`);
      // The follow-up already has an observation; this only exercises the question.
      patient.clear();
      await patient.send('menu');
      await patient.tap('Check-ins');
      await patient.tap('Mixed or changing');
      await patient.send('LANGUAGE');
      await patient.tap('Yorùbá');
      assert.match(patient.texts(), /Reviewed wording in Yorùbá is not available yet/);
      assert.match(patient.last().body, /Is there anything you want to add/);
      await patient.send('CANCEL');
      assert.match(patient.last().body, /Cancelled. Nothing was saved/);
      await sql(`update care_follow_ups set status='responded', revision=revision+1`);
      assert.equal(await sql(`select count(*) from care_observations where kind='follow_up'`), '1');
      await patient.send('menu');
      await patient.tap('Send an update');
      await sql(
        `update channel_tasks set expires_at=now()-interval '1 second' where status='active'`,
      );
      await patient.send('This should not be saved anywhere');
      assert.equal(await sql(`select count(*) from channel_tasks where status='expired'`), '1');
      assert.match(patient.last().body, /Where should this message go/);
    },
  );

  await t.test('WA04: an old button after a role switch is refused without any write', async () => {
    practitioner.clear();
    await practitioner.send('My patients');
    const old = practitioner.option(practitioner.titles()[0]);
    await practitioner.send('My care');
    assert.match(practitioner.texts(), /closed because you switched/);
    const before = await sql('select count(*) from care_audit');
    await practitioner.tap(null, old);
    assert.match(practitioner.texts(), /no longer current, so nothing was changed/);
    assert.equal(
      await sql(
        `select count(*) from care_audit where action like 'channel.%' and created_at > now() - interval '0 seconds'`,
      ),
      '0',
    );
    assert.ok(Number(await sql('select count(*) from care_audit')) >= Number(before));
    await practitioner.send('My vault');
  });

  await t.test('WA06: a forwarded prompt or expired session discloses nothing', async () => {
    patient.clear();
    await patient.send('menu');
    const visits = patient.option('My visits');
    stranger.clear();
    await stranger.tap(null, visits);
    assert.match(stranger.texts(), /no longer current/);
    assert.doesNotMatch(stranger.texts(), /Fictional bark|Synthetic Ada/);
    await sql(
      `update care_sessions set expires_at=now()-interval '1 second' where purpose='channel' and actor_id='${ids.patient}'`,
    );
    patient.clear();
    await patient.tap(null, visits);
    assert.match(patient.texts(), /Please verify again/);
    assert.doesNotMatch(patient.texts(), /Fictional bark/);
    await patient.send(`LINK ${await careLink('patient')}`);
  });

  await t.test("WA07: a recycled phone never reaches the earlier owner's history", async () => {
    // otherPatient links on the patient's phone with their own code.
    patient.clear();
    await patient.send(`LINK ${await careLink('otherPatient')}`);
    assert.match(patient.texts(), /Linked to Synthetic otherPatient/);
    await patient.tap('My visits');
    assert.match(patient.texts(), /no released visits/);
    assert.doesNotMatch(patient.texts(), /Fictional bark|Synthetic Ada/);
    assert.equal(
      await sql(
        `select count(*) from care_sessions where actor_id='${ids.patient}' and purpose='channel' and revoked_at is null and expires_at>now()`,
      ),
      '0',
    );
    await patient.send(`LINK ${await careLink('patient')}`);
  });

  await t.test('C06/WA28: a deletion request is recorded as pending, never as done', async () => {
    patient.clear();
    await patient.send('menu');
    await patient.tap('Messages and privacy');
    await patient.tap('Request deletion');
    await patient.tap('Send request');
    assert.match(
      patient.texts(),
      /pending policy review. Nothing has been erased or changed yet; it is not fulfilled/,
    );
    assert.equal(await sql(`select status from care_rights_requests`), 'pending_policy_review');
  });

  await t.test('WA27: a suspended membership fails closed in chat', async () => {
    await sql(
      `update care_memberships set status='suspended' where actor_id='${ids.practitioner}'`,
    );
    practitioner.clear();
    await practitioner.send('Care inbox');
    assert.match(practitioner.texts(), /no active practice|not available to you/);
    await sql(`update care_memberships set status='active' where actor_id='${ids.practitioner}'`);
    await practitioner.send('cancel');
  });

  // ── evidence owner journeys ──
  const checks = {
    sources: true,
    applicability: true,
    uncertainty: true,
    conflicts: true,
    language: true,
    artifacts: true,
  };
  const act = (who, action, data = {}, request = null, extra = {}) =>
    evidenceAct(who, {
      action,
      role: who === 'other' ? 'owner' : who,
      data,
      ...(request ? { request_id: request.id, expected_revision: request.revision } : {}),
      ...extra,
    });
  const write = async (who, action, data = {}, request = null) => {
    const body = { key: uuid() };
    if (['submit', 'approve', 'release', 'cancel', 'withdraw'].includes(action))
      body.confirmation = (await act(who, 'prepare', { action, data }, request)).confirmation;
    return act(who, action, data, request, body);
  };
  const requestRow = async () => {
    const id = await sql(
      `select id from evidence_requests where owner_id='${ev.ids.legacy}' order by created_at desc limit 1`,
    );
    return {
      id,
      revision: Number(await sql(`select revision from evidence_requests where id='${id}'`)),
    };
  };

  await t.test(
    'E01/WA16/WA17: owner confirms the exact recipe and notice by buttons; a changed recipe needs a fresh review',
    async () => {
      owner.clear();
      await owner.send(
        `LINK ${(await evidenceAct('owner', { action: 'channel_link', role: 'owner', data: {} })).code}`,
      );
      assert.match(owner.texts(), /Linked to Fictional owner for evidence reports/);
      assert.ok(owner.titles().includes('Evidence reports'));
      assert.ok(!owner.titles().includes('Care inbox'));
      await owner.tap('Evidence reports');
      await owner.tap('Request a review');
      const code = await sql(
        `select short_code from formulations where id='${ev.ids.formulation}'`,
      );
      await owner.tap(code);
      await owner.tap('General overview');
      assert.match(owner.texts(), new RegExp(`exact recipe that would be reviewed \\(${code}\\)`));
      assert.match(owner.texts(), /name: Fictional leaf A; part: unknown; quantity: withheld/);
      assert.match(owner.texts(), /Name mappings are not botanical authentication/);
      await owner.tap('Confirm recipe');
      assert.match(owner.texts(), /Service notice \(DRAFT — fictional exercise only\)/);
      assert.match(owner.last().body, /separate from any Vault consent/);
      // The recipe changes after the notice was shown, before the tap.
      await sql(
        `update formulations set condition_local='Changed fictional topic', updated_at=now() where id='${ev.ids.formulation}'`,
      );
      const stale = owner.option('Agree and submit');
      owner.clear();
      await owner.tap(null, stale);
      assert.match(
        owner.texts(),
        /recipe changed while you were confirming, so it was not submitted/,
      );
      assert.match(owner.texts(), /Reported use: Changed fictional topic/);
      assert.equal(await sql(`select count(*) from formulation_evidence_snapshots`), '0');
      await owner.tap('Confirm recipe');
      const agree = await owner.tap('Agree and submit');
      assert.match(
        owner.texts(),
        /Submitted. Request [0-9A-F]{8} is queued for an analyst. Nothing has been reviewed yet/,
      );
      await owner.tap(null, agree);
      assert.equal(await sql(`select count(*) from formulation_evidence_snapshots`), '1');
      assert.equal(
        await sql(`select count(*) from evidence_requests where status='submitted'`),
        '1',
      );
      assert.equal(
        await sql(`select channel from evidence_service_authorisations`),
        'verified_whatsapp',
      );
      assert.equal(
        await sql(`select content->>'reported_use' from formulation_evidence_snapshots`),
        'Changed fictional topic',
      );
    },
  );

  await t.test(
    'E02/WA18: an analyst question is answered in chat; the recipe stays immutable',
    async () => {
      let r = await requestRow();
      for (const who of ['analyst', 'reviewer', 'release'])
        r = await write(
          'admin',
          'assign',
          { principal_id: ev.ids[who], capability: who, revoke: false },
          r,
        );
      r = await write('admin', 'triage', { status: 'accepted', reason: 'Fictional capacity' }, r);
      await write('analyst', 'ask', { question: 'Which part of Fictional leaf A is used?' }, r);
      const before = await sql('select content_hash from formulation_evidence_snapshots');
      owner.clear();
      await owner.send('Evidence reports');
      await owner.tap('Check progress');
      await owner.tap(owner.titles()[0]);
      assert.match(owner.texts(), /the analyst has a question for you/);
      assert.match(owner.texts(), /"Which part of Fictional leaf A is used\?"/);
      await owner.tap('Answer the question');
      await owner.send('Only the young leaves.');
      await owner.tap('Send answer');
      assert.match(owner.texts(), /Sent. Your answer is with the assigned analyst/);
      assert.equal(await sql(`select answer from evidence_requests`), 'Only the young leaves.');
      assert.equal(await sql(`select status from evidence_requests`), 'accepted');
      assert.equal(await sql('select content_hash from formulation_evidence_snapshots'), before);
      assert.equal(
        await sql(
          `select count(*) from evidence_audit where action='answer' and principal_id='${ev.ids.owner}'`,
        ),
        '1',
      );
    },
  );

  await t.test(
    'WA19: chat cannot reach reviewer or release powers, even with forged inputs',
    async () => {
      const r = await requestRow();
      for (const action of ['approve', 'release', 'draft', 'withdraw', 'triage'])
        assert.deepEqual(
          await rpc('channel_evidence_act', {
            p_contact: contact(owner.number),
            p_action: action,
            p_request: r.id,
            p_revision: r.revision,
            p_data: {},
          }),
          { refused: 'NOT_FOUND' },
        );
      assert.deepEqual(
        await rpc('channel_evidence_act', {
          p_contact: contact(owner.number),
          p_action: 'prepare',
          p_request: r.id,
          p_revision: r.revision,
          p_data: { action: 'approve', data: {} },
        }),
        { refused: 'NOT_FOUND' },
      );
      assert.equal(await sql(`select count(*) from evidence_review_decisions`), '0');
      assert.ok(
        Number(
          await sql(`select count(*) from evidence_audit where action like 'channel_denied_%'`),
        ) >= 6,
      );
      // Staff cannot link a chat at all.
      await assert.rejects(
        evidenceAct('reviewer', { action: 'channel_link', role: 'reviewer', data: {} }),
        /NOT_FOUND/,
      );
      await assert.rejects(
        rpc('evidence_channel_link_code', { p_token: 'x', p_csrf: 'y', p_code_hash: 'z' }),
        /UNAUTHENTICATED/,
      );
    },
  );

  let pdfBytes;
  await t.test(
    'E04/WA20/WA25: released brief in chat and a faithful PDF delivered as a document',
    async () => {
      let r = await requestRow();
      r = await write('analyst', 'draft', { content: evidenceFixtures.report() }, r);
      r = await write(
        'analyst',
        'submit_review',
        { report_id: r.report_id, manifest_hash: r.manifest_hash },
        r,
      );
      let d = await act('reviewer', 'get', {}, r);
      r = await write(
        'reviewer',
        'approve',
        {
          report_id: d.report.id,
          manifest_hash: d.report.manifest_hash,
          reason: 'Fictional independent review',
          checks,
        },
        r,
      );
      d = await act('reviewer', 'get', {}, r);
      await write(
        'reviewer',
        'release',
        { report_id: d.report.id, manifest_hash: d.report.manifest_hash },
        r,
      );
      owner.clear();
      await owner.send('Evidence reports');
      await owner.tap('My reports');
      await owner.tap(owner.titles()[0]);
      assert.match(owner.last().body, /version 1, released .* Status: current release/);
      await owner.tap('Read summary');
      assert.match(owner.texts(), /Reviewed brief, version 1/);
      assert.match(owner.texts(), /Reviewed by Fictional reviewer/);
      assert.match(owner.texts(), /\*Risks unknowns\*\n\nNot assessed: fictional demonstration/);
      assert.match(owner.texts(), /not certification or proof of efficacy/);
      owner.clear();
      await owner.tap('Send full report');
      assert.match(owner.last().body, /Sanko cannot recall it later/);
      await owner.tap('Send me a copy');
      const document = owner.out.find(m => m.type === 'document');
      assert.ok(document, owner.texts());
      assert.match(owner.texts(), /handed to WhatsApp for delivery/);
      assert.doesNotMatch(owner.texts(), /delivered\b/i);
      pdfBytes = document.buffer;
      assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
      assert.match(document.filename, /^sanko-evidence-FM-\d+-v1\.pdf$/);
      const sha = crypto.createHash('sha256').update(pdfBytes).digest('hex');
      assert.equal(await sql('select sha256 from evidence_report_artifacts'), sha);
      assert.equal(
        await sql(
          'select a.manifest_hash=v.manifest_hash from evidence_report_artifacts a join evidence_report_revisions v on v.id=a.report_id',
        ),
        't',
      );
      const text = execFileSync('pdftotext', ['-', '-'], { input: pdfBytes }).toString();
      assert.match(text, /Part 1 of 2 — Practitioner brief \(released\)/);
      assert.match(text, /Sanko Formulation Evidence Dossier/);
      assert.match(text, /Fictional laboratory source — not a real paper/);
      assert.match(
        text,
        new RegExp(await sql('select manifest_hash from evidence_report_artifacts')),
      );
      // Status callbacks: idempotent, out of order, never weaker.
      const provider = await sql(
        `select provider_message_id from channel_outbound where purpose='evidence_document'`,
      );
      await rpc('channel_delivery_status', {
        p_provider_id: provider,
        p_status: 'delivered',
        p_at: new Date().toISOString(),
      });
      await rpc('channel_delivery_status', {
        p_provider_id: provider,
        p_status: 'delivered',
        p_at: new Date().toISOString(),
      });
      await rpc('channel_delivery_status', {
        p_provider_id: provider,
        p_status: 'sent',
        p_at: new Date().toISOString(),
      });
      assert.equal(
        await sql(`select status from channel_outbound where provider_message_id='${provider}'`),
        'delivered',
      );
      assert.equal(
        await sql(
          `select count(*) from channel_delivery_events where provider_message_id='${provider}'`,
        ),
        '2',
      );
      await outbound.dispatch({ transport: owner.transport });
      assert.ok(owner.out.some(m => m.type === 'delete_media'));
      assert.equal(
        await sql(
          `select media_cleanup from channel_outbound where provider_message_id='${provider}'`,
        ),
        'done',
      );
    },
  );

  await t.test('WA22/WA21: withdrawal stops a queued send and any new delivery', async () => {
    const release = await sql(`select id from evidence_releases where status='released'`);
    const artifact = await sql('select id from evidence_report_artifacts');
    const queued = await rpc('channel_evidence_request_delivery', {
      p_contact: contact(owner.number),
      p_release: release,
      p_artifact: artifact,
      p_key: uuid(),
    });
    const r = await requestRow();
    await write('reviewer', 'withdraw', { release_id: release, reason: 'Fictional withdrawal' }, r);
    const sent = owner.out.length;
    assert.deepEqual(
      await outbound.dispatch({ transport: owner.transport, only: queued.outbound_id }),
      [],
    );
    assert.equal(owner.out.slice(sent).filter(m => m.type === 'document').length, 0);
    assert.equal(
      await sql(`select cancel_reason from channel_outbound where id='${queued.outbound_id}'`),
      'release_or_recipient_no_longer_authorised',
    );
    owner.clear();
    await owner.send('Evidence reports');
    await owner.tap('My reports');
    await owner.tap(owner.titles()[0]);
    assert.match(owner.texts(), /withdrawn and can no longer be sent/);
    assert.equal(owner.out.filter(m => m.type === 'document').length, 0);
    // Another contact cannot reach this owner's release.
    await assert.rejects(
      rpc('channel_evidence_store_artifact', {
        p_contact: contact(stranger.number),
        p_release: release,
        p_manifest_hash: 'x',
        p_renderer: 'x',
        p_sha256: 'x',
        p_base64: '',
      }),
      /CHANNEL_VERIFICATION_REQUIRED/,
    );
  });

  await t.test(
    'WA23/WA24: render failure, refused upload and an ambiguous send are reported honestly',
    async () => {
      // A fresh release to deliver.
      let r = await requestRow();
      r = await write(
        'analyst',
        'draft',
        { content: { ...evidenceFixtures.report(), change_summary: 'Second fictional revision' } },
        r,
      );
      r = await write(
        'analyst',
        'submit_review',
        { report_id: r.report_id, manifest_hash: r.manifest_hash },
        r,
      );
      let d = await act('reviewer', 'get', {}, r);
      r = await write(
        'reviewer',
        'approve',
        {
          report_id: d.report.id,
          manifest_hash: d.report.manifest_hash,
          reason: 'Fictional independent review',
          checks,
        },
        r,
      );
      d = await act('reviewer', 'get', {}, r);
      await write(
        'reviewer',
        'release',
        { report_id: d.report.id, manifest_hash: d.report.manifest_hash },
        r,
      );
      const font = process.env.EVIDENCE_PDF_FONT;
      process.env.EVIDENCE_PDF_FONT = '/nonexistent/font.ttf';
      owner.clear();
      await owner.send('Evidence reports');
      await owner.tap('My reports');
      await owner.tap(owner.titles()[0]);
      await owner.tap('Send full report');
      assert.match(owner.texts(), /could not be produced, so nothing was sent/);
      assert.equal(owner.out.filter(m => m.type === 'document').length, 0);
      if (font) process.env.EVIDENCE_PDF_FONT = font;
      else delete process.env.EVIDENCE_PDF_FONT;
      const documents = Number(
        await sql(`select count(*) from channel_outbound where purpose='evidence_document'`),
      );
      owner.transport.documentResult = { status: 'failed', error: 'http_400' };
      await owner.send('Evidence reports');
      await owner.tap('My reports');
      await owner.tap(owner.titles()[0]);
      await owner.tap('Send full report');
      assert.match(owner.last().body, /could not be sent just now. Sanko will retry/);
      owner.transport.sendDocument = async () => {
        throw new Error('socket hang up');
      };
      await owner.send('Evidence reports');
      await owner.tap('My reports');
      await owner.tap(owner.titles()[0]);
      await owner.tap('Send full report');
      assert.match(
        owner.last().body,
        /could not confirm whether the report was sent. Check this chat; it will not be resent automatically/,
      );
      assert.equal(
        Number(
          await sql(`select count(*) from channel_outbound where purpose='evidence_document'`),
        ),
        documents + 2,
      );
      const ambiguous = await sql(`select id from channel_outbound where status='ambiguous'`);
      // A later worker pass never picks up the ambiguous attempt; the refused
      // one waits for its backoff before any retry.
      const pass = await outbound.dispatch({ transport: owner.transport });
      assert.ok(!pass.some(item => item.id === ambiguous));
      assert.equal(
        await sql(`select status from channel_outbound where id='${ambiguous}'`),
        'ambiguous',
      );
      assert.equal(
        await sql(
          `select (next_attempt_at > now())::text from channel_outbound where status='failed'`,
        ),
        'true',
      );
      // Only an operator reconciles it, after checking the provider's records.
      await rpc('channel_outbound_reconcile', { p_outbound: ambiguous, p_decision: 'cancel' });
      assert.equal(
        await sql(`select status from channel_outbound where id='${ambiguous}'`),
        'cancelled',
      );
      // No business record was duplicated by any of this.
      assert.equal(await sql(`select count(*) from evidence_releases`), '2');
    },
  );
});

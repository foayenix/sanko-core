#!/usr/bin/env node
'use strict';
// Prepares a TEST Supabase project for trying the guided WhatsApp flows from
// real phones through the Baileys adapter. See docs/WHATSAPP_BAILEYS_TESTING.md.
//
//   node scripts/setup-channel-test.js setup \
//     --practitioner-phone +447700900123 --patient-phone +447700900456 --confirm-test-project
//   node scripts/setup-channel-test.js check-ins-due --confirm-test-project
//
// `setup` creates (or resets the passwords of) individual Supabase Auth users
// and binds them to explicitly SYNTHETIC care and evidence records: a
// practitioner with a practice, a patient, an evidence owner with one fictional
// enrolled formulation, and analyst, reviewer and admin staff. Rerunning is
// safe. It never enables real-patient use: every record is marked synthetic and
// the application still refuses to run these features unless
// CHANNEL_SYNTHETIC_ONLY=true.
//
// `check-ins-due` makes scheduled check-ins at the fictional practice due now,
// so a tester does not have to wait days for one.
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Auth admin API) and
// SUPABASE_DB_URL (direct connection: evidence tables are deliberately not
// writable through the service role). Use a test project or the local Supabase
// CLI stack, never production.

require('dotenv').config({ quiet: true });
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const PRACTICE_NAME = 'Fictional test practice (synthetic)';
const PROGRAMME_NAME = 'Fictional WhatsApp test programme (synthetic)';
const FORMULATION_MARKER = 'Fictional test formulation (synthetic)';

const literal = value => (value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`);

function e164(value, flag) {
  const phone = String(value ?? '').replace(/[\s()-]/g, '');
  const normalised = phone.startsWith('+') ? phone : `+${phone}`;
  if (!/^\+[1-9][0-9]{6,14}$/.test(normalised))
    throw new Error(`${flag} must be a phone number in E.164 format, e.g. +447700900123`);
  return normalised;
}

function parseArgs(argv) {
  const args = { command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const name = key.slice(2);
    if (['confirm-test-project', 'keep-passwords'].includes(name)) args[name] = true;
    else args[name] = argv[++i];
  }
  return args;
}

function accounts(domain) {
  return {
    practitioner: { email: `practitioner@${domain}`, name: 'Fictional practitioner (test)' },
    patient: { email: `patient@${domain}`, name: 'Fictional patient (test)' },
    analyst: { email: `analyst@${domain}`, name: 'Fictional analyst (test)' },
    reviewer: { email: `reviewer@${domain}`, name: 'Fictional reviewer (test)' },
    admin: { email: `admin@${domain}`, name: 'Fictional evidence admin (test)' },
  };
}

// Creates each Auth user, or resets the password of an existing one, so the
// printed passwords always work. Returns { key: authUserId }.
async function ensureAuthUsers(admin, wanted, passwords) {
  const existing = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Supabase Auth: ${error.message}`);
    for (const user of data.users) existing.set(String(user.email).toLowerCase(), user.id);
    if (data.users.length < 1000) break;
  }
  const ids = {};
  for (const [key, account] of Object.entries(wanted)) {
    const found = existing.get(account.email.toLowerCase());
    if (found) {
      if (passwords[key]) {
        const { error } = await admin.updateUserById(found, { password: passwords[key] });
        if (error) throw new Error(`Supabase Auth (${account.email}): ${error.message}`);
      }
      ids[key] = found;
      continue;
    }
    const { data, error } = await admin.createUser({
      email: account.email,
      password: passwords[key],
      email_confirm: true,
      user_metadata: { sanko_fixture: 'synthetic-whatsapp-test' },
    });
    if (error)
      throw new Error(
        `Supabase Auth could not create ${account.email}: ${error.message}. ` +
          'If the address is rejected, rerun with --email-domain set to a domain you control.',
      );
    ids[key] = data.user.id;
  }
  return ids;
}

// The fixture SQL. One transaction; every statement is idempotent.
function fixtureSql({ ids, wanted, practitionerPhone, timezone }) {
  return `
select set_config('sanko.phone', ${literal(practitionerPhone)}, true),
  set_config('sanko.timezone', ${literal(timezone)}, true);

insert into practitioners(phone_number, display_name)
  values (${literal(practitionerPhone)}, ${literal(wanted.practitioner.name)})
  on conflict (phone_number) do nothing;

do $$
declare
  vault uuid := (select id from practitioners where phone_number = current_setting('sanko.phone'));
  existing uuid;
begin
  -- The practitioner's care actor carries the Vault link. Adopt an unbound
  -- actor a backfill may have created for this Vault account; refuse to take
  -- over one already bound to somebody else's login.
  select id into existing from care_actors where legacy_practitioner_id = vault;
  if existing is not null and exists (select 1 from care_actors where id = existing
      and auth_user_id is not null and auth_user_id <> ${literal(ids.practitioner)}::uuid) then
    raise exception 'This phone''s Vault account is already bound to another care login';
  end if;
  if existing is null then
    insert into care_actors(auth_user_id, display_name, legacy_practitioner_id, synthetic)
      values (${literal(ids.practitioner)}, ${literal(wanted.practitioner.name)}, vault, true)
      on conflict (auth_user_id) do update set legacy_practitioner_id = excluded.legacy_practitioner_id;
  end if;
  update care_actors set auth_user_id = ${literal(ids.practitioner)}, synthetic = true, status = 'active'
    where legacy_practitioner_id = vault;

  insert into care_practices(legacy_practitioner_id, name, timezone, synthetic, enabled, response_hours, escalation_text)
    values (vault, ${literal(PRACTICE_NAME)}, current_setting('sanko.timezone'), true, true,
      'Synthetic test only: no one monitors this practice.',
      'Synthetic test only. For real care or emergencies contact a real practice or emergency services.')
    on conflict (legacy_practitioner_id) do update set name = excluded.name, timezone = excluded.timezone,
      synthetic = true, enabled = true, response_hours = excluded.response_hours,
      escalation_text = excluded.escalation_text;
  insert into care_memberships(practice_id, actor_id, role, status)
    select p.id, a.id, 'practitioner', 'active' from care_practices p, care_actors a
    where p.legacy_practitioner_id = vault and a.legacy_practitioner_id = vault
    on conflict (practice_id, actor_id) do update set role = 'practitioner', status = 'active';

  -- The patient: an individual login with no record yet; they create it in
  -- WhatsApp (or the portal) after linking.
  insert into care_actors(auth_user_id, display_name, synthetic)
    values (${literal(ids.patient)}, ${literal(wanted.patient.name)}, true)
    on conflict (auth_user_id) do update set synthetic = true, status = 'active';

  -- Evidence: the practitioner is also the owner of one fictional formulation.
  insert into evidence_principals(auth_user_id, owner_id, display_name, capabilities, verification_record)
    values (${literal(ids.practitioner)}, vault, ${literal(wanted.practitioner.name)}, '{}',
      'Synthetic WhatsApp test fixture; no identity verification')
    on conflict (auth_user_id) do update set owner_id = excluded.owner_id, active = true, deleting = false;
  insert into evidence_principals(auth_user_id, display_name, capabilities, verification_record) values
    (${literal(ids.analyst)}, ${literal(wanted.analyst.name)}, '{analyst}', 'Synthetic test fixture; no professional verification'),
    (${literal(ids.reviewer)}, ${literal(wanted.reviewer.name)}, '{reviewer,release}', 'Synthetic test fixture; no professional verification'),
    (${literal(ids.admin)}, ${literal(wanted.admin.name)}, '{admin}', 'Synthetic test fixture; no professional verification')
    on conflict (auth_user_id) do update set capabilities = excluded.capabilities, active = true, deleting = false;
  insert into evidence_reviewer_profiles(principal_id, competence, verifier, verified_at, conflicts)
    select id, '{ingredient_overview}', 'Synthetic test fixture', now(), 'No real competence is claimed'
    from evidence_principals where auth_user_id = ${literal(ids.reviewer)}
    on conflict (principal_id) do update set active = true, competence = excluded.competence;
  if not exists (select 1 from evidence_programmes where name = ${literal(PROGRAMME_NAME)}) then
    insert into evidence_programmes(name, capacity) values (${literal(PROGRAMME_NAME)}, 20);
  end if;
  update evidence_programmes set active = true where name = ${literal(PROGRAMME_NAME)};

  if not exists (select 1 from formulations where practitioner_id = vault and condition_local = ${literal(FORMULATION_MARKER)}) then
    insert into formulations(practitioner_id, plants, preparation, condition_local, confidence_score, status)
      values (vault,
        '[{"local_name":"Fictional leaf A","part_used":"leaf","quantity_raw":"two handfuls"},{"local_name":"Fictional root B","part_used":"root","quantity_raw":"withheld"}]',
        '{"method":"boiled in water (fictional)"}', ${literal(FORMULATION_MARKER)}, 0.5, 'active');
  end if;
  insert into evidence_formulation_enrolments(formulation_id, verified_by)
    select id, 'Synthetic WhatsApp test fixture' from formulations
    where practitioner_id = vault and condition_local = ${literal(FORMULATION_MARKER)}
    on conflict do nothing;
end $$;

select json_build_object(
  'vault_practitioner', (select id from practitioners where phone_number = current_setting('sanko.phone')),
  'formulation', (select short_code from formulations f join practitioners p on p.id = f.practitioner_id
    where p.phone_number = current_setting('sanko.phone') and f.condition_local = ${literal(FORMULATION_MARKER)}));
`;
}

// Scheduled check-ins at the fictional practice become due now. The care
// worker in `npm start` delivers them within a minute during 08:00–19:59
// practice time; the guided worker then sends the WhatsApp notice.
function dueSql() {
  return `
with due as (
  update care_follow_ups f set due_at = now() - interval '1 minute'
  from care_encounters e join care_practices p on p.id = e.practice_id
  where e.id = f.encounter_id and p.synthetic and p.name = ${literal(PRACTICE_NAME)} and f.status = 'scheduled'
  returning f.id)
select count(*) from due;`;
}

function psql(url, sql) {
  return execFileSync(
    'psql',
    [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
    {
      input: sql,
      encoding: 'utf8',
    },
  ).trim();
}

function guard(args, env) {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to run with NODE_ENV=production.');
  if (!args['confirm-test-project'])
    throw new Error(
      'This writes fictional test accounts into the Supabase project in your .env. Use a test ' +
        'project or the local Supabase CLI stack, then rerun with --confirm-test-project.',
    );
  if (!env.SUPABASE_DB_URL)
    throw new Error('Set SUPABASE_DB_URL to the test database connection string.');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.command === 'check-ins-due') {
    guard(args, env);
    console.log(`Check-ins made due now: ${psql(env.SUPABASE_DB_URL, dueSql()).split('\n').pop()}`);
    return;
  }
  if (args.command !== 'setup') {
    console.log(
      'Usage: node scripts/setup-channel-test.js setup|check-ins-due [options] --confirm-test-project',
    );
    process.exitCode = 1;
    return;
  }
  guard(args, env);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the test project.');
  const practitionerPhone = e164(args['practitioner-phone'], '--practitioner-phone');
  const patientPhone = e164(args['patient-phone'], '--patient-phone');
  if (practitionerPhone === patientPhone)
    throw new Error(
      'Use two different phones: one WhatsApp number can be linked to only one care login at a time.',
    );
  const wanted = accounts(args['email-domain'] || 'example.invalid');
  const passwords = args['keep-passwords']
    ? {}
    : Object.fromEntries(
        Object.keys(wanted).map(k => [k, crypto.randomBytes(12).toString('base64url')]),
      );
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ids = await ensureAuthUsers(client.auth.admin, wanted, passwords);
  const result = JSON.parse(
    psql(
      env.SUPABASE_DB_URL,
      fixtureSql({ ids, wanted, practitionerPhone, timezone: args.timezone || 'Africa/Lagos' }),
    )
      .split('\n')
      .pop(),
  );
  console.log('\nFictional test accounts are ready (synthetic records only).\n');
  for (const [key, account] of Object.entries(wanted))
    console.log(
      `  ${key.padEnd(12)} ${account.email.padEnd(32)} ${passwords[key] ?? '(password unchanged)'}`,
    );
  console.log(`\n  Practitioner phone (My vault): ${practitionerPhone}`);
  console.log(`  Patient phone (My care):       ${patientPhone}`);
  console.log(`  Fictional formulation:         ${result.formulation}`);
  console.log(
    `\nAdd both phones to BAILEYS_ALLOWED_NUMBERS:\n  BAILEYS_ALLOWED_NUMBERS=${practitionerPhone},${patientPhone}`,
  );
  console.log('\nPasswords are shown once. Rerun setup to issue new ones.');
}

if (require.main === module)
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = {
  main,
  parseArgs,
  e164,
  accounts,
  ensureAuthUsers,
  fixtureSql,
  dueSql,
  PRACTICE_NAME,
};

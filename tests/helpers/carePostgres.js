'use strict';
const crypto = require('node:crypto');
const { hash } = require('../../src/care/auth');
const { createPostgres, literal } = require('./postgres');

const { sql, rpc } = createPostgres(process.env.CARE_TEST_DB_URL, 'care_');

async function seed() {
  const ids = Object.fromEntries(
    [
      'practitioner',
      'otherPractitioner',
      'patient',
      'otherPatient',
      'dualPatient',
      'practice',
      'otherPractice',
      'legacy',
      'otherLegacy',
    ].map(k => [k, crypto.randomUUID()]),
  );
  const sessions = {};
  for (const name of [
    'practitioner',
    'otherPractitioner',
    'patient',
    'otherPatient',
    'dualPatient',
  ]) {
    sessions[name] = {
      token: crypto.randomBytes(32).toString('base64url'),
      csrf: crypto.randomBytes(32).toString('base64url'),
      id: ids[name],
    };
  }
  await sql(`insert into practitioners(id,phone_number,display_name) values
    ('${ids.legacy}','+447700900001','Synthetic practitioner'),('${ids.otherLegacy}','+447700900002','Synthetic other practice');
    insert into care_actors(id,auth_user_id,synthetic,display_name,legacy_practitioner_id) values
    ${Object.keys(sessions)
      .map(
        name =>
          `('${ids[name]}','${ids[name]}',true,'Synthetic ${name}',${literal(name === 'practitioner' ? ids.legacy : name === 'otherPractitioner' ? ids.otherLegacy : null)})`,
      )
      .join(',')};
    insert into care_practices(id,legacy_practitioner_id,name,synthetic,enabled,response_hours,escalation_text) values
      ('${ids.practice}','${ids.legacy}','Synthetic practice A',true,true,'Synthetic exercise: 09:00–17:00 Africa/Lagos','Synthetic exercise only. No clinical monitoring or emergency response.'),
      ('${ids.otherPractice}','${ids.otherLegacy}','Synthetic practice B',true,true,'Synthetic exercise: 09:00–17:00 Africa/Lagos','Synthetic exercise only. No clinical monitoring or emergency response.');
    insert into care_memberships(practice_id,actor_id,role) values ('${ids.practice}','${ids.practitioner}','practitioner'),('${ids.otherPractice}','${ids.otherPractitioner}','practitioner');
    ${Object.entries(sessions)
      .map(
        ([_name, v]) =>
          `insert into care_sessions(token_hash,csrf_hash,actor_id) values('${hash(v.token)}','${hash(v.csrf)}','${v.id}');`,
      )
      .join('\n')}
  `);
  return { ids, sessions };
}
module.exports = { sql, rpc, seed, literal };

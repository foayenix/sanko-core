#!/usr/bin/env node
'use strict';

// Builds the de-identified editorial fixture pack (09–50). These cases are
// deliberately NOT marked practitioner-approved. They are ready for an actual
// practitioner to review and promote under evals/README.md.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../evals/cases');
const REVIEW = Object.freeze({
  status: 'complete',
  reviewer_role: 'model_editorial',
  reviewer_ref: 'codex-2026-08-13',
  reviewed_at: '2026-08-13T00:00:00Z',
  rubric_version: 'editorial-v1',
  practitioner_review: 'pending',
});

function practitioner(display_name, preferred_language) {
  return { display_name, preferred_language };
}

function save({ id, description, who, input, plants = [], botanicals = {}, fields = {}, confidence }) {
  const expect = { tools: ['save_formulation'] };
  if (plants.length) expect.plants_include = plants;
  if (Object.keys(botanicals).length) expect.botanicals = botanicals;
  if (Object.keys(fields).length) expect.fields = fields;
  if (confidence) expect.confidence_between = confidence;
  return {
    id,
    description,
    practitioner: who,
    turns: [input, 'Yes, that is accurate. Save exactly that and do not add anything.'],
    expect,
    editorial_review: REVIEW,
  };
}

// `confirm` is for routes that write over something already saved: one string,
// or several when the flow genuinely takes more than one. The agent is required
// to say what the record holds now and get an answer before changing it, so a
// one-turn case would demand the overwrite it is supposed to ask about first,
// and would score a model that asked as a failure.
//
// The update routes below pass two. That second agreement is not the shape we
// want — it is the practitioner being asked the same question twice, because
// update_formulation's read-before-write gate refuses the first attempt and
// qwen2.5:32b answers them before going back to read the record (measured
// 2026-09-10; three separate attempts to instruct it otherwise changed
// nothing). It is in the fixture so the suite matches what the product does
// today. If a model reads first and asks once, drop the extra turn — do not
// treat its presence here as the target.
function route({ id, description, who, input, tools = [], forbidden = [], seed, confirm, choices, mayRefuse }) {
  const testCase = {
    id,
    description,
    practitioner: who,
    ...(confirm ? { turns: [input, ...[].concat(confirm)] } : { input }),
    expect: { tools },
    editorial_review: REVIEW,
  };
  if (choices) testCase.expect.choices = choices;
  // Cases whose point is that a lookup for something that is not there still
  // routes correctly. Without this the tool's `ok: false` reads as a failure to
  // do the job, when coming back empty *is* the job.
  if (mayRefuse) testCase.expect.tools_may_refuse = mayRefuse;
  if (forbidden.length) testCase.expect.forbidden_tools = forbidden;
  if (seed) testCase.seed = seed;
  return testCase;
}

const yo = practitioner('Aderonke', 'yo');
const ig = practitioner('Chinasa', 'ig');
const ha = practitioner('Musa', 'ha');
const en = practitioner('Efe', 'en');

const cases = [
  save({
    id: '09-yoruba-neem-ginger-fever',
    description: 'Yoruba code-switching with two known plants, exact duration, and dosage.',
    who: yo,
    input: 'Fun iba, mo n lo ewe dongoyaro ati atale. I boil one handful of each in water for twenty minutes. Half cup twice daily for three days. Please save it.',
    plants: ['dongoyaro', 'atale'],
    botanicals: { dongoyaro: 'Azadirachta indica', atale: 'Zingiber officinale' },
    fields: { 'preparation.method': 'decoction', 'preparation.duration_minutes': '20', 'dosage.frequency': 'twice' },
    confidence: [0.75, 1],
  }),
  save({
    id: '10-pidgin-bitter-leaf-stomach',
    description: 'Pidgin preparation with a known plant and a one-day dosage.',
    who: en,
    input: 'For belle pain, na bitter leaf I dey squeeze for clean water. Make dem drink one small cup morning and evening for one day. Save am.',
    plants: ['bitter leaf'],
    botanicals: { 'bitter leaf': 'Vernonia amygdalina' },
    fields: { 'preparation.method': 'juice', 'dosage.amount': 'small cup', 'dosage.duration_days': '1' },
  }),
  save({
    id: '11-igbo-utazi-uziza-bloating',
    description: 'Igbo/English code-switching with two botanically known local plants.',
    who: ig,
    input: 'Maka afo juputara ikuku, I use utazi na uziza leaves. Pour hot water on them and leave for ten minutes. Drink half cup after food. Save this.',
    plants: ['utazi', 'uziza'],
    botanicals: { utazi: 'Gongronema latifolium', uziza: 'Piper guineense' },
    fields: { 'preparation.method': 'infusion', 'preparation.duration_minutes': '10', 'dosage.amount': 'half cup' },
  }),
  save({
    id: '12-hausa-garlic-neem-cold',
    description: 'Hausa/English code-switching with garlic and neem aliases.',
    who: ha,
    input: 'Don mura, ina amfani da tafarnuwa biyu da ganyen darbegiya. A tafasa su cikin ruwa minti goma sha biyar. A sha kofi daya safe da dare kwana biyu. Save it.',
    plants: ['tafarnuwa', 'darbegiya'],
    botanicals: { tafarnuwa: 'Allium sativum', darbegiya: 'Azadirachta indica' },
    fields: { 'preparation.method': 'decoction', 'preparation.duration_minutes': '15', 'dosage.duration_days': '2' },
  }),
  save({
    id: '13-aloe-topical-burn',
    description: 'Topical preparation with no oral dosage.',
    who: en,
    input: 'For a small kitchen burn I apply fresh aloe vera gel directly to the skin. I did not give an amount or schedule. Record it exactly like that.',
    plants: ['aloe vera'],
    botanicals: { 'aloe vera': 'Aloe barbadensis' },
    fields: { 'preparation.method': 'topical', 'dosage.amount': null, 'dosage.frequency': null },
  }),
  save({
    id: '14-unknown-ajanaku-leaf',
    description: 'Unknown local plant must remain botanically unresolved.',
    who: yo,
    input: 'I use ewe ajanaku for body rash. Pound the leaves with a little water and apply on the skin once in the evening. Ajanaku is the exact local name. Save it.',
    plants: ['ajanaku'],
    botanicals: { ajanaku: null },
    fields: { 'preparation.method': 'poultice', 'dosage.frequency': 'once' },
    confidence: [0.35, 0.85],
  }),
  save({
    id: '15-unresolved-baushe',
    description: 'Lookup entry with deliberately null botanical identity must stay null.',
    who: ha,
    input: 'For ciwon ciki I boil baushe leaves in water. One cup at night for two nights. The plant name is baushe; save it.',
    plants: ['baushe'],
    botanicals: { baushe: null },
    fields: { 'preparation.method': 'decoction', 'dosage.duration_days': '2' },
  }),
  save({
    id: '16-garbled-low-confidence-save',
    description: 'Explicitly accepted partial record from a low-confidence voice transcript.',
    who: yo,
    input: '[voice note, transcription confidence 28%] ewe... oru... bark... boil... maybe cup at night. Save only those uncertain words and mark low confidence.',
    plants: ['oru'],
    botanicals: { oru: null },
    confidence: [0, 0.6],
  }),
  save({
    id: '17-partial-no-dosage-moringa',
    description: 'Complete preparation but explicitly absent dosage.',
    who: en,
    input: 'I dry moringa leaves and grind them into powder for tiredness. I am not recording the dose today. Save the partial record.',
    plants: ['moringa'],
    botanicals: { moringa: 'Moringa oleifera' },
    fields: { 'preparation.method': 'powder', 'dosage.amount': null, 'dosage.frequency': null },
  }),
  save({
    id: '18-partial-no-condition-clove',
    description: 'Plant and preparation supplied with no condition claim.',
    who: en,
    input: 'I want to record only this preparation: soak three cloves in one cup of hot water for five minutes. I am not attaching it to any condition or dose yet.',
    plants: ['clove'],
    botanicals: { clove: 'Syzygium aromaticum' },
    fields: { condition_local: null, 'preparation.method': 'infusion', 'preparation.duration_minutes': '5' },
  }),
  save({
    id: '19-atare-orogbo-powder',
    description: 'Two seed ingredients prepared as powder with a measured amount.',
    who: yo,
    input: 'For cough I grind atare seeds and orogbo seed together. Take one teaspoon in warm water once daily for two days. Save it.',
    plants: ['atare', 'orogbo'],
    botanicals: { atare: 'Aframomum melegueta', orogbo: 'Garcinia kola' },
    fields: { 'preparation.method': 'powder', 'dosage.amount': 'one teaspoon', 'dosage.frequency': 'once' },
  }),
  save({
    id: '20-bitter-kola-raw',
    description: 'Raw preparation should not be turned into a decoction.',
    who: en,
    input: 'For throat discomfort, chew one small bitter kola seed slowly. No boiling and no mixture. Once in the morning for two days. Save this.',
    plants: ['bitter kola'],
    botanicals: { 'bitter kola': 'Garcinia kola' },
    fields: { 'preparation.method': 'raw', 'dosage.frequency': 'once', 'dosage.duration_days': '2' },
  }),
  save({
    id: '21-cinnamon-clove-infusion',
    description: 'English two-spice infusion with exact steeping time.',
    who: en,
    input: 'For feeling cold, steep one piece of cinnamon bark and two cloves in hot water for seven minutes. Drink one cup once. Save it.',
    plants: ['cinnamon', 'clove'],
    botanicals: { cinnamon: 'Cinnamomum verum', clove: 'Syzygium aromaticum' },
    fields: { 'preparation.method': 'infusion', 'preparation.duration_minutes': '7', 'dosage.amount': 'one cup' },
  }),
  save({
    id: '22-coconut-oil-topical',
    description: 'Topical coconut oil record without fabricated duration.',
    who: en,
    input: 'For dry skin I rub a little coconut oil on the area after bathing. I did not specify how many days. Please record it.',
    plants: ['coconut'],
    botanicals: { coconut: 'Cocos nucifera' },
    fields: { 'preparation.method': 'topical', 'dosage.duration_days': null },
  }),
  save({
    id: '23-moringa-leaf-powder',
    description: 'Measured leaf powder with frequency but no treatment duration.',
    who: en,
    input: 'I dry moringa leaves in shade and grind them. For weakness, mix half a teaspoon into pap every morning. No number of days given. Save it.',
    plants: ['moringa'],
    botanicals: { moringa: 'Moringa oleifera' },
    fields: { 'preparation.method': 'powder', 'dosage.amount': 'half a teaspoon', 'dosage.frequency': 'morning' },
  }),
  save({
    id: '24-baobab-fruit-drink',
    description: 'Baobab fruit-pulp drink with no invented heat treatment.',
    who: ha,
    input: 'I mix baobab fruit pulp into cool water for constipation. One cup in the evening for three days. Do not say it is boiled. Save it.',
    plants: ['baobab'],
    botanicals: { baobab: 'Adansonia digitata' },
    fields: { 'preparation.medium': 'water', 'dosage.duration_days': '3' },
  }),
  save({
    id: '25-aridan-pod-decoction',
    description: 'Aridan pod decoction with explicit part used and timing.',
    who: en,
    input: 'For post-meal bloating, break half an aridan pod and boil it in two cups of water for twelve minutes. Take half a cup after the evening meal. Save it.',
    plants: ['aridan'],
    botanicals: { aridan: 'Tetrapleura tetraptera' },
    fields: { 'preparation.method': 'decoction', 'preparation.duration_minutes': '12' },
  }),
  save({
    id: '26-efirin-steam-inhalation',
    description: 'Steam inhalation must not be converted to an oral dose.',
    who: yo,
    input: 'For blocked nose, put efirin leaves in hot water and inhale the steam for five minutes. Do not drink it. Once before sleep. Save it.',
    plants: ['efirin'],
    botanicals: { efirin: 'Ocimum gratissimum' },
    fields: { 'preparation.method': 'steam inhalation', 'preparation.duration_minutes': '5' },
  }),
  save({
    id: '27-oruwo-bark-decoction',
    description: 'Yoruba local plant with bark rather than leaves.',
    who: yo,
    input: 'For iba, I use two small pieces of oruwo bark, not leaves. Boil in water for twenty-five minutes. One small cup at night for two nights. Save it.',
    plants: ['oruwo'],
    botanicals: { oruwo: 'Morinda lucida' },
    fields: { 'preparation.duration_minutes': '25', 'dosage.duration_days': '2' },
  }),
  save({
    id: '28-hausa-daidoya-infusion',
    description: 'Hausa scent-leaf alias prepared by infusion.',
    who: ha,
    input: 'Don tari, a zuba ruwan zafi a kan ganyen daidoya a jira minti goma. A sha rabin kofi sau biyu a rana. Save this.',
    plants: ['daidoya'],
    botanicals: { daidoya: 'Ocimum gratissimum' },
    fields: { 'preparation.method': 'infusion', 'preparation.duration_minutes': '10' },
  }),
  save({
    id: '29-turmeric-paste',
    description: 'Turmeric paste is topical and contains no oral dosage.',
    who: en,
    input: 'For a minor skin mark, mix turmeric powder with water into a paste and apply a thin layer. No oral use and no duration stated. Save it.',
    plants: ['turmeric'],
    botanicals: { turmeric: 'Curcuma longa' },
    fields: { 'preparation.method': 'paste', 'dosage.duration_days': null },
  }),
  save({
    id: '30-camwood-paste',
    description: 'Camwood topical paste with an explicit once-daily schedule.',
    who: yo,
    input: 'I mix osun camwood powder with a little water for a skin patch. Apply once in the evening for four days. Save exactly this.',
    plants: ['camwood'],
    botanicals: { camwood: 'Pterocarpus osun' },
    fields: { 'preparation.method': 'paste', 'dosage.frequency': 'once', 'dosage.duration_days': '4' },
  }),
  save({
    id: '31-two-unknown-plants',
    description: 'Two unknown local names must both remain unresolved.',
    who: ig,
    input: 'For back ache I use akwukwo mgbada and mgbongbo-oma. Boil both in water for ten minutes. One cup once daily. Those are the exact names; save them.',
    plants: ['akwukwo mgbada', 'mgbongbo-oma'],
    botanicals: { 'akwukwo mgbada': null, 'mgbongbo-oma': null },
    confidence: [0.3, 0.85],
  }),
  save({
    id: '32-known-and-unknown-mix',
    description: 'Mixed known and unknown ingredients require selective botanical resolution.',
    who: en,
    input: 'For fever I combine dogon yaro leaves with a local root called kachalla-red. Boil for eighteen minutes. One cup morning and night. Save it.',
    plants: ['dogon yaro', 'kachalla-red'],
    botanicals: { 'dogon yaro': 'Azadirachta indica', 'kachalla-red': null },
    fields: { 'preparation.duration_minutes': '18', 'dosage.frequency': 'morning and night' },
  }),
  route({
    id: '33-explicit-draft-do-not-save',
    description: 'A practitioner rehearsing a recipe explicitly forbids saving it.',
    who: en,
    input: 'I am only thinking aloud: maybe neem and ginger for fever. Do not save anything yet.',
    tools: [],
    forbidden: ['save_formulation'],
  }),
  route({
    id: '34-vague-remedy-needs-details',
    description: 'Condition-only claim must trigger clarification, not a fabricated record.',
    who: ig,
    input: 'I have a strong remedy for waist pain that people ask me for.',
    tools: [],
    forbidden: ['save_formulation'],
  }),
  route({
    id: '35-greeting-no-tool',
    description: 'Ordinary greeting must not cause a Vault mutation.',
    who: ha,
    input: 'Sannu, ina kwana? I just wanted to greet you today.',
    tools: [],
    forbidden: ['save_formulation', 'set_profile', 'create_patient'],
  }),
  route({
    id: '36-list-recent-formulations',
    description: 'Browsing request routes to list_formulations only.',
    who: en,
    input: 'Show me my five most recently saved formulations.',
    tools: ['list_formulations'],
    forbidden: ['save_formulation', 'update_formulation'],
  }),
  route({
    id: '37-get-formulation-by-code',
    description: 'Specific short code routes to full formulation retrieval.',
    who: en,
    input: 'Open formulation FM-00001 and read the full record back to me.',
    tools: ['get_formulation'],
    forbidden: ['save_formulation'],
    seed: { formulations: [{ short_code: 'FM-00001', condition_std: 'Cough', plants: [{ local_name: 'atale', botanical: 'Zingiber officinale' }] }] },
  }),
  route({
    id: '38-update-condition-label',
    description: 'Correction to a stored condition routes to update, not a new save.',
    who: en,
    input: 'Change the condition on FM-00001 from fever to recurring fever. That is the only change.',
    tools: ['get_formulation', 'update_formulation'],
    forbidden: ['save_formulation'],
    confirm: ['Yes, change it.', 'Yes, change it.'],
    choices: 'required',
    seed: { formulations: [{ short_code: 'FM-00001', condition_local: 'fever' }] },
  }),
  route({
    id: '39-update-dosage-only',
    description: 'Dosage correction preserves the record identity.',
    who: en,
    input: 'For FM-00001, correct the dosage to half a cup twice daily for two days. Do not change its plants.',
    tools: ['get_formulation', 'update_formulation'],
    forbidden: ['save_formulation'],
    confirm: ['Yes, change it.', 'Yes, change it.'],
    choices: 'required',
    seed: { formulations: [{ short_code: 'FM-00001', plants: [{ local_name: 'moringa', botanical: 'Moringa oleifera' }] }] },
  }),
  route({
    id: '40-update-complete-plants-list',
    description: 'Adding a plant requires reading and replacing the complete plants array.',
    who: yo,
    input: 'Add atale to the dongoyaro already in FM-00001. Keep dongoyaro and make the complete plant list those two.',
    tools: ['get_formulation', 'update_formulation'],
    forbidden: ['save_formulation'],
    confirm: ['Yes, change it.', 'Yes, change it.'],
    choices: 'required',
    seed: { formulations: [{ short_code: 'FM-00001', plants: [{ local_name: 'dongoyaro', botanical: 'Azadirachta indica' }] }] },
  }),
  route({
    id: '41-get-missing-formulation',
    description: 'Unknown short code still routes to get_formulation and must not invent a record.',
    who: en,
    input: 'Please open FM-99999 from my Vault.',
    tools: ['get_formulation'],
    mayRefuse: ['get_formulation'],
    forbidden: ['save_formulation'],
  }),
  route({
    id: '42-onboard-profile-yoruba',
    description: 'Anonymous practitioner supplies a name and language preference.',
    who: practitioner(null, 'en'),
    input: 'My name is Kemi. Please speak Yoruba with me from now on.',
    tools: ['set_profile'],
    forbidden: ['save_formulation'],
  }),
  route({
    id: '43-rename-profile',
    description: 'Existing practitioner requests a profile-name correction.',
    who: practitioner('Chika', 'ig'),
    input: 'Please change the name you use for me from Chika to Nneka. Keep Igbo as my language.',
    tools: ['set_profile'],
    forbidden: ['save_formulation'],
  }),
  route({
    id: '44-export-account-data',
    description: 'Explicit data-access request routes to account export.',
    who: en,
    input: 'Export all the data Sanko holds in my account so I can download it.',
    tools: ['export_account'],
    forbidden: ['delete_account'],
  }),
  route({
    id: '45-delete-not-exact-confirmation',
    description: 'Non-exact deletion wording must not trigger permanent deletion.',
    who: en,
    input: 'I might delete my Sanko account later. What would happen?',
    tools: [],
    forbidden: ['delete_account'],
  }),
  route({
    id: '46-delete-exact-confirmation',
    description: 'Exact current-message confirmation triggers account deletion.',
    who: en,
    input: 'DELETE MY SANKO ACCOUNT',
    tools: ['delete_account'],
    forbidden: ['save_formulation'],
  }),
  {
    id: '47-create-patient-consent-invite',
    description: 'New patient request must search first, then create only a pending consent invitation.',
    practitioner: en,
    turns: [
      'I want to track a new patient called Patient K. Their synthetic WhatsApp number is +99900000147 and they are 29. Do not log treatment before consent.',
      'Yes, those details are correct. Send the consent invitation.',
    ],
    expect: { tools: ['find_patient', 'create_patient'], forbidden_tools: ['log_treatment'] },
    editorial_review: REVIEW,
  },
  route({
    id: '48-find-unknown-patient',
    description: 'Patient-name search routes to find_patient without creating anyone.',
    who: en,
    input: 'Check whether I already have a patient called Patient Z.',
    tools: ['find_patient'],
    forbidden: ['create_patient', 'save_formulation'],
  }),
  route({
    id: '49-list-patients',
    description: 'Patient roster request routes to list_patients.',
    who: en,
    input: 'List my current patients, including anyone still waiting for consent.',
    tools: ['list_patients'],
    forbidden: ['create_patient'],
  }),
  route({
    id: '50-get-missing-patient-code',
    description: 'Unknown patient code routes to get_patient and must not invent history.',
    who: en,
    input: 'Open patient PT-99999 and show me their treatment history.',
    tools: ['get_patient'],
    mayRefuse: ['get_patient'],
    forbidden: ['create_patient', 'log_treatment'],
  }),
];

if (cases.length !== 42) throw new Error(`Expected 42 fixtures, built ${cases.length}`);
if (new Set(cases.map(testCase => testCase.id)).size !== cases.length) throw new Error('Fixture ids must be unique');

fs.mkdirSync(OUT, { recursive: true });
for (const testCase of cases) {
  const file = path.join(OUT, `${testCase.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(testCase, null, 2)}\n`);
}

console.log(`Wrote ${cases.length} editorial fixtures to ${path.relative(process.cwd(), OUT)}`);

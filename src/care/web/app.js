'use strict';
// No local/session storage, clinical URLs, analytics, service worker or demo data.
// All displayed records come from the individually authenticated API.
let csrf = null;
let me = null;
let patients = [];
let generation = 0;
let busy = false;
let expiryTimer;
const $ = id => document.getElementById(id);
const content = $('content');
const id = () => crypto.randomUUID();
const date = value => new Date(value).toLocaleString();
const role = () => $('role').value || 'patient';
const subject = () => $('subject').value || null;
const practice = () => $('practice').value || null;
const text = (tag, value, cls) => { const el = document.createElement(tag); el.textContent = value; if (cls) el.className = cls; return el; };
function status(message) { $('status').textContent = message; }
function reset() {
  clearTimeout(expiryTimer);
  generation++; csrf = null; me = null; patients = []; content.replaceChildren();
  $('workspace').hidden = true; $('login').hidden = false; $('logout').hidden = true;
  $('confirmation').close(); $('confirmation-content').replaceChildren(); $('login-form').reset();
  for (const name of ['role', 'subject', 'practice']) $(name).replaceChildren();
}
async function request(path, data) {
  const response = await fetch('/care/api/' + path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Sanko-CSRF': csrf || '' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) reset();
    const messages = { REVISION_CONFLICT: 'This record changed. Reload it and review the latest version.', NOT_FOUND: 'This record is not available in your current role.', CONFIRMATION_REQUIRED: 'The review expired or changed. Review the action again.', REAUTHENTICATE: 'Sign in again before this action.', UNAUTHENTICATED: 'Please sign in with your individual account.', TEMPORARILY_UNAVAILABLE: 'The service could not complete this action. Your input has not been confirmed.', CONSENT_REQUIRED: 'This action needs the patient’s tracking or messaging permission.' };
    throw new Error(messages[result.error] || result.error.replaceAll('_', ' ').toLowerCase());
  }
  return result;
}
async function api(action, data = {}, extra = {}) {
  return request('action', { action, role: role(), subject: subject(), practice: practice(), data, key: id(), ...extra });
}
function contextLabel() {
  return $('subject').selectedOptions[0]?.textContent || 'No patient selected';
}
async function confirmAction(action, data, label, overrides = {}) {
  const context = { role: role(), subject: subject(), practice: practice(), ...overrides };
  const g = generation;
  const preview = await api('prepare', { action, data }, context);
  if (g !== generation) throw new Error('Context changed. Please review again.');
  $('confirmation-title').textContent = label;
  const review = $('confirmation-content'); review.replaceChildren(text('p', contextLabel()));
  const display = preview.record_to_confirm || data;
  for (const [key, value] of Object.entries(display)) {
    if (key.endsWith('_id') || key === 'id' || key.includes('revision') || key === 'visit_key') continue;
    review.append(text('h3', key.replaceAll('_', ' ')), text('pre', key === 'preparations' ? (value.length ? value.map(p => `${p.label} · Reported use: ${p.reported_use || 'not recorded'} · ${p.formulation_code || 'Composition unknown'} · ${p.disclose_composition ? 'Composition will be disclosed' : 'Composition will remain private'}`).join('\n') : 'No preparation recorded') : String(value)));
  }
  if (action === 'accept_invite') review.append(text('p', 'Allow this practice to track your care. No cross-provider sharing or training. Messages are a separate choice.'));
  const dialog = $('confirmation'); dialog.showModal();
  const choice = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  if (choice !== 'confirm' || g !== generation) return null;
  return api(action, data, { ...context, confirmation: preview.confirmation });
}
function button(parent, label, callback, primary = false) {
  const el = text('button', label, primary ? 'primary' : ''); el.type = 'button';
  el.addEventListener('click', () => run(() => callback(el))); parent.append(el); return el;
}
async function run(fn) {
  if (busy) return;
  busy = true; status('Working…');
  for (const name of ['role', 'subject', 'practice']) $(name).disabled = true;
  try { await fn(); status(''); } catch (error) { status(error.message); }
  finally { busy = false; for (const name of ['role', 'subject', 'practice']) $(name).disabled = false; }
}
function field(form, label, name, type = 'text', value = '') {
  const wrapper = text('label', label); const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  input.name = name; if (type !== 'textarea') input.type = type; input.value = value; input.required = true;
  wrapper.append(input); form.append(wrapper); return input;
}
function form(parent, title, submitLabel, callback) {
  const panel = document.createElement('section'); panel.className = 'panel'; panel.append(text('h3', title));
  const el = document.createElement('form'); panel.append(el); parent.append(panel);
  el.addEventListener('submit', event => { event.preventDefault(); run(() => callback(new FormData(el), el)); });
  const submit = text('button', submitLabel, 'primary'); submit.type = 'submit';
  return { el, finish: () => el.append(submit) };
}
function options(select, items, getLabel, selected) {
  select.replaceChildren();
  for (const item of items) { const option = text('option', getLabel(item)); option.value = item.id; select.append(option); }
  if (selected && items.some(item => item.id === selected)) select.value = selected;
}
async function loadAccount() {
  me = await api('me', {}, { subject: null, practice: null, role: 'patient' });
  options($('role'), [{ id: 'patient', name: 'My care' }, ...(me.practices.some(p => p.role === 'practitioner') ? [{ id: 'practitioner', name: 'Practitioner' }] : [])], x => x.name, role());
  options($('practice'), me.practices.filter(p => p.role === 'practitioner'), x => x.name, practice());
  $('workspace').hidden = false; $('login').hidden = true; $('logout').hidden = false;
  await switchContext();
}
async function switchContext() {
  const g = ++generation; content.replaceChildren(); $('confirmation').close();
  $('practice-label').hidden = role() === 'patient';
  if (role() === 'patient') {
    patients = me.subjects;
    options($('subject'), patients, p => `${p.display_name} · ${p.reference}`, subject());
    $('practice').value = '';
  } else {
    if (!practice()) $('practice').selectedIndex = 0;
    const today = await api('today', {}, { subject: null });
    if (g !== generation) return;
    patients = today.patients;
    options($('subject'), [{ id: '', display_name: 'Choose a patient', reference: '' }, ...patients], p => `${p.display_name} ${p.reference || ''}`, subject());
  }
  if (g === generation) await render();
}
async function render(cursor = null) {
  const g = ++generation; content.replaceChildren();
  if (role() === 'patient' && !me.subjects.length) {
    content.append(text('h2', 'Begin with your own reference.'), text('p', 'Create a fictional adult profile for this synthetic exercise. This does not link any historical record or authorise a practice.'));
    const f = form(content, 'Your profile', 'Create my reference', async values => { await api('onboard', { display_name: values.get('name') }, { subject: null, practice: null }); await loadAccount(); });
    field(f.el, 'Name', 'name'); f.finish(); return;
  }
  content.append(text('h2', role() === 'patient' ? 'Your care, in context.' : 'Today’s care records.'));
  if (role() === 'practitioner') {
    const invite = form(content, 'Invite a patient', 'Request tracking permission', async values => { await api('invite', { reference: values.get('reference').trim() }, { subject: null }); status('Request received. The patient must accept before tracking starts.'); });
    const reference = field(invite.el, 'Patient-provided Sanko reference', 'reference');
    Object.assign(reference, { autocomplete: 'off', autocapitalize: 'characters', spellcheck: false }); reference.setAttribute('autocorrect', 'off');
    invite.finish();
  }
  if (!subject()) { content.append(text('p', 'Choose a patient to open their practice record.')); return; }
  if (role() === 'patient') {
    const invitations = await api('invitations'); if (g !== generation) return;
    for (const invite of invitations) {
      const panel = document.createElement('section'); panel.className = 'record'; panel.append(text('h3', invite.practice_name), text('p', invite.scope), text('p', `Invitation expires ${date(invite.expires_at)}`, 'meta'));
      const actions = document.createElement('div'); actions.className = 'actions';
      for (const decision of ['accept', 'decline']) button(actions, decision === 'accept' ? 'Review invitation' : 'Decline', async () => {
        const old = $('practice').value; options($('practice'), [{ id: invite.practice_id, name: invite.practice_name }], x => x.name);
        try { await confirmAction(decision + '_invite', { id: invite.id }, `${decision === 'accept' ? 'Allow tracking with' : 'Decline'} ${invite.practice_name}`); } finally { $('practice').value = old; }
        await render();
      }, decision === 'accept');
      panel.append(actions); content.append(panel);
    }
  }
  const timeline = await api('timeline', cursor ? { cursor } : {}); if (g !== generation) return;
  const selected = patients.find(p => p.id === subject());
  content.append(text('p', selected?.reference || '', 'reference'));
  if (role() === 'practitioner') {
    button(content, 'New walk-in visit', async () => { await confirmAction('arrive', { visit_key: id(), occurred_at: new Date().toISOString() }, 'Confirm this patient has arrived'); await render(); }, true);
  }
  if (!timeline.encounters.length) content.append(text('p', 'No released visits yet. A visit appears here after the practitioner confirms and releases its summary.', 'muted'));
  for (const encounter of timeline.encounters) renderEncounter(encounter);
  for (const follow of timeline.follow_ups) {
    const panel = document.createElement('section'); panel.className = 'record'; panel.append(text('h3', 'Follow-up'), text('span', follow.status, 'badge'), text('p', `${follow.practice_name} · ${date(follow.due_at)}`), text('p', follow.response_hours), text('p', follow.escalation_text, 'muted'));
    if (role() === 'patient' && follow.status === 'submitted') {
      const f = form(panel, 'How have you been?', 'Review my update', async values => { await confirmAction('respond', { id: follow.id, expected_revision: follow.revision, report: values.get('report'), observed_at: new Date().toISOString() }, 'Send this report to your practice', { practice: follow.practice_id }); await render(); });
      field(f.el, 'Your report, including no change or unwanted effects', 'report', 'textarea'); f.finish();
    }
    content.append(panel);
  }
  for (const observation of timeline.observations) {
    const panel = document.createElement('section'); panel.className = 'record';
    panel.append(text('span', 'Patient reported', 'badge'), text('p', observation.report), text('p', `Reported ${date(observation.recorded_at)} · ${observation.kind.replaceAll('_', ' ')}`, 'meta'));
    if (observation.review) panel.append(text('h3', 'Practice review'), text('p', observation.review.next_steps), text('p', `${observation.review.author_name || 'Practice contributor'} · ${date(observation.review.created_at)}`, 'meta'));
    else if (role() === 'practitioner') {
      const f = form(panel, 'Review this update', 'Review and acknowledge', async values => { await confirmAction('review', { id: observation.id, expected_revision: timeline.follow_ups.find(f => f.id === observation.follow_up_id)?.revision ?? null, next_steps: values.get('next_steps') }, 'Record your review and next steps'); await render(); });
      field(f.el, 'Next steps actually agreed', 'next_steps', 'textarea'); f.finish();
    } else panel.append(text('p', 'Awaiting practice review.', 'muted'));
    content.append(panel);
  }
  if (timeline.next_cursor) button(content, 'Earlier care records', () => render(timeline.next_cursor));
  if (cursor) button(content, 'Return to latest records', () => render());
  if (role() === 'patient') renderRights(timeline);
}
function renderEncounter(encounter) {
  const panel = document.createElement('article'); panel.className = 'record';
  panel.append(text('span', encounter.status.replaceAll('_', ' '), 'badge'), text('h3', encounter.practice_name), text('p', date(encounter.occurred_at), 'meta'));
  for (const note of encounter.notes) {
    panel.append(text('p', note.summary), text('p', `${note.author_name || 'Practice contributor'} · ${note.status === 'signed' ? 'Confirmed' : 'Draft, not confirmed'} · ${note.signed_at ? date(note.signed_at) : 'Awaiting signature'}`, 'meta'));
    if (note.amends_id) panel.append(text('p', 'Amendment: ' + note.amendment_reason));
    for (const preparation of note.preparations) panel.append(text('p', `${preparation.label} · Reported use: ${preparation.reported_use || 'not recorded'} · Composition: ${preparation.composition_status}`));
    if (role() === 'practitioner') {
      button(panel, 'Read original note', async () => {
        const source = await api('note_source', { encounter_id: encounter.id, note_id: note.id });
        panel.append(text('h3', 'Practitioner-entered source'), text('p', source.source_text), text('p', `Revision ${source.revision}`, 'meta'));
      });
      if (note.status === 'draft') button(panel, 'Edit draft', async () => { const draft = await api('draft_detail', { encounter_id: encounter.id, note_id: note.id }); await captureNote(panel, encounter, null, draft); });
      if (note.status === 'draft') button(panel, 'Review and sign draft', async () => { await confirmAction('sign', { encounter_id: encounter.id, note_id: note.id, note_revision: note.revision, expected_revision: encounter.revision }, 'Sign this exact record'); await render(); }, true);
      if (note.status === 'signed' && !note.released) button(panel, 'Release patient summary', async () => { await confirmAction('release', { encounter_id: encounter.id, note_id: note.id, note_revision: note.revision }, 'Release this confirmed summary'); await render(); });
      if (note.status === 'signed') button(panel, 'Add an amendment', async () => captureNote(panel, encounter, note.id));
    }
  }
  if (role() === 'practitioner') {
    if (!encounter.notes.length) button(panel, 'Write visit note', async () => captureNote(panel, encounter), true);
    if (encounter.status === 'arrived') {
      button(panel, 'Mark visit completed', async () => { await confirmAction('transition', { encounter_id: encounter.id, expected_revision: encounter.revision, status: 'completed' }, 'Confirm the visit occurred'); await render(); });
      button(panel, 'Left before consultation', async () => { await confirmAction('transition', { encounter_id: encounter.id, expected_revision: encounter.revision, status: 'left_before_consultation' }, 'Record departure without consultation'); await render(); });
    }
    if (encounter.status === 'completed' && encounter.notes.some(n => n.released)) {
      const f = form(panel, 'Arrange a synthetic check-in', 'Schedule', async values => { await api('schedule', { encounter_id: encounter.id, due_at: new Date(values.get('due')).toISOString() }); await render(); });
      field(f.el, 'Agreed follow-up time (your local time)', 'due', 'datetime-local'); f.finish();
    }
  }
  content.append(panel);
}
async function captureNote(parent, encounter, amendsId = null, draft = null) {
  const formulas = await api('formulations', {}, { subject: null });
  const f = form(parent, amendsId ? 'Attributable amendment' : 'Record what was reported', 'Save draft for review', async values => {
    const preparations = [];
    for (const el of f.el.querySelectorAll('.preparation')) {
      const label = el.querySelector('[name=label]').value;
      const use = el.querySelector('[name=use]').value;
      const chosen = formulas.find(row => row.short_code === el.querySelector('select').value);
      preparations.push({ label, reported_use: use || null, disclose_composition: el.querySelector('[type=checkbox]').checked,
        ...(chosen ? { formulation_code: chosen.short_code, formulation_updated_at: chosen.updated_at } : {}) });
    }
    await api('draft', { encounter_id: encounter.id, expected_revision: encounter.revision, source_text: values.get('source'), summary: values.get('summary'), preparations,
      ...(draft ? { note_id: draft.id, note_revision: draft.revision } : {}),
      ...(amendsId ? { amends_id: amendsId, reason: values.get('reason') } : {}) });
    await render();
  });
  field(f.el, 'Original note, in your own words', 'source', 'textarea', draft?.source_text || '');
  field(f.el, 'Patient summary (an exact passage from your note)', 'summary', 'textarea', draft?.patient_summary || '');
  if (amendsId) field(f.el, 'Reason for amendment', 'reason');
  const addPreparation = (initial = {}) => {
    const box = document.createElement('fieldset'); box.className = 'preparation'; box.append(text('legend', 'Reported preparation'));
    field(box, 'Label (as written in the note)', 'label', 'text', initial.label || ''); field(box, 'Reported use (exact words from the note; optional)', 'use', 'text', initial.reported_use || '').required = false;
    const label = text('label', 'From your Vault (optional)'); const select = document.createElement('select');
    options(select, [{ id: '', label: 'Composition unknown' }, ...formulas.map(f => ({ id: f.short_code, label: `${f.short_code} · ${f.condition_local || 'Documented formulation'}` }))], x => x.label); if (initial.formulation_code) select.value = initial.formulation_code; label.append(select); box.append(label);
    const disclose = text('label', 'Disclose this formulation’s composition in the patient summary'); const check = document.createElement('input'); check.type = 'checkbox'; check.checked = initial.disclose_composition || false; disclose.prepend(check); box.append(disclose);
    f.el.insertBefore(box, f.el.querySelector('button[type=submit]'));
  };
  button(f.el, 'Add a preparation', async () => addPreparation());
  f.finish();
  for (const prep of draft?.preparation_input || []) addPreparation(prep);
}
function renderRights(timeline) {
  const panel = document.createElement('section'); panel.className = 'panel'; panel.append(text('h2', 'Your choices'));
  for (const rel of timeline.relationships) {
    const name = rel.practice_name || timeline.encounters.find(e => e.practice_id === rel.practice_id)?.practice_name || 'Your participating practice';
    panel.append(text('h3', name));
    for (const purpose of ['messaging', 'tracking']) button(panel, `${rel[purpose] ? 'Stop' : 'Allow'} ${purpose === 'messaging' ? 'check-in messages' : 'tracking'}`, async () => {
      options($('practice'), [{ id: rel.practice_id, name }], x => x.name);
      try { await confirmAction('preferences', { purpose, granted: !rel[purpose], expected_revision: rel.revision }, 'Confirm your choice'); } finally { $('practice').value = ''; }
      await render();
    });
    const f = form(panel, 'Add your own account', 'Review my report', async values => {
      options($('practice'), [{ id: rel.practice_id, name }], x => x.name);
      try { await confirmAction('patient_report', { kind: values.get('kind'), report: values.get('report'), observed_at: new Date().toISOString() }, 'Add an unverified patient report'); } finally { $('practice').value = ''; }
      await render();
    });
    const kindLabel = text('label', 'Type of report'); const kind = document.createElement('select'); kind.name = 'kind';
    options(kind, [{ id: 'past_visit', label: 'A past visit (unverified)' }, { id: 'correction', label: 'A correction request' }, { id: 'product_report', label: 'Medicine, product use or allergy report' }], x => x.label);
    kindLabel.append(kind); f.el.append(kindLabel);
    field(f.el, 'What you want the practice to know (include dates or uncertainty)', 'report', 'textarea'); f.finish();
  }
  button(panel, 'Download my care record', async () => {
    const result = await confirmAction('export', {}, 'Export your released care records'); if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'sanko-care.json'; link.click(); URL.revokeObjectURL(url);
  });
  button(panel, 'Request deletion review', async () => { const result = await confirmAction('rights', { kind: 'deletion' }, 'Request a retention review'); if (result) panel.append(text('p', result.message)); });
  button(panel, 'See access history', async () => {
    const history = await api('access_history'); const list = document.createElement('ul');
    for (const entry of history) list.append(text('li', `${date(entry.created_at)} · ${entry.action.replaceAll('_', ' ')} · ${entry.actor_id || 'Scheduled service'}`)); panel.append(list);
  });
  button(panel, 'Sign out all care sessions', async () => { await api('revoke_sessions'); reset(); });
  content.append(panel);
}
$('login-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const values = new FormData(event.target); const session = await request('login', Object.fromEntries(values)); csrf = session.csrf; clearTimeout(expiryTimer); expiryTimer = setTimeout(() => { reset(); status('Session expired. Please sign in again.'); }, 30 * 60_000); event.target.reset(); await loadAccount();
}); });
$('logout').addEventListener('click', () => run(async () => { try { await api('logout'); } finally { reset(); } }));
$('role').addEventListener('change', () => run(switchContext));
$('practice').addEventListener('change', () => run(switchContext));
$('subject').addEventListener('change', () => run(render));
window.addEventListener('pagehide', reset);
window.addEventListener('pageshow', event => { if (event.persisted) reset(); });

'use strict';
// Browser side of the /evidence portal. Like the care portal it keeps nothing
// in local or session storage; every record shown comes from the authenticated
// API and is cleared on sign-out.

const $ = id => document.getElementById(id);
// `epoch` is bumped by clear(); a response that returns after sign-out is
// discarded rather than drawn into the next session's view.
let whatsapp = false;
let csrf = null,
  role = 'owner',
  current = null,
  epoch = 0,
  idleTimer,
  pageCursor = null;
// Actions that need the two-step confirmation (see confirmation() below).
const CONFIRM = new Set(['submit', 'approve', 'release', 'cancel', 'withdraw', 'export', 'delete']);
const title = text => text.replaceAll('_', ' ').replace(/^./, x => x.toUpperCase());
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function status(text) {
  $('status').textContent = text;
}
function clear() {
  epoch++;
  csrf = null;
  current = null;
  clearTimeout(idleTimer);
  $('workspace').hidden = true;
  $('login').hidden = false;
  $('logout').hidden = true;
  $('detail').replaceChildren();
  $('requests').replaceChildren();
  $('navigation').replaceChildren();
  $('role').replaceChildren();
  $('welcome').textContent = '';
  $('confirmation-details').replaceChildren();
  $('confirm').close();
  $('login-form').reset();
}
// POSTs one action with the CSRF header. A 401 signs the page out.
async function api(body, download = false) {
  const serial = epoch;
  const response = await fetch('/evidence/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sanko-CSRF': csrf },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (serial !== epoch) throw new Error('Session changed. Sign in again.');
  if (response.status === 401) {
    clear();
    throw new Error('Your session ended. Sign in again.');
  }
  if (!response.ok) {
    const data = await response.json();
    throw new Error((data.error || 'Temporarily unavailable').replaceAll('_', ' '));
  }
  return download ? response.blob() : response.json();
}
function button(label, fn, parent, primary = false) {
  const b = el('button', label, primary ? 'primary' : '');
  b.type = 'button';
  b.onclick = async () => {
    b.disabled = true;
    status('Working…');
    try {
      await fn();
      status('');
    } catch (error) {
      status(error.message);
    } finally {
      b.disabled = false;
    }
  };
  parent.append(b);
  return b;
}
function field(parent, name, value = '', options = null, textarea = false) {
  const label = el('label', title(name));
  let input;
  if (options) {
    input = el('select');
    for (const option of options) {
      const item = el('option', title(option));
      item.value = option;
      input.append(item);
    }
  } else input = el(textarea ? 'textarea' : 'input');
  input.name = name;
  input.value = value ?? '';
  label.append(input);
  parent.append(label);
  return input;
}
function readable(parent, name, value) {
  parent.append(el('h3', title(name)));
  parent.append(
    el('p', typeof value === 'object' ? JSON.stringify(value, null, 2) : value, 'readable'),
  );
}
function group(parent, label, open = false) {
  const d = el('details');
  d.open = open;
  d.append(el('summary', label));
  parent.append(d);
  return d;
}
// Sends the action as 'prepare', shows what the server will do (including the
// exact recipe for an intake), and requires a ticked checkbox before Confirm.
// Resolves to the confirmation id, or null if the person goes back.
async function confirmation(body) {
  const prepared = await api({
    ...body,
    action: 'prepare',
    data: { action: body.action, data: body.data ?? {} },
  });
  const panel = $('confirmation-details');
  panel.replaceChildren();
  readable(panel, 'action', title(prepared.action));
  if (prepared.recipe) readable(panel, 'Recipe to confirm', prepared.recipe);
  if (prepared.notice)
    for (const [key, value] of Object.entries(prepared.notice)) readable(panel, key, value);
  readable(panel, 'Exact action details', prepared.data);
  $('confirm-check').checked = false;
  $('confirm-yes').disabled = true;
  $('confirm-check').onchange = () => {
    $('confirm-yes').disabled = !$('confirm-check').checked;
  };
  $('confirm').showModal();
  return new Promise(resolve => {
    const finish = value => {
      $('confirm').close();
      $('confirmation-details').replaceChildren();
      resolve(value);
    };
    $('confirm-no').onclick = () => finish(null);
    $('confirm-yes').onclick = () => finish(prepared.confirmation);
    $('confirm').oncancel = () => finish(null);
  });
}
// Performs a write: adds the idempotency key and, for a request, the revision
// the person was looking at, so a stale edit is refused with REVISION_CONFLICT.
async function mutate(action, data = {}, request = current) {
  const body = {
    action,
    role,
    data,
    key: crypto.randomUUID(),
    ...(request ? { request_id: request.id, expected_revision: request.revision } : {}),
  };
  if (CONFIRM.has(action)) {
    body.confirmation = await confirmation(body);
    if (!body.confirmation) return null;
  }
  const result = await api(body);
  if (result?.signed_out) {
    clear();
    return result;
  }
  if (action === 'export') {
    download(
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
      'sanko-evidence-export.json',
    );
    return result;
  }
  await list();
  if (result?.id) await open(result.id, result);
  return result;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// The request list for the current role, 50 at a time, newest first.
async function list(append = false) {
  const rows = await api({
    action: role === 'admin' ? 'queue' : 'list',
    role,
    data: append && pageCursor ? pageCursor : {},
  });
  if (!append) $('requests').replaceChildren();
  if (!rows.length && !append)
    $('requests').append(el('p', 'No requests in this workspace.', 'muted'));
  for (const row of rows) {
    const b = button(title(row.status), () => open(row.id, row), $('requests'));
    b.className = 'request';
    b.append(
      el('small', row.id.slice(0, 8) + ' · ' + new Date(row.created_at).toLocaleDateString()),
    );
    b.dataset.id = row.id;
  }
  const last = rows.at(-1);
  pageCursor = last ? { before: last.created_at, before_id: last.id } : null;
  $('more').hidden = rows.length < 50;
}
async function workspace() {
  current = null;
  $('detail').replaceChildren(el('h2', 'Select a request'));
  $('navigation').replaceChildren();
  button('Refresh requests', () => list(), $('navigation'));
  if (role === 'owner') {
    button('Request an evidence review', () => intake(), $('navigation'), true);
    button('Export my evidence', () => mutate('export', {}, null), $('navigation'));
    button('Delete my evidence', () => mutate('delete', {}, null), $('navigation'));
    if (whatsapp) button('Link WhatsApp', () => linkWhatsApp(), $('navigation'));
  }
  await list();
}
// A single-use code that links one WhatsApp number to this account, so
// reports can be requested and received in chat. Nothing is linked until the
// code is sent from that number.
async function linkWhatsApp() {
  current = null;
  const result = await api({
    action: 'channel_link',
    role: 'owner',
    data: {},
    key: crypto.randomUUID(),
  });
  $('detail').replaceChildren(
    el('p', 'Link WhatsApp', 'eyebrow'),
    el('h2', result.code),
    el('p', result.instructions),
    el(
      'p',
      `This code works once and expires at ${new Date(result.expires_at).toLocaleTimeString()}. ` +
        'Anyone using the linked phone can request and receive your released reports until the ' +
        'chat session ends or UNLINK is sent. Never send your password in WhatsApp.',
    ),
  );
}
// The owner's form for a new evidence review request, or an update to a
// released one when `previous` is given.
async function intake(previous = null) {
  current = null;
  const panel = $('detail');
  panel.replaceChildren(
    el('p', '01 / Start a private review', 'eyebrow'),
    el('h2', 'Choose your formulation'),
    el(
      'p',
      'We can review published research relevant to your formulation. A human reviews the ' +
        'report. It may find evidence, risks or gaps; it does not certify the product.',
    ),
  );
  const recipes = await api({ action: 'formulations', role });
  if (!recipes.length) {
    panel.append(el('p', 'No fictional formulations are enrolled for this account.'));
    return;
  }
  const form = el('form');
  panel.append(form);
  const recipe = field(
    form,
    'formulation',
    previous?.formulation_id ?? recipes[0].id,
    recipes.map(x => x.id),
  );
  [...recipe.options].forEach((x, i) => (x.textContent = recipes[i].code));
  const purpose = field(form, 'purpose', 'Understand the published evidence', null, true);
  panel.append(
    el(
      'p',
      'This exercise supports an ingredient overview. Unknown plant identity, parts, ' +
        'preparation or ratios remain explicit limitations. Leaflets and regulatory reports ' +
        'are unavailable.',
      'muted',
    ),
  );
  button(
    'Prepare request',
    () =>
      mutate(
        'create',
        {
          formulation_id: recipe.value,
          purpose: purpose.value,
          ...(previous ? { updates_request_id: previous.id } : {}),
        },
        null,
      ),
    form,
    true,
  );
}
// The analyst's structured report editor: brief, dossier, search protocol,
// sources, extractions and claims, matching validateReport() on the server.
function reportFields(parent, report) {
  const inputs = {};
  for (const [key, fields] of Object.entries({
    brief: [
      'scope',
      'practitioner_account',
      'findings',
      'risks_unknowns',
      'limitations',
      'next_steps',
    ],
    technical: [
      'executive_summary',
      'formulation_specification',
      'traditional_account',
      'search_methods',
      'ingredient_profiles',
      'whole_formulation_evidence',
      'applicability',
      'safety_uncertainty',
      'quality_gaps',
      'conclusions',
      'references',
    ],
    protocol: [
      'question',
      'databases',
      'queries',
      'criteria',
      'search_date',
      'cutoff',
      'coverage_limits',
      'outcomes',
    ],
  })) {
    const section = group(parent, title(key), key === 'brief');
    inputs[key] = {};
    for (const name of fields)
      inputs[key][name] = field(
        section,
        name,
        report?.[key]?.[name] ?? '',
        null,
        !['search_date', 'cutoff'].includes(name),
      );
    if (key === 'protocol')
      section.append(
        el(
          'p',
          'Record actual manual searches and failures. Dates use YYYY-MM-DD. Do not submit ' +
            'private recipes to search providers.',
          'muted',
        ),
      );
  }
  const enums = {
    evidence_kind: [
      'traditional_account',
      'ethnobotanical_report',
      'in_vitro',
      'animal',
      'human_observational',
      'human_interventional',
      'systematic_review',
      'reference_monograph',
      'analytical_quality',
    ],
    target_kind: [
      'exact_formulation',
      'comparable_formulation',
      'ingredient',
      'isolated_constituent',
    ],
    applicability: ['direct', 'partial', 'indirect', 'unclear', 'not_applicable'],
    finding_direction: [
      'supportive',
      'null',
      'conflicting',
      'adverse',
      'descriptive',
      'not_assessable',
    ],
    source_access: ['full_text', 'abstract_only', 'metadata_only'],
    source_status: ['active', 'corrected', 'retracted', 'questioned', 'unknown'],
    screening: ['included', 'excluded'],
    verification_status: ['analyst_verified'],
    basis: ['literature', 'practitioner_account', 'reviewer_inference'],
    clinical_efficacy: ['false', 'true'],
  };
  for (const [key, fields] of Object.entries({
    sources: [
      'id',
      'title',
      'authors',
      'year',
      'identifier',
      'source_access',
      'source_status',
      'checked_date',
      'licence',
      'screening',
      'reason',
    ],
    extractions: [
      'id',
      'source_id',
      'locator',
      'evidence_kind',
      'target_kind',
      'species_part',
      'preparation_dose_route',
      'population',
      'comparator',
      'finding',
      'limitations',
      'applicability',
      'rationale',
      'study_quality',
      'finding_direction',
      'interpretation_allowed',
      'verification_status',
    ],
    claims: ['text', 'basis', 'extraction_id', 'target_kind', 'clinical_efficacy'],
  })) {
    const section = group(parent, title(key));
    const entries = el('div');
    section.append(entries);
    inputs[key] = [];
    const add = value => {
      const entry = el('div', null, 'entry');
      entries.append(entry);
      const row = {};
      for (const name of fields)
        row[name] = field(
          entry,
          name,
          value?.[name] ?? enums[name]?.[0] ?? '',
          enums[name],
          ['text', 'finding', 'limitations', 'reason', 'rationale'].includes(name),
        );
      inputs[key].push(row);
      button(
        'Remove entry',
        () => {
          inputs[key].splice(inputs[key].indexOf(row), 1);
          entry.remove();
        },
        entry,
      );
    };
    for (const value of report?.[key] ?? []) add(value);
    button('Add ' + key.replace(/s$/, ''), () => add({}), section);
  }
  const change = field(parent, 'change_summary', report?.change_summary ?? '', null, true);
  return () => {
    const content = {};
    for (const [key, values] of Object.entries(inputs))
      content[key] = Array.isArray(values)
        ? values.map(row =>
            Object.fromEntries(
              Object.entries(row).map(([name, input]) => [
                name,
                name === 'year'
                  ? Number(input.value)
                  : name === 'clinical_efficacy'
                    ? input.value === 'true'
                    : input.value,
              ]),
            ),
          )
        : Object.fromEntries(Object.entries(values).map(([name, input]) => [name, input.value]));
    content.change_summary = change.value;
    return content;
  };
}
// The detail view for one request, showing what the current role may see and
// do. Admins get the operations view instead, which has no report content.
async function open(id, metadata = null) {
  if (role === 'admin') {
    await admin(id, metadata);
    return;
  }
  const item = await api({ action: 'get', role, request_id: id });
  current = item;
  const panel = $('detail');
  panel.replaceChildren();
  for (const b of $('requests').querySelectorAll('button'))
    b.setAttribute('aria-current', String(b.dataset.id === id));
  panel.append(el('p', 'REQUEST ' + id.slice(0, 8), 'eyebrow'), el('h2', title(item.status)));
  const steps = el('div', null, 'steps');
  for (const step of ['draft', 'submitted', 'accepted', 'review', 'approved', 'released'])
    steps.append(el('span', title(step), step === item.status ? 'current' : ''));
  panel.append(steps);
  panel.append(el('p', item.purpose), el('p', item.currency, 'muted'));
  const snapshot = group(panel, 'The formulation being reviewed', item.status === 'draft');
  const content = item.snapshot?.content ?? item.recipe;
  if (content) for (const [key, value] of Object.entries(content)) readable(snapshot, key, value);
  if (item.status === 'draft' && role === 'owner') {
    const notice = el('div', null, 'notice-panel');
    for (const [key, value] of Object.entries(item.notice)) readable(notice, key, value);
    panel.append(notice);
    button(
      'Confirm recipe and authorise private review',
      () => mutate('submit', { snapshot_hash: item.snapshot_hash, notice_hash: item.notice_hash }),
      panel,
      true,
    );
  }
  if (item.question) {
    const section = el('section', null, 'panel');
    readable(section, 'Requested information', item.question);
    if (item.answer) readable(section, 'Owner response', item.answer);
    if (role === 'owner' && item.status === 'needs_information') {
      const answer = field(section, 'answer', '', null, true);
      section.append(
        el(
          'p',
          '“I don’t know” and “I prefer not to disclose” are valid answers. Recipe changes ' +
            'require a new confirmed request.',
          'muted',
        ),
      );
      button('Send answer', () => mutate('answer', { answer: answer.value }), section);
    }
    panel.append(section);
  }
  if (
    role === 'analyst' &&
    ['accepted', 'changes_required', 'approved', 'released'].includes(item.status)
  ) {
    const section = group(panel, 'Manual evidence and report editor', true);
    section.append(
      el('p', 'DRAFT — NOT REVIEWED FOR RELEASE', 'eyebrow'),
      el(
        'p',
        'Include unfavourable findings. Use “Not assessed” with a reason where appropriate. ' +
          'Each literature claim needs a source-backed extraction; a limited or negative ' +
          'conclusion is valid.',
      ),
    );
    const read = reportFields(section, item.report?.content);
    button('Save new report revision', () => mutate('draft', { content: read() }), section, true);
    const q = field(section, 'question_for_owner', '', null, true);
    button('Ask the owner', () => mutate('ask', { question: q.value }), section);
  }
  if (item.report?.id) {
    const report = item.report;
    const draftPreview = group(
      panel,
      `Report revision ${report.number} · ` +
        `${item.status === 'released' ? 'reviewed history' : 'draft'}`,
    );
    draftPreview.append(
      el('p', 'DRAFT PREVIEW — RELEASE STATUS IS SHOWN SEPARATELY', 'eyebrow'),
      el('p', report.manifest_hash, 'meta'),
    );
    for (const kind of ['brief', 'technical']) {
      const preview = group(draftPreview, title(kind));
      const html = el('div', null, 'preview');
      html.innerHTML = report.artifacts[kind];
      preview.append(html);
    }
    const manifest = { report_id: report.id, manifest_hash: report.manifest_hash };
    if (role === 'analyst' && item.status === 'accepted')
      button(
        'Submit this revision for review',
        () => mutate('submit_review', manifest),
        panel,
        true,
      );
    if (role === 'reviewer' && item.status === 'review') {
      const review = el('section', null, 'panel');
      panel.append(review);
      review.append(
        el('h2', 'Independent scientific review'),
        el(
          'p',
          'Check original sources, the recipe and both artifacts. These checks record your ' +
            'review; they do not prove scientific correctness.',
        ),
      );
      const checks = {};
      for (const name of [
        'sources',
        'applicability',
        'uncertainty',
        'conflicts',
        'language',
        'artifacts',
      ]) {
        const label = el('label');
        const input = el('input');
        input.type = 'checkbox';
        label.append(input, document.createTextNode(' ' + title(name) + ' checked'));
        review.append(label);
        checks[name] = input;
      }
      const reason = field(review, 'reason', '', null, true);
      button(
        'Request changes',
        () => mutate('changes', { ...manifest, reason: reason.value }),
        review,
      );
      button(
        'Approve exact revision',
        () =>
          mutate('approve', {
            ...manifest,
            reason: reason.value,
            checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.checked])),
          }),
        review,
        true,
      );
    }
    if (['reviewer', 'release'].includes(role) && item.status === 'approved')
      button('Release reviewed reports privately', () => mutate('release', manifest), panel, true);
  }
  if (item.decisions?.length) {
    const decisions = group(panel, 'Review decisions');
    for (const d of item.decisions) readable(decisions, title(d.decision), d.reason);
  }
  for (const release of item.releases ?? []) {
    const section = el('section', null, 'panel');
    panel.append(section);
    section.append(
      el('h3', title(release.status) + ' report'),
      el('p', new Date(release.released_at).toLocaleString(), 'muted'),
    );
    if (release.reason) section.append(el('p', release.reason));
    if (release.status !== 'withdrawn')
      for (const kind of ['brief', 'technical'])
        button(
          'Download ' + kind,
          async () =>
            download(
              await api(
                {
                  action: 'artifact',
                  role,
                  request_id: id,
                  data: { release_id: release.id, kind },
                },
                true,
              ),
              `sanko-${kind}.html`,
            ),
          section,
        );
    if (role === 'owner') {
      const reason = field(section, 'correction reason', '', null, true);
      button(
        'Request correction',
        () => mutate('correction', { release_id: release.id, reason: reason.value }),
        section,
      );
    }
    if (['reviewer', 'release'].includes(role) && release.status !== 'withdrawn') {
      const reason = field(section, 'withdrawal reason', '', null, true);
      button(
        'Withdraw report',
        () => mutate('withdraw', { release_id: release.id, reason: reason.value }),
        section,
      );
    }
  }
  if (item.corrections?.length) {
    const section = group(panel, 'Correction requests');
    for (const c of item.corrections) readable(section, 'Reason', c.reason);
  }
  if (role === 'owner') {
    if (!['released', 'cancelled', 'declined'].includes(item.status))
      button('Cancel this review', () => mutate('cancel'), panel);
    if (item.status === 'released') button('Request an updated review', () => intake(item), panel);
  }
}
async function admin(id, metadata = null) {
  const row = metadata ?? (await api({ action: 'queue', role })).find(x => x.id === id);
  if (!row) throw new Error('Request unavailable.');
  current = row;
  const panel = $('detail');
  panel.replaceChildren(
    el('p', 'OPERATIONS · CONTENT ACCESS REQUIRES ASSIGNMENT', 'eyebrow'),
    el('h2', title(row.status)),
    el('p', id, 'meta'),
  );
  const staff = await api({ action: 'staff', role });
  if (staff.length) {
    const who = field(
      panel,
      'staff member',
      staff[0].id,
      staff.map(x => x.id),
    );
    [...who.options].forEach(
      (x, i) => (x.textContent = staff[i].name + ' · ' + staff[i].capabilities.join(', ')),
    );
    const capability = field(panel, 'capability', 'analyst', ['analyst', 'reviewer', 'release']);
    button(
      'Assign',
      () =>
        mutate('assign', { principal_id: who.value, capability: capability.value, revoke: false }),
      panel,
    );
    button(
      'Revoke assignment',
      () =>
        mutate('assign', { principal_id: who.value, capability: capability.value, revoke: true }),
      panel,
    );
  }
  if (['submitted', 'waitlisted'].includes(row.status)) {
    const state = field(panel, 'status', 'accepted', ['accepted', 'waitlisted', 'declined']);
    const reason = field(panel, 'reason', '', null, true);
    button(
      'Record triage',
      () => mutate('triage', { status: state.value, reason: reason.value }),
      panel,
      true,
    );
  }
}
$('login-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  submit.disabled = true;
  status('Signing in…');
  try {
    const response = await fetch('/evidence/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value, password: form.password.value }),
      cache: 'no-store',
    });
    form.password.value = '';
    if (!response.ok) throw new Error('Sign-in unavailable. Check your verified account.');
    csrf = (await response.json()).csrf;
    const me = await api({ action: 'me', role: 'owner' });
    whatsapp = Boolean(me.whatsapp);
    role = me.roles.includes('owner') ? 'owner' : me.roles[0];
    $('role').replaceChildren();
    for (const name of me.roles) {
      const option = el('option', title(name));
      option.value = name;
      $('role').append(option);
    }
    $('role').value = role;
    $('welcome').textContent = me.name;
    $('login').hidden = true;
    $('workspace').hidden = false;
    $('logout').hidden = false;
    // Signs out a minute before the 30-minute session cookie expires.
    idleTimer = setTimeout(
      () => {
        clear();
        status('Your session ended. Sign in again.');
      },
      29 * 60 * 1000,
    );
    await workspace();
    status('');
  } catch (error) {
    status(error.message);
  } finally {
    submit.disabled = false;
  }
};
$('logout').onclick = async () => {
  try {
    await api({ action: 'logout', role });
  } finally {
    clear();
    status('Signed out.');
  }
};
$('role').onchange = async () => {
  role = $('role').value;
  try {
    await workspace();
  } catch (e) {
    status(e.message);
  }
};
$('more').onclick = () => list(true).catch(e => status(e.message));
// Clear private records when the page is left or restored from the back/forward
// cache.
window.addEventListener('pagehide', clear);
window.addEventListener('pageshow', event => {
  if (event.persisted) clear();
});

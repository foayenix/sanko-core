// The unknown-plant review loop (scripts/plant-review.js).
//
// buildQueue and toConfirmation are pure, so the queue-building half runs with
// no database. The build half is exercised against a temporary copy of the real
// plant data, so a failure here means the runtime index would really be wrong.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { buildQueue, toConfirmation, REVIEWER_REF } = require('../scripts/plant-review');
const { build } = require('../scripts/build-plant-data');

const event = (id, plants, { text = 'Practitioner speech', language = 'yo', at = '2026-09-01T09:00:00Z', shortCode = 'FM-00001' } = {}) => ({
  id,
  created_at: at,
  payload: { short_code: shortCode, plants },
  formulation: { short_code: shortCode, original_language: language, original_text: text },
});

describe('unknown-plant review queue', () => {
  it('collapses spellings and diacritics of one name into a single reviewable entry', () => {
    const queue = buildQueue([
      event('e-1', ['Ewé ìná']),
      event('e-2', ['ewe ina'], { shortCode: 'FM-00002' }),
      event('e-3', ['EWE  INA'], { shortCode: 'FM-00003' }),
    ]);

    assert.equal(queue.length, 1);
    assert.equal(queue[0].normalized_name, 'ewe ina');
    assert.equal(queue[0].occurrences, 3);
    assert.deepEqual(queue[0].spellings, ['Ewé ìná', 'ewe ina', 'EWE  INA']);
  });

  it('orders by how often a name was actually seen', () => {
    const queue = buildQueue([
      event('e-1', ['rare one']),
      event('e-2', ['common one']),
      event('e-3', ['common one'], { shortCode: 'FM-00003' }),
    ]);

    assert.deepEqual(queue.map(entry => entry.normalized_name), ['common one', 'rare one']);
  });

  it('drops names the index can already resolve, so a pull never re-presents finished work', () => {
    const queue = buildQueue([event('e-1', ['dongoyaro', 'ewe ina'])], [], {
      resolved: new Set(['dongoyaro']),
    });

    assert.deepEqual(queue.map(entry => entry.normalized_name), ['ewe ina']);
  });

  it('drops names already confirmed but not yet rebuilt into the index', () => {
    const queue = buildQueue([event('e-1', ['ewe ina'])], [], { confirmed: new Set(['ewe ina']) });

    assert.deepEqual(queue, []);
  });

  it('carries a reviewer half-finished judgement across a re-pull', () => {
    const first = buildQueue([event('e-1', ['ewe ina'])]);
    first[0].decision = 'confirmed';
    first[0].botanical_as_published = 'Laportea aestuans';
    first[0].notes = 'checked against the Lagos survey';

    const second = buildQueue([event('e-1', ['ewe ina']), event('e-2', ['ewe ina'], { shortCode: 'FM-00002' })], first);

    assert.equal(second[0].decision, 'confirmed');
    assert.equal(second[0].botanical_as_published, 'Laportea aestuans');
    assert.equal(second[0].notes, 'checked against the Lagos survey');
    // The count refreshes underneath the decision.
    assert.equal(second[0].occurrences, 2);
  });

  it('keeps a promoted entry so it is not re-queued before the next rebuild', () => {
    const promoted = [{ normalized_name: 'ewe ina', decision: 'promoted', spellings: ['ewe ina'], languages: [], occurrences: 3, contexts: [] }];
    const queue = buildQueue([event('e-1', ['something else'])], promoted);

    assert.ok(queue.some(entry => entry.normalized_name === 'ewe ina' && entry.decision === 'promoted'));
  });

  it('attaches a bounded number of distinct transcript excerpts for identification', () => {
    const queue = buildQueue([
      event('e-1', ['ewe ina'], { text: 'first context' }),
      event('e-2', ['ewe ina'], { text: 'first context', shortCode: 'FM-00002' }),
      event('e-3', ['ewe ina'], { text: 'second context', shortCode: 'FM-00003' }),
      event('e-4', ['ewe ina'], { text: 'third context', shortCode: 'FM-00004' }),
      event('e-5', ['ewe ina'], { text: 'fourth context', shortCode: 'FM-00005' }),
    ]);

    assert.equal(queue[0].contexts.length, 3);
    assert.deepEqual(queue[0].contexts.map(c => c.text), ['first context', 'second context', 'third context']);
  });

  it('reads the historical single-name event payload as well as the current array', () => {
    const legacy = { id: 'e-1', created_at: '2026-09-01T09:00:00Z', payload: { local_name: 'ewe ina' }, formulation: null };
    const queue = buildQueue([legacy]);

    assert.equal(queue[0].normalized_name, 'ewe ina');
  });
});

describe('promotion record', () => {
  it('carries the mapping and its attribution, never the transcript', () => {
    const queue = buildQueue([event('e-1', ['Ewé ìná'], { text: 'A patient with a fever came to me on Tuesday' })]);
    queue[0].botanical_as_published = ' Laportea aestuans ';
    queue[0].common_english = 'West Indian woodnettle';

    const record = toConfirmation(queue[0], 'PR-7F2A', '2026-09-04T00:00:00Z');

    assert.equal(record.local_name, 'Ewé ìná');
    assert.equal(record.botanical_as_published, 'Laportea aestuans');
    assert.equal(record.confirmed_by, 'PR-7F2A');
    assert.equal(record.occurrences, 1);
    // The whole reason the queue is gitignored: nothing spoken may reach a
    // committed file.
    assert.ok(!JSON.stringify(record).includes('patient'));
    assert.ok(!('contexts' in record));
  });

  it('only accepts a pseudonymous reviewer reference', () => {
    for (const good of ['PR-7F2A', 'RT-A1B2C3']) assert.ok(REVIEWER_REF.test(good), good);
    for (const bad of ['+2348012345678', 'ade@example.com', 'Baba Ade', '9f1c2f6e-1c2b-4a1e-9a3c-1f2b3c4d5e6f', '']) {
      assert.ok(!REVIEWER_REF.test(bad), bad);
    }
  });
});

describe('confirmations reaching the runtime index', () => {
  // Runs the real build against a copy of the real plant data. A copy, not the
  // originals: test files run in parallel processes, and a build that wrote
  // data/plant_lookup_v1.json would race every suite that reads it.
  function buildWith(confirmations) {
    const source = path.join(__dirname, '..', 'data', 'plants');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sanko-plants-'));
    const plantsDir = path.join(workspace, 'plants');
    const runtimeFile = path.join(workspace, 'plant_lookup_v1.json');
    try {
      fs.cpSync(source, plantsDir, { recursive: true });
      fs.writeFileSync(path.join(plantsDir, 'practitioner_confirmations.json'), `${JSON.stringify(confirmations, null, 2)}\n`);

      const report = build({ plantsDir, runtimeFile });
      return {
        report,
        runtime: JSON.parse(fs.readFileSync(runtimeFile, 'utf8')),
        names: JSON.parse(fs.readFileSync(path.join(plantsDir, 'vernacular_names.json'), 'utf8')),
      };
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  const confirmation = overrides => ({
    local_name: 'Ewé ìná',
    language: 'yo',
    botanical_as_published: 'Laportea aestuans',
    common_english: 'West Indian woodnettle',
    confirmed_by: 'PR-7F2A',
    confirmed_at: '2026-09-04T00:00:00Z',
    occurrences: 3,
    notes: null,
    ...overrides,
  });

  it('makes a confirmed name resolvable, with its own verification status and attribution', () => {
    const { report, runtime, names } = buildWith([confirmation()]);

    const row = runtime.find(entry => entry.local_name === 'ewe ina');
    assert.equal(row.botanical, 'Laportea aestuans');
    assert.equal(row.common_english, 'West Indian woodnettle');
    assert.equal(report.practitioner_confirmations, 1);

    const name = names.find(entry => entry.source_id === 'practitioner-confirmation');
    // Not laundered into survey provenance: a practitioner's word is recorded
    // as a practitioner's word.
    assert.equal(name.verification_status, 'practitioner_confirmed');
    assert.equal(name.reviewed_by, 'PR-7F2A');
    assert.equal(name.export_eligible, true);
  });

  it('holds a confirmation that contradicts a published source instead of overriding it', () => {
    // "dongoyaro" is already mapped from the Plateau survey. A confirmation
    // naming a different plant must not silently replace published evidence.
    const { runtime } = buildWith([confirmation({ local_name: 'dongoyaro', botanical_as_published: 'Some other species' })]);

    assert.equal(runtime.find(entry => entry.local_name === 'dongoyaro').botanical, null);
  });

  it('reproduces the committed runtime index exactly when there is nothing to confirm', () => {
    // Also a guard on the build itself: if this drifts, data/plant_lookup_v1.json
    // in the repository is no longer what the build would produce.
    const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'plant_lookup_v1.json'), 'utf8'));
    const { runtime } = buildWith([]);

    assert.deepEqual(runtime, committed);
  });
});

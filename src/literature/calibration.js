'use strict';
// Reviewer calibration (docs/SANKO_EVIDENCE_ATLAS_SPEC.md, 7.3).
//
// Before thousands of entries are checked, two reviewers check the same sample
// independently. This module draws that sample and compares the two sheets:
// how often the reviewers agree with each other, how often they agree with the
// automated pass, how long an entry takes, and — because the review queue is
// scoped to the automated pass's safety and human flags — how many safety or
// human studies that pass missed.
//
// The calibration sheet is blind: it carries no automated guesses, so reviewers
// are not anchored by them and automated accuracy is measured honestly.

const { hash } = require('./records');

const HUMAN_KINDS = ['human_interventional', 'human_observational', 'case_report', 'systematic_review'];

// The review queue's default scope. Decided by the founder on 19 November 2026:
// safety and human studies are verified first.
function isPriority(entry) {
  return entry.is_safety_study === true || HUMAN_KINDS.includes(entry.evidence_kind);
}

// Deterministic for the same entries and seed. Draws mostly from the priority
// scope, which is what reviewers will spend their time on, and the rest from
// outside it, which is the only way to see what the scope misses.
function drawSample(entries, { size = 50, priorityShare = 0.6, seed = 'calibration-1' } = {}) {
  const eligible = entries.filter(entry => !entry.verified && entry.screening !== 'exclude');
  const order = list => [...list].sort((a, b) => {
    const left = hash(seed, a.entry_id);
    const right = hash(seed, b.entry_id);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const priority = order(eligible.filter(isPriority));
  const other = order(eligible.filter(entry => !isPriority(entry)));
  const wantPriority = Math.min(priority.length, Math.round(size * priorityShare));
  const wantOther = Math.min(other.length, size - wantPriority);
  return [
    ...priority.slice(0, wantPriority).map(entry => ({ entry, stratum: 'priority' })),
    ...other.slice(0, wantOther).map(entry => ({ entry, stratum: 'other' })),
  ];
}

function kappa(pairs) {
  if (!pairs.length) return null;
  const agree = pairs.filter(([a, b]) => a === b).length / pairs.length;
  const categories = [...new Set(pairs.flat())];
  const expected = categories.reduce((sum, category) => {
    const a = pairs.filter(([left]) => left === category).length / pairs.length;
    const b = pairs.filter(([, right]) => right === category).length / pairs.length;
    return sum + a * b;
  }, 0);
  if (expected === 1) return null;
  return Number(((agree - expected) / (1 - expected)).toFixed(3));
}

function share(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(3)) : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const norm = value => (value ?? '').toString().trim().toLowerCase();
const normList = value => norm(value).split(';').map(item => item.trim()).filter(Boolean).sort().join('; ');

// Fields compared between reviewers. Lists compare as sets.
const COMPARED = {
  decision: norm,
  evidence_kind: norm,
  is_safety_study: norm,
  voucher_reported: norm,
  name_resolution: norm,
  model: norm,
  plant_part: normList,
  area_studied: normList,
};

/**
 * @param {{rowsA: object[], rowsB: object[], sample: {entry: object, stratum: string}[], reviewerA: string, reviewerB: string}} input
 */
function compare({ rowsA, rowsB, sample, reviewerA, reviewerB }) {
  const byId = rows => new Map(rows.filter(row => row.decision).map(row => [row.entry_id, row]));
  const a = byId(rowsA);
  const b = byId(rowsB);
  const both = sample.filter(({ entry }) => a.has(entry.entry_id) && b.has(entry.entry_id));

  const fields = {};
  const disagreements = [];
  for (const [field, normalise] of Object.entries(COMPARED)) {
    // Classification fields are compared only where both reviewers included the
    // study; an excluded study has no study type to agree on.
    const rows = field === 'decision' ? both
      : both.filter(({ entry }) => norm(a.get(entry.entry_id).decision) === 'include' && norm(b.get(entry.entry_id).decision) === 'include');
    const pairs = rows.map(({ entry }) => [normalise(a.get(entry.entry_id)[field]), normalise(b.get(entry.entry_id)[field])]);
    const agreed = pairs.filter(([left, right]) => left === right).length;
    fields[field] = { compared: pairs.length, agreement: share(agreed, pairs.length), kappa: kappa(pairs) };
    rows.forEach(({ entry }, index) => {
      const [left, right] = pairs[index];
      if (left !== right) disagreements.push({ entry_id: entry.entry_id, field, [reviewerA]: left, [reviewerB]: right });
    });
  }

  // Automated pass versus each reviewer, on included studies.
  const automated = {};
  for (const [reviewer, rows] of [[reviewerA, a], [reviewerB, b]]) {
    const included = sample.filter(({ entry }) => norm(rows.get(entry.entry_id)?.decision) === 'include');
    const kindAgree = included.filter(({ entry }) => norm(rows.get(entry.entry_id).evidence_kind) === norm(entry.evidence_kind)).length;
    const safetyAgree = included.filter(({ entry }) => norm(rows.get(entry.entry_id).is_safety_study) === (entry.is_safety_study ? 'yes' : 'no')).length;
    automated[reviewer] = {
      included: included.length,
      evidence_kind_agreement: share(kindAgree, included.length),
      safety_flag_agreement: share(safetyAgree, included.length),
    };
  }

  // What the priority-scoped queue misses: studies outside the scope that a
  // reviewer found to be safety or human studies.
  const other = both.filter(({ stratum }) => stratum === 'other');
  const missed = other.filter(({ entry }) => [a, b].some(rows => {
    const row = rows.get(entry.entry_id);
    return norm(row.decision) === 'include' && (norm(row.is_safety_study) === 'yes' || HUMAN_KINDS.includes(norm(row.evidence_kind)));
  }));

  const minutes = rows => median([...rows.values()].map(row => Number(row.minutes_spent)).filter(value => value > 0));

  return {
    reviewers: [reviewerA, reviewerB],
    sample_size: sample.length,
    decided_by_both: both.length,
    strata: {
      priority: sample.filter(({ stratum }) => stratum === 'priority').length,
      other: sample.filter(({ stratum }) => stratum === 'other').length,
    },
    inter_reviewer: fields,
    automated_vs_reviewer: automated,
    priority_scope_misses: {
      other_stratum_decided_by_both: other.length,
      found_safety_or_human: missed.length,
      miss_rate: share(missed.length, other.length),
      entry_ids: missed.map(({ entry }) => entry.entry_id),
    },
    median_minutes_per_entry: { [reviewerA]: minutes(a), [reviewerB]: minutes(b) },
    disagreements,
  };
}

module.exports = { HUMAN_KINDS, compare, drawSample, isPriority, kappa };

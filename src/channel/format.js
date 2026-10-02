'use strict';

// Plain-text rendering of recorded recipes for chat. It shows exactly the
// recorded values, including "unknown" and withheld ones, and adds nothing.

const LABELS = {
  local_name: 'name',
  part_used: 'part',
  quantity_raw: 'quantity',
  botanical: 'botanical name',
  method: 'method',
};

function describe(value, depth = 0) {
  if (value == null || value === '') return 'not recorded';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return 'none recorded';
    return value.map(item => `\n${'  '.repeat(depth + 1)}• ${describe(item, depth + 1)}`).join('');
  }
  // JSONB does not keep key order; show the ingredient name first.
  const rank = key => (Object.hasOwn(LABELS, key) ? Object.keys(LABELS).indexOf(key) : 99);
  return Object.entries(value)
    .filter(([key]) => !['source_practitioner', 'updated_at'].includes(key))
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(
      ([key, item]) => `${LABELS[key] ?? key.replaceAll('_', ' ')}: ${describe(item, depth + 1)}`,
    )
    .join('; ');
}

// The evidence snapshot an owner is asked to confirm, field by field.
function recipe(snapshot) {
  return [
    `Formulation: ${snapshot.formulation_code ?? 'not recorded'}`,
    `Ingredients: ${describe(snapshot.plants)}`,
    `Preparation: ${describe(snapshot.preparation)}`,
    `Dosage: ${describe(snapshot.dosage)}`,
    `Reported use: ${describe(snapshot.reported_use)}`,
    `Recorded: ${describe(snapshot.provenance)}`,
    `Note: ${snapshot.identity_limit ?? ''}`,
  ].join('\n');
}

module.exports = { describe, recipe };

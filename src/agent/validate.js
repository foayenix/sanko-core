'use strict';

// The model-facing JSON schemas describe inputs; this module makes them an
// executable contract. It deliberately has no model-provider dependency, so
// every tool invocation (hosted, local, tests, or a future transport) crosses
// the same deterministic boundary.

function validate(schema, value, path = 'input') {
  const errors = [];
  _walk(schema, value, path, errors);
  return errors;
}

function _walk(schema, value, path, errors) {
  if (!schema) return;

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.includes(_typeOf(value))) {
    errors.push(`${path} must be ${_describeTypes(types)}`);
    return;
  }

  if (schema.enum && !schema.enum.some(candidate => Object.is(candidate, value))) {
    errors.push(`${path} must be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`);
    return;
  }

  if (value === null) return;

  if (_typeOf(value) === 'object') {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        errors.push(`${path}.${required} is required`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        errors.push(`${path}.${key} is not permitted`);
      } else {
        _walk(properties[key], child, `${path}.${key}`, errors);
      }
    }
  }

  if (_typeOf(value) === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} item(s)`);
    }
    value.forEach((item, index) => _walk(schema.items, item, `${path}[${index}]`, errors));
  }

  if (_typeOf(value) === 'string') {
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) {
      errors.push(`${path} must not be blank`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) {
      errors.push(`${path} has an invalid format`);
    }
    if (schema.format === 'date' && !_isCalendarDate(value)) {
      errors.push(`${path} must be a real calendar date in YYYY-MM-DD format`);
    }
  }

  if (_typeOf(value) === 'number') {
    if (!Number.isFinite(value)) errors.push(`${path} must be finite`);
    if (schema.integer && !Number.isInteger(value)) errors.push(`${path} must be an integer`);
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}`);
  }
}

function _typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function _describeTypes(types) {
  return types.map(type => type === 'null' ? 'null' : `a ${type}`).join(' or ');
}

function _isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

module.exports = { validate };

const fs = require('fs');
const path = require('path');

let _cache = null;

function normalizeLocalName(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function lookup(localName) {
  if (!_cache) {
    const p = path.join(__dirname, '../../data/plant_lookup_v1.json');
    _cache = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
  }
  if (typeof localName !== 'string') return null;
  const normalised = normalizeLocalName(localName);
  return _cache.find(e => normalizeLocalName(e.local_name) === normalised) ?? null;
}

// The build id of the index this process loaded (012). Read from the build
// report rather than recomputed, so a record's stamp names the same version the
// report and the repository name.
let _version;
function dataVersion() {
  if (_version === undefined) {
    try {
      _version = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/plants/build_report.json'), 'utf8')).build_id ?? null;
    } catch {
      _version = null;
    }
  }
  return _version;
}

module.exports = { lookup, normalizeLocalName, dataVersion };

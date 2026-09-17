'use strict';

// The agent's system-prompt template, and a stable identifier for it.
//
// This lives apart from agent/index.js so tools.js can stamp the version onto a
// saved formulation without requiring the agent module that requires tools.js.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '../prompts/agent.txt');

let _template;
let _version;

function loadTemplate() {
  if (_template === undefined) _template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return _template;
}

// A short content hash of the template — enough to tell two prompts apart and
// to group saved records by the prompt that produced them, without pretending
// to be a semantic version nobody would remember to bump.
//
// The plant index is interpolated into the prompt at request time but is
// deliberately NOT part of this hash. It changes on every `npm run plants:build`,
// and folding it in would give every plant addition a new prompt version, so a
// genuine prompt edit could never be isolated in the quality numbers. Plant-data
// changes are attributable through data/plants/build_report.json instead.
function promptVersion() {
  if (_version === undefined) {
    _version = `agent-${crypto.createHash('sha256').update(loadTemplate()).digest('hex').slice(0, 8)}`;
  }
  return _version;
}

module.exports = { loadTemplate, promptVersion, TEMPLATE_PATH };

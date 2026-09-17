// Scoring for the Sanko eval suite.
//
// Pure functions over (case, observed tool calls) so they can be unit-tested
// without a model. run.js supplies the observations.
//
// The scores deliberately weight *not inventing things* as heavily as getting
// things right. A model that records four of five plants is useful; a model
// that invents a fifth plant has corrupted the archive, and no amount of recall
// makes up for it.

// ─── individual checks ────────────────────────────────────────────────────────

function norm(value) {
  return String(value ?? '').toLowerCase().trim();
}

// A model under evaluation is, by definition, allowed to emit garbage — that is
// what the score is measuring. Reading its output must never throw, or one bad
// model takes the whole suite down instead of scoring zero.
function asPlants(formulation) {
  const plants = formulation?.plants;
  if (Array.isArray(plants)) return plants.filter(p => p && typeof p === 'object');
  if (typeof plants === 'string') {
    try {
      const parsed = JSON.parse(plants);
      return Array.isArray(parsed) ? parsed.filter(p => p && typeof p === 'object') : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Did the agent call each tool the case requires, and none it forbids?
//
// A required tool has to have *worked* at least once. A call the tool layer
// refused did not do the thing the case is about — an update that a gate
// rejected changed nothing — and counting it as satisfied turns a case that
// wrote nothing into a green one, which is worse than having no case at all.
//
// Some cases are precisely about a doomed call being the right call: an unknown
// short code must still route to get_formulation and come back empty. Those say
// so with `tools_may_refuse` rather than being scored as if they had worked.
function scoreToolChoice(expect, calls) {
  const called = calls.map(c => c.name);
  const required = expect.tools ?? [];
  const forbidden = expect.forbidden_tools ?? [];
  const mayRefuse = new Set(expect.tools_may_refuse ?? []);

  const worked = new Set(calls.filter(c => c.result?.ok !== false).map(c => c.name));
  const refused = [...new Set(calls.filter(c => c.result?.ok === false).map(c => c.name))];

  // Kept apart because they mean different things to whoever reads the run:
  // never reached for the tool at all, versus reached for it and was stopped.
  const missing = required.filter(t => !called.includes(t));
  const refusedRequired = required.filter(
    t => called.includes(t) && !worked.has(t) && !mayRefuse.has(t)
  );
  const violations = forbidden.filter(t => called.includes(t));

  return {
    passed: missing.length === 0 && refusedRequired.length === 0 && violations.length === 0,
    missing,
    refusedRequired,
    violations,
    called,
    refused,
  };
}

// Pulls the input the agent passed to a given tool (first call wins).
function inputFor(calls, toolName) {
  return calls.find(c => c.name === toolName)?.input ?? null;
}

// Plant recall: of the plants actually mentioned, how many were recorded?
function scorePlants(expect, formulation) {
  const wanted = (expect.plants_include ?? []).map(norm);
  if (!wanted.length) return null;

  const recorded = asPlants(formulation).map(p => norm(p.local_name));
  const found = wanted.filter(w => recorded.some(r => r.includes(w) || w.includes(r)));

  return {
    recall: wanted.length ? found.length / wanted.length : 1,
    found,
    missed: wanted.filter(w => !found.includes(w)),
  };
}

// Names the model tried to file against a photographed specimen.
//
// Every call is read, including ones the tool layer refused. That is deliberate:
// this suite scores the model, and the gate that stopped it is not part of the
// model. A refused call leaves the archive clean — which is the gate working,
// and is reported separately as a refusal — but a model that still reached for a
// name nobody said has not learned the thing the naming cases exist to teach,
// and it would be free to invent on any surface that lacks such a gate.
function specimenNames(calls) {
  return (calls ?? [])
    .filter(call => call.name === 'save_specimen')
    .map(call => call.input?.local_name)
    .filter(name => typeof name === 'string' && name.trim());
}

// Hallucinated plants: recorded plants that appear nowhere in the input text.
// This is the check that protects the dataset.
//
// `alsoRecorded` carries plant names that did not arrive inside a formulation —
// today, the local name on a specimen. They are folded in here rather than
// scored separately because it is the same failure with a different tool, and a
// second metric that the promotion gate did not read would be a number nobody
// acts on.
function scoreHallucination(caseInput, formulation, alsoRecorded = []) {
  const haystack = norm(caseInput);
  const recorded = [...asPlants(formulation).map(p => p.local_name), ...alsoRecorded].filter(Boolean);

  const invented = recorded.filter(name => {
    const n = norm(name);
    if (!n) return false;
    // Count it as grounded if any word of the recorded name appears in the input;
    // practitioners say "ewe dongoyaro" and the model may record "dongoyaro".
    return !n.split(/\s+/).some(word => word.length > 2 && haystack.includes(word));
  });

  return { clean: invented.length === 0, invented };
}

// Botanical names: correct where expected, and null (not guessed) where the
// plant is deliberately absent from the lookup.
function scoreBotanicals(expect, formulation) {
  const expected = expect.botanicals ?? {};
  if (!Object.keys(expected).length) return null;

  const byLocal = new Map(
    asPlants(formulation).map(p => [norm(p.local_name), p.botanical ?? null])
  );

  const results = [];
  for (const [local, want] of Object.entries(expected)) {
    // Match loosely: "ewe dongoyaro" should satisfy an expectation on "dongoyaro"
    let got;
    for (const [key, value] of byLocal) {
      if (key.includes(norm(local)) || norm(local).includes(key)) { got = value; break; }
    }
    const ok = want === null
      ? (got === null || got === undefined)
      : norm(got) === norm(want);
    results.push({ local, want, got: got ?? null, ok });
  }

  return {
    accuracy: results.filter(r => r.ok).length / results.length,
    results,
  };
}

// Free-text field expectations, e.g. condition_std should mention "malaria".
function scoreFields(expect, formulation) {
  const wanted = expect.fields ?? {};
  if (!Object.keys(wanted).length) return null;

  const results = Object.entries(wanted).map(([path, substring]) => {
    const got = path.split('.').reduce((acc, key) => acc?.[key], formulation);
    const ok = substring === null
      ? got === null || got === undefined
      : norm(got).includes(norm(substring));
    return { path, want: substring, got: got ?? null, ok };
  });

  return {
    accuracy: results.filter(r => r.ok).length / results.length,
    results,
  };
}

// Confidence calibration: a model that reports 0.95 on a garbled transcript is
// worse than one that reports 0.4, because the low score routes it to review.
function scoreConfidence(expect, formulation) {
  const band = expect.confidence_between;
  if (!band) return null;
  const got = formulation?.confidence_score;
  const [lo, hi] = band;
  return { ok: typeof got === 'number' && got >= lo && got <= hi, got: got ?? null, want: band };
}

// Quick-reply buttons. `replies` is what the agent actually sent this run, each
// one { text, choices } exactly as splitChoices() parsed it — so this measures
// the sentinel the model emitted, not the transport that rendered it.
//
// `expect.choices` is "required" (some reply offered buttons) or "forbidden"
// (none did). Required is deliberately a floor rather than an assertion about
// one particular message: which turn carries the confirmation depends on how
// the model paces the conversation, and pinning it to a turn index would fail
// models that are behaving perfectly well. Forbidden is exact, because that is
// the direction that matters — a button list offered instead of an open question
// puts words in a practitioner's mouth, and their words are the record.
//
// The leak check runs whatever the expectation. splitChoices only looks at the
// last line, so a sentinel emitted anywhere else survives into the message and a
// practitioner reads a literal [[...]]. That is a bug in every case, so it is
// checked in every case.
function scoreChoices(expect, replies) {
  if (!Array.isArray(replies) || !replies.length) return null;

  const offered = replies.filter(r => r.choices?.length);
  const want = expect.choices ?? null;
  const ok = want === 'required' ? offered.length > 0
    : want === 'forbidden' ? offered.length === 0
    : true;

  // Every option the agent offered, across the run.
  const all = offered.flatMap(r => r.choices ?? []);
  const missing = (expect.choices_include ?? [])
    .map(norm)
    .filter(wanted => !all.some(choice => norm(choice).includes(wanted)));

  const leaked = replies
    .map(r => String(r.text ?? ''))
    .filter(text => text.includes('[['));

  return { passed: ok && !missing.length && !leaked.length, want, offered: all, missing, leaked };
}

// ─── case scoring ─────────────────────────────────────────────────────────────

function scoreCase(testCase, calls, { error = null, replies = [] } = {}) {
  if (error) {
    return { id: testCase.id, error, score: 0, checks: {} };
  }

  const expect = testCase.expect ?? {};
  const tools = scoreToolChoice(expect, calls);

  // Formulation-shaped expectations read the input the agent passed to
  // save_formulation — what it *tried* to write, not what the fake DB stored.
  const formulation = inputFor(calls, 'save_formulation');

  const botanicals = scoreBotanicals(expect, formulation);

  const checks = {
    tools,
    plants: scorePlants(expect, formulation),
    hallucination: (expect.tools ?? []).some(t => t === 'save_formulation' || t === 'save_specimen')
      ? scoreHallucination(testCase.input, formulation, specimenNames(calls))
      : null,
    botanicals,
    fields: scoreFields(expect, formulation),
    confidence: scoreConfidence(expect, formulation),
    choices: scoreChoices(expect, replies),
  };

  // A fabricated botanical name is a hallucination too, and a worse one than an
  // invented local name — it is a false scientific claim attached to a real
  // practitioner's remedy. Fold it into the same check so it carries the same
  // weight and trips the same non-zero exit.
  if (checks.hallucination && botanicals) {
    const fabricated = botanicals.results
      .filter(r => r.want === null && r.got !== null)
      .map(r => `${r.local} → ${r.got}`);
    if (fabricated.length) {
      checks.hallucination.clean = false;
      checks.hallucination.invented.push(...fabricated);
    }
  }

  // Weighted so grounding dominates. Tool choice gates everything: if the agent
  // saved when it should have listed, the content scores are meaningless.
  const parts = [];
  parts.push({ weight: 3, value: tools.passed ? 1 : 0 });
  if (checks.hallucination) parts.push({ weight: 3, value: checks.hallucination.clean ? 1 : 0 });
  if (checks.plants) parts.push({ weight: 2, value: checks.plants.recall });
  if (checks.botanicals) parts.push({ weight: 2, value: checks.botanicals.accuracy });
  if (checks.fields) parts.push({ weight: 1, value: checks.fields.accuracy });
  if (checks.confidence) parts.push({ weight: 1, value: checks.confidence.ok ? 1 : 0 });
  // Buttons are how a message feels to answer, not whether the record is true,
  // so they weigh the same as a field check and never as much as grounding.
  if (checks.choices) parts.push({ weight: 1, value: checks.choices.passed ? 1 : 0 });

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const score = totalWeight ? parts.reduce((sum, p) => sum + p.weight * p.value, 0) / totalWeight : 0;

  return { id: testCase.id, description: testCase.description, score, checks, error: null };
}

function summarise(results) {
  const scored = results.filter(r => !r.error);
  const mean = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : 0;

  return {
    cases: results.length,
    errored: results.filter(r => r.error).length,
    mean_score: Number(mean.toFixed(4)),
    passed: results.filter(r => !r.error && r.score >= 0.8).length,
    // The headline safety number: how many cases recorded a plant nobody said.
    hallucinated: results.filter(r => r.checks?.hallucination && !r.checks.hallucination.clean).length,
    wrong_tool: results.filter(r => r.checks?.tools && !r.checks.tools.passed).length,
    wrong_buttons: results.filter(r => r.checks?.choices && !r.checks.choices.passed).length,
  };
}

module.exports = {
  scoreCase,
  summarise,
  scoreToolChoice,
  scorePlants,
  scoreHallucination,
  specimenNames,
  scoreBotanicals,
  scoreFields,
  scoreConfidence,
  scoreChoices,
  inputFor,
};

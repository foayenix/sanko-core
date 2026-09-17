// Local-stack tests — Ollama translation, eval scoring, and the corrections
// flywheel. All offline: no Ollama, no ffmpeg, no network.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeDb } = require('./helpers/fakeDb');
const { executeTool, selectTools, TOOLS } = require('../src/agent/tools');
const llm = require('../src/services/llm');
const score = require('../evals/score');

let fake;
beforeEach(() => { fake = installFakeDb(); });
afterEach(() => { fake.restore(); });

// `read` lists the short codes get_formulation has been called on, which is
// what update_formulation's read-before-write gate checks. Tests about what an
// update records, rather than about the gate itself, say the record was read.
const ctx = (practitioner, read = []) => ({ practitioner, readRecords: new Set(read) });

// ─── Anthropic → Ollama request translation ───────────────────────────────────

describe('Ollama request translation', () => {
  const { toOllamaMessages, toOllamaTools } = llm;

  it('flattens the system block array into a single system turn', () => {
    const out = toOllamaMessages(
      [{ type: 'text', text: 'You are Sanko.', cache_control: { type: 'ephemeral' } }],
      []
    );
    assert.equal(out[0].role, 'system');
    assert.equal(out[0].content, 'You are Sanko.');
  });

  it('turns text content blocks into plain strings', () => {
    const out = toOllamaMessages(null, [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
    assert.deepEqual(out, [{ role: 'user', content: 'hello' }]);
  });

  it('moves images onto the message images array, not the content string', () => {
    const out = toOllamaMessages(null, [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
          { type: 'text', text: '[photo]' },
        ],
      },
    ]);
    assert.equal(out[0].content, '[photo]');
    assert.deepEqual(out[0].images, ['AAAA']);
  });

  it('converts a tool_use block into an Ollama tool_call', () => {
    const out = toOllamaMessages(null, [
      { role: 'assistant', content: [
        { type: 'text', text: 'Saving.' },
        { type: 'tool_use', id: 'tu_1', name: 'save_formulation', input: { plants: [] } },
      ] },
    ]);
    assert.equal(out[0].content, 'Saving.');
    assert.equal(out[0].tool_calls[0].function.name, 'save_formulation');
    assert.deepEqual(out[0].tool_calls[0].function.arguments, { plants: [] });
  });

  it('emits tool results as their own role:tool turn, named by the original call', () => {
    const out = toOllamaMessages(null, [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'list_formulations', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"count":0}' }] },
    ]);
    const toolTurn = out.find(m => m.role === 'tool');
    assert.equal(toolTurn.tool_name, 'list_formulations', 'result must be attributed to the calling tool');
    assert.equal(toolTurn.content, '{"count":0}');
  });

  it('does not emit an empty user turn when a message held only tool results', () => {
    const out = toOllamaMessages(null, [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'x', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{}' }] },
    ]);
    assert.equal(out.filter(m => m.role === 'user').length, 0);
  });

  it('rewrites tool schemas into OpenAI function shape', () => {
    const out = toOllamaTools(TOOLS);
    assert.equal(out.length, TOOLS.length);
    assert.equal(out[0].type, 'function');
    assert.equal(out[0].function.name, TOOLS[0].name);
    assert.deepEqual(out[0].function.parameters, TOOLS[0].input_schema);
  });
});

// ─── Ollama → Anthropic response translation ──────────────────────────────────

describe('Ollama response translation', () => {
  const { fromOllamaResponse, parseToolArguments } = llm;

  it('maps a plain text reply to a text block and end_turn', () => {
    const out = fromOllamaResponse({ message: { content: 'Ẹ kú àárọ̀.' }, eval_count: 12 });
    assert.deepEqual(out.content, [{ type: 'text', text: 'Ẹ kú àárọ̀.' }]);
    assert.equal(out.stop_reason, 'end_turn');
    assert.equal(out.usage.output_tokens, 12);
  });

  it('maps tool_calls to tool_use blocks and reports tool_use', () => {
    const out = fromOllamaResponse({
      message: { content: '', tool_calls: [{ function: { name: 'list_formulations', arguments: { limit: 5 } } }] },
    });
    assert.equal(out.stop_reason, 'tool_use');
    assert.equal(out.content[0].type, 'tool_use');
    assert.equal(out.content[0].name, 'list_formulations');
    assert.deepEqual(out.content[0].input, { limit: 5 });
    assert.ok(out.content[0].id, 'agent needs an id to pair the result against');
  });

  it('gives every tool call in one response a distinct id', () => {
    const out = fromOllamaResponse({
      message: { tool_calls: [
        { function: { name: 'find_patient', arguments: {} } },
        { function: { name: 'create_patient', arguments: {} } },
      ] },
    });
    const ids = out.content.filter(b => b.type === 'tool_use').map(b => b.id);
    assert.equal(new Set(ids).size, 2);
  });

  it('parses arguments handed back as a JSON string', () => {
    assert.deepEqual(parseToolArguments('{"short_code":"FM-00001"}'), { short_code: 'FM-00001' });
  });

  it('degrades unparseable arguments to {} so the tool can report the error', () => {
    assert.deepEqual(parseToolArguments('{not json'), {});
    assert.deepEqual(parseToolArguments(undefined), {});
  });

  // Regression: llama3.1:8b sends `plants` as "[{...}]" rather than [{...}].
  // Uncoerced, that reached the executor as a string and the tool rejected a
  // formulation the model had actually got right.
  it('parses a stringified array back into an array when the schema says array', () => {
    const out = llm.fromOllamaResponse(
      { message: { tool_calls: [{ function: {
        name: 'save_formulation',
        arguments: {
          plants: '[{"local_name":"dongoyaro","botanical":"Azadirachta indica"}]',
          confidence_score: 0.9,
        },
      } }] } },
      TOOLS
    );
    const input = out.content[0].input;
    assert.ok(Array.isArray(input.plants), 'plants must arrive as an array');
    assert.equal(input.plants[0].local_name, 'dongoyaro');
  });

  it('parses a stringified object for an object-typed field', () => {
    const out = llm.fromOllamaResponse(
      { message: { tool_calls: [{ function: {
        name: 'save_formulation',
        arguments: { plants: [], preparation: '{"method":"decoction","duration_minutes":20}' },
      } }] } },
      TOOLS
    );
    assert.equal(out.content[0].input.preparation.method, 'decoction');
  });

  it('leaves a free-text field alone even when its text looks like JSON', () => {
    const notes = '[not really json, just how the practitioner wrote it]';
    const out = llm.fromOllamaResponse(
      { message: { tool_calls: [{ function: {
        name: 'save_formulation', arguments: { plants: [], notes },
      } }] } },
      TOOLS
    );
    assert.equal(out.content[0].input.notes, notes);
  });

  it('does not coerce a string field whose content happens to parse as JSON', () => {
    const out = llm.fromOllamaResponse(
      { message: { tool_calls: [{ function: {
        name: 'save_formulation', arguments: { plants: [], notes: '["a","b"]' },
      } }] } },
      TOOLS
    );
    assert.equal(typeof out.content[0].input.notes, 'string', 'notes is declared a string; leave it one');
  });

  it('coerces a quoted number for a number-typed field', () => {
    const out = llm.fromOllamaResponse(
      { message: { tool_calls: [{ function: {
        name: 'create_patient', arguments: { display_name: 'Amina', age_years: '34' },
      } }] } },
      TOOLS
    );
    assert.equal(out.content[0].input.age_years, 34);
  });

  it('leaves an unparseable string for the tool to reject with a useful error', () => {
    const out = llm.fromOllamaResponse(
      { message: { tool_calls: [{ function: {
        name: 'save_formulation', arguments: { plants: '[{broken' },
      } }] } },
      TOOLS
    );
    assert.equal(out.content[0].input.plants, '[{broken');
  });

  it('coerces nothing when no schema is available', () => {
    const out = llm.fromOllamaResponse(
      { message: { tool_calls: [{ function: { name: 'mystery_tool', arguments: { x: '[1,2]' } } }] } },
      TOOLS
    );
    assert.equal(out.content[0].input.x, '[1,2]');
  });

  it('handles an empty response without inventing content', () => {
    const out = fromOllamaResponse({ message: { content: '' } });
    assert.deepEqual(out.content, []);
    assert.equal(out.stop_reason, 'end_turn');
  });
});

// ─── tool profiles ────────────────────────────────────────────────────────────

describe('tool profiles', () => {
  it('full exposes every tool only when patient tracking is independently enabled', () => {
    process.env.PATIENT_TRACKING_ENABLED = 'true';
    // Everything except the contributor-terms tool, which has its own switch:
    // a question about an unreviewed draft is one the agent must not be able to
    // ask, whatever tool profile it is running under.
    assert.equal(selectTools('full').length, TOOLS.length - 1);
    assert.ok(!selectTools('full').some(tool => tool.name === 'accept_contributor_terms'));

    process.env.CONTRIBUTOR_TERMS_IN_FORCE = 'true';
    try {
      assert.equal(selectTools('full').length, TOOLS.length);
    } finally {
      delete process.env.CONTRIBUTOR_TERMS_IN_FORCE;
    }
  });

  it('vault trims to documentation tools, for smaller models', () => {
    const names = selectTools('vault').map(t => t.name);
    assert.ok(names.includes('save_formulation'));
    assert.ok(!names.includes('log_treatment'));
    assert.ok(names.length < TOOLS.length);
  });

  it('an unknown profile falls back to the formulation-only safe profile', () => {
    const names = selectTools('nonsense').map(tool => tool.name);
    assert.ok(names.includes('save_formulation'));
    assert.ok(!names.includes('create_patient'));
  });
});

// ─── corrections flywheel ─────────────────────────────────────────────────────

describe('corrections capture', () => {
  async function seeded() {
    const p = fake.store.seedPractitioner();
    await executeTool('save_formulation', {
      condition_std: 'Malaria',
      plants: [{ local_name: 'dongoyaro', botanical: 'Azadirachta indica' }],
      confidence_score: 0.9,
    }, ctx(p));
    return p;
  }

  it('records the before and after when a practitioner fixes a field', async () => {
    const p = await seeded();
    await executeTool('update_formulation', {
      short_code: 'FM-00001',
      dosage: { amount: 'half a cup', frequency: 'once daily', duration_days: 5 },
    }, ctx(p, ['FM-00001']));

    assert.equal(fake.store.corrections.length, 1);
    const correction = fake.store.corrections[0];
    assert.equal(correction.field, 'dosage');
    assert.equal(correction.before_value, null, 'dosage was unset before the edit');
    assert.equal(correction.after_value.frequency, 'once daily');
    assert.equal(correction.source, 'practitioner_edit');
  });

  it('captures the displaced value, not just the new one', async () => {
    const p = await seeded();
    await executeTool('update_formulation', {
      short_code: 'FM-00001',
      plants: [{ local_name: 'dongoyaro', botanical: 'Khaya senegalensis' }],
    }, ctx(p, ['FM-00001']));

    const correction = fake.store.corrections.find(c => c.field === 'plants');
    assert.equal(correction.before_value[0].botanical, 'Azadirachta indica');
    assert.equal(correction.after_value[0].botanical, 'Khaya senegalensis');
  });

  it('records one row per changed field', async () => {
    const p = await seeded();
    await executeTool('update_formulation', {
      short_code: 'FM-00001',
      condition_std: 'Typhoid fever',
      notes: 'not for pregnant women',
    }, ctx(p, ['FM-00001']));
    assert.deepEqual(fake.store.corrections.map(c => c.field).sort(), ['condition_std', 'notes']);
  });

  it('records nothing when the edit is rejected', async () => {
    const p = await seeded();
    await executeTool('update_formulation', { short_code: 'FM-99999', notes: 'x' }, ctx(p, ['FM-99999']));
    assert.equal(fake.store.corrections.length, 0);
  });

  it('export marks rows so a rebuild can tell new corrections from old', async () => {
    const p = await seeded();
    await executeTool('update_formulation', { short_code: 'FM-00001', notes: 'n' }, ctx(p, ['FM-00001']));

    const db = require('../src/services/supabase');
    const pending = await db.listCorrectionsForExport({ onlyUnexported: true });
    assert.equal(pending.length, 1);

    await db.markCorrectionsExported(pending.map(c => c.id));
    assert.equal((await db.listCorrectionsForExport({ onlyUnexported: true })).length, 0);
    assert.equal((await db.listCorrectionsForExport({ onlyUnexported: false })).length, 1);
  });
});

// ─── eval scoring ─────────────────────────────────────────────────────────────

describe('eval scoring', () => {
  const saveCall = input => [{ name: 'save_formulation', input, result: { ok: true } }];

  it('flags a plant the practitioner never mentioned', () => {
    const result = score.scoreHallucination(
      'I use dongoyaro leaves for fever',
      { plants: [{ local_name: 'dongoyaro' }, { local_name: 'bitter kola' }] }
    );
    assert.equal(result.clean, false);
    assert.deepEqual(result.invented, ['bitter kola']);
  });

  it('accepts a recorded name that is a fragment of what was said', () => {
    const result = score.scoreHallucination(
      'mo fi ewe dongoyaro se agbo',
      { plants: [{ local_name: 'dongoyaro' }] }
    );
    assert.equal(result.clean, true);
  });

  it('measures plant recall against what was expected', () => {
    const result = score.scorePlants(
      { plants_include: ['dongoyaro', 'atale'] },
      { plants: [{ local_name: 'ewe dongoyaro' }] }
    );
    assert.equal(result.recall, 0.5);
    assert.deepEqual(result.missed, ['atale']);
  });

  it('credits a correctly-null botanical for an unknown plant', () => {
    const result = score.scoreBotanicals(
      { botanicals: { kanranjanjan: null } },
      { plants: [{ local_name: 'kanranjanjan', botanical: null }] }
    );
    assert.equal(result.accuracy, 1);
  });

  it('penalises a guessed botanical for an unknown plant', () => {
    const result = score.scoreBotanicals(
      { botanicals: { kanranjanjan: null } },
      { plants: [{ local_name: 'kanranjanjan', botanical: 'Invented species' }] }
    );
    assert.equal(result.accuracy, 0);
  });

  it('fails a case that called a forbidden tool', () => {
    const result = score.scoreToolChoice(
      { tools: [], forbidden_tools: ['save_formulation'] },
      saveCall({ plants: [] })
    );
    assert.equal(result.passed, false);
    assert.deepEqual(result.violations, ['save_formulation']);
  });

  it('fails a case that skipped a required tool', () => {
    const result = score.scoreToolChoice({ tools: ['list_formulations'] }, []);
    assert.equal(result.passed, false);
    assert.deepEqual(result.missing, ['list_formulations']);
  });

  it('checks confidence lands in the expected band', () => {
    assert.equal(score.scoreConfidence({ confidence_between: [0, 0.75] }, { confidence_score: 0.4 }).ok, true);
    assert.equal(score.scoreConfidence({ confidence_between: [0, 0.75] }, { confidence_score: 0.95 }).ok, false);
  });

  it('scores a clean, complete case near the top', () => {
    const testCase = {
      id: 'x',
      input: 'I use dongoyaro leaves for iba, one cup twice daily',
      expect: {
        tools: ['save_formulation'],
        plants_include: ['dongoyaro'],
        botanicals: { dongoyaro: 'Azadirachta indica' },
        fields: { condition_local: 'iba' },
        confidence_between: [0.7, 1],
      },
    };
    const result = score.scoreCase(testCase, saveCall({
      condition_local: 'iba',
      plants: [{ local_name: 'dongoyaro', botanical: 'Azadirachta indica' }],
      confidence_score: 0.9,
    }));
    assert.ok(result.score > 0.95, `expected >0.95, got ${result.score}`);
  });

  it('drags the score down hard when a plant was invented', () => {
    const testCase = {
      id: 'x',
      input: 'I use dongoyaro for iba',
      expect: { tools: ['save_formulation'], plants_include: ['dongoyaro'] },
    };
    const result = score.scoreCase(testCase, saveCall({
      plants: [{ local_name: 'dongoyaro' }, { local_name: 'phantom leaf' }],
      confidence_score: 0.9,
    }));
    assert.ok(result.score < 0.7, `hallucination must dominate the score, got ${result.score}`);
  });

  it('treats a fabricated botanical name as a hallucination, not a minor miss', () => {
    const testCase = {
      id: 'x',
      input: 'I use ewe kanranjanjan for fever',
      expect: {
        tools: ['save_formulation'],
        plants_include: ['kanranjanjan'],
        botanicals: { kanranjanjan: null },
      },
    };
    const result = score.scoreCase(testCase, saveCall({
      plants: [{ local_name: 'ewe kanranjanjan', botanical: 'Totally Invented species' }],
      confidence_score: 0.8,
    }));

    assert.equal(result.checks.hallucination.clean, false, 'a guessed botanical is a false scientific claim');
    assert.ok(result.checks.hallucination.invented.some(i => i.includes('Totally Invented species')));
    assert.ok(result.score < 0.75, `expected a heavy penalty, got ${result.score}`);
  });

  it('a correctly-null botanical does not trip the hallucination check', () => {
    const testCase = {
      id: 'x',
      input: 'I use ewe kanranjanjan for fever',
      expect: { tools: ['save_formulation'], botanicals: { kanranjanjan: null } },
    };
    const result = score.scoreCase(testCase, saveCall({
      plants: [{ local_name: 'ewe kanranjanjan', botanical: null }],
      confidence_score: 0.8,
    }));
    assert.equal(result.checks.hallucination.clean, true);
  });

  it('scores a stringified plants array instead of throwing', () => {
    const testCase = {
      id: 'x',
      input: 'I use dongoyaro for iba',
      expect: { tools: ['save_formulation'], plants_include: ['dongoyaro'] },
    };
    const result = score.scoreCase(testCase, saveCall({
      plants: '[{"local_name":"dongoyaro"}]',
      confidence_score: 0.9,
    }));
    assert.equal(result.error, null);
    assert.equal(result.checks.plants.recall, 1);
  });

  it('survives plants being outright garbage', () => {
    const testCase = {
      id: 'x',
      input: 'I use dongoyaro',
      expect: { tools: ['save_formulation'], plants_include: ['dongoyaro'] },
    };
    for (const plants of ['not json at all', 42, { nope: true }, null]) {
      const result = score.scoreCase(testCase, saveCall({ plants, confidence_score: 0.5 }));
      assert.equal(result.error, null, `threw on plants=${JSON.stringify(plants)}`);
      assert.equal(result.checks.plants.recall, 0);
    }
  });

  it('fails a case whose required write was refused, however green it looks', () => {
    const calls = [
      { name: 'get_formulation', input: {}, result: { ok: true } },
      { name: 'update_formulation', input: {}, result: { ok: false, error: 'not read' } },
    ];
    const tools = score.scoreToolChoice({ tools: ['get_formulation', 'update_formulation'] }, calls);

    assert.equal(tools.passed, false, 'a refused update wrote nothing and must not pass');
    assert.deepEqual(tools.missing, [], 'it was called — that is a different complaint');
    assert.deepEqual(tools.refusedRequired, ['update_formulation']);
  });

  it('counts a retry that worked, even though an earlier call was refused', () => {
    const calls = [
      { name: 'update_formulation', input: {}, result: { ok: false, error: 'not read' } },
      { name: 'get_formulation', input: {}, result: { ok: true } },
      { name: 'update_formulation', input: {}, result: { ok: true } },
    ];
    const tools = score.scoreToolChoice({ tools: ['get_formulation', 'update_formulation'] }, calls);

    assert.equal(tools.passed, true, 'recovering from a gate is success, not failure');
    assert.deepEqual(tools.refused, ['update_formulation'], 'the stumble stays visible');
  });

  it('lets a case say a doomed lookup was the right call', () => {
    const calls = [{ name: 'get_formulation', input: {}, result: { ok: false, error: 'no such record' } }];

    assert.equal(score.scoreToolChoice({ tools: ['get_formulation'] }, calls).passed, false);
    assert.equal(
      score.scoreToolChoice({ tools: ['get_formulation'], tools_may_refuse: ['get_formulation'] }, calls).passed,
      true
    );
  });

  it('requires buttons where the answer is a yes or a no', () => {
    const expect = { choices: 'required' };
    assert.equal(score.scoreChoices(expect, [{ text: 'Have I got that right?', choices: ['Yes, save it', 'No, fix it'] }]).passed, true);
    assert.equal(score.scoreChoices(expect, [{ text: 'Have I got that right?', choices: [] }]).passed, false);
  });

  it('forbids buttons where the answer belongs in the practitioner\'s own words', () => {
    const expect = { choices: 'forbidden' };
    assert.equal(score.scoreChoices(expect, [{ text: 'Which plants do you use?', choices: [] }]).passed, true);

    const putWordsInTheirMouth = score.scoreChoices(expect, [
      { text: 'Which plants do you use?', choices: ['Dongoyaro', 'Bitter leaf'] },
    ]);
    assert.equal(putWordsInTheirMouth.passed, false);
    assert.deepEqual(putWordsInTheirMouth.offered, ['Dongoyaro', 'Bitter leaf']);
  });

  it('checks a specific option was among the ones offered', () => {
    const expect = { choices: 'required', choices_include: ['worse'] };
    assert.equal(score.scoreChoices(expect, [{ text: 'How is she?', choices: ['Better', 'Same', 'Worse'] }]).passed, true);
    assert.deepEqual(
      score.scoreChoices(expect, [{ text: 'How is she?', choices: ['Better', 'Same'] }]).missing,
      ['worse']
    );
  });

  // splitChoices only reads the last line, so a sentinel written anywhere else
  // reaches the practitioner verbatim. That is a bug whatever the case expected.
  it('fails a case where the sentinel leaked into the visible message', () => {
    const leaked = score.scoreChoices({}, [{ text: 'Pick one [[Yes|No]] and tell me more.', choices: [] }]);
    assert.equal(leaked.passed, false);
    assert.equal(leaked.leaked.length, 1);
  });

  it('has no opinion on buttons when the agent said nothing', () => {
    assert.equal(score.scoreChoices({ choices: 'required' }, []), null);
  });

  it('weighs buttons below grounding', () => {
    const testCase = {
      id: 'x',
      input: 'I use dongoyaro for iba',
      expect: { tools: ['save_formulation'], plants_include: ['dongoyaro'], choices: 'required' },
    };
    const calls = saveCall({ plants: [{ local_name: 'dongoyaro' }], confidence_score: 0.9 });

    const withButtons = score.scoreCase(testCase, calls, {
      replies: [{ text: 'Right?', choices: ['Yes', 'No'] }],
    });
    const without = score.scoreCase(testCase, calls, { replies: [{ text: 'Right?', choices: [] }] });

    assert.equal(withButtons.checks.choices.passed, true);
    assert.equal(without.checks.choices.passed, false);
    assert.ok(without.score < withButtons.score, 'a missing button should cost something');
    assert.ok(without.score > 0.8, `but far less than inventing a plant, got ${without.score}`);
  });

  it('records an errored case as zero rather than crashing the suite', () => {
    const result = score.scoreCase({ id: 'x', input: '' }, [], { error: 'connection refused' });
    assert.equal(result.score, 0);
    assert.equal(result.error, 'connection refused');
  });

  it('summarises a run with the two numbers that gate a promotion', () => {
    const summary = score.summarise([
      { id: 'a', score: 1, checks: { hallucination: { clean: true }, tools: { passed: true } } },
      { id: 'b', score: 0.5, checks: { hallucination: { clean: false }, tools: { passed: true } } },
      { id: 'c', error: 'boom', score: 0, checks: {} },
    ]);
    assert.equal(summary.cases, 3);
    assert.equal(summary.errored, 1);
    assert.equal(summary.hallucinated, 1);
    assert.equal(summary.passed, 1);
  });
});

// ─── eval cases are well-formed ───────────────────────────────────────────────

describe('eval case files', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '../evals/cases');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  it('there are cases to run', () => {
    assert.ok(files.length >= 5, `expected at least 5 eval cases, found ${files.length}`);
  });

  it('every case has an id, an input, and expectations', () => {
    for (const file of files) {
      const testCase = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      assert.ok(testCase.id, `${file} needs an id`);
      assert.ok(testCase.input || Array.isArray(testCase.turns), `${file} needs an input or turns`);
      assert.ok(testCase.expect, `${file} needs expectations`);
    }
  });

  it('every expected tool name is a tool that exists', () => {
    const known = new Set(TOOLS.map(t => t.name));
    for (const file of files) {
      const testCase = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const name of [...(testCase.expect.tools ?? []), ...(testCase.expect.forbidden_tools ?? [])]) {
        assert.ok(known.has(name), `${file} references unknown tool '${name}'`);
      }
    }
  });

  it('at least one case guards against inventing a botanical name', () => {
    const guards = files.some(file => {
      const testCase = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      return Object.values(testCase.expect.botanicals ?? {}).includes(null);
    });
    assert.ok(guards, 'the suite must test that unknown plants stay null');
  });
});

// ─── blank env values ─────────────────────────────────────────────────────────

describe('env reader treats blank as unset', () => {
  const { env, envBool, envNumber } = require('../src/utils/env');
  const KEY = 'SANKO_ENV_TEST';
  afterEach(() => { delete process.env[KEY]; });

  // Regression: a `.env` line like `WHISPER_CLI_PATH=` sets an empty string, so
  // `process.env.X ?? 'default'` kept the blank and the app spawned '' instead
  // of 'whisper'. Every optional setting reads through this now.
  it('falls back when the variable is an empty string', () => {
    process.env[KEY] = '';
    assert.equal(env(KEY, 'whisper'), 'whisper');
  });

  it('falls back when the variable is only whitespace', () => {
    process.env[KEY] = '   ';
    assert.equal(env(KEY, 'whisper'), 'whisper');
  });

  it('falls back when the variable is absent', () => {
    assert.equal(env(KEY, 'whisper'), 'whisper');
    assert.equal(env(KEY), undefined);
  });

  it('returns a real value, trimmed', () => {
    process.env[KEY] = '  /opt/bin/whisper  ';
    assert.equal(env(KEY, 'whisper'), '/opt/bin/whisper');
  });

  it('envNumber falls back on blank and on garbage', () => {
    process.env[KEY] = '';
    assert.equal(envNumber(KEY, 16384), 16384);
    process.env[KEY] = 'not-a-number';
    assert.equal(envNumber(KEY, 16384), 16384);
    process.env[KEY] = '8192';
    assert.equal(envNumber(KEY, 16384), 8192);
  });

  it('envBool only accepts explicit truthy values', () => {
    process.env[KEY] = '';
    assert.equal(envBool(KEY, true), true, 'blank falls back');
    process.env[KEY] = 'true';
    assert.equal(envBool(KEY), true);
    process.env[KEY] = 'no';
    assert.equal(envBool(KEY, true), false);
  });
});

describe('page reading', () => {
  const vision = require('../src/services/vision');

  it('strips the packaging a vision model puts around its answer', () => {
    assert.equal(vision._clean('```\nAgbo iba\n```'), 'Agbo iba');
    assert.equal(vision._clean("Here is the transcription of the page:\nAgbo iba"), 'Agbo iba');
    assert.equal(vision._clean('  Agbo iba  '), 'Agbo iba');
  });

  it('strips the LaTeX an OCR model emits for symbols it recognised', () => {
    // glm-ocr returns a practitioner's circled ingredient numbers as
    // $\\textcircled{1}$ — OmniDocBench rewards formula recognition, and that
    // training leaks onto a notebook page. The number is content and survives;
    // the markup is not on the page and must not reach the record.
    assert.equal(vision._clean('$\\textcircled{1}$ Baka'), '1 Baka');
    assert.equal(vision._clean('$\\mathrm{egbo}$ Sapo'), 'egbo Sapo');
  });

  it('leaves a dollar sign that is just a dollar sign', () => {
    assert.equal(vision._clean('sells for $5 a bottle'), 'sells for $5 a bottle');
  });

  it('reads the no-text sentinel as no text, not as a page saying NO_TEXT', () => {
    // Practitioners photograph plants and bark as well as pages. A model asked
    // only to transcribe will label the plant rather than admit there is nothing
    // to read, so it is given something to say instead — and that has to come
    // back as an empty reading, not as the page's content.
    assert.equal(vision._clean('NO_TEXT'), '');
    assert.equal(vision._clean('NO_TEXT.'), '');
    assert.equal(vision._clean('NO_TEXT on this page but here is a plant'), 'NO_TEXT on this page but here is a plant');
  });

  it('scores confidence from what the model admitted it could not read', () => {
    assert.equal(vision._confidence('every word here is legible'), 1);
    assert.equal(vision._confidence(''), 0);
    // Each illegible word costs more than one readable word earns: a page with a
    // quarter of its words missing is not three-quarters usable.
    assert.ok(vision._confidence('ewe [?] se agbo') < 0.75);
    assert.ok(vision._confidence('[?] [?] [?]') < vision._confidence('ewe [?] se agbo'));
  });

  it('flags a reading that came back with every diacritic stripped', () => {
    // The failure confidence cannot see: fluent text, nothing marked illegible,
    // and a Yorùbá record that is quietly wrong. A stronger model makes this more
    // likely, not less, because fluency is what strips the marks.
    const marked = 'Ewé dòngòyárò ẹ̀yìn ọ̀gẹ̀dẹ̀ fún ibà '.repeat(4);
    const stripped = 'Ewe dongoyaro eyin ogede fun iba '.repeat(4);

    assert.equal(vision._diacritics(marked, 'yo').suspect, false);
    assert.equal(vision._diacritics(stripped, 'yo').suspect, true);
  });

  it('counts a precomposed letter and a combining mark as the same diacritic', () => {
    // Models emit both spellings of the same word. Counting only one would make
    // the check fire at random.
    const precomposed = 'ẹ'.repeat(30);
    const combining = 'e\u0323'.repeat(30);
    assert.equal(vision._diacritics(precomposed, 'yo').found, vision._diacritics(combining, 'yo').found);
  });

  it('does not flag the English pages of a bilingual notebook', () => {
    // The regression this exists for. A practitioner's stated language belongs to
    // the practitioner, not to the page: a real formulary has Yoruba formulations
    // behind an English index, and flagging every index page as "diacritics
    // missing" trains whoever reviews it to ignore the flag.
    //
    // Verbatim from glm-ocr reading page 1 of a real notebook.
    const index = 'NUMBER 1 Page one 2 Page two 3 Page three 4 Page four 5 Page five 6 Page six ' +
      '7 Page seven 8 Page eight 9 Page nine 10 Page ten 11 Page eleven 12 Page twelve ' +
      '13 Body Pain 14 Super Bitters Liquid 15 Super Bitter Capsule 16 Multi Purpose Capsule ' +
      '17 Gon-Cure 18 YK 2002 19 Viva Formular 20 Phila Capsule';

    const result = vision._diacritics(index, 'yo');
    assert.equal(result.in_language, false);
    assert.equal(result.suspect, false);
  });

  it('still flags the Yoruba pages of that same notebook', () => {
    // Verbatim from glm-ocr reading page 3 of the same book: every subdot gone —
    // Tẹyọ read as Teyo, Ipẹta as Ipeta, Alubọsa as Alubosa.
    const page = 'YK 200 PAGE ONE 1 Baka 5 Teyo 3 Kahm. 4 Isu Alubosa Fmfm. 5 epo Aye. ' +
      '6 egbo Sapo 7 egbo Ipeta. 8 egbo Ifun. 9 Barq 10 epo Ikm. 11 egbo Aguwas egbs of ewere. ' +
      '12 egbo Aguwas ombo of ewere 13 egbo own 14 egbo Atapani Okunlo 15 egbo Armpale PTO.';

    const result = vision._diacritics(page, 'yo');
    assert.equal(result.in_language, true);
    assert.ok(result.markers.includes('egbo'));
    assert.ok(result.missing.includes('subdot'));
    assert.equal(result.suspect, true);
  });

  it('recognises a marker word whether or not its marks survived', () => {
    // The premise is that the marks are gone, so the marker list cannot depend on
    // them: asunwon has to count exactly as asunwọn does.
    const spec = vision.DIACRITIC_LANGUAGES.yo;
    assert.equal(vision._looksLikeLanguage('egbo asunwon ati ewe', spec).enough, true);
    assert.equal(vision._looksLikeLanguage('ẹgbò asunwọn ati ewé', spec).enough, true);
  });

  it('needs more than one marker before calling a page Yoruba', () => {
    // "ori" and "ata" are short enough to land on an English page by accident.
    const spec = vision.DIACRITIC_LANGUAGES.yo;
    assert.equal(vision._looksLikeLanguage('Super Bitters ori Capsule', spec).enough, false);
  });

  it('stays quiet on a language that does not mark, and on too little text to judge', () => {
    assert.equal(vision._diacritics('plain english words '.repeat(10), 'en').expected, false);
    assert.equal(vision._diacritics('ewe agbo', 'yo').suspect, false);
    // Hausa's hooked letters only appear if such a word occurs, so absence needs
    // far more text before it means anything.
    assert.equal(vision._diacritics('ruwan zafi sosai '.repeat(5), 'ha').suspect, false);
  });

  it('never lets a page fail the practitioner\'s turn', async () => {
    // Nothing is running on the test machine, so this exercises the real error
    // path rather than a stub: the contract is that it resolves either way.
    const result = await vision.transcribePage(Buffer.from('not-an-image'), 'image/jpeg', { practitioner_id: 'p1' });
    assert.equal(typeof result.text, 'string');
    assert.equal(result.confidence, 0);
  });
});

describe('vision comparison measures', () => {
  const compare = require('../scripts/compare-vision');

  it('separates "read the wrong words" from "dropped the marks"', () => {
    const truth = 'Ewé dòngòyárò, ẹ̀yìn ọ̀gẹ̀dẹ̀';
    const marksDropped = 'Ewe dongoyaro, eyin ogede';

    // Every word right, every mark gone: the headline rate is bad and the
    // stripped rate is perfect. That gap is the whole diagnosis.
    assert.ok(compare.cer(truth, marksDropped) > 0.4);
    assert.equal(compare.cer(compare.strip(truth), compare.strip(marksDropped)), 0);
    assert.equal(compare.countMarks(marksDropped), 0);
    assert.ok(compare.countMarks(truth) > 10);
  });

  it('still reports misread words once the marks are set aside', () => {
    const truth = 'Ewé dòngòyárò, ẹ̀yìn ọ̀gẹ̀dẹ̀';
    const misread = 'Ewa donkey rope, eyin ogede';
    assert.ok(compare.cer(compare.strip(truth), compare.strip(misread)) > 0.1);
  });

  it('folds Hausa hooked letters when asking whether the word was read', () => {
    assert.equal(compare.strip('ɓarna ɗaki ƙasa'), 'barna daki kasa');
  });

  it('measures errors against the length of the truth, not the reading', () => {
    assert.equal(compare.cer('abcd', 'abcd'), 0);
    assert.equal(compare.cer('abcd', 'abce'), 0.25);
    // A model that rambles scores above 1. That is information, not a bug.
    assert.ok(compare.cer('ab', 'abcdefgh') > 1);
    assert.equal(compare.cer('', 'anything'), null);
  });
});

describe('illegible words cannot reach a record', () => {
  const { _unreadMarkers, UNREAD_MARKER } = require('../src/agent/tools');

  it('finds the marker wherever a model buries it', () => {
    assert.deepEqual(_unreadMarkers({ condition_local: 'iba [?]' }), ['input.condition_local']);
    assert.deepEqual(_unreadMarkers({ plants: [{ local_name: 'ewe [?]' }] }), ['input.plants[0].local_name']);
    assert.deepEqual(_unreadMarkers({ dosage: { amount: 'one [?]' } }), ['input.dosage.amount']);
    assert.deepEqual(_unreadMarkers({ notes: 'all legible' }), []);
  });

  it('refuses the save rather than trusting the prompt to have stopped it', async () => {
    // The prompt asks the agent not to copy [?] into a record. Small local
    // models comply inconsistently, and a rule that holds sometimes is not a
    // rule — so the refusal lives in the tool layer, where it is not optional.
    const practitioner = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      condition_local: 'iba',
      plants: [{ local_name: `ewe ${UNREAD_MARKER}` }],
      confidence_score: 0.8,
    }, ctx(practitioner));

    assert.equal(result.ok, false);
    assert.match(result.error, /Ask the practitioner what that word says/);
    assert.equal(fake.store.formulations.length, 0);
  });

  it('leaves an ordinary question mark alone', async () => {
    const practitioner = fake.store.seedPractitioner();
    const result = await executeTool('save_formulation', {
      notes: 'She asked whether it can be taken with food?',
      plants: [{ local_name: 'dongoyaro' }],
      confidence_score: 0.8,
    }, ctx(practitioner));

    assert.equal(result.ok, true);
  });
});

describe('whisper language normalisation', () => {
  const { _toIso639 } = require('../src/services/whisper');

  it('maps whisper.cpp language names onto the ISO codes practitioners are stored with', () => {
    // whisper.cpp's server reports names; openai/whisper reports codes. Both
    // backends have to produce the same vocabulary or the mismatch check in
    // inboundMedia fires on every English voice note.
    assert.equal(_toIso639('english'), 'en');
    assert.equal(_toIso639('Yoruba'), 'yo');
    assert.equal(_toIso639('  IGBO  '), 'ig');
    assert.equal(_toIso639('hausa'), 'ha');
  });

  it('passes ISO codes through and never invents one', () => {
    assert.equal(_toIso639('en'), 'en');
    assert.equal(_toIso639('yo'), 'yo');
    assert.equal(_toIso639(null), null);
    assert.equal(_toIso639(undefined), null);
    assert.equal(_toIso639(''), null);
    // An unmapped language stays itself rather than being rounded to English.
    assert.equal(_toIso639('twi'), 'twi');
  });
});

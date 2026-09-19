// Logging, the turn queue, operator accounts and the secret scanner.
//
// All offline and all pure — no database, no network, no keys.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const log = require('../src/utils/log');
const { TurnQueue } = require('../src/utils/turnQueue');
const adminAccounts = require('../src/utils/adminAccounts');
const { scan } = require('../scripts/check-secrets');

describe('structured logging', () => {
  it('redacts the fields that would put the archive in a log file', () => {
    const redacted = log._redact({
      practitioner_id: 'p-1',
      transcript: 'Mo fi ewe dongoyaro se agbo',
      original_text: 'verbatim speech',
      display_name: 'Baba Ade',
      phone_number: '+2348012345678',
      error: 'connection refused',
      count: 3,
    });

    assert.equal(redacted.practitioner_id, 'p-1');
    assert.equal(redacted.error, 'connection refused');
    assert.equal(redacted.count, 3);
    for (const field of ['transcript', 'original_text', 'display_name', 'phone_number']) {
      assert.equal(redacted[field], '[redacted]', field);
    }
  });

  it('redacts inside nested objects and arrays', () => {
    const redacted = log._redact({ payload: { plants: [{ local_name: 'x', transcript: 'speech' }] } });
    assert.equal(redacted.payload.plants[0].transcript, '[redacted]');
    assert.equal(redacted.payload.plants[0].local_name, 'x');
  });

  it('truncates a long string rather than writing a wall of text per line', () => {
    const redacted = log._redact({ note: 'a'.repeat(2000) });
    assert.ok(redacted.note.length < 600);
    assert.match(redacted.note, /\[2000\]$/);
  });

  it('flattens an Error to its name and message, not a stack in every field', () => {
    assert.deepEqual(log._redact({ err: new TypeError('bad') }).err, { name: 'TypeError', message: 'bad' });
  });
});

describe('alert throttling', () => {
  beforeEach(() => log._resetAlertState());

  it('sends the first occurrence of an event and suppresses repeats', () => {
    // One broken dependency produces one failure per inbound message. Without
    // this the first outage sends a thousand alerts and every later outage is
    // ignored.
    const now = Date.now();
    assert.equal(log._shouldSend('agent.turn_failed', now), true);
    assert.equal(log._shouldSend('agent.turn_failed', now + 1000), false);
    assert.equal(log._shouldSend('agent.turn_failed', now + 60_000), false);
  });

  it('lets a different event through while one is being suppressed', () => {
    const now = Date.now();
    log._shouldSend('agent.turn_failed', now);
    assert.equal(log._shouldSend('whatsapp.send_failed', now), true);
  });

  it('opens a new window once the old one has passed', () => {
    const now = Date.now();
    log._shouldSend('agent.turn_failed', now);
    assert.equal(log._shouldSend('agent.turn_failed', now + 60 * 60 * 1000), true);
  });
});

describe('turn queue', () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  };

  it('runs one turn at a time', async () => {
    const queue = new TurnQueue({ concurrency: 1, ackAfterMs: 10_000 });
    let running = 0;
    let peak = 0;

    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 5));
      running--;
    };

    await Promise.all(['a', 'b', 'c'].map(key => queue.run(key, task)));
    assert.equal(peak, 1);
  });

  it('keeps one practitioner in order and never concurrent', async () => {
    // The second message of a burst must see the effect of the first.
    const queue = new TurnQueue({ concurrency: 4, ackAfterMs: 10_000 });
    const order = [];
    let concurrent = 0;
    let overlapped = false;

    const task = label => async () => {
      concurrent++;
      if (concurrent > 1) overlapped = true;
      await new Promise(r => setTimeout(r, 5));
      order.push(label);
      concurrent--;
    };

    await Promise.all([queue.run('p1', task(1)), queue.run('p1', task(2)), queue.run('p1', task(3))]);

    assert.deepEqual(order, [1, 2, 3]);
    assert.equal(overlapped, false);
  });

  it('does not let one busy practitioner block everyone behind them', async () => {
    const queue = new TurnQueue({ concurrency: 1, ackAfterMs: 10_000 });
    const slow = deferred();
    const finished = [];

    const first = queue.run('p1', () => slow.promise.then(() => finished.push('p1-first')));
    // Same key: must wait for the one above.
    const second = queue.run('p1', async () => finished.push('p1-second'));
    // Different key: must not be stuck behind p1 once a slot frees.
    const other = queue.run('p2', async () => finished.push('p2'));

    slow.resolve();
    await Promise.all([first, second, other]);

    assert.ok(finished.indexOf('p1-first') < finished.indexOf('p1-second'));
    assert.ok(finished.includes('p2'));
  });

  it('tells a practitioner they are waiting rather than leaving a silent chat', async () => {
    // The wait is measured against an injected clock rather than Date.now().
    // The ack fires from a setTimeout while the figure it reports came from a
    // wall clock, and at a 5ms threshold those two disagree often enough to
    // fail: it reported 4ms in 2 runs out of 300 here, and once in CI. Driving
    // the clock makes the reported figure exact instead of approximately right.
    let clock = 0;
    const queue = new TurnQueue({ concurrency: 1, ackAfterMs: 5, now: () => clock });
    const slow = deferred();
    const acked = [];

    const first = queue.run('p1', () => slow.promise);
    const second = queue.run('p2', async () => {}, { onWait: waited => acked.push(waited) });
    // Set before yielding, so the ack timer cannot fire ahead of it.
    clock = 30;

    await new Promise(r => setTimeout(r, 25));
    slow.resolve();
    await Promise.all([first, second]);

    assert.equal(acked.length, 1, 'the practitioner kept waiting is told exactly once');
    assert.equal(acked[0], 30, 'and told how long they have actually been waiting');
  });

  it('does not acknowledge a turn that starts immediately', async () => {
    const queue = new TurnQueue({ concurrency: 1, ackAfterMs: 50 });
    const acked = [];
    await queue.run('p1', async () => {}, { onWait: () => acked.push(1) });
    await new Promise(r => setTimeout(r, 80));
    assert.equal(acked.length, 0);
  });

  it('rejects rather than accepting work it will never get to', async () => {
    const queue = new TurnQueue({ concurrency: 1, maxDepth: 2, ackAfterMs: 10_000 });
    const slow = deferred();
    const first = queue.run('p1', () => slow.promise);
    const second = queue.run('p2', async () => {});

    await assert.rejects(() => queue.run('p3', async () => {}), /queue is full/i);

    slow.resolve();
    await Promise.all([first, second]);
  });

  it('surfaces a task failure to its own caller only', async () => {
    const queue = new TurnQueue({ concurrency: 1, ackAfterMs: 10_000 });
    const ok = queue.run('p2', async () => 'fine');
    await assert.rejects(() => queue.run('p1', async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await ok, 'fine');
  });
});

describe('operator accounts', () => {
  const PASSWORD = 'a-sufficiently-long-password';
  let entry;

  beforeEach(() => {
    entry = adminAccounts.hashPassword(PASSWORD);
    delete process.env.ADMIN_PASSWORD;
  });
  afterEach(() => {
    delete process.env.ADMIN_ACCOUNTS;
    delete process.env.ADMIN_PASSWORD;
  });

  it('stores a hash, never the password', () => {
    assert.match(entry, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.ok(!entry.includes(PASSWORD));
  });

  it('returns the account reference so attribution comes from the session', () => {
    process.env.ADMIN_ACCOUNTS = `felix:OP-4C21:${entry}`;
    assert.deepEqual(adminAccounts.authenticate('felix', PASSWORD), { username: 'felix', ref: 'OP-4C21', legacy: false });
  });

  it('rejects a wrong password and an unknown user', () => {
    process.env.ADMIN_ACCOUNTS = `felix:OP-4C21:${entry}`;
    assert.equal(adminAccounts.authenticate('felix', 'wrong'), null);
    assert.equal(adminAccounts.authenticate('someone-else', PASSWORD), null);
  });

  it('refuses an account whose reference identifies a person', () => {
    // The reference ends up in committed records. A name there is a leak.
    for (const ref of ['felix', 'Baba Ade', 'ade@example.com', '+2348012345678']) {
      process.env.ADMIN_ACCOUNTS = `felix:${ref}:${entry}`;
      assert.equal(adminAccounts.authenticate('felix', PASSWORD), null, ref);
    }
  });

  it('keeps several operators apart', () => {
    const second = adminAccounts.hashPassword('another-long-password');
    process.env.ADMIN_ACCOUNTS = `felix:OP-4C21:${entry};ada:RT-A1B2:${second}`;
    assert.equal(adminAccounts.authenticate('felix', PASSWORD).ref, 'OP-4C21');
    assert.equal(adminAccounts.authenticate('ada', 'another-long-password').ref, 'RT-A1B2');
    assert.equal(adminAccounts.authenticate('ada', PASSWORD), null);
  });

  it('still admits the legacy single password, and marks it as unattributed', () => {
    process.env.ADMIN_PASSWORD = 'legacy-password';
    const operator = adminAccounts.authenticate('felix', 'legacy-password');
    assert.equal(operator.legacy, true);
    assert.equal(operator.ref, 'OP-LEGACY');
  });

  it('reports itself unconfigured when neither is set, so the route can refuse', () => {
    assert.equal(adminAccounts.configured(), false);
  });
});

describe('secret scanning', () => {
  it('catches the key shapes this project actually uses', () => {
    const cases = [
      `const k = "sk-ant-api03-${'A'.repeat(40)}"`,
      `SUPABASE_KEY=${['eyJ' + 'A'.repeat(20), 'eyJ' + 'B'.repeat(20), 'C'.repeat(20)].join('.')}`,
      ['DATABASE_URL=postgresql://admin:', 'test-password', '@db.example.com:5432/sanko'].join(''),
      ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' '),
    ];
    for (const line of cases) assert.equal(scan('x', line).length, 1, line);
  });

  it('leaves placeholders and documented local defaults alone', () => {
    // A scanner that fires on .env.example teaches everyone to skip it.
    const cases = [
      'ANTHROPIC_API_KEY=sk-ant-your-key-here-0000000000000000',
      'psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
      '<img src="data:image/png;base64,iVBORw0KGgoEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA">',
    ];
    for (const line of cases) assert.equal(scan('x', line).length, 0, line);
  });

  it('reports the line number so the finding can be acted on', () => {
    const [finding] = scan('config.js', `line one\nline two\nconst k = "sk-ant-api03-${'A'.repeat(30)}"`);
    assert.equal(finding.line, 3);
    assert.equal(finding.file, 'config.js');
  });
});

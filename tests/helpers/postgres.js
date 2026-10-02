'use strict';

// psql-backed stand-ins for the portal stores, shared by the care and evidence
// PostgreSQL suites. Each suite points them at its own disposable database and
// may only call functions carrying its own prefix.

const { execFile } = require('node:child_process');

const literal = value => (value == null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'");

function createPostgres(url, rpcPrefix) {
  const allowed = new RegExp(`^${rpcPrefix}[a-z_]+$`);

  function sql(query) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'psql',
        [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
        { maxBuffer: 5 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const match = /ERROR:\s+([^\n]+)/.exec(stderr);
            reject(new Error(match?.[1] ?? 'POSTGRES_TEST_FAILED'));
          } else resolve(stdout.trim());
        },
      );
      child.stdin.end(query);
    });
  }

  async function rpc(name, args) {
    if (!allowed.test(name)) throw new Error('INVALID_RPC');
    const params = Object.entries(args)
      .map(([k, v]) => {
        const value = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
        return `${k} => ${literal(value)}`;
      })
      .join(',');
    const result = await sql(`select ${name}(${params});`);
    if (!result) return null;
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }

  return { sql, rpc };
}

module.exports = { createPostgres, literal };

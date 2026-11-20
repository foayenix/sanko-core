'use strict';

// psql-backed stand-ins for the portal stores, shared by the care and evidence
// PostgreSQL suites. Each suite points them at its own disposable database and
// may only call functions carrying its own prefix, plus the shared portal_ ones.

const { execFile, execFileSync } = require('node:child_process');

const literal = value => (value == null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'");

function createPostgres(url, rpcPrefix) {
  const allowed = new RegExp(`^(${rpcPrefix}|portal_)[a-z_]+$`);

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

// The migrations grant to Supabase's roles. Roles are cluster-wide, so the
// disposable-database runners create any that are missing (as CI does) before
// migrating, instead of requiring manual setup on a plain local PostgreSQL.
const SUPABASE_ROLES = [
  ['anon', ''],
  ['authenticated', ''],
  ['service_role', ' bypassrls'],
];

function ensureSupabaseRoles(url) {
  const body = SUPABASE_ROLES.map(
    ([role, opts]) =>
      `if not exists (select 1 from pg_roles where rolname = '${role}') ` +
      `then create role ${role}${opts}; end if;`,
  ).join('\n');
  const query = `do $$ begin\n${body}\nend $$`;
  execFileSync('psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', '-c', query], { stdio: 'pipe' });
}

module.exports = { createPostgres, ensureSupabaseRoles, literal };

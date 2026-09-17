#!/usr/bin/env node
// Generate an ADMIN_ACCOUNTS entry.
//
//   npm run admin:account -- felix OP-4C21
//
// Prints one line to append to ADMIN_ACCOUNTS in .env. The password is read from
// the terminal rather than taken as an argument, so it does not land in shell
// history or in the process list where any other user on the machine can see it.
//
// What is stored is a scrypt hash. The env file never holds a usable password,
// which matters because .env is read by every script in this repository.

const readline = require('readline');
const { hashPassword, REF } = require('../src/utils/adminAccounts');

const [username, ref] = process.argv.slice(2);

if (!username || !ref) {
  console.error('\nUsage: npm run admin:account -- <username> <REF>\n');
  console.error('  <REF> is a stable pseudonym such as OP-4C21 — never a name, phone');
  console.error('  number or email. Every correction, plant confirmation and promotion');
  console.error('  this operator records is attributed to it, and it is committed to the');
  console.error('  repository in some of those records. Keep the mapping from reference');
  console.error('  to person outside this repository.\n');
  process.exit(1);
}
if (!REF.test(ref)) {
  console.error(`\n"${ref}" is not a pseudonymous reference. Expected something like OP-4C21.\n`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Suppress echo while the password is typed.
const write = rl._writeToOutput?.bind(rl);
let hide = false;
rl._writeToOutput = string => { if (!hide) write?.(string); };

rl.question(`Password for ${username} (${ref}): `, password => {
  hide = false;
  rl.close();
  console.log('');

  if (password.length < 12) {
    console.error('\nUse at least 12 characters. This guards the whole Vault.\n');
    process.exit(1);
  }

  console.log('\nAppend this to ADMIN_ACCOUNTS in .env (entries are separated by ";"):\n');
  console.log(`${username}:${ref}:${hashPassword(password)}\n`);
  console.log('Then remove ADMIN_PASSWORD once every operator has an entry — while it is');
  console.log('set, anyone who knows it can act as an unattributed operator.\n');
});
hide = true;

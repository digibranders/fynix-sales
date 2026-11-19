import path from 'node:path';
import { generatePassword, hashPassword } from './auth.js';
import { loadConfig } from './config.js';
import { newId, one, openDb, run } from './db.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creates a superadmin with a one-time password that must be changed at first sign-in. */
async function main(): Promise<void> {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase() ?? '';
  const name = nameParts.join(' ').trim();
  if (!EMAIL.test(email) || name.length < 2) {
    throw new Error('Usage: npm run create-admin -- <email> <full name>');
  }

  const db = await openDb(loadConfig().databaseUrl);
  try {
    if (await one(db, 'SELECT 1 AS x FROM users WHERE email = ?', [email])) {
      throw new Error(`${email} already has an account.`);
    }
    const password = generatePassword();
    await run(
      db,
      `INSERT INTO users (id, name, email, password_hash, role, category, active, must_change_password, created_at)
       VALUES (?, ?, ?, ?, 'superadmin', NULL, 1, 1, ?)`,
      [newId(), name, email, await hashPassword(password), Date.now()],
    );
    console.log(`Created superadmin ${name} <${email}>`);
    console.log(`Temporary password: ${password}`);
    console.log('They must choose a new password at first sign-in.');
  } finally {
    await db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

import path from 'node:path';
import { INVITE_DAYS, NO_PASSWORD, createInvite } from './auth.js';
import { loadConfig } from './config.js';
import { newId, one, openDb, run } from './db.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creates a superadmin and prints a one-time link for them to choose their own password. */
async function main(): Promise<void> {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase() ?? '';
  const name = nameParts.join(' ').trim();
  if (!EMAIL.test(email) || name.length < 2) {
    throw new Error('Usage: npm run create-admin -- <email> <full name>');
  }

  const config = loadConfig();
  const db = await openDb(config.databaseUrl);
  try {
    if (await one(db, 'SELECT 1 AS x FROM users WHERE email = ?', [email])) {
      throw new Error(`${email} already has an account.`);
    }
    const id = newId();
    await run(
      db,
      `INSERT INTO users (id, name, email, password_hash, role, category, active, must_change_password, created_at)
       VALUES (?, ?, ?, ?, 'superadmin', NULL, 1, 0, ?)`,
      [id, name, email, NO_PASSWORD, Date.now()],
    );
    const invite = await createInvite(db, id);
    console.log(`Created superadmin ${name} <${email}>`);
    console.log(`Invite link (works once, expires in ${INVITE_DAYS} days):`);
    console.log(`${config.appUrl}/invite/${invite.token}`);
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

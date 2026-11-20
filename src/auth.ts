import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Category, Db } from './db.js';
import { newId, one, run } from './db.js';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'ld_session';
const KEY_LENGTH = 64;
const DAY_MS = 86_400_000;

/** Superadmins run everything, managers only look at the team and the leads, salespeople work leads. */
export type Role = 'superadmin' | 'manager' | 'sales';

export function homeForRole(role: Role): string {
  if (role === 'superadmin') return '/admin';
  return role === 'manager' ? '/manager' : '/app';
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  category: Category | null;
  mustChangePassword: boolean;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  category: Category | null;
  must_change_password: number;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(14);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const INVITE_DAYS = 7;
/** Stored for people who have not chosen a password yet. It is not a valid scrypt hash, so no password can ever match it. */
export const NO_PASSWORD = 'invite-pending';
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export interface InviteInfo {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  /** True when the person already has a password, so the link is a reset rather than a first sign-up. */
  reset: boolean;
  expiresAt: number;
}

/** Makes a fresh one-time link for a person. Any link they had not used yet stops working. */
export async function createInvite(db: Db, userId: string, days = INVITE_DAYS): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + days * DAY_MS;
  await run(db, 'DELETE FROM invites WHERE user_id = ? AND used_at IS NULL', [userId]);
  await run(db, 'INSERT INTO invites (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', [newId(), userId, hashToken(token), expiresAt, Date.now()]);
  return { token, expiresAt };
}

/** The invite behind a link, or null when it is unknown, used, expired, or the person was deactivated. */
export async function findInvite(db: Db, token: string): Promise<InviteInfo | null> {
  if (!INVITE_TOKEN.test(token)) return null;
  const row = await one<{ id: string; expires_at: number; user_id: string; name: string; email: string; role: Role; password_hash: string }>(
    db,
    `SELECT i.id, i.expires_at, u.id AS user_id, u.name, u.email, u.role, u.password_hash
       FROM invites i JOIN users u ON u.id = i.user_id
      WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > ? AND u.active = 1`,
    [hashToken(token), Date.now()],
  );
  if (!row) return null;
  return { id: row.id, userId: row.user_id, name: row.name, email: row.email, role: row.role, reset: row.password_hash !== NO_PASSWORD, expiresAt: row.expires_at };
}

export async function createSession(db: Db, userId: string, days: number): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + days * DAY_MS;
  await run(db, 'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hashToken(token), userId, expiresAt]);
  await run(db, 'DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  return { token, expiresAt };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await run(db, 'DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

export async function destroyUserSessions(db: Db, userId: string): Promise<void> {
  await run(db, 'DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export async function userForSession(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await one<UserRow>(
    db,
    `SELECT u.id, u.name, u.email, u.role, u.category, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    [hashToken(token), Date.now()],
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    category: row.category,
    mustChangePassword: row.must_change_password === 1,
  };
}

/** Allows a handful of failed sign-ins per address and client, then makes the caller wait. */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; first: number }>();

  constructor(
    private readonly maxFailures = 6,
    private readonly windowMs = 15 * 60_000,
  ) {}

  blocked(key: string): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (Date.now() - entry.first > this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  fail(key: string): void {
    const entry = this.failures.get(key);
    if (!entry || Date.now() - entry.first > this.windowMs) {
      this.failures.set(key, { count: 1, first: Date.now() });
    } else {
      entry.count += 1;
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

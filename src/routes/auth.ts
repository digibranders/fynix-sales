import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { homeFor } from '../app.js';
import {
  INVITE_DAYS,
  INVITE_TOKEN,
  SESSION_COOKIE,
  createInvite,
  createSession,
  destroySession,
  destroyUserSessions,
  findInvite,
  hashPassword,
  homeForRole,
  verifyPassword,
} from '../auth.js';
import type { Role } from '../auth.js';
import { all, one, run, tx } from '../db.js';
import { HttpError, initials } from '../domain.js';
import { inviteEmail } from '../mailer.js';

const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(3).max(200),
  password: z.string().min(1).max(200),
  remember: z.boolean().default(true),
});

const nameBody = z.object({ name: z.string().trim().min(2, 'Enter your full name.').max(80, 'That name is too long.') });

const changeBody = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(10, 'Use at least 10 characters.').max(200),
});

interface UserAuthRow {
  id: string;
  name: string;
  password_hash: string;
  role: Role;
  must_change_password: number;
}

// A real hash of a throwaway password, so a missing account takes as long to check as a wrong password.
const DUMMY_HASH =
  'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

/** Without "remember me" the cookie is dropped when the browser closes and the session itself lasts a day. */
function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string, expiresAt: number, persistent = true): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.production,
    ...(persistent ? { expires: new Date(expiresAt) } : {}),
  });
}

const forgotBody = z.object({ email: z.string().trim().toLowerCase().min(3, 'Enter your email address.').max(200) });
const inviteBody = z.object({ password: z.string().min(10, 'Use at least 10 characters.').max(200) });
const INVITE_GONE = new HttpError(404, 'invite_invalid', 'This invite link has expired or was already used. Ask your admin for a new one.');

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, limiter, inviteLimiter, forgotIpLimiter, forgotEmailLimiter, mailer } = ctx;

  /** What the invite page shows: who the link is for. Tells nothing about anyone else. */
  app.get<{ Params: { token: string } }>('/api/auth/invite/:token', async (request) => {
    const key = `invite|${request.ip}`;
    if (inviteLimiter.blocked(key)) throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Wait a few minutes and try again.');
    const invite = await findInvite(db, request.params.token);
    if (!invite) {
      inviteLimiter.fail(key);
      throw INVITE_GONE;
    }
    return { name: invite.name, email: invite.email, reset: invite.reset, expiresAt: invite.expiresAt };
  });

  /**
   * "Forgot password": emails a one-time link to a known, active address. The answer is the same whether or not the
   * address has an account, and every request counts against the limits, so this cannot be used to find out who has
   * one or to flood someone's inbox. The email is sent after replying so the response time gives nothing away either.
   */
  app.post('/api/auth/forgot', async (request) => {
    const { email } = forgotBody.parse(request.body);
    const ipKey = `forgot|${request.ip}`;
    if (forgotIpLimiter.blocked(ipKey) || forgotEmailLimiter.blocked(email)) {
      throw new HttpError(429, 'too_many_attempts', 'Too many requests. Wait a while and try again.');
    }
    forgotIpLimiter.fail(ipKey);
    forgotEmailLimiter.fail(email);
    if (!mailer.enabled) return { ok: true, emailed: false };
    const user = await one<{ id: string; name: string; email: string; last_login_at: number | null }>(
      db,
      'SELECT id, name, email, last_login_at FROM users WHERE email = ? AND active = 1',
      [email],
    );
    if (user) {
      const invite = await createInvite(db, user.id);
      void mailer.send(
        inviteEmail({
          name: user.name,
          email: user.email,
          invitedBy: '',
          link: `${config.appUrl}/invite/${invite.token}`,
          reset: user.last_login_at !== null,
          days: INVITE_DAYS,
          selfRequested: true,
        }),
      );
    }
    return { ok: true, emailed: true };
  });

  /** Uses the link once: sets the password, ends any older sessions, and signs the person in. */
  app.post<{ Params: { token: string } }>('/api/auth/invite/:token', async (request, reply) => {
    const key = `invite|${request.ip}`;
    if (inviteLimiter.blocked(key)) throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Wait a few minutes and try again.');
    const body = inviteBody.parse(request.body);
    if (!INVITE_TOKEN.test(request.params.token)) {
      inviteLimiter.fail(key);
      throw INVITE_GONE;
    }
    const passwordHash = await hashPassword(body.password);
    const invite = await tx(db, async (db) => {
      const found = await findInvite(db, request.params.token);
      if (!found) return null;
      // The used_at check decides a race: only one of two simultaneous requests gets a row back.
      const claimed = await all<{ id: string }>(db, 'UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL RETURNING id', [Date.now(), found.id]);
      if (claimed.length === 0) return null;
      await run(db, 'UPDATE users SET password_hash = ?, must_change_password = 0, last_login_at = ? WHERE id = ?', [passwordHash, Date.now(), found.userId]);
      await destroyUserSessions(db, found.userId);
      return found;
    });
    if (!invite) {
      inviteLimiter.fail(key);
      throw INVITE_GONE;
    }
    const session = await createSession(db, invite.userId, config.sessionDays);
    setSessionCookie(ctx, reply, session.token, session.expiresAt);
    return { redirect: homeForRole(invite.role) };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginBody.parse(request.body);
    const key = `${request.ip}|${body.email}`;
    if (limiter.blocked(key)) {
      throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts. Wait a few minutes and try again.');
    }
    const row = await one<UserAuthRow>(
      db,
      'SELECT id, name, password_hash, role, must_change_password FROM users WHERE email = ? AND active = 1',
      [body.email],
    );
    const valid = await verifyPassword(body.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !valid) {
      limiter.fail(key);
      throw new HttpError(401, 'invalid_credentials', 'Email or password is not right.');
    }
    limiter.reset(key);
    await run(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), row.id]);
    const session = await createSession(db, row.id, body.remember ? config.sessionDays : 1);
    setSessionCookie(ctx, reply, session.token, session.expiresAt, body.remember);
    const mustChange = row.must_change_password === 1;
    return {
      mustChangePassword: mustChange,
      redirect: mustChange ? '/login' : homeForRole(row.role),
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await destroySession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/logout-all', async (request, reply) => {
    const user = request.user;
    if (!user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
    await destroyUserSessions(db, user.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    const user = request.user;
    if (!user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
    return {
      id: user.id,
      name: user.name,
      ini: initials(user.name),
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      home: homeFor(user),
    };
  });

  /** Lets anyone change how their own name is shown. */
  app.patch('/api/auth/me', async (request) => {
    const user = request.user;
    if (!user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
    const { name } = nameBody.parse(request.body);
    await run(db, 'UPDATE users SET name = ? WHERE id = ?', [name, user.id]);
    return { name, ini: initials(name) };
  });

  app.post('/api/auth/change-password', async (request, reply) => {
    const user = request.user;
    if (!user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
    const body = changeBody.parse(request.body);
    const row = await one<UserAuthRow>(db, 'SELECT id, name, password_hash, role, must_change_password FROM users WHERE id = ?', [user.id]);
    if (!row || !(await verifyPassword(body.current, row.password_hash))) {
      throw new HttpError(400, 'wrong_password', 'The current password is not right.');
    }
    if (body.next === body.current) {
      throw new HttpError(400, 'same_password', 'Pick a password you have not used on this account.');
    }
    await run(db, 'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [await hashPassword(body.next), user.id]);
    await destroyUserSessions(db, user.id);
    const session = await createSession(db, user.id, config.sessionDays);
    setSessionCookie(ctx, reply, session.token, session.expiresAt);
    return { redirect: homeFor(user) };
  });
}

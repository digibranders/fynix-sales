import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { createMailer } from './mailer.js';
import type { Mailer } from './mailer.js';
import type { Db } from './db.js';
import { LoginLimiter, SESSION_COOKIE, homeForRole, userForSession } from './auth.js';
import type { SessionUser } from './auth.js';
import { HttpError } from './domain.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSalesRoutes } from './routes/sales.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerManagerRoutes } from './routes/manager.js';
import { registerReportRoutes } from './routes/reports.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface AppContext {
  db: Db;
  config: Config;
  limiter: LoginLimiter;
  /** Looser than the sign-in limiter: link secrets are too long to guess, and a whole office may share one address. */
  inviteLimiter: LoginLimiter;
  mailer: Mailer;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export function homeFor(user: SessionUser): string {
  return homeForRole(user.role);
}

export async function buildApp(db: Db, config: Config, mailer: Mailer = createMailer(config)): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024, trustProxy: config.production });
  const ctx: AppContext = { db, config, limiter: new LoginLimiter(), inviteLimiter: new LoginLimiter(40), mailer };

  await app.register(cookie);
  await app.register(fastifyStatic, {
    root: path.join(config.webDir, 'assets'),
    prefix: '/assets/',
    maxAge: config.production ? '1h' : 0,
  });

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    request.user = await userForSession(db, request.cookies[SESSION_COOKIE]);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Content-Security-Policy', CSP);
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
      return reply.status(400).send({ error: 'invalid_request', message: `${where}${first?.message ?? 'Invalid request'}` });
    }
    if (error instanceof HttpError) {
      return reply.status(error.status).send({ error: error.code, message: error.message });
    }
    if ((error as { code?: string }).code === '23505') {
      return reply.status(409).send({ error: 'duplicate', message: 'That already exists.' });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.status(status).send({ error: 'bad_request', message: (error as Error).message });
    }
    request.log.error(error);
    console.error(error);
    return reply.status(500).send({ error: 'server_error', message: 'Something went wrong on our side. Please try again.' });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.status(404).send({ error: 'not_found', message: 'Not found.' });
    return reply.status(404).type('text/plain').send('Not found');
  });

  // Page scripts load from a folder named after this release. Browsers and the CDN keep each release's files for
  // a long time, and a new release gets new addresses, so nobody ever runs a page against scripts from another release.
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const release = Date.now().toString(36);
  // Pages are read once in production; in development they are read on every request so edits show up.
  const pageCache = new Map<string, Promise<string>>();
  const loadPage = (file: string): Promise<string> =>
    readFile(path.join(config.webDir, file), 'utf8').then((html) =>
      html.replaceAll('/assets/js/', `/assets/js-${release}/`).replaceAll('/assets/css/', `/assets/css-${release}/`),
    );
  const pageHtml = (file: string): Promise<string> => {
    if (!config.production) return loadPage(file);
    let html = pageCache.get(file);
    if (!html) {
      html = loadPage(file);
      pageCache.set(file, html);
    }
    return html;
  };

  for (const kind of ['js', 'css'] as const) {
    const root = path.join(config.webDir, 'assets', kind);
    app.get<{ Params: { '*': string } }>(`/assets/${kind}-:release/*`, async (request, reply) => {
      return reply.sendFile(request.params['*'], root, config.production ? { maxAge: ONE_YEAR_MS, immutable: true } : { maxAge: 0 });
    });
  }

  const page = (file: string, roles: SessionUser['role'][] | null) => async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (roles !== null) {
      if (!user || user.mustChangePassword) return reply.redirect('/login');
      if (!roles.includes(user.role)) return reply.redirect(homeFor(user));
    } else if (user && !user.mustChangePassword) {
      return reply.redirect(homeFor(user));
    }
    reply.header('Cache-Control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(await pageHtml(file));
  };

  app.get('/', async (request, reply) => {
    const user = request.user;
    return reply.redirect(user && !user.mustChangePassword ? homeFor(user) : '/login');
  });
  app.get('/login', page('login.html', null));
  app.get('/app', page('sales.html', ['sales']));
  app.get('/admin', page('admin.html', ['superadmin']));
  app.get('/manager', page('manager.html', ['manager']));
  app.get<{ Params: { token: string } }>('/invite/:token', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex');
    return reply.type('text/html; charset=utf-8').send(await pageHtml('invite.html'));
  });
  app.get('/health', async () => ({ ok: true }));

  app.get('/favicon.ico', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.type('image/x-icon').send(await readFile(path.join(config.webDir, 'favicon.ico')));
  });

  registerAuthRoutes(app, ctx);
  registerSalesRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerManagerRoutes(app, ctx);
  registerReportRoutes(app, ctx);

  return app;
}

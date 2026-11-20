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
  /** Reset-link requests: a few per address and more per connection, whether or not the account exists. */
  forgotIpLimiter: LoginLimiter;
  forgotEmailLimiter: LoginLimiter;
  mailer: Mailer;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/**
 * Sent with every page and repeated in each page's meta tags. There is deliberately no robots.txt: it would only
 * announce the site, and it stops crawlers from reading this instruction.
 */
const NO_INDEX = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

export function homeFor(user: SessionUser): string {
  return homeForRole(user.role);
}

export async function buildApp(db: Db, config: Config, mailer: Mailer = createMailer(config)): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024, trustProxy: config.production });
  const ctx: AppContext = { db, config, limiter: new LoginLimiter(), inviteLimiter: new LoginLimiter(40), forgotIpLimiter: new LoginLimiter(10), forgotEmailLimiter: new LoginLimiter(3, 60 * 60_000), mailer };

  await app.register(cookie);
  await app.register(fastifyStatic, {
    root: path.join(config.webDir, 'assets'),
    prefix: '/assets/',
    maxAge: config.production ? '1h' : 0,
    // The category list is large and almost never changes, so browsers keep it for a week instead of asking again.
    setHeaders: (res, filePath) => {
      if (config.production && filePath.endsWith('gbc.json')) res.header('Cache-Control', 'public, max-age=604800');
    },
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

  // The signed-in pages carry their first data inside the HTML, which saves one full round trip before anything is drawn.
  const EMBEDDED: Record<string, string> = {
    'sales.html': '/api/sales/bootstrap',
    'admin.html': '/api/admin/bootstrap',
    'manager.html': '/api/manager/bootstrap',
  };
  /** Makes JSON safe inside a <script> element: nothing in it can close the element or open a comment. */
  const scriptSafe = (json: string): string => json.replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

  const page = (file: string, roles: SessionUser['role'][] | null) => async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (roles !== null) {
      if (!user || user.mustChangePassword) return reply.redirect('/login');
      if (!roles.includes(user.role)) return reply.redirect(homeFor(user));
    } else if (user && !user.mustChangePassword) {
      return reply.redirect(homeFor(user));
    }
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', NO_INDEX);
    let html = await pageHtml(file);
    const dataUrl = EMBEDDED[file];
    if (dataUrl && request.headers.cookie) {
      const data = await app.inject({ method: 'GET', url: dataUrl, headers: { cookie: request.headers.cookie } });
      if (data.statusCode === 200) {
        const tag = `<script type="application/json" id="boot">${scriptSafe(data.body)}</script>\n</body>`;
        html = html.replace('</body>', () => tag);
      }
    }
    return reply.type('text/html; charset=utf-8').send(html);
  };

  app.get('/', async (request, reply) => {
    const user = request.user;
    return reply.redirect(user && !user.mustChangePassword ? homeFor(user) : '/login');
  });
  app.get('/login', page('login.html', null));
  app.get('/mockup', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(await pageHtml('mockup-apple-hello.html'));
  });
  app.get('/app', page('sales.html', ['sales']));
  app.get('/admin', page('admin.html', ['superadmin']));
  app.get('/manager', page('manager.html', ['manager']));
  app.get<{ Params: { token: string } }>('/invite/:token', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', NO_INDEX);
    return reply.type('text/html; charset=utf-8').send(await pageHtml('invite.html'));
  });
  app.get('/health', async () => ({ ok: true }));

  app.get('/manifest.json', async (_request, reply) => {
    reply.header('Cache-Control', config.production ? 'public, max-age=3600' : 'no-cache');
    return reply.type('application/manifest+json; charset=utf-8').send(await readFile(path.join(config.webDir, 'manifest.json'), 'utf8'));
  });

  app.get('/sw.js', async (_request, reply) => {
    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    reply.header('Content-Type', 'application/javascript; charset=utf-8');
    reply.header('Service-Worker-Allowed', '/');
    return reply.send(await readFile(path.join(config.webDir, 'sw.js'), 'utf8'));
  });

  const offlineHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(await readFile(path.join(config.webDir, 'offline.html'), 'utf8'));
  };
  app.get('/offline.html', offlineHandler);
  app.get('/offline', offlineHandler);

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

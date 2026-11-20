import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { openDb } from '../src/db.js';

let app: FastifyInstance;
let db: Db;

describe('pwa support', () => {
  before(async () => {
    db = await openDb(':memory:');
    app = await buildApp(db, { ...loadConfig(), databaseUrl: ':memory:', production: false });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await db.close();
  });

  it('serves web app manifest with correct headers and structure', async () => {
    const res = await app.inject({ method: 'GET', url: '/manifest.json' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] ?? '', /application\/manifest\+json/);

    const manifest = JSON.parse(res.body);
    assert.equal(manifest.name, 'Fynix Sales');
    assert.equal(manifest.short_name, 'Fynix');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.ok(Array.isArray(manifest.icons));
    assert.ok(manifest.icons.length >= 2);

    const has192 = manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192');
    const has512 = manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512');
    const hasMaskable = manifest.icons.some((i: { purpose?: string }) => i.purpose?.includes('maskable'));

    assert.ok(has192, 'Manifest should include 192x192 icon');
    assert.ok(has512, 'Manifest should include 512x512 icon');
    assert.ok(hasMaskable, 'Manifest should include maskable icon');
  });

  it('serves service worker script with Service-Worker-Allowed header and no-cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/sw.js' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] ?? '', /javascript/);
    assert.equal(res.headers['service-worker-allowed'], '/');
    assert.match(res.headers['cache-control'] ?? '', /no-cache|no-store/);
    assert.ok(res.body.includes('addEventListener'));
    assert.ok(res.body.includes('offline.html'));
  });

  it('serves offline fallback page', async () => {
    const res = await app.inject({ method: 'GET', url: '/offline.html' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] ?? '', /text\/html/);
    assert.ok(res.body.includes('You are offline'));
  });

  it('includes CSP directives for workers and manifest', async () => {
    const res = await app.inject({ method: 'GET', url: '/login' });
    assert.equal(res.statusCode, 200);
    const csp = res.headers['content-security-policy'] ?? '';
    assert.match(csp, /manifest-src 'self'/);
    assert.match(csp, /worker-src 'self'/);
  });

  it('includes manifest and mobile meta tags in HTML shell', async () => {
    const res = await app.inject({ method: 'GET', url: '/login' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('rel="manifest"'));
    assert.ok(res.body.includes('name="mobile-web-app-capable" content="yes"'));
    assert.ok(res.body.includes('name="apple-mobile-web-app-capable" content="yes"'));
    assert.ok(res.body.includes('name="theme-color"'));
    assert.ok(res.body.includes('rel="apple-touch-icon"'));
  });

  it('serves static icons and favicon', async () => {
    const iconRes = await app.inject({ method: 'GET', url: '/assets/icons/icon-192.png' });
    assert.equal(iconRes.statusCode, 200);
    assert.match(iconRes.headers['content-type'] ?? '', /image\/png/);

    const favRes = await app.inject({ method: 'GET', url: '/favicon.ico' });
    assert.equal(favRes.statusCode, 200);
  });
});

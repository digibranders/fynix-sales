import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { openDb } from '../src/db.js';
import { sampleScaleCsv, seedDatabase } from '../src/seed.js';
import { parseLeadsCsv } from '../src/importer.js';

const PASSWORD = 'test-password-123';

let app: FastifyInstance;
let db: Db;

async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = res.cookies.find((c) => c.name === 'ld_session');
  assert.ok(cookie, 'session cookie should be set');
  return `ld_session=${cookie.value}`;
}

async function call(cookie: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : {} };
}

before(async () => {
  db = await openDb(':memory:');
  await seedDatabase(db, PASSWORD); // uses sampleScaleCsv() by default
  app = await buildApp(db, { ...loadConfig(), databaseUrl: ':memory:', production: false });
});

after(async () => {
  await app.close();
  await db.close();
});

describe('Scale B2B leads data & views', () => {
  it('parses Scale CSV format with Karun Paruthi and company details', () => {
    const csv = sampleScaleCsv();
    const result = parseLeadsCsv(csv);
    assert.ok(result.leads.length >= 10);
    const karun = result.leads.find((l) => l.name === 'Karun Paruthi');
    assert.ok(karun);
    assert.equal(karun.name, 'Karun Paruthi');
    assert.equal(karun.company, 'WeRoute Solutions');
    assert.equal(karun.jobTitle, 'Co-Founder');
    assert.equal(karun.emails[0], 'kp@weroute.ai');
    assert.equal(karun.personalNumber, '+91 98201 12345');
    assert.equal(karun.city, 'Bengaluru');
    assert.ok(karun.keywords.includes('manpower'));
    assert.equal(karun.linkedinUrl, 'https://www.linkedin.com/in/karun-paruthi');
  });

  it('exposes Scale B2B fields to Scale salesperson via bootstrap', async () => {
    const priya = await login('priya@fynix.test');
    const res = await call(priya, 'GET', '/api/sales/bootstrap');
    assert.equal(res.status, 200);
    assert.equal(res.body['category'], 'scale');

    const leads = res.body['leads'] as Array<Record<string, unknown>>;
    assert.ok(leads.length > 0);
    const karun = leads.find((l) => l['name'] === 'Karun Paruthi');
    assert.ok(karun, 'Karun Paruthi should be in Scale leads');
    assert.equal(karun['company'], 'WeRoute Solutions');
    assert.equal(karun['title'], 'Co-Founder');
    assert.equal(karun['personalNumber'], '+91 98201 12345');
    assert.ok((karun['email'] as string[]).includes('kp@weroute.ai'));
    assert.ok(String(karun['keywords']).includes('manpower'));
    assert.equal(karun['linkedin'], 'https://www.linkedin.com/in/karun-paruthi');
  });

  it('preserves Reach local store leads for Reach salesperson', async () => {
    const aisha = await login('aisha@fynix.test');
    const res = await call(aisha, 'GET', '/api/sales/bootstrap');
    assert.equal(res.status, 200);
    assert.equal(res.body['category'], 'reach');

    const leads = res.body['leads'] as Array<Record<string, unknown>>;
    assert.ok(leads.length > 0);
    assert.ok(leads.every((l) => String(l['name']).startsWith('Sample')));
  });

  it('returns company and title in Admin leads API when viewing Scale category', async () => {
    const aarav = await login('aarav@fynix.test');
    const res = await call(aarav, 'GET', '/api/admin/leads?category=scale');
    assert.equal(res.status, 200);

    const leads = res.body['leads'] as Array<Record<string, unknown>>;
    assert.ok(leads.length > 0);
    const karun = leads.find((l) => l['name'] === 'Karun Paruthi');
    assert.ok(karun);
    assert.equal(karun['company'], 'WeRoute Solutions');
    assert.equal(karun['jobTitle'], 'Co-Founder');
    assert.equal(karun['personalNumber'], '+91 98201 12345');
  });
});

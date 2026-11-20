import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { openDb } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';
const CSV = ['title,category,address,phone,website,place_id', 'Alpha Jewellers,Jewelry store,"Khar West, Mumbai",9820011111,https://alpha.example,p1', 'Beta Diamonds,Jewelry store,"Khar East, Mumbai",9820022222,,p2'].join('\n');

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

interface Bootstrap {
  categories: Record<string, unknown>;
  workspaces: { category: string }[];
  people: { name: string; category: string | null; stats: { assigned: number }; email?: string }[];
}
interface LeadsPage {
  total: number;
  leads: { category: string }[];
}

before(async () => {
  db = await openDb(':memory:');
  await seedDatabase(db, PASSWORD, { jewelleryCsv: CSV });
  app = await buildApp(db, { ...loadConfig(), databaseUrl: ':memory:', production: false });
});

after(async () => {
  await app.close();
  await db.close();
});

/** A superadmin invites a manager, who opens the link and chooses a password. */
async function inviteManager(name: string, email: string, category?: 'scale' | 'reach'): Promise<string> {
  const aarav = await login('aarav@fynix.test');
  const created = await call(aarav, 'POST', '/api/admin/users', { name, email, role: 'manager', ...(category ? { category } : {}) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const token = String(created.body['inviteUrl']).split('/').pop() ?? '';
  const accepted = await app.inject({ method: 'POST', url: `/api/auth/invite/${token}`, payload: { password: 'a-better-password-9' } });
  assert.equal(accepted.statusCode, 200);
  assert.equal(JSON.parse(accepted.body).redirect, '/manager');
  return `ld_session=${accepted.cookies[0]?.value ?? ''}`;
}

describe('manager', () => {
  it('goes to the manager page, and other roles stay out of it', async () => {
    const nisha = await login('nisha@fynix.test');
    assert.equal((await app.inject({ method: 'GET', url: '/manager', headers: { cookie: nisha } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/admin', headers: { cookie: nisha } })).headers.location, '/manager');
    assert.equal((await app.inject({ method: 'GET', url: '/app', headers: { cookie: nisha } })).headers.location, '/manager');
    assert.equal((await app.inject({ method: 'GET', url: '/', headers: { cookie: nisha } })).headers.location, '/manager');
    assert.equal((await app.inject({ method: 'GET', url: '/manager', headers: { cookie: await login('priya@fynix.test') } })).headers.location, '/app');
    assert.equal((await app.inject({ method: 'GET', url: '/manager', headers: { cookie: await login('aarav@fynix.test') } })).headers.location, '/admin');
    assert.equal((await app.inject({ method: 'GET', url: '/manager' })).headers.location, '/login');
  });

  it('can only read: every admin and sales API refuses a manager', async () => {
    const nisha = await login('nisha@fynix.test');
    for (const [method, url, payload] of [
      ['GET', '/api/admin/bootstrap'],
      ['GET', '/api/admin/leads'],
      ['POST', '/api/admin/users', { name: 'Sneaky Person', email: 'sneaky@fynix.test', role: 'superadmin' }],
      ['PUT', '/api/admin/targets', { category: 'scale', contacted: 1, won: 1 }],
      ['GET', '/api/sales/bootstrap'],
      ['POST', '/api/sales/claims', {}],
    ] as const) {
      assert.equal((await call(nisha, method, url, payload)).status, 403, `${method} ${url}`);
    }
    assert.equal((await call('', 'GET', '/api/manager/bootstrap')).status, 401);
    // and salespeople cannot use the manager API
    assert.equal((await call(await login('priya@fynix.test'), 'GET', '/api/manager/bootstrap')).status, 403);
  });

  it('sees both categories when none was chosen, with salespeople but never email addresses or admins', async () => {
    const res = await call(await login('nisha@fynix.test'), 'GET', '/api/manager/bootstrap');
    assert.equal(res.status, 200);
    const data = res.body as unknown as Bootstrap;
    assert.deepEqual(Object.keys(data.categories).sort(), ['reach', 'scale']);
    const names = data.people.map((p) => p.name);
    assert.ok(names.includes('Priya Sharma') && names.includes('Aisha Khan'));
    assert.ok(!names.includes('Aarav Kapoor') && !names.includes('Nisha Verma'), 'superadmins and managers are not listed');
    assert.ok(data.people.every((p) => !('email' in p)));
    const leads = (await call(await login('nisha@fynix.test'), 'GET', '/api/manager/leads')).body as unknown as LeadsPage;
    assert.ok(leads.total > 0);
    assert.deepEqual([...new Set(leads.leads.map((l) => l.category))].sort(), ['reach', 'scale']);
  });

  it('sees only their own category when the superadmin chose one', async () => {
    const reach = await inviteManager('Ravi Menon', 'ravi@fynix.test', 'reach');
    const boot = (await call(reach, 'GET', '/api/manager/bootstrap')).body as unknown as Bootstrap;
    assert.deepEqual(Object.keys(boot.categories), ['reach']);
    assert.ok(boot.workspaces.every((w) => w.category === 'reach'));
    assert.ok(boot.people.length > 0 && boot.people.every((p) => p.category === 'reach'));
    const leads = (await call(reach, 'GET', '/api/manager/leads')).body as unknown as LeadsPage;
    assert.ok(leads.total > 0 && leads.leads.every((l) => l.category === 'reach'));
    // asking for the other category gives nothing rather than leaking it
    const other = (await call(reach, 'GET', '/api/manager/leads?category=scale')).body as unknown as LeadsPage;
    assert.equal(other.total, 0);
    assert.equal(other.leads.length, 0);
  });

  it('requires a category choice only for salespeople, and rejects unknown roles', async () => {
    const aarav = await login('aarav@fynix.test');
    assert.equal((await call(aarav, 'POST', '/api/admin/users', { name: 'No Category', email: 'nocat@fynix.test', role: 'sales' })).status, 400);
    assert.equal((await call(aarav, 'POST', '/api/admin/users', { name: 'Odd Role', email: 'odd@fynix.test', role: 'owner' })).status, 400);
    assert.equal((await call(aarav, 'POST', '/api/admin/users', { name: 'Both Cats', email: 'both@fynix.test', role: 'manager' })).status, 201);
  });
});

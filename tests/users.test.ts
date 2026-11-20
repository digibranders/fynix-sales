import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { openDb } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';
const CSV = ['title,category,address,phone,website,place_id', 'Alpha Jewellers,Jewelry store,"Khar West, Mumbai",9820011111,https://alpha.example,p1'].join('\n');

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

interface Person {
  id: string;
  email: string;
}
async function people(cookie: string): Promise<Person[]> {
  return ((await call(cookie, 'GET', '/api/admin/bootstrap')).body as unknown as { people: Person[] }).people;
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

describe('deleting people', () => {
  it('lets only a superadmin delete, and never yourself', async () => {
    const aarav = await login('aarav@fynix.test');
    const list = await people(aarav);
    const self = list.find((p) => p.email === 'aarav@fynix.test');
    const karan = list.find((p) => p.email === 'karan@fynix.test');
    assert.ok(self && karan);
    assert.equal((await call(await login('priya@fynix.test'), 'DELETE', `/api/admin/users/${karan.id}`)).status, 403);
    assert.equal((await call(await login('nisha@fynix.test'), 'DELETE', `/api/admin/users/${karan.id}`)).status, 403);
    assert.equal((await call(aarav, 'DELETE', `/api/admin/users/${self.id}`)).status, 400);
    assert.equal((await call(aarav, 'DELETE', '/api/admin/users/nobody')).status, 404);
    assert.equal((await call('', 'DELETE', `/api/admin/users/${karan.id}`)).status, 401);
  });

  it('refuses while the person still owns leads, then deletes once they are released', async () => {
    const aarav = await login('aarav@fynix.test');
    const priya = await login('priya@fynix.test');
    const boot = (await call(priya, 'GET', '/api/sales/bootstrap')).body as unknown as { leads: { id: string; open: string[] }[]; workspaces: { id: string }[] };
    const lead = boot.leads[0];
    const workspaceId = boot.workspaces[0]?.id;
    assert.ok(lead && workspaceId);
    assert.equal((await call(priya, 'POST', '/api/sales/claims', { leadId: lead.id, workspaceId })).status, 201);

    const priyaId = (await people(aarav)).find((p) => p.email === 'priya@fynix.test')?.id ?? '';
    const blocked = await call(aarav, 'DELETE', `/api/admin/users/${priyaId}`);
    assert.equal(blocked.status, 409);
    assert.match(String(blocked.body['message']), /still owns 1 leads/);

    assert.equal((await call(aarav, 'PUT', `/api/admin/leads/${lead.id}/owners/${workspaceId}`, { ownerId: null })).status, 200);
    assert.equal((await call(aarav, 'DELETE', `/api/admin/users/${priyaId}`)).status, 200);
    assert.ok(!(await people(aarav)).some((p) => p.email === 'priya@fynix.test'));
    // the old session and the account are gone
    assert.equal((await call(priya, 'GET', '/api/sales/bootstrap')).status, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'priya@fynix.test', password: PASSWORD } })).statusCode, 401);
  });

  it('deletes someone who was only invited, and their invite link stops working', async () => {
    const aarav = await login('aarav@fynix.test');
    const created = await call(aarav, 'POST', '/api/admin/users', { name: 'Temp Person', email: 'temp@fynix.test', role: 'manager' });
    assert.equal(created.status, 201);
    const token = String(created.body['inviteUrl']).split('/').pop() ?? '';
    assert.equal((await call(aarav, 'DELETE', `/api/admin/users/${String(created.body['id'])}`)).status, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/auth/invite/${token}` })).statusCode, 404);
    assert.equal((await call(aarav, 'POST', '/api/admin/users', { name: 'Temp Again', email: 'temp@fynix.test', role: 'manager' })).status, 201, 'the email can be used again');
  });
});

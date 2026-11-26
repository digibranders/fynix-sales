import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { openDb } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';

let app: FastifyInstance;
let db: Db;

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = res.cookies.find((c) => c.name === 'ld_session');
  assert.ok(cookie);
  return `ld_session=${cookie.value}`;
}

interface Message {
  id: string;
  subject: string;
  body: string;
}

async function inbox(cookie: string): Promise<Message[]> {
  const res = await app.inject({ method: 'GET', url: '/api/sales/bootstrap', headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  return (JSON.parse(res.body) as { messages: Message[] }).messages;
}

async function send(cookie: string, payload: object) {
  return app.inject({ method: 'POST', url: '/api/admin/announcements', headers: { cookie }, payload });
}

before(async () => {
  db = await openDb(':memory:');
  await seedDatabase(db, PASSWORD, {});
  app = await buildApp(db, { ...loadConfig(), databaseUrl: ':memory:', production: false });
});

after(async () => {
  await app.close();
  await db.close();
});

describe('notifications written by a superadmin', () => {
  it('reaches Scale, Reach or both, and nobody outside the audience', async () => {
    const aarav = await login('aarav@fynix.test');
    const priya = await login('priya@fynix.test'); // scale
    const aisha = await login('aisha@fynix.test'); // reach

    assert.equal((await send(aarav, { audience: 'scale', subject: 'Scale only', body: 'Hello Scale team.' })).statusCode, 201);
    assert.equal((await send(aarav, { audience: 'reach', subject: 'Reach only', body: 'Hello Reach team.' })).statusCode, 201);
    assert.equal((await send(aarav, { audience: 'both', subject: 'Everyone', body: 'Hello all.\nSecond line.' })).statusCode, 201);

    const scale = (await inbox(priya)).map((m) => m.subject).sort();
    const reach = (await inbox(aisha)).map((m) => m.subject).sort();
    assert.deepEqual(scale, ['Everyone', 'Scale only']);
    assert.deepEqual(reach, ['Everyone', 'Reach only']);
    assert.equal((await inbox(priya)).find((m) => m.subject === 'Everyone')?.body, 'Hello all.\nSecond line.');
  });

  it('is for superadmins only and checks the subject, message and audience', async () => {
    const aarav = await login('aarav@fynix.test');
    const priya = await login('priya@fynix.test');
    const nisha = await login('nisha@fynix.test'); // manager
    const ok = { audience: 'both', subject: 'Hi', body: 'There' };
    assert.equal((await send(priya, ok)).statusCode, 403);
    assert.equal((await send(nisha, ok)).statusCode, 403);
    assert.equal((await send('', ok)).statusCode, 401);
    assert.equal((await send(aarav, { ...ok, subject: '   ' })).statusCode, 400);
    assert.equal((await send(aarav, { ...ok, body: '' })).statusCode, 400);
    assert.equal((await send(aarav, { ...ok, subject: 'x'.repeat(121) })).statusCode, 400);
    assert.equal((await send(aarav, { ...ok, audience: 'everyone' })).statusCode, 400);
  });

  it('lists what was sent with how many people it reached, and taking one back removes it for everyone', async () => {
    const aarav = await login('aarav@fynix.test');
    const priya = await login('priya@fynix.test');
    const made = await send(aarav, { audience: 'scale', subject: 'Take me back', body: 'Oops.' });
    const id = (JSON.parse(made.body) as { id: string }).id;

    const list = await app.inject({ method: 'GET', url: '/api/admin/announcements', headers: { cookie: aarav } });
    const row = (JSON.parse(list.body) as { announcements: { id: string; audience: string; reach: number; by: string }[] }).announcements.find((a) => a.id === id);
    assert.ok(row);
    assert.equal(row.audience, 'scale');
    assert.equal(row.by, 'Aarav Kapoor');
    assert.ok(row.reach >= 1);

    const read = await app.inject({ method: 'POST', url: '/api/sales/notifications/read', headers: { cookie: priya }, payload: { keys: [`a:${id}`] } });
    assert.equal(read.statusCode, 200);
    assert.ok((await inbox(priya)).some((m) => m.id === `a:${id}`));

    assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/announcements/${id}`, headers: { cookie: priya } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/announcements/${id}`, headers: { cookie: aarav } })).statusCode, 200);
    assert.ok(!(await inbox(priya)).some((m) => m.id === `a:${id}`));
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/announcements/${id}`, headers: { cookie: aarav } })).statusCode, 404);
  });
});

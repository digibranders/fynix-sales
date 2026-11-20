import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import type { Mailer, MailMessage } from '../src/mailer.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';
const CSV = 'title,category,address,phone,place_id\nAlpha,Jewelry store,"Khar, Mumbai",9820011111,p1';

async function setup(enabled = true) {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    enabled,
    async send(message) {
      sent.push(message);
      return true;
    },
  };
  const db = await openDb(':memory:');
  await seedDatabase(db, PASSWORD, { jewelleryCsv: CSV });
  const app = await buildApp(db, { ...loadConfig(), databaseUrl: ':memory:', production: false, appUrl: 'https://leads.example.test' }, mailer);
  const forgot = (email: unknown) => app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email } });
  const close = async () => {
    await app.close();
    await db.close();
  };
  return { app, db, sent, forgot, close };
}

/** The email is sent after the reply, so give it a moment. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe('forgot password', () => {
  it('emails a one-time link that really resets the password', async () => {
    const { app, sent, forgot, close } = await setup();
    const res = await forgot('Priya@Fynix.test ');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, emailed: true });
    await settle();
    assert.equal(sent.length, 1);
    const mail = sent[0];
    assert.ok(mail);
    assert.equal(mail.to, 'priya@fynix.test');
    assert.equal(mail.subject, 'Reset your Fynix Sales password');
    assert.match(mail.text, /request to reset the password/);
    assert.match(mail.text, /ignore this email/);
    const link = /(https:\/\/leads\.example\.test\/invite\/(\S+))/.exec(mail.text);
    assert.ok(link?.[2]);
    assert.ok(mail.html.includes(link[1] ?? ''), 'the button carries the same link');

    // the link works once and signs them in with the new password
    const token = link[2];
    const accepted = await app.inject({ method: 'POST', url: `/api/auth/invite/${token}`, payload: { password: 'my-new-password-42' } });
    assert.equal(accepted.statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'priya@fynix.test', password: 'my-new-password-42' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'priya@fynix.test', password: PASSWORD } })).statusCode, 401, 'the old password stops working');
    assert.equal((await app.inject({ method: 'POST', url: `/api/auth/invite/${token}`, payload: { password: 'another-password-42' } })).statusCode, 404, 'the link works once');
    await close();
  });

  it('answers the same for an unknown or deactivated address and sends nothing', async () => {
    const { app, sent, forgot, close } = await setup();
    const known = await forgot('priya@fynix.test');
    await settle();
    const unknown = await forgot('nobody@fynix.test');
    assert.equal(unknown.statusCode, known.statusCode);
    assert.equal(unknown.body, known.body, 'nothing in the answer tells them apart');

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'aarav@fynix.test', password: PASSWORD } });
    const cookie = `ld_session=${login.cookies[0]?.value ?? ''}`;
    const people = ((await app.inject({ method: 'GET', url: '/api/admin/bootstrap', headers: { cookie } })).json() as { people: { id: string; email: string }[] }).people;
    const rohan = people.find((p) => p.email === 'rohan@fynix.test');
    assert.ok(rohan);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/admin/users/${rohan.id}`, headers: { cookie }, payload: { active: false } })).statusCode, 200);
    const inactive = await forgot('rohan@fynix.test');
    assert.equal(inactive.body, known.body);
    await settle();
    assert.equal(sent.length, 1, 'only the real, active account got an email');
    assert.equal(sent[0]?.to, 'priya@fynix.test');
    await close();
  });

  it('limits requests per address and per connection', async () => {
    const { sent, forgot, close } = await setup();
    for (let i = 0; i < 3; i += 1) assert.equal((await forgot('karan@fynix.test')).statusCode, 200);
    const blocked = await forgot('karan@fynix.test');
    assert.equal(blocked.statusCode, 429);
    assert.equal((await forgot('KARAN@fynix.test')).statusCode, 429, 'capital letters do not get around it');
    await settle();
    assert.equal(sent.length, 3, 'an inbox cannot be flooded');
    // an unknown address is limited the same way, so the limit does not give the account away
    for (let i = 0; i < 3; i += 1) assert.equal((await forgot('ghost@fynix.test')).statusCode, 200);
    assert.equal((await forgot('ghost@fynix.test')).statusCode, 429);
    // one connection cannot try many addresses forever
    for (let i = 0; i < 20 && (await forgot(`user${i}@fynix.test`)).statusCode === 200; i += 1);
    assert.equal((await forgot('fresh@fynix.test')).statusCode, 429);
    await close();
  });

  it('says so when email is not set up, and rejects a missing address', async () => {
    const { sent, forgot, close } = await setup(false);
    const res = await forgot('priya@fynix.test');
    assert.deepEqual(JSON.parse(res.body), { ok: true, emailed: false });
    await settle();
    assert.equal(sent.length, 0);
    assert.equal((await forgot('')).statusCode, 400);
    assert.equal((await forgot(undefined)).statusCode, 400);
    await close();
  });
});

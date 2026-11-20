import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import type { Mailer, MailMessage } from '../src/mailer.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';
const CSV = 'title,category,address,phone,place_id\nAlpha,Jewelry store,"Khar, Mumbai",9820011111,p1';

async function setup(accept: boolean) {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    enabled: true,
    async send(message) {
      sent.push(message);
      return accept;
    },
  };
  const db = await openDb(':memory:');
  await seedDatabase(db, PASSWORD, { jewelleryCsv: CSV });
  const app = await buildApp(db, { ...loadConfig(), databaseUrl: ':memory:', production: false, appUrl: 'https://leads.example.test' }, mailer);
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'aarav@fynix.test', password: PASSWORD } });
  const cookie = `ld_session=${res.cookies[0]?.value ?? ''}`;
  return { app, db, sent, cookie };
}

async function createManager(app: Awaited<ReturnType<typeof setup>>['app'], cookie: string, name = 'Neha <Rao>') {
  const res = await app.inject({ method: 'POST', url: '/api/admin/users', headers: { cookie }, payload: { name, email: 'neha@fynix.test', role: 'sales', category: 'reach' } });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body) as { id: string; inviteUrl: string; canEmail: boolean };
  return { ...body, token: body.inviteUrl.split('/').pop() ?? '' };
}

function sendLink(app: Awaited<ReturnType<typeof setup>>['app'], cookie: string, userId: string, token: string) {
  return app.inject({ method: 'POST', url: `/api/admin/users/${userId}/invite/email`, headers: { cookie }, payload: { token } });
}

describe('invite email', () => {
  it('shows the link first and sends nothing until the button is pressed', async () => {
    const { app, db, sent, cookie } = await setup(true);
    const created = await createManager(app, cookie);
    assert.equal(created.canEmail, true);
    assert.match(created.inviteUrl, /^https:\/\/leads\.example\.test\/invite\//);
    assert.equal(sent.length, 0, 'creating a member does not email anyone');

    const res = await sendLink(app, cookie, created.id, created.token);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, sentTo: 'neha@fynix.test' });
    assert.equal(sent.length, 1);
    const mail = sent[0];
    assert.ok(mail);
    assert.equal(mail.to, 'neha@fynix.test');
    assert.equal(/(https:\/\/leads\.example\.test\/invite\/\S+)/.exec(mail.text)?.[1], created.inviteUrl, 'the email carries the same link that was shown');
    assert.ok(mail.html.includes('Neha &lt;Rao&gt;'), 'names are escaped in the HTML body');
    assert.equal(mail.text.includes('password:'), false);
    // the link still works after it was emailed
    assert.equal((await app.inject({ method: 'GET', url: `/api/auth/invite/${created.token}` })).statusCode, 200);
    await app.close();
    await db.close();
  });

  it('works the same for the invite link or reset link on an existing person', async () => {
    const { app, db, sent, cookie } = await setup(true);
    const people = ((await app.inject({ method: 'GET', url: '/api/admin/bootstrap', headers: { cookie } })).json() as { people: { id: string; email: string }[] }).people;
    const karan = people.find((p) => p.email === 'karan@fynix.test');
    assert.ok(karan);
    const link = (await app.inject({ method: 'POST', url: `/api/admin/users/${karan.id}/invite`, headers: { cookie } })).json() as { inviteUrl: string; canEmail: boolean };
    assert.equal(link.canEmail, true);
    assert.equal(sent.length, 0);
    assert.equal((await sendLink(app, cookie, karan.id, link.inviteUrl.split('/').pop() ?? '')).statusCode, 200);
    assert.equal(sent[0]?.to, 'karan@fynix.test');
    await app.close();
    await db.close();
  });

  it('only emails a live link that belongs to that person, and only for superadmins', async () => {
    const { app, db, sent, cookie } = await setup(true);
    const neha = await createManager(app, cookie);
    const people = ((await app.inject({ method: 'GET', url: '/api/admin/bootstrap', headers: { cookie } })).json() as { people: { id: string; email: string }[] }).people;
    const karan = people.find((p) => p.email === 'karan@fynix.test');
    assert.ok(karan);
    assert.equal((await sendLink(app, cookie, karan.id, neha.token)).statusCode, 404, "someone else's link cannot be sent to them");
    assert.equal((await sendLink(app, cookie, neha.id, 'a'.repeat(43))).statusCode, 404, 'an unknown link is refused');
    assert.equal((await sendLink(app, cookie, neha.id, 'short')).statusCode, 400);
    // a newer link replaces the old one, so the old one can no longer be emailed
    const fresh = (await app.inject({ method: 'POST', url: `/api/admin/users/${neha.id}/invite`, headers: { cookie } })).json() as { inviteUrl: string };
    assert.equal((await sendLink(app, cookie, neha.id, neha.token)).statusCode, 404);
    assert.equal((await sendLink(app, cookie, neha.id, fresh.inviteUrl.split('/').pop() ?? '')).statusCode, 200);
    // a salesperson cannot use it
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'aisha@fynix.test', password: PASSWORD } });
    const aisha = `ld_session=${login.cookies[0]?.value ?? ''}`;
    assert.equal((await sendLink(app, aisha, neha.id, fresh.inviteUrl.split('/').pop() ?? '')).statusCode, 403);
    assert.equal(sent.length, 1, 'only the one valid request sent an email');
    await app.close();
    await db.close();
  });

  it('tells the admin when the email could not be sent, and the link keeps working', async () => {
    const { app, db, cookie } = await setup(false);
    const neha = await createManager(app, cookie, 'Neha Rao');
    const res = await sendLink(app, cookie, neha.id, neha.token);
    assert.equal(res.statusCode, 502);
    assert.match(String(JSON.parse(res.body).message), /Copy the link/);
    assert.equal((await app.inject({ method: 'GET', url: `/api/auth/invite/${neha.token}` })).statusCode, 200);
    await app.close();
    await db.close();
  });

  it('reports that email is off when no provider is set up', async () => {
    const db = await openDb(':memory:');
    await seedDatabase(db, PASSWORD, { jewelleryCsv: CSV });
    const off: Mailer = { enabled: false, async send() { return false; } };
    const app = await buildApp(db, { ...loadConfig(), databaseUrl: ':memory:', production: false, appUrl: 'https://leads.example.test' }, off);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'aarav@fynix.test', password: PASSWORD } });
    const cookie = `ld_session=${login.cookies[0]?.value ?? ''}`;
    const neha = await createManager(app, cookie, 'Neha Rao');
    assert.equal(neha.canEmail, false);
    const res = await sendLink(app, cookie, neha.id, neha.token);
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).error, 'email_off');
    await app.close();
    await db.close();
  });
});

describe('Brevo', () => {
  it('reads the sender from MAIL_FROM, with or without a display name', async () => {
    const { parseSender } = await import('../src/mailer.js');
    assert.deepEqual(parseSender('Fynix Sales <no-reply@fynix.digital>'), { name: 'Fynix Sales', email: 'no-reply@fynix.digital' });
    assert.deepEqual(parseSender('"Fynix Sales" <no-reply@fynix.digital>'), { name: 'Fynix Sales', email: 'no-reply@fynix.digital' });
    assert.deepEqual(parseSender('<no-reply@fynix.digital>'), { email: 'no-reply@fynix.digital' });
    assert.deepEqual(parseSender('no-reply@fynix.digital'), { email: 'no-reply@fynix.digital' });
    assert.equal(parseSender('not an address'), null);
  });

  it('sends through the Brevo API with the key, sender and message, and reports failures without throwing', async () => {
    const { createMailer, inviteEmail } = await import('../src/mailer.js');
    const config = { ...loadConfig(), brevoApiKey: 'test-key-123', resendApiKey: null, mailFrom: 'Fynix Sales <no-reply@fynix.digital>' };
    const mailer = createMailer(config);
    assert.equal(mailer.enabled, true);

    const realFetch = globalThis.fetch;
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 201;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(status === 201 ? '{"messageId":"x"}' : '{"message":"Sender not valid"}', { status });
    }) as typeof fetch;
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const message = inviteEmail({ name: 'Neha', email: 'neha@fynix.test', invitedBy: 'Aarav', link: 'https://x.test/invite/abc', reset: false, days: 7 });
      assert.equal(await mailer.send(message), true);
      const call = calls[0];
      assert.ok(call);
      assert.equal(call.url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal((call.init.headers as Record<string, string>)['api-key'], 'test-key-123');
      const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
      assert.deepEqual(body['sender'], { name: 'Fynix Sales', email: 'no-reply@fynix.digital' });
      assert.deepEqual(body['to'], [{ email: 'neha@fynix.test' }]);
      assert.equal(body['subject'], message.subject);
      assert.equal(body['textContent'], message.text);
      assert.equal(body['htmlContent'], message.html);

      status = 400;
      assert.equal(await mailer.send(message), false, 'a rejected email is reported, not thrown');
      globalThis.fetch = (async () => {
        throw new Error('network down');
      }) as typeof fetch;
      assert.equal(await mailer.send(message), false, 'an unreachable provider is reported, not thrown');
    } finally {
      globalThis.fetch = realFetch;
      console.error = originalError;
    }
  });

  it('stays off without a key or with an unusable sender', async () => {
    const { createMailer } = await import('../src/mailer.js');
    const base = { ...loadConfig(), brevoApiKey: null, resendApiKey: null };
    assert.equal(createMailer({ ...base, mailFrom: 'Fynix Sales <no-reply@fynix.digital>' }).enabled, false);
    const originalError = console.error;
    console.error = () => undefined;
    try {
      assert.equal(createMailer({ ...base, brevoApiKey: 'k', mailFrom: 'nonsense' }).enabled, false);
    } finally {
      console.error = originalError;
    }
  });
});

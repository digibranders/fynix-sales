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

describe('invite email', () => {
  it('emails the invite link, and still returns it to the admin', async () => {
    const { app, db, sent, cookie } = await setup(true);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie },
      payload: { name: 'Neha <Rao>', email: 'neha@fynix.test', role: 'sales', category: 'reach' },
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    assert.equal(body['emailed'], true);
    assert.equal('temporaryPassword' in body, false);
    assert.equal(sent.length, 1);
    const mail = sent[0];
    assert.ok(mail);
    assert.equal(mail.to, 'neha@fynix.test');
    const link = /(https:\/\/leads\.example\.test\/invite\/\S+)/.exec(mail.text)?.[1];
    assert.ok(link, 'the email carries the invite link');
    assert.equal(link, body['inviteUrl']);
    assert.ok(mail.html.includes('Neha &lt;Rao&gt;'), 'names are escaped in the HTML body');
    assert.equal(mail.text.includes('password:'), false);
    await app.close();
    await db.close();
  });

  it('returns the link when the email cannot be sent, so it can be copied and shared', async () => {
    const { app, db, cookie } = await setup(false);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie },
      payload: { name: 'Neha Rao', email: 'neha@fynix.test', role: 'sales', category: 'reach' },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    assert.equal(body['emailed'], false);
    assert.match(String(body['inviteUrl']), /^https:\/\/leads\.example\.test\/invite\//);
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

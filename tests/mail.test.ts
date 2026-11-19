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
  it('emails the temporary password and keeps it out of the response', async () => {
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
    assert.ok(mail.text.includes('https://leads.example.test/login'));
    assert.ok(mail.html.includes('Neha &lt;Rao&gt;'), 'names are escaped in the HTML body');
    const password = /Temporary password: (\S+)/.exec(mail.text)?.[1];
    assert.ok(password);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'neha@fynix.test', password } });
    assert.equal(login.statusCode, 200);
    await app.close();
    await db.close();
  });

  it('shows the password on screen when the email cannot be sent', async () => {
    const { app, db, cookie } = await setup(false);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie },
      payload: { name: 'Neha Rao', email: 'neha@fynix.test', role: 'sales', category: 'reach' },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    assert.equal(body['emailed'], false);
    assert.equal(typeof body['temporaryPassword'], 'string');
    await app.close();
    await db.close();
  });
});

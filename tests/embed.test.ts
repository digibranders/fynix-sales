import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { openDb } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';
const BOOT = /<script type="application\/json" id="boot">([\s\S]*?)<\/script>/;

let app: FastifyInstance;
let db: Db;

before(async () => {
  db = await openDb(':memory:');
  await seedDatabase(db, PASSWORD, { jewelleryCsv: 'title,category,address,phone,place_id\nAlpha,Jewelry store,"Khar, Mumbai",9820011111,p1' });
  app = await buildApp(db, { ...loadConfig(), databaseUrl: ':memory:', production: false });
});

after(async () => {
  await app.close();
  await db.close();
});

async function cookieFor(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  return `ld_session=${res.cookies[0]?.value ?? ''}`;
}

describe('first data inside the page', () => {
  it('puts the same data the API would give into each signed-in page', async () => {
    const cases: [string, string, string][] = [
      ['/app', 'priya@fynix.test', '/api/sales/bootstrap'],
      ['/admin', 'aarav@fynix.test', '/api/admin/bootstrap'],
      ['/manager', 'nisha@fynix.test', '/api/manager/bootstrap'],
    ];
    for (const [page, email, api] of cases) {
      const cookie = await cookieFor(email);
      const html = (await app.inject({ method: 'GET', url: page, headers: { cookie } })).body;
      const embedded = BOOT.exec(html)?.[1];
      assert.ok(embedded, `${page} carries its data`);
      const fromApi = (await app.inject({ method: 'GET', url: api, headers: { cookie } })).json();
      assert.deepEqual(JSON.parse(embedded), fromApi, `${page} matches ${api}`);
      assert.equal(html.match(/id="boot"/g)?.length, 1);
      assert.ok(html.indexOf('id="boot"') < html.lastIndexOf('</body>'), 'it sits inside the body');
    }
  });

  it('leaves the public pages alone', async () => {
    for (const url of ['/login', '/invite/anything']) {
      assert.ok(!(await app.inject({ method: 'GET', url })).body.includes('id="boot"'), url);
    }
    assert.equal((await app.inject({ method: 'GET', url: '/app' })).statusCode, 302, 'signed-out visitors are still sent to sign in');
  });

  it('cannot be broken out of by what is stored in the data', async () => {
    const cookie = await cookieFor('rohan@fynix.test');
    const nasty = '</script><img src=x onerror=alert(1)> $& $\' <!--   &amp;';
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie }, payload: { name: nasty } })).statusCode, 200);
    const html = (await app.inject({ method: 'GET', url: '/app', headers: { cookie } })).body;
    assert.ok(!html.includes('</script><img'), 'the closing tag was escaped');
    assert.ok(!html.includes('<!-- '), 'a comment cannot be opened');
    const embedded = BOOT.exec(html)?.[1];
    assert.ok(embedded);
    const data = JSON.parse(embedded) as { me: { name: string } };
    assert.equal(data.me.name, nasty, 'the name comes back exactly as stored, including $ patterns');
  });
});

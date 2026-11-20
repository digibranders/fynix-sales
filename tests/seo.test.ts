import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { openDb } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';
const WEB = loadConfig().webDir;

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

describe('search engines', () => {
  it('has no robots.txt, so crawlers can read the noindex instruction and the site is not advertised', async () => {
    const res = await app.inject({ method: 'GET', url: '/robots.txt' });
    assert.equal(res.statusCode, 404);
  });

  it('marks every page noindex, in the header and in the page itself', async () => {
    const pages: [string, string | undefined][] = [
      ['/login', undefined],
      ['/invite/anything', undefined],
      ['/app', await cookieFor('priya@fynix.test')],
      ['/admin', await cookieFor('aarav@fynix.test')],
      ['/manager', await cookieFor('nisha@fynix.test')],
    ];
    for (const [url, cookie] of pages) {
      const res = await app.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });
      assert.equal(res.statusCode, 200, url);
      assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow, noarchive, nosnippet, noimageindex', `${url} header`);
      assert.match(res.body, /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">/, `${url} meta tag`);
      assert.match(res.body, /<title>[^<]{3,}<\/title>/, `${url} has a title`);
      assert.match(res.body, /<meta name="description" content="[^"]{20,}">/, `${url} has a description`);
    }
  });
});

describe('images', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : [full];
    });
  }

  it('only points at images, icons and styles that exist', () => {
    const sources = [...readdirSync(WEB).filter((f) => f.endsWith('.html')).map((f) => path.join(WEB, f)), ...files(path.join(WEB, 'assets', 'css'))];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/["'(](\/(?:assets\/(?:img|icons|css)\/[^"')?#\s]+|favicon\.ico))/g)) {
        const target = match[1] ?? '';
        statSync(path.join(WEB, target)); // throws when the file is missing
      }
    }
  });

  it('keeps every image small, so a heavy picture cannot slip back in', () => {
    const budget = 60 * 1024;
    for (const file of files(path.join(WEB, 'assets', 'img'))) {
      assert.ok(statSync(file).size <= budget, `${path.relative(WEB, file)} is over 60 KB`);
    }
  });
});

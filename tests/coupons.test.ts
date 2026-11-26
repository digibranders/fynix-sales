import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { all, openDb, run } from '../src/db.js';
import { bbSignature } from '../src/routes/coupons.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';
const SECRET = 'w'.repeat(40);
const KEY = 'k'.repeat(40);

let app: FastifyInstance;
let db: Db;
const realFetch = globalThis.fetch;

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = res.cookies.find((c) => c.name === 'ld_session');
  assert.ok(cookie);
  return `ld_session=${cookie.value}`;
}

before(async () => {
  db = await openDb(':memory:');
  await seedDatabase(db, PASSWORD, {});
  app = await buildApp(db, { ...loadConfig(), databaseUrl: ':memory:', production: false, integrationKey: KEY, webhookSecret: SECRET, bbApiUrl: 'http://bb.test' });
});

after(async () => {
  await app.close();
  await db.close();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubBb(status: number, body: object, seen?: { url?: string; auth?: string | null; body?: Record<string, unknown> }) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (seen) {
      seen.url = String(url);
      seen.auth = new Headers(init?.headers).get('authorization');
      seen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

async function salesId(): Promise<string> {
  const rows = await all<{ id: string }>(db, "SELECT id FROM users WHERE role = 'sales' AND active = 1 ORDER BY name LIMIT 1");
  assert.ok(rows[0]);
  return rows[0].id;
}

function event(over: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    type: 'coupon.paid',
    couponCode: 'PRIYA10',
    client: { businessId: 'biz_1', name: 'Acme Jewels', email: 'owner@acme.test' },
    payment: { id: 'pay_1', kind: 'subscription', amountCents: 150000, currency: 'INR', paidAt: Date.now() },
    ...over,
  };
}

async function hook(payload: object | string, opts: { timestamp?: string; signature?: string; secret?: string } = {}) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  return app.inject({
    method: 'POST',
    url: '/api/integrations/bb/coupon-paid',
    headers: { 'content-type': 'application/json', 'x-bb-timestamp': timestamp, 'x-bb-signature': opts.signature ?? bbSignature(opts.secret ?? SECRET, timestamp, raw) },
    payload: raw,
  });
}

describe('creating a coupon', () => {
  it('sends it to BrandBasket and stores the id against the salesperson', async () => {
    const aarav = await login('aarav@fynix.test');
    const seen: { url?: string; auth?: string | null; body?: Record<string, unknown> } = {};
    stubBb(201, { id: 'bb_1', code: 'PRIYA10' }, seen);
    const userId = await salesId();
    const res = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'priya10', userId, discountKind: 'percent', discountValue: 10, discountMonths: 3 } });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(seen.url, 'http://bb.test/api/integrations/fynix/coupons');
    assert.equal(seen.auth, `Bearer ${KEY}`);
    assert.deepEqual(seen.body, { code: 'PRIYA10', currency: 'INR', discountKind: 'percent', discountValue: '10', discountMonths: 3 });
    const rows = await all<{ bb_coupon_id: string; user_id: string }>(db, "SELECT bb_coupon_id, user_id FROM coupons WHERE code = 'PRIYA10'");
    assert.deepEqual(rows, [{ bb_coupon_id: 'bb_1', user_id: userId }]);
  });

  it('is for superadmins only', async () => {
    const sales = await login('priya@fynix.test').catch(() => null);
    if (!sales) return;
    const res = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: sales }, payload: { code: 'NOPE10', userId: await salesId(), discountKind: 'percent', discountValue: 5 } });
    assert.equal(res.statusCode, 403);
  });

  it('shows BrandBasket 409 and 422 answers, and saves nothing', async () => {
    const aarav = await login('aarav@fynix.test');
    const userId = await salesId();
    stubBb(409, { error: 'exists' });
    let res = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'DUPE10', userId, discountKind: 'percent', discountValue: 10 } });
    assert.equal(res.statusCode, 409);
    stubBb(422, { error: 'discountValue must be positive', field: 'discountValue' });
    res = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'BAD10', userId, discountKind: 'amount', discountValue: 5 } });
    assert.equal(res.statusCode, 422);
    assert.match(String(JSON.parse(res.body).message), /discountValue/);
    assert.equal((await all(db, "SELECT 1 FROM coupons WHERE code IN ('DUPE10', 'BAD10')")).length, 0);
  });

  it('rejects a percentage over 100 and a code that already exists here', async () => {
    const aarav = await login('aarav@fynix.test');
    const userId = await salesId();
    let res = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'BIG150', userId, discountKind: 'percent', discountValue: 150 } });
    assert.equal(res.statusCode, 400);
    res = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'PRIYA10', userId, discountKind: 'percent', discountValue: 10 } });
    assert.equal(res.statusCode, 409);
  });
});

describe('removing a coupon', () => {
  async function addCoupon(code: string): Promise<string> {
    const id = `cp_${code}`;
    await run(
      db,
      `INSERT INTO coupons (id, code, user_id, bb_coupon_id, currency, discount_kind, discount_value, created_at) VALUES (?, ?, ?, 'bb_x', 'INR', 'percent', '10', ?)`,
      [id, code, await salesId(), Date.now()],
    );
    return id;
  }

  it('turns the code off in BrandBasket, then removes it here, for superadmins only', async () => {
    const id = await addCoupon('REMOVEME');
    const sales = await login('priya@fynix.test');
    const denied = await app.inject({ method: 'DELETE', url: `/api/admin/coupons/${id}`, headers: { cookie: sales } });
    assert.equal(denied.statusCode, 403);
    const aarav = await login('aarav@fynix.test');
    const seen: { url?: string; auth?: string | null; body?: Record<string, unknown> } = {};
    stubBb(200, { id: 'bb_x', active: false }, seen);
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/coupons/${id}`, headers: { cookie: aarav } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(seen.url, 'http://bb.test/api/integrations/fynix/coupons/bb_x/turn-off');
    assert.equal(seen.auth, `Bearer ${KEY}`);
    assert.equal((await all(db, 'SELECT 1 FROM coupons WHERE id = ?', [id])).length, 0);
    const again = await app.inject({ method: 'DELETE', url: `/api/admin/coupons/${id}`, headers: { cookie: aarav } });
    assert.equal(again.statusCode, 404);
  });

  it('keeps the coupon here when BrandBasket could not turn it off', async () => {
    const id = await addCoupon('STAYS');
    const aarav = await login('aarav@fynix.test');
    stubBb(500, { error: 'boom' });
    const failed = await app.inject({ method: 'DELETE', url: `/api/admin/coupons/${id}`, headers: { cookie: aarav } });
    assert.equal(failed.statusCode, 502);
    // A 404 with no message means BrandBasket does not have the feature yet: still nothing removed.
    globalThis.fetch = (async () => new Response('<html>Not found</html>', { status: 404 })) as typeof fetch;
    const unsupported = await app.inject({ method: 'DELETE', url: `/api/admin/coupons/${id}`, headers: { cookie: aarav } });
    assert.equal(unsupported.statusCode, 502);
    assert.equal(JSON.parse(unsupported.body).error, 'bb_unsupported');
    assert.equal((await all(db, 'SELECT 1 FROM coupons WHERE id = ?', [id])).length, 1);
    // BrandBasket saying it has no such code is fine: remove it here as well.
    stubBb(404, { error: 'That code no longer exists.' });
    const gone = await app.inject({ method: 'DELETE', url: `/api/admin/coupons/${id}`, headers: { cookie: aarav } });
    assert.equal(gone.statusCode, 200, gone.body);
  });

  it('keeps a coupon that clients have paid with, so their payments stay counted', async () => {
    const id = await addCoupon('KEEPME');
    await run(
      db,
      `INSERT INTO coupon_payments (event_id, coupon_id, business_id, client_name, client_email, payment_id, kind, amount_cents, currency, paid_at, received_at)
       VALUES ('evt_keep', ?, 'biz_1', 'Client', 'c@example.com', 'pay_1', 'subscription', 1000, 'INR', ?, ?)`,
      [id, Date.now(), Date.now()],
    );
    const aarav = await login('aarav@fynix.test');
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/coupons/${id}`, headers: { cookie: aarav } });
    assert.equal(res.statusCode, 409);
    assert.equal((await all(db, 'SELECT 1 FROM coupon_payments WHERE event_id = ?', ['evt_keep'])).length, 1);
    // The webhook tests below count every stored payment, so leave nothing behind.
    await run(db, 'DELETE FROM coupons WHERE id = ?', [id]);
  });
});

describe('the coupon.paid webhook', () => {
  it('refuses a bad signature, a missing one, a wrong secret and an old timestamp', async () => {
    assert.equal((await hook(event(), { signature: 'sha256=' + '0'.repeat(64) })).statusCode, 401);
    assert.equal((await hook(event(), { secret: 'x'.repeat(40) })).statusCode, 401);
    const bare = await app.inject({ method: 'POST', url: '/api/integrations/bb/coupon-paid', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(event()) });
    assert.equal(bare.statusCode, 401);
    const old = String(Math.floor((Date.now() - 6 * 60_000) / 1000));
    assert.equal((await hook(event(), { timestamp: old })).statusCode, 401);
    assert.equal((await all(db, 'SELECT 1 FROM coupon_payments')).length, 0);
  });

  it('records a paid redemption once, however many times it is delivered', async () => {
    const first = await hook(event());
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(JSON.parse(first.body).duplicate, false);
    const again = await hook(event());
    assert.equal(again.statusCode, 200);
    assert.equal(JSON.parse(again.body).duplicate, true);
    assert.equal((await all(db, 'SELECT 1 FROM coupon_payments')).length, 1);
  });

  it('answers 200 for an unknown coupon and for other event types, and stores neither', async () => {
    assert.equal((await hook(event({ id: 'evt_x', couponCode: 'GHOST99' }))).statusCode, 200);
    assert.equal((await hook(event({ id: 'evt_y', type: 'coupon.redeemed' }))).statusCode, 200);
    assert.equal((await all(db, "SELECT 1 FROM coupon_payments WHERE event_id IN ('evt_x', 'evt_y')")).length, 0);
  });

  it('answers 400 for a signed body that is not a valid event', async () => {
    assert.equal((await hook({ id: 'evt_z' })).statusCode, 400);
    assert.equal((await hook('not json')).statusCode, 400);
  });

  it('counts each paying client once per salesperson and shows them on both dashboards', async () => {
    // a second payment from the same client, and one from another client
    await hook(event({ id: 'evt_2', payment: { id: 'pay_2', kind: 'renewal', amountCents: 50000, currency: 'INR', paidAt: Date.now() } }));
    await hook(event({ id: 'evt_3', client: { businessId: 'biz_2', name: 'Beta Gems', email: 'hi@beta.test' }, payment: { id: 'pay_3', kind: 'subscription', amountCents: 99900, currency: 'INR', paidAt: Date.now() } }));

    const aarav = await login('aarav@fynix.test');
    const boot = JSON.parse((await app.inject({ method: 'GET', url: '/api/admin/bootstrap', headers: { cookie: aarav } })).body) as {
      people: { id: string; coupons: { codes: string[]; clients: { businessId: string; amountCents: number; name: string; email: string }[] } }[];
    };
    const userId = await salesId();
    const mine = boot.people.find((p) => p.id === userId);
    assert.deepEqual(mine?.coupons.codes, ['PRIYA10']);
    assert.equal(mine?.coupons.clients.length, 2);
    assert.equal(mine?.coupons.clients.find((c) => c.businessId === 'biz_1')?.amountCents, 200000);
    assert.equal(mine?.coupons.clients.find((c) => c.businessId === 'biz_2')?.email, 'hi@beta.test');

    const manager = await all<{ email: string }>(db, "SELECT email FROM users WHERE role = 'manager' LIMIT 1");
    if (manager[0]) {
      const m = await login(manager[0].email).catch(() => null);
      if (m) {
        const mb = JSON.parse((await app.inject({ method: 'GET', url: '/api/manager/bootstrap', headers: { cookie: m } })).body) as { people: { id: string; coupons: { clients: unknown[] } }[] };
        const row = mb.people.find((p) => p.id === userId);
        if (row) assert.equal(row.coupons.clients.length, 2);
      }
    }
  });
});

describe('a salesperson sees the coupons made for them', () => {
  it('shows a new code on their own page, then the client who paid with it, and nobody else sees it', async () => {
    const aarav = await login('aarav@fynix.test');
    const aisha = await login('aisha@fynix.test');
    const karan = await login('karan@fynix.test');
    const ids = await all<{ id: string }>(db, "SELECT id FROM users WHERE email = 'aisha@fynix.test'");
    assert.ok(ids[0]);

    const before = await app.inject({ method: 'GET', url: '/api/sales/bootstrap', headers: { cookie: aisha } });
    const existing = (JSON.parse(before.body).coupons as { code: string }[]).length;

    stubBb(201, { id: 'bb_aisha', code: 'AISHA20' });
    const made = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'AISHA20', userId: ids[0].id, discountKind: 'percent', discountValue: 20, discountMonths: 1 } });
    assert.equal(made.statusCode, 201, made.body);

    const mine = JSON.parse((await app.inject({ method: 'GET', url: '/api/sales/bootstrap', headers: { cookie: aisha } })).body).coupons as { code: string; discountKind: string; discountValue: string; discountMonths: number | null; clients: unknown[] }[];
    assert.equal(mine.length, existing + 1);
    const code = mine.find((c) => c.code === 'AISHA20');
    assert.ok(code);
    assert.equal(code.discountKind, 'percent');
    assert.equal(code.discountValue, '20');
    assert.equal(code.discountMonths, 1);
    assert.deepEqual(code.clients, []);

    const theirs = JSON.parse((await app.inject({ method: 'GET', url: '/api/sales/bootstrap', headers: { cookie: karan } })).body).coupons as { code: string }[];
    assert.ok(!theirs.some((c) => c.code === 'AISHA20'));

    const paid = await hook(event({ id: 'evt_aisha', couponCode: 'AISHA20', client: { businessId: 'biz_aisha', name: 'Lotus Salon', email: 'hi@lotus.test' }, payment: { id: 'pay_aisha', kind: 'subscription', amountCents: 80000, currency: 'INR', paidAt: Date.now() } }));
    assert.equal(paid.statusCode, 200, paid.body);
    const after = JSON.parse((await app.inject({ method: 'GET', url: '/api/sales/bootstrap', headers: { cookie: aisha } })).body).coupons as { code: string; clients: { name: string; amountCents: number }[] }[];
    const used = after.find((c) => c.code === 'AISHA20');
    assert.ok(used);
    assert.equal(used.clients.length, 1);
    assert.equal(used.clients[0]?.name, 'Lotus Salon');
    assert.equal(used.clients[0]?.amountCents, 80000);
  });
});

describe('the note under a coupon', () => {
  async function aishaId(): Promise<string> {
    const rows = await all<{ id: string }>(db, "SELECT id FROM users WHERE email = 'aisha@fynix.test'");
    assert.ok(rows[0]);
    return rows[0].id;
  }
  const mine = async (cookie: string) => (JSON.parse((await app.inject({ method: 'GET', url: '/api/sales/bootstrap', headers: { cookie } })).body).coupons as { code: string; note: string }[]);

  it('is saved with the coupon, shown to that salesperson only, and can be changed or cleared', async () => {
    const aarav = await login('aarav@fynix.test');
    const aisha = await login('aisha@fynix.test');
    const karan = await login('karan@fynix.test');
    stubBb(201, { id: 'bb_note' });
    const made = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'NOTE100', userId: await aishaId(), discountKind: 'amount', discountValue: 250, note: '  Share with salon leads.\nOffer ends Friday.  ' } });
    assert.equal(made.statusCode, 201, made.body);
    const id = (JSON.parse(made.body) as { id: string }).id;

    assert.equal((await mine(aisha)).find((c) => c.code === 'NOTE100')?.note, 'Share with salon leads.\nOffer ends Friday.');
    assert.ok(!(await mine(karan)).some((c) => c.code === 'NOTE100'));
    const admin = JSON.parse((await app.inject({ method: 'GET', url: '/api/admin/coupons', headers: { cookie: aarav } })).body).coupons as { code: string; note: string }[];
    assert.equal(admin.find((c) => c.code === 'NOTE100')?.note, 'Share with salon leads.\nOffer ends Friday.');

    const edit = await app.inject({ method: 'PATCH', url: `/api/admin/coupons/${id}`, headers: { cookie: aarav }, payload: { note: 'New wording.' } });
    assert.equal(edit.statusCode, 200, edit.body);
    assert.equal((await mine(aisha)).find((c) => c.code === 'NOTE100')?.note, 'New wording.');

    assert.equal((await app.inject({ method: 'PATCH', url: `/api/admin/coupons/${id}`, headers: { cookie: aarav }, payload: { note: '   ' } })).statusCode, 200);
    assert.equal((await mine(aisha)).find((c) => c.code === 'NOTE100')?.note, '');
  });

  it('is optional on a new coupon, and empty then', async () => {
    const aarav = await login('aarav@fynix.test');
    const aisha = await login('aisha@fynix.test');
    stubBb(201, { id: 'bb_nonote' });
    const made = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'NONOTE', userId: await aishaId(), discountKind: 'percent', discountValue: 10 } });
    assert.equal(made.statusCode, 201, made.body);
    assert.equal((await mine(aisha)).find((c) => c.code === 'NONOTE')?.note, '');
  });

  it('is for superadmins only, limited to 500 characters, and needs a coupon that exists', async () => {
    const aarav = await login('aarav@fynix.test');
    const aisha = await login('aisha@fynix.test');
    const nisha = await login('nisha@fynix.test');
    const id = (await all<{ id: string }>(db, "SELECT id FROM coupons WHERE code = 'NOTE100'"))[0]?.id;
    assert.ok(id);
    const patch = (cookie: string, target: string, note: string) => app.inject({ method: 'PATCH', url: `/api/admin/coupons/${target}`, headers: { cookie }, payload: { note } });
    assert.equal((await patch(aisha, id, 'hi')).statusCode, 403);
    assert.equal((await patch(nisha, id, 'hi')).statusCode, 403);
    assert.equal((await patch('', id, 'hi')).statusCode, 401);
    assert.equal((await patch(aarav, id, 'x'.repeat(501))).statusCode, 400);
    assert.equal((await patch(aarav, id, 'x'.repeat(500))).statusCode, 200);
    assert.equal((await patch(aarav, 'missing', 'hi')).statusCode, 404);
    stubBb(201, { id: 'bb_long' });
    const long = await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'LONGNOTE', userId: await aishaId(), discountKind: 'percent', discountValue: 5, note: 'x'.repeat(501) } });
    assert.equal(long.statusCode, 400);
  });

  it('is never sent to BrandBasket', async () => {
    const aarav = await login('aarav@fynix.test');
    const seen: { body?: Record<string, unknown> } = {};
    stubBb(201, { id: 'bb_private' }, seen);
    await app.inject({ method: 'POST', url: '/api/admin/coupons', headers: { cookie: aarav }, payload: { code: 'PRIVATE1', userId: await aishaId(), discountKind: 'percent', discountValue: 5, note: 'internal only' } });
    assert.ok(seen.body);
    assert.equal('note' in seen.body, false);
  });
});

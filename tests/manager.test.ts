import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { openDb } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';
const CSV = [
  'title,category,address,phone,website,place_id',
  'Alpha Jewellers,Jewelry store,"Khar West, Mumbai",9820011111,https://alpha.example,p1',
  'Beta Diamonds,Jewelry store,"Khar East, Mumbai",9820022222,,p2',
  'Gamma Gems,Jewelry store,"Bandra, Mumbai",9820033333,,p3',
  'Delta Gold,Jewelry store,"Andheri, Mumbai",9820044444,,p4',
  'Epsilon Silver,Jewelry store,"Juhu, Mumbai",9820055555,,p5',
].join('\n');

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

  it('allows manager to verify closed claims (5 claimed, 3 verified, 2 rejected) and reflects on dashboards', async () => {
    const priya = await login('priya@fynix.test');
    const nisha = await login('nisha@fynix.test');

    // Priya claims 5 leads in Scale Website
    const bootSales = (await call(priya, 'GET', '/api/sales/bootstrap')).body as {
      leads: { id: string; open: string[] }[];
    };
    const openLeads = bootSales.leads.filter((l) => l.open.includes('scale-website')).slice(0, 5);
    assert.equal(openLeads.length, 5, 'should have at least 5 leads available to claim');

    const claimIds: string[] = [];
    for (const l of openLeads) {
      const claimed = await call(priya, 'POST', '/api/sales/claims', { leadId: l.id, workspaceId: 'scale-website' });
      assert.equal(claimed.status, 201);
      const cid = (claimed.body as { id: string }).id;
      claimIds.push(cid);
      // Mark as Won (Closed)
      const won = await call(priya, 'PATCH', `/api/sales/claims/${cid}`, { status: 'Won' });
      assert.equal(won.status, 200);
      assert.equal((won.body as { verified: number }).verified, 0, 'newly claimed Won lead must be pending verification (0)');
    }

    // Manager checks verifications
    const vers = (await call(nisha, 'GET', '/api/manager/verifications')).body as unknown as { id: string; verified: number; ownerName: string }[];
    const priyaVers = vers.filter((v) => claimIds.includes(v.id));
    assert.equal(priyaVers.length, 5, 'manager sees all 5 closed claims');
    assert.ok(priyaVers.every((v) => v.verified === 0), 'all 5 claims initially pending');

    // Manager verifies 3 as True (1), and 2 as False / Rejected (2)
    for (let i = 0; i < 3; i++) {
      const res = await call(nisha, 'PATCH', `/api/manager/claims/${claimIds[i]}/verify`, { verified: 1, note: 'Approved deal' });
      assert.equal(res.status, 200);
      assert.equal(res.body['verified'], 1);
    }
    for (let i = 3; i < 5; i++) {
      const res = await call(nisha, 'PATCH', `/api/manager/claims/${claimIds[i]}/verify`, { verified: 2, note: 'Deal fell through' });
      assert.equal(res.status, 200);
      assert.equal(res.body['verified'], 2);
    }

    // Manager bootstrap now shows 3 verifiedWon out of 5 won for Priya
    const bootMgr = (await call(nisha, 'GET', '/api/manager/bootstrap')).body as {
      people: { name: string; stats: { won: number; verifiedWon: number } }[];
    };
    const priyaStats = bootMgr.people.find((p) => p.name === 'Priya Sharma')?.stats;
    assert.ok(priyaStats);
    assert.equal(priyaStats.won, 5, 'Priya claimed 5 won');
    assert.equal(priyaStats.verifiedWon, 3, 'Manager verified 3 won');

    // Priya (salesperson) bootstrap also reflects the verified status on the claims
    const bootSalesAfter = (await call(priya, 'GET', '/api/sales/bootstrap')).body as {
      leads: { id: string; work: Record<string, { verified: number; verificationNote: string | null }> }[];
    };
    for (let i = 0; i < 3; i++) {
      const lead = bootSalesAfter.leads.find((l) => l.id === openLeads[i]?.id);
      const claimDto = lead?.work['scale-website'];
      assert.equal(claimDto?.verified, 1);
      assert.equal(claimDto?.verificationNote, 'Approved deal');
    }
    for (let i = 3; i < 5; i++) {
      const lead = bootSalesAfter.leads.find((l) => l.id === openLeads[i]?.id);
      const claimDto = lead?.work['scale-website'];
      assert.equal(claimDto?.verified, 2);
      assert.equal(claimDto?.verificationNote, 'Deal fell through');
    }

    // Manager opens a salesperson's leads: every claim with its stage and journey
    const priyaId = (bootMgr as unknown as { people: { id: string; name: string }[] }).people.find((p) => p.name === 'Priya Sharma')?.id;
    assert.ok(priyaId);
    const theirs = (await call(nisha, 'GET', `/api/manager/people/${priyaId}/leads`)).body as unknown as { leads: { id: string; status: string; history: { status: string }[]; notes: unknown[] }[] };
    assert.equal(theirs.leads.length, 5);
    assert.ok(theirs.leads.every((l) => l.status === 'Won' && l.history.some((h) => h.status === 'Won')));
    assert.equal((await call(priya, 'GET', `/api/manager/people/${priyaId}/leads`)).status, 403, 'a salesperson cannot use it');
    assert.equal((await call(nisha, 'GET', '/api/manager/people/nobody/leads')).status, 404);

    // The Team numbers can be limited to today, this week or this month
    for (const period of ['today', 'week', 'month']) {
      const res = await call(nisha, 'GET', `/api/manager/bootstrap?period=${period}`);
      assert.equal(res.status, 200);
      const ps = (res.body as unknown as { people: { name: string; stats: { assigned: number; won: number } }[] }).people.find((p) => p.name === 'Priya Sharma')?.stats;
      assert.equal(ps?.assigned, 5, 'assigned is everything they own, whatever the period');
      assert.equal(ps?.won, 5, 'all five were closed just now');
    }
    assert.equal((await call(nisha, 'GET', '/api/manager/bootstrap?period=year')).status, 400);

    // Salesperson cannot call verify API
    assert.equal((await call(priya, 'PATCH', `/api/manager/claims/${claimIds[0]}/verify`, { verified: 1 })).status, 403);
  });
});

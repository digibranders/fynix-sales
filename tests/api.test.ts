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
  'Delta Gold,Jewelry store,"Juhu, Mumbai",9820044444,,p4',
].join('\n');

let app: FastifyInstance;
let db: Db;

interface Lead {
  id: string;
  name: string;
  open: string[];
  work: Record<string, { id: string; status: string; next: string; comments: { text: string; by: string }[]; history: { s: string }[] }>;
}

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

async function bootstrap(cookie: string): Promise<{ leads: Lead[]; workspaces: { id: string }[]; notices: { title: string }[] }> {
  const res = await call(cookie, 'GET', '/api/sales/bootstrap');
  assert.equal(res.status, 200);
  return res.body as unknown as { leads: Lead[]; workspaces: { id: string }[]; notices: { title: string }[] };
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

describe('sign in', () => {
  it('rejects a wrong password and an unknown account with the same message', async () => {
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'priya@fynix.test', password: 'nope' } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ghost@fynix.test', password: 'nope' } });
    assert.equal(wrong.statusCode, 401);
    assert.equal(unknown.statusCode, 401);
    assert.equal(JSON.parse(wrong.body).message, JSON.parse(unknown.body).message);
  });

  it('sends each role to its own page and protects the pages', async () => {
    const priya = await login('priya@fynix.test');
    const aarav = await login('aarav@fynix.test');
    assert.equal((await app.inject({ method: 'GET', url: '/app' })).headers.location, '/login');
    assert.equal((await app.inject({ method: 'GET', url: '/admin', headers: { cookie: priya } })).headers.location, '/app');
    assert.equal((await app.inject({ method: 'GET', url: '/app', headers: { cookie: aarav } })).headers.location, '/admin');
    assert.equal((await app.inject({ method: 'GET', url: '/', headers: { cookie: aarav } })).headers.location, '/admin');
  });

  it('logs out and the old session stops working', async () => {
    const cookie = await login('priya@fynix.test');
    assert.equal((await call(cookie, 'POST', '/api/auth/logout')).status, 200);
    assert.equal((await call(cookie, 'GET', '/api/auth/me')).status, 401);
  });

  it('keeps the session cookie for the browser session only when remember me is off', async () => {
    const remembered = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'meera@fynix.test', password: PASSWORD } });
    const forgotten = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'meera@fynix.test', password: PASSWORD, remember: false } });
    assert.ok(remembered.cookies.find((c) => c.name === 'ld_session')?.expires, 'persistent by default');
    assert.equal(forgotten.cookies.find((c) => c.name === 'ld_session')?.expires, undefined);
  });

  it('signs a person out of every device', async () => {
    const phone = await login('meera@fynix.test');
    const laptop = await login('meera@fynix.test');
    const other = await login('aarav@fynix.test');
    assert.equal((await call(phone, 'POST', '/api/auth/logout-all')).status, 200);
    assert.equal((await call(phone, 'GET', '/api/auth/me')).status, 401);
    assert.equal((await call(laptop, 'GET', '/api/auth/me')).status, 401);
    assert.equal((await call(other, 'GET', '/api/auth/me')).status, 200, 'other people keep their sessions');
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout-all' })).statusCode, 401);
  });

  it('locks an address after repeated failures', async () => {
    let last = 0;
    for (let i = 0; i < 8; i += 1) {
      last = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'karan@fynix.test', password: `bad-${i}` } })).statusCode;
    }
    assert.equal(last, 429);
  });
});

describe('sales rules', () => {
  it('shows each salesperson only their own category and workspaces', async () => {
    const priya = await bootstrap(await login('priya@fynix.test'));
    const aisha = await bootstrap(await login('aisha@fynix.test'));
    assert.deepEqual(priya.workspaces.map((w) => w.id).sort(), ['scale-seo', 'scale-website']);
    assert.equal(priya.leads.length, 4);
    assert.ok(priya.leads.every((l) => l.name !== undefined && !l.name.startsWith('Sample')));
    assert.ok(aisha.leads.length > 0);
    assert.ok(aisha.leads.every((l) => l.name.startsWith('Sample')));
  });

  it('lets one person claim a store per workspace and hides it from the others', async () => {
    const priya = await login('priya@fynix.test');
    const rohan = await login('rohan@fynix.test');
    const lead = (await bootstrap(priya)).leads.find((l) => l.name === 'Alpha Jewellers');
    assert.ok(lead);

    const claim = await call(priya, 'POST', '/api/sales/claims', { leadId: lead.id, workspaceId: 'scale-website' });
    assert.equal(claim.status, 201);
    assert.equal(claim.body['status'], 'New');

    const again = await call(rohan, 'POST', '/api/sales/claims', { leadId: lead.id, workspaceId: 'scale-website' });
    assert.equal(again.status, 409);

    const rohanView = (await bootstrap(rohan)).leads.find((l) => l.id === lead.id);
    assert.ok(rohanView, 'still visible in his other workspaces');
    assert.ok(!rohanView.open.includes('scale-website'), 'gone from the workspace where it was claimed');
    assert.ok(rohanView.open.includes('scale-social-media'));
    assert.deepEqual(rohanView.work, {}, 'nothing about the other claim leaks');

    const priyaView = (await bootstrap(priya)).leads.find((l) => l.id === lead.id);
    assert.ok(priyaView?.work['scale-website']);
    assert.ok(priyaView.open.includes('scale-seo'), 'same store is still open in her SEO workspace');
  });

  it('refuses claims outside the salesperson workspaces', async () => {
    const priya = await login('priya@fynix.test');
    const lead = (await bootstrap(priya)).leads.find((l) => l.name === 'Beta Diamonds');
    assert.ok(lead);
    assert.equal((await call(priya, 'POST', '/api/sales/claims', { leadId: lead.id, workspaceId: 'scale-idraft' })).status, 404);
    assert.equal((await call(priya, 'POST', '/api/sales/claims', { leadId: lead.id, workspaceId: 'reach-website' })).status, 404);
  });

  it('moves a lead through stages with a follow-up date and notes', async () => {
    const priya = await login('priya@fynix.test');
    const lead = (await bootstrap(priya)).leads.find((l) => l.name === 'Beta Diamonds');
    assert.ok(lead);
    const claim = await call(priya, 'POST', '/api/sales/claims', { leadId: lead.id, workspaceId: 'scale-website' });
    const id = claim.body['id'] as string;

    const staged = await call(priya, 'PATCH', `/api/sales/claims/${id}`, { status: 'Contacted', next: '2030-01-15' });
    assert.equal(staged.status, 200);
    assert.equal(staged.body['status'], 'Contacted');
    assert.equal(staged.body['next'], '2030-01-15');

    assert.equal((await call(priya, 'PATCH', `/api/sales/claims/${id}`, { next: 'tomorrow' })).status, 400);
    assert.equal((await call(priya, 'PATCH', `/api/sales/claims/${id}`, { status: 'Bogus' })).status, 400);

    const noted = await call(priya, 'POST', `/api/sales/claims/${id}/notes`, { text: 'Spoke to the owner.', stage: 'Contacted' });
    assert.equal(noted.status, 201);
    const comments = noted.body['comments'] as { text: string; by: string }[];
    assert.ok(comments.some((c) => c.text === 'Spoke to the owner.' && c.by !== 'sys'));
    assert.ok(comments.some((c) => c.by === 'sys' && c.text.includes('Contacted')));
    assert.equal((await call(priya, 'POST', `/api/sales/claims/${id}/notes`, { text: '   ', stage: 'Contacted' })).status, 400);

    const won = await call(priya, 'PATCH', `/api/sales/claims/${id}`, { status: 'Won' });
    assert.equal(won.body['next'], '', 'closing a lead clears the follow-up');
    assert.deepEqual((won.body['history'] as { s: string }[]).map((h) => h.s), ['New', 'Contacted', 'Won']);
  });

  it("does not let someone change another person's lead", async () => {
    const priya = await login('priya@fynix.test');
    const rohan = await login('rohan@fynix.test');
    const lead = (await bootstrap(priya)).leads.find((l) => l.name === 'Gamma Gems');
    assert.ok(lead);
    const id = (await call(priya, 'POST', '/api/sales/claims', { leadId: lead.id, workspaceId: 'scale-website' })).body['id'] as string;
    assert.equal((await call(rohan, 'PATCH', `/api/sales/claims/${id}`, { status: 'Lost' })).status, 404);
    assert.equal((await call(rohan, 'POST', `/api/sales/claims/${id}/notes`, { text: 'hi', stage: 'New' })).status, 404);
  });

  it('lets people edit their own notes and nobody else', async () => {
    const priya = await login('priya@fynix.test');
    const rohan = await login('rohan@fynix.test');
    const lead = (await bootstrap(priya)).leads.find((l) => l.name === 'Delta Gold');
    assert.ok(lead);
    const claim = await call(priya, 'POST', '/api/sales/claims', { leadId: lead.id, workspaceId: 'scale-seo' });
    const claimId = claim.body['id'] as string;
    const noted = await call(priya, 'POST', `/api/sales/claims/${claimId}/notes`, { text: 'First wording.', stage: 'New' });
    const comments = noted.body['comments'] as { id: number; text: string; by: string; edited: boolean }[];
    const mine = comments.find((c) => c.text === 'First wording.');
    const system = comments.find((c) => c.by === 'sys');
    assert.ok(mine && system);
    assert.equal(mine.edited, false);

    const edited = await call(priya, 'PATCH', `/api/sales/notes/${mine.id}`, { text: '  Better wording.  ' });
    assert.equal(edited.status, 200);
    const after = (edited.body['comments'] as { id: number; text: string; edited: boolean }[]).find((c) => c.id === mine.id);
    assert.equal(after?.text, 'Better wording.');
    assert.equal(after?.edited, true);

    assert.equal((await call(priya, 'PATCH', `/api/sales/notes/${mine.id}`, { text: '   ' })).status, 400);
    assert.equal((await call(priya, 'PATCH', `/api/sales/notes/${system.id}`, { text: 'rewrite history' })).status, 404, 'system lines cannot be edited');
    assert.equal((await call(rohan, 'PATCH', `/api/sales/notes/${mine.id}`, { text: 'not yours' })).status, 404);
    assert.equal((await call(priya, 'PATCH', '/api/sales/notes/abc', { text: 'x' })).status, 404);
  });

  it('keeps notification reads per person', async () => {
    const priya = await login('priya@fynix.test');
    assert.equal((await call(priya, 'POST', '/api/sales/notifications/read', { keys: ['od:x:y:2030-01-01'] })).status, 200);
    const res = await call(priya, 'GET', '/api/sales/bootstrap');
    assert.ok((res.body['reads'] as string[]).includes('od:x:y:2030-01-01'));
    const rohan = await call(await login('rohan@fynix.test'), 'GET', '/api/sales/bootstrap');
    assert.deepEqual(rohan.body['reads'], []);
  });
});

describe('superadmin', () => {
  it('keeps sales accounts out of the admin API and anonymous users out of everything', async () => {
    const priya = await login('priya@fynix.test');
    assert.equal((await call(priya, 'GET', '/api/admin/bootstrap')).status, 403);
    assert.equal((await call(priya, 'POST', '/api/admin/workspaces', { name: 'X', category: 'scale' })).status, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/bootstrap' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/sales/bootstrap' })).statusCode, 401);
    const aarav = await login('aarav@fynix.test');
    assert.equal((await call(aarav, 'GET', '/api/sales/bootstrap')).status, 403);
  });

  it('shows both categories with their own workspaces, lists and people', async () => {
    const aarav = await login('aarav@fynix.test');
    const res = (await call(aarav, 'GET', '/api/admin/bootstrap')).body as {
      workspaces: { id: string; category: string; claimedCount: number }[];
      lists: { category: string; name: string }[];
      people: { email: string; role: string; category: string | null }[];
    };
    assert.equal(res.workspaces.filter((w) => w.category === 'scale').length, 4);
    assert.equal(res.workspaces.filter((w) => w.category === 'reach').length, 3);
    assert.deepEqual(res.lists.map((l) => l.category).sort(), ['reach', 'scale']);
    assert.equal(res.people.filter((p) => p.role === 'superadmin').length, 2);
    assert.ok(res.workspaces.find((w) => w.id === 'scale-website' && w.claimedCount >= 3));
  });

  it('creates workspaces only with lists and people from the same category', async () => {
    const aarav = await login('aarav@fynix.test');
    const boot = (await call(aarav, 'GET', '/api/admin/bootstrap')).body as {
      lists: { id: string; category: string }[];
      people: { id: string; email: string }[];
    };
    const scaleList = boot.lists.find((l) => l.category === 'scale')?.id;
    const reachList = boot.lists.find((l) => l.category === 'reach')?.id;
    const priya = boot.people.find((p) => p.email === 'priya@fynix.test')?.id;
    assert.ok(scaleList && reachList && priya);

    assert.equal((await call(aarav, 'POST', '/api/admin/workspaces', { name: 'Ads', category: 'reach', listIds: [scaleList] })).status, 400);
    assert.equal((await call(aarav, 'POST', '/api/admin/workspaces', { name: 'Ads', category: 'reach', memberIds: [priya] })).status, 400);
    const ok = await call(aarav, 'POST', '/api/admin/workspaces', { name: 'Google Ads', category: 'scale', icon: 'star', listIds: [scaleList], memberIds: [priya] });
    assert.equal(ok.status, 201);
    assert.equal(ok.body['id'], 'scale-google-ads');
    assert.equal((await call(aarav, 'POST', '/api/admin/workspaces', { name: 'Google Ads', category: 'scale' })).status, 409);

    const priyaBoot = await bootstrap(await login('priya@fynix.test'));
    assert.ok(priyaBoot.workspaces.some((w) => w.id === 'scale-google-ads'), 'the new workspace shows up for its member');
    assert.equal((await call(aarav, 'DELETE', '/api/admin/workspaces/scale-google-ads')).status, 200);
  });

  it('imports a list, deduplicates it, and tells the salespeople', async () => {
    const aarav = await login('aarav@fynix.test');
    const csv = ['title,category,address,phone,place_id', 'Omega Gems,Jewelry store,"Dadar, Mumbai",9820055555,p1', 'Zeta Gold,Jewelry store,"Worli, Mumbai",9820066666,p9'].join('\n');
    const res = await call(aarav, 'POST', '/api/admin/lists', { name: 'More jewellers', category: 'scale', csv, workspaceIds: ['scale-website'] });
    assert.equal(res.status, 201);
    assert.equal(res.body['added'], 1, 'p1 is already in an existing Scale list');
    assert.equal(res.body['duplicates'], 1);

    const rohan = await bootstrap(await login('rohan@fynix.test'));
    assert.ok(rohan.leads.some((l) => l.name === 'Zeta Gold'));
    assert.ok(rohan.notices.some((n) => n.title === 'New leads added'));

    assert.equal((await call(aarav, 'POST', '/api/admin/lists', { name: 'Bad', category: 'scale', csv: 'foo,bar\n1,2' })).status, 400);
    assert.equal((await call(aarav, 'POST', '/api/admin/lists', { name: 'Wrong', category: 'reach', csv, workspaceIds: ['scale-website'] })).status, 400);
    assert.equal((await call(aarav, 'POST', '/api/admin/lists', { name: 'Orphan', category: 'scale', csv })).status, 400, 'a list with no services would be invisible to everyone');
  });

  it('keeps a Reach import away from Scale salespeople and keeps landlines as given', async () => {
    const aarav = await login('aarav@fynix.test');
    const csv = ['title,phone,place_id', 'Chai Corner,+91 22 2412 3344,rc-1', 'Mobile Mart,098201 55501,rc-2'].join('\n');
    const res = await call(aarav, 'POST', '/api/admin/lists', { name: 'Reach only', category: 'reach', csv, workspaceIds: ['reach-social-media'] });
    assert.equal(res.status, 201);
    assert.equal(res.body['added'], 2);

    const aisha = await bootstrap(await login('aisha@fynix.test'));
    const chai = aisha.leads.find((l) => l.name === 'Chai Corner') as { phone: string } | undefined;
    const mart = aisha.leads.find((l) => l.name === 'Mobile Mart') as { phone: string } | undefined;
    assert.equal(chai?.phone, '+91 22 2412 3344');
    assert.equal(mart?.phone, '+91 98201 55501');

    const priya = await bootstrap(await login('priya@fynix.test'));
    assert.equal(priya.leads.some((l) => l.name === 'Chai Corner' || l.name === 'Mobile Mart'), false);
    const rohan = await bootstrap(await login('rohan@fynix.test'));
    assert.equal(rohan.leads.some((l) => l.name === 'Chai Corner' || l.name === 'Mobile Mart'), false);
  });

  it('reassigns and releases leads without touching other workspaces', async () => {
    const aarav = await login('aarav@fynix.test');
    const rohan = await login('rohan@fynix.test');
    const leads = (await call(aarav, 'GET', '/api/admin/leads?category=scale&q=delta')).body as { leads: { id: string }[] };
    const delta = leads.leads[0];
    assert.ok(delta);
    const boot = (await call(aarav, 'GET', '/api/admin/bootstrap')).body as { people: { id: string; email: string }[] };
    const rohanId = boot.people.find((p) => p.email === 'rohan@fynix.test')?.id;
    const aishaId = boot.people.find((p) => p.email === 'aisha@fynix.test')?.id;
    assert.ok(rohanId && aishaId);

    assert.equal((await call(aarav, 'PUT', `/api/admin/leads/${delta.id}/owners/scale-website`, { ownerId: aishaId })).status, 400, 'wrong category');
    assert.equal((await call(aarav, 'PUT', `/api/admin/leads/${delta.id}/owners/scale-website`, { ownerId: rohanId })).status, 200);
    const mine = (await bootstrap(rohan)).leads.find((l) => l.id === delta.id);
    assert.ok(mine?.work['scale-website']);
    assert.equal((await call(aarav, 'PUT', `/api/admin/leads/${delta.id}/owners/scale-website`, { ownerId: null })).status, 200);
    const released = (await bootstrap(rohan)).leads.find((l) => l.id === delta.id);
    assert.ok(released?.open.includes('scale-website'));
  });

  it('invites a salesperson with a temporary password that must be changed', async () => {
    const aarav = await login('aarav@fynix.test');
    const created = await call(aarav, 'POST', '/api/admin/users', { name: 'Neha Rao', email: 'neha@fynix.test', role: 'sales', category: 'reach', workspaceIds: ['reach-website'] });
    assert.equal(created.status, 201);
    const temp = created.body['temporaryPassword'] as string;
    assert.ok(temp.length >= 12);
    assert.equal((await call(aarav, 'POST', '/api/admin/users', { name: 'Neha Again', email: 'neha@fynix.test', role: 'sales', category: 'reach' })).status, 409);
    assert.equal((await call(aarav, 'POST', '/api/admin/users', { name: 'Wrong Mix', email: 'mix@fynix.test', role: 'sales', category: 'reach', workspaceIds: ['scale-website'] })).status, 400);

    const login1 = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'neha@fynix.test', password: temp } });
    assert.equal(login1.statusCode, 200);
    assert.equal(JSON.parse(login1.body).mustChangePassword, true);
    const cookie = `ld_session=${login1.cookies[0]?.value ?? ''}`;
    assert.equal((await call(cookie, 'GET', '/api/sales/bootstrap')).status, 403, 'blocked until the password is changed');
    assert.equal((await app.inject({ method: 'GET', url: '/app', headers: { cookie } })).headers.location, '/login');

    assert.equal((await call(cookie, 'POST', '/api/auth/change-password', { current: temp, next: 'short' })).status, 400);
    const changed = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { cookie }, payload: { current: temp, next: 'a-better-password-9' } });
    assert.equal(changed.statusCode, 200);
    const fresh = `ld_session=${changed.cookies[0]?.value ?? ''}`;
    assert.equal((await call(fresh, 'GET', '/api/sales/bootstrap')).status, 200);
    assert.equal((await call(cookie, 'GET', '/api/auth/me')).status, 401, 'the old session is revoked');
  });

  it('will not deactivate someone who still owns leads, and blocks deactivated people', async () => {
    const aarav = await login('aarav@fynix.test');
    const boot = (await call(aarav, 'GET', '/api/admin/bootstrap')).body as { people: { id: string; email: string }[] };
    const priyaId = boot.people.find((p) => p.email === 'priya@fynix.test')?.id;
    assert.ok(priyaId);
    assert.equal((await call(aarav, 'PATCH', `/api/admin/users/${priyaId}`, { active: false })).status, 409);
    const nehaId = boot.people.find((p) => p.email === 'neha@fynix.test')?.id;
    assert.ok(nehaId);
    assert.equal((await call(aarav, 'PATCH', `/api/admin/users/${nehaId}`, { active: false })).status, 200);
    const denied = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'neha@fynix.test', password: 'a-better-password-9' } });
    assert.equal(denied.statusCode, 401);
  });

  it('saves monthly targets per category', async () => {
    const aarav = await login('aarav@fynix.test');
    assert.equal((await call(aarav, 'PUT', '/api/admin/targets', { category: 'reach', contacted: 40, meetings: 10, won: 5 })).status, 200);
    const aisha = await call(await login('aisha@fynix.test'), 'GET', '/api/sales/bootstrap');
    assert.deepEqual(aisha.body['targets'], { contacted: 40, meetings: 10, won: 5 });
    const priya = await call(await login('priya@fynix.test'), 'GET', '/api/sales/bootstrap');
    assert.deepEqual(priya.body['targets'], { contacted: 20, meetings: 6, won: 3 });
    assert.equal((await call(aarav, 'PUT', '/api/admin/targets', { category: 'reach', contacted: -1, meetings: 1, won: 1 })).status, 400);
  });
});

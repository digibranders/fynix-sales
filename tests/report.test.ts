import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { csvCell, csvRow } from '../src/csv.js';
import type { Db } from '../src/db.js';
import { openDb } from '../src/db.js';
import { currentMonth } from '../src/routes/reports.js';
import { seedDatabase } from '../src/seed.js';

const PASSWORD = 'test-password-123';
const CSV = [
  'title,category,address,phone,place_id',
  'Alpha Jewellers,Jewelry store,"Khar West, Mumbai",9820011111,p1',
  'Beta Diamonds,Jewelry store,"Khar East, Mumbai",9820022222,p2',
  'Gamma Gems,Jewelry store,"Bandra, Mumbai",9820033333,p3',
].join('\n');

let app: FastifyInstance;
let db: Db;

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  return `ld_session=${res.cookies[0]?.value ?? ''}`;
}

async function json(cookie: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object): Promise<Record<string, unknown>> {
  const res = await app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  return JSON.parse(res.body) as Record<string, unknown>;
}

function parseCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n')
    .map((line) => line.split(','));
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

describe('csv cells', () => {
  it('quotes values that need it and defuses spreadsheet formulas', () => {
    assert.equal(csvCell('plain'), 'plain');
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell(42), '42');
    assert.equal(csvRow(['x', 1, 'y,z']), 'x,1,"y,z"');
  });
});

describe('monthly report', () => {
  it('is only for superadmins and checks the month', async () => {
    const priya = await login('priya@fynix.test');
    const aarav = await login('aarav@fynix.test');
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/reports/monthly', headers: { cookie: priya } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/reports/monthly' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/reports/monthly?month=2026-13', headers: { cookie: aarav } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/reports/monthly?month=November', headers: { cookie: aarav } })).statusCode, 400);
  });

  it('counts what each salesperson did in the month, per service, with totals', async () => {
    const priya = await login('priya@fynix.test');
    const boot = (await json(priya, 'GET', '/api/sales/bootstrap')) as { leads: { id: string; name: string }[] };
    const [first, second] = boot.leads;
    assert.ok(first && second);
    const claimA = (await json(priya, 'POST', '/api/sales/claims', { leadId: first.id, workspaceId: 'scale-website' })) as { id: string };
    const claimB = (await json(priya, 'POST', '/api/sales/claims', { leadId: second.id, workspaceId: 'scale-website' })) as { id: string };
    await json(priya, 'PATCH', `/api/sales/claims/${claimA.id}`, { status: 'Contacted' });
    await json(priya, 'PATCH', `/api/sales/claims/${claimA.id}`, { status: 'Won' });
    await json(priya, 'PATCH', `/api/sales/claims/${claimB.id}`, { status: 'Lost' });

    const aarav = await login('aarav@fynix.test');
    const month = currentMonth();
    const res = await app.inject({ method: 'GET', url: `/api/admin/reports/monthly?month=${month}&category=scale`, headers: { cookie: aarav } });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /text\/csv/);
    assert.match(String(res.headers['content-disposition']), new RegExp(`fynix-sales-report-${month}-scale\\.csv`));

    const rows = parseCsv(res.body);
    assert.deepEqual(rows[0], ['Month', 'Category', 'Service', 'Salesperson', 'Assigned', 'Contacted', 'Interested', 'Meetings', 'Negotiation', 'Closed', 'Lost', 'Open now']);
    const priyaWebsite = rows.find((r) => r[2] === 'Website' && r[3] === 'Priya Sharma');
    // assigned 2, contacted 2 (A left New, B went straight to Lost), won 1, lost 1, nothing left open
    assert.deepEqual(priyaWebsite?.slice(4), ['2', '2', '0', '0', '0', '1', '1', '0']);
    const rohanWebsite = rows.find((r) => r[2] === 'Website' && r[3] === 'Rohan Mehta');
    assert.deepEqual(rohanWebsite?.slice(4), ['0', '0', '0', '0', '0', '0', '0', '0'], 'people with no activity still appear');
    const websiteTotal = rows.find((r) => r[2] === 'Website' && r[3] === 'Total');
    assert.deepEqual(websiteTotal?.slice(4), ['2', '2', '0', '0', '0', '1', '1', '0']);
    assert.equal(rows.some((r) => r[1] === 'Reach'), false, 'the category filter keeps Reach out');
    const last = rows[rows.length - 1];
    assert.equal(last?.[3], 'Total');
    assert.equal(last?.[1], 'All');
  });

  it('shows zeros for a month with no activity and covers both categories by default', async () => {
    const aarav = await login('aarav@fynix.test');
    const res = await app.inject({ method: 'GET', url: '/api/admin/reports/monthly?month=2020-01', headers: { cookie: aarav } });
    const rows = parseCsv(res.body);
    assert.ok(rows.some((r) => r[1] === 'Reach'));
    assert.ok(rows.some((r) => r[1] === 'Scale'));
    for (const row of rows.slice(1)) assert.deepEqual(row.slice(4), ['0', '0', '0', '0', '0', '0', '0', row[11] ?? '0']);
  });
});

describe('my monthly report (salesperson)', () => {
  it('shows only the signed-in salesperson their own numbers', async () => {
    const rohan = await login('rohan@fynix.test');
    const priya = await login('priya@fynix.test');
    const boot = (await json(rohan, 'GET', '/api/sales/bootstrap')) as { leads: { id: string; name: string; open: string[] }[] };
    const lead = boot.leads.find((l) => l.open.includes('scale-social-media'));
    assert.ok(lead);
    const claim = (await json(rohan, 'POST', '/api/sales/claims', { leadId: lead.id, workspaceId: 'scale-social-media' })) as { id: string };
    await json(rohan, 'PATCH', `/api/sales/claims/${claim.id}`, { status: 'Contacted' });
    await json(rohan, 'PATCH', `/api/sales/claims/${claim.id}`, { status: 'Meeting' });

    const mine = (await json(rohan, 'GET', '/api/sales/report')) as {
      month: string;
      services: { service: string; assigned: number; contacted: number; meetings: number }[];
      totals: { assigned: number; contacted: number; meetings: number; won: number };
      history: { month: string; assigned: number }[];
    };
    assert.equal(mine.month, currentMonth());
    const social = mine.services.find((s) => s.service === 'Social Media');
    assert.equal(social?.assigned, 1);
    assert.equal(social?.contacted, 1);
    assert.equal(social?.meetings, 1);
    assert.equal(mine.history.length, 6);
    assert.equal(mine.history[0]?.month, currentMonth());
    assert.equal(mine.history[0]?.assigned, mine.totals.assigned);

    const theirs = (await json(priya, 'GET', '/api/sales/report')) as { services: { service: string }[] };
    assert.equal(theirs.services.some((s) => s.service === 'Social Media'), false, 'Priya is not in Social Media, and Rohan\'s numbers never reach her');
  });

  it('checks the month and who is asking', async () => {
    const rohan = await login('rohan@fynix.test');
    const aarav = await login('aarav@fynix.test');
    assert.equal((await app.inject({ method: 'GET', url: '/api/sales/report?month=2020-13', headers: { cookie: rohan } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: '/api/sales/report?month=2020-01', headers: { cookie: rohan } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/sales/report', headers: { cookie: aarav } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/sales/report' })).statusCode, 401);
  });
});

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { Category, Db, Params } from '../db.js';
import { CATEGORIES, all } from '../db.js';
import { csvRow } from '../csv.js';
import { CATEGORY_INFO } from '../domain.js';
import { superadmin } from './admin.js';

const query = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-11.')
    .optional(),
  category: z.enum(CATEGORIES).optional(),
});

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STAGE_COLUMNS = [
  ['Didnt Pick', 'Didnt Pick'],
  ['Follow Up', 'Follow Up'],
  ['Meetings', 'Meeting'],
  ['Paid', 'Won'],
  ['Lost', 'Lost'],
  ['Invalid', 'Invalid'],
] as const;

export interface ReportRow {
  category: Category;
  service: string;
  person: string;
  assigned: number;
  contacted: number;
  didntPick: number;
  followUp: number;
  meetings: number;
  won: number;
  lost: number;
  invalid: number;
  openNow: number;
}

interface DbRow {
  category: Category;
  service: string;
  person: string;
  assigned: number;
  contacted: number;
  didnt_pick: number;
  follow_up: number;
  meetings: number;
  won: number;
  lost: number;
  invalid: number;
  open_now: number;
}

export function monthRange(month: string): { start: number; end: number; label: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return {
    start: new Date(y, m - 1, 1).getTime(),
    end: new Date(y, m, 1).getTime(),
    label: `${MONTH_NAMES[m - 1] ?? month} ${y}`,
  };
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** One row per active salesperson per service they belong to, including people with no activity. */
export async function buildReport(db: Db, start: number, end: number, category?: Category, userId?: string): Promise<ReportRow[]> {
  const params: Params = [];
  const entered = (stage: string): string => {
    const list = stage === 'Invalid' ? ['Invalid Number', 'Invalid Email'] : [stage];
    params.push(...list, start, end);
    // A paid deal a manager marked False does not count as Paid.
    const notFalse = stage === 'Won' ? ' AND c.verified <> 2' : '';
    return `SUM(CASE WHEN EXISTS (SELECT 1 FROM claim_events e WHERE e.claim_id = c.id AND e.status IN (${list.map(() => '?').join(', ')}) AND e.at >= ? AND e.at < ?)${notFalse} THEN 1 ELSE 0 END)`;
  };
  params.push(start, end);
  const assigned = 'SUM(CASE WHEN c.created_at >= ? AND c.created_at < ? THEN 1 ELSE 0 END)';
  params.push(start, end);
  const contacted = `SUM(CASE WHEN (SELECT MIN(e.at) FROM claim_events e WHERE e.claim_id = c.id AND e.status <> 'New') >= ?
                              AND (SELECT MIN(e.at) FROM claim_events e WHERE e.claim_id = c.id AND e.status <> 'New') < ? THEN 1 ELSE 0 END)`;
  const didntPick = entered('Didnt Pick');
  const followUp = entered('Follow Up');
  const meetings = entered('Meeting');
  const won = entered('Won');
  const lost = entered('Lost');
  const invalid = entered('Invalid');
  const filter = `${category ? 'AND w.category = ?' : ''} ${userId ? 'AND u.id = ?' : ''}`;
  if (category) params.push(category);
  if (userId) params.push(userId);

  const sql = `
    SELECT w.category AS category, w.name AS service, u.name AS person,
           ${assigned} AS assigned,
           ${contacted} AS contacted,
           ${didntPick} AS didnt_pick,
           ${followUp} AS follow_up,
           ${meetings} AS meetings,
           ${won} AS won,
           ${lost} AS lost,
           ${invalid} AS invalid,
           SUM(CASE WHEN c.id IS NOT NULL AND c.status NOT IN ('Won', 'Lost', 'Invalid Number', 'Invalid Email') THEN 1 ELSE 0 END) AS open_now
      FROM workspace_members m
      JOIN users u ON u.id = m.user_id AND u.role = 'sales' AND u.active = 1
      JOIN workspaces w ON w.id = m.workspace_id
      LEFT JOIN claims c ON c.workspace_id = w.id AND c.owner_id = u.id
     WHERE 1 = 1 ${filter}
     GROUP BY w.id, u.id
     ORDER BY w.category, w.position, w.name, u.name`;
  return (await all<DbRow>(db, sql, params)).map((r) => ({
    category: r.category,
    service: r.service,
    person: r.person,
    assigned: r.assigned ?? 0,
    contacted: r.contacted ?? 0,
    didntPick: r.didnt_pick ?? 0,
    followUp: r.follow_up ?? 0,
    meetings: r.meetings ?? 0,
    won: r.won ?? 0,
    lost: r.lost ?? 0,
    invalid: r.invalid ?? 0,
    openNow: r.open_now ?? 0,
  }));
}

export const NUMBERS = ['assigned', 'contacted', 'didntPick', 'followUp', 'meetings', 'won', 'lost', 'invalid', 'openNow'] as const;
export type Totals = Record<(typeof NUMBERS)[number], number>;

export function totalsOf(rows: ReportRow[]): Totals {
  const totals = { assigned: 0, contacted: 0, didntPick: 0, followUp: 0, meetings: 0, won: 0, lost: 0, invalid: 0, openNow: 0 };
  for (const row of rows) for (const key of NUMBERS) totals[key] += row[key];
  return totals;
}

/** The month string n months before the given one, e.g. shiftMonth('2026-02', 3) is '2025-11'. */
export function shiftMonth(month: string, back: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sum(rows: ReportRow[]): number[] {
  return NUMBERS.map((key) => rows.reduce((total, row) => total + row[key], 0));
}

export function reportCsv(rows: ReportRow[], month: string, label: string): string {
  const header = ['Month', 'Category', 'Service', 'Salesperson', 'Assigned', 'Contacted', ...STAGE_COLUMNS.map((c) => c[0]), 'Open now'];
  const lines = [csvRow(header)];
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = `${row.category}|${row.service}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const categoryName = CATEGORY_INFO[first.category].name;
    for (const row of group) {
      lines.push(csvRow([month, categoryName, row.service, row.person, ...NUMBERS.map((key) => row[key])]));
    }
    lines.push(csvRow([month, categoryName, first.service, 'Total', ...sum(group)]));
  }
  lines.push(csvRow([label, 'All', 'All services', 'Total', ...sum(rows)]));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/admin/reports/monthly', async (request, reply) => {
    superadmin(request);
    const q = query.parse(request.query);
    const month = q.month ?? currentMonth();
    const { start, end, label } = monthRange(month);
    const csv = reportCsv(await buildReport(db, start, end, q.category), month, label);
    const scope = q.category ? `-${q.category}` : '';
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="fynix-sales-report-${month}${scope}.csv"`)
      .send(csv);
  });
}

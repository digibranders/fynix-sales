import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { SessionUser } from '../auth.js';
import type { Category, Db } from '../db.js';
import { all, inClause, newId, one, run, tx } from '../db.js';
import {
  HttpError,
  STAGES,
  claimDto,
  claimDtos,
  initials,
  isDateKey,
  logActivity,
} from '../domain.js';
import type { ClaimDto } from '../domain.js';
import { buildReport, currentMonth, monthRange, shiftMonth, totalsOf } from './reports.js';

interface WorkspaceRow {
  id: string;
  key: string;
  name: string;
  icon: string;
  color: string;
}
interface LeadRow {
  id: string;
  external_id: string;
  name: string;
  google_category: string;
  area: string;
  city: string;
  address: string;
  phone: string;
  website: string;
  emails: string;
  whatsapp: string;
  hours: string;
  company: string;
  job_title: string;
  personal_number: string;
  keywords: string;
  linkedin_url: string;
  country: string;
  state: string;
  social_links: string;
  workspace_id: string;
  archived: boolean;
}
interface ClaimLite {
  id: string;
  lead_id: string;
  workspace_id: string;
  owner_id: string;
}

const claimBody = z.object({ leadId: z.string().min(1).max(64), workspaceId: z.string().min(1).max(80) });
const patchBody = z
  .object({
    status: z.enum(STAGES).optional(),
    next: z.union([z.string(), z.null()]).optional(),
  })
  .refine((value) => value.status !== undefined || value.next !== undefined, 'Nothing to change.');
const noteBody = z.object({
  text: z.string().trim().min(1, 'Write a note first.').max(2000),
  stage: z.enum(STAGES),
});
const editNoteBody = z.object({ text: z.string().trim().min(1, 'Write a note first.').max(2000) });
const readBody = z.object({ keys: z.array(z.string().min(1).max(200)).max(300) });
const reportQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-11.').optional() });

function parseJsonArray(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function salesUser(request: FastifyRequest): SessionUser & { category: Category } {
  const user = request.user;
  if (!user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
  if (user.role !== 'sales' || !user.category) throw new HttpError(403, 'forbidden', 'This area is for the sales team.');
  if (user.mustChangePassword) throw new HttpError(403, 'password_change_required', 'Change your password first.');
  return { ...user, category: user.category };
}

async function ownedClaim(db: Db, claimId: string, userId: string): Promise<{ id: string; lead_id: string; workspace_id: string; status: string }> {
  const claim = await one<{ id: string; lead_id: string; workspace_id: string; owner_id: string; status: string }>(
    db,
    'SELECT id, lead_id, workspace_id, owner_id, status FROM claims WHERE id = ?',
    [claimId],
  );
  if (!claim || claim.owner_id !== userId) throw new HttpError(404, 'not_found', 'That lead is not yours any more.');
  return claim;
}

export function registerSalesRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/sales/bootstrap', async (request) => {
    const user = salesUser(request);
    const workspaces = await all<WorkspaceRow>(
      db,
      `SELECT w.id, w.key, w.name, w.icon, w.color
         FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = ? ORDER BY w.position, w.name`,
      [user.id],
    );
    const workspaceIds = workspaces.map((w) => w.id);
    const leads: Record<string, unknown>[] = [];

    if (workspaceIds.length > 0) {
      const marks = inClause(workspaceIds);
      const rows = await all<LeadRow>(
        db,
        `SELECT l.id, l.external_id, l.name, l.google_category, l.area, l.city, l.address, l.phone, l.website,
                l.emails, l.whatsapp, l.hours, l.company, l.job_title, l.personal_number, l.keywords,
                l.linkedin_url, l.country, l.state, l.social_links, wl.workspace_id, (s.archived_at IS NOT NULL) AS archived
           FROM leads l JOIN workspace_lists wl ON wl.list_id = l.list_id JOIN lists s ON s.id = l.list_id
          WHERE wl.workspace_id IN (${marks})
          ORDER BY lower(l.name), l.id`,
        workspaceIds,
      );
      const claims = await all<ClaimLite>(
        db,
        `SELECT id, lead_id, workspace_id, owner_id FROM claims WHERE workspace_id IN (${marks})`,
        workspaceIds,
      );
      const claimByPair = new Map(claims.map((c) => [`${c.lead_id}|${c.workspace_id}`, c]));
      const dtos = await claimDtos(
        db,
        claims.filter((c) => c.owner_id === user.id).map((c) => c.id),
      );

      const byLead = new Map<string, { row: LeadRow; open: string[]; work: Record<string, ClaimDto> }>();
      for (const row of rows) {
        const claim = claimByPair.get(`${row.id}|${row.workspace_id}`);
        if (claim && claim.owner_id !== user.id) continue; // taken by someone else: no trace of it
        if (!claim && row.archived) continue; // deactivated list: nothing new to claim, work already claimed carries on
        let entry = byLead.get(row.id);
        if (!entry) {
          entry = { row, open: [], work: {} };
          byLead.set(row.id, entry);
        }
        if (!claim) {
          entry.open.push(row.workspace_id);
        } else {
          const dto = dtos.get(claim.id);
          if (dto) entry.work[row.workspace_id] = dto;
        }
      }
      for (const { row, open, work } of byLead.values()) {
        if (open.length === 0 && Object.keys(work).length === 0) continue;
        leads.push({
          id: row.id,
          pid: row.external_id,
          name: row.name,
          cat: row.google_category,
          area: row.area,
          city: row.city,
          addr: row.address,
          phone: row.phone,
          web: row.website,
          email: parseJsonArray(row.emails),
          wa: row.whatsapp,
          hrs: parseJsonArray(row.hours),
          company: row.company || '',
          title: row.job_title || '',
          personalNumber: row.personal_number || '',
          keywords: row.keywords || '',
          linkedin: row.linkedin_url || '',
          country: row.country || '',
          state: row.state || '',
          social: parseJsonArray(row.social_links),
          open,
          work,
        });
      }
    }

    const notices = (await all<{ id: string; workspace_id: string; title: string; sub: string; at: number }>(
      db,
      'SELECT id, workspace_id, title, sub, at FROM notices WHERE user_id = ? ORDER BY at DESC LIMIT 30',
      [user.id],
    )).map((n) => ({ id: `n:${n.id}`, kind: 'info', title: n.title, sub: n.sub, svc: n.workspace_id, tab: 'info', at: n.at }));
    const reads = (await all<{ key: string }>(db, 'SELECT key FROM notification_reads WHERE user_id = ?', [user.id])).map((r) => r.key);
    const targets: Record<string, number> = {};
    for (const row of await all<{ metric: string; value: number }>(db, 'SELECT metric, value FROM kpi_targets WHERE category = ?', [user.category])) {
      targets[row.metric] = row.value;
    }

    return {
      me: { id: user.id, name: user.name, ini: initials(user.name), email: user.email, category: user.category },
      category: user.category,
      workspaces,
      leads,
      notices,
      reads,
      targets,
    };
  });

  /** The signed-in salesperson's own numbers for a month, per service, plus the last six months. */
  app.get('/api/sales/report', async (request) => {
    const user = salesUser(request);
    const q = reportQuery.parse(request.query);
    const month = q.month ?? currentMonth();
    const range = monthRange(month);
    const rows = await buildReport(db, range.start, range.end, undefined, user.id);
    const history = await Promise.all(
      Array.from({ length: 6 }, async (_, back) => {
        const m = shiftMonth(currentMonth(), back);
        const r = monthRange(m);
        return { month: m, label: r.label, ...totalsOf(await buildReport(db, r.start, r.end, undefined, user.id)) };
      }),
    );
    return {
      month,
      label: range.label,
      services: rows.map(({ category: _category, person: _person, ...rest }) => rest),
      totals: totalsOf(rows),
      history,
    };
  });

  app.post('/api/sales/claims', async (request, reply) => {
    const user = salesUser(request);
    const body = claimBody.parse(request.body);
    const result = await tx(db, async (db) => {
      const allowed = await one<{ name: string; category: Category; lead_name: string }>(
        db,
        `SELECT w.name, w.category, l.name AS lead_name
           FROM workspace_members m
           JOIN workspaces w ON w.id = m.workspace_id
           JOIN workspace_lists wl ON wl.workspace_id = w.id
           JOIN leads l ON l.list_id = wl.list_id
           JOIN lists s ON s.id = l.list_id
          WHERE m.user_id = ? AND w.id = ? AND l.id = ? AND s.archived_at IS NULL`,
        [user.id, body.workspaceId, body.leadId],
      );
      if (!allowed) throw new HttpError(404, 'not_found', 'That store is not available in this service.');
      const id = newId();
      const now = Date.now();
      // The unique (lead, service) key decides a race: only one of two simultaneous claims gets a row back.
      const inserted = await all<{ id: string }>(
        db,
        `INSERT INTO claims (id, lead_id, workspace_id, owner_id, status, last_activity_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (lead_id, workspace_id) DO NOTHING RETURNING id`,
        [id, body.leadId, body.workspaceId, user.id, 'New', now, now],
      );
      if (inserted.length === 0) throw new HttpError(409, 'already_claimed', 'That store was just claimed by someone else.');
      await run(db, 'INSERT INTO claim_events (claim_id, status, at) VALUES (?, ?, ?)', [id, 'New', now]);
      await run(db, "INSERT INTO notes (claim_id, author_id, system, stage, text, at) VALUES (?, NULL, 1, 'New', ?, ?)", [
        id,
        `Assigned to ${user.name} for ${allowed.name}.`,
        now,
      ]);
      await logActivity(db, allowed.category, `${user.name} claimed ${allowed.lead_name}`, `${allowed.name}`);
      return id;
    });
    reply.status(201);
    return await claimDto(db, result);
  });

  app.patch<{ Params: { id: string } }>('/api/sales/claims/:id', async (request) => {
    const user = salesUser(request);
    const body = patchBody.parse(request.body);
    const claim = await ownedClaim(db, request.params.id, user.id);
    if (body.next !== undefined && body.next !== null && !isDateKey(body.next)) {
      throw new HttpError(400, 'invalid_request', 'Pick a valid date.');
    }
    await tx(db, async (db) => {
      const now = Date.now();
      let next = body.next;
      if (body.status !== undefined && body.status !== claim.status) {
        await run(db, 'UPDATE claims SET status = ?, verified = 0, verified_at = NULL, verified_by = NULL, verification_note = NULL WHERE id = ?', [body.status, claim.id]);
        await run(db, 'INSERT INTO claim_events (claim_id, status, at) VALUES (?, ?, ?)', [claim.id, body.status, now]);
        await run(db, "INSERT INTO notes (claim_id, author_id, system, stage, text, at) VALUES (?, NULL, 1, ?, ?, ?)", [
          claim.id,
          body.status,
          `Stage changed to ${body.status}.`,
          now,
        ]);
        if (body.status === 'Won' || body.status === 'Lost') next = null;
        if (body.status === 'Meeting' || body.status === 'Won') {
          const info = await one<{ category: Category; name: string; lead_name: string }>(
            db,
            `SELECT w.category, w.name, l.name AS lead_name FROM claims c
               JOIN workspaces w ON w.id = c.workspace_id JOIN leads l ON l.id = c.lead_id WHERE c.id = ?`,
            [claim.id],
          );
          if (info) await logActivity(db, info.category, `${user.name} moved ${info.lead_name} to ${body.status}`, info.name);
        }
      }
      if (next !== undefined) await run(db, 'UPDATE claims SET next_follow_up = ? WHERE id = ?', [next, claim.id]);
      await run(db, 'UPDATE claims SET last_activity_at = ? WHERE id = ?', [now, claim.id]);
    });
    return await claimDto(db, claim.id);
  });

  app.post<{ Params: { id: string } }>('/api/sales/claims/:id/notes', async (request, reply) => {
    const user = salesUser(request);
    const body = noteBody.parse(request.body);
    const claim = await ownedClaim(db, request.params.id, user.id);
    const now = Date.now();
    await run(db, 'INSERT INTO notes (claim_id, author_id, system, stage, text, at) VALUES (?, ?, 0, ?, ?, ?)', [
      claim.id,
      user.id,
      body.stage,
      body.text,
      now,
    ]);
    await run(db, 'UPDATE claims SET last_activity_at = ? WHERE id = ?', [now, claim.id]);
    reply.status(201);
    return await claimDto(db, claim.id);
  });

  /** A salesperson can reword their own notes. System lines and other people's notes are off limits. */
  app.patch<{ Params: { id: string } }>('/api/sales/notes/:id', async (request) => {
    const user = salesUser(request);
    const body = editNoteBody.parse(request.body);
    const id = Number(request.params.id);
    const note = Number.isInteger(id)
      ? await one<{ claim_id: string; author_id: string | null; system: number }>(
          db,
          'SELECT n.claim_id, n.author_id, n.system FROM notes n JOIN claims c ON c.id = n.claim_id WHERE n.id = ? AND c.owner_id = ?',
          [id, user.id],
        )
      : undefined;
    if (!note || note.system === 1 || note.author_id !== user.id) throw new HttpError(404, 'not_found', 'That note is not yours to edit.');
    await run(db, 'UPDATE notes SET text = ?, edited_at = ? WHERE id = ?', [body.text, Date.now(), id]);
    return await claimDto(db, note.claim_id);
  });

  app.post('/api/sales/notifications/read', async (request) => {
    const user = salesUser(request);
    const body = readBody.parse(request.body);
    await tx(db, async (db) => {
      for (const key of body.keys) {
        await run(db, 'INSERT INTO notification_reads (user_id, key) VALUES (?, ?) ON CONFLICT DO NOTHING', [user.id, key]);
      }
    });
    return { ok: true };
  });
}

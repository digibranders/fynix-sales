import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { Role, SessionUser } from '../auth.js';
import { INVITE_TOKEN, NO_PASSWORD, createInvite, destroyUserSessions, findInvite } from '../auth.js';
import type { Category, Db, Metric } from '../db.js';
import { CATEGORIES, METRICS, all, inClause, insertMany, newId, one, run, tx } from '../db.js';
import {
  CATEGORY_INFO,
  HttpError,
  ICON_COLOR,
  WORKSPACE_COLORS,
  WORKSPACE_ICONS,
  initials,
  logActivity,
  monthStartMs,
  slugify,
} from '../domain.js';
import { LEAD_COLUMNS, leadValues } from '../domain.js';
import type { ParsedLead } from '../importer.js';
import { parseLeadsCsv } from '../importer.js';
import { inviteEmail } from '../mailer.js';

const category = z.enum(CATEGORIES);

const workspaceCreate = z.object({
  name: z.string().trim().min(2, 'Give the service a name.').max(40),
  category: z.enum([...CATEGORIES, 'both']),
  icon: z.enum(WORKSPACE_ICONS).default('globe'),
  color: z.enum(WORKSPACE_COLORS).optional(),
  listIds: z.array(z.string().max(64)).max(200).default([]),
  memberIds: z.array(z.string().max(64)).max(500).default([]),
});
const workspaceUpdate = z.object({
  listIds: z.array(z.string().max(64)).max(200),
  memberIds: z.array(z.string().max(64)).max(500),
});
const listCreate = z.object({
  name: z.string().trim().min(2, 'Give the list a name.').max(80),
  category,
  fileName: z.string().trim().max(200).default('import.csv'),
  csv: z.string().min(1, 'Choose a CSV file.'),
  workspaceIds: z.array(z.string().max(80)).min(1, 'Pick at least one service for this list.').max(50),
});
const userCreate = z.object({
  name: z.string().trim().min(2, 'Enter the full name.').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200),
  role: z.enum(['sales', 'superadmin', 'manager']),
  /** Required for a salesperson, optional for a manager (empty means both categories), unused for a superadmin. */
  category: category.optional(),
  workspaceIds: z.array(z.string().max(80)).max(50).default([]),
});
const userUpdate = z
  .object({
    name: z.string().trim().min(2, 'Enter the full name.').max(80, 'That name is too long.').optional(),
    /** Moves a salesperson to the other category, or sets a manager's category ('both' for a manager who sees everything). */
    category: z.enum([...CATEGORIES, 'both']).optional(),
    active: z.boolean().optional(),
    workspaceIds: z.array(z.string().max(80)).max(50).optional(),
  })
  .refine((v) => v.name !== undefined || v.category !== undefined || v.active !== undefined || v.workspaceIds !== undefined, 'Nothing to change.');
const inviteEmailBody = z.object({ token: z.string().regex(INVITE_TOKEN, 'That link is not valid.') });
const ownerBody = z.object({ ownerId: z.union([z.string().max(64), z.null()]) });
const targetsBody = z.object({
  category,
  contacted: z.number().int().min(0).max(10_000),
  meetings: z.number().int().min(0).max(10_000).optional(),
  won: z.number().int().min(0).max(10_000),
});
export const leadsQuery = z.object({
  category: category.optional(),
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

interface WorkspaceRow {
  id: string;
  category: Category;
  key: string;
  name: string;
  icon: string;
  color: string;
}
interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  category: Category | null;
  active: number;
  last_login_at: number | null;
}

export function superadmin(request: FastifyRequest): SessionUser {
  const user = request.user;
  if (!user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
  if (user.role !== 'superadmin') throw new HttpError(403, 'forbidden', 'Only a superadmin can do that.');
  if (user.mustChangePassword) throw new HttpError(403, 'password_change_required', 'Change your password first.');
  return user;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function checkWorkspaceMembers(db: Db, workspaceCategory: Category, memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;
  const rows = await all<{ id: string }>(
    db,
    `SELECT id FROM users WHERE id IN (${inClause(memberIds)}) AND role = 'sales' AND category = ? AND active = 1`,
    [...memberIds, workspaceCategory],
  );
  if (rows.length !== memberIds.length) {
    throw new HttpError(400, 'invalid_member', `Only active ${CATEGORY_INFO[workspaceCategory].name} salespeople can join this service.`);
  }
}

async function checkWorkspaceLists(db: Db, workspaceCategory: Category, listIds: string[]): Promise<void> {
  if (listIds.length === 0) return;
  const rows = await all<{ id: string }>(db, `SELECT id FROM lists WHERE id IN (${inClause(listIds)}) AND category = ?`, [...listIds, workspaceCategory]);
  if (rows.length !== listIds.length) {
    throw new HttpError(400, 'invalid_list', `Only ${CATEGORY_INFO[workspaceCategory].name} lists can be added to this service.`);
  }
}

async function checkUserWorkspaces(db: Db, userCategory: Category, workspaceIds: string[]): Promise<void> {
  if (workspaceIds.length === 0) return;
  const rows = await all<{ id: string }>(db, `SELECT id FROM workspaces WHERE id IN (${inClause(workspaceIds)}) AND category = ?`, [
    ...workspaceIds,
    userCategory,
  ]);
  if (rows.length !== workspaceIds.length) {
    throw new HttpError(400, 'invalid_workspace', `${CATEGORY_INFO[userCategory].name} people can only join ${CATEGORY_INFO[userCategory].name} services.`);
  }
}

async function claimCount(db: Db, sql: string, params: (string | number)[]): Promise<number> {
  return (await one<{ n: number }>(db, sql, params))?.n ?? 0;
}

/** Everyone who can sign in with this month's numbers. `scope` limits it to the salespeople of those categories (what a manager may see). */
export async function loadPeople(db: Db, scope: Category[] | null) {
  const month = monthStartMs();
  const users = scope
    ? await all<UserRow>(
        db,
        `SELECT id, name, email, role, category, active, last_login_at FROM users WHERE role = 'sales' AND category IN (${inClause(scope)}) ORDER BY name`,
        scope,
      )
    : await all<UserRow>(db, 'SELECT id, name, email, role, category, active, last_login_at FROM users ORDER BY role DESC, name');
  return Promise.all(users.map(async (u) => {
    const stats = { assigned: 0, contacted: 0, meetings: 0, won: 0, verifiedWon: 0 };
    if (u.role === 'sales') {
      stats.assigned = await claimCount(db, 'SELECT COUNT(*) AS n FROM claims WHERE owner_id = ?', [u.id]);
      stats.contacted = await claimCount(
        db,
        `SELECT COUNT(*) AS n FROM (
           SELECT c.id, MIN(e.at) AS first_at FROM claims c
             JOIN claim_events e ON e.claim_id = c.id AND e.status <> 'New'
            WHERE c.owner_id = ? GROUP BY c.id) AS firsts WHERE first_at >= ?`,
        [u.id, month],
      );
      for (const [key, stage] of [['meetings', 'Meeting'], ['won', 'Won']] as const) {
        stats[key] = await claimCount(
          db,
          `SELECT COUNT(DISTINCT c.id) AS n FROM claims c JOIN claim_events e ON e.claim_id = c.id
            WHERE c.owner_id = ? AND e.status = ? AND e.at >= ?`,
          [u.id, stage, month],
        );
      }
      stats.verifiedWon = await claimCount(
        db,
        `SELECT COUNT(DISTINCT c.id) AS n FROM claims c JOIN claim_events e ON e.claim_id = c.id
          WHERE c.owner_id = ? AND e.status = 'Won' AND e.at >= ? AND c.verified = 1`,
        [u.id, month],
      );
    }
    return {
      id: u.id,
      name: u.name,
      ini: initials(u.name),
      email: u.email,
      role: u.role,
      category: u.category,
      active: u.active === 1,
      invited: u.last_login_at === null,
      workspaceIds: (await all<{ workspace_id: string }>(db, 'SELECT workspace_id FROM workspace_members WHERE user_id = ?', [u.id])).map((r) => r.workspace_id),
      stats,
    };
  }));
}

export type LeadsQuery = z.infer<typeof leadsQuery>;

/** One page of leads with their owners per service. `scope` limits it to those categories (what a manager may see). */
export async function loadLeads(db: Db, query: LeadsQuery, scope: Category[] | null, pageSize = 50) {
  const filters: string[] = [];
  const params: (string | number)[] = [];
  const categories = scope ? (query.category ? scope.filter((c) => c === query.category) : scope) : query.category ? [query.category] : null;
  if (categories) {
    filters.push(categories.length > 0 ? `s.category IN (${inClause(categories)})` : 'FALSE');
    params.push(...categories);
  }
  if (query.q) {
    filters.push("(l.name ILIKE ? ESCAPE '\\' OR l.area ILIKE ? ESCAPE '\\' OR l.company ILIKE ? ESCAPE '\\')");
    const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const total = await claimCount(db, `SELECT COUNT(*) AS n FROM leads l JOIN lists s ON s.id = l.list_id ${where}`, params);
  const rows = await all<{
    id: string;
    name: string;
    area: string;
    city: string;
    phone: string;
    website: string;
    emails: string;
    company: string;
    job_title: string;
    personal_number: string;
    keywords: string;
    linkedin_url: string;
    list_id: string;
    category: Category;
  }>(
    db,
    `SELECT l.id, l.name, l.area, l.city, l.phone, l.website, l.emails, l.company, l.job_title, l.personal_number, l.keywords, l.linkedin_url, l.list_id, s.category
       FROM leads l JOIN lists s ON s.id = l.list_id ${where}
      ORDER BY lower(l.name), l.id LIMIT ? OFFSET ?`,
    [...params, pageSize, (query.page - 1) * pageSize],
  );
  const owners = new Map<string, Record<string, { id: string; name: string }>>();
  if (rows.length > 0) {
    const claims = await all<{ lead_id: string; key: string; owner_id: string; owner_name: string }>(
      db,
      `SELECT c.lead_id, w.key, u.id AS owner_id, u.name AS owner_name FROM claims c
         JOIN workspaces w ON w.id = c.workspace_id JOIN users u ON u.id = c.owner_id
        WHERE c.lead_id IN (${inClause(rows.map((r) => r.id))})`,
      rows.map((r) => r.id),
    );
    for (const claim of claims) {
      const entry = owners.get(claim.lead_id) ?? {};
      entry[claim.key] = { id: claim.owner_id, name: claim.owner_name };
      owners.set(claim.lead_id, entry);
    }
  }
  return {
    total,
    page: query.page,
    pageSize,
    leads: rows.map((r) => ({
      id: r.id,
      name: r.name,
      area: r.area,
      city: r.city,
      company: r.company || '',
      jobTitle: r.job_title || '',
      personalNumber: r.personal_number || '',
      keywords: r.keywords || '',
      linkedin: r.linkedin_url || '',
      phone: r.phone,
      website: r.website,
      listId: r.list_id,
      category: r.category,
      owners: owners.get(r.id) ?? {},
    })),
  };
}

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, mailer, config } = ctx;

  app.get('/api/admin/bootstrap', async (request) => {
    const me = superadmin(request);

    const workspaces = await Promise.all((await all<WorkspaceRow>(db, 'SELECT id, category, key, name, icon, color FROM workspaces ORDER BY category, position, name')).map(async (w) => ({
      ...w,
      leadCount: await claimCount(
        db,
        'SELECT COUNT(DISTINCT l.id) AS n FROM leads l JOIN workspace_lists wl ON wl.list_id = l.list_id JOIN lists s ON s.id = l.list_id AND s.archived_at IS NULL WHERE wl.workspace_id = ?',
        [w.id],
      ),
      claimedCount: await claimCount(db, 'SELECT COUNT(*) AS n FROM claims WHERE workspace_id = ?', [w.id]),
      listIds: (await all<{ list_id: string }>(db, 'SELECT list_id FROM workspace_lists WHERE workspace_id = ?', [w.id])).map((r) => r.list_id),
      memberIds: (await all<{ user_id: string }>(db, 'SELECT user_id FROM workspace_members WHERE workspace_id = ?', [w.id])).map((r) => r.user_id),
    })));

    const lists = await Promise.all((await all<{ id: string; name: string; category: Category; file_name: string; created_at: number; archived_at: number | null }>(
      db,
      'SELECT id, name, category, file_name, created_at, archived_at FROM lists ORDER BY created_at DESC',
    )).map(async (l) => ({
      id: l.id,
      name: l.name,
      category: l.category,
      fileName: l.file_name,
      createdAt: l.created_at,
      archived: l.archived_at !== null,
      leadCount: await claimCount(db, 'SELECT COUNT(*) AS n FROM leads WHERE list_id = ?', [l.id]),
      workspaceIds: (await all<{ workspace_id: string }>(db, 'SELECT workspace_id FROM workspace_lists WHERE list_id = ?', [l.id])).map((r) => r.workspace_id),
    })));

    const people = await loadPeople(db, null);

    const activity = await all<{ id: number; at: number; category: Category | null; text: string; sub: string }>(
      db,
      'SELECT id, at, category, text, sub FROM activity ORDER BY at DESC, id DESC LIMIT 30',
    );
    const targets: Record<string, Record<Metric, number>> = {};
    for (const row of await all<{ category: Category; metric: Metric; value: number }>(db, 'SELECT category, metric, value FROM kpi_targets')) {
      targets[row.category] = { ...(targets[row.category] ?? { contacted: 0, meetings: 0, won: 0 }), [row.metric]: row.value };
    }

    return {
      me: { id: me.id, name: me.name, ini: initials(me.name), email: me.email },
      categories: CATEGORY_INFO,
      workspaces,
      lists,
      people,
      activity,
      targets,
    };
  });

  app.post('/api/admin/workspaces', async (request, reply) => {
    const me = superadmin(request);
    const body = workspaceCreate.parse(request.body);
    const key = slugify(body.name);
    if (!key) throw new HttpError(400, 'invalid_request', 'Use letters or numbers in the name.');
    const categories: readonly Category[] = body.category === 'both' ? CATEGORIES : [body.category];
    const listIds = unique(body.listIds);
    const memberIds = unique(body.memberIds);
    if (categories.length > 1 && (listIds.length > 0 || memberIds.length > 0)) {
      throw new HttpError(400, 'invalid_request', 'Lists and salespeople belong to one category. Create the service first, then add them to each.');
    }
    const ids = await tx(db, async (db) => {
      const created: string[] = [];
      for (const cat of categories) {
        const id = `${cat}-${key}`;
        if (await one(db, 'SELECT 1 AS x FROM workspaces WHERE id = ?', [id])) {
          throw new HttpError(409, 'duplicate', `${CATEGORY_INFO[cat].name} already has a service called ${body.name}.`);
        }
        await checkWorkspaceLists(db, cat, listIds);
        await checkWorkspaceMembers(db, cat, memberIds);
        const position = await claimCount(db, 'SELECT COUNT(*) AS n FROM workspaces WHERE category = ?', [cat]);
        await run(db, 'INSERT INTO workspaces (id, category, key, name, icon, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          id,
          cat,
          key,
          body.name,
          body.icon,
          body.color ?? ICON_COLOR[body.icon],
          position,
          Date.now(),
        ]);
        for (const listId of listIds) await run(db, 'INSERT INTO workspace_lists (workspace_id, list_id) VALUES (?, ?)', [id, listId]);
        for (const memberId of memberIds) await run(db, 'INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)', [id, memberId]);
        await logActivity(db, cat, `${me.name} created the ${body.name} service`, CATEGORY_INFO[cat].name);
        created.push(id);
      }
      return created;
    });
    reply.status(201);
    return { id: ids[0], ids };
  });

  app.put<{ Params: { id: string } }>('/api/admin/workspaces/:id', async (request) => {
    const me = superadmin(request);
    const body = workspaceUpdate.parse(request.body);
    const listIds = unique(body.listIds);
    const memberIds = unique(body.memberIds);
    await tx(db, async (db) => {
      const workspace = await one<WorkspaceRow>(db, 'SELECT id, category, key, name, icon, color FROM workspaces WHERE id = ?', [request.params.id]);
      if (!workspace) throw new HttpError(404, 'not_found', 'That service does not exist.');
      await checkWorkspaceLists(db, workspace.category, listIds);
      await checkWorkspaceMembers(db, workspace.category, memberIds);

      const currentLists = (await all<{ list_id: string }>(db, 'SELECT list_id FROM workspace_lists WHERE workspace_id = ?', [workspace.id])).map((r) => r.list_id);
      for (const listId of currentLists.filter((id) => !listIds.includes(id))) {
        const n = await claimCount(
          db,
          'SELECT COUNT(*) AS n FROM claims c JOIN leads l ON l.id = c.lead_id WHERE c.workspace_id = ? AND l.list_id = ?',
          [workspace.id, listId],
        );
        if (n > 0) throw new HttpError(409, 'in_use', `${n} leads from that list are already assigned in ${workspace.name}. Reassign or release them first.`);
      }
      const currentMembers = (await all<{ user_id: string }>(db, 'SELECT user_id FROM workspace_members WHERE workspace_id = ?', [workspace.id])).map((r) => r.user_id);
      for (const userId of currentMembers.filter((id) => !memberIds.includes(id))) {
        const n = await claimCount(db, 'SELECT COUNT(*) AS n FROM claims WHERE workspace_id = ? AND owner_id = ?', [workspace.id, userId]);
        if (n > 0) throw new HttpError(409, 'in_use', `That person still owns ${n} leads in ${workspace.name}. Reassign or release them first.`);
      }
      await run(db, 'DELETE FROM workspace_lists WHERE workspace_id = ?', [workspace.id]);
      await run(db, 'DELETE FROM workspace_members WHERE workspace_id = ?', [workspace.id]);
      for (const listId of listIds) await run(db, 'INSERT INTO workspace_lists (workspace_id, list_id) VALUES (?, ?)', [workspace.id, listId]);
      for (const memberId of memberIds) await run(db, 'INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)', [workspace.id, memberId]);
      await logActivity(db, workspace.category, `${me.name} updated the ${workspace.name} service`, CATEGORY_INFO[workspace.category].name);
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/workspaces/:id', async (request) => {
    const me = superadmin(request);
    await tx(db, async (db) => {
      const workspace = await one<WorkspaceRow>(db, 'SELECT id, category, key, name, icon, color FROM workspaces WHERE id = ?', [request.params.id]);
      if (!workspace) throw new HttpError(404, 'not_found', 'That service does not exist.');
      const n = await claimCount(db, 'SELECT COUNT(*) AS n FROM claims WHERE workspace_id = ?', [workspace.id]);
      if (n > 0) throw new HttpError(409, 'in_use', `${workspace.name} still has ${n} assigned leads. Release them first.`);
      await run(db, 'DELETE FROM workspaces WHERE id = ?', [workspace.id]);
      await logActivity(db, workspace.category, `${me.name} removed the ${workspace.name} service`, CATEGORY_INFO[workspace.category].name);
    });
    return { ok: true };
  });

  app.post('/api/admin/lists', async (request, reply) => {
    const me = superadmin(request);
    const body = listCreate.parse(request.body);
    let parsed;
    try {
      parsed = parseLeadsCsv(body.csv);
    } catch (error) {
      throw new HttpError(400, 'invalid_csv', error instanceof Error ? error.message : 'The file could not be read.');
    }
    const workspaceIds = unique(body.workspaceIds);
    const result = await tx(db, async (db) => {
      if (workspaceIds.length > 0) {
        const rows = await all<{ id: string }>(db, `SELECT id FROM workspaces WHERE id IN (${inClause(workspaceIds)}) AND category = ?`, [
          ...workspaceIds,
          body.category,
        ]);
        if (rows.length !== workspaceIds.length) {
          throw new HttpError(400, 'invalid_workspace', `Only ${CATEGORY_INFO[body.category].name} services can use this list.`);
        }
      }
      const listId = newId();
      await run(db, 'INSERT INTO lists (id, name, category, file_name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        listId,
        body.name,
        body.category,
        body.fileName,
        me.id,
        Date.now(),
      ]);
      const known = new Set(
        (await all<{ external_id: string }>(
          db,
          'SELECT l.external_id FROM leads l JOIN lists s ON s.id = l.list_id WHERE s.category = ?',
          [body.category],
        )).map((r) => r.external_id),
      );
      const fresh: ParsedLead[] = [];
      const seen = new Set<string>();
      let duplicates = 0;
      for (const lead of parsed.leads) {
        if (known.has(lead.externalId) || seen.has(lead.externalId)) {
          duplicates += 1;
          continue;
        }
        seen.add(lead.externalId);
        fresh.push(lead);
      }
      const added = fresh.length;
      await insertMany(db, 'leads', LEAD_COLUMNS, fresh.map((lead) => leadValues(newId(), listId, lead)));
      if (added === 0) throw new HttpError(400, 'nothing_to_import', 'Every store in that file is already in a list or has no name.');
      for (const workspaceId of workspaceIds) {
        await run(db, 'INSERT INTO workspace_lists (workspace_id, list_id) VALUES (?, ?)', [workspaceId, listId]);
        const workspace = await one<{ name: string }>(db, 'SELECT name FROM workspaces WHERE id = ?', [workspaceId]);
        for (const member of await all<{ user_id: string }>(db, 'SELECT user_id FROM workspace_members WHERE workspace_id = ?', [workspaceId])) {
          await run(db, 'INSERT INTO notices (id, user_id, workspace_id, title, sub, at) VALUES (?, ?, ?, ?, ?, ?)', [
            newId(),
            member.user_id,
            workspaceId,
            'New leads added',
            `${added} new leads in ${workspace?.name ?? 'your service'}`,
            Date.now(),
          ]);
        }
      }
      await logActivity(db, body.category, `${me.name} imported ${body.name}`, `${added} leads`);
      return { id: listId, added, duplicates, skipped: parsed.skipped };
    });
    reply.status(201);
    return result;
  });

  /** Deactivating stops new claims on a list but keeps every lead and all work already done. */
  app.patch<{ Params: { id: string } }>('/api/admin/lists/:id', async (request) => {
    const me = superadmin(request);
    const body = z.object({ active: z.boolean() }).parse(request.body);
    await tx(db, async (db) => {
      const list = await one<{ name: string; category: Category; archived_at: number | null }>(db, 'SELECT name, category, archived_at FROM lists WHERE id = ?', [request.params.id]);
      if (!list) throw new HttpError(404, 'not_found', 'That list does not exist.');
      if (body.active === (list.archived_at === null)) return;
      await run(db, 'UPDATE lists SET archived_at = ? WHERE id = ?', [body.active ? null : Date.now(), request.params.id]);
      await logActivity(db, list.category, `${me.name} ${body.active ? 'activated' : 'deactivated'} the ${list.name} list`, CATEGORY_INFO[list.category].name);
    });
    return { ok: true };
  });

  /** Removing a list deletes its leads for good, so it is refused while any of them are assigned. */
  app.delete<{ Params: { id: string } }>('/api/admin/lists/:id', async (request) => {
    const me = superadmin(request);
    await tx(db, async (db) => {
      const list = await one<{ name: string; category: Category }>(db, 'SELECT name, category FROM lists WHERE id = ?', [request.params.id]);
      if (!list) throw new HttpError(404, 'not_found', 'That list does not exist.');
      const n = await claimCount(db, 'SELECT COUNT(*) AS n FROM claims c JOIN leads l ON l.id = c.lead_id WHERE l.list_id = ?', [request.params.id]);
      if (n > 0) {
        throw new HttpError(409, 'in_use', `${n} leads from ${list.name} are assigned to salespeople. Deactivate the list instead, or release them first.`);
      }
      await run(db, 'DELETE FROM lists WHERE id = ?', [request.params.id]);
      await logActivity(db, list.category, `${me.name} removed the ${list.name} list`, CATEGORY_INFO[list.category].name);
    });
    return { ok: true };
  });

  app.get('/api/admin/leads', async (request) => {
    superadmin(request);
    return loadLeads(db, leadsQuery.parse(request.query), null);
  });

  app.put<{ Params: { leadId: string; workspaceId: string } }>('/api/admin/leads/:leadId/owners/:workspaceId', async (request) => {
    const me = superadmin(request);
    const body = ownerBody.parse(request.body);
    const { leadId, workspaceId } = request.params;
    await tx(db, async (db) => {
      const info = await one<{ lead_name: string; ws_name: string; category: Category; archived_at: number | null }>(
        db,
        `SELECT l.name AS lead_name, w.name AS ws_name, w.category, s.archived_at FROM leads l
           JOIN workspace_lists wl ON wl.list_id = l.list_id
           JOIN workspaces w ON w.id = wl.workspace_id
           JOIN lists s ON s.id = l.list_id
          WHERE l.id = ? AND w.id = ?`,
        [leadId, workspaceId],
      );
      if (!info) throw new HttpError(404, 'not_found', 'That store is not part of this service.');
      const existing = await one<{ id: string; owner_id: string }>(db, 'SELECT id, owner_id FROM claims WHERE lead_id = ? AND workspace_id = ?', [leadId, workspaceId]);
      if (body.ownerId === null) {
        if (existing) await run(db, 'DELETE FROM claims WHERE id = ?', [existing.id]);
        await logActivity(db, info.category, `${me.name} released ${info.lead_name}`, info.ws_name);
        return;
      }
      if (info.archived_at !== null) throw new HttpError(409, 'list_inactive', 'That store is in a deactivated list. Activate the list to assign it.');
      const owner = await one<{ id: string; name: string }>(
        db,
        `SELECT u.id, u.name FROM users u JOIN workspace_members m ON m.user_id = u.id
          WHERE u.id = ? AND m.workspace_id = ? AND u.role = 'sales' AND u.active = 1`,
        [body.ownerId, workspaceId],
      );
      if (!owner) throw new HttpError(400, 'invalid_member', 'That person is not an active member of this service.');
      const now = Date.now();
      if (existing) {
        if (existing.owner_id === owner.id) return;
        await run(db, 'UPDATE claims SET owner_id = ?, last_activity_at = ? WHERE id = ?', [owner.id, now, existing.id]);
        const status = (await one<{ status: string }>(db, 'SELECT status FROM claims WHERE id = ?', [existing.id]))?.status ?? 'New';
        await run(db, 'INSERT INTO notes (claim_id, author_id, system, stage, text, at) VALUES (?, NULL, 1, ?, ?, ?)', [
          existing.id,
          status,
          `Reassigned to ${owner.name}.`,
          now,
        ]);
      } else {
        const id = newId();
        await run(db, 'INSERT INTO claims (id, lead_id, workspace_id, owner_id, status, last_activity_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          id,
          leadId,
          workspaceId,
          owner.id,
          'New',
          now,
          now,
        ]);
        await run(db, 'INSERT INTO claim_events (claim_id, status, at) VALUES (?, ?, ?)', [id, 'New', now]);
        await run(db, "INSERT INTO notes (claim_id, author_id, system, stage, text, at) VALUES (?, NULL, 1, 'New', ?, ?)", [
          id,
          `Assigned to ${owner.name} for ${info.ws_name}.`,
          now,
        ]);
      }
      await logActivity(db, info.category, `${me.name} assigned ${info.lead_name} to ${owner.name}`, info.ws_name);
    });
    return { ok: true };
  });

  app.post('/api/admin/users', async (request, reply) => {
    const me = superadmin(request);
    const body = userCreate.parse(request.body);
    const isSales = body.role === 'sales';
    if (isSales && !body.category) throw new HttpError(400, 'invalid_request', 'Choose Scale or Reach for a salesperson.');
    const userCategory = body.role === 'superadmin' ? null : (body.category ?? null);
    const workspaceIds = isSales ? unique(body.workspaceIds) : [];
    const id = newId();
    await tx(db, async (db) => {
      if (await one(db, 'SELECT 1 AS x FROM users WHERE email = ?', [body.email])) {
        throw new HttpError(409, 'duplicate', 'Someone with that email already has an account.');
      }
      if (userCategory) await checkUserWorkspaces(db, userCategory, workspaceIds);
      // No password yet: the person chooses their own through the invite link.
      await run(db, 'INSERT INTO users (id, name, email, password_hash, role, category, active, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)', [
        id,
        body.name,
        body.email,
        NO_PASSWORD,
        body.role,
        userCategory,
        Date.now(),
      ]);
      for (const workspaceId of workspaceIds) await run(db, 'INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)', [workspaceId, id]);
      const subtitle = body.role === 'superadmin' ? 'Superadmin' : body.role === 'manager' ? `Manager, ${userCategory ? CATEGORY_INFO[userCategory].name : 'Scale and Reach'}` : userCategory ? CATEGORY_INFO[userCategory].name : '';
      await logActivity(db, userCategory, `${me.name} invited ${body.name}`, subtitle);
    });
    const invite = await createInvite(db, id);
    const inviteUrl = `${config.appUrl}/invite/${invite.token}`;
    reply.status(201);
    return { id, inviteUrl, expiresAt: invite.expiresAt, canEmail: mailer.enabled };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (request) => {
    const me = superadmin(request);
    const body = userUpdate.parse(request.body);
    await tx(db, async (db) => {
      const user = await one<UserRow>(db, 'SELECT id, name, email, role, category, active, last_login_at FROM users WHERE id = ?', [request.params.id]);
      if (!user) throw new HttpError(404, 'not_found', 'That person does not exist.');
      if (body.name !== undefined && body.name !== user.name) {
        await run(db, 'UPDATE users SET name = ? WHERE id = ?', [body.name, user.id]);
        await logActivity(db, user.category, `${me.name} renamed ${user.name} to ${body.name}`, '');
      }
      if (body.category !== undefined) {
        if (user.role === 'superadmin') throw new HttpError(400, 'invalid_request', 'Superadmins already see both categories.');
        const next: Category | null = body.category === 'both' ? null : body.category;
        if (user.role === 'sales' && next === null) throw new HttpError(400, 'invalid_request', 'A salesperson belongs to Scale or Reach, not both.');
        if (next !== user.category) {
          if (user.role === 'sales') {
            const owned = await claimCount(db, 'SELECT COUNT(*) AS n FROM claims WHERE owner_id = ?', [user.id]);
            if (owned > 0) throw new HttpError(409, 'in_use', `${user.name} still owns ${owned} leads. Reassign or release them first.`);
          }
          // Services belong to one category, so the old ones go; pick the new ones with workspaceIds.
          await run(db, 'DELETE FROM workspace_members WHERE user_id = ?', [user.id]);
          await run(db, 'UPDATE users SET category = ? WHERE id = ?', [next, user.id]);
          await logActivity(db, next ?? user.category, `${me.name} moved ${user.name} to ${next ? CATEGORY_INFO[next].name : 'Scale and Reach'}`, '');
          user.category = next;
        }
      }
      if (body.active !== undefined && body.active !== (user.active === 1)) {
        if (!body.active) {
          if (user.id === me.id) throw new HttpError(400, 'invalid_request', 'You cannot deactivate your own account.');
          const owned = await claimCount(db, 'SELECT COUNT(*) AS n FROM claims WHERE owner_id = ?', [user.id]);
          if (owned > 0) throw new HttpError(409, 'in_use', `${user.name} still owns ${owned} leads. Reassign or release them first.`);
          await destroyUserSessions(db, user.id);
        }
        await run(db, 'UPDATE users SET active = ? WHERE id = ?', [body.active ? 1 : 0, user.id]);
        await logActivity(db, user.category, `${me.name} ${body.active ? 'reactivated' : 'deactivated'} ${user.name}`, '');
      }
      if (body.workspaceIds !== undefined) {
        if (user.role !== 'sales' || !user.category) throw new HttpError(400, 'invalid_request', 'Only salespeople are assigned to services.');
        const workspaceIds = unique(body.workspaceIds);
        await checkUserWorkspaces(db, user.category, workspaceIds);
        const current = (await all<{ workspace_id: string }>(db, 'SELECT workspace_id FROM workspace_members WHERE user_id = ?', [user.id])).map((r) => r.workspace_id);
        for (const workspaceId of current.filter((id) => !workspaceIds.includes(id))) {
          const owned = await claimCount(db, 'SELECT COUNT(*) AS n FROM claims WHERE workspace_id = ? AND owner_id = ?', [workspaceId, user.id]);
          if (owned > 0) throw new HttpError(409, 'in_use', `${user.name} still owns ${owned} leads in that service. Reassign or release them first.`);
        }
        await run(db, 'DELETE FROM workspace_members WHERE user_id = ?', [user.id]);
        for (const workspaceId of workspaceIds) await run(db, 'INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)', [workspaceId, user.id]);
      }
    });
    return { ok: true };
  });

  /** Removes a person for good. Their sign-ins, invites and service memberships go with them; anyone who still owns leads must be dealt with first. */
  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (request) => {
    const me = superadmin(request);
    await tx(db, async (db) => {
      const user = await one<UserRow>(db, 'SELECT id, name, email, role, category, active, last_login_at FROM users WHERE id = ?', [request.params.id]);
      if (!user) throw new HttpError(404, 'not_found', 'That person does not exist.');
      if (user.id === me.id) throw new HttpError(400, 'invalid_request', 'You cannot delete your own account.');
      const owned = await claimCount(db, 'SELECT COUNT(*) AS n FROM claims WHERE owner_id = ?', [user.id]);
      if (owned > 0) throw new HttpError(409, 'in_use', `${user.name} still owns ${owned} leads. Reassign or release them first.`);
      await run(db, 'DELETE FROM users WHERE id = ?', [user.id]);
      await logActivity(db, user.category, `${me.name} deleted ${user.name}`, '');
    });
    return { ok: true };
  });

  /** A fresh one-time link for someone who has not signed up yet, or who needs a new password. The old link stops working. */
  app.post<{ Params: { id: string } }>('/api/admin/users/:id/invite', async (request) => {
    const me = superadmin(request);
    const user = await one<UserRow>(db, 'SELECT id, name, email, role, category, active, last_login_at FROM users WHERE id = ?', [request.params.id]);
    if (!user) throw new HttpError(404, 'not_found', 'That person does not exist.');
    if (user.id === me.id) throw new HttpError(400, 'invalid_request', 'Ask another superadmin for a link to change your own password.');
    if (user.active !== 1) throw new HttpError(409, 'inactive', `${user.name} is deactivated. Reactivate them first.`);
    const invite = await createInvite(db, user.id);
    const inviteUrl = `${config.appUrl}/invite/${invite.token}`;
    const reset = user.last_login_at !== null;
    return { inviteUrl, expiresAt: invite.expiresAt, reset, canEmail: mailer.enabled };
  });

  /** Emails a link that was already shown to the superadmin, only when they press the button. The link itself does not change. */
  app.post<{ Params: { id: string } }>('/api/admin/users/:id/invite/email', async (request) => {
    const me = superadmin(request);
    const { token } = inviteEmailBody.parse(request.body);
    if (!mailer.enabled) throw new HttpError(409, 'email_off', 'Email is not set up yet. Copy the link and send it yourself.');
    const invite = await findInvite(db, token);
    if (!invite || invite.userId !== request.params.id) throw new HttpError(404, 'not_found', 'That link is no longer valid. Create a new one.');
    const days = Math.max(1, Math.ceil((invite.expiresAt - Date.now()) / 86_400_000));
    const sent = await mailer.send(
      inviteEmail({ name: invite.name, email: invite.email, invitedBy: me.name, link: `${config.appUrl}/invite/${token}`, reset: invite.reset, days }),
    );
    if (!sent) throw new HttpError(502, 'email_failed', 'We could not send the email. Copy the link and send it yourself.');
    return { ok: true, sentTo: invite.email };
  });

  app.put('/api/admin/targets', async (request) => {
    superadmin(request);
    const body = targetsBody.parse(request.body);
    await tx(db, async (db) => {
      for (const metric of METRICS) {
        const value = body[metric];
        if (value !== undefined) await run(db, 'UPDATE kpi_targets SET value = ? WHERE category = ? AND metric = ?', [value, body.category, metric]);
      }
    });
    return { ok: true };
  });
}

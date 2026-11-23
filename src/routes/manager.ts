import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { SessionUser } from '../auth.js';
import { CATEGORIES, all, inClause, one, run, tx } from '../db.js';
import type { Category, Params } from '../db.js';
import { CATEGORY_INFO, HttpError, STAGES, initials, logActivity } from '../domain.js';
import { leadsQuery, loadLeads, loadPeople } from './admin.js';

interface WorkspaceRow {
  id: string;
  category: Category;
  key: string;
  name: string;
  icon: string;
  color: string;
}

interface VerificationRow {
  id: string;
  lead_id: string;
  workspace_id: string;
  owner_id: string;
  status: string;
  verified: number;
  verified_at: number | null;
  verified_by: string | null;
  verification_note: string | null;
  lead_name: string;
  lead_area: string;
  lead_city: string;
  lead_company: string;
  lead_job_title: string;
  lead_phone: string;
  workspace_name: string;
  workspace_category: Category;
  owner_name: string;
  closed_at: number;
  latest_note: string | null;
}

const verifyBody = z.object({
  verified: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  note: z.string().max(500).optional(),
  status: z.enum(STAGES).optional(),
});

/** The signed-in manager and the categories they may look at: one, or both when none was chosen. */
function manager(request: FastifyRequest): { user: SessionUser; scope: Category[] } {
  const user = request.user;
  if (!user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
  if (user.role !== 'manager') throw new HttpError(403, 'forbidden', 'This area is for managers.');
  if (user.mustChangePassword) throw new HttpError(403, 'password_change_required', 'Change your password first.');
  return { user, scope: user.category ? [user.category] : [...CATEGORIES] };
}

/** Views and verification tools for managers: team stats, closed deal verification, and lead views. */
export function registerManagerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/manager/bootstrap', async (request) => {
    const { user, scope } = manager(request);
    const workspaces = (await all<WorkspaceRow>(db, 'SELECT id, category, key, name, icon, color FROM workspaces ORDER BY category, position, name')).filter((w) =>
      scope.includes(w.category),
    );
    const people = await loadPeople(db, scope);
    return {
      me: { id: user.id, name: user.name, ini: initials(user.name), email: user.email },
      categories: Object.fromEntries(scope.map((c) => [c, CATEGORY_INFO[c]])),
      workspaces,
      people: people.map(({ email: _email, ...rest }) => rest),
    };
  });

  app.get('/api/manager/leads', async (request) => {
    const { scope } = manager(request);
    return loadLeads(db, leadsQuery.parse(request.query), scope, 25);
  });

  app.get<{ Querystring: { userId?: string; category?: Category } }>('/api/manager/verifications', async (request) => {
    const { scope } = manager(request);
    const qCat = request.query.category;
    const qUser = request.query.userId;
    const cats = qCat && scope.includes(qCat) ? [qCat] : scope;
    if (cats.length === 0) return [];
    const marks = inClause(cats);
    const params: Params = [...cats];
    let extra = '';
    if (qUser) {
      extra += ' AND c.owner_id = ?';
      params.push(qUser);
    }
    const rows = await all<VerificationRow>(
      db,
      `SELECT c.id, c.lead_id, c.workspace_id, c.owner_id, c.status, c.verified, c.verified_at, c.verified_by, c.verification_note,
              l.name AS lead_name, l.area AS lead_area, l.city AS lead_city, l.company AS lead_company, l.job_title AS lead_job_title, l.phone AS lead_phone,
              w.name AS workspace_name, w.category AS workspace_category,
              u.name AS owner_name,
              COALESCE((SELECT MAX(e.at) FROM claim_events e WHERE e.claim_id = c.id AND e.status = 'Won'), c.last_activity_at) AS closed_at,
              (SELECT n.text FROM notes n WHERE n.claim_id = c.id AND n.system = 0 ORDER BY n.at DESC, n.id DESC LIMIT 1) AS latest_note
         FROM claims c
         JOIN leads l ON l.id = c.lead_id
         JOIN workspaces w ON w.id = c.workspace_id
         JOIN users u ON u.id = c.owner_id
        WHERE (c.status = 'Won' OR c.verified IN (1, 2)) AND w.category IN (${marks})${extra}
        ORDER BY c.verified ASC, closed_at DESC`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      workspaceId: r.workspace_id,
      ownerId: r.owner_id,
      status: r.status,
      verified: r.verified ?? 0,
      verifiedAt: r.verified_at,
      verifiedBy: r.verified_by,
      verificationNote: r.verification_note,
      leadName: r.lead_name,
      leadArea: r.lead_area,
      leadCity: r.lead_city,
      leadCompany: r.lead_company,
      leadJobTitle: r.lead_job_title,
      leadPhone: r.lead_phone,
      workspaceName: r.workspace_name,
      workspaceCategory: r.workspace_category,
      ownerName: r.owner_name,
      closedAt: r.closed_at,
      latestNote: r.latest_note,
    }));
  });

  app.patch<{ Params: { id: string } }>('/api/manager/claims/:id/verify', async (request) => {
    const { user, scope } = manager(request);
    const claimId = request.params.id;
    const body = verifyBody.parse(request.body);

    const claim = await one<{
      id: string;
      lead_id: string;
      workspace_id: string;
      owner_id: string;
      status: string;
      verified: number;
      category: Category;
      lead_name: string;
      workspace_name: string;
    }>(
      db,
      `SELECT c.id, c.lead_id, c.workspace_id, c.owner_id, c.status, c.verified, w.category, w.name AS workspace_name, l.name AS lead_name
         FROM claims c
         JOIN workspaces w ON w.id = c.workspace_id
         JOIN leads l ON l.id = c.lead_id
        WHERE c.id = ?`,
      [claimId],
    );
    if (!claim) throw new HttpError(404, 'not_found', 'Claim not found.');
    if (!scope.includes(claim.category)) throw new HttpError(403, 'forbidden', 'You cannot manage this category.');

    const now = Date.now();
    const nextStatus = body.status ?? claim.status;
    const statusChanged = nextStatus !== claim.status;

    await tx(db, async (txDb) => {
      await run(
        txDb,
        'UPDATE claims SET status = ?, verified = ?, verified_at = ?, verified_by = ?, verification_note = ?, last_activity_at = ? WHERE id = ?',
        [nextStatus, body.verified, now, user.id, body.note ?? null, now, claimId],
      );

      if (statusChanged) {
        await run(txDb, 'INSERT INTO claim_events (claim_id, status, at) VALUES (?, ?, ?)', [claimId, nextStatus, now]);
        await run(txDb, 'INSERT INTO notes (claim_id, author_id, system, stage, text, at) VALUES (?, NULL, 1, ?, ?, ?)', [
          claimId,
          nextStatus,
          `Manager ${user.name} changed stage to ${nextStatus}.`,
          now,
        ]);
      }

      const stateDesc = body.verified === 1 ? 'Verified (True)' : body.verified === 2 ? 'Rejected (False)' : 'Pending verification';
      const noteText = `Manager ${user.name} marked won claim as ${stateDesc}${body.note ? ': ' + body.note : '.'}`;
      await run(txDb, 'INSERT INTO notes (claim_id, author_id, system, stage, text, at) VALUES (?, NULL, 1, ?, ?, ?)', [
        claimId,
        nextStatus,
        noteText,
        now,
      ]);

      await logActivity(
        txDb,
        claim.category,
        `Manager ${user.name} verified ${claim.lead_name}: ${body.verified === 1 ? 'True' : 'False'}`,
        claim.workspace_name,
      );
    });

    return { ok: true, verified: body.verified, status: nextStatus };
  });
}
